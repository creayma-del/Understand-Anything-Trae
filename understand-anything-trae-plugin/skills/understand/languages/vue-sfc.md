# Vue SFC Language Prompt Snippet

## Key Concepts

- **Single-File Components**: `.vue` files encapsulate template, script, and style in one file
- **Composition API**: `setup()` function and `<script setup>` syntax with composables
- **Options API**: `data()`, `methods`, `computed`, `watch` object-based API
- **Compiler Macros**: `defineProps`, `defineEmits`, `defineExpose`, `defineModel`, `withDefaults`
- **Reactivity**: `ref()`, `reactive()`, `computed()`, `watch()`, `watchEffect()`
- **Component Communication**: props down, events up, provide/inject for deep passing
- **Scoped Styles**: `<style scoped>` limits CSS to the component; `<style module>` uses CSS Modules
- **v-bind in CSS**: `v-bind(property)` to use reactive values in CSS
- **Slots**: Default slots, named slots, scoped slots for content distribution
- **Directives**: v-model, v-if/v-else/v-else-if, v-for, v-show, v-slot, v-once, v-memo

## Notable File Patterns

- `*.vue` — Vue Single File Components
- `App.vue` — Root application component
- `*.spec.vue`, `*.test.vue` — Vue component test files
- `<script setup>` — Recommended concise syntax (Composition API)
- `<script>` + `setup()` — Explicit Composition API setup function
- `<script>` — Options API (legacy)

## Edge Patterns

- Vue SFC files are `contains` by the parent component that imports them
- `<script setup>` imports are `imports` edges to other modules
- Template component references (PascalCase tags) are `imports` edges to child components
- `defineProps` creates `depends_on` edges from the component to the prop type definitions
- `defineEmits` creates `depends_on` edges from the component to event type definitions
- `provide/inject` creates implicit `depends_on` edges across the component tree
- Scoped styles are `related` to the component they style
- Composable usage (`useX()`) creates `depends_on` edges to the composable module

## Summary Style

> "Vue SFC component implementing a search form with debounced input, emits search events to parent."
> "Root App.vue component mounting the top-level layout with router-view and global navigation."
> "Vue SFC with script setup defining reactive form state, computed validation, and API submission logic."
