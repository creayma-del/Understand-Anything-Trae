# P1: 可落地执行计划方案

> 版本: 1.0
> 日期: 2026-06-05
> 状态: 已评审（修复 HIGH 问题后）
> 前置: P0（Vue SFC / Svelte / SCSS 增强 / Python 移除）已完成
> 关联设计文档: [p1-frontend-ecosystem-deepening.md](./p1-frontend-ecosystem-deepening.md)

## 1. 前置验证

| 验证项 | 验证方法 | 预期结果 | 状态 |
|---|---|---|---|
| `postcss` + `postcss-scss` 可用性 | `npm info postcss postcss-scss` | 纯 JS 包，Node.js 可用 | 待验证 |
| `node-html-parser` 可用性 | `npm info node-html-parser` | 纯 JS 包，轻量级 | 待验证 |
| PostCSS 解析 SCSS 完整性 | 编写 PoC 脚本解析含 @mixin/@use/@extend 的 SCSS | AST 正确提取 | 待验证 |
| node-html-parser 解析 HTML 完整性 | 编写 PoC 脚本解析含 script/link 的 HTML | DOM 树正确提取 | 待验证 |
| ReactExtractor 继承 TypeScriptExtractor 可行性 | 编写 PoC 继承 + super 调用 | 编译通过 + 基础提取正常 | 待验证 |
| CssPlugin 注入 VueSfcPlugin 可行性 | 架构分析 | registerAllParsers 扩展参数 | 待验证 |

## 2. 实施阶段划分

### 阶段 1: P1.1 CSS/SCSS 解析器 + P1.2 HTML 解析器（可并行）

**原因**: 无外部 Plugin 依赖，纯新增，风险最低。CSS 和 HTML 解析器互不依赖，可并行实施。

#### P1.1 CSS/SCSS 解析器

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 1.1.1 | 安装 `postcss` + `postcss-scss` | `package.json` | 依赖安装成功 |
| 1.1.2 | 创建 CssPlugin | `parsers/css-parser.ts` | 实现 AnalyzerPlugin 接口 |
| 1.1.3 | 注册 CssPlugin | `parsers/index.ts` | `registerAllParsers` 注册 CssPlugin |
| 1.1.4 | 修改 CSS 语言配置 | `configs/css.ts` | 添加注释说明 CssPlugin 替代 tree-sitter |
| 1.1.5 | 修改导入解析 | `extract-import-map.mjs` | CSS @import/@use/@forward 解析 |
| 1.1.6 | 修改语言映射 | `scan-project.mjs` | CSS 扩展名映射验证 |
| 1.1.7 | 编写单元测试 | `__tests__/css-parser.test.ts` | 测试全部通过 |
| 1.1.8 | 运行全量测试 | — | `pnpm test` 全部通过 |

#### P1.2 HTML 解析器

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 1.2.1 | 安装 `node-html-parser` | `package.json` | 依赖安装成功 |
| 1.2.2 | 创建 HtmlPlugin | `parsers/html-parser.ts` | 实现 AnalyzerPlugin 接口 |
| 1.2.3 | 注册 HtmlPlugin | `parsers/index.ts` | `registerAllParsers` 注册 HtmlPlugin |
| 1.2.4 | 修改 HTML 语言配置 | `configs/html.ts` | 添加注释说明 HtmlPlugin 替代 tree-sitter |
| 1.2.5 | 修改导入解析 | `extract-import-map.mjs` | HTML script/link 引用解析 |
| 1.2.6 | 编写单元测试 | `__tests__/html-parser.test.ts` | 测试全部通过 |
| 1.2.7 | 运行全量测试 | — | `pnpm test` 全部通过 |

### 阶段 2: P1.3 Vue/Svelte 解析器测试补全

**原因**: 不依赖新功能，仅为现有插件补全测试，可与阶段 1 并行。

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 2.1 | 编写 Vue SFC 解析器测试 | `__tests__/vue-sfc-parser.test.ts` | 10 个测试场景全部通过 |
| 2.2 | 编写 Svelte 解析器测试 | `__tests__/svelte-parser.test.ts` | 8 个测试场景全部通过 |
| 2.3 | 运行全量测试 | — | `pnpm test` 全部通过 |

### 阶段 3: P1.4 React JSX 语义提取器

