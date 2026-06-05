import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import type {
  AnalyzerPlugin,
  StructuralAnalysis,
  ImportResolution,
  HtmlElementInfo,
  SectionInfo,
} from "../../types.js";

/**
 * HTML parser plugin.
 *
 * Uses node-html-parser to parse .html/.htm files, extracting
 * DOM element structure, script/link references, semantic sections,
 * and inline content markers.
 */
export class HtmlPlugin implements AnalyzerPlugin {
  readonly name = "html-parser";
  readonly languages = ["html"];

  analyzeFile(filePath: string, content: string): StructuralAnalysis {
    // [降级守卫] 解析失败时返回空分析
    let root: HTMLElement;
    try {
      root = parseHtml(content, {
        comment: false,       // 不保留注释节点
        blockTextElements: {  // 块级文本元素，保留内容
          script: true,
          style: true,
          pre: true,
        },
      }) as unknown as HTMLElement;
    } catch {
      return {
        functions: [],
        classes: [],
        imports: [],
        exports: [],
      };
    }

    const htmlElements: HtmlElementInfo[] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const sections: SectionInfo[] = [];

    // 语义标签集合
    const SEMANTIC_TAGS = new Set([
      "header", "nav", "main", "article", "section",
      "aside", "footer", "details", "summary", "figure",
    ]);

    // 可导入的 <link> rel 值集合
    // 仅 rel="stylesheet" / rel="modulepreload" 纳入 imports，
    // 其他 rel（icon、prefetch、preconnect 等）为关联资源，不纳入 imports
    const IMPORTABLE_LINK_RELS = new Set(["stylesheet", "modulepreload"]);

    // 外部引用标签映射：标签 → 引用属性
    const REF_ATTR_MAP: Record<string, string> = {
      script: "src",
      link: "href",
      img: "src",
      source: "src",
      iframe: "src",
    };

    // 预计算行号映射表（一次构建，O(1) 查找）
    const lineMap = buildLineMap(content);

    // DOM 遍历
    const visit = (node: HTMLElement) => {
      // 仅处理元素节点（node.nodeType === 1）
      if (node.nodeType !== 1) return;

      // 防御性检查：tagName 可能为 null（如根节点）
      const rawTag = node.tagName;
      if (!rawTag) {
        // 根节点：仅递归子节点
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            visit(child as HTMLElement);
          }
        }
        return;
      }

      const tag = rawTag.toLowerCase();
      const attrs: Record<string, string> = {};
      for (const [key, value] of Object.entries(node.attributes)) {
        attrs[key] = value ?? "";
      }

      // 通过预计算行号映射表计算行范围（含 range[-1,-1] 防御）
      const lineRange = computeLineRange(content, node, lineMap);

      htmlElements.push({
        tag,
        lineRange,
        attributes: attrs,
        isSelfClosing: isVoidElement(tag),
      });

      // 提取外部引用 → imports
      const refAttr = REF_ATTR_MAP[tag];
      if (refAttr && attrs[refAttr]) {
        const source = attrs[refAttr];

        // <link> 标签：仅 rel="stylesheet" / rel="modulepreload" 纳入 imports
        if (tag === "link") {
          const relValues = (attrs.rel ?? "").toLowerCase().split(/\s+/);
          const importableRel = relValues.find(r => IMPORTABLE_LINK_RELS.has(r));
          if (importableRel && !isExternalUrl(source)) {
            imports.push({
              source,
              specifiers: [importableRel], // "stylesheet" 或 "modulepreload"
              lineNumber: lineRange[0],
            });
          }
          // 其他 rel（icon、prefetch、preconnect 等）不纳入 imports
        } else if (!isExternalUrl(source)) {
          imports.push({
            source,
            specifiers: [tag === "script" ? "script" : "resource"],
            lineNumber: lineRange[0],
          });
        }
      }

      // 提取语义标签 → sections
      if (SEMANTIC_TAGS.has(tag)) {
        sections.push({
          name: attrs.id ?? attrs["aria-label"] ?? tag,
          level: semanticTagLevel(tag),
          lineRange,
        });
      }

