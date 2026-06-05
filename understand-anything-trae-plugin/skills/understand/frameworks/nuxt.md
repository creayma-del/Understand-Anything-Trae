# Nuxt Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Nuxt is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Nuxt Project Structure

When analyzing a Nuxt project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `nuxt.config.ts` | Framework configuration — defines modules, runtime config, app behavior | `config`, `entry-point` |
| `app.vue` | Root application component — wraps NuxtPage and sets top-level layout | `entry-point`, `ui` |
| `pages/**/*.vue` | File-based route pages — path determines URL | `ui`, `routing` |
| `layouts/*.vue` | Layout templates — wrap page content with shared UI (nav, footer) | `ui`, `config` |
| `components/**/*.vue` | Auto-imported UI components — no manual import needed | `ui` |
| `composables/*.ts`, `composables/**/*.ts` | Auto-imported composable functions — reusable stateful logic | `service`, `utility` |
| `server/api/**` | API route handlers — define serverless endpoints (GET, POST, etc.) | `api-handler` |
| `server/routes/**` | Server routes — more flexible server-side routing | `api-handler` |
| `server/middleware/*.ts` | Server middleware — intercepts requests before reaching route handlers | `middleware` |
| `server/utils/*.ts` | Server utility functions — shared server-side logic | `service` |
| `middleware/*.ts` | Client-side route middleware — navigation guards (auth, redirects) | `middleware` |
| `plugins/*.ts`, `plugins/**/*.ts` | Auto-registered plugins — extend app functionality at startup | `config` |
| `utils/*.ts` | Auto-imported utility functions — pure helper functions | `utility` |
| `error.vue` | Global error page — catches unhandled errors across the app | `ui`, `config` |
| `assets/**` | Build-processed static assets — styles, images processed by Vite | `resource` |
| `public/**` | Public static files — served as-is at root path | `resource` |

### Edge Patterns to Look For

**Page-to-layout binding** — When a page component declares `definePageMeta({ layout: 'custom' })`, create `depends_on` edges from the page to the named layout. Pages without explicit layout assignment use `layouts/default.vue`.

**Component-to-composable** — When a component or page calls a `useX()` function from `composables/`, create `depends_on` edges from the consumer to the composable module. Nuxt auto-imports make these implicit — check for `use`-prefixed calls even without explicit import statements.

**Server route-to-server util** — When a `server/api/` handler imports from `server/utils/`, create `depends_on` edges. Server utilities are auto-imported within the server directory — look for direct function calls without import statements.

**Auto-imported component usage** — When a template uses a PascalCase component tag that matches a file in `components/`, create `contains` edges from the parent to the child component, even without explicit import statements. Nuxt resolves components by directory path and filename.

**Plugin registration** — Plugins in `plugins/` are auto-registered. When a plugin calls `defineNuxtPlugin()` and provides `provide` or `setup`, create `configures` edges from the plugin to the capabilities it injects.

**Middleware chain** — When `middleware/*.ts` files export route guard functions, and pages reference them via `definePageMeta({ middleware: ['auth'] })`, create `depends_on` edges from the page to the middleware module.

### Architectural Layers for Nuxt

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | `pages/`, `components/`, `layouts/`, `app.vue`, `error.vue` |
| `layer:api` | API Layer | `server/api/`, `server/routes/` |
| `layer:service` | Service Layer | `composables/`, `server/utils/` |
| `layer:middleware` | Middleware Layer | `server/middleware/`, `middleware/` (client-side) |
| `layer:config` | Config Layer | `nuxt.config.ts`, `plugins/`, `app.vue` (as layout host) |

### Notable Patterns to Capture in languageLesson

- **Auto-imports**: Nuxt automatically imports components, composables, and utilities — no manual import statements needed. This means dependencies may be implicit and must be inferred from usage patterns (e.g., `useX()` calls imply a `composables/useX.ts` file).

- **File-based routing**: The `pages/` directory defines routes by file path — `pages/users/[id].vue` maps to `/users/:id`. Dynamic segments use `[param]` syntax. This replaces manual Vue Router configuration.

- **Server routes**: The `server/api/` directory creates API endpoints by file path — `server/api/hello.ts` maps to `/api/hello`. Each file exports an event handler using `defineEventHandler()`. This is Nuxt's built-in alternative to Express or other server frameworks.

- **Hybrid rendering**: Nuxt supports per-route rendering modes via `routeRules` in `nuxt.config.ts` — routes can be SSR, SPA, prerendered, or use SWR caching. Check `routeRules` to understand the rendering strategy for each page.

- **Layout system**: `layouts/default.vue` wraps all pages by default. Custom layouts are selected per-page via `definePageMeta({ layout: 'custom' })`. Layouts contain `<slot />` where page content is injected.

- **Nuxt modules**: `@nuxt/` prefixed packages (e.g., `@nuxt/content`, `@nuxt/image`) are Nuxt modules that extend the framework. They are registered in `nuxt.config.ts` modules array and may inject components, composables, or server routes.
