#!/usr/bin/env node
/**
 * extract-import-map.mjs
 *
 * Deterministic import resolution script for the project-scanner agent.
 * Uses PluginRegistry (TreeSitterPlugin + non-code parsers) from
 * @understand-anything-trae/core to extract raw import paths via tree-sitter,
 * then applies language-specific resolution rules to map them to
 * project-internal file paths.
 *
 * Replaces the LLM-written prose import resolver in agents/project-scanner.md
 * (the prose previously described patterns by language; runtime LLMs produced
 * inconsistent, regex-only scripts with sparse coverage).
 *
 * Usage:
 *   node extract-import-map.mjs <input.json> <output.json>
 *
 * Input JSON:
 *   {
 *     projectRoot: <abs-path>,
 *     files: [{ path, language, fileCategory }, ...]
 *   }
 *
 * Output JSON:
 *   {
 *     scriptCompleted: true,
 *     stats: { filesScanned, filesWithImports, totalEdges },
 *     importMap: { <path>: [<resolvedPath>, ...], ... }
 *   }
 *
 * Logging: stderr only (stdout reserved for piped tools).
 * Per-file resilience: failures emit `Warning: extract-import-map: ...` and
 * set importMap[path] = [], they do not abort the script.
 */

import { createRequire } from 'node:module';
import { dirname, resolve, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/understand/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @understand-anything-trae/core
//
// Node ESM dynamic import() requires a file:// URL on Windows; passing a raw
// absolute path like "C:\..." throws ERR_UNSUPPORTED_ESM_URL_SCHEME because the
// loader parses "C:" as a URL scheme. Wrap both resolutions in pathToFileURL().
// ---------------------------------------------------------------------------
let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything-trae/core')).href);
} catch {
  // Fallback: direct path for installed plugin cache layouts
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { TreeSitterPlugin, PluginRegistry, builtinLanguageConfigs, registerAllParsers, CssPlugin } = core;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a project-relative path to forward slashes (POSIX). Project-scanner
 * always emits forward slashes; we re-normalize to keep this script
 * cross-platform.
 */
function toPosix(p) {
  return p.split(/[\\/]/).filter(Boolean).join('/');
}

/**
 * Join a directory with a relative segment, normalizing `.`/`..` segments and
 * returning a forward-slash POSIX path. Anchored at project root (no leading
 * slash). Returns '' if the path walks above the project root.
 */
function resolveRelative(dir, rel) {
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
function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

// ---------------------------------------------------------------------------
// Config loading
//
// Cached once at startup. Per-file resolvers consume these values; they MUST
// NOT re-read these files (a 1000-file project would otherwise re-parse the
// same config 1000 times).
// ---------------------------------------------------------------------------

/**
 * Parse a single tsconfig.json file content and return
 * `{ baseUrl: string, paths: Map<string, string[]> }` or `null` if both the
 * comment-stripped and raw parses fail. Centralizes the "JSONC-then-raw"
 * fallback so callers can iterate many tsconfigs without duplicating the
 * try/catch ladder.
 *
 * Returning `null` (rather than throwing) lets the caller emit a Warning:
 * with the exact tsconfig path that failed; bubbling the error would
 * conceal which file was at fault when many tsconfigs are loaded.
 */
function parseTsConfigText(raw) {
  // tsconfig.json often contains JSONC-style comments; strip line and block
  // comments before parsing. The strip is naive (it doesn't honor string
  // contents), so we fall back to the raw text on failure.
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
 * project-relative POSIX directory containing the tsconfig (empty string
 * for a root-level tsconfig.json).
 *
 * `paths` keys keep their trailing `*` wildcards intact (e.g. `"@/*"`); the
 * resolver matches them by prefix. Values are arrays because tsconfig
 * allows multiple targets per alias.
 *
 * WHY plural: pnpm/yarn workspace monorepos commonly carry per-package
 * tsconfig.json files with package-scoped `paths` aliases. Loading only
 * the root tsconfig would (1) miss aliases defined in sub-packages and
 * (2) erroneously apply root aliases to files in sub-packages that
 * redefine them. Per-importer walk-up is the only correct behavior.
 *
 * Returns an empty map if no tsconfigs are found — many JS-only projects
 * have none, and relative imports still resolve without one. On parse
 * failure for a specific tsconfig, emits a Warning: pointing at the bad
 * file and skips it (the rest of the project keeps working).
 *
 * Parse strategy (per-file, in parseTsConfigText):
 *   1. Try the comment-stripped text (handles JSONC-style tsconfigs).
 *   2. If that fails, retry the ORIGINAL raw text — recovers the case
 *      where the stripper damaged a string literal containing `//`.
 *   3. If both fail, warn and skip — that tsconfig contributes no aliases.
 */
function loadTsConfigs(projectRoot, files) {
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
 * Walk up from `startDir` (project-relative POSIX, '' for project root)
 * and return the DEEPEST ancestor directory that exists as a key in
 * `configMap`, or undefined if no ancestor matches.
 *
 * Determinism: ancestors are inspected from deepest to shallowest, so the
 * deepest match is always picked. This matches the way TS/JS / PHP / Go
 * tools resolve nearest config in the wild ("nearest enclosing").
 *
 * Defensive note: if multiple distinct keys somehow share a depth (cannot
 * happen with proper directory paths, but a malformed input could), the
 * caller is expected to have normalized the keys. We do not re-sort here
 * because the iteration order is determined by depth alone.
 */
function findNearestConfigDir(startDir, configMap) {
  if (configMap.size === 0) return undefined;
  // Walk ancestors from the importer's directory up to the project root.
  // Slicing the parts array gives every prefix; we test each from longest
  // to shortest so the deepest match wins.
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
 *  - tsConfigs: Map<dir, { baseUrl, paths }> from every tsconfig.json in
 *    `files[]`. Per-import resolution walks up from the importer to the
 *    nearest enclosing tsconfig.
 *
 * Build once; pass everywhere.
 */
function buildResolutionContext(projectRoot, files) {
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
//
// Handles:
//   - Relative imports: `import x from './foo'` -> `<dir>/foo` + ext probes
//   - tsconfig path aliases: `import x from '@/foo'` -> `<baseUrl>/<target>/foo`
//
// `imp.source` from tree-sitter is the literal string content of the import
// path (no quotes). We don't need to redo the regex work — we just classify
// the source string and dispatch.
// ---------------------------------------------------------------------------

// Extensions probed when the import has no extension. The order mirrors the
// historical project-scanner prose so behavior matches existing fixtures.
const TS_EXT_PROBES = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.vue', '/index.svelte',
];

/**
 * Try ext probes against the file set for the given base path. Returns the
 * first matching project-relative path, or null. If the base path already has
 * a code extension AND exists in the file set, returns it directly.
 */
function probeWithExtensions(basePath, fileSet) {
  if (!basePath) return null;
  // Exact match (import already had an extension)
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
 *
 * Path-alias resolution walks up from the importer's directory to find the
 * nearest enclosing tsconfig.json (monorepo-friendly). `baseUrl`-relative
 * targets are anchored at THAT tsconfig's directory, matching the way the
 * TypeScript compiler resolves nested project configs.
 */
export function resolveTsJsImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return null;
  const src = rawImport.trim();
  if (!src) return null;

  const importerDir = dirOf(toPosix(file.path));

  // Relative imports: ./foo, ../foo — tsconfig has no bearing here.
  if (src.startsWith('./') || src.startsWith('../')) {
    const base = resolveRelative(importerDir, src);
    return probeWithExtensions(base, ctx.fileSet);
  }

  // tsconfig path aliases. Walk up from the importer to find the nearest
  // tsconfig.json; resolve targets relative to THAT tsconfig's directory.
  // Without the walk-up, a root tsconfig would either swallow aliases that
  // belong to a sub-package or fail to apply sub-package-defined aliases.
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
          // baseUrl is tsconfig-dir-relative; '.', './', '' all mean the
          // tsconfig's own directory. We anchor at tsConfigDir so a nested
          // tsconfig's `baseUrl: '.'` maps to its package, not project root.
          const normalizedBase = baseUrl === '.' || baseUrl === ''
            ? ''
            : toPosix(baseUrl);
          const relativeToConfig = normalizedBase
            ? posix.join(normalizedBase, mapped)
            : mapped;
          // posix.normalize strips a leading "./" left over when both
          // tsConfigDir and normalizedBase are empty (root tsconfig with
          // `"@/*": ["./*"]`, the create-next-app default). Without this the
          // candidate stays as "./foo" while ctx.fileSet stores "foo", and
          // probeWithExtensions silently drops every cross-module edge.
          const candidate = posix.normalize(
            tsConfigDir
              ? posix.join(tsConfigDir, relativeToConfig)
              : relativeToConfig,
          );
          // Defensive: tsconfig targets shouldn't escape the project root.
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
 * Match an import against a tsconfig paths alias. Aliases use `*` as a single
 * wildcard, e.g. `"@/*"` matches `"@/foo/bar"` with the wildcard = "foo/bar".
 * Aliases without `*` must match exactly. Returns the wildcard content
 * (possibly '') on match, null on no match.
 */
function matchTsAlias(alias, src) {
  const starIdx = alias.indexOf('*');
  if (starIdx === -1) {
    return src === alias ? '' : null;
  }
  const prefix = alias.slice(0, starIdx);
  const suffix = alias.slice(starIdx + 1);
  if (!src.startsWith(prefix)) return null;
  if (!src.endsWith(suffix)) return null;
  // Avoid double-counting when prefix+suffix length exceeds src length
  if (src.length < prefix.length + suffix.length) return null;
  return src.slice(prefix.length, src.length - suffix.length);
}

/**
 * Substitute the wildcard content into a tsconfig target. Mirror of
 * matchTsAlias — if the target has no `*`, return it as-is (rare, but valid).
 */
function applyTsAlias(target, wildcard) {
  const starIdx = target.indexOf('*');
  if (starIdx === -1) return target;
  return target.slice(0, starIdx) + wildcard + target.slice(starIdx + 1);
}

/**
 * Tree-sitter's TS/JS extractor only records ES module `import` declarations.
 * CommonJS `require('./foo')` is treated as a generic call expression and
 * never enters `analysis.imports`, which would silently drop edges in
 * Node-style codebases. Patch coverage with a focused regex pass on the file
 * content — we only want literal string arguments, so the regex is narrow.
 *
 * Limitations (intentional):
 *   - Computed requires (`require(name)`) are external/dynamic — skipped.
 *   - Template-literal requires are unresolved.
 *   - String concatenation in the argument is unresolved.
 */
const REQUIRE_LITERAL_RE = /\brequire\(\s*(['"])([^'"`\n]+?)\1\s*\)/g;

/**
 * Strip JS/TS line and block comments before running text-pattern matchers.
 * Replaces with spaces (preserving offsets isn't critical here, but keeping
 * roughly the same length avoids surprising the matcher with collapsed
 * whitespace). Does not attempt to honor string contents — that's fine for
 * the narrow patterns we run (`require('...')`, etc.) because the same
 * comment-or-not heuristic applies uniformly to all matched literals.
 */
function stripJsLikeComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

function extractRequireSources(content) {
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
//
// Handles:
//   - Relative imports: @import './foo', @use 'base', @forward 'themes'
//   - SCSS partial path probing (_ prefix + extension omission)
//   - Dart Sass probing order for extensionless imports
// ---------------------------------------------------------------------------

/**
 * 解析 CSS/SCSS 导入路径。
 * 处理 SCSS partial 约定（_ 前缀 + 省略扩展名）。
 */
function resolveCssImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return null;
  const src = rawImport.trim();
  if (!src) return null;

  // 仅处理相对路径
  if (!src.startsWith('./') && !src.startsWith('../')) return null;

  const importerDir = dirOf(toPosix(file.path));
  const base = resolveRelative(importerDir, src);

  // 如果已有扩展名且存在于文件集中，直接返回
  if (ctx.fileSet.has(base)) return base;

  // 生成 SCSS partial 候选路径
  const dir = base.includes('/') ? base.substring(0, base.lastIndexOf('/') + 1) : '';
  const name = base.includes('/') ? base.substring(base.lastIndexOf('/') + 1) : base;

  // 如果已有扩展名
  if (/\.(scss|sass|css)$/.test(name)) {
    // 尝试 _ 前缀版本
    if (!name.startsWith('_')) {
      const candidate = dir + '_' + name;
      if (ctx.fileSet.has(candidate)) return candidate;
    }
    return null;
  }

  // 无扩展名：按 Dart Sass 规范顺序探测所有候选
  // 1. 非partial .scss / .sass
  for (const ext of ['.scss', '.sass']) {
    const candidate = dir + name + ext;
    if (ctx.fileSet.has(candidate)) return candidate;
  }

  // 2. partial（_ 前缀）.scss / .sass
  if (!name.startsWith('_')) {
    for (const ext of ['.scss', '.sass']) {
      const candidate = dir + '_' + name + ext;
      if (ctx.fileSet.has(candidate)) return candidate;
    }
  }

  // 3. index 文件（仅 .scss）
  if (ctx.fileSet.has(base + '/index.scss')) return base + '/index.scss';
  if (ctx.fileSet.has(base + '/_index.scss')) return base + '/_index.scss';

  // 4. .css 最后（Dart Sass 将 .css 视为最低优先级）
  const cssCandidate = dir + name + '.css';
  if (ctx.fileSet.has(cssCandidate)) return cssCandidate;

  return null;
}

// ---------------------------------------------------------------------------
// HTML resolver
//
// Handles:
//   - Relative imports: <script src="./app.js">, <link href="./styles.css">
//   - Absolute imports: <link href="/css/main.css"> → project root relative
//   - External URLs are skipped (https://, //, data:, etc.)
// ---------------------------------------------------------------------------

/**
 * 判断是否为外部 URL（不需要解析为项目内部引用）。
 */
function isExternalUrl(url) {
  return /^(https?:)?\/\//i.test(url) || /^(data:|blob:|mailto:|tel:|javascript:)/i.test(url);
}

/**
 * 解析 HTML 文件中的导入引用。
 * script src / link href 可能是相对路径或绝对路径。
 */
function resolveHtmlImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return null;
  const src = rawImport.trim();
  if (!src || isExternalUrl(src)) return null;

  const importerDir = dirOf(toPosix(file.path));

  if (src.startsWith('./') || src.startsWith('../')) {
    const base = resolveRelative(importerDir, src);
    return probeWithExtensions(base, ctx.fileSet) || (ctx.fileSet.has(base) ? base : null);
  }

  if (src.startsWith('/')) {
    // 绝对路径 → 项目根目录相对
    const base = src.slice(1);
    return probeWithExtensions(base, ctx.fileSet) || (ctx.fileSet.has(base) ? base : null);
  }

  // 裸路径（无前缀）→ 相对于当前目录
  const base = resolveRelative(importerDir, src);
  return probeWithExtensions(base, ctx.fileSet) || (ctx.fileSet.has(base) ? base : null);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Languages recognized as "code" for resolver dispatch. Tree-sitter parses
 * these via the corresponding extractor; the dispatcher routes the import
 * source through the matching resolver.
 */
const TS_JS_LANGS = new Set([
  'typescript', 'javascript', 'tsx', 'jsx', 'vue', 'vue-sfc', 'svelte',
]);

/**
 * CSS/SCSS 语言集合，用于导入解析分发。
 * CSS 文件的 @import/@use/@forward 需要特殊的路径探测逻辑
 * （SCSS partial 的 _ 前缀和省略扩展名约定）。
 */
const CSS_LANGS = new Set(['css']);

/**
 * HTML 语言集合，用于导入解析分发。
 * HTML 文件的 <script src> / <link href> 需要特殊的路径探测逻辑。
 */
const HTML_LANGS = new Set(['html']);

/**
 * Dispatch a raw import to the language-specific resolver. Returns an array
 * of resolved project-relative paths (most resolvers produce 0 or 1).
 *
 * Per-resolver contract: never throw, never read disk (read once in main()).
 * Empty array means external/unresolved.
 */
function resolveImport(imp, file, ctx) {
  const lang = file.language;
  const src = imp.source;
  if (TS_JS_LANGS.has(lang)) {
    const out = resolveTsJsImport(src, file, ctx);
    return out ? [out] : [];
  }
  // CSS/SCSS 导入解析
  if (CSS_LANGS.has(lang)) {
    const out = resolveCssImport(src, file, ctx);
    return out ? [out] : [];
  }
  // HTML 导入解析：script src / link href 直接作为相对路径解析
  if (HTML_LANGS.has(lang)) {
    const out = resolveHtmlImport(src, file, ctx);
    return out ? [out] : [];
  }
  return [];
}

/**
 * Collect extra raw import sources that tree-sitter doesn't capture. Today
 * this is CommonJS require() literals for JS/TS files. Returns an array of
 * import-source strings to be passed through resolveImport().
 */
function extractExtraImportSources(file, content) {
  if (TS_JS_LANGS.has(file.language)) {
    return extractRequireSources(content);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: node extract-import-map.mjs <input.json> <output.json>\n');
    process.exit(1);
  }

  const inputRaw = readFileSync(inputPath, 'utf-8');
  const input = JSON.parse(inputRaw);
  const { projectRoot, files } = input;

  if (!projectRoot || !Array.isArray(files)) {
    throw new Error('Invalid input: must contain projectRoot and files array');
  }

  // Create tree-sitter plugin with all configs that have WASM grammars.
  //
  // WHY graceful init: the most likely real-world failure mode is the WASM
  // loader failing to locate or fetch the grammar binaries (cache eviction,
  // restricted sandboxes, transient FS issues). When that happens, we still
  // want the script to complete — producing an empty importMap for every
  // code file — rather than crashing the whole project-scanner pipeline.
  // The structural graph will lose import edges, but all OTHER analysis
  // (file inventory, exports inferred from filenames, etc.) keeps working.
  let registry = null;
  let treeSitterReady = false;
  try {
    const tsConfigs = builtinLanguageConfigs.filter(c => c.treeSitter);
    const tsPlugin = new TreeSitterPlugin(tsConfigs);
    await tsPlugin.init();
    registry = new PluginRegistry();
    registry.register(tsPlugin);
    const cssPlugin = new CssPlugin();
    registerAllParsers(registry, tsPlugin, cssPlugin);
    treeSitterReady = true;
  } catch (err) {
    process.stderr.write(
      `Warning: extract-import-map: tree-sitter init failed ` +
      `(${err.message}) — all importMap entries will be empty — ` +
      `structural graph will have no import edges\n`,
    );
  }

  // Build resolution context (cached configs)
  const ctx = buildResolutionContext(projectRoot, files);

  const importMap = {};
  let filesWithImports = 0;
  let totalEdges = 0;

  for (const file of files) {
    const path = toPosix(file.path);

    // Non-code files always get an empty array (except HTML — parsed by HtmlPlugin)
    if (file.fileCategory !== 'code' && file.language !== 'html') {
      importMap[path] = [];
      continue;
    }

    // Tree-sitter init failed earlier — produce empty importMap entries for
    // every code file and skip the analysis path. The one-time warning was
    // already emitted at startup.
    if (!treeSitterReady) {
      importMap[path] = [];
      continue;
    }

    const absolutePath = join(projectRoot, file.path);

    // Read file content (per-file resilience)
    let content;
    try {
      content = readFileSync(absolutePath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `Warning: extract-import-map: import resolution failed for ${path} ` +
        `(read error: ${err.message}) — importMap[${path}]=[]\n`,
      );
      importMap[path] = [];
      continue;
    }

    // Analyze + resolve
    let resolved;
    try {
      const resolvedSet = new Set();

      const analysis = registry.analyzeFile(file.path, content);
      const imports = analysis?.imports ?? [];
      for (const imp of imports) {
        const outs = resolveImport(imp, file, ctx);
        for (const out of outs) {
          if (out && ctx.fileSet.has(out)) {
            resolvedSet.add(out);
          }
        }
      }
      // Supplemental pass for sources tree-sitter doesn't capture (e.g.
      // CJS require() calls). Dedup via the same set.
      for (const extra of extractExtraImportSources(file, content)) {
        const outs = resolveImport({ source: extra, specifiers: [] }, file, ctx);
        for (const out of outs) {
          if (out && ctx.fileSet.has(out)) {
            resolvedSet.add(out);
          }
        }
      }
      resolved = [...resolvedSet].sort((a, b) => a.localeCompare(b));
    } catch (err) {
      process.stderr.write(
        `Warning: extract-import-map: import resolution failed for ${path} ` +
        `(analyze error: ${err.message}) — importMap[${path}]=[]\n`,
      );
      importMap[path] = [];
      continue;
    }

    importMap[path] = resolved;
    if (resolved.length > 0) {
      filesWithImports += 1;
      totalEdges += resolved.length;
    }
  }

  const output = {
    scriptCompleted: true,
    stats: {
      filesScanned: files.length,
      filesWithImports,
      totalEdges,
    },
    importMap,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  if (!existsSync(outputPath)) {
    throw new Error(`output file missing after write: ${outputPath}`);
  }

  process.stderr.write(
    `extract-import-map: filesScanned=${files.length} ` +
    `filesWithImports=${filesWithImports} totalEdges=${totalEdges}\n`,
  );
}

// ---------------------------------------------------------------------------
// Run only when executed directly as a CLI; importing the module (e.g. from
// tests) must not trigger main().
//
// Canonicalize both sides through realpathSync. Node ESM resolves
// import.meta.url through symlinks but pathToFileURL(process.argv[1]) preserves
// them, so a raw equality check silently no-ops when the script is invoked via
// a symlinked plugin install path (the default in Trae / Trae CN
// caches). See GitHub issue #162.
// ---------------------------------------------------------------------------
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const argvPath = realpathSync(process.argv[1]);
    return modulePath === argvPath;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`extract-import-map.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}