**原因**: 依赖阶段 1 完成（需要 CssPlugin 用于后续 CSS-in-JS），但核心功能不依赖 CssPlugin。

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 3.1 | 创建 ReactExtractor | `extractors/react-extractor.ts` | 继承 TypeScriptExtractor |
| 3.2 | 实现 hooks 识别 | `extractors/react-extractor.ts` | useState/useEffect 等标记为 hook |
| 3.3 | 实现组件声明识别 | `extractors/react-extractor.ts` | PascalCase + JSX 返回 → component |
| 3.4 | 实现 JSX 组件组合 | `extractors/react-extractor.ts` | `<ChildComponent />` → contains 边 |
| 3.5 | 实现 Context 关系 | `extractors/react-extractor.ts` | createContext/useContext → depends_on |
| 3.6 | 实现 HOC 包装识别 | `extractors/react-extractor.ts` | withRouter/connect/memo → depends_on |
| 3.7 | 替换 TypeScriptExtractor 注册 | `extractors/index.ts` | builtinExtractors 使用 ReactExtractor |
| 3.8 | 编写单元测试 | `__tests__/react-extractor.test.ts` | 测试全部通过 |
| 3.9 | 运行全量测试 | — | `pnpm test` 全部通过 |

### 阶段 4: P1.5 Nuxt + P1.6 SvelteKit 框架配置（可并行）

**原因**: 纯配置新增，不依赖代码变更，可与阶段 3 并行。

#### P1.5 Nuxt 框架配置

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 4.1.1 | 创建 Nuxt 框架配置 | `frameworks/nuxt.ts` | 配置对象符合 FrameworkConfig schema |
| 4.1.2 | 注册 Nuxt 配置 | `frameworks/index.ts` | `builtinFrameworkConfigs` 包含 nuxtConfig |
| 4.1.3 | 创建 Nuxt Skill 文档 | `frameworks/nuxt.md` | 文档内容完整 |
| 4.1.4 | 编写框架检测测试 | `__tests__/framework-registry.test.ts` | Nuxt 检测通过 |
| 4.1.5 | 运行全量测试 | — | `pnpm test` 全部通过 |

#### P1.6 SvelteKit 框架配置

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 4.2.1 | 创建 SvelteKit 框架配置 | `frameworks/sveltekit.ts` | 配置对象符合 FrameworkConfig schema |
| 4.2.2 | 注册 SvelteKit 配置 | `frameworks/index.ts` | `builtinFrameworkConfigs` 包含 sveltekitConfig |
| 4.2.3 | 创建 SvelteKit Skill 文档 | `frameworks/sveltekit.md` | 文档内容完整 |
| 4.2.4 | 编写框架检测测试 | `__tests__/framework-registry.test.ts` | SvelteKit 检测通过 |
| 4.2.5 | 运行全量测试 | — | `pnpm test` 全部通过 |

### 阶段 5: P1.7 Vue/Svelte style 块分析 + P1.8 CSS-in-JS 支持

**原因**: 依赖阶段 1（CssPlugin）和阶段 3（ReactExtractor）完成。

#### P1.7 Vue/Svelte style 块分析

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 5.1.1 | 扩展 registerAllParsers 签名 | `parsers/index.ts` | 接受 cssPlugin 参数 |
| 5.1.2 | 扩展 VueSfcPlugin 提取 style 块 | `parsers/vue-sfc-parser.ts` | 委托 cssPlugin.analyzeFile() |
| 5.1.3 | 扩展 SveltePlugin 提取 style 块 | `parsers/svelte-parser.ts` | 委托 cssPlugin.analyzeFile() |
| 5.1.4 | 行号偏移修正 | `parsers/vue-sfc-parser.ts` + `svelte-parser.ts` | style 块行号正确 |
| 5.1.5 | 编写 style 块测试 | `__tests__/vue-sfc-parser.test.ts` + `svelte-parser.test.ts` | 新增测试通过 |
| 5.1.6 | 运行全量测试 | — | `pnpm test` 全部通过 |

#### P1.8 CSS-in-JS 支持

| 步骤 | 任务 | 产出文件 | 验证方式 |
|---|---|---|---|
| 5.2.1 | 扩展 ReactExtractor CSS-in-JS 识别 | `extractors/react-extractor.ts` | styled/emotion/styled-jsx 标记 |
| 5.2.2 | 创建 CSS-in-JS Skill 文档 | `languages/css-in-js.md` | 文档内容完整 |
| 5.2.3 | 编写 CSS-in-JS 测试 | `__tests__/react-extractor.test.ts` | 新增测试通过 |
| 5.2.4 | 运行全量测试 | — | `pnpm test` 全部通过 |

### 阶段 6: 集成验证

| 步骤 | 任务 | 验证方式 |
|---|---|---|
| 6.1 | 全量构建 | `pnpm build` 成功 |
| 6.2 | 全量测试 | `pnpm test` 全部通过 |
| 6.3 | Lint 检查 | `pnpm lint` 零 error |
| 6.4 | CSS 项目端到端测试 | 扫描含 SCSS/Tailwind 的项目，验证 CSS 文件被正确分析 |
| 6.5 | React 项目端到端测试 | 扫描含 React hooks/组件的项目，验证语义提取正确 |
| 6.6 | Nuxt 项目端到端测试 | 扫描含 Nuxt 的项目，验证框架检测和层级映射 |
| 6.7 | 回归测试 | 扫描本项目自身，验证无退化 |

