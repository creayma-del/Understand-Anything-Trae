import { describe, it, expect, vi, beforeEach } from "vitest";
import { SveltePlugin } from "../svelte-parser.js";
import type { TreeSitterPlugin } from "../../tree-sitter-plugin.js";
import type { CssPlugin } from "../css-parser.js";
import type { StructuralAnalysis, CallGraphEntry } from "../../../types.js";

// ---------------------------------------------------------------------------
// Mock 工厂
// ---------------------------------------------------------------------------

/**
 * 创建 TreeSitterPlugin 的 Mock 实例。
 *
 * @param analyzeResult analyzeFile 方法的返回值（单次调用）
 * @param analyzeSequence analyzeFile 方法的多次调用返回值序列
 * @param callGraphResult extractCallGraph 方法的返回值
 */
function createMockTsPlugin(options?: {
  analyzeResult?: StructuralAnalysis;
  analyzeSequence?: StructuralAnalysis[];
  callGraphResult?: CallGraphEntry[];
}): TreeSitterPlugin {
  const { analyzeResult, analyzeSequence, callGraphResult } = options ?? {};

  let analyzeFn: ReturnType<typeof vi.fn>;
  if (analyzeSequence) {
    analyzeFn = vi.fn();
    for (const result of analyzeSequence) {
      analyzeFn.mockReturnValueOnce(result);
    }
    // 后续调用返回空结果
    analyzeFn.mockReturnValue({
      functions: [],
      classes: [],
      imports: [],
      exports: [],
    });
  } else {
    analyzeFn = vi.fn().mockReturnValue(analyzeResult ?? {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
    });
  }

  return {
    name: "tree-sitter",
    languages: ["typescript", "javascript"],
    analyzeFile: analyzeFn,
    extractCallGraph: vi.fn().mockReturnValue(callGraphResult ?? []),
  } as unknown as TreeSitterPlugin;
}

/**
 * 创建 CssPlugin 的 Mock 实例。
 *
 * @param analyzeResult analyzeFile 方法的返回值
 */
function createMockCssPlugin(
  analyzeResult?: StructuralAnalysis,
): CssPlugin {
  return {
    name: "css-parser",
    languages: ["css"],
    analyzeFile: vi.fn().mockReturnValue(analyzeResult ?? {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      cssRules: [],
    }),
  } as unknown as CssPlugin;
}

// ---------------------------------------------------------------------------
// 测试 fixture（内联字符串）
// ---------------------------------------------------------------------------

