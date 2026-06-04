# P0: 可落地执行计划方案

> 版本: 3.1
> 日期: 2026-06-04
> 状态: 已评审（修复 Critical 问题后）
> 变更: v3.0 方案升级 — P0.1/P0.2 从"无 Tree-sitter 模式"升级为"独立 Plugin + 官方编译器"方案，实现确定性结构化分析

## 1. 前置验证（已完成）

| 验证项 | 结果 | 影响 |
|---|---|---|
| `tree-sitter-wasms` Vue WASM 兼容性 | ❌ ABI 不匹配 | P0.1 使用 @vue/compiler-sfc 替代 |
| 自行编译 Vue WASM | ❌ external scanner 不支持 | 同上 |
| 自行编译 Svelte WASM | ❌ CompileError | P0.2 使用 svelte/compiler 替代 |
| Svelte AST 结构 | ✅ `<script>` 为 `raw_text` | 如果未来 WASM 可用，需两阶段提取 |
| @vue/compiler-sfc 可用性 | ✅ 纯 JS 包，Node.js 可用 | P0.1 VueSfcPlugin 可行 |
| svelte/compiler 可用性 | ✅ 纯 JS 包，Node.js 可用 | P0.2 SveltePlugin 可行 |
| TreeSitterPlugin 依赖注入可行性 | ✅ 已验证架构兼容 | VueSfcPlugin/SveltePlugin 可复用 TS grammar |

## 2. 实施阶段划分

### 阶段 1: P0.3 SCSS/Sass 增强（无外部依赖，可立即开始）

**原因**: 不依赖任何编译器/WASM，纯配置修改，风险最低。

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 1.1 | 修改 `css.ts` 配置 | `configs/css.ts` | `LanguageRegistry.getForFile('x.sass')` 返回 cssConfig |
| 1.2 | 修改 `css.md` 指南 | `languages/css.md` | 文件内容包含 SCSS/Sass/Tailwind 章节 |
| 1.3 | 运行现有测试 | — | `pnpm test` 全部通过 |

### 阶段 2: P0.1 Vue SFC（VueSfcPlugin + @vue/compiler-sfc）

**原因**: Vue 使用更广泛，优先实施。需要新增依赖但架构已验证可行。

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 2.1 | 安装 `@vue/compiler-sfc` | `package.json` | 依赖安装成功 |
| 2.2 | 创建 Vue SFC 语言配置 | `configs/vue-sfc.ts` | 配置对象符合 LanguageConfig schema |
| 2.3 | 注册语言配置 | `configs/index.ts` | `builtinLanguageConfigs` 包含 vueSfcConfig |
| 2.4 | 创建 VueSfcPlugin | `parsers/vue-sfc-parser.ts` | 实现 AnalyzerPlugin 接口 |
| 2.5 | 注册 VueSfcPlugin | `parsers/index.ts` | `registerAllParsers` 接受 tsPlugin 参数 |
| 2.6 | 创建 LLM 指南 | `languages/vue-sfc.md` | 文件内容完整 |
| 2.7 | 修改导入解析 | `extract-import-map.mjs` | `.vue` 扩展名 probe 成功 |
| 2.8 | 修改语言映射 | `scan-project.mjs` | `.vue` 映射为 `'vue-sfc'` |
| 2.9 | 修改 Vue 框架配置 | `frameworks/vue.ts` | `languages` 包含 `"vue-sfc"` |
| 2.10 | 编写单元测试 | `parsers/__tests__/vue-sfc-parser.test.ts` | 测试全部通过 |
| 2.11 | 运行全量测试 | — | `pnpm test` 全部通过 |

### 阶段 3: P0.2 Svelte（SveltePlugin + svelte/compiler）

**原因**: 与 Vue SFC 架构一致，可复用阶段 2 的依赖注入模式。

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 3.1 | 安装 `svelte` | `package.json` | 依赖安装成功 |
| 3.2 | 创建 Svelte 语言配置 | `configs/svelte.ts` | 配置对象符合 LanguageConfig schema |
| 3.3 | 注册语言配置 | `configs/index.ts` | `builtinLanguageConfigs` 包含 svelteConfig |
| 3.4 | 创建 SveltePlugin | `parsers/svelte-parser.ts` | 实现 AnalyzerPlugin 接口 |
| 3.5 | 注册 SveltePlugin | `parsers/index.ts` | 与 VueSfcPlugin 共享 registerAllParsers |
| 3.6 | 创建 LLM 指南 | `languages/svelte.md` | 文件内容完整 |
| 3.7 | 修改导入解析 | `extract-import-map.mjs` | `.svelte` 扩展名 probe 成功 |
| 3.8 | 编写单元测试 | `parsers/__tests__/svelte-parser.test.ts` | 测试全部通过 |
| 3.9 | 运行全量测试 | — | `pnpm test` 全部通过 |

