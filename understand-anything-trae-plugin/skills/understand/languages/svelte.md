# Svelte Language Prompt Snippet

## Key Concepts

- **Single-File Components**: `.svelte` files combine script, template, and style
- **Reactive Declarations**: `$: doubled = count * 2` — auto-updates when dependencies change
- **Reactive Statements**: `$: if (count > 10) { ... }` — runs when dependencies change
- **Store Auto-Subscription**: `$storeName` — auto-subscribes and unsubscribes to Svelte stores
- **Component Props**: `export let propName` — declares component inputs
- **Component Events**: `createEventDispatcher()` or Svelte 5 `$emit` — component outputs
- **Context API**: `setContext(key, value)` / `getContext(key)` — dependency injection without props
- **Slots**: Default and named slots for content distribution
- **Actions**: `use:action` — DOM element behavior attachment
- **Transitions**: `transition:fade`, `in:fly`, `out:slide` — enter/exit animations
- **Scoped Styles**: `<style>` block is scoped by default (no `scoped` attribute needed)
- **Svelte 5 Runes**: `$state()`, `$derived()`, `$effect()`, `$props()` — new reactivity model

## Svelte 5 Runes

- `$state(value)` — declares reactive state; replaces `let` reactive variables
- `$derived(expression)` — declares derived reactive value; replaces `$:` reactive declarations
- `$effect(() => { ... })` — declares side effect; replaces `$:` reactive statements and lifecycle hooks
- `$props()` — declares component props; replaces `export let`
- `$bindable(value)` — declares a bindable prop (two-way binding)
- `$inspect()` — debug utility for reactive values
- `*.svelte.ts` files can use runes outside of `.svelte` components

## Notable File Patterns

- `*.svelte` — Svelte components
- `+layout.svelte`, `+page.svelte` — SvelteKit route components
- `+error.svelte` — SvelteKit error page
- `*.svelte.ts` — Svelte 5 module with runes
- `svelte.config.js` — Svelte/SvelteKit configuration

## Edge Patterns

- Svelte components are `contains` by the parent that imports them
- `export let` declarations are `exports` edges (component props)
- `$storeName` references are `depends_on` edges to the store module
- `$: reactive = expr` declarations are `depends_on` on the referenced variables
- `import Component from './Component.svelte'` creates `imports` edges
- `<Component />` in template creates `contains` edge from parent to child
- `setContext`/`getContext` creates implicit `depends_on` across component tree
- Scoped styles are `related` to the component they style
- `$state()`, `$derived()`, `$effect()` in Svelte 5 are `depends_on` on their dependencies

## Summary Style

> "Svelte component implementing a counter with reactive doubled value and click handler."
> "SvelteKit page component fetching data from API with loading/error states."
> "Svelte store module exporting a writable store for user authentication state."
> "Svelte 5 component using runes for reactive form state and derived validation."
