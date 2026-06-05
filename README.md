<h1 align="center">Understand Anything Trae</h1>

<p align="center">
  <strong>Turn any codebase, knowledge base, or docs into an interactive knowledge graph you can explore, search, and ask questions about.</strong>
  <br />
  <em>Works with Trae and Trae CN.</em>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="READMEs/README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/Quick_Start-blue" alt="Quick Start" /></a>
  <a href="https://github.com/creayma-del/Understand-Anything-Trae/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="License: MIT" /></a>
  <a href="#trae"><img src="https://img.shields.io/badge/Trae-7e22ce" alt="Trae" /></a>
</p>

---

**You just joined a new team. The codebase is 200,000 lines of code. Where do you even start?**

Understand Anything Trae is a Trae plugin that analyzes your project with a multi-agent pipeline, builds a knowledge graph of every file, function, class, and dependency, then gives you an interactive dashboard to explore it all visually. Stop reading code blind. Start seeing the big picture.

> **The goal isn't a graph that wows you with how complex your codebase is — it's a graph that quietly teaches you how every piece fits together.**

---

## ✨ Features

### Explore the structural graph

Navigate your codebase as an interactive knowledge graph — every file, function, and class is a node you can click, search, and explore. Select any node to see plain-English summaries, relationships, and guided tours.

### Understand business logic

Switch to the domain view and see how your code maps to real business processes — domains, flows, and steps laid out as a horizontal graph.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 Guided Tours</h3>
      <p>Auto-generated walkthroughs of the architecture, ordered by dependency. Learn the codebase in the right order.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Fuzzy & Semantic Search</h3>
      <p>Find anything by name or by meaning. Search "which parts handle auth?" and get relevant results across the graph.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Diff Impact Analysis</h3>
      <p>See which parts of the system your changes affect before you commit. Understand ripple effects across the codebase.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 Persona-Adaptive UI</h3>
      <p>The dashboard adjusts its detail level based on who you are — junior dev, PM, or power user.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ Layer Visualization</h3>
      <p>Automatic grouping by architectural layer — API, Service, Data, UI, Utility — with color-coded legend.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Language Concepts</h3>
      <p>86 language-specific concepts (generics, closures, reactive stores, SFC patterns, etc.) explained in context wherever they appear.</p>
    </td>
  </tr>
</table>

---

## 🚀 Quick Start

### 1. Install the plugin

Install via the one-line installer:

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/creayma-del/Understand-Anything-Trae/main/install.sh | bash -s trae
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/creayma-del/Understand-Anything-Trae/main/install.ps1 | iex
```

### 2. Analyze your codebase

```bash
/understand
```

A multi-agent pipeline scans your project, extracts every file, function, class, and dependency, then builds a knowledge graph saved to `.understand-anything-trae/knowledge-graph.json`.

**Localized output:** Use `--language` to generate content in your preferred language:

```bash
# Generate English content (knowledge graph node descriptions and Dashboard UI)
/understand --language en

# Supported languages: zh (default), en
```

The `--language` parameter affects:
- Node summaries and descriptions in the knowledge graph
- Dashboard UI labels, buttons, and tooltips
- Guided tour explanations

### 3. Explore the dashboard

```bash
/understand-dashboard
```

An interactive web dashboard opens with your codebase visualized as a graph — color-coded by architectural layer, searchable, and clickable. Select any node to see its code, relationships, and a plain-English explanation.

### 4. Keep learning

```bash
# Analyze impact of your current changes
/understand-diff

# Extract business domain knowledge (domains, flows, steps)
/understand-domain

# Re-run anytime — incremental by default (only re-analyzes changed files)
/understand

# Auto-update on every commit via a post-commit hook
/understand --auto-update

# Scope to a subdirectory (for huge monorepos)
/understand src/frontend
```

---

## 🌐 Installation

Understand-Anything-Trae is designed for Trae and Trae CN.

### Trae / Trae CN

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/creayma-del/Understand-Anything-Trae/main/install.sh | bash -s trae
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/creayma-del/Understand-Anything-Trae/main/install.ps1 | iex
```

