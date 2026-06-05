import type { AnalyzerPlugin, StructuralAnalysis, ImportResolution, CallGraphEntry } from "../../types.js";
import { parse as parseSfc, type SFCTemplateBlock } from "@vue/compiler-sfc";
import type { TreeSitterPlugin } from "../tree-sitter-plugin.js";
import type { CssPlugin } from "./css-parser.js";

/**
 * Template component reference extracted from the SFC template AST.
 */
interface TemplateComponentRef {
  name: string;       // PascalCase component name, e.g. "ChildComponent"
  lineNumber: number; // Line number in the .vue file
}

/**
 * Style 块元信息，用于标记 scoped/module。
 */
interface StyleBlockMeta {
  scoped: boolean;
  module: boolean;
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
    const { scriptContent, scriptLang, scriptStartLine, templateComponents, descriptor } =
      parseVueSfc(content, filePath);

    // 构建基础结果：script + template 分析
    let result: StructuralAnalysis;

    // 如果没有 script 块，仅返回 template 组件引用
    if (!scriptContent) {
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

      result = {
        functions: correctedFunctions,
        classes: correctedClasses,
        imports: [...correctedImports, ...templateImports],
        exports: correctedExports,
      };
    }

    // style 块分析：委托 CssPlugin
    if (this.cssPlugin && descriptor.styles.length > 0) {
      for (const styleBlock of descriptor.styles) {
        const styleResult = this.cssPlugin.analyzeFile(
          `${filePath}#style`,  // 虚拟路径，触发 CSS/SCSS 语法选择
          styleBlock.content,
        );

        // 行号偏移修正：style 块在 .vue 文件中的起始行
        // styleBlock.loc.start.line 是 <style> 标签所在行号（1-based）
        // CssPlugin 返回的行号基于 styleBlock.content（从第 1 行开始）
        // .vue 文件实际行号 = CssPlugin 行号 + styleBlock.loc.start.line
        const styleOffset = styleBlock.loc.start.line;

        // 识别 v-bind() in CSS
        const vBindRefs = extractVBindReferences(styleBlock.content, styleOffset);
        for (const ref of vBindRefs) {
          styleResult.imports.push({
            source: ref.variable,
            specifiers: ["v-bind"],
            lineNumber: ref.lineNumber,
          });
        }

        // 合并 style 分析结果到主结果
        this.mergeStyleAnalysis(result, styleResult, styleOffset, {
          scoped: styleBlock.scoped ?? false,
          module: styleBlock.module != null,
        });
      }
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

  /**
   * 将 CssPlugin 对 style 块的分析结果合并到主 StructuralAnalysis 中。
   *
   * 处理：
   * 1. cssRules 行号偏移修正 + scoped/module 标记
   * 2. imports 行号偏移修正
   * 3. exports 行号偏移修正
   */
  private mergeStyleAnalysis(
    result: StructuralAnalysis,
    styleResult: StructuralAnalysis,
    lineOffset: number,
    meta: StyleBlockMeta,
  ): void {
    // 确保 cssRules 数组存在
    if (!result.cssRules) {
      result.cssRules = [];
    }

    // 1. 合并 cssRules（行号偏移 + 标签标记）
    for (const rule of styleResult.cssRules ?? []) {
      const tags: string[] = [...(rule.tags ?? [])];
      if (meta.scoped) tags.push("scoped-style");
      if (meta.module) tags.push("css-modules");

      result.cssRules.push({
        ...rule,
        lineRange: [
          rule.lineRange[0] + lineOffset,
          rule.lineRange[1] + lineOffset,
        ] as [number, number],
        tags,
      });
    }

    // 2. 合并 imports（行号偏移）
    for (const imp of styleResult.imports) {
      result.imports.push({
        ...imp,
        lineNumber: imp.lineNumber + lineOffset,
      });
    }

    // 3. 合并 exports（行号偏移）
    for (const exp of styleResult.exports) {
      result.exports.push({
        ...exp,
        lineNumber: exp.lineNumber + lineOffset,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * 识别 Vue v-bind() in CSS 模式。
 * 示例：color: v-bind(primaryColor);
 * 生成 depends_on 边：style 规则 → script 中的响应式变量
 */
function extractVBindReferences(
  styleContent: string,
  styleOffset: number,
): Array<{ variable: string; lineNumber: number }> {
  const references: Array<{ variable: string; lineNumber: number }> = [];
  const vBindRegex = /v-bind\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g;

  const lines = styleContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    while ((match = vBindRegex.exec(line)) !== null) {
      references.push({
        variable: match[1],
        lineNumber: i + 1 + styleOffset,  // 1-based + 偏移
      });
    }
    vBindRegex.lastIndex = 0;  // 重置正则状态
  }

  return references;
}

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
