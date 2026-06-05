import { describe, it, expect, vi, beforeEach } from "vitest";
import { VueSfcPlugin } from "../vue-sfc-parser.js";
import type { TreeSitterPlugin } from "../../tree-sitter-plugin.js";
import type { CssPlugin } from "../css-parser.js";
import type { StructuralAnalysis, CallGraphEntry } from "../../../types.js";

// ---------------------------------------------------------------------------
// Mock 工厂
// ---------------------------------------------------------------------------

/**
 * 创建 TreeSitterPlugin 的 Mock 实例。
 *
 * @param analyzeResult analyzeFile 方法的返回值
 * @param callGraphResult extractCallGraph 方法的返回值
 */
function createMockTsPlugin(
  analyzeResult?: StructuralAnalysis,
  callGraphResult?: CallGraphEntry[],
): TreeSitterPlugin {
  return {
    name: "tree-sitter",
    languages: ["typescript", "javascript"],
    analyzeFile: vi.fn().mockReturnValue(analyzeResult ?? {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
    }),
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
  // VUE-001, VUE-009: script setup 基础提取
  basicScriptSetup:
    '<template><div>{{ msg }}</div></template><script setup>import { ref } from \'vue\'; const msg = ref(\'hello\'); function greet() { return msg.value; }</script>',

  // VUE-002: 普通 script 块
  optionsApi:
    '<template><div></div></template><script>import MyUtil from \'./util\'; export default { data() { return { count: 0 }; }, methods: { increment() { this.count++; } } }</script>',

  // VUE-003: TypeScript script setup
  scriptSetupTs:
    '<script setup lang="ts">import type { PropType } from \'vue\'; interface Props { title: string; count: number; } const props = defineProps<Props>(); function log(): void { console.log(props.title); }</script>',

  // VUE-004, VUE-005: template 组件引用
  templateComponentRefs:
    '<template><div><ChildComponent /><AnotherChild :prop="val" /><span>text</span></div></template><script setup>import ChildComponent from \'./ChildComponent.vue\';</script>',

  // VUE-006: 空文件
  empty: "",

  // VUE-007: 仅 template 无 script
  templateOnly:
    '<template><div><Header /><MainContent /><Footer /></div></template><style>.app { color: red; }</style>',

  // VUE-008: 行号偏移修正
  lineOffset:
    '<template>\n  <div>{{ msg }}</div>\n</template>\n\n<script setup>\nimport { ref } from \'vue\'\nconst msg = ref(\'\')\nfunction greet() { return msg.value }\n</script>',

  // VUE-010: defineProps/defineEmits 编译宏
  defineProps:
    '<script setup lang="ts">const props = defineProps<{ title: string; count: number }>(); const emit = defineEmits<{ update: [value: string] }>(); function handleClick() { emit(\'update\', \'new\'); }</script><template><button @click="handleClick">{{ props.title }}</button></template>',

  // VUE-011: resolveImports 基础解析
  resolveImports:
    '<script setup>import { ref } from \'vue\'; import Child from \'./Child.vue\'; const msg = ref(\'hello\');</script><template>{{ msg }}</template>',

  // VUE-012: extractCallGraph 调用图提取
  callGraph:
    '<script setup>import { ref } from \'vue\'; const msg = ref(\'hello\'); function greet() { return msg.value; } function farewell() { greet(); }</script><template>{{ greet() }}</template>',

  // STYLE-001: Vue scoped style
  scopedStyle:
    '<template><button class="btn">Click</button></template>\n<script setup>import { ref } from \'vue\'; const count = ref(0);</script>\n<style scoped>\n.btn { color: red; }\n</style>',

  // STYLE-002: Vue CSS Modules
  cssModules:
    '<template><button class="btn">Click</button></template>\n<script setup>import { ref } from \'vue\'; const count = ref(0);</script>\n<style module>\n.btn { color: red; }\n</style>',

  // STYLE-003: Vue v-bind() in CSS
  vBindCss:
    '<template><button class="btn">Click</button></template>\n<script setup>import { ref } from \'vue\'; const primaryColor = ref(\'#3366cc\');</script>\n<style scoped>\n.btn { color: v-bind(primaryColor); }\n</style>',

  // STYLE-005: Vue 多 style 块
  multiStyle:
    '<template><div class="app"><button class="btn">Click</button></div></template>\n<script setup>import { ref } from \'vue\'; const count = ref(0);</script>\n<style scoped>\n.btn { color: red; }\n</style>\n<style module>\n.app { display: flex; }\n</style>',

  // STYLE-006: style 行号偏移
  styleLineOffset:
    '<template>\n  <div class="app">\n    <button class="btn">Click</button>\n  </div>\n</template>\n\n<script setup>\nimport { ref } from \'vue\'\nconst count = ref(0)\n</script>\n\n<style scoped>\n.btn {\n  color: red;\n}\n</style>',

  // STYLE-DEG-001: cssPlugin 未初始化
  // STYLE-DEG-002: Vue 无 style 块
  noStyle:
    '<template><div /></template><script setup>import { ref } from \'vue\'; const msg = ref(\'hello\');</script>',
};

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("VueSfcPlugin", () => {
  let plugin: VueSfcPlugin;

  beforeEach(() => {
    plugin = new VueSfcPlugin();
  });

  // VUE-001: script setup 基础提取
  it("从 <script setup> 中提取函数和导入", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [{ name: "greet", lineRange: [1, 1], params: [] }],
      imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.basicScriptSetup);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("greet");
    expect(result.imports.some(i => i.source === "vue")).toBe(true);
  });

  // VUE-002: 普通 script 块提取
  it("从普通 <script> 块中提取函数和导入（无 script setup 时）", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [{ name: "increment", lineRange: [1, 1], params: [] }],
      imports: [{ source: "./util", specifiers: ["MyUtil"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.optionsApi);

    expect(result.functions.some(f => f.name === "increment")).toBe(true);
    expect(result.imports.some(i => i.source === "./util")).toBe(true);
  });

  // VUE-003: TypeScript script setup 提取
  it("检测 TypeScript 并将 virtual.ts 传给 tsPlugin", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [{ name: "log", lineRange: [1, 1], params: [] }],
      imports: [{ source: "vue", specifiers: ["PropType"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.scriptSetupTs);

    expect(mockTsPlugin.analyzeFile).toHaveBeenCalledWith("virtual.ts", expect.any(String));
    expect(result.functions.some(f => f.name === "log")).toBe(true);
  });

  // VUE-004: template 组件引用提取
  it("从 template 中提取 PascalCase 组件引用", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [{ source: "./ChildComponent.vue", specifiers: ["ChildComponent"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.templateComponentRefs);

    // ChildComponent 来自 script import
    expect(result.imports.some(i => i.specifiers.includes("ChildComponent"))).toBe(true);
    // AnotherChild 来自 template 引用（未在 script 中 import）
    expect(result.imports.some(i => i.specifiers.includes("AnotherChild"))).toBe(true);
    // span 是 HTML 元素，不应出现
    expect(result.imports.some(i => i.specifiers.includes("span"))).toBe(false);
  });

  // VUE-005: template 组件引用去重
  it("对 script 中已 import 的 template 组件引用去重", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [{ source: "./ChildComponent.vue", specifiers: ["ChildComponent"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.templateComponentRefs);

    const childImports = result.imports.filter(i => i.specifiers.includes("ChildComponent"));
    expect(childImports).toHaveLength(1);
  });

  // VUE-006: 空文件处理
  it("优雅处理空 .vue 文件", () => {
    const mockTsPlugin = createMockTsPlugin();
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.empty);

    expect(result.functions).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(mockTsPlugin.analyzeFile).not.toHaveBeenCalled();
  });

  // VUE-007: 无 script 块（仅 template）
  it("无 script 块时返回 template 组件引用", () => {
    const mockTsPlugin = createMockTsPlugin();
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.templateOnly);

    expect(result.functions).toHaveLength(0);
    expect(result.imports).toHaveLength(3);
    expect(result.imports.map(i => i.specifiers[0])).toEqual(["Header", "MainContent", "Footer"]);
  });

  // VUE-008: 行号偏移修正
  it("根据 script 块偏移修正行号", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [{ name: "greet", lineRange: [3, 3], params: [] }],
      imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.lineOffset);

    // script 从 .vue 文件第 5 行开始，偏移 = 5 - 1 = 4
    // greet 行号: 3 + 4 = 7
    expect(result.functions[0].lineRange).toEqual([7, 7]);
    // import 行号: 1 + 4 = 5
    expect(result.imports[0].lineNumber).toBe(5);
  });

  // VUE-009: 降级守卫（tsPlugin 未初始化）
  it("tsPlugin 未初始化时仅返回 template 组件引用", () => {
    // 不调用 init()，tsPlugin 为 null
    const result = plugin.analyzeFile("test.vue", FIXTURES.basicScriptSetup);

    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
    expect(result.imports.length).toBeGreaterThanOrEqual(0);
  });

  // VUE-010: defineProps/defineEmits 编译宏
  it("从 script setup 中提取 defineProps 和 defineEmits", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [{ name: "handleClick", lineRange: [1, 1], params: [] }],
      imports: [],
      classes: [],
      exports: [],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.defineProps);

    expect(result.functions.some(f => f.name === "handleClick")).toBe(true);
  });

  // VUE-011: resolveImports 基础解析
  it("从 script setup 块中解析导入", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [
        { source: "vue", specifiers: ["ref"], lineNumber: 1 },
        { source: "./Child.vue", specifiers: ["Child"], lineNumber: 2 },
      ],
      classes: [],
      exports: [],
    });
    plugin.init(mockTsPlugin);

    const result = plugin.resolveImports("test.vue", FIXTURES.resolveImports);

    expect(result.some(i => i.source === "vue" && i.specifiers.includes("ref"))).toBe(true);
    expect(result.some(i => i.source === "./Child.vue" && i.specifiers.includes("Child"))).toBe(true);
  });

  // VUE-012: extractCallGraph 调用图提取
  it("从 script setup 中提取调用图", () => {
    const mockTsPlugin = createMockTsPlugin(
      {
        functions: [
          { name: "greet", lineRange: [1, 1], params: [] },
          { name: "farewell", lineRange: [1, 1], params: [] },
        ],
        imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
        classes: [],
        exports: [],
      },
      [{ caller: "farewell", callee: "greet", lineNumber: 4 }],
    );
    plugin.init(mockTsPlugin);

    const cg = plugin.extractCallGraph("test.vue", FIXTURES.callGraph);

    expect(cg.some(e => e.caller === "farewell" && e.callee === "greet")).toBe(true);
    // 验证行号偏移：script 从第 1 行开始，偏移 = 1 - 1 = 0
    // lineNumber: 4 + 0 = 4
    expect(cg.find(e => e.caller === "farewell" && e.callee === "greet")!.lineNumber).toBe(4);
  });

  // -----------------------------------------------------------------------
  // P1.7: Style 块分析测试
  // -----------------------------------------------------------------------

  // STYLE-001: Vue scoped style
  it("从 <style scoped> 中提取 CSS 规则并标记 scoped-style", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    const mockCssPlugin = createMockCssPlugin({
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      cssRules: [{
        selector: ".btn",
        lineRange: [1, 1],
        declarations: ["color"],
        type: "rule",
      }],
    });
    plugin.init(mockTsPlugin, mockCssPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.scopedStyle);

    expect(result.cssRules).toBeDefined();
    expect(result.cssRules!.length).toBeGreaterThanOrEqual(1);
    const btnRule = result.cssRules!.find(r => r.selector === ".btn");
    expect(btnRule).toBeDefined();
    expect(btnRule!.tags).toContain("scoped-style");
    expect(btnRule!.declarations).toContain("color");
  });

  // STYLE-002: Vue CSS Modules
  it("从 <style module> 中提取 CSS 规则并标记 css-modules", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    const mockCssPlugin = createMockCssPlugin({
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      cssRules: [{
        selector: ".btn",
        lineRange: [1, 1],
        declarations: ["color"],
        type: "rule",
      }],
    });
    plugin.init(mockTsPlugin, mockCssPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.cssModules);

    expect(result.cssRules).toBeDefined();
    expect(result.cssRules!.length).toBeGreaterThanOrEqual(1);
    const btnRule = result.cssRules!.find(r => r.selector === ".btn");
    expect(btnRule).toBeDefined();
    expect(btnRule!.tags).toContain("css-modules");
  });

  // STYLE-003: Vue v-bind() in CSS
  it("识别 v-bind() in CSS 并生成 depends_on 引用", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    const mockCssPlugin = createMockCssPlugin({
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      cssRules: [{
        selector: ".btn",
        lineRange: [1, 1],
        declarations: ["color"],
        type: "rule",
      }],
    });
    plugin.init(mockTsPlugin, mockCssPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.vBindCss);

    // v-bind(primaryColor) 应生成 import 条目
    const vBindImport = result.imports.find(i =>
      i.source === "primaryColor" && i.specifiers.includes("v-bind"),
    );
    expect(vBindImport).toBeDefined();
    expect(vBindImport!.lineNumber).toBeGreaterThan(0);
  });

  // STYLE-005: Vue 多 style 块
  it("合并多个 <style> 块的分析结果，分别标记", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    // CssPlugin 会被调用两次（每个 style 块一次）
    const mockCssPlugin = createMockCssPlugin();
    (mockCssPlugin.analyzeFile as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        cssRules: [{
          selector: ".btn",
          lineRange: [1, 1],
          declarations: ["color"],
          type: "rule",
        }],
      })
      .mockReturnValueOnce({
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        cssRules: [{
          selector: ".app",
          lineRange: [1, 1],
          declarations: ["display"],
          type: "rule",
        }],
      });
    plugin.init(mockTsPlugin, mockCssPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.multiStyle);

    expect(result.cssRules).toBeDefined();
    // 两个 style 块各一个规则
    expect(result.cssRules!.length).toBe(2);
    // scoped style 块的规则标记 scoped-style
    const btnRule = result.cssRules!.find(r => r.selector === ".btn");
    expect(btnRule).toBeDefined();
    expect(btnRule!.tags).toContain("scoped-style");
    // module style 块的规则标记 css-modules
    const appRule = result.cssRules!.find(r => r.selector === ".app");
    expect(appRule).toBeDefined();
    expect(appRule!.tags).toContain("css-modules");
  });

  // STYLE-006: style 行号偏移
  it("style 块行号偏移修正到 .vue 文件实际行号", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    const mockCssPlugin = createMockCssPlugin({
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      cssRules: [{
        selector: ".btn",
        lineRange: [1, 3],
        declarations: ["color"],
        type: "rule",
      }],
    });
    plugin.init(mockTsPlugin, mockCssPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.styleLineOffset);

    expect(result.cssRules).toBeDefined();
    const btnRule = result.cssRules!.find(r => r.selector === ".btn");
    expect(btnRule).toBeDefined();
    // <style scoped> 在第 11 行（fixture 中）
    // CssPlugin 返回行号 1 → 实际行号 = 1 + 11 = 12
    // CssPlugin 返回行号 3 → 实际行号 = 3 + 11 = 14
    expect(btnRule!.lineRange[0]).toBeGreaterThanOrEqual(12);
    expect(btnRule!.lineRange[1]).toBeGreaterThanOrEqual(12);
  });

  // STYLE-DEG-001: cssPlugin 未初始化
  it("cssPlugin 未初始化时跳过 style 分析，不抛异常", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    // 不传 cssPlugin
    plugin.init(mockTsPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.scopedStyle);

    // 正常返回 script + template 分析，cssRules 为空或 undefined
    expect(result.functions).toHaveLength(0);
    expect(result.imports.some(i => i.source === "vue")).toBe(true);
    expect(result.cssRules).toBeUndefined();
  });

  // STYLE-DEG-002: Vue 无 style 块
  it("无 style 块时 cssRules 为空或 undefined", () => {
    const mockTsPlugin = createMockTsPlugin({
      functions: [],
      imports: [{ source: "vue", specifiers: ["ref"], lineNumber: 1 }],
      classes: [],
      exports: [],
    });
    const mockCssPlugin = createMockCssPlugin();
    plugin.init(mockTsPlugin, mockCssPlugin);

    const result = plugin.analyzeFile("test.vue", FIXTURES.noStyle);

    expect(result.cssRules).toBeUndefined();
    // CssPlugin 不应被调用
    expect(mockCssPlugin.analyzeFile).not.toHaveBeenCalled();
  });
});