The installer clones the repo to `~/.understand-anything-trae/repo` and creates the right symlinks for Trae. Restart Trae afterwards.

- Update later: `./install.sh --update`
- Uninstall: `./install.sh --uninstall trae`

### Platform Compatibility

| Platform | Status | Install Method |
|----------|--------|----------------|
| Trae | ✅ Supported | `install.sh trae` |
| Trae CN | ✅ Supported | `install.sh trae` |

---

## 📦 Share the Graph with Your Team

The graph is just JSON — **commit it once, and teammates skip the pipeline**. Good for onboarding, PR reviews, and docs-as-code.

**What to commit:** everything in `.understand-anything-trae/` *except* `intermediate/` and `diff-overlay.json` (those are local scratch).

```gitignore
.understand-anything-trae/intermediate/
.understand-anything-trae/diff-overlay.json
```

**Keep it fresh:** enable `/understand --auto-update` — a post-commit hook incrementally patches the graph so each commit lands with a matching graph. Or re-run `/understand` manually before releases.

**Large graphs (10 MB+):** track with **git-lfs**.

```bash
git lfs install
git lfs track ".understand-anything-trae/*.json"
git add .gitattributes .understand-anything-trae/
```

---

## 🔧 Under the Hood

### Supported Languages

**Code languages (4):** TypeScript, JavaScript, Vue SFC, Svelte

**Non-code languages (15):** Markdown, YAML, JSON Config, TOML, Env, Dockerfile, SQL, GraphQL, Prisma, Makefile, Shell, HTML, CSS, reStructuredText, Plain Text

**Frameworks (4):** React, Vue, Next.js, Express

### Tree-sitter + LLM hybrid

Static analysis and LLMs do what each does best:

- **Tree-sitter (deterministic)** — parses source into a concrete syntax tree and extracts structural facts: imports, exports, function/class definitions, call sites, inheritance. Pre-resolved into an `importMap` during the scan phase and passed to file-analyzers so they don't re-derive imports from source. Same input → same output, every run. Also powers fingerprint-based change detection for incremental updates.
- **LLM (semantic)** — reads the parsed structure alongside the original source to produce what parsers can't: plain-English summaries, tags, architectural layer assignments, business-domain mapping, guided tours, language concept callouts.

This split is why the graph is reproducible on the structural side (the same code always yields the same edges) while still capturing intent on the semantic side (what a file is *for*, not just what it imports).

### Multi-Agent Pipeline

The `/understand` command orchestrates 6 specialized agents, and `/understand-domain` adds a 7th:

| Agent | Role |
|-------|------|
| `project-scanner` | Discover files, detect languages and frameworks |
| `file-analyzer` | Extract functions, classes, imports; produce graph nodes and edges |
| `assemble-reviewer` | Assemble batch results and validate graph integrity |
| `architecture-analyzer` | Identify architectural layers |
| `tour-builder` | Generate guided learning tours |
| `graph-reviewer` | Validate graph completeness and referential integrity (runs inline by default; use `--review` for full LLM review) |
| `domain-analyzer` | Extract business domains, flows, and process steps (used by `/understand-domain`) |

Additionally, `knowledge-graph-guide` provides interactive guidance for using the knowledge graph.

File analyzers run in parallel (up to 5 concurrent, 20-30 files per batch). Supports incremental updates — only re-analyzes files that changed since the last run.

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Run the tests (`pnpm --filter @understand-anything-trae/core test`)
4. Commit your changes and open a pull request

Please open an issue first for major changes so we can discuss the approach.

---

<p align="center">
  <strong>Stop reading code blind. Start understanding everything.</strong>
</p>

<p align="center">
  <em>Thanks to everyone who's used and contributed — knowing this saves people time is what made it worth building.</em>
</p>

<p align="center">
  MIT License &copy; <a href="https://github.com/creayma-del">creayma-del</a>
</p>