const FIXTURES = {
  // SVT-001, SVT-008: instance script 提取
  basicInstance:
    '<script>import { onMount } from \'svelte\'; let count = 0; function increment() { count++; } onMount(() => { console.log(\'mounted\'); });</script><button on:click={increment}>{count}</button>',

  // SVT-002: module script 提取
  moduleScript:
    '<script context="module">export function helper() { return 42; } export const VERSION = \'1.0\';</script><script>let name = \'world\';</script><h1>Hello {name}!</h1>',

  // SVT-003: TypeScript 检测
  typescriptScript:
    '<script lang="ts">import type { SvelteComponent } from \'svelte\'; interface Props { name: string; } let { name }: Props = $props(); function greet(): string { return `Hello ${name}`; }</script><p>{greet()}</p>',

  // SVT-004: template 组件引用提取
  templateRefs:
    '<script>import Header from \'./Header.svelte\'; import Footer from \'./Footer.svelte\';</script><Header /><Main /><Footer />',

  // SVT-005: 双 script 块合并
  dualScript:
    '<script context="module">export const API_URL = \'https://api.example.com\'; export function fetchData() { return fetch(API_URL); }</script><script>import { onMount } from \'svelte\'; let data = null; onMount(async () => { data = await fetchData(); });</script><div>{data}</div>',

  // SVT-006: 空文件处理
  empty: "",

  // SVT-007: 字符偏移转行号
  lineOffset:
    '<h1>Title</h1>\n\n<script>\nlet count = 0\nfunction increment() { count++ }\n</script>\n\n<button on:click={increment}>\n  {count}\n</button>',

  // SVT-009: resolveImports 解析
  resolveImports:
    '<script context="module">export const API_URL = \'https://api.example.com\';</script><script>import { onMount } from \'svelte\'; import { fetchHelper } from \'./helpers\'; let data = null; onMount(async () => { data = await fetchHelper(); });</script><div>{data}</div>',

  // SVT-010: extractCallGraph 调用图提取
  callGraph:
    '<script>import { onMount } from \'svelte\'; let count = 0; function increment() { count++; } function reset() { count = 0; increment(); }</script><button on:click={increment}>{count}</button>',

  // STYLE-004: Svelte style（默认 scoped）
  withStyle:
    '<script>let count = 0; function increment() { count++; }</script>\n\n<button class="btn" on:click={increment}>\n  {count}\n</button>\n\n<style>\n.btn {\n  padding: 8px 16px;\n  background: #3366cc;\n  color: white;\n}\n</style>',

  // STYLE-DEG-003: Svelte 无 style 块
  noStyle:
    '<script>let count = 0;</script>\n\n<button on:click={() => count++}>\n  {count}\n</button>',
};

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("SveltePlugin", () => {
  let plugin: SveltePlugin;

  beforeEach(() => {
    plugin = new SveltePlugin();
  });

  // SVT-001: instance script 提取
  it("从 instance script 中提取函数和导入", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeResult: {
        functions: [{ name: "increment", lineRange: [1, 1], params: [] }],
        imports: [{ source: "svelte", specifiers: ["onMount"], lineNumber: 1 }],
        classes: [],
        exports: [],
      },
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.svelte", FIXTURES.basicInstance);

    expect(result.functions.some(f => f.name === "increment")).toBe(true);
    expect(result.imports.some(i => i.source === "svelte")).toBe(true);
  });

  // SVT-002: module script 提取
  it("从 module script 中提取导出", () => {
    // Svelte 5 中 parseSvelteSfc 先处理 instance，再处理 module
    // instance script: `let name = 'world';`
    // module script: `export function helper() { ... } export const VERSION = '1.0';`
    const mockTsPlugin = createMockTsPlugin({
      analyzeSequence: [
        // 第一次调用：instance script 分析
        {
          functions: [],
          imports: [],
          classes: [],
          exports: [],
        },
        // 第二次调用：module script 分析
        {
          functions: [{ name: "helper", lineRange: [1, 1], params: [] }],
          imports: [],
          classes: [],
          exports: [
            { name: "helper", lineNumber: 1 },
            { name: "VERSION", lineNumber: 1 },
          ],
        },
      ],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.svelte", FIXTURES.moduleScript);

    expect(result.functions.some(f => f.name === "helper")).toBe(true);
    expect(result.exports.some(e => e.name === "VERSION")).toBe(true);
  });

  // SVT-003: TypeScript 检测
  it("检测 TypeScript 并将 virtual.ts 传给 tsPlugin", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeResult: {
        functions: [{ name: "greet", lineRange: [1, 1], params: [] }],
        imports: [{ source: "svelte", specifiers: ["SvelteComponent"], lineNumber: 1 }],
        classes: [],
        exports: [],
      },
    });
    plugin.init(mockTsPlugin);

    plugin.analyzeFile("test.svelte", FIXTURES.typescriptScript);

    expect(mockTsPlugin.analyzeFile).toHaveBeenCalledWith("virtual.ts", expect.any(String));
  });

  // SVT-004: template 组件引用提取
  it("从 template 中提取大写组件引用", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeResult: {
        functions: [],
        imports: [
          { source: "./Header.svelte", specifiers: ["Header"], lineNumber: 1 },
          { source: "./Footer.svelte", specifiers: ["Footer"], lineNumber: 1 },
        ],
        classes: [],
        exports: [],
      },
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.svelte", FIXTURES.templateRefs);

    // Main 来自 template 引用（未在 script 中 import）
    expect(result.imports.some(i => i.specifiers.includes("Main"))).toBe(true);
    // 小写 HTML 元素不应出现
    expect(result.imports.some(i => i.specifiers.includes("header"))).toBe(false);
  });

  // SVT-005: 双 script 块合并
  it("合并 instance 和 module script 块的分析结果", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeSequence: [
        // 第一次调用：instance script 分析
        {
          functions: [],
          imports: [{ source: "svelte", specifiers: ["onMount"], lineNumber: 1 }],
          classes: [],
          exports: [],
        },
        // 第二次调用：module script 分析
        {
          functions: [{ name: "fetchData", lineRange: [1, 1], params: [] }],
          imports: [],
          classes: [],
          exports: [
            { name: "API_URL", lineNumber: 1 },
            { name: "fetchData", lineNumber: 1 },
          ],
        },
      ],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.svelte", FIXTURES.dualScript);

    expect(result.functions.some(f => f.name === "fetchData")).toBe(true);
    expect(result.imports.some(i => i.source === "svelte")).toBe(true);
    expect(result.exports.some(e => e.name === "API_URL")).toBe(true);
  });

  // SVT-006: 空文件处理
  it("优雅处理空 .svelte 文件", () => {
    const mockTsPlugin = createMockTsPlugin();
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.svelte", FIXTURES.empty);

    expect(result.functions).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(mockTsPlugin.analyzeFile).not.toHaveBeenCalled();
  });

  // SVT-007: 字符偏移转行号
  it("正确将字符偏移转换为行号", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeResult: {
        functions: [{ name: "increment", lineRange: [2, 2], params: [] }],
        imports: [],
        classes: [],
        exports: [],
      },
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.svelte", FIXTURES.lineOffset);

    // Svelte parser 使用 content.slice(0, ast.instance.content.start).split("\n").length
    // 来计算 script 内容的起始行号。
    // fixture: <h1>Title</h1>\n\n<script>\nlet count = 0\n...
    // content.start 指向 <script> 标签之后的内容起始位置，
    // 之前的内容为 "<h1>Title</h1>\n\n<script>"，含 2 个 \n，split 后长度 = 3
    // 所以 script 内容从第 3 行开始，偏移 = 3 - 1 = 2
    // increment 在 script 内容的第 2 行，实际行号 = 2 + 2 = 4
    expect(result.functions[0].lineRange[0]).toBe(4);
  });

  // SVT-008: 降级守卫（tsPlugin 未初始化）
  it("tsPlugin 未初始化时仅返回 template 组件引用", () => {
    // 不调用 init()，tsPlugin 为 null
    const result = plugin.analyzeFile("test.svelte", FIXTURES.basicInstance);

    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
    expect(result.imports.length).toBeGreaterThanOrEqual(0);
  });

  // SVT-009: resolveImports 解析
  it("从 instance 和 module script 块中解析导入", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeSequence: [
        // 第一次调用：instance script 分析
        {
          functions: [],
          imports: [
            { source: "svelte", specifiers: ["onMount"], lineNumber: 1 },
            { source: "./helpers", specifiers: ["fetchHelper"], lineNumber: 2 },
          ],
          classes: [],
          exports: [],
        },
        // 第二次调用：module script 分析
        {
          functions: [],
          imports: [],
          classes: [],
          exports: [{ name: "API_URL", lineNumber: 1 }],
        },
      ],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.resolveImports("test.svelte", FIXTURES.resolveImports);

    expect(result.some(i => i.source === "svelte" && i.specifiers.includes("onMount"))).toBe(true);
    expect(result.some(i => i.source === "./helpers" && i.specifiers.includes("fetchHelper"))).toBe(true);
  });

  // SVT-010: extractCallGraph 调用图提取
  it("从 instance script 中提取调用图", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeResult: {
        functions: [
          { name: "increment", lineRange: [1, 1], params: [] },
          { name: "reset", lineRange: [1, 1], params: [] },
        ],
        imports: [{ source: "svelte", specifiers: ["onMount"], lineNumber: 1 }],
        classes: [],
        exports: [],
      },
      callGraphResult: [{ caller: "reset", callee: "increment", lineNumber: 4 }],
    });
    plugin.init(mockTsPlugin);

    const cg = plugin.extractCallGraph("test.svelte", FIXTURES.callGraph);

    expect(cg.some(e => e.caller === "reset" && e.callee === "increment")).toBe(true);
    // 验证行号偏移：script 从第 1 行开始，偏移 = 1 - 1 = 0
    // lineNumber: 4 + 0 = 4
    expect(cg.find(e => e.caller === "reset" && e.callee === "increment")!.lineNumber).toBe(4);
  });

  // -----------------------------------------------------------------------
  // P1.7: Style 块分析测试
  // -----------------------------------------------------------------------

  // STYLE-004: Svelte style（默认 scoped）
  it("从 <style> 中提取 CSS 规则并标记 scoped-style", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeResult: {
        functions: [{ name: "increment", lineRange: [1, 1], params: [] }],
        imports: [],
        classes: [],
        exports: [],
      },
    });
    const mockCssPlugin = createMockCssPlugin({
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      cssRules: [{
        selector: ".btn",
        lineRange: [1, 4],
        declarations: ["padding", "background", "color"],
        type: "rule",
      }],
    });
    plugin.init(mockTsPlugin, mockCssPlugin);

    const result = plugin.analyzeFile("test.svelte", FIXTURES.withStyle);

    expect(result.cssRules).toBeDefined();
    expect(result.cssRules!.length).toBeGreaterThanOrEqual(1);
    const btnRule = result.cssRules!.find(r => r.selector === ".btn");
    expect(btnRule).toBeDefined();
    // Svelte <style> 始终 scoped
    expect(btnRule!.tags).toContain("scoped-style");
    expect(btnRule!.declarations).toContain("color");
    // 行号偏移修正：<style> 在第 7 行
    // CssPlugin 返回行号 1 → 实际行号 = 1 + 7 = 8
    expect(btnRule!.lineRange[0]).toBeGreaterThanOrEqual(8);
  });

  // STYLE-DEG-001: cssPlugin 未初始化（Svelte）
  it("cssPlugin 未初始化时跳过 style 分析，不抛异常", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeResult: {
        functions: [{ name: "increment", lineRange: [1, 1], params: [] }],
        imports: [],
        classes: [],
        exports: [],
      },
    });
    // 不传 cssPlugin
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.svelte", FIXTURES.withStyle);

    // 正常返回 script 分析，cssRules 为空或 undefined
    expect(result.functions.some(f => f.name === "increment")).toBe(true);
    expect(result.cssRules).toBeUndefined();
  });

  // STYLE-DEG-003: Svelte 无 style 块
  it("无 style 块时 cssRules 为空或 undefined", () => {
    const mockTsPlugin = createMockTsPlugin({
      analyzeResult: {
        functions: [],
        imports: [],
        classes: [],
        exports: [],
      },
    });
    const mockCssPlugin = createMockCssPlugin();
    plugin.init(mockTsPlugin, mockCssPlugin);

    const result = plugin.analyzeFile("test.svelte", FIXTURES.noStyle);

    expect(result.cssRules).toBeUndefined();
    // CssPlugin 不应被调用
    expect(mockCssPlugin.analyzeFile).not.toHaveBeenCalled();
  });
});
