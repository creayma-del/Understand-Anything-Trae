# P1: 前端生态核心深化 — 总体设计规格

> 版本: 1.0
> 日期: 2026-06-05
> 状态: 已评审（修复 HIGH 问题后）
> 前置: P0（Vue SFC / Svelte / SCSS 增强 / Python 移除）已完成

## 1. 概述

本规格定义 P1 阶段的核心深化目标：聚焦 Vue + React 生态，补齐前端语言解析链路的关键缺失，使项目对 Vue/React 代码库的分析能力从"依赖 LLM 猜测"升级为"确定性结构化提取 + LLM 语义增强"。

| 编号 | 扩展项 | 类型 | 结构化分析方案 |
|---|---|---|---|
| P1.1 | CSS/SCSS 解析器 | 新增 CssPlugin | postcss + postcss-scss |
| P1.2 | HTML 解析器 | 新增 HtmlPlugin | node-html-parser |
| P1.3 | Vue/Svelte 解析器测试补全 | 新增测试文件 | vitest |
| P1.4 | React JSX 语义提取器 | 新增 ReactExtractor | 扩展 TypeScriptExtractor |
| P1.5 | Nuxt 框架配置 | 新增 FrameworkConfig + Skill | nuxt 检测关键词 + 层级映射 |
| P1.6 | SvelteKit 框架配置 | 新增 FrameworkConfig + Skill | @sveltejs/kit 检测 + 层级映射 |
| P1.7 | Vue/Svelte style 块分析 | 扩展现有 Plugin | 委托 CssPlugin |
| P1.8 | CSS-in-JS 支持 | 扩展 ReactExtractor | 模式识别 + 标签标记 |

## 2. 架构约束

