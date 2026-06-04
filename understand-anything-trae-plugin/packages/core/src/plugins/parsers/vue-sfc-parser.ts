import type { AnalyzerPlugin, StructuralAnalysis, ImportResolution, CallGraphEntry } from "../../types.js";
import { parse as parseSfc, type SFCTemplateBlock } from "@vue/compiler-sfc";
import type { TreeSitterPlugin } from "../tree-sitter-plugin.js";

/**
 * Template component reference extracted from the SFC template AST.
 */
interface TemplateComponentRef {
  name: string;       // PascalCase component name, e.g. "ChildComponent"
  lineNumber: number; // Line number in the .vue file
}

/**
 * Vue SFC parser plugin.
 *
 * Uses @vue/compiler-sfc to parse .vue files, then delegates script
 * content to TypeScript tree-sitter for structural analysis.
 * Template component references are extracted via the compiler's AST.
 */
export class VueSfcPlugin implements AnalyzerPlugin {
  readonly name = "vue-sfc-parser";
  readonly languages = ["vue-sfc"];

  // Dependencies injected via init()
  private tsPlugin: TreeSitterPlugin | null = null;

  /**
   * Initialize with a reference to the TreeSitterPlugin for
   * TypeScript grammar access.
   */
  init(tsPlugin: TreeSitterPlugin): void {
    this.tsPlugin = tsPlugin;
  }

  analyzeFile(filePath: string, content: string): StructuralAnalysis {
    const { scriptContent, scriptLang, scriptStartLine, templateComponents } =
      parseVueSfc(content, filePath);

    // 如果没有 script 块，仅返回 template 组件引用
    if (!scriptContent) {
      return {
        functions: [],
        classes: [],
        imports: templateComponents.map(comp => ({
          source: comp.name,
          specifiers: [comp.name],
          lineNumber: comp.lineNumber,
        })),
        exports: [],
      };
    }

    // [降级守卫] tsPlugin 未初始化时返回空分析 + template 组件引用
    if (!this.tsPlugin) {
      return {
        functions: [],
        classes: [],
        imports: templateComponents.map(comp => ({
          source: comp.name,
          specifiers: [comp.name],
          lineNumber: comp.lineNumber,
        })),
        exports: [],
      };
    }

    const tsAnalysis = this.tsPlugin.analyzeFile(
      // 传入虚拟路径以触发 TS/JS 语法选择
      scriptLang === "ts" ? "virtual.ts" : "virtual.js",
      scriptContent,
    );

    // 行号偏移修正：script 在 .vue 文件中的起始行
    const lineOffset = scriptStartLine - 1; // compiler-sfc 的行号从 1 开始
    const correctedFunctions = tsAnalysis.functions.map(fn => ({
      ...fn,
      lineRange: [fn.lineRange[0] + lineOffset, fn.lineRange[1] + lineOffset] as [number, number],
    }));
    const correctedClasses = tsAnalysis.classes.map(cls => ({
      ...cls,
      lineRange: [cls.lineRange[0] + lineOffset, cls.lineRange[1] + lineOffset] as [number, number],
    }));
    const correctedImports = tsAnalysis.imports.map(imp => ({
      ...imp,
      lineNumber: imp.lineNumber + lineOffset,
    }));
    const correctedExports = tsAnalysis.exports.map(exp => ({
      ...exp,
      lineNumber: exp.lineNumber + lineOffset,
    }));

    // 合并 template 组件引用到 imports
    // （仅补充 script 中未 import 的组件引用）
    // 去重：检查组件名是否已出现在 import specifiers 中
    const importedSpecifiers = new Set(correctedImports.flatMap(i => i.specifiers));
    const templateImports = templateComponents
      .filter(comp => !importedSpecifiers.has(comp.name))
      .map(comp => ({
        source: comp.name,
        specifiers: [comp.name],
        lineNumber: comp.lineNumber,
      }));

    return {
      functions: correctedFunctions,
      classes: correctedClasses,
      imports: [...correctedImports, ...templateImports],
      exports: correctedExports,
    };
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
    const { scriptContent, scriptLang, scriptStartLine } = parseVueSfc(content, filePath);
    if (!scriptContent || !this.tsPlugin) return [];

    const callGraph = this.tsPlugin.extractCallGraph(
      scriptLang === "ts" ? "virtual.ts" : "virtual.js",
      scriptContent,
    );

    // 行号偏移修正
    const lineOffset = scriptStartLine - 1;
    return callGraph.map(entry => ({
      ...entry,
      lineNumber: entry.lineNumber + lineOffset,
    }));
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Vue SFC file using @vue/compiler-sfc.
 */
function parseVueSfc(content: string, filePath: string) {
  const { descriptor } = parseSfc(content, {
    filename: filePath,
    // 不需要 sourceMap
  });

  // 提取 script 内容（优先 scriptSetup，其次 script）
  const scriptBlock = descriptor.scriptSetup ?? descriptor.script;
  const scriptContent = scriptBlock?.content ?? "";
  const scriptLang = scriptBlock?.lang ?? "js";
  const scriptStartLine = scriptBlock?.loc.start.line ?? 1;

  // 提取 template 中的组件引用
  const templateComponents = extractTemplateComponents(descriptor.template);

  return { scriptContent, scriptLang, scriptStartLine, templateComponents, descriptor };
}

/**
 * 从 template AST 中提取 PascalCase 组件引用。
 * Vue 约定 PascalCase 标签为组件，小写标签为 HTML 元素。
 */
function extractTemplateComponents(
  template: SFCTemplateBlock | null | undefined,
): TemplateComponentRef[] {
  if (!template?.ast) return [];

  const components: TemplateComponentRef[] = [];
  const isPascalCase = (name: string) => /^[A-Z]/.test(name);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vue template AST nodes are dynamic
  function walk(node: any) {
    if (node.type === 1 /* NodeTypes.ELEMENT */) {
      if (isPascalCase(node.tag)) {
        components.push({
          name: node.tag,
          lineNumber: node.loc.start.line,
        });
      }
      // 递归子节点
      if (node.children) {
        for (const child of node.children) {
          walk(child);
        }
      }
    } else if (node.type === 0 /* NodeTypes.ROOT */ ||
               node.type === 2 /* NodeTypes.TEXT */ ||
               node.type === 5 /* NodeTypes.INTERPOLATION */) {
      // 跳过非元素节点
      if (node.children) {
        for (const child of node.children) {
          walk(child);
        }
      }
    }
  }

  walk(template.ast);
  return components;
}
