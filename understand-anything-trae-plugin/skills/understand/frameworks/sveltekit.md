# SvelteKit Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when SvelteKit is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## SvelteKit Project Structure

When analyzing a SvelteKit project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `src/routes/+page.svelte` | Route page component — renders UI for a URL path | `entry-point`, `ui`, `routing` |
| `src/routes/+page.ts` | Page load function — fetches data before page renders (universal) | `service`, `routing` |
| `src/routes/+page.server.ts` | Server-only page load function — accesses databases, secrets | `service`, `routing`, `server` |
| `src/routes/+layout.svelte` | Layout component — wraps child routes with shared UI (nav, sidebar) | `ui`, `config`, `routing` |
| `src/routes/+layout.ts` | Layout load function — provides shared data to nested routes (universal) | `service`, `routing` |
| `src/routes/+layout.server.ts` | Server-only layout load function | `service`, `routing`, `server` |
| `src/routes/+error.svelte` | Error boundary component — renders when load functions throw | `ui`, `routing` |
| `src/routes/+loading.svelte` | Loading state component — shown during navigation transitions | `ui`, `routing` |
| `src/routes/**/+server.ts` | API route handler — exports GET/POST/PUT/PATCH/DELETE functions | `api-handler`, `server` |
| `src/hooks.server.ts` | Server hooks — `handle` intercepts requests, `handleFetch` proxies external requests | `middleware`, `server` |
| `src/hooks.client.ts` | Client hooks — `handleError` catches unhandled errors | `middleware` |
| `src/lib/components/**/*.svelte` | Shared UI components — reusable across routes | `ui` |
| `src/lib/server/**/*.ts` | Server-only utility code — database, auth, secrets | `service`, `server` |
| `src/lib/*.ts`, `src/lib/**/*.ts` | Shared utility functions, stores, type definitions | `service`, `utility` |
| `src/params/*.ts` | Custom parameter matchers — validate dynamic route segments | `utility`, `routing` |
| `src/app.html` | HTML shell template — contains `%sveltekit.head%` and `%sveltekit.body%` | `config` |
| `svelte.config.js`, `svelte.config.ts` | SvelteKit configuration — adapter selection, prerender, CSRF settings | `config` |
| `static/**` | Static assets — served as-is, no processing | `resource` |

### Edge Patterns to Look For

**Layout nesting** — When `src/routes/+layout.svelte` wraps `src/routes/about/+layout.svelte`, which wraps `src/routes/about/+page.svelte`, create `contains` edges from each layout to its child routes/layouts. Layouts compose via the file-system hierarchy — each directory can have its own layout that wraps all nested content.

**Page-to-layout data flow** — When `+page.ts` or `+page.server.ts` exports a `load` function that returns data, and `+page.svelte` receives it via `$page.data`, create `depends_on` edges from the page component to its load function module. Layout load functions feed data to all nested pages via `$page.data` merging.

**API route handlers** — When `+server.ts` exports named HTTP method functions (GET, POST, PUT, DELETE, PATCH), create edges from consuming components to the API handler based on fetch calls or form actions. Each exported method is a standalone endpoint.

**Form actions** — When `+page.server.ts` exports an `actions` object with named form handlers, create `depends_on` edges from the page component to its action handlers. Form actions are invoked via `use:enhance` or native form submission.

**$lib alias imports** — When a file imports from `$lib/...`, resolve to `src/lib/...`. Create `imports` edges from the consumer to the resolved module. `$lib` is the canonical way to share code across routes in SvelteKit.

**$app stores** — When a component uses `$page`, `$navigating`, or `$updated` from `$app/stores`, create `depends_on` edges to the SvelteKit runtime. These stores provide route-aware reactive state.

**$app/navigation functions** — When `goto()`, `invalidate()`, `pushState()`, or `replaceState()` are called from `$app/navigation`, create `depends_on` edges to the navigation module. These enable programmatic routing.

**$app/server utilities** — When `redirect()`, `error()`, `json()`, or `fail()` are called from `$app/server`, create `depends_on` edges. These are the standard way to handle responses in load functions and actions.

**Server/client boundary** — Files named `*.server.ts` or located in `src/lib/server/` run only on the server. `+page.server.ts` and `+layout.server.ts` are server-only. Create `depends_on` edges that cross this boundary and note the boundary in the edge description.

**Route groups** — Directories wrapped in parentheses `(group)` organize routes without affecting the URL path. Note these in node descriptions. They are used for shared layouts without URL impact.

**Adapter configuration** — When `svelte.config.js` configures an adapter (`@sveltejs/adapter-auto`, `@sveltejs/adapter-node`, `@sveltejs/adapter-static`, etc.), note the deployment target in the project description. The adapter determines how the app is built and deployed.

### Architectural Layers for SvelteKit

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | `src/routes/` (+page.svelte, +layout.svelte, +error.svelte, +loading.svelte), `src/lib/components/` |
| `layer:service` | Service Layer | `src/lib/` (non-component), `src/routes/+page.ts`, `src/routes/+page.server.ts`, `src/routes/+layout.ts`, `src/routes/+layout.server.ts`, `src/lib/server/` |
| `layer:middleware` | Middleware Layer | `src/hooks.server.ts`, `src/hooks.client.ts` |
| `layer:utility` | Utility Layer | `src/params/`, pure utility functions in `src/lib/` |
| `layer:resource` | Resource Layer | `static/`, `src/app.html` |
| `layer:api` | API Layer | `src/routes/**/+server.ts` API route handlers |
| `layer:config` | Config Layer | `svelte.config.js`, `svelte.config.ts`, `vite.config.ts` |
| `layer:test` | Test Layer | `*.test.ts`, `*.spec.ts`, `tests/`, `__tests__/` |

### SvelteKit-Specific Patterns to Capture in languageLesson

- **File-based routing**: Routes are defined by the file-system structure under `src/routes/` — each `+page.svelte` maps to a URL, and directory structure determines the path hierarchy
- **Server load functions**: `+page.server.ts` and `+layout.server.ts` run only on the server, with direct access to databases and secrets — they return data that is serialized and sent to the client
- **Universal load functions**: `+page.ts` and `+layout.ts` run on both server and client — they can access `$app/stores` and are used for client-side navigation data fetching
- **Form actions**: The `actions` export in `+page.server.ts` handles form submissions with progressive enhancement — `use:enhance` enables SPA-like behavior while maintaining no-JS fallback
- **Layout composition**: Layouts nest via the file-system — each directory's `+layout.svelte` wraps all nested content, and `+layout.ts` data cascades down to children
- **$lib alias**: The `$lib` import alias resolves to `src/lib/` — it is the standard way to share code across routes, replacing relative `../../` imports
- **Adapters**: SvelteKit uses adapters to deploy to different platforms (`adapter-node`, `adapter-static`, `adapter-vercel`, `adapter-cloudflare`) — the adapter in `svelte.config.js` determines the build output format
- **Route groups**: Parenthesized directories like `(auth)` group routes for shared layouts without affecting the URL — useful for organizing routes with common UI or logic
- **Error boundaries**: `+error.svelte` components catch errors from load functions in their route segment — they receive `$page.error` and `$page.status` for rendering error UI
- **Hooks**: `src/hooks.server.ts` provides `handle` (intercepts every request) and `handleFetch` (intercepts fetch calls from server) — they are the SvelteKit equivalent of Express middleware
