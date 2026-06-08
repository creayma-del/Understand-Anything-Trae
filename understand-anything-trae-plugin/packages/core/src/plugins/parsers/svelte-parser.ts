import type { AnalyzerPlugin, StructuralAnalysis, ImportResolution, CallGraphEntry } from "../../types.js";
import { parse as parseSvelte } from "svelte/compiler";
import type { TreeSitterPlugin } from "../tree-sitter-plugin.js";
import type { CssPlugin } from "./css-parser.js";
import { mergeStyleAnalysis } from "./sfc-utils.js";

/**
 * Template component reference extracted from the Svelte template AST.
 */
interface TemplateComponentRef {
  name: string;       // Uppercase-starting component name, e.g. "Child"
  lineNumber: number; // Line number in the .svelte file
}

/**
 * A script block extracted from a Svelte SFC.
 * Svelte files can have both an instance script and a module script.
 */
interface ScriptBlock {
  content: string;
  startLine: number;
  isModule: boolean;
}



/**
 * Svelte parser plugin.
 *
 * Uses svelte/compiler to parse .svelte files, then delegates script
 * content to TypeScript tree-sitter for structural analysis.
 * Template component references are extracted via the compiler's AST.
 */
export class SveltePlugin implements AnalyzerPlugin {
  readonly name = "svelte-parser";
  readonly languages = ["svelte"];

  // Dependencies injected via init()
  private tsPlugin: TreeSitterPlugin | null = null;
  private cssPlugin: CssPlugin | null = null;

  /**
   * Initialize with a reference to the TreeSitterPlugin for
   * TypeScript grammar access, and optionally CssPlugin for
   * style block analysis.
   */
  init(tsPlugin: TreeSitterPlugin, cssPlugin?: CssPlugin): void {
    this.tsPlugin = tsPlugin;
    this.cssPlugin = cssPlugin ?? null;
  }

  analyzeFile(filePath: string, content: string): StructuralAnalysis {
    const { scriptBlocks, templateComponents, ast } =
      parseSvelteSfc(content, filePath);

    // 构建基础结果：script + template 分析
    let result: StructuralAnalysis;

    // 如果没有 script 块，仅返回 template 组件引用
    if (scriptBlocks.length === 0) {
      result = {
        functions: [],
        classes: [],
        imports: templateComponents.map(comp => ({
          source: comp.name,
          specifiers: [comp.name],
          lineNumber: comp.lineNumber,
        })),
        exports: [],
      };
    } else if (!this.tsPlugin) {
      // [降级守卫] tsPlugin 未初始化时返回空分析 + template 组件引用
      result = {
        functions: [],
        classes: [],
        imports: templateComponents.map(comp => ({
          source: comp.name,
          specifiers: [comp.name],
          lineNumber: comp.lineNumber,
        })),
        exports: [],
      };
    } else {
      // 合并所有 script 块的分析结果
      // Svelte 可以同时有 instance script 和 module script
      const isTs = detectTypeScriptScript(content);
      const allFunctions: StructuralAnalysis["functions"] = [];
      const allClasses: StructuralAnalysis["classes"] = [];
      const allImports: StructuralAnalysis["imports"] = [];
      const allExports: StructuralAnalysis["exports"] = [];

      for (const block of scriptBlocks) {
        const tsAnalysis = this.tsPlugin.analyzeFile(
          isTs ? "virtual.ts" : "virtual.js",
          block.content,
        );

        // 行号偏移修正
        const lineOffset = block.startLine - 1;
        allFunctions.push(...tsAnalysis.functions.map(fn => ({
          ...fn,
          lineRange: [fn.lineRange[0] + lineOffset, fn.lineRange[1] + lineOffset] as [number, number],
        })));
        allClasses.push(...tsAnalysis.classes.map(cls => ({
          ...cls,
          lineRange: [cls.lineRange[0] + lineOffset, cls.lineRange[1] + lineOffset] as [number, number],
        })));
        allImports.push(...tsAnalysis.imports.map(imp => ({
          ...imp,
          lineNumber: imp.lineNumber + lineOffset,
        })));
        allExports.push(...tsAnalysis.exports.map(exp => ({
          ...exp,
          lineNumber: exp.lineNumber + lineOffset,
        })));
      }

      // 合并 template 组件引用到 imports
      // 去重：检查组件名是否已出现在 import specifiers 中
      const importedSpecifiers = new Set(allImports.flatMap(i => i.specifiers));
      const templateImports = templateComponents
        .filter(comp => !importedSpecifiers.has(comp.name))
        .map(comp => ({
          source: comp.name,
          specifiers: [comp.name],
          lineNumber: comp.lineNumber,
        }));

      result = {
        functions: allFunctions,
        classes: allClasses,
        imports: [...allImports, ...templateImports],
        exports: allExports,
      };
    }

    // style 块分析：委托 CssPlugin
    if (this.cssPlugin && ast.css) {
      // Svelte 的 ast.css 不直接提供 content 字符串，
      // 需要从原始文件内容中提取
      const styleContent = extractStyleContent(content, ast.css);
      const styleResult = this.cssPlugin.analyzeFile(
        `${filePath}#style`,
        styleContent,
      );

      // 字符偏移转行号
      // ast.css.start 是 <style> 标签的字符偏移位置
      // 偏移量 = <style> 标签所在行号（1-based），与 Vue 的 styleOffset 语义一致
      const styleOffset = content.slice(0, ast.css.start).split('\n').length;

      // Svelte <style> 始终 scoped
      mergeStyleAnalysis(result, styleResult, styleOffset, {
        scoped: true,
        module: false,
      });
    }

    return result;
  }

