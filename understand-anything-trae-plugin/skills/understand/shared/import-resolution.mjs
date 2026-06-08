/**
 * import-resolution.mjs
 *
 * Shared import resolution logic extracted from extract-import-map.mjs.
 * Used by both extract-import-map.mjs and analyze-project.mjs to avoid
 * code duplication and ensure consistent import resolution behavior.
 *
 * All functions are pure (no I/O, no side effects) except buildResolutionContext
 * which reads tsconfig files from disk (cached once at startup).
 */

import { join, posix } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a project-relative path to forward slashes (POSIX). Project-scanner
 * always emits forward slashes; we re-normalize to keep this script
 * cross-platform.
 */
export function toPosix(p) {
  return p.split(/[\\/]/).filter(Boolean).join('/');
}

/**
 * Join a directory with a relative segment, normalizing `.`/`..` segments and
 * returning a forward-slash POSIX path. Anchored at project root (no leading
 * slash). Returns '' if the path walks above the project root.
 */
export function resolveRelative(dir, rel) {
  const parts = (dir ? dir.split('/').filter(Boolean) : []).concat(
    rel.split('/').filter(Boolean),
  );
  const stack = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return '';
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

/**
 * Return the directory portion of a project-relative path (no trailing slash,
 * '' for top-level files).
 */
export function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Parse a single tsconfig.json file content and return
 * `{ baseUrl: string, paths: Map<string, string[]> }` or `null` if both the
 * comment-stripped and raw parses fail.
 */
export function parseTsConfigText(raw) {
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const compilerOptions = parsed?.compilerOptions ?? {};
  const baseUrl = compilerOptions.baseUrl ?? '.';
  const paths = new Map();
  if (compilerOptions.paths && typeof compilerOptions.paths === 'object') {
    for (const [alias, targets] of Object.entries(compilerOptions.paths)) {
      if (Array.isArray(targets)) {
        paths.set(alias, targets);
      }
    }
  }
  return { baseUrl, paths };
}

/**
 * Load every `tsconfig.json` discovered in the input file list and parse
 * each. Returns `Map<dirPath, { baseUrl, paths }>` keyed by the
 * project-relative POSIX directory containing the tsconfig.
 */
export function loadTsConfigs(projectRoot, files) {
  const out = new Map();
  for (const f of files) {
    const p = toPosix(f.path);
    const base = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    if (base !== 'tsconfig.json') continue;
    const absPath = join(projectRoot, p);
    if (!existsSync(absPath)) continue;
    let raw;
    try {
      raw = readFileSync(absPath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `Warning: extract-import-map: tsconfig.json at ${absPath} failed ` +
        `to read (${err.message}) — path aliases from this config will ` +
        `not be applied — relative imports unaffected\n`,
      );
      continue;
    }
    const parsed = parseTsConfigText(raw);
    if (!parsed) {
      process.stderr.write(
        `Warning: extract-import-map: tsconfig.json at ${absPath} failed ` +
        `to parse — path aliases from this config will not be applied ` +
        `— relative imports unaffected\n`,
      );
      continue;
    }
    out.set(dirOf(p), parsed);
  }
  return out;
}

/**
 * Walk up from `startDir` and return the DEEPEST ancestor directory that
 * exists as a key in `configMap`, or undefined if no ancestor matches.
 */
export function findNearestConfigDir(startDir, configMap) {
  if (configMap.size === 0) return undefined;
  const parts = startDir ? startDir.split('/').filter(Boolean) : [];
  for (let i = parts.length; i >= 0; i--) {
    const ancestor = parts.slice(0, i).join('/');
    if (configMap.has(ancestor)) return ancestor;
  }
  return undefined;
}

/**
 * Resolution context shared across all per-file resolver calls. Holds:
 *  - fileSet: Set<string> of every input file's posix path
 *  - tsConfigs: Map<dir, { baseUrl, paths }> from every tsconfig.json
 *
 * Build once; pass everywhere.
 */
export function buildResolutionContext(projectRoot, files) {
  const fileSet = new Set(files.map(f => toPosix(f.path)));
  const tsConfigs = loadTsConfigs(projectRoot, files);

  return {
    projectRoot,
    fileSet,
    tsConfigs,
  };
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript resolver
// ---------------------------------------------------------------------------

// Extensions probed when the import has no extension.
const TS_EXT_PROBES = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.vue', '/index.svelte',
];

/**
 * Try ext probes against the file set for the given base path. Returns the
 * first matching project-relative path, or null.
 */
export function probeWithExtensions(basePath, fileSet) {
  if (!basePath) return null;
  if (fileSet.has(basePath)) return basePath;
  for (const ext of TS_EXT_PROBES) {
    const candidate = basePath + ext;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve a TypeScript / JavaScript import. Returns project-relative resolved
 * path or null. External packages return null.
 */
export function resolveTsJsImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return null;
  const src = rawImport.trim();
  if (!src) return null;

  const importerDir = dirOf(toPosix(file.path));

  // Relative imports
  if (src.startsWith('./') || src.startsWith('../')) {
    const base = resolveRelative(importerDir, src);
    return probeWithExtensions(base, ctx.fileSet);
  }

  // tsconfig path aliases
  const tsConfigDir = findNearestConfigDir(importerDir, ctx.tsConfigs);
  if (tsConfigDir !== undefined) {
    const tsConfig = ctx.tsConfigs.get(tsConfigDir);
    const { baseUrl, paths } = tsConfig;
    if (paths && paths.size > 0) {
      for (const [alias, targets] of paths) {
        const aliasMatch = matchTsAlias(alias, src);
        if (aliasMatch === null) continue;
        for (const target of targets) {
          const mapped = applyTsAlias(target, aliasMatch);
          const normalizedBase = baseUrl === '.' || baseUrl === ''
            ? ''
            : toPosix(baseUrl);
          const relativeToConfig = normalizedBase
            ? posix.join(normalizedBase, mapped)
            : mapped;
          const candidate = posix.normalize(
            tsConfigDir
              ? posix.join(tsConfigDir, relativeToConfig)
              : relativeToConfig,
          );
          if (candidate.startsWith('..')) continue;
          const probed = probeWithExtensions(candidate, ctx.fileSet);
          if (probed) return probed;
        }
      }
    }
  }

  // Bare specifier with no leading `./`, no alias match -> external package.
  return null;
}

/**
 * Match an import against a tsconfig paths alias.
 */
export function matchTsAlias(alias, src) {
  const starIdx = alias.indexOf('*');
  if (starIdx === -1) {
    return src === alias ? '' : null;
  }
  const prefix = alias.slice(0, starIdx);
  const suffix = alias.slice(starIdx + 1);
  if (!src.startsWith(prefix)) return null;
  if (!src.endsWith(suffix)) return null;
  if (src.length < prefix.length + suffix.length) return null;
  return src.slice(prefix.length, src.length - suffix.length);
}

/**
 * Substitute the wildcard content into a tsconfig target.
 */
export function applyTsAlias(target, wildcard) {
  const starIdx = target.indexOf('*');
  if (starIdx === -1) return target;
  return target.slice(0, starIdx) + wildcard + target.slice(starIdx + 1);
}

// ---------------------------------------------------------------------------
// CJS require() extraction
// ---------------------------------------------------------------------------

const REQUIRE_LITERAL_RE = /\brequire\(\s*(['"])([^'"`\n]+?)\1\s*\)/g;

/**
 * Strip JS/TS line and block comments before running text-pattern matchers.
 */
export function stripJsLikeComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * Extract CJS require() source paths from file content.
 */
export function extractRequireSources(content) {
  const sources = [];
  let m;
  const stripped = stripJsLikeComments(content);
  REQUIRE_LITERAL_RE.lastIndex = 0;
  while ((m = REQUIRE_LITERAL_RE.exec(stripped)) !== null) {
    sources.push(m[2]);
  }
  return sources;
}

// ---------------------------------------------------------------------------
// CSS/SCSS resolver
// ---------------------------------------------------------------------------

/**
 * Resolve CSS/SCSS import paths, handling SCSS partial conventions.
 */
export function resolveCssImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return null;
  const src = rawImport.trim();
  if (!src) return null;

  if (!src.startsWith('./') && !src.startsWith('../')) return null;

  const importerDir = dirOf(toPosix(file.path));
  const base = resolveRelative(importerDir, src);

  if (ctx.fileSet.has(base)) return base;

  const dir = base.includes('/') ? base.substring(0, base.lastIndexOf('/') + 1) : '';
  const name = base.includes('/') ? base.substring(base.lastIndexOf('/') + 1) : base;

  if (/\.(scss|sass|css)$/.test(name)) {
    if (!name.startsWith('_')) {
      const candidate = dir + '_' + name;
      if (ctx.fileSet.has(candidate)) return candidate;
    }
    return null;
  }

  for (const ext of ['.scss', '.sass']) {
    const candidate = dir + name + ext;
    if (ctx.fileSet.has(candidate)) return candidate;
  }

  if (!name.startsWith('_')) {
    for (const ext of ['.scss', '.sass']) {
      const candidate = dir + '_' + name + ext;
      if (ctx.fileSet.has(candidate)) return candidate;
    }
  }

  if (ctx.fileSet.has(base + '/index.scss')) return base + '/index.scss';
  if (ctx.fileSet.has(base + '/_index.scss')) return base + '/_index.scss';

  const cssCandidate = dir + name + '.css';
  if (ctx.fileSet.has(cssCandidate)) return cssCandidate;

  return null;
}

// ---------------------------------------------------------------------------
// HTML resolver
// ---------------------------------------------------------------------------

/**
 * Check if a URL is external (should not be resolved to project-internal).
 */
export function isExternalUrl(url) {
  return /^(https?:)?\/\//i.test(url) || /^(data:|blob:|mailto:|tel:|javascript:)/i.test(url);
}

/**
 * Resolve HTML import references (script src / link href).
 */
export function resolveHtmlImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return null;
  const src = rawImport.trim();
  if (!src || isExternalUrl(src)) return null;

  const importerDir = dirOf(toPosix(file.path));

  if (src.startsWith('./') || src.startsWith('../')) {
    const base = resolveRelative(importerDir, src);
    return probeWithExtensions(base, ctx.fileSet) || (ctx.fileSet.has(base) ? base : null);
  }

  if (src.startsWith('/')) {
    const base = src.slice(1);
    return probeWithExtensions(base, ctx.fileSet) || (ctx.fileSet.has(base) ? base : null);
  }

  const base = resolveRelative(importerDir, src);
  return probeWithExtensions(base, ctx.fileSet) || (ctx.fileSet.has(base) ? base : null);
}

// ---------------------------------------------------------------------------
// Language sets and dispatcher
// ---------------------------------------------------------------------------

/**
 * Languages recognized as "code" for resolver dispatch.
 */
export const TS_JS_LANGS = new Set([
  'typescript', 'javascript', 'tsx', 'jsx', 'vue', 'vue-sfc', 'svelte',
]);

/**
 * CSS/SCSS language set for import resolution dispatch.
 */
export const CSS_LANGS = new Set(['css']);

/**
 * HTML language set for import resolution dispatch.
 */
export const HTML_LANGS = new Set(['html']);

/**
 * Dispatch a raw import to the language-specific resolver. Returns an array
 * of resolved project-relative paths (most resolvers produce 0 or 1).
 */
export function resolveImport(imp, file, ctx) {
  const lang = file.language;
  const src = imp.source;
  if (TS_JS_LANGS.has(lang)) {
    const out = resolveTsJsImport(src, file, ctx);
    return out ? [out] : [];
  }
  if (CSS_LANGS.has(lang)) {
    const out = resolveCssImport(src, file, ctx);
    return out ? [out] : [];
  }
  if (HTML_LANGS.has(lang)) {
    const out = resolveHtmlImport(src, file, ctx);
    return out ? [out] : [];
  }
  return [];
}

/**
 * Collect extra raw import sources that tree-sitter doesn't capture.
 * Today this is CommonJS require() literals for JS/TS files.
 */
export function extractExtraImportSources(file, content) {
  if (TS_JS_LANGS.has(file.language)) {
    return extractRequireSources(content);
  }
  return [];
}

/**
 * Resolve all imports for a single file using the two-phase approach:
 * 1. From tree-sitter analysis results (analysis.imports) for ES module imports
 * 2. From extractExtraImportSources() for CJS require() etc.
 *
 * @param {Object} registry - PluginRegistry instance
 * @param {Object} file - File metadata { path, language, fileCategory }
 * @param {string} content - File content
 * @param {Object} ctx - Resolution context from buildResolutionContext()
 * @returns {string[]} Sorted array of resolved project-internal paths
 */
export function resolveImports(registry, file, content, ctx) {
  const resolvedSet = new Set();

  // Phase 1: ES module imports from tree-sitter analysis
  let analysis = null;
  try {
    analysis = registry.analyzeFile(file.path, content);
  } catch {
    // Analysis failed — skip ES module phase, still try CJS below
  }

  if (analysis?.imports) {
    for (const imp of analysis.imports) {
      const outs = resolveImport(imp, file, ctx);
      for (const out of outs) {
        if (out && ctx.fileSet.has(out)) {
          resolvedSet.add(out);
        }
      }
    }
  }

  // Phase 2: CJS require() and other extra sources
  for (const extra of extractExtraImportSources(file, content)) {
    const outs = resolveImport({ source: extra, specifiers: [] }, file, ctx);
    for (const out of outs) {
      if (out && ctx.fileSet.has(out)) {
        resolvedSet.add(out);
      }
    }
  }

  return [...resolvedSet].sort((a, b) => a.localeCompare(b));
}
