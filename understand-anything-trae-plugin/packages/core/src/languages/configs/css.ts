import type { LanguageConfig } from "../types.js";

export const cssConfig = {
  id: "css",
  displayName: "CSS",
  extensions: [".css", ".scss", ".sass", ".less"],
  concepts: [
    // 基础 CSS
    "selectors",
    "properties",
    "media queries",
    "flexbox",
    "grid",
    "custom properties (--var)",
    "animations",
    "specificity",
    // SCSS/Sass 特有
    "nesting",
    "$variables",
    "@mixin / @include",
    "@extend",
    "@use / @forward",
    "@function",
    "placeholder selectors (%)",
    "partial imports (_*.scss)",
    "interpolation (#{})",
    "lists and maps",
    "flow control (@if, @each, @for, @while)",
    // CSS Modules
    "CSS Modules (.module.css)",
    "scoped class names",
    // Tailwind CSS
    "utility classes",
    "@apply",
    "@tailwind directives",
    "purge/content config",
    // 现代 CSS
    "cascade layers (@layer)",
    "container queries",
    "color-mix()",
    "logical properties",
    "subgrid",
  ],
  filePatterns: {
    entryPoints: [
      "globals.css",
      "global.css",
      "index.css",
      "main.css",
      "app.css",
      "styles.css",
    ],
    barrels: [
      "_index.scss",
      "_index.sass",
    ],
    tests: [],
    config: [
      "tailwind.config.js",
      "tailwind.config.ts",
      "tailwind.config.mjs",
      "tailwind.config.cjs",
      "postcss.config.js",
      "postcss.config.ts",
      "postcss.config.mjs",
      "postcss.config.cjs",
      ".postcssrc.js",
      ".postcssrc.json",
      ".postcssrc.yml",
      ".postcssrc.cjs",
      ".postcssrc.mjs",
    ],
  },
} satisfies LanguageConfig;