  resolveImports(filePath: string, content: string): ImportResolution[] {
    const analysis = this.analyzeFile(filePath, content);
    return analysis.imports.map(imp => ({
      source: imp.source,
      resolvedPath: imp.source,
      specifiers: imp.specifiers,
    }));
  }

  extractCallGraph(filePath: string, content: string): CallGraphEntry[] {
    const { scriptBlocks } = parseSvelteSfc(content, filePath);
    if (scriptBlocks.length === 0 || !this.tsPlugin) return [];

    const isTs = detectTypeScriptScript(content);
    const allCallGraph: CallGraphEntry[] = [];

    for (const block of scriptBlocks) {
      const callGraph = this.tsPlugin.extractCallGraph(
        isTs ? "virtual.ts" : "virtual.js",
        block.content,
      );

      // 行号偏移修正
      const lineOffset = block.startLine - 1;
      allCallGraph.push(...callGraph.map(entry => ({
        ...entry,
        lineNumber: entry.lineNumber + lineOffset,
      })));
    }

    return allCallGraph;
  }

}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Svelte SFC file using svelte/compiler.
 */
function parseSvelteSfc(content: string, filePath: string) {
  const ast = parseSvelte(content, {
    filename: filePath,
  });

  // 提取 script 内容 — 需要同时处理 instance 和 module 两个 script 块
  // instance: 组件实例级代码（props, reactive state, lifecycle）
  // module:  模块级导出代码（可被外部 import 的函数/常量）
  //
  // Svelte 5 的 ast.instance.content / ast.module.content 返回 ESTree AST 对象而非字符串。
  // 需要从原始文件内容中提取纯脚本文本：
  //   - ast.instance.start/end 覆盖整个 <script> 元素（含标签）
  //   - ast.instance.content.start/end 仅覆盖脚本内容（不含标签）
  const scriptBlocks: ScriptBlock[] = [];

  if (ast.instance) {
    scriptBlocks.push({
      content: extractScriptContent(content, ast.instance.content),
      startLine: content.slice(0, ast.instance.content.start).split("\n").length,
      isModule: false,
    });
  }
  if (ast.module) {
    scriptBlocks.push({
      content: extractScriptContent(content, ast.module.content),
      startLine: content.slice(0, ast.module.content.start).split("\n").length,
      isModule: true,
    });
  }

  // 提取 template 中的组件引用
  const templateComponents = extractTemplateComponents(ast.html, content);

  return { scriptBlocks, templateComponents, ast };
}

/**
 * 检测 .svelte 文件的 <script> 是否使用 TypeScript。
 * svelte/compiler 不直接提供 lang 属性，需要从原始内容中检测。
 */
function detectTypeScriptScript(content: string): boolean {
  const match = content.match(/<script[^>]*\blang\s*=\s*["']ts["']/);
  return match !== null;
}

/**
 * 从原始文件内容中提取 script 块的纯文本。
 *
 * Svelte 5 的 ast.instance.content / ast.module.content 返回 ESTree AST 对象
 * 而非字符串，因此需要从原始内容中按 start/end 偏移量提取。
 */
function extractScriptContent(
  fileContent: string,
  scriptBlock: { start: number; end: number },
): string {
  return fileContent.slice(scriptBlock.start, scriptBlock.end);
}

/**
 * 从原始文件内容中提取 Svelte style 块的纯文本。
 *
 * Svelte 5 的 ast.css 不直接提供 content 字符串，
 * 需要从原始内容中按 start/end 偏移量提取。
 * ast.css.start/end 覆盖整个 <style> 元素（含标签），
 * 需要跳过 <style...> 开始标签和 </style> 结束标签。
 */
function extractStyleContent(
  fileContent: string,
  cssBlock: { start: number; end: number },
): string {
  // 提取整个 <style>...</style> 块
  const rawBlock = fileContent.slice(cssBlock.start, cssBlock.end);

  // 去除 <style> 开始标签和 </style> 结束标签
  const contentMatch = rawBlock.match(/^<style[^>]*>\n?([\s\S]*?)\n?<\/style>$/);
  return contentMatch ? contentMatch[1] : rawBlock;
}

/**
 * 从 Svelte template AST 中提取组件引用。
 * Svelte 约定大写开头的标签为组件，小写标签为 HTML 元素。
 * 也处理 <svelte:xxx> 特殊元素。
 */
// Svelte parse() 返回的 AST 中 html 字段的类型
type SvelteHtmlAst = ReturnType<typeof parseSvelte>["html"];

function extractTemplateComponents(
  html: SvelteHtmlAst | null,
  content: string,  // 原始文件内容，用于字符偏移转行号
): TemplateComponentRef[] {
  if (!html) return [];

  const components: TemplateComponentRef[] = [];
  const isComponentTag = (name: string) => /^[A-Z]/.test(name);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Svelte AST nodes are dynamic
  function walk(node: any) {
    if (!node) return;

    // Svelte AST 节点类型
    if (node.type === "Component" || (node.type === "InlineComponent" && isComponentTag(node.name))) {
      components.push({
        name: node.name,
        lineNumber: node.start ? content.slice(0, node.start).split("\n").length : 0,
      });
    }

    // 递归子节点
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }

    // 处理 if/each/await 块的子节点
    if (node.else) walk(node.else);
    if (node.then) walk(node.then);
    if (node.catch) walk(node.catch);
  }

  if (html.children) {
    for (const child of html.children) {
      walk(child);
    }
  }
  return components;
}
