import type { LanguageConfig } from "../types.js";
import { typescriptConfig } from "./typescript.js";
import { javascriptConfig } from "./javascript.js";
import { pythonConfig } from "./python.js";
import { vueSfcConfig } from "./vue-sfc.js";
import { svelteConfig } from "./svelte.js";
// Non-code language configs
import { markdownConfig } from "./markdown.js";
import { yamlConfig } from "./yaml.js";
import { jsonConfigConfig } from "./json-config.js";
import { tomlConfig } from "./toml.js";
import { envConfig } from "./env.js";
import { dockerfileConfig } from "./dockerfile.js";
import { sqlConfig } from "./sql.js";
import { graphqlConfig } from "./graphql.js";
import { makefileConfig } from "./makefile.js";
import { shellConfig } from "./shell.js";
import { htmlConfig } from "./html.js";
import { cssConfig } from "./css.js";
import { restructuredtextConfig } from "./restructuredtext.js";
import { plaintextConfig } from "./plaintext.js";

export const builtinLanguageConfigs: LanguageConfig[] = [
  // Code languages
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  vueSfcConfig,
  svelteConfig,
  // Non-code languages
  markdownConfig,
  yamlConfig,
  jsonConfigConfig,
  tomlConfig,
  envConfig,
  dockerfileConfig,
  sqlConfig,
  graphqlConfig,
  makefileConfig,
  shellConfig,
  htmlConfig,
  cssConfig,
  restructuredtextConfig,
  plaintextConfig,
];

export {
  // Code languages
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  vueSfcConfig,
  svelteConfig,
  // Non-code languages
  markdownConfig,
  yamlConfig,
  jsonConfigConfig,
  tomlConfig,
  envConfig,
  dockerfileConfig,
  sqlConfig,
  graphqlConfig,
  makefileConfig,
  shellConfig,
  htmlConfig,
  cssConfig,
  restructuredtextConfig,
  plaintextConfig,
};
