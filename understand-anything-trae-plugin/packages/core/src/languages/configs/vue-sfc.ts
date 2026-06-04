import type { LanguageConfig } from "../types.js";

export const vueSfcConfig = {
  id: "vue-sfc",
  displayName: "Vue SFC",
  extensions: [".vue"],
  // 不设 treeSitter 字段 — tree-sitter-vue WASM 不可用
  // 结构化提取由 VueSfcPlugin（@vue/compiler-sfc + TS tree-sitter）承担
  concepts: [
    // 组件模型
    "single-file components",
    "composition API",
    "options API",
    "script setup",
    // 编译宏
    "defineProps",
    "defineEmits",
    "defineExpose",
    "defineModel",
    "defineOptions",
    "defineSlots",
    "withDefaults",
    // 响应式
    "ref",
    "reactive",
    "computed",
    "watch",
    "watchEffect",
    // 组件通信
    "props",
    "emits",
    "provide/inject",
    "slots",
    // 生命周期
    "onMounted",
    "onUnmounted",
    "onBeforeMount",
    // 样式
    "scoped styles",
    "CSS modules",
    "v-bind in CSS",
    // 模板指令
    "v-model",
    "v-if/v-else/v-else-if",
    "v-for",
    "v-show",
    "v-slot",
  ],
  filePatterns: {
    entryPoints: ["src/App.vue", "App.vue"],
    barrels: [],
    tests: ["*.spec.vue", "*.test.vue"],
    config: ["vite.config.ts", "vite.config.js", "vue.config.js", "nuxt.config.ts"],
  },
} satisfies LanguageConfig;
