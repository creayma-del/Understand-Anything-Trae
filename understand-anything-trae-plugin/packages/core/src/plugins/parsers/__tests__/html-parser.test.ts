import { describe, it, expect } from "vitest";
import { HtmlPlugin } from "../html-parser.js";
import { registerAllParsers } from "../index.js";
import { PluginRegistry } from "../../registry.js";

describe("HtmlPlugin", () => {
  const plugin = new HtmlPlugin();

  // HTML-001: 基础 HTML 解析
  it("extracts all elements and imports from basic HTML", () => {
    const content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>应用标题</title>
  <link rel="stylesheet" href="./styles/main.css" />
  <script src="./scripts/app.js" defer></script>
</head>
<body>
  <header>
    <nav aria-label="主导航">
      <a href="/home">首页</a>
    </nav>
  </header>
  <main>
    <article>
      <h1>文章标题</h1>
    </article>
  </main>
  <footer>
    <p>2026</p>
  </footer>
</body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    // htmlElements 包含所有元素
    expect(result.htmlElements).toBeDefined();
    expect(result.htmlElements!.length).toBeGreaterThan(0);

    // imports 包含 script/link 引用
    expect(result.imports).toHaveLength(2);
    expect(result.imports.some(i => i.source === "./scripts/app.js")).toBe(true);
    expect(result.imports.some(i => i.source === "./styles/main.css")).toBe(true);
  });

  // HTML-002: script src 引用提取
  it("extracts script src as import", () => {
    const content = `<html>
<head>
  <script src="./app.js"></script>
</head>
<body></body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toMatchObject({
      source: "./app.js",
      specifiers: ["script"],
    });
  });

  // HTML-003: link rel="stylesheet" 引用提取
  it("extracts link rel=stylesheet as import", () => {
    const content = `<html>
<head>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body></body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toMatchObject({
      source: "./styles.css",
      specifiers: ["stylesheet"],
    });
  });

  // HTML-004: link rel="modulepreload" 引用提取
  it("extracts link rel=modulepreload as import", () => {
    const content = `<html>
<head>
  <link rel="modulepreload" href="./module.js" />
</head>
<body></body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toMatchObject({
      source: "./module.js",
      specifiers: ["modulepreload"],
    });
  });

  // HTML-005: link rel="icon" 不纳入 imports
  it("does not include link rel=icon in imports", () => {
    const content = `<html>
<head>
  <link rel="icon" href="./favicon.ico" />
  <link rel="stylesheet" href="./styles.css" />
</head>
<body></body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    // imports 不包含 icon 引用
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("./styles.css");

    // htmlElements 中仍包含该 link 元素
    const linkElements = result.htmlElements!.filter(el => el.tag === "link");
    expect(linkElements.length).toBeGreaterThanOrEqual(2);
  });

  // HTML-006: 外部 URL 跳过
  it("skips external URLs in imports", () => {
    const content = `<html>
<head>
  <script src="https://cdn.example.com/lib.js"></script>
  <link rel="stylesheet" href="//cdn.example.com/styles.css" />
  <script src="./local.js"></script>
</head>
<body></body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("./local.js");
  });

  // HTML-007: 语义标签提取
  it("extracts semantic tags as sections", () => {
    const content = `<html>
<body>
  <header id="site-header">
    <nav aria-label="主导航"></nav>
  </header>
  <main>
    <article></article>
  </main>
  <footer></footer>
</body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    expect(result.sections).toBeDefined();
    expect(result.sections!.length).toBeGreaterThanOrEqual(5);

    const sectionNames = result.sections!.map(s => s.name);
    expect(sectionNames).toContain("site-header");   // header with id
    expect(sectionNames).toContain("主导航");          // nav with aria-label
    expect(sectionNames).toContain("main");
    expect(sectionNames).toContain("article");
    expect(sectionNames).toContain("footer");
  });

  // HTML-008: 自闭合标签识别
  it("identifies self-closing void elements", () => {
    const content = `<html>
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <img src="./logo.png" alt="Logo" />
  <input type="text" />
  <br />
  <div></div>
</body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    const meta = result.htmlElements!.find(el => el.tag === "meta");
    expect(meta?.isSelfClosing).toBe(true);

    const img = result.htmlElements!.find(el => el.tag === "img");
    expect(img?.isSelfClosing).toBe(true);

    const input = result.htmlElements!.find(el => el.tag === "input");
    expect(input?.isSelfClosing).toBe(true);

    const link = result.htmlElements!.find(el => el.tag === "link");
    expect(link?.isSelfClosing).toBe(true);

    const br = result.htmlElements!.find(el => el.tag === "br");
    expect(br?.isSelfClosing).toBe(true);

    const div = result.htmlElements!.find(el => el.tag === "div");
    expect(div?.isSelfClosing).toBe(false);
  });

  // HTML-009: 空 HTML 文件
  it("returns empty analysis for empty content", () => {
    const result = plugin.analyzeFile("test.html", "");

    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
  });

  // HTML-010: 仅 DOCTYPE 声明
  it("returns empty analysis for DOCTYPE-only content", () => {
    const result = plugin.analyzeFile("test.html", "<!DOCTYPE html>");

    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
  });

  // HTML-011: 内联 script/style
  it("handles inline script and style without creating imports", () => {
    const content = `<html>
<head>
  <style>
    body { margin: 0; }
  </style>
</head>
<body>
  <script>
    console.log('页面已加载');
  </script>
</body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    // htmlElements 包含 script 和 style 元素
    const scriptEl = result.htmlElements!.find(el => el.tag === "script");
    expect(scriptEl).toBeDefined();

    const styleEl = result.htmlElements!.find(el => el.tag === "style");
    expect(styleEl).toBeDefined();

    // imports 不包含内联 script/style 引用（无 src/href）
    expect(result.imports).toHaveLength(0);
  });

  // HTML-012: resolveImports 路径解析
  it("resolves relative paths in resolveImports", () => {
    const content = `<html>
<head>
  <script src="./app.js"></script>
  <link rel="stylesheet" href="../styles/main.css" />
</head>
<body></body>
</html>`;
    const resolutions = plugin.resolveImports!("pages/test.html", content);

    expect(resolutions).toHaveLength(2);

    const scriptRes = resolutions.find(r => r.source === "./app.js");
    expect(scriptRes?.resolvedPath).toBe("pages/app.js");

    const cssRes = resolutions.find(r => r.source === "../styles/main.css");
    expect(cssRes?.resolvedPath).toBe("styles/main.css");
  });

  // HTML-013: 降级处理（malformed HTML）
  it("handles malformed HTML gracefully", () => {
    const content = "<div><p>unclosed";
    const result = plugin.analyzeFile("test.html", content);

    // 不抛异常，返回部分分析结果
    expect(result).toBeDefined();
    expect(result.htmlElements).toBeDefined();
    expect(result.htmlElements!.length).toBeGreaterThan(0);
  });

  // HTML-014: 多重引用混合
  it("handles mixed references correctly", () => {
    const content = `<html>
<head>
  <link rel="stylesheet" href="./styles.css" />
  <link rel="icon" href="./favicon.ico" />
  <link rel="modulepreload" href="./module.js" />
  <script src="./app.js"></script>
  <script src="https://cdn.example.com/lib.js"></script>
</head>
<body>
  <img src="./logo.png" alt="Logo" />
</body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    // imports 同时包含 script src、link stylesheet、link modulepreload、img src
    // 不含 link icon 和外部 CDN URL
    expect(result.imports).toHaveLength(4);

    const sources = result.imports.map(i => i.source);
    expect(sources).toContain("./styles.css");
    expect(sources).toContain("./module.js");
    expect(sources).toContain("./app.js");
    expect(sources).toContain("./logo.png");

    // 不包含 icon 和外部 URL
    expect(sources).not.toContain("./favicon.ico");
    expect(sources).not.toContain("https://cdn.example.com/lib.js");
  });

  // HTML-015: range[-1,-1] 降级行号计算
  it("handles invalid range gracefully with fallback line computation", () => {
    // 即使 range 不可用，也不应抛异常
    const content = `<html>
<body>
  <div>test</div>
</body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    expect(result.htmlElements).toBeDefined();
    // 每个元素都应有有效的行范围
    for (const el of result.htmlElements!) {
      expect(el.lineRange[0]).toBeGreaterThanOrEqual(1);
      expect(el.lineRange[1]).toBeGreaterThanOrEqual(el.lineRange[0]);
    }
  });

  // 补充测试：plugin 属性
  it("has correct name and languages", () => {
    expect(plugin.name).toBe("html-parser");
    expect(plugin.languages).toEqual(["html"]);
  });

  // 补充测试：resolveImports 绝对路径
  it("resolves absolute paths in resolveImports", () => {
    const content = `<html>
<head>
  <link rel="stylesheet" href="/css/main.css" />
</head>
<body></body>
</html>`;
    const resolutions = plugin.resolveImports!("pages/test.html", content);

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].resolvedPath).toBe("css/main.css");
  });

  // 补充测试：data: URI 跳过
  it("skips data: URIs in imports", () => {
    const content = `<html>
<body>
  <img src="data:image/png;base64,abc123" />
  <img src="./real-image.png" />
</body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    const sources = result.imports.map(i => i.source);
    expect(sources).not.toContain("data:image/png;base64,abc123");
    expect(sources).toContain("./real-image.png");
  });

  // 补充测试：link rel="prefetch" 不纳入 imports
  it("does not include link rel=prefetch in imports", () => {
    const content = `<html>
<head>
  <link rel="prefetch" href="./next-page.js" />
  <link rel="preconnect" href="https://cdn.example.com" />
</head>
<body></body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    expect(result.imports).toHaveLength(0);
  });

  // 补充测试：语义标签层级映射
  it("maps semantic tag levels correctly", () => {
    const content = `<html>
<body>
  <header></header>
  <nav></nav>
  <main></main>
  <footer></footer>
  <article></article>
  <section></section>
  <aside></aside>
  <details></details>
  <summary></summary>
  <figure></figure>
</body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    expect(result.sections).toBeDefined();

    const getLevel = (name: string) =>
      result.sections!.find(s => s.name === name)?.level;

    expect(getLevel("header")).toBe(1);
    expect(getLevel("nav")).toBe(1);
    expect(getLevel("main")).toBe(1);
    expect(getLevel("footer")).toBe(1);
    expect(getLevel("article")).toBe(2);
    expect(getLevel("section")).toBe(2);
    expect(getLevel("aside")).toBe(2);
    expect(getLevel("details")).toBe(3);
    expect(getLevel("summary")).toBe(4);
    expect(getLevel("figure")).toBe(3);
  });

  // 补充测试：属性提取
  it("extracts element attributes correctly", () => {
    const content = `<html>
<body>
  <div id="app" class="container" data-value="test"></div>
  <a href="/home" target="_blank">Link</a>
</body>
</html>`;
    const result = plugin.analyzeFile("test.html", content);

    const div = result.htmlElements!.find(el => el.tag === "div");
    expect(div?.attributes).toMatchObject({
      id: "app",
      class: "container",
      "data-value": "test",
    });

    const a = result.htmlElements!.find(el => el.tag === "a");
    expect(a?.attributes).toMatchObject({
      href: "/home",
      target: "_blank",
    });
  });
});

describe("HtmlPlugin registration", () => {
  it("registers with PluginRegistry and resolves html language", () => {
    const registry = new PluginRegistry();
    registerAllParsers(registry);

    const htmlPlugin = registry.getPluginForLanguage("html");
    expect(htmlPlugin).not.toBeNull();
    expect(htmlPlugin?.name).toBe("html-parser");
  });

  it("analyzes .html files via registry", () => {
    const registry = new PluginRegistry();
    registerAllParsers(registry);

    const content = `<html>
<head>
  <script src="./app.js"></script>
</head>
<body></body>
</html>`;
    const result = registry.analyzeFile("test.html", content);
    expect(result).not.toBeNull();
    expect(result?.imports).toHaveLength(1);
  });
});
