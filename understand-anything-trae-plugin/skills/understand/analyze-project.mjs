#!/usr/bin/env node
/**
 * analyze-project.mjs
 *
 * Unified analysis pipeline that replaces the three separate scripts:
 *   - extract-import-map.mjs (import resolution)
 *   - extract-all-structure.mjs (structure extraction)
 *   - compute-batches.mjs extractExports() (export symbol extraction)
 *
 * Initializes TreeSitterPlugin + PluginRegistry ONCE, iterates all files
 * ONCE, and produces three output files simultaneously:
 *   - import-map.json (import relationships)
 *   - structure-results.json (structural data for all files)
 *   - exports-map.json (export symbol names)
 *
 * Usage:
 *   node analyze-project.mjs <projectRoot> <outputDir>
 *
 * Input:  <outputDir>/scan-result.json (Phase 0/1 output)
 * Output: <outputDir>/import-map.json
 *         <outputDir>/structure-results.json
 *         <outputDir>/exports-map.json
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

// Import buildResult from extract-structure.mjs
import { buildResult } from './extract-structure.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/understand/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @understand-anything-trae/core
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
  const [,, projectRoot, outputDir] = process.argv;
  if (!projectRoot || !outputDir) {
    process.stderr.write('Usage: node analyze-project.mjs <projectRoot> <outputDir>\n');
    process.exit(1);
  }

  // 1. Read scan-result.json
  const scanResultPath = join(outputDir, 'scan-result.json');
  if (!existsSync(scanResultPath)) {
    process.stderr.write(`analyze-project.mjs failed: scan-result.json not found at ${scanResultPath}\n`);
    process.exit(1);
  }

  let scanResult;
  try {
    scanResult = JSON.parse(readFileSync(scanResultPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`analyze-project.mjs failed: scan-result.json parse error (${err.message})\n`);
    process.exit(1);
  }

  const { files } = scanResult;

  if (!Array.isArray(files) || files.length === 0) {
    process.stderr.write('Warning: analyze-project: no files found in scan-result.json\n');
    // Write empty results
    const emptyImportMap = { scriptCompleted: true, stats: { filesScanned: 0, filesWithImports: 0, totalEdges: 0 }, importMap: {} };
    const emptyStructure = { scriptCompleted: true, filesAnalyzed: 0, filesSkipped: [], results: [] };
    const emptyExports = { scriptCompleted: true, stats: { filesScanned: 0, filesWithExports: 0, totalSymbols: 0 }, exportsMap: {} };
    writeFileSync(join(outputDir, 'import-map.json'), JSON.stringify(emptyImportMap, null, 2), 'utf-8');
    writeFileSync(join(outputDir, 'structure-results.json'), JSON.stringify(emptyStructure, null, 2), 'utf-8');
    writeFileSync(join(outputDir, 'exports-map.json'), JSON.stringify(emptyExports, null, 2), 'utf-8');
    process.exit(0);
  }

  // 2. Initialize tree-sitter (once)
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
      `Warning: analyze-project: tree-sitter init failed (${err.message}) ` +
      `— all outputs will be empty\n`,
    );
  }

  // 3. Build resolution context (tsconfig etc., cached once)
  const ctx = treeSitterReady ? buildResolutionContext(projectRoot, files) : null;

  // 4. Iterate all files
  const importMap = {};
  const exportsMap = {};
  const structureResults = [];
  const filesSkipped = [];
  let filesWithImports = 0;
  let totalImportEdges = 0;
  let filesWithExports = 0;
  let totalExportSymbols = 0;

  for (const file of files) {
    const path = toPosix(file.path);

    // Non-code files (HTML excluded — parsed by HtmlPlugin for imports)
    if (file.fileCategory !== 'code' && file.language !== 'html') {
      importMap[path] = [];
      exportsMap[path] = [];
      structureResults.push(buildResult(file, 0, 0, null, null, null));
      continue;
    }

    // Tree-sitter init failed — produce empty outputs
    if (!treeSitterReady) {
      importMap[path] = [];
      exportsMap[path] = [];
      structureResults.push(buildResult(file, 0, 0, null, null, null));
      continue;
    }

    // Read file content (per-file resilience)
    const absolutePath = join(projectRoot, file.path);
    let content;
    try {
      content = readFileSync(absolutePath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `Warning: analyze-project: analysis failed for ${path} ` +
        `(read error: ${err.message})\n`,
      );
      importMap[path] = [];
      exportsMap[path] = [];
      filesSkipped.push(path);
      continue;
    }

    // Line counts
    const lines = content.split('\n');
    const totalLines = content.endsWith('\n')
      ? Math.max(0, lines.length - 1) : lines.length;
    const nonEmptyLines = lines.filter(l => l.trim().length > 0).length;

    // 4a. Structural analysis (one analyzeFile call)
    let analysis = null;
    try {
      analysis = registry.analyzeFile(file.path, content);
    } catch {
      // Analysis failed — degrade to basic metrics
    }

    // 4b. Call graph extraction (code/script files)
    let callGraph = null;
    if (file.fileCategory === 'code' || file.fileCategory === 'script') {
      try {
        const cg = registry.extractCallGraph(file.path, content);
        if (cg && cg.length > 0) {
          callGraph = cg.map(entry => ({
            caller: entry.caller,
            callee: entry.callee,
            lineNumber: entry.lineNumber,
          }));
        }
      } catch {
        // Call graph extraction failed — non-fatal
      }
    }

    // 4c. Import resolution -> importMap
    let resolvedImports;
    try {
      resolvedImports = resolveImports(registry, file, content, ctx);
    } catch (err) {
      process.stderr.write(
        `Warning: analyze-project: import resolution failed for ${path} ` +
        `(error: ${err.message})\n`,
      );
      resolvedImports = [];
    }
    importMap[path] = resolvedImports;
    if (resolvedImports.length > 0) {
      filesWithImports += 1;
      totalImportEdges += resolvedImports.length;
    }

    // 4d. Export symbol extraction -> exportsMap
    const exports = (analysis?.exports || []).map(e => e.name).filter(Boolean);
    exportsMap[path] = exports;
    if (exports.length > 0) {
      filesWithExports += 1;
      totalExportSymbols += exports.length;
    }

    // 4e. Structure data construction -> structureResults
    const batchImportData = { [path]: resolvedImports };
    structureResults.push(buildResult(file, totalLines, nonEmptyLines, analysis, callGraph, batchImportData));
  }

  // 5. Write three output files
  writeFileSync(
    join(outputDir, 'import-map.json'),
    JSON.stringify({
      scriptCompleted: true,
      stats: { filesScanned: files.length, filesWithImports, totalEdges: totalImportEdges },
      importMap,
    }, null, 2),
    'utf-8',
  );

  writeFileSync(
    join(outputDir, 'structure-results.json'),
    JSON.stringify({
      scriptCompleted: true,
      filesAnalyzed: structureResults.length,
      filesSkipped,
      results: structureResults,
    }, null, 2),
    'utf-8',
  );

  writeFileSync(
    join(outputDir, 'exports-map.json'),
    JSON.stringify({
      scriptCompleted: true,
      stats: { filesScanned: files.length, filesWithExports, totalSymbols: totalExportSymbols },
      exportsMap,
    }, null, 2),
    'utf-8',
  );

  // 6. Stderr log
  process.stderr.write(
    `analyze-project: filesScanned=${files.length} ` +
    `filesWithImports=${filesWithImports} totalImportEdges=${totalImportEdges} ` +
    `filesWithExports=${filesWithExports} totalExportSymbols=${totalExportSymbols}\n`,
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
    process.stderr.write(`analyze-project.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}