### 阶段 4: 集成验证

| 步骤 | 任务 | 验证方式 |
|---|---|---|
| 4.1 | 全量构建 | `pnpm build` 成功 |
| 4.2 | 全量测试 | `pnpm test` 全部通过 |
| 4.3 | Vue 项目端到端测试 | 扫描一个真实 Vue 项目，验证 `.vue` 文件被正确分析 |
| 4.4 | Svelte 项目端到端测试 | 扫描一个真实 Svelte 项目，验证 `.svelte` 文件被正确分析 |
| 4.5 | 回归测试 | 扫描本项目自身，验证无退化 |

## 3. 每步骤详细实施规格

### 步骤 2.4: 创建 VueSfcPlugin

**文件**: `packages/core/src/plugins/parsers/vue-sfc-parser.ts`

**核心实现要点**:

1. `analyzeFile()`:
   - 调用 `@vue/compiler-sfc.parse()` 解析 SFC
   - 提取 `descriptor.scriptSetup ?? descriptor.script` 的 content 和 loc
   - 委托 `tsPlugin.analyzeFile()` 解析 script 内容
   - 行号偏移修正：`lineOffset = scriptStartLine - 1`
   - 提取 template AST 中的 PascalCase 组件引用
   - 合并 script imports 和 template 组件引用

2. `resolveImports()`:
   - 委托 `analyzeFile()` 获取 imports
   - 解析相对路径为绝对路径

3. `extractCallGraph()`:
   - 委托 `tsPlugin.extractCallGraph()` 解析 script
   - 行号偏移修正

4. **降级处理**: 如果 `tsPlugin` 未初始化，`analyzeFile()` 返回空 StructuralAnalysis（仅包含 template 组件引用）

### 步骤 2.5: 注册 VueSfcPlugin

**文件**: `packages/core/src/plugins/parsers/index.ts`

**变更**:
- `registerAllParsers` 签名扩展：`registry: PluginRegistry, tsPlugin?: TreeSitterPlugin`
- 新增 VueSfcPlugin 注册逻辑
- 保持向后兼容：tsPlugin 为可选参数

### 步骤 3.4: 创建 SveltePlugin

**文件**: `packages/core/src/plugins/parsers/svelte-parser.ts`

**核心实现要点**:

1. `analyzeFile()`:
   - 调用 `svelte/compiler.parse()` 解析 Svelte
   - 提取 `ast.instance ?? ast.module` 的 content 和 start
   - 字符偏移转行号：`content.slice(0, start).split("\n").length`
   - 检测 TypeScript：正则匹配 `<script lang="ts">`
   - 委托 `tsPlugin.analyzeFile()` 解析 script 内容
   - 行号偏移修正
   - 提取 template AST 中的组件引用

2. **与 VueSfcPlugin 的差异**:
   - svelte/compiler 的 start 是字符偏移量，不是行号
   - TypeScript 检测需要正则，编译器不直接提供 lang 属性
   - template AST 节点类型不同（Component vs PascalCase 标签）

## 4. 依赖关系图

```
阶段 1 (P0.3 SCSS 增强)
  │
  │  无依赖，可立即开始
  │
  ▼
阶段 2 (P0.1 Vue SFC)     阶段 3 (P0.2 Svelte)
  │                          │
  │ 需要 @vue/compiler-sfc   │ 需要 svelte
  │ 需要 TreeSitterPlugin    │ 需要 TreeSitterPlugin
  │                          │
  ├──────────┬───────────────┤
  │          │               │
  │  共享: parsers/index.ts  │
  │  共享: extract-import-map│
  │          │               │
  ▼          ▼               ▼
        阶段 4 (集成验证)
```

阶段 2 和阶段 3 可以并行实施（无代码依赖），共享以下文件修改：
- `packages/core/src/languages/configs/index.ts` — 两个配置注册
- `packages/core/src/plugins/parsers/index.ts` — 两个插件注册
- `skills/understand/extract-import-map.mjs` — 两组 probe 扩展

## 5. 文件变更总览

