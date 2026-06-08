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
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';

// Import shared resolution logic
import {
  toPosix,
  buildResolutionContext,
  resolveImports,
} from './shared/import-resolution.mjs';

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
    // every code file and skip the analysis path.
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

    // Resolve imports using shared module
    let resolved;
    try {
      resolved = resolveImports(registry, file, content, ctx);
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
