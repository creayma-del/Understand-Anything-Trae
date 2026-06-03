# Understand Anything Trae

## Project Overview
An open-source Trae plugin combining LLM intelligence + static analysis to produce interactive dashboards for understanding codebases. Designed for Trae and Trae CN.

## Prerequisites
- Node.js >= 22 (developed on v24)
- pnpm >= 10 (pinned via `packageManager` field in root `package.json`)

## Architecture
- **Monorepo** with pnpm workspaces
- **understand-anything-trae-plugin/** — Trae plugin containing all source code:
  - **packages/core** — Shared analysis engine (types, persistence, tree-sitter, search, schema, tours, plugins)
  - **packages/dashboard** — React + TypeScript web dashboard (React Flow, Zustand, TailwindCSS v4)
  - **src/** — Skill TypeScript source for `/understand-diff`, `/understand-domain`
  - **skills/** — Skill definitions (`/understand`, `/understand-dashboard`, `/understand-diff`, `/understand-domain`)
  - **agents/** — Agent definitions (project-scanner, file-analyzer, architecture-analyzer, tour-builder, graph-reviewer)

## Dashboard
- Dark luxury theme: deep blacks (#0a0a0a), gold/amber accents (#d4a574), DM Serif Display typography
- Graph-first layout: 75% graph + 360px right sidebar
- No ChatPanel or Monaco Editor
- Sidebar tabs: `Info` (ProjectOverview default → NodeInfo when node selected → LearnPanel in Learn persona, composing) and `Files` (FileExplorer tree built from the structural graph)
- Code viewer: prism-react-renderer source viewer that slides up from the bottom on file node click; an expand button promotes it into a full-screen modal. Source content is fetched from the dev server's `/file-content.json` endpoint, gated by access token + a graph-derived path allowlist
- Schema validation on graph load with error banner

## Agent Pipeline
- Agents write intermediate results to `.understand-anything-trae/intermediate/` on disk (not returned to context)
- Agent model field is omitted from frontmatter so each platform falls back to its configured default — `inherit` was a legacy keyword that some tools treated as a literal model id and rejected with `ProviderModelNotFoundError` (see #167)
- `/understand` auto-triggers `/understand-dashboard` after completion
- Intermediate files cleaned up after graph assembly

## Key Commands
- `pnpm install` — Install all dependencies
- `pnpm --filter @understand-anything-trae/core build` — Build the core package
- `pnpm --filter @understand-anything-trae/core test` — Run core tests
- `pnpm --filter @understand-anything-trae/skill build` — Build the plugin package
- `pnpm test` — Run all tests (skill tests live at repo-root `tests/skill/`, picked up by root `vitest.config.ts`)
- `pnpm --filter @understand-anything-trae/dashboard build` — Build the dashboard
- `pnpm dev:dashboard` — Start dashboard dev server
- `pnpm lint` — Run ESLint across the project

## Conventions
- TypeScript strict mode everywhere
- Vitest for testing
- ESM modules (`"type": "module"`)
- Knowledge graph JSON lives in `.understand-anything-trae/` directory of analyzed projects
- Core uses subpath exports (`./search`, `./types`, `./schema`) to avoid pulling Node.js modules into browser

## Gotchas
- **tree-sitter**: Uses `web-tree-sitter` (WASM) instead of native `tree-sitter` — native bindings fail on darwin/arm64 + Node 24
- **Dashboard imports**: Dashboard must only import from core's browser-safe subpath exports (`./search`, `./types`, `./schema`), never the main entry point which pulls in Node.js modules

## Scripts
- `scripts/generate-large-graph.mjs` — Generates a fake knowledge graph for performance testing (e.g. large-graph layout). Writes to `.understand-anything-trae/knowledge-graph.json`. Usage: `node scripts/generate-large-graph.mjs [nodeCount]` (default: 3000 nodes). Not part of the production pipeline.

## Versioning
When pushing to remote, bump the version in `understand-anything-trae-plugin/package.json` → `"version"` field.

## Testing Local Plugin Changes

Trae caches installed plugins at `~/.trae/plugins/cache/understand-anything-trae/understand-anything/<version>/`. To test local changes:

1. **Build the packages:**
   ```bash
   pnpm --filter @understand-anything-trae/core build
   pnpm --filter @understand-anything-trae/skill build
   ```

2. **Find the installed version** (must match what the marketplace currently serves):
   ```bash
   ls ~/.trae/plugins/cache/understand-anything-trae/understand-anything/
   ```

3. **Copy your local plugin into the cache**, replacing `<VERSION>` with the version from step 2:
   ```bash
   rm -rf ~/.trae/plugins/cache/understand-anything-trae/understand-anything/<VERSION>
   cp -R ./understand-anything-trae-plugin ~/.trae/plugins/cache/understand-anything-trae/understand-anything/<VERSION>
   ```

4. **Restart Trae** (existing sessions cache the old prompts in context).

5. **Run `/understand --full`** in the target project to verify.

**Re-sync after further changes:**
```bash
pnpm --filter @understand-anything-trae/core build && \
cp -R ./understand-anything-trae-plugin/* ~/.trae/plugins/cache/understand-anything-trae/understand-anything/<VERSION>/
```

**To revert to upstream:** Uninstall and reinstall the plugin — it repopulates the cache from the upstream repo.
