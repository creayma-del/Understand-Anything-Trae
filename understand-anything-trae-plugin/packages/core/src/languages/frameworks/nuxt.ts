import type { FrameworkConfig } from "../types.js";

export const nuxtConfig = {
  id: "nuxt",
  displayName: "Nuxt",
  languages: ["typescript", "javascript", "vue-sfc"],
  detectionKeywords: [
    "\"nuxt\":",
    "\"nuxtjs\":",
    "nuxt3",
    "@nuxt/",
  ],
  manifestFiles: ["package.json", "nuxt.config.ts", "nuxt.config.js"],
  promptSnippetPath: "./frameworks/nuxt.md",
  entryPoints: [
    "app.vue",
    "pages/index.vue",
  ],
  layerHints: {
    pages: "ui",
    components: "ui",
    layouts: "ui",
    composables: "service",
    server: "api",
    "server/api": "api",
    "server/routes": "api",
    "server/middleware": "middleware",
    "server/utils": "service",
    middleware: "middleware",
    plugins: "config",
    utils: "utility",
  },
} satisfies FrameworkConfig;
