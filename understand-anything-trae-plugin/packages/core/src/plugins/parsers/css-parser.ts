import type { AnalyzerPlugin, StructuralAnalysis, ImportResolution, CssRuleInfo } from "../../types.js";
import postcss from "postcss";
import scss from "postcss-scss";

/**
 * CSS/SCSS parser plugin.
 *
 * Uses PostCSS + postcss-scss to parse CSS/SCSS files, extracting
 * rules, variables, mixins, functions, and import relationships.
 */
export class CssPlugin implements AnalyzerPlugin {
  readonly name = "css-parser";
  readonly languages = ["css"];

  analyzeFile(filePath: string, content: string): StructuralAnalysis {
    const cssRules: CssRuleInfo[] = [];
    const imports: Array<{ source: string; specifiers: string[]; lineNumber: number }> = [];
    const exports: Array<{ name: string; lineNumber: number; isDefault?: boolean }> = [];

    try {
      const result = postcss().process(content, {
        syntax: scss,
        from: filePath,
      });

      // 遍历 AST
      result.root.walk((node) => {
        // 运行时守卫：PostCSS AtRule 等节点可能缺少 source 属性
        // 跳过无 source 信息的节点（行号不可用），不中断遍历
        if (!node.source?.start || !node.source?.end) return;

        switch (node.type) {
          case "rule": {
            // 普通 CSS 规则
            cssRules.push({
              selector: node.selector,
              lineRange: [node.source.start.line, node.source.end.line],
              declarations: extractDeclarations(node),
              type: "rule",
            });
            break;
          }
          case "atrule": {
            const atName = node.name; // "media", "mixin", "function", "use", "forward", "import", etc.

            if (atName === "mixin") {
              // @mixin 定义
              cssRules.push({
                selector: `@mixin ${extractMixinName(node)}`,
                lineRange: [node.source.start.line, node.source.end.line],
                declarations: extractDeclarations(node),
                type: "mixin",
              });
              // mixin 名称作为导出
              exports.push({
                name: extractMixinName(node),
                lineNumber: node.source.start.line,
              });
            } else if (atName === "function") {
              // @function 定义
              cssRules.push({
                selector: `@function ${extractFunctionName(node)}`,
                lineRange: [node.source.start.line, node.source.end.line],
                declarations: extractDeclarations(node),
                type: "function",
              });
              // function 名称作为导出
              exports.push({
                name: extractFunctionName(node),
                lineNumber: node.source.start.line,
              });
            } else if (atName === "import") {
              // @import 语句
              const importPath = stripQuotes(node.params);
              imports.push({
                source: importPath,
                specifiers: [],
                lineNumber: node.source.start.line,
              });
            } else if (atName === "use") {
              // @use 语句
              const { path: usePath, namespace } = parseUseDirective(node.params);
              imports.push({
                source: usePath,
                specifiers: namespace ? [namespace] : [],
                lineNumber: node.source.start.line,
              });
            } else if (atName === "forward") {
              // @forward 语句
              const forwardPath = stripQuotes(node.params.split(/\s+as\s+|\s+hide\s+|\s+show\s+/)[0]);
              imports.push({
                source: forwardPath,
                specifiers: [],
                lineNumber: node.source.start.line,
              });
            } else {
              // 其他 at-rule（@media, @keyframes, @layer, @supports 等）
              cssRules.push({
                selector: `@${atName} ${node.params}`,
                lineRange: [node.source.start.line, node.source.end.line],
                declarations: extractDeclarations(node),
                type: "at-rule",
              });
            }
            break;
          }
          case "decl": {
            // SCSS 变量定义（$variable: value）
            if (node.prop.startsWith("$")) {
              cssRules.push({
                selector: node.prop,
                lineRange: [node.source.start.line, node.source.end.line],
                declarations: [],
                type: "variable",
              });
              // 变量名作为导出
              exports.push({
                name: node.prop,
                lineNumber: node.source.start.line,
              });
            }
            break;
          }
        }
      });
    } catch {
      // [降级守卫] PostCSS 解析失败时返回空分析
      // 不中断整体流程，仅记录警告
      return {
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        cssRules: [],
      };
    }

    return {
      functions: [],
      classes: [],
      imports,
      exports,
      cssRules,
    };
  }

