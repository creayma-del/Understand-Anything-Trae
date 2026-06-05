import type { FrameworkConfig } from "../types.js";

export const sveltekitConfig = {
  id: "sveltekit",
  displayName: "SvelteKit",
  languages: ["typescript", "javascript", "svelte"],
  detectionKeywords: ["@sveltejs/kit", "@sveltejs/adapter-"],
  manifestFiles: ["package.json", "svelte.config.js", "svelte.config.ts"],
  promptSnippetPath: "./frameworks/sveltekit.md",
  entryPoints: [
    "src/routes/+layout.svelte",
    "src/routes/+page.svelte",
    "src/hooks.server.ts",
    "src/hooks.client.ts",
  ],
  layerHints: {
    "src/routes": "ui",
    "src/lib/components": "ui",
    "src/lib": "service",
    "src/hooks": "middleware",
    "src/params": "utility",
    "static": "resource",
  },
} satisfies FrameworkConfig;
