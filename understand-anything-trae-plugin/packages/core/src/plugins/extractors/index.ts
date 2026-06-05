export type { LanguageExtractor, TreeSitterNode } from "./types.js";
export { traverse, getStringValue, findChild, findChildren, hasChildOfType } from "./base-extractor.js";
export { TypeScriptExtractor } from "./typescript-extractor.js";
export { ReactExtractor } from "./react-extractor.js";

import type { LanguageExtractor } from "./types.js";
import { ReactExtractor } from "./react-extractor.js";

export const builtinExtractors: LanguageExtractor[] = [
  new ReactExtractor(),
];
