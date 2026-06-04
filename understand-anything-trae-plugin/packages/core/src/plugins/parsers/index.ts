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

/**
 * Register all built-in non-code parsers with a PluginRegistry.
 * @param registry The plugin registry to register parsers with.
 * @param tsPlugin Optional TreeSitterPlugin reference for Vue SFC parser.
 */
export function registerAllParsers(registry: PluginRegistry, tsPlugin?: TreeSitterPlugin): void {
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

  // Vue SFC plugin — needs TreeSitterPlugin reference for TypeScript grammar access
  if (tsPlugin) {
    const vuePlugin = new VueSfcPlugin();
    vuePlugin.init(tsPlugin);
    registry.register(vuePlugin);
  }

  // Svelte plugin — needs TreeSitterPlugin reference for TypeScript grammar access
  if (tsPlugin) {
    const sveltePlugin = new SveltePlugin();
    sveltePlugin.init(tsPlugin);
    registry.register(sveltePlugin);
  }
}
