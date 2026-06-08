import type { StructuralAnalysis } from "../../types.js";

/**
 * Style 块元信息，用于标记 scoped/module。
 */
export interface StyleBlockMeta {
  scoped: boolean;
  module: boolean;
}

/**
 * 将 CssPlugin 对 style 块的分析结果合并到主 StructuralAnalysis 中。
 *
 * 处理：
 * 1. cssRules 行号偏移修正 + scoped/module 标记
 * 2. imports 行号偏移修正
 * 3. exports 行号偏移修正
 *
 * @param result 主分析结果对象，将被就地修改
 * @param styleResult CSS 插件返回的样式分析结果
 * @param lineOffset 行号偏移量，通常为 style 块在 SFC 文件中的起始行号
 * @param meta Style 块的元信息，用于标记 scoped/module 属性
 */
export function mergeStyleAnalysis(
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