      // 递归子节点
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          visit(child as HTMLElement);
        }
      }
    };

    visit(root);

    return {
      functions: [],
      classes: [],
      imports,
      exports: [],
      htmlElements,
      sections: sections.length > 0 ? sections : undefined,
    };
  }

  resolveImports(filePath: string, content: string): ImportResolution[] {
    const analysis = this.analyzeFile(filePath, content);
    const dir = filePath.includes("/")
      ? filePath.slice(0, filePath.lastIndexOf("/"))
      : "";

    return analysis.imports
      .filter(imp => !isExternalUrl(imp.source))
      .map(imp => {
        const source = imp.source;
        // 解析相对路径
        let resolvedPath: string;
        if (source.startsWith("./") || source.startsWith("../")) {
          resolvedPath = resolveRelativePath(dir, source);
        } else if (source.startsWith("/")) {
          // 绝对路径（项目根目录）
          resolvedPath = source.slice(1); // 去掉前导 /
        } else {
          resolvedPath = dir ? `${dir}/${source}` : source;
        }

        return {
          source,
          resolvedPath,
          specifiers: imp.specifiers,
        };
      });
  }
}

// ---------------------------------------------------------------------------
// 辅助工具函数
// ---------------------------------------------------------------------------

/** HTML void 元素（自闭合标签）集合 */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "param", "source", "track", "wbr",
]);

function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.has(tag);
}

/** 判断是否为外部 URL（不需要解析为项目内部引用） */
function isExternalUrl(url: string): boolean {
  return /^(https?:)?\/\//i.test(url) ||
         /^(data:|blob:|mailto:|tel:|javascript:)/i.test(url);
}

/** 语义标签的层级映射（用于 SectionInfo.level） */
function semanticTagLevel(tag: string): number {
  const LEVEL_MAP: Record<string, number> = {
    header: 1,
    nav: 1,
    main: 1,
    footer: 1,
    article: 2,
    section: 2,
    aside: 2,
    details: 3,
    summary: 4,
    figure: 3,
  };
  return LEVEL_MAP[tag] ?? 2;
}

/**
 * 预计算源文本的行号映射表。
 * 返回 Uint32Array，其中 lineMap[offset] = 行号（从 1 开始）。
 * 一次构建 O(n)，后续每个偏移量查找 O(1)。
 */
function buildLineMap(content: string): Uint32Array {
  const lineMap = new Uint32Array(content.length);
  let line = 1;
  for (let i = 0; i < content.length; i++) {
    lineMap[i] = line;
    if (content[i] === "\n") line++;
  }
  return lineMap;
}

/**
 * 计算元素在文件中的行范围。
 * node-html-parser 的 HTMLElement 有 range: [startOffset, endOffset]。
 *
 * 防御性检查：当 range 未设置或解析失败时，node.range 返回 [-1,-1]
 * （enumerable: false），此时回退到从源文本搜索标签位置计算行号。
 */
function computeLineRange(
  content: string,
  node: HTMLElement,
  lineMap: Uint32Array,
): [number, number] {
  const [start, end] = node.range;

  // 防御性检查：range 为 [-1,-1] 时回退到逐行计数
  if (start === -1 || end === -1) {
    return fallbackLineRange(content, node);
  }

  // O(1) 行号查找
  const startLine = lineMap[start] ?? 1;
  const endLine = lineMap[Math.max(0, end - 1)] ?? startLine; // -1 因为 range[1] 是 exclusive
  return [startLine, endLine];
}

/**
 * range 不可用时的降级行号计算：从源文本中搜索元素标签位置，
 * 逐字符计数换行符确定行号。
 */
function fallbackLineRange(content: string, node: HTMLElement): [number, number] {
  const tag = node.tagName.toLowerCase();
  const tagPattern = `<${tag}`;
  const idx = content.indexOf(tagPattern);
  if (idx === -1) return [1, 1];
  // 逐字符计数换行符
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (content[i] === "\n") line++;
  }
  return [line, line];
}

/**
 * 解析相对路径（简化版，不访问文件系统）。
 * 将 dir 和 relative 拼接，处理 ../ 和 ./ 。
 */
function resolveRelativePath(dir: string, relative: string): string {
  const parts = (dir ? dir.split("/") : []).concat(relative.split("/"));
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}
