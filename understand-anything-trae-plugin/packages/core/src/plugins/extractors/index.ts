export type { LanguageExtractor, TreeSitterNode } from "./types.js";
export { traverse, getStringValue, findChild, findChildren, hasChildOfType } from "./base-extractor.js";
export { TypeScriptExtractor } from "./typescript-extractor.js";
export { PythonExtractor } from "./python-extractor.js";

import type { LanguageExtractor } from "./types.js";
import { TypeScriptExtractor } from "./typescript-extractor.js";
import { PythonExtractor } from "./python-extractor.js";

export const builtinExtractors: LanguageExtractor[] = [
  new TypeScriptExtractor(),
  new PythonExtractor(),
];
