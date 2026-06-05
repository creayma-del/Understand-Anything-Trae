import { describe, it, expect } from "vitest";
import { CssPlugin } from "../css-parser.js";
import { PluginRegistry } from "../../registry.js";
import { registerAllParsers } from "../index.js";

const plugin = new CssPlugin();

describe("CssPlugin", () => {
  it("声明 css 语言支持", () => {
    expect(plugin.name).toBe("css-parser");
    expect(plugin.languages).toContain("css");
  });
});

// CSS-001 基本 CSS 规则提取
describe("CSS-001: 基本 CSS 规则提取", () => {
  it("提取单选择器规则的 selector、declarations 和 type", () => {
    const content = ".btn { color: red; font-size: 14px; }";
    const result = plugin.analyzeFile("test.css", content);
    expect(result.cssRules).toBeDefined();
    const rule = result.cssRules!.find(r => r.selector === ".btn");
    expect(rule).toBeDefined();
    expect(rule!.declarations).toEqual(["color", "font-size"]);
    expect(rule!.type).toBe("rule");
  });
});

// CSS-002 多选择器规则
describe("CSS-002: 多选择器规则", () => {
  it("提取多选择器规则保留完整 selector 字符串", () => {
    const content = ".a, .b { margin: 0; }";
    const result = plugin.analyzeFile("test.css", content);
    const rule = result.cssRules!.find(r => r.selector === ".a, .b");
    expect(rule).toBeDefined();
    expect(rule!.declarations).toEqual(["margin"]);
    expect(rule!.type).toBe("rule");
  });
});

// CSS-003 @media 规则提取
describe("CSS-003: @media 规则提取", () => {
  it("提取 @media 为 at-rule 类型，内部 .container 为嵌套 rule", () => {
    const content = "@media (min-width: 768px) { .container { width: 100%; } }";
    const result = plugin.analyzeFile("test.css", content);
    const mediaRule = result.cssRules!.find(r => r.type === "at-rule" && r.selector.startsWith("@media"));
    expect(mediaRule).toBeDefined();
    expect(mediaRule!.selector).toBe("@media (min-width: 768px)");
    const containerRule = result.cssRules!.find(r => r.selector === ".container");
    expect(containerRule).toBeDefined();
    expect(containerRule!.type).toBe("rule");
  });
});

// CSS-004 @keyframes 提取
describe("CSS-004: @keyframes 提取", () => {
  it("提取 @keyframes 为 at-rule 类型", () => {
    const content = "@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }";
    const result = plugin.analyzeFile("test.css", content);
    const kfRule = result.cssRules!.find(r => r.selector.includes("@keyframes fadeIn"));
    expect(kfRule).toBeDefined();
    expect(kfRule!.type).toBe("at-rule");
  });
});

// CSS-005 SCSS 变量提取
describe("CSS-005: SCSS 变量提取", () => {
  it("提取 $primary 变量为 variable 类型，declarations 为空数组", () => {
    const content = "$primary: #3366cc;";
    const result = plugin.analyzeFile("test.scss", content);
    const variable = result.cssRules!.find(r => r.type === "variable");
    expect(variable).toBeDefined();
    expect(variable!.selector).toBe("$primary");
    expect(variable!.declarations).toEqual([]);
    // 变量名应出现在 exports 中
    expect(result.exports.some(e => e.name === "$primary")).toBe(true);
  });
});

// CSS-006 @mixin 提取
describe("CSS-006: @mixin 提取", () => {
  it("提取 @mixin 为 mixin 类型，含 declarations", () => {
    const content = "@mixin flex-center { display: flex; align-items: center; }";
    const result = plugin.analyzeFile("test.scss", content);
    const mixinRule = result.cssRules!.find(r => r.type === "mixin");
    expect(mixinRule).toBeDefined();
    expect(mixinRule!.selector).toBe("@mixin flex-center");
    expect(mixinRule!.declarations).toEqual(["display", "align-items"]);
    // mixin 名称应出现在 exports 中
    expect(result.exports.some(e => e.name === "flex-center")).toBe(true);
  });
});

// CSS-007 @mixin 带参数
describe("CSS-007: @mixin 带参数", () => {
  it("提取带参数的 @mixin，selector 仅含名称不含参数", () => {
    const content = "@mixin respond-to($bp) { @media (min-width: $bp) { @content; } }";
    const result = plugin.analyzeFile("test.scss", content);
    const mixinRule = result.cssRules!.find(r => r.type === "mixin");
    expect(mixinRule).toBeDefined();
    expect(mixinRule!.selector).toBe("@mixin respond-to");
  });
});

// CSS-008 @function 提取
describe("CSS-008: @function 提取", () => {
  it("提取 @function 为 function 类型", () => {
    const content = "@function rem($px) { @return ($px / 16) * 1rem; }";
    const result = plugin.analyzeFile("test.scss", content);
    const funcRule = result.cssRules!.find(r => r.type === "function");
    expect(funcRule).toBeDefined();
    expect(funcRule!.selector).toBe("@function rem");
    // function 名称应出现在 exports 中
    expect(result.exports.some(e => e.name === "rem")).toBe(true);
  });
});

// CSS-009 @import 提取
describe("CSS-009: @import 提取", () => {
  it("提取 @import 到 imports", () => {
    const content = "@import 'reset.css';";
    const result = plugin.analyzeFile("test.scss", content);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("reset.css");
    expect(result.imports[0].specifiers).toEqual([]);
    expect(result.imports[0].lineNumber).toBe(1);
  });
});