### 2.1 三层扩展模型（延续 P0）

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
│     适用: TypeScript, JavaScript                                 │
│                                                                  │
│   方式 B: 独立 AnalyzerPlugin（官方编译器 + TS tree-sitter）      │
│     接口: AnalyzerPlugin (analyzeFile + resolveImports + ...)    │
│     注册: PluginRegistry.register()                              │
│     适用: Vue SFC, Svelte                                        │
│                                                                  │
│   方式 C: 非代码 Parser（正则/文本解析）                          │
│     接口: AnalyzerPlugin (analyzeFile + extractReferences)       │
│     注册: registerAllParsers() → PluginRegistry                  │
│     适用: Markdown, YAML, JSON, TOML, Dockerfile, SQL 等        │
│                                                                  │
│   ★ 方式 D: CSS/HTML Parser（PostCSS / node-html-parser）       │
│     接口: AnalyzerPlugin (analyzeFile + resolveImports)          │
│     注册: registerAllParsers() → PluginRegistry                  │
│     适用: CSS, SCSS, Sass, HTML                                  │
│     降级: LESS 仅基础 CSS 解析（无 LESS 特有语法支持）            │
│     约束: 不使用 tree-sitter WASM（兼容性问题）                   │
│                                                                  │
│   ★ 方式 E: 语义提取器（扩展 TypeScriptExtractor）               │
│     接口: LanguageExtractor (extractStructure + extractCallGraph) │
│     注册: builtinExtractors[] → TreeSitterPlugin.registerExtractor│
│     适用: React JSX/TSX                                          │
│     特点: 继承 TypeScriptExtractor，增加 React 模式识别           │
├──────────────────────────────────────────────────────────────────┤
│ Layer 3: LLM Prompt Snippet                                      │
│   位置: skills/understand/languages/*.md / frameworks/*.md       │
│   职责: LLM 语义分析时的语言/框架特性提示词                       │
│   引用: file-analyzer / architecture-analyzer 自动注入            │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 关键接口定义

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

**LanguageExtractor** (来自 `packages/core/src/plugins/extractors/types.ts`):

```typescript
interface LanguageExtractor {
  languageIds: string[];
  extractStructure(rootNode: TreeSitterNode): ExtractionResult;
  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[];
}
```

**StructuralAnalysis** 新增字段（P1.1 CSS / P1.2 HTML）:

```typescript
interface StructuralAnalysis {
  // ... 现有字段 ...
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
  // ★ P1.1 新增: CSS 规则提取
  cssRules?: CssRuleInfo[];
  // ★ P1.2 新增: HTML 元素提取
  htmlElements?: HtmlElementInfo[];
}
```

**CssRuleInfo** (P1.1 新增):

```typescript
interface CssRuleInfo {
  selector: string;              // 选择器文本
  lineRange: [number, number];   // 行号范围
  declarations: string[];        // 属性名列表
  type: 'rule' | 'at-rule' | 'mixin' | 'function' | 'variable'; // mixin/function 仅 SCSS/Sass，LESS 不支持
}
```

**HtmlElementInfo** (P1.2 新增):

```typescript
interface HtmlElementInfo {
  tag: string;                   // 标签名
  lineRange: [number, number];   // 行号范围
  attributes: Record<string, string>;  // 属性键值对
  isSelfClosing: boolean;        // 自闭合标签
}
```

### 2.3 插件路由机制（延续 P0）

```
文件路径 → LanguageRegistry.getForFile() → LanguageConfig.id
         → PluginRegistry.getPluginForLanguage(id) → AnalyzerPlugin
         → AnalyzerPlugin.analyzeFile() → StructuralAnalysis
```

P1 新增路由:

| 文件扩展名 | LanguageConfig.id | AnalyzerPlugin |
|---|---|---|
| `.css`, `.scss`, `.sass`, `.less` | `css` | CssPlugin（.less 仅基础 CSS 解析） |
| `.html`, `.htm` | `html` | HtmlPlugin |
| `.tsx`, `.jsx` | `typescript` / `javascript` | TreeSitterPlugin + ReactExtractor |

### 2.4 依赖约束

- **不引入 tree-sitter-css / tree-sitter-html WASM**：与 web-tree-sitter ^0.26.6 存在兼容性问题（与 P0 Vue/Svelte WASM 问题同类）
- **使用 PostCSS 替代 tree-sitter-css**：postcss + postcss-scss 是纯 JS 包，Node.js 原生可用
- **使用 node-html-parser 替代 tree-sitter-html**：轻量级 HTML 解析器，无 WASM 依赖
- **ReactExtractor 继承 TypeScriptExtractor**：复用已有 TS tree-sitter 能力，不破坏现有链路

### 2.5 WASM 兼容性验证结论

| 包 | 可用性 | 原因 | 替代方案 |
|---|---|---|---|
| `tree-sitter-css` | ❌ 不可用 | ABI 不匹配 / external scanner | PostCSS + postcss-scss |
| `tree-sitter-html` | ❌ 不可用 | ABI 不匹配 / external scanner | node-html-parser |
| `tree-sitter-vue` | ❌ 不可用 | external scanner 限制 | @vue/compiler-sfc（P0 已实现） |
| `tree-sitter-svelte` | ❌ 不可用 | CompileError | svelte/compiler（P0 已实现） |

## 3. 各子项设计文档索引

| 子项 | 核心变更 | 优先级 |
|---|---|---|
| P1.1 CSS/SCSS 解析器 | CssPlugin + postcss + postcss-scss | P0 |
| P1.2 HTML 解析器 | HtmlPlugin + node-html-parser | P0 |
| P1.3 Vue/Svelte 测试补全 | vue-sfc-parser.test.ts + svelte-parser.test.ts | P0 |
| P1.4 React JSX 语义提取器 | ReactExtractor + hooks/组件/Context 识别 | P1 |
| P1.5 Nuxt 框架配置 | nuxt.ts + nuxt.md | P1 |
| P1.6 SvelteKit 框架配置 | sveltekit.ts + sveltekit.md | P1 |
| P1.7 Vue/Svelte style 块分析 | 扩展 VueSfcPlugin/SveltePlugin | P2 |
| P1.8 CSS-in-JS 支持 | 扩展 ReactExtractor + css-in-js.md | P2 |

## 4. P1.1 CSS/SCSS 解析器详细设计

### 4.1 目标

为 CSS/SCSS/Sass 文件提供确定性结构化提取，不再完全依赖 LLM。LESS 文件仅获得基础 CSS 解析（PostCSS 回退模式），不支持 LESS 特有语法。

### 4.2 提取策略：PostCSS + postcss-scss

```
阶段 1: PostCSS 解析 CSS/SCSS/LESS 文件
  → 获取 AST：Root → Rule / AtRule / Declaration
  → 提取 @import / @use / @forward 语句 → imports
  → 提取 @mixin 定义 + @include 引用 → definitions + edges（仅 SCSS/Sass）
  → 提取 @function 定义 + 引用 → definitions + edges（仅 SCSS/Sass）
  → 提取 CSS 变量定义 (--*) + var() 引用 → definitions + edges
  → 提取选择器规则 → cssRules
  → 提取 @extend 继承关系 → edges（仅 SCSS/Sass）
  → 注意: LESS 文件以普通 CSS 模式解析，LESS 特有语法（mixin、@variable 等）无法识别

阶段 2: SCSS 模块系统解析
  → @use "module" → 解析为项目内相对路径
  → @forward "module" → 解析为项目内相对路径
  → @import "partial" → 解析为项目内相对路径（_前缀 + .scss 后缀探测）
```

### 4.3 CssPlugin 实现

**文件**: `packages/core/src/plugins/parsers/css-parser.ts`

```typescript
export class CssPlugin implements AnalyzerPlugin {
  name = 'css-parser';
  languages = ['css'];

  analyzeFile(filePath: string, content: string): StructuralAnalysis {
    // 1. 选择合适的 PostCSS 语法（scss / sass / less / css）
    // 2. 解析为 PostCSS AST
    // 3. 遍历 AST 提取规则、变量、mixin、函数
    // 4. 返回 StructuralAnalysis
  }

  resolveImports(filePath: string, content: string): ImportResolution[] {
    // 1. 提取 @import / @use / @forward 语句
    // 2. 解析相对路径（_前缀探测 + 扩展名探测）
    // 3. 返回 ImportResolution[]
  }
}
```

**PostCSS 语法选择逻辑**:

```typescript
function getPostcssSyntax(filePath: string): Syntax | undefined {
  const ext = path.extname(filePath);
  if (ext === '.scss' || ext === '.sass') return scssSyntax;
  if (ext === '.less') return undefined; // LESS 暂不支持语法高亮，回退为普通 CSS
  return undefined; // 普通 CSS
}
```

### 4.4 提取能力清单

| 提取项 | CSS | SCSS | Sass | LESS | 边类型 |
|---|---|---|---|---|---|
| 选择器规则 | ✅ | ✅ | ✅ | ✅¹ | `contains` |
| `@import` | ✅ | ✅ | ✅ | ✅¹ | `imports` |
| `@use` | — | ✅ | — | — | `imports` |
| `@forward` | — | ✅ | — | — | `imports` |
| `@mixin` 定义 | — | ✅ | ✅ | — | `contains` |
| `@include` 引用 | — | ✅ | ✅ | — | `depends_on` |
| `@function` 定义 | — | ✅ | ✅ | — | `contains` |
| `@extend` 继承 | — | ✅ | ✅ | — | `inherits` |
| CSS 变量定义 | ✅ | ✅ | ✅ | ✅¹ | `contains` |
| `var()` 引用 | ✅ | ✅ | ✅ | ✅¹ | `depends_on` |
| `@tailwind` 指令 | ✅ | ✅ | — | — | `depends_on` |
| `@apply` 指令 | ✅ | ✅ | — | — | `depends_on` |

> ¹ LESS 文件仅获得基础 CSS 解析（PostCSS 以普通 CSS 模式解析），不支持 LESS 特有语法（如 `@import-less`、mixin 定义/引用、`@variable` 变量、`&` 嵌套等）。原因是 `postcss-scss` 不解析 LESS 语法，且目前不引入 `postcss-less` 等额外依赖。

### 4.5 导入解析路径探测

SCSS 模块的导入路径需要特殊探测：

```typescript
// @use "components/button" 的探测顺序:
// 1. components/button.scss
// 2. components/button.sass
// 3. components/_button.scss  (partial 约定)
// 4. components/_button.sass
// 5. components/button/index.scss
// 6. components/button/_index.scss
// 7. components/button.css
```

### 4.6 依赖变更

| npm 包 | 版本 | 用途 |
|---|---|---|
| `postcss` | ^8.5.0 | CSS AST 解析 |
| `postcss-scss` | ^4.0.0 | SCSS 语法支持 |

### 4.7 注册变更

**`configs/css.ts`**: 不设 `treeSitter` 字段（与 Vue/Svelte 同理，CssPlugin 替代 tree-sitter-css）

**`parsers/index.ts`**: `registerAllParsers()` 新增 CssPlugin 注册

## 5. P1.2 HTML 解析器详细设计

### 5.1 目标

为 HTML 文件提供确定性结构化提取，识别脚本/样式引用和语义结构。

### 5.2 提取策略：node-html-parser

```
阶段 1: node-html-parser 解析 HTML 文件
  → 获取 DOM 树
  → 提取 <script src="..."> → imports
  → 提取 <link rel="stylesheet" href="..."> → imports
  → 提取语义标签结构 → htmlElements
  → 提取内联 <script> / <style> → sections
```

### 5.3 HtmlPlugin 实现

**文件**: `packages/core/src/plugins/parsers/html-parser.ts`

```typescript
export class HtmlPlugin implements AnalyzerPlugin {
  name = 'html-parser';
  languages = ['html'];

  analyzeFile(filePath: string, content: string): StructuralAnalysis {
    // 1. 使用 node-html-parser 解析
    // 2. 提取 script/link 引用
    // 3. 提取语义标签结构
    // 4. 返回 StructuralAnalysis
  }

  resolveImports(filePath: string, content: string): ImportResolution[] {
    // 1. 提取 <script src> / <link href> 引用
    // 2. 解析相对路径
    // 3. 返回 ImportResolution[]
  }
}
```

### 5.4 提取能力清单

| 提取项 | 边类型 | 说明 |
|---|---|---|
| `<script src="...">` | `imports` | 外部脚本引用 |
| `<link rel="stylesheet" href="...">` | `imports` | 外部样式引用 |
| `<link rel="modulepreload" href="...">` | `imports` | ES Module 预加载 |
| `<link rel="icon" href="...">` | `related` | 图标资源引用 |
| 语义标签 (`<header>`, `<nav>`, `<main>`, `<article>`, `<section>`, `<footer>`) | `contains` | 语义结构 |
| `<meta>` 标签 | — | sections 元数据 |
| 内联 `<script>` | — | sections 脚本内容 |
| 内联 `<style>` | — | sections 样式内容 |

### 5.5 依赖变更

| npm 包 | 版本 | 用途 |
|---|---|---|
| `node-html-parser` | ^7.0.0 | HTML DOM 解析 |

## 6. P1.3 Vue/Svelte 解析器测试补全详细设计

### 6.1 目标

为 VueSfcPlugin 和 SveltePlugin 补全单元测试，覆盖核心场景。

### 6.2 Vue SFC 解析器测试

**文件**: `packages/core/src/plugins/parsers/__tests__/vue-sfc-parser.test.ts`

| 测试场景 | 输入 | 预期输出 |
|---|---|---|
| 基础 script setup | `<script setup>const x = ref(0)</script>` | 提取 `x` 变量，行号偏移正确 |
| 普通 script | `<script>export default { data() {} }</script>` | 提取 `data` 方法 |
| TypeScript script setup | `<script setup lang="ts">const x: Ref<number> = ref(0)</script>` | TypeScript 解析正确 |
| template 组件引用 | `<template><ChildComponent /></template>` | imports 包含 ChildComponent |
| template + script 去重 | script import + template 同名组件 | imports 不重复 |
| 空文件 | `<template></template>` | 返回空分析，无报错 |
| 无 script | 仅 `<template>` + `<style>` | 返回空函数/类/导入 |
| 多行偏移修正 | script 从第 10 行开始 | 函数行号 = 原始行号 + 9 |
| 降级守卫 | tsPlugin 未初始化 | 返回空分析 + template 组件引用 |
| defineProps/defineEmits | `<script setup>defineProps({})</script>` | 识别为函数调用 |

### 6.3 Svelte 解析器测试

**文件**: `packages/core/src/plugins/parsers/__tests__/svelte-parser.test.ts`

| 测试场景 | 输入 | 预期输出 |
|---|---|---|
| 基础 instance script | `<script>let count = 0</script>` | 提取 `count` 变量 |
| module script | `<script context="module">export const loader = () => {}</script>` | 提取 `loader` 导出 |
| TypeScript script | `<script lang="ts">let x: number = 0</script>` | TypeScript 解析正确 |
| template 组件引用 | `<ChildComponent />` | imports 包含 ChildComponent |
| 双 script 块 | instance + module script | 合并两个 script 的分析结果 |
| 空文件 | 空内容 | 返回空分析，无报错 |
| 字符偏移转行号 | script 从字符位置 100 开始 | 行号计算正确 |
| 降级守卫 | tsPlugin 未初始化 | 返回空分析 + template 组件引用 |

## 7. P1.4 React JSX 语义提取器详细设计

### 7.1 目标

在 TypeScriptExtractor 基础上增加 React 特有模式识别，自动提取组件关系、hooks 调用链、Context 依赖。

### 7.2 提取策略：扩展 TypeScriptExtractor

```
阶段 1: TypeScriptExtractor 提取基础结构（函数/类/imports/exports/调用图）
  → 复用现有 TS tree-sitter 能力

阶段 2: ReactExtractor 增量分析
  → 识别 hooks 调用模式 → 标记为 hook 类型
  → 识别组件声明 → 标记为 component 类型
  → 识别 JSX 组件组合 → 生成 contains 边
  → 识别 Context 关系 → 生成 depends_on 边
  → 识别 HOC 包装 → 生成 depends_on 边
```

### 7.3 ReactExtractor 实现

**文件**: `packages/core/src/plugins/extractors/react-extractor.ts`

```typescript
export class ReactExtractor extends TypeScriptExtractor {
  languageIds = ['typescript', 'javascript']; // 与 TypeScriptExtractor 相同

  extractStructure(tree: Tree, source: string): ExtractionResult {
    // 1. 调用 super.extractStructure() 获取基础结果
    // 2. 增量分析 React 模式
    // 3. 返回增强结果
  }

  // React 模式识别方法
  private identifyHooks(result: ExtractionResult): void;
  private identifyComponents(result: ExtractionResult, source: string): void;
  private identifyJsxComposition(result: ExtractionResult, source: string): void;
  private identifyContextRelations(result: ExtractionResult): void;
  private identifyHocPatterns(result: ExtractionResult): void;
}
```

### 7.4 React 模式识别规则

#### 7.4.1 Hooks 识别

```typescript
const REACT_HOOKS = [
  'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
  'useContext', 'useReducer', 'useLayoutEffect', 'useDebugValue',
  'useDeferredValue', 'useTransition', 'useId', 'useSyncExternalStore',
  'useInsertionEffect', 'useImperativeHandle',
];

// 识别规则: 函数名以 "use" 开头 + 大写字母，且从 'react' 或自定义 hook 文件导入
// 标记: function.tags.push('hook')
```

#### 7.4.2 组件声明识别

```typescript
// 规则 1: 函数名 PascalCase + 返回 JSX
//   function MyComponent() { return <div /> }
//   const MyComponent = () => <div />

// 规则 2: 函数名 PascalCase + 从 'react' 导入的组件类型
//   const MyComponent: React.FC = () => {}

// 规则 3: forwardRef 包裹
//   const MyComponent = forwardRef((props, ref) => {})

// 标记: function.tags.push('component')
```

#### 7.4.3 JSX 组件组合

```typescript
// 规则: JSX 中 <PascalCase /> 标签
//   <ChildComponent prop={value} />
//   <ThemeProvider><App /></ThemeProvider>

// 边: contains (父组件 → 子组件)
// 注意: 仅当子组件在 imports 中存在时生成边（避免误识别 HTML 标签）
```

#### 7.4.4 Context 关系

```typescript
// 规则 1: createContext 调用
//   const ThemeContext = createContext(defaultValue)
//   → 识别为 context 定义

// 规则 2: useContext 调用
//   const theme = useContext(ThemeContext)
//   → 识别为 context 消费

// 边: depends_on (消费者 → 定义者)
```

#### 7.4.5 HOC 包装

```typescript
// 规则: 函数调用包裹组件定义
//   export default withRouter(MyComponent)
//   export default connect(mapStateToProps)(MyComponent)
//   const WrappedComponent = memo(MyComponent)

// 标签: function.tags.push('hoc-wrapped')
// 边: depends_on (组件 → HOC)
```

### 7.5 注册变更

**`extractors/index.ts`**: 将 `TypeScriptExtractor` 替换为 `ReactExtractor`（ReactExtractor 继承 TypeScriptExtractor，完全兼容）

```diff
- import { TypeScriptExtractor } from "./typescript-extractor.js";
+ import { ReactExtractor } from "./react-extractor.js";

  export const builtinExtractors = [
-   new TypeScriptExtractor(),
+   new ReactExtractor(),
  ];
```

## 8. P1.5 Nuxt 框架配置详细设计

### 8.1 目标

新增 Nuxt 框架的自动检测和架构层级映射。

### 8.2 框架配置

**文件**: `packages/core/src/languages/frameworks/nuxt.ts`

```typescript
export const nuxtConfig: FrameworkConfig = {
  id: 'nuxt',
  displayName: 'Nuxt',
  languages: ['typescript', 'javascript', 'vue-sfc'],
  detectionKeywords: ['nuxt', '@nuxt/', 'nuxt.config'],
  manifestFiles: ['package.json', 'nuxt.config.ts', 'nuxt.config.js'],
  entryPoints: [
    'app.vue',
    'nuxt.config.ts',
    'nuxt.config.js',
  ],
  layerHints: {
    pages: 'ui',
    layouts: 'ui',
    composables: 'service',
    middleware: 'middleware',
    plugins: 'config',
    'server/api': 'api',
    'server/routes': 'api',
    'server/middleware': 'middleware',
    'server/plugins': 'config',
    'server/utils': 'utility',
    utils: 'utility',
    assets: 'resource',
    public: 'resource',
    components: 'ui',
  },
  promptSnippetPath: 'frameworks/nuxt.md',
};
```

> **⚠️ Vue detectionKeywords 变更**: 新增 Nuxt 配置后，必须从 Vue 的 `detectionKeywords` 中移除 `'nuxt'`（当前 Vue 配置包含 `"nuxt"` 关键词），以避免 Nuxt 项目同时被识别为 Vue 框架。变更后 Vue 的 `detectionKeywords` 应为 `["vue", "@vue/cli-service", "vite-plugin-vue"]`。

### 8.3 Skill 文档

**文件**: `skills/understand/frameworks/nuxt.md`

覆盖内容:
- Nuxt 项目结构（12 种文件角色：page/layout/component/composable/middleware/plugin/server route/server middleware/server plugin/server util/asset/public）
- 边模式（页面→布局、组件→composable、server route→server util、middleware 链）
- 架构层（5 层：UI / Service / API / Middleware / Resource）
- Nuxt 特有模式（auto-imports、file-based routing、server routes、hybrid rendering）

## 9. P1.6 SvelteKit 框架配置详细设计

### 9.1 目标

新增 SvelteKit 框架的自动检测和架构层级映射。

### 9.2 框架配置

**文件**: `packages/core/src/languages/frameworks/sveltekit.ts`

```typescript
export const sveltekitConfig: FrameworkConfig = {
  id: 'sveltekit',
  displayName: 'SvelteKit',
  languages: ['typescript', 'javascript', 'svelte'],
  detectionKeywords: ['@sveltejs/kit', '@sveltejs/adapter-', 'svelte.config'],
  manifestFiles: ['package.json', 'svelte.config.js', 'svelte.config.ts'],
  entryPoints: [
    'src/routes/+layout.svelte',
    'src/routes/+page.svelte',
    'src/hooks.server.ts',
    'src/hooks.client.ts',
  ],
  layerHints: {
    'src/routes': 'ui',
    'src/lib/components': 'ui',
    'src/lib': 'service',
    'src/hooks': 'middleware',
    'src/params': 'utility',
    'static': 'resource',
  },
  promptSnippetPath: 'frameworks/sveltekit.md',
};
```

### 9.3 Skill 文档

**文件**: `skills/understand/frameworks/sveltekit.md`

覆盖内容:
- SvelteKit 项目结构（+page/+layout/+server/+error/+loading 等约定文件）
- 边模式（page→layout、+server.ts API 路由、$app stores、$lib 别名）
- 架构层（4 层：UI / Service / Middleware / Resource）
- SvelteKit 特有模式（file-based routing、server load functions、form actions、adapters）

## 10. P1.7 Vue/Svelte style 块分析详细设计

### 10.1 目标

扩展 VueSfcPlugin 和 SveltePlugin，提取 `<style>` 块并委托给 CssPlugin 分析。

### 10.2 实现策略

```
VueSfcPlugin.analyzeFile():
  1. @vue/compiler-sfc.parse() → SFCDescriptor
  2. 提取 script → 委托 tsPlugin（现有逻辑）
  3. ★ 提取 style 块 → 委托 cssPlugin.analyzeFile()
     - 每个 style 块独立分析
     - 行号偏移修正（style 块起始行）
     - scoped 标记：添加 "scoped-style" tag
     - CSS Modules 标记：module 属性检测
  4. 合并 script + style 分析结果
```

### 10.3 提取能力

| 提取项 | Vue | Svelte | 说明 |
|---|---|---|---|
| `<style>` 块内容 | ✅ | ✅ | 委托 CssPlugin |
| `<style scoped>` | ✅ | — | 标记 scoped-style tag |
| `<style module>` | ✅ | — | 标记 css-modules tag |
| `v-bind()` in CSS | ✅ | — | 识别为 depends_on 边 |
| Svelte style 块 | — | ✅ | Svelte 支持 `<style>` 块 |

## 11. P1.8 CSS-in-JS 支持详细设计

### 11.1 目标

扩展 ReactExtractor，识别 styled-components / emotion / styled-jsx 等 CSS-in-JS 模式。

### 11.2 识别规则

```typescript
const CSS_IN_JS_PATTERNS = {
  // styled-components
  styledComponent: /styled[.<`]/,
  styledExtend: /styled\([\w.]+\)/,

  // emotion
  emotionCss: /css[`\s]/,
  emotionStyled: /styled[.<`]/,  // 与 styled-components 共享

  // styled-jsx
  styledJsx: /<style jsx>/,

  // JSS / MUI
  createStyles: /createStyles\(/,
  makeStyles: /makeStyles\(/,
  withStyles: /withStyles\(/,
};
```

### 11.3 标签标记

| 模式 | 标签 |
|---|---|
| `styled.div` | `styled-component`, `css-in-js` |
| `css` template literal | `css-in-js`, `emotion` |
| `<style jsx>` | `css-in-js`, `styled-jsx` |
| `createStyles()` | `css-in-js`, `jss` |
| `makeStyles()` | `css-in-js`, `mui` |

### 11.4 Skill 文档

**文件**: `skills/understand/languages/css-in-js.md`

覆盖内容:
- styled-components 模式（styled.xxx / styled(Comp) / .attrs() / .extend）
- Emotion 模式（css prop / styled / @emotion/react）
- styled-jsx 模式（<style jsx> / <style jsx global>）
- JSS/MUI 模式（createStyles / makeStyles / withStyles）
- 边模式（组件→样式定义、主题→样式消费）

## 12. 跨子项共享约束

### 12.1 文件命名规范

- 解析器: `parsers/<id>-parser.ts`（如 `css-parser.ts`、`html-parser.ts`）
- 提取器: `extractors/<id>-extractor.ts`（如 `react-extractor.ts`）
- 框架配置: `frameworks/<id>.ts`（如 `nuxt.ts`、`sveltekit.ts`）
- Skill 文档: `languages/<id>.md` / `frameworks/<id>.md`

### 12.2 注册规范

每个新增必须在以下位置注册：

1. `configs/index.ts` — 导出配置对象 + 加入 `builtinLanguageConfigs[]`（仅 CSS/HTML 需修改配置）
2. `parsers/index.ts` — 导出插件类 + 在 `registerAllParsers()` 中注册
3. `extractors/index.ts` — 导出提取器 + 加入 `builtinExtractors[]`
4. `frameworks/index.ts` — 导出框架配置 + 加入 `builtinFrameworkConfigs[]`

### 12.3 依赖注入规范

CssPlugin 不需要 TreeSitterPlugin 依赖（使用 PostCSS 替代）。
HtmlPlugin 不需要任何外部 Plugin 依赖。
VueSfcPlugin/SveltePlugin 扩展后需要 CssPlugin 引用（P1.7 阶段）。

### 12.4 测试规范

每个新插件/提取器必须包含：

1. 单元测试: `__tests__/<id>-parser.test.ts` 或 `__tests__/<id>-extractor.test.ts`
2. 测试 fixture: 至少 5 个样本文件（基础、完整特性、TypeScript、边界情况、空文件）
3. 测试覆盖: `analyzeFile`、`resolveImports`、`extractCallGraph` 三个方法
4. 行号偏移验证: 确保提取结果的行号对应源文件中的实际位置

### 12.5 向后兼容

- 所有新增均为增量操作，不修改现有接口签名
- ReactExtractor 继承 TypeScriptExtractor，完全兼容现有 TS/JS 分析链路
- CssPlugin/HtmlPlugin 通过 `registerAllParsers()` 注册，不影响现有解析器
- `LanguageConfig` 的 `treeSitter` 字段为可选，CSS/HTML 不设此字段
- `extract-import-map.mjs` 的修改仅增加新的解析逻辑，不影响现有 TS/JS/Vue/Svelte 解析

## 13. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| PostCSS 解析 SCSS 不完整 | 低 | 部分 SCSS 语法无法提取 | postcss-scss 是成熟的 SCSS 语法解析器，覆盖率高 |
| LESS 文件解析受限 | 中 | LESS 特有语法无法提取 | postcss-scss 不解析 LESS 语法，LESS 以普通 CSS 回退解析；后续可引入 postcss-less 扩展 |
| node-html-parser 解析大文件性能 | 低 | 大 HTML 文件解析变慢 | HTML 文件通常较小；可设置文件大小上限 |
| ReactExtractor 误识别 hooks | 中 | 非 React hook 函数被标记 | 仅当从 'react' 或自定义 hook 文件导入时标记 |
| ReactExtractor 误识别组件 | 中 | PascalCase 普通函数被标记 | 结合 JSX 返回值检测 + import 来源验证 |
| Nuxt/SvelteKit 检测误报 | 低 | 非 Nuxt/SvelteKit 项目被错误识别 | 检测关键词包含 @nuxt/ 和 @sveltejs/kit 包名 |
| Vue/Svelte style 块分析行号偏移 | 中 | style 规则行号不准确 | 单元测试覆盖行号偏移场景 |
| CSS-in-JS 模式识别不完整 | 中 | 部分模式未覆盖 | 优先覆盖最流行的 3 种方案，后续迭代补充 |
