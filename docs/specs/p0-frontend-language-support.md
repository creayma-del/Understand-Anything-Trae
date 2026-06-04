# P0: 前端语言扩展 — 总体设计规格

> 版本: 2.1
> 日期: 2026-06-04
> 状态: 已评审（修复 Critical 问题后）
> 变更: v2.0 方案升级 — P0.1/P0.2 从"无 Tree-sitter 模式"升级为"独立 Plugin + 官方编译器"方案，实现确定性结构化分析

## 1. 概述

本规格定义了 P0 阶段的三项核心语言扩展，旨在增强项目对前端技术栈的结构化分析能力：

| 编号 | 扩展项 | 类型 | 结构化分析方案 |
|---|---|---|---|
| P0.1 | Vue SFC (`.vue`) | 新增代码语言 + VueSfcPlugin | @vue/compiler-sfc + TS tree-sitter |
| P0.2 | Svelte (`.svelte`) | 新增代码语言 + SveltePlugin | svelte/compiler + TS tree-sitter |
| P0.3 | SCSS/Sass 增强 | 现有 CSS 配置扩展 | 无变化（纯配置） |

## 2. 架构约束

### 2.1 三层扩展模型

所有语言/框架扩展必须遵循项目已有的三层架构：

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1: LanguageConfig / FrameworkConfig                        │
│   位置: packages/core/src/languages/configs/*.ts                 │
│   职责: 语言元数据注册（ID、扩展名、concepts、filePatterns）       │
│   接口: LanguageConfig (zod schema 验证)                          │
│   注册: builtinLanguageConfigs[] → LanguageRegistry               │
├──────────────────────────────────────────────────────────────────┤
│ Layer 2: AnalyzerPlugin（结构化提取）                             │
│   位置: packages/core/src/plugins/                               │
│   职责: AST 结构化提取（函数、类、导入、导出、调用图）              │
│                                                                  │
│   方式 A: TreeSitterPlugin（tree-sitter WASM）                   │
│     接口: LanguageExtractor (extractStructure + extractCallGraph) │
│     注册: builtinExtractors[] → TreeSitterPlugin.registerExtractor│
│     适用: TypeScript, JavaScript, Python                         │
│                                                                  │
│   方式 B: 独立 AnalyzerPlugin（官方编译器 + TS tree-sitter）      │
│     接口: AnalyzerPlugin (analyzeFile + resolveImports + ...)    │
│     注册: PluginRegistry.register()                              │
│     适用: Vue SFC (VueSfcPlugin), Svelte (SveltePlugin)          │
│     依赖: TreeSitterPlugin 的 TypeScript grammar（注入）          │
│                                                                  │
│   方式 C: 非代码 Parser（正则/文本解析）                          │
│     接口: AnalyzerPlugin (analyzeFile + extractReferences)       │
│     注册: registerAllParsers() → PluginRegistry                  │
│     适用: Markdown, YAML, JSON, TOML, Dockerfile, SQL 等        │
├──────────────────────────────────────────────────────────────────┤
│ Layer 3: LLM Prompt Snippet                                      │
│   位置: skills/understand/languages/*.md                         │
│   职责: LLM 语义分析时的语言特性提示词                             │
│   引用: file-analyzer / architecture-analyzer 自动注入            │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 关键接口定义

**LanguageConfig** (来自 `packages/core/src/languages/types.ts`):

```typescript
interface LanguageConfig {
  id: string;                    // 唯一标识，如 "vue-sfc"
  displayName: string;           // 显示名，如 "Vue SFC"
  extensions: string[];          // 文件扩展名，如 [".vue"]
  filenames?: string[];          // 特殊文件名（可选）
  treeSitter?: {                 // Tree-sitter 配置（可选，仅 TreeSitterPlugin 使用）
    wasmPackage: string;         // npm 包名
    wasmFile: string;            // WASM 文件名
  };
  concepts: string[];            // 语言核心概念列表
  filePatterns: {
    entryPoints: string[];
    barrels: string[];
    tests: string[];
    config: string[];
  };
}
```

**AnalyzerPlugin** (来自 `packages/core/src/types.ts`):

```typescript
interface AnalyzerPlugin {
  name: string;
  languages: string[];           // 匹配 LanguageConfig.id
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports?(filePath: string, content: string): ImportResolution[];
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
  extractReferences?(filePath: string, content: string): ReferenceResolution[];
}
```

**StructuralAnalysis** (来自 `packages/core/src/types.ts`):

```typescript
interface StructuralAnalysis {
  functions: Array<{ name: string; lineRange: [number, number]; params: string[]; returnType?: string }>;
  classes: Array<{ name: string; lineRange: [number, number]; methods: string[]; properties: string[] }>;
  imports: Array<{ source: string; specifiers: string[]; lineNumber: number }>;
  exports: Array<{ name: string; lineNumber: number; isDefault?: boolean }>;
  sections?: SectionInfo[];
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
}
```

### 2.3 插件路由机制

`PluginRegistry` 通过 `LanguageConfig.id` 将文件路由到对应的 `AnalyzerPlugin`：

```
文件路径 → LanguageRegistry.getForFile() → LanguageConfig.id
         → PluginRegistry.getPluginForLanguage(id) → AnalyzerPlugin
         → AnalyzerPlugin.analyzeFile() → StructuralAnalysis
```

**关键约束**: 一个语言 ID 只能映射到一个 AnalyzerPlugin。如果 LanguageConfig 包含 `treeSitter` 字段，TreeSitterPlugin 会注册该语言；否则需要其他 Plugin 注册。

对于 Vue SFC 和 Svelte：
- LanguageConfig **不设 `treeSitter` 字段** → TreeSitterPlugin 不注册这些语言
- VueSfcPlugin / SveltePlugin 通过 `PluginRegistry.register()` 注册对应语言
- PluginRegistry 将 `.vue` → `vue-sfc` → VueSfcPlugin，`.svelte` → `svelte` → SveltePlugin

### 2.4 导入解析管线

导入解析在 `skills/understand/extract-import-map.mjs` 中实现，当前已支持：

| 语言集合 | 变量名 | 解析函数 |
|---|---|---|
| TS/JS/TSX/JSX/Vue/Svelte | `TS_JS_LANGS` | `resolveTsJsImport()` |
| Python | — | `resolvePythonImport()` |
| Go | — | `resolveGoImport()` |
| Java/Kotlin/C#/PHP/Rust/Ruby/C/C++ | — | 各自独立解析函数 |

### 2.5 WASM Grammar 依赖

当前 core 包已依赖的 tree-sitter grammar：

| npm 包 | 版本 | 语言 |
|---|---|---|
| `tree-sitter-typescript` | ^0.23.2 | TypeScript / TSX |
| `tree-sitter-javascript` | ^0.25.0 | JavaScript |
| `tree-sitter-python` | ^0.25.0 | Python |
| `web-tree-sitter` | ^0.26.6 | 运行时 |

**WASM 验证结论**: tree-sitter-vue 和 tree-sitter-svelte 的 WASM 均不可用（external scanner 限制）。因此 Vue SFC 和 Svelte 使用官方编译器替代 tree-sitter WASM。

新增依赖：

| npm 包 | 版本 | 用途 |
|---|---|---|
| `@vue/compiler-sfc` | ^3.5.0 | Vue SFC 解析（VueSfcPlugin） |
| `svelte` | ^5.0.0 | Svelte 解析（SveltePlugin，含 svelte/compiler） |

## 3. 各子项设计文档索引

| 子项 | 设计文档 | 核心变更 | 版本 |
|---|---|---|---|
| P0.1 Vue SFC | [p0.1-vue-sfc.md](./p0.1-vue-sfc.md) | VueSfcPlugin + @vue/compiler-sfc + TS tree-sitter | v4.0 |
| P0.2 Svelte | [p0.2-svelte.md](./p0.2-svelte.md) | SveltePlugin + svelte/compiler + TS tree-sitter | v4.0 |
| P0.3 SCSS 增强 | [p0.3-scss-enhancement.md](./p0.3-scss-enhancement.md) | 修改现有 CSS 配置 + 补充指南 | v3.0 |

## 4. 跨子项共享约束

### 4.1 文件命名规范

- 语言配置: `configs/<id>.ts`（如 `vue-sfc.ts`、`svelte.ts`）
- 独立插件: `parsers/<id>-parser.ts`（如 `vue-sfc-parser.ts`、`svelte-parser.ts`）
- LLM 指南: `languages/<id>.md`（如 `vue-sfc.md`、`svelte.md`）

### 4.2 注册规范

每个新语言必须在以下位置注册：

1. `configs/index.ts` — 导出配置对象 + 加入 `builtinLanguageConfigs[]`
2. `parsers/index.ts` — 导出插件类 + 在 `registerAllParsers()` 中注册
3. `languages/*.md` — LLM 指南文档（file-analyzer 自动扫描目录注入）

### 4.3 依赖注入规范

VueSfcPlugin 和 SveltePlugin 都需要访问 TreeSitterPlugin 的 TypeScript grammar。注入方式：

```typescript
// 调用方需要确保 TreeSitterPlugin 已初始化后再注册 SFC 插件
const tsPlugin = new TreeSitterPlugin(configs);
await tsPlugin.init();

const registry = new PluginRegistry(langRegistry);
registry.register(tsPlugin);
registerAllParsers(registry, tsPlugin); // 传入 tsPlugin 供 SFC 插件使用
```

### 4.4 行号偏移修正规范

SFC 文件的 script 内容在独立解析后，行号需要偏移修正：

```typescript
// 通用偏移修正模式
const lineOffset = scriptStartLine - 1; // 编译器行号从 1 开始
corrected.lineRange = [original[0] + lineOffset, original[1] + lineOffset];
corrected.lineNumber = original + lineOffset;
```

### 4.5 测试规范

每个新插件必须包含：

1. 单元测试: `parsers/__tests__/<id>-parser.test.ts`
2. 测试 fixture: 提供至少 5 个样本文件（基础、完整特性、TypeScript、边界情况、空文件）
3. 测试覆盖: `analyzeFile`、`resolveImports`、`extractCallGraph` 三个方法
4. 行号偏移验证: 确保提取结果的行号对应 SFC 文件中的实际位置

### 4.6 向后兼容

- 所有新增均为增量操作，不修改现有接口签名
- `LanguageConfig` 的 `treeSitter` 字段为可选，grammar 加载失败时 graceful skip
- `extract-import-map.mjs` 的修改仅增加新的 probe 扩展名，不影响现有解析逻辑
- `registerAllParsers` 签名扩展为可选参数，不影响现有调用

## 5. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| `@vue/compiler-sfc` 版本与 Vue 3 不兼容 | 低 | Vue SFC 解析失败 | 锁定 ^3.5.0 版本，与 Vue 3 对齐 |
| `svelte/compiler` 版本与 Svelte 5 不兼容 | 低 | Svelte 解析失败 | 锁定 ^5.0.0 版本 |
| TreeSitterPlugin 未初始化时注册 SFC 插件 | 中 | SFC 插件无法解析 script | init() 中检查 tsPlugin 是否可用，不可用时返回空分析 |
| 行号偏移计算错误 | 中 | 知识图谱节点位置不准确 | 单元测试覆盖行号偏移场景 |
| svelte/compiler 字符偏移转行号性能 | 低 | 大文件解析变慢 | 缓存行号映射表 |
| SCSS 嵌套规则与现有 CSS 配置冲突 | 低 | 可能影响现有 CSS 文件分析 | 仅扩展 concepts 和 filePatterns，不改核心逻辑 |