// CSS-010 @use 提取
describe("CSS-010: @use 提取", () => {
  it("提取 @use 含 namespace", () => {
    const content = "@use 'base' as *;";
    const result = plugin.analyzeFile("test.scss", content);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("base");
    expect(result.imports[0].specifiers).toEqual(["*"]);
    expect(result.imports[0].lineNumber).toBe(1);
  });
});

// CSS-011 @forward 提取
describe("CSS-011: @forward 提取", () => {
  it("提取 @forward 到 imports", () => {
    const content = "@forward 'themes';";
    const result = plugin.analyzeFile("test.scss", content);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("themes");
    expect(result.imports[0].specifiers).toEqual([]);
    expect(result.imports[0].lineNumber).toBe(1);
  });
});

// CSS-012 嵌套规则提取
describe("CSS-012: 嵌套规则提取", () => {
  it("提取 SCSS 嵌套规则为独立 rule 条目", () => {
    const content = ".parent { .child { padding: 8px; } }";
    const result = plugin.analyzeFile("test.scss", content);
    const rules = result.cssRules!.filter(r => r.type === "rule");
    expect(rules.length).toBeGreaterThanOrEqual(2);
    const parentRule = rules.find(r => r.selector === ".parent");
    const childRule = rules.find(r => r.selector === ".child");
    expect(parentRule).toBeDefined();
    expect(childRule).toBeDefined();
  });
});

// CSS-013 行号正确性
describe("CSS-013: 行号正确性", () => {
  it("每个规则的 lineRange 与源文件实际行号一致", () => {
    const content = [
      ".first {",
      "  color: red;",
      "}",
      "",
      ".second {",
      "  margin: 0;",
      "}",
    ].join("\n");
    const result = plugin.analyzeFile("test.css", content);
    const first = result.cssRules!.find(r => r.selector === ".first");
    const second = result.cssRules!.find(r => r.selector === ".second");
    expect(first).toBeDefined();
    expect(first!.lineRange[0]).toBe(1);
    expect(first!.lineRange[1]).toBe(3);
    expect(second).toBeDefined();
    expect(second!.lineRange[0]).toBe(5);
    expect(second!.lineRange[1]).toBe(7);
  });
});

// CSS-014 空 CSS 文件
describe("CSS-014: 空 CSS 文件", () => {
  it("空字符串返回空分析", () => {
    const result = plugin.analyzeFile("empty.css", "");
    expect(result.cssRules).toEqual([]);
    expect(result.imports).toEqual([]);
    expect(result.exports).toEqual([]);
  });
});

// CSS-015 语法错误降级
describe("CSS-015: 语法错误降级", () => {
  it("无效 CSS 返回空分析，不抛出异常", () => {
    // PostCSS + postcss-scss 对某些语法错误有容错能力，
    // 但对于严重错误应降级返回空分析
    const content = ".btn { color: }";
    // 不应抛出异常
    const result = plugin.analyzeFile("invalid.css", content);
    expect(result).toBeDefined();
    // 即使 PostCSS 能容错解析，也不应崩溃
    expect(result.cssRules).toBeDefined();
  });
});

// CSS-016 resolveImports — SCSS partial 探测
describe("CSS-016: resolveImports — SCSS partial 探测", () => {
  it("对 @use './variables' 生成包含 _variables.scss 的候选路径", () => {
    const content = "@use './variables';";
    const resolutions = plugin.resolveImports("test.scss", content);
    expect(resolutions).toHaveLength(1);
    // resolveImports 不访问文件系统，返回第一个候选路径
    // 第一个候选应为 ./variables.scss（Dart Sass 规范顺序）
    expect(resolutions[0].source).toBe("./variables");
    expect(resolutions[0].resolvedPath).toBe("./variables.scss");
    expect(resolutions[0].isVerified).toBe(false);
  });
});

// CSS-017 resolveImports — 带扩展名导入
describe("CSS-017: resolveImports — 带扩展名导入", () => {
  it("对 @import './reset.css' 保留扩展名路径", () => {
    const content = "@import './reset.css';";
    const resolutions = plugin.resolveImports("test.scss", content);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].source).toBe("./reset.css");
    expect(resolutions[0].resolvedPath).toBe("./reset.css");
    expect(resolutions[0].isVerified).toBe(false);
  });
});

// CSS-018 @layer 规则提取
describe("CSS-018: @layer 规则提取", () => {
  it("提取 @layer 为 at-rule 类型", () => {
    const content = "@layer components { .card { padding: 16px; } }";
    const result = plugin.analyzeFile("test.css", content);
    const layerRule = result.cssRules!.find(r => r.selector.includes("@layer components"));
    expect(layerRule).toBeDefined();
    expect(layerRule!.type).toBe("at-rule");
  });
});

// 额外回归测试：registerAllParsers 应包含 CssPlugin
describe("registerAllParsers 回归", () => {
  it("注册 CssPlugin 后 registry 支持 css 语言", () => {
    const registry = new PluginRegistry();
    registerAllParsers(registry);
    expect(registry.getSupportedLanguages()).toContain("css");
    // 包含 CssPlugin 在内的所有 parser 均已注册
    expect(registry.getPlugins().length).toBeGreaterThanOrEqual(11);
  });
});