## 3. 每步骤详细实施规格

### 步骤 1.1.2: 创建 CssPlugin

**文件**: `packages/core/src/plugins/parsers/css-parser.ts`

**核心实现要点**:

1. `analyzeFile()`:
   - 根据 filePath 扩展名选择 PostCSS 语法（scss / css）
   - 调用 `postcss().process(content, { syntax })` 解析
   - 遍历 AST:
     - `Rule` 节点 → 提取选择器 → `cssRules`
     - `AtRule` 节点:
       - `@import` → `imports`
       - `@use` → `imports`（SCSS 模块系统）
       - `@forward` → `imports`（SCSS 模块系统）
       - `@mixin` → `cssRules` (type: 'mixin')
       - `@function` → `cssRules` (type: 'function')
       - `@media` → 递归遍历子规则
     - `Declaration` 节点:
       - `--*` 属性 → `cssRules` (type: 'variable')
       - `var(*)` 值 → `depends_on` 边
       - `@apply` → `depends_on` 边（Tailwind）

2. `resolveImports()`:
   - 提取 @import / @use / @forward 语句
   - SCSS 路径探测:
     ```
     @use "components/button" 探测顺序:
     1. components/button.scss
     2. components/button.sass
     3. components/_button.scss
     4. components/_button.sass
     5. components/button/index.scss
     6. components/button/_index.scss
     7. components/button.css
     ```
   - CSS @import 路径探测:
     ```
     @import "theme" 探测顺序:
     1. theme.css
     2. theme.scss
     ```

3. **降级处理**: PostCSS 解析失败时返回空 StructuralAnalysis + 错误日志

### 步骤 1.2.2: 创建 HtmlPlugin

**文件**: `packages/core/src/plugins/parsers/html-parser.ts`

**核心实现要点**:

1. `analyzeFile()`:
   - 调用 `parse(content)` 解析 HTML
   - 遍历 DOM 树:
     - `<script src="...">` → `imports`
     - `<link rel="stylesheet" href="...">` → `imports`
     - `<link rel="modulepreload" href="...">` → `imports`
     - `<link rel="icon" href="...">` → `related`
     - 语义标签 → `htmlElements`
     - 内联 `<script>` → `sections`
     - 内联 `<style>` → `sections`
     - `<meta>` → `sections`

2. `resolveImports()`:
   - 提取 script/link 引用
   - 解析相对路径

3. **降级处理**: HTML 解析失败时返回空 StructuralAnalysis

### 步骤 3.1-3.6: 创建 ReactExtractor

**文件**: `packages/core/src/plugins/extractors/react-extractor.ts`

**核心实现要点**:

1. 继承 TypeScriptExtractor:
   ```typescript
   export class ReactExtractor extends TypeScriptExtractor {
     languageIds = ['typescript', 'javascript'];

     extractStructure(tree: Tree, source: string): ExtractionResult {
       const result = super.extractStructure(tree, source);
       this.identifyHooks(result);
       this.identifyComponents(result, source);
       this.identifyJsxComposition(result, source);
       this.identifyContextRelations(result);
       this.identifyHocPatterns(result);
       return result;
     }
   }
   ```

2. `identifyHooks()`:
   - 扫描 `result.functions`，检查函数名是否匹配 `use[A-Z]` 模式
   - 交叉验证: 检查 `result.imports` 中是否有从 'react' 导入的 hook
   - 自定义 hook: 检查是否从 `use-*.ts` / `use-*.js` 文件导入
   - 标记: `function.tags.push('hook')`

3. `identifyComponents()`:
   - 规则 1: 函数名 PascalCase + 函数体包含 JSX 返回值
   - 规则 2: 函数名 PascalCase + React.FC 类型注解
   - 规则 3: forwardRef/memo 包裹
   - 标记: `function.tags.push('component')`

4. `identifyJsxComposition()`:
   - 扫描源码中的 `<PascalCase` 模式
   - 交叉验证: 检查 PascalCase 名称是否出现在 `result.imports` 中
   - 生成: `contains` 边（父组件 → 子组件）

5. `identifyContextRelations()`:
   - 扫描 `createContext` 调用 → 标记为 context 定义
   - 扫描 `useContext` 调用 → 标记为 context 消费
   - 生成: `depends_on` 边（消费者 → 定义者）

6. `identifyHocPatterns()`:
   - 扫描 `withRouter`/`connect`/`memo`/`forwardRef` 包裹
   - 标记: `function.tags.push('hoc-wrapped')`
   - 生成: `depends_on` 边（组件 → HOC）