  resolveImports(filePath: string, content: string): ImportResolution[] {
    const analysis = this.analyzeFile(filePath, content);

    return analysis.imports.map(imp => {
      let resolvedPath = imp.source;
      let isVerified = false;

      // 相对路径解析
      if (resolvedPath.startsWith("./") || resolvedPath.startsWith("../")) {
        // SCSS partial 路径探测：按 Dart Sass 规范顺序生成候选路径
        const candidates = resolveScssPartialPaths(resolvedPath);
        // 注意：CssPlugin 本身不直接访问文件系统，此处标记为未验证
        // 实际验证由 extract-import-map.mjs 中的 resolveCssImport() 完成
        resolvedPath = candidates[0] ?? imp.source;
        isVerified = false; // 候选路径未经文件系统验证
      } else {
        // 非相对路径（如包名）无法在此验证
        isVerified = false;
      }

      return {
        source: imp.source,
        resolvedPath,
        specifiers: imp.specifiers,
        isVerified,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// 内部辅助函数
// ---------------------------------------------------------------------------

/**
 * 从规则节点中提取声明属性名列表。
 */
function extractDeclarations(node: postcss.Container): string[] {
  const declarations: string[] = [];
  if ("nodes" in node && node.nodes) {
    for (const child of node.nodes) {
      if (child.type === "decl") {
        declarations.push(child.prop);
      }
    }
  }
  return declarations;
}

/**
 * 从 @mixin 节点中提取 mixin 名称。
 * @mixin name($param1, $param2) { ... } → "name"
 */
function extractMixinName(node: postcss.AtRule): string {
  const match = node.params.match(/^([a-zA-Z_-][a-zA-Z0-9_-]*)/);
  return match ? match[1] : node.params;
}

/**
 * 从 @function 节点中提取 function 名称。
 * @function name($param) { ... } → "name"
 */
function extractFunctionName(node: postcss.AtRule): string {
  const match = node.params.match(/^([a-zA-Z_-][a-zA-Z0-9_-]*)/);
  return match ? match[1] : node.params;
}

/**
 * 去除字符串两端的引号。
 */
function stripQuotes(str: string): string {
  return str.replace(/^['"]|['"]$/g, "").trim();
}

/**
 * 解析 @use 指令的参数。
 * @use 'path' as name → { path: 'path', namespace: 'name' }
 * @use 'path' → { path: 'path', namespace: null }
 */
function parseUseDirective(params: string): { path: string; namespace: string | null } {
  const parts = params.split(/\s+as\s+/);
  const path = stripQuotes(parts[0]);
  const namespace = parts.length > 1 ? parts[1].trim() : null;
  return { path, namespace };
}

/**
 * SCSS partial 路径探测（遵循 Dart Sass 规范）。
 *
 * SCSS 约定 partial 文件以 _ 前缀命名（如 _variables.scss），
 * 导入时可省略 _ 前缀和扩展名（如 @use 'variables'）。
 * 此函数按 Dart Sass 规范顺序生成所有可能的路径候选。
 *
 * @use "components/button" probing order (per Dart Sass):
 *   1. components/button.scss
 *   2. components/button.sass
 *   3. components/_button.scss  (partial)
 *   4. components/_button.sass  (partial)
 *   5. components/button/index.scss
 *   6. components/button/_index.scss
 *   7. components/button.css
 */
function resolveScssPartialPaths(rawPath: string): string[] {
  const candidates: string[] = [];
  const dir = rawPath.includes("/")
    ? rawPath.substring(0, rawPath.lastIndexOf("/") + 1)
    : "";
  const base = rawPath.includes("/")
    ? rawPath.substring(rawPath.lastIndexOf("/") + 1)
    : rawPath;

  // 如果已有扩展名，直接使用
  if (/\.(scss|sass|css)$/.test(base)) {
    candidates.push(rawPath);
    // 也尝试 _ 前缀版本
    if (!base.startsWith("_")) {
      candidates.push(dir + "_" + base);
    }
    return candidates;
  }

  // 无扩展名：按 Dart Sass 规范顺序生成候选
  // 1. 非partial .scss / .sass
  candidates.push(dir + base + ".scss");
  candidates.push(dir + base + ".sass");

  // 2. partial（_ 前缀）.scss / .sass
  if (!base.startsWith("_")) {
    candidates.push(dir + "_" + base + ".scss");
    candidates.push(dir + "_" + base + ".sass");
  }

  // 3. index 文件（仅 .scss）
  candidates.push(rawPath + "/index.scss");
  candidates.push(rawPath + "/_index.scss");

  // 4. .css 最后（Dart Sass 将 .css 视为最低优先级）
  candidates.push(dir + base + ".css");

  return candidates;
}
