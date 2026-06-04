import type { LanguageConfig } from "../types.js";

export const svelteConfig = {
  id: "svelte",
  displayName: "Svelte",
  extensions: [".svelte"],
  // 不设 treeSitter 字段 — tree-sitter-svelte WASM 不可用
  // 结构化提取由 SveltePlugin（svelte/compiler + TS tree-sitter）承担
  concepts: [
    // 组件模型
    "single-file components",
    "reactive declarations",
    "reactive statements",
    // 响应式
    "$: labels",
    "reactive assignments",
    "stores",
    "$store auto-subscription",
    // Svelte 5 Runes
    "$state",
    "$derived",
    "$effect",
    "$props",
    "$bindable",
    "$inspect",
    // 组件通信
    "props (export let)",
    "events (createEventDispatcher)",
    "context API (setContext/getContext)",
    "slots",
    // 生命周期
    "onMount",
    "onDestroy",
    "beforeUpdate",
    "afterUpdate",
    // 模板
    "template expressions",
    "if/else blocks",
    "each blocks",
    "await blocks",
    "key blocks",
    // 特殊元素
    "<svelte:head>",
    "<svelte:options>",
    "<svelte:window>",
    "<svelte:body>",
    "<svelte:element>",
    "<svelte:component>",
    "<svelte:self>",
    // 高级
    "actions (use:directive)",
    "transitions",
    "animations",
    "scoped styles",
  ],
  filePatterns: {
    entryPoints: ["src/routes/+layout.svelte", "src/App.svelte"],
    barrels: ["+layout.svelte"],
    tests: ["*.test.svelte", "*.spec.svelte"],
    config: ["svelte.config.js", "svelte.config.ts"],
  },
} satisfies LanguageConfig;