| 操作 | 文件 | 阶段 | 优先级 |
|---|---|---|---|
| 修改 | `packages/core/src/languages/configs/css.ts` | 1 | 高 |
| 修改 | `skills/understand/languages/css.md` | 1 | 高 |
| 新增 | `packages/core/src/languages/configs/vue-sfc.ts` | 2 | 高 |
| **新增** | `packages/core/src/plugins/parsers/vue-sfc-parser.ts` | 2 | 高 |
| 新增 | `skills/understand/languages/vue-sfc.md` | 2 | 高 |
| 修改 | `packages/core/src/languages/configs/index.ts` | 2+3 | 高 |
| **修改** | `packages/core/src/plugins/parsers/index.ts` | 2+3 | 高 |
| **修改** | `packages/core/package.json` | 2+3 | 高 |
| 修改 | `skills/understand/extract-import-map.mjs` | 2+3 | 高 |
| 修改 | `skills/understand/scan-project.mjs` | 2 | 高 |
| 修改 | `packages/core/src/languages/frameworks/vue.ts` | 2 | 高 |
| **修改** | `skills/understand/compute-batches.mjs` | 2 | 高 |
| **修改** | `skills/understand/extract-structure.mjs` | 2 | 高 |
| **修改** | `skills/understand/build-fingerprints.mjs` | 2 | 高 |
| 新增 | `packages/core/src/languages/configs/svelte.ts` | 3 | 高 |
| **新增** | `packages/core/src/plugins/parsers/svelte-parser.ts` | 3 | 高 |
| 新增 | `skills/understand/languages/svelte.md` | 3 | 高 |

**总计**: 新增 6 个文件，修改 10 个文件。

（**加粗** 为相比 v2.0 新增/变更的文件）

## 6. 验收标准

### P0.3 SCSS 增强

- [ ] `.sass` 文件被 `LanguageRegistry` 正确识别
- [ ] `cssConfig.concepts` 包含 SCSS/Sass/Tailwind 相关概念
- [ ] `cssConfig.filePatterns.config` 包含 Tailwind/PostCSS 配置文件
- [ ] 现有 CSS/SCSS/Less 文件分析行为无退化

### P0.1 Vue SFC

- [ ] `.vue` 文件被 `LanguageRegistry` 识别为 `vue-sfc` 语言
- [ ] VueSfcPlugin 正确提取 `<script setup>` 中的函数/类/导入/导出
- [ ] 行号偏移修正正确（对应 .vue 文件中的实际位置）
- [ ] template 中的 PascalCase 组件引用被提取到 imports
- [ ] `import Foo from './Foo.vue'` 正确解析
- [ ] `import Foo from './Foo'` probe 到 `./Foo.vue`
- [ ] Vue 框架配置的 `languages` 包含 `vue-sfc`
- [ ] call graph 提取正确（行号偏移修正）
- [ ] TreeSitterPlugin 未初始化时 graceful 降级
- [ ] 单元测试全部通过

### P0.2 Svelte

- [ ] `.svelte` 文件被 `LanguageRegistry` 识别为 `svelte` 语言
- [ ] SveltePlugin 正确提取 `<script>` 中的函数/类/导入/导出
- [ ] 行号偏移修正正确
- [ ] template 中的组件引用被提取到 imports
- [ ] `import Foo from './Foo.svelte'` 正确解析
- [ ] `import Foo from './Foo'` probe 到 `./Foo.svelte`
- [ ] TypeScript script 检测正确（`<script lang="ts">`）
- [ ] call graph 提取正确（行号偏移修正）
- [ ] 单元测试全部通过

### 集成验收

- [ ] `pnpm build` 成功
- [ ] `pnpm test` 全部通过
- [ ] 扫描真实 Vue 项目，知识图谱包含 `.vue` 文件节点（含函数/类/导入/导出）
- [ ] 扫描真实 Svelte 项目，知识图谱包含 `.svelte` 文件节点
- [ ] 扫描本项目自身，无退化

## 7. 风险与缓解

| 风险 | 缓解措施 | 决策点 |
|---|---|---|
| `tree-sitter-vue` 不兼容 | ✅ 已确认，使用 @vue/compiler-sfc 替代 | 已决定 |
| `tree-sitter-svelte` 不兼容 | ✅ 已确认，使用 svelte/compiler 替代 | 已决定 |
| TreeSitterPlugin 未初始化 | SFC 插件 init() 检查 tsPlugin，不可用时返回空分析 | 实施时处理 |
| 行号偏移计算错误 | 单元测试覆盖行号偏移场景，fixture 包含多行偏移 | 实施时验证 |
| @vue/compiler-sfc 版本兼容 | 锁定 ^3.5.0 | 实施时确认 |
| svelte/compiler 版本兼容 | 锁定 ^5.0.0 | 实施时确认 |
| 共享文件修改冲突 | 阶段 2 和 3 合并共享修改，避免分步冲突 | 实施策略调整 |
