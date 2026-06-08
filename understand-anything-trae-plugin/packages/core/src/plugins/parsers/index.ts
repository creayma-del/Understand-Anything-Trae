export { MarkdownParser } from "./markdown-parser.js";
export { YAMLConfigParser } from "./yaml-parser.js";
export { JSONConfigParser } from "./json-parser.js";
export { TOMLParser } from "./toml-parser.js";
export { EnvParser } from "./env-parser.js";
export { DockerfileParser } from "./dockerfile-parser.js";
export { SQLParser } from "./sql-parser.js";
export { GraphQLParser } from "./graphql-parser.js";
export { MakefileParser } from "./makefile-parser.js";
export { ShellParser } from "./shell-parser.js";
export { VueSfcPlugin } from "./vue-sfc-parser.js";
export { SveltePlugin } from "./svelte-parser.js";
export { CssPlugin } from "./css-parser.js";
export { HtmlPlugin } from "./html-parser.js";
export { mergeStyleAnalysis, type StyleBlockMeta } from "./sfc-utils.js";

import type { PluginRegistry } from "../registry.js";
import type { TreeSitterPlugin } from "../tree-sitter-plugin.js";
import { MarkdownParser } from "./markdown-parser.js";
import { YAMLConfigParser } from "./yaml-parser.js";
import { JSONConfigParser } from "./json-parser.js";
import { TOMLParser } from "./toml-parser.js";
import { EnvParser } from "./env-parser.js";
import { DockerfileParser } from "./dockerfile-parser.js";
import { SQLParser } from "./sql-parser.js";
import { GraphQLParser } from "./graphql-parser.js";
import { MakefileParser } from "./makefile-parser.js";
import { ShellParser } from "./shell-parser.js";
import { VueSfcPlugin } from "./vue-sfc-parser.js";
import { SveltePlugin } from "./svelte-parser.js";
import { CssPlugin } from "./css-parser.js";
import { HtmlPlugin } from "./html-parser.js";

/**
 * Register all built-in non-code parsers with a PluginRegistry.
 * @param registry The plugin registry to register parsers with.
 * @param tsPlugin Optional TreeSitterPlugin reference for Vue SFC parser.
 * @param cssPlugin Optional CssPlugin reference for Vue/Svelte style block analysis.
 */
export function registerAllParsers(registry: PluginRegistry, tsPlugin?: TreeSitterPlugin, cssPlugin?: CssPlugin): void {
  registry.register(new MarkdownParser());
  registry.register(new YAMLConfigParser());
  registry.register(new JSONConfigParser());
  registry.register(new TOMLParser());
  registry.register(new EnvParser());
  registry.register(new DockerfileParser());
  registry.register(new SQLParser());
  registry.register(new GraphQLParser());
  registry.register(new MakefileParser());
  registry.register(new ShellParser());

  // Vue SFC plugin — needs TreeSitterPlugin + optional CssPlugin for style block analysis
  if (tsPlugin) {
    const vuePlugin = new VueSfcPlugin();
    vuePlugin.init(tsPlugin, cssPlugin);
    registry.register(vuePlugin);
  }

  // Svelte plugin — needs TreeSitterPlugin + optional CssPlugin for style block analysis
  if (tsPlugin) {
    const sveltePlugin = new SveltePlugin();
    sveltePlugin.init(tsPlugin, cssPlugin);
    registry.register(sveltePlugin);
  }

  // HTML plugin — 无外部依赖，直接注册
  registry.register(new HtmlPlugin());

  // CSS/SCSS plugin — 无需 TreeSitterPlugin 引用
  registry.register(new CssPlugin());
}