### 步骤 5.1.2-5.1.3: 扩展 Vue/Svelte style 块分析

**文件**: `packages/core/src/plugins/parsers/vue-sfc-parser.ts` + `svelte-parser.ts`

**核心实现要点**:

1. VueSfcPlugin 扩展:
   ```typescript
   // analyzeFile() 中新增:
   if (this.cssPlugin && descriptor.styles.length > 0) {
     for (const styleBlock of descriptor.styles) {
       const styleResult = this.cssPlugin.analyzeFile(
         `${filePath}#style`,
         styleBlock.content
       );
       // 行号偏移修正
       const styleOffset = styleBlock.loc.start.line - 1;
       // 合并到主结果
       this.mergeStyleAnalysis(result, styleResult, styleOffset, {
         scoped: styleBlock.scoped,
         module: styleBlock.module != null,
       });
     }
   }
   ```

2. SveltePlugin 扩展:
   ```typescript
   // analyzeFile() 中新增:
   if (this.cssPlugin && ast.css) {
     const styleContent = ast.css.content;
     const styleResult = this.cssPlugin.analyzeFile(
       `${filePath}#style`,
       styleContent
     );
     // 行号偏移修正
     const styleOffset = content.slice(0, ast.css.start).split('\n').length - 1;
     this.mergeStyleAnalysis(result, styleResult, styleOffset, {
       scoped: true, // Svelte style 默认 scoped
     });
   }
   ```

3. `mergeStyleAnalysis()`:
   - 合并 cssRules（偏移修正）
   - 合并 imports（偏移修正）
   - 添加 scoped-style / css-modules 标签
   - 识别 Vue `v-bind()` in CSS → depends_on 边

## 4. 依赖关系图

```
阶段 1 (P1.1 CSS + P1.2 HTML)     阶段 2 (P1.3 测试补全)
  │                                   │
  │ 需要 postcss + postcss-scss       │ 无新依赖
  │ 需要 node-html-parser             │
  │                                   │
  ├───────────────┬───────────────────┤
  │               │                   │
  ▼               ▼                   ▼
阶段 3 (P1.4 React)     阶段 4 (P1.5 Nuxt + P1.6 SvelteKit)
  │                       │
  │ 需要 ReactExtractor   │ 纯配置新增
  │                       │
  ├───────────────────────┤
  │                       │
  ▼                       ▼
阶段 5 (P1.7 style 块 + P1.8 CSS-in-JS)
  │
  │ 需要 CssPlugin (阶段 1)
  │ 需要 ReactExtractor (阶段 3)
  │
  ▼
阶段 6 (集成验证)
```

**并行策略**:
- 阶段 1 + 阶段 2 可并行
- 阶段 3 + 阶段 4 可并行
- 阶段 5 必须在阶段 1 + 阶段 3 完成后

## 5. 文件变更总览

| 操作 | 文件 | 阶段 | 优先级 |
|---|---|---|---|
| **新增** | `packages/core/src/plugins/parsers/css-parser.ts` | 1 | P0 |
| **新增** | `packages/core/src/plugins/parsers/html-parser.ts` | 1 | P0 |
| 修改 | `packages/core/src/plugins/parsers/index.ts` | 1+5 | P0 |
| 修改 | `packages/core/src/languages/configs/css.ts` | 1 | P0 |
| 修改 | `packages/core/src/languages/configs/html.ts` | 1 | P0 |
| 修改 | `packages/core/package.json` | 1 | P0 |
| 修改 | `skills/understand/extract-import-map.mjs` | 1 | P0 |
| 修改 | `skills/understand/scan-project.mjs` | 1 | P0 |
| **新增** | `packages/core/src/plugins/parsers/__tests__/css-parser.test.ts` | 1 | P0 |
| **新增** | `packages/core/src/plugins/parsers/__tests__/html-parser.test.ts` | 1 | P0 |
| **新增** | `packages/core/src/plugins/parsers/__tests__/vue-sfc-parser.test.ts` | 2 | P0 |
| **新增** | `packages/core/src/plugins/parsers/__tests__/svelte-parser.test.ts` | 2 | P0 |
| **新增** | `packages/core/src/plugins/extractors/react-extractor.ts` | 3 | P1 |
| 修改 | `packages/core/src/plugins/extractors/index.ts` | 3 | P1 |
| **新增** | `packages/core/src/plugins/extractors/__tests__/react-extractor.test.ts` | 3 | P1 |
| **新增** | `packages/core/src/languages/frameworks/nuxt.ts` | 4 | P1 |
| **新增** | `packages/core/src/languages/frameworks/sveltekit.ts` | 4 | P1 |
| 修改 | `packages/core/src/languages/frameworks/index.ts` | 4 | P1 |
| **新增** | `skills/understand/frameworks/nuxt.md` | 4 | P1 |
| **新增** | `skills/understand/frameworks/sveltekit.md` | 4 | P1 |
| 修改 | `packages/core/src/languages/frameworks/__tests__/framework-registry.test.ts` | 4 | P1 |
| 修改 | `packages/core/src/plugins/parsers/vue-sfc-parser.ts` | 5 | P2 |
| 修改 | `packages/core/src/plugins/parsers/svelte-parser.ts` | 5 | P2 |
| 修改 | `packages/core/src/plugins/parsers/__tests__/vue-sfc-parser.test.ts` | 5 | P2 |
| 修改 | `packages/core/src/plugins/parsers/__tests__/svelte-parser.test.ts` | 5 | P2 |
| **新增** | `skills/understand/languages/css-in-js.md` | 5 | P2 |

**总计**: 新增 12 个文件，修改 12 个文件。

## 6. 测试覆盖方案

### 6.1 P1.1 CSS/SCSS 解析器测试

**文件**: `packages/core/src/plugins/parsers/__tests__/css-parser.test.ts`

| 测试用例 | 输入 | 预期 |
|---|---|---|
| `CSS-001` 基础 CSS 规则提取 | `.btn { color: red; display: flex; }` | cssRules 包含 1 条规则，selector=".btn"，declarations=["color","display"] |
| `CSS-002` CSS 变量定义 | `:root { --primary: #333; }` | cssRules 包含 1 条 variable 类型规则 |
| `CSS-003` CSS 变量引用 | `.btn { color: var(--primary); }` | depends_on 边指向 --primary |
| `CSS-004` @import 解析 | `@import "theme.css";` | imports 包含 source="theme.css" |
| `CSS-005` SCSS @use 解析 | `@use "components/button";` | imports 包含 source="components/button" |
| `CSS-006` SCSS @forward 解析 | `@forward "components/button";` | imports 包含 source="components/button" |
| `CSS-007` SCSS @mixin 定义 | `@mixin flex-center { display: flex; align-items: center; }` | cssRules 包含 1 条 mixin 类型规则 |
| `CSS-008` SCSS @include 引用 | `.btn { @include flex-center; }` | depends_on 边指向 flex-center mixin |
| `CSS-009` SCSS @function 定义 | `@function rem($px) { @return $px / 16 * 1rem; }` | cssRules 包含 1 条 function 类型规则 |
| `CSS-010` SCSS @extend 继承 | `.btn-primary { @extend .btn; }` | inherits 边指向 .btn |
| `CSS-011` Tailwind @apply | `.btn { @apply flex items-center; }` | depends_on 边标记 tailwind-apply |
| `CSS-012` @media 嵌套规则 | `@media (max-width: 768px) { .btn { font-size: 14px; } }` | cssRules 包含嵌套规则 |
| `CSS-013` SCSS partial 路径探测 | `@use "components/button"` | resolveImports 探测 _button.scss |
| `CSS-014` 空文件 | `` | 返回空 StructuralAnalysis |
| `CSS-015` 语法错误文件 | `.btn { color: }` | 返回空 StructuralAnalysis，不抛异常 |
| `CSS-016` 多选择器规则 | `.btn, .link { color: blue; }` | selector=".btn, .link" |
| `CSS-017` 嵌套规则 (SCSS) | `.card { &-title { font-size: 16px; } }` | 正确提取嵌套规则 |
| `CSS-018` @tailwind 指令 | `@tailwind base; @tailwind components;` | depends_on 边标记 tailwind |

### 6.2 P1.2 HTML 解析器测试

**文件**: `packages/core/src/plugins/parsers/__tests__/html-parser.test.ts`

| 测试用例 | 输入 | 预期 |
|---|---|---|
| `HTML-001` 基础 HTML 结构 | `<html><head></head><body></body></html>` | htmlElements 包含 html/head/body |
| `HTML-002` script src 引用 | `<script src="app.js"></script>` | imports 包含 source="app.js" |
| `HTML-003` link stylesheet 引用 | `<link rel="stylesheet" href="style.css">` | imports 包含 source="style.css" |
| `HTML-004` 语义标签 | `<header><nav><main><article><footer>` | htmlElements 包含所有语义标签 |
| `HTML-005` 内联 script | `<script>console.log('hi')</script>` | sections 包含 script 内容 |
| `HTML-006` 内联 style | `<style>.btn { color: red; }</style>` | sections 包含 style 内容 |
| `HTML-007` meta 标签 | `<meta charset="UTF-8">` | sections 包含 meta 信息 |
| `HTML-008` 多 script 引用 | 多个 `<script src>` | imports 包含所有引用 |
| `HTML-009` 空文件 | `` | 返回空 StructuralAnalysis |
| `HTML-010` modulepreload | `<link rel="modulepreload" href="chunk.js">` | imports 包含 source="chunk.js" |
| `HTML-011` 自闭合标签 | `<img src="photo.jpg" />` | htmlElements 包含 img，isSelfClosing=true |
| `HTML-012` 属性提取 | `<div id="app" class="container">` | attributes 包含 id 和 class |

### 6.3 P1.3 Vue SFC 解析器测试

**文件**: `packages/core/src/plugins/parsers/__tests__/vue-sfc-parser.test.ts`

| 测试用例 | 输入 | 预期 |
|---|---|---|
| `VUE-001` script setup 提取 | `<script setup>const x = ref(0)</script>` | functions 包含 x，行号偏移正确 |
| `VUE-002` 普通 script | `<script>export default { data() {} }</script>` | functions 包含 data |
| `VUE-003` TypeScript script setup | `<script setup lang="ts">const x: Ref<number> = ref(0)</script>` | TypeScript 解析正确 |
| `VUE-004` template 组件引用 | `<template><ChildComponent /></template>` | imports 包含 ChildComponent |
| `VUE-005` template + script 去重 | script import + template 同名组件 | imports 不重复 |
| `VUE-006` 空文件 | `<template></template>` | 返回空分析，无报错 |
| `VUE-007` 无 script | 仅 `<template>` + `<style>` | 返回空函数/类/导入 |
| `VUE-008` 多行偏移修正 | script 从第 10 行开始 | 函数行号 = 原始行号 + 9 |
| `VUE-009` 降级守卫 | tsPlugin 未初始化 | 返回空分析 + template 组件引用 |
| `VUE-010` defineProps/defineEmits | `<script setup>defineProps({})</script>` | 识别为函数调用 |

### 6.4 P1.3 Svelte 解析器测试

**文件**: `packages/core/src/plugins/parsers/__tests__/svelte-parser.test.ts`

| 测试用例 | 输入 | 预期 |
|---|---|---|
| `SVT-001` 基础 instance script | `<script>let count = 0</script>` | 提取 count 变量 |
| `SVT-002` module script | `<script context="module">export const loader = () => {}</script>` | 提取 loader 导出 |
| `SVT-003` TypeScript script | `<script lang="ts">let x: number = 0</script>` | TypeScript 解析正确 |
| `SVT-004` template 组件引用 | `<ChildComponent />` | imports 包含 ChildComponent |
| `SVT-005` 双 script 块 | instance + module script | 合并两个 script 的分析结果 |
| `SVT-006` 空文件 | 空内容 | 返回空分析，无报错 |
| `SVT-007` 字符偏移转行号 | script 从字符位置 100 开始 | 行号计算正确 |
| `SVT-008` 降级守卫 | tsPlugin 未初始化 | 返回空分析 + template 组件引用 |

### 6.5 P1.4 React JSX 语义提取器测试

**文件**: `packages/core/src/plugins/extractors/__tests__/react-extractor.test.ts`

| 测试用例 | 输入 | 预期 |
|---|---|---|
| `REACT-001` useState hook 识别 | `import { useState } from 'react'; function App() { const [x, setX] = useState(0); }` | useState 标记为 hook |
| `REACT-002` useEffect hook 识别 | `import { useEffect } from 'react'; function App() { useEffect(() => {}, []); }` | useEffect 标记为 hook |
| `REACT-003` 自定义 hook 识别 | `import { useAuth } from './useAuth'; function App() { useAuth(); }` | useAuth 标记为 hook |
| `REACT-004` 组件声明识别 | `function MyComponent() { return <div />; }` | MyComponent 标记为 component |
| `REACT-005` 箭头函数组件 | `const MyComponent = () => <div />;` | MyComponent 标记为 component |
| `REACT-006` forwardRef 组件 | `const MyComponent = forwardRef((props, ref) => <div />);` | MyComponent 标记为 component |
| `REACT-007` JSX 组件组合 | `<ChildComponent />` + import 存在 | contains 边（App → ChildComponent） |
| `REACT-008` JSX 非 HTML 误判 | `<div />` | 不生成 contains 边（小写标签排除） |
| `REACT-009` Context 关系 | `const Ctx = createContext(); const v = useContext(Ctx);` | depends_on 边（consumer → provider） |
| `REACT-010` HOC 包装 | `export default withRouter(MyComponent);` | depends_on 边（MyComponent → withRouter） |
| `REACT-011` memo 包装 | `export default React.memo(MyComponent);` | depends_on 边（MyComponent → memo） |
| `REACT-012` 非 hook 误判 | `function useSomething() {}` 但未从 react/hook 文件导入 | 不标记为 hook |
| `REACT-013` 非 component 误判 | `function MyHelper() { return calculate(); }` | 不标记为 component（无 JSX 返回） |
| `REACT-014` 基础 TS 提取兼容 | 普通 TS 文件 | 与 TypeScriptExtractor 结果一致 |
| `REACT-015` CSS-in-JS styled | `const Btn = styled.button\`color: red\`;` | Btn 标记为 styled-component + css-in-js |
| `REACT-016` CSS-in-JS emotion | `const style = css\`color: red\`;` | 标记为 css-in-js + emotion |
| `REACT-017` CSS-in-JS styled-jsx | `<style jsx>{\`.btn { color: red; }\`}</style>` | 标记为 css-in-js + styled-jsx |

### 6.6 P1.5/P1.6 框架检测测试

**文件**: `packages/core/src/languages/frameworks/__tests__/framework-registry.test.ts`（扩展）

| 测试用例 | 输入 | 预期 |
|---|---|---|
| `FW-001` Nuxt 检测 | package.json 含 `"nuxt": "^3.0"` | 检测为 Nuxt 框架 |
| `FW-002` Nuxt 检测 @nuxt/ | package.json 含 `"@nuxt/content": "^1.0"` | 检测为 Nuxt 框架 |
| `FW-003` SvelteKit 检测 | package.json 含 `"@sveltejs/kit": "^2.0"` | 检测为 SvelteKit 框架 |
| `FW-004` SvelteKit 检测 adapter | package.json 含 `"@sveltejs/adapter-node": "^3.0"` | 检测为 SvelteKit 框架 |
| `FW-005` Nuxt 层级映射 | `pages/index.vue` | 映射为 ui 层 |
| `FW-006` Nuxt 层级映射 | `server/api/users.ts` | 映射为 api 层 |
| `FW-007` SvelteKit 层级映射 | `src/routes/+page.svelte` | 映射为 ui 层 |
| `FW-008` SvelteKit 层级映射 | `src/lib/components/Button.svelte` | 映射为 ui 层 |

### 6.7 P1.7 style 块分析测试

**文件**: 扩展 `vue-sfc-parser.test.ts` + `svelte-parser.test.ts`

| 测试用例 | 输入 | 预期 |
|---|---|---|
| `STYLE-001` Vue scoped style | `<style scoped>.btn { color: red; }</style>` | cssRules 提取 + scoped-style 标签 |
| `STYLE-002` Vue CSS Modules | `<style module>.btn { color: red; }</style>` | cssRules 提取 + css-modules 标签 |
| `STYLE-003` Vue v-bind() in CSS | `<style>.btn { color: v-bind(primaryColor); }</style>` | depends_on 边指向 primaryColor |
| `STYLE-004` Svelte style | `<style>.btn { color: red; }</style>` | cssRules 提取 + scoped 标记 |
| `STYLE-005` Vue 多 style 块 | 2 个 `<style>` 块 | 合并两个 style 分析结果 |
| `STYLE-006` style 行号偏移 | style 从第 20 行开始 | cssRules 行号偏移正确 |

## 7. 验收标准

### P1.1 CSS/SCSS 解析器

- [ ] `.css` / `.scss` / `.sass` / `.less` 文件被 CssPlugin 正确分析
- [ ] CSS 选择器规则被提取到 `cssRules`
- [ ] CSS 变量定义/引用被提取
- [ ] `@import` / `@use` / `@forward` 被提取到 `imports`
- [ ] `@mixin` / `@include` 被提取，`depends_on` 边正确
- [ ] `@extend` 继承关系被提取
- [ ] SCSS partial 路径探测正确（`_` 前缀 + 扩展名探测）
- [ ] Tailwind `@apply` / `@tailwind` 被识别
- [ ] 语法错误文件不抛异常，返回空分析
- [ ] 18 个单元测试全部通过

### P1.2 HTML 解析器

- [ ] `.html` / `.htm` 文件被 HtmlPlugin 正确分析
- [ ] `<script src>` / `<link rel="stylesheet">` 被提取到 `imports`
- [ ] 语义标签结构被提取到 `htmlElements`
- [ ] 内联 script/style 被提取到 `sections`
- [ ] 12 个单元测试全部通过

### P1.3 Vue/Svelte 测试补全

- [ ] Vue SFC 解析器 10 个单元测试全部通过
- [ ] Svelte 解析器 8 个单元测试全部通过
- [ ] 行号偏移修正验证通过
- [ ] 降级守卫验证通过

### P1.4 React JSX 语义提取器

- [ ] React hooks（useState/useEffect/useCallback/useMemo/useRef/useContext）被标记为 `hook`
- [ ] 自定义 hook（use[A-Z] + 从 hook 文件导入）被标记
- [ ] React 组件（PascalCase + JSX 返回）被标记为 `component`
- [ ] JSX 组件组合生成 `contains` 边
- [ ] Context 关系生成 `depends_on` 边
- [ ] HOC 包装生成 `depends_on` 边
- [ ] 非 hook / 非 component 不被误判
- [ ] 与 TypeScriptExtractor 完全兼容（无退化）
- [ ] 17 个单元测试全部通过

### P1.5 Nuxt 框架配置

- [ ] Nuxt 框架检测正确（nuxt / @nuxt/ 关键词）
- [ ] Nuxt 目录层级映射正确
- [ ] Nuxt Skill 文档内容完整
- [ ] 框架检测测试通过

### P1.6 SvelteKit 框架配置

- [ ] SvelteKit 框架检测正确（@sveltejs/kit / @sveltejs/adapter- 关键词）
- [ ] SvelteKit 目录层级映射正确
- [ ] SvelteKit Skill 文档内容完整
- [ ] 框架检测测试通过

### P1.7 Vue/Svelte style 块分析

- [ ] Vue `<style scoped>` 被提取并标记
- [ ] Vue `<style module>` 被提取并标记
- [ ] Vue `v-bind()` in CSS 生成 `depends_on` 边
- [ ] Svelte `<style>` 被提取并标记为 scoped
- [ ] style 块行号偏移修正正确
- [ ] 6 个新增测试全部通过

### P1.8 CSS-in-JS 支持

- [ ] styled-components 模式被识别
- [ ] Emotion 模式被识别
- [ ] styled-jsx 模式被识别
- [ ] CSS-in-JS Skill 文档内容完整
- [ ] 3 个新增测试通过

### 集成验收

- [ ] `pnpm build` 成功
- [ ] `pnpm test` 全部通过
- [ ] `pnpm lint` 零 error
- [ ] 扫描含 SCSS/Tailwind 的项目，知识图谱包含 CSS 文件节点（含选择器/变量/导入）
- [ ] 扫描含 React 的项目，知识图谱包含 hooks/组件标记和组合边
- [ ] 扫描含 Nuxt 的项目，框架检测和层级映射正确
- [ ] 扫描含 SvelteKit 的项目，框架检测和层级映射正确
- [ ] 扫描本项目自身，无退化

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 | 决策点 |
|---|---|---|---|---|
| PostCSS 解析 SCSS 不完整 | 低 | 部分 SCSS 语法无法提取 | postcss-scss 成熟度高；降级返回空分析 | 实施时验证 |
| node-html-parser 解析大文件性能 | 低 | 大 HTML 文件解析变慢 | HTML 文件通常较小；可设文件大小上限 | 实施时评估 |
| ReactExtractor 误识别 hooks | 中 | 非 React hook 函数被标记 | 仅当从 'react' 或 hook 文件导入时标记 | 实施时调优 |
| ReactExtractor 误识别组件 | 中 | PascalCase 普通函数被标记 | 结合 JSX 返回值 + import 来源验证 | 实施时调优 |
| ReactExtractor 继承兼容性 | 低 | 现有 TS/JS 分析退化 | ReactExtractor 继承 TypeScriptExtractor，super 调用 | 实施时验证 |
| Nuxt/SvelteKit 检测误报 | 低 | 非 Nuxt/SvelteKit 项目被错误识别 | 检测关键词包含包名，降低误报 | 实施时验证 |
| Vue/Svelte style 块行号偏移 | 中 | style 规则行号不准确 | 单元测试覆盖行号偏移场景 | 实施时验证 |
| CSS-in-JS 模式识别不完整 | 中 | 部分模式未覆盖 | 优先覆盖最流行的 3 种方案 | 后续迭代 |
| 共享文件修改冲突 | 低 | 阶段间修改同一文件 | 按阶段顺序执行，合并共享修改 | 实施策略 |

## 9. 依赖变更汇总

| npm 包 | 版本 | 用途 | 阶段 |
|---|---|---|---|
| `postcss` | ^8.5.0 | CSS AST 解析 | 1 |
| `postcss-scss` | ^4.0.0 | SCSS 语法支持 | 1 |
| `node-html-parser` | ^7.0.0 | HTML DOM 解析 | 1 |

**总计新增 3 个运行时依赖**（不含 devDependencies）。

## 10. 时间线估算（仅供参考）

| 阶段 | 内容 | 可并行 |
|---|---|---|
| 阶段 1 | CSS/HTML 解析器 | ✅ 与阶段 2 并行 |
| 阶段 2 | Vue/Svelte 测试补全 | ✅ 与阶段 1 并行 |
| 阶段 3 | React JSX 语义提取器 | ✅ 与阶段 4 并行 |
| 阶段 4 | Nuxt/SvelteKit 框架配置 | ✅ 与阶段 3 并行 |
| 阶段 5 | style 块 + CSS-in-JS | ❌ 依赖阶段 1+3 |
| 阶段 6 | 集成验证 | ❌ 依赖全部阶段 |
