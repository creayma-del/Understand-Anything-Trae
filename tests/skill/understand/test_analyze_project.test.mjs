import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-trae-plugin/skills/understand/analyze-project.mjs');

/**
 * Helper: write a source tree from a `files` object: { 'a/b.ts': '...', ... }.
 * Creates parent dirs as needed. Returns the temp project root.
 */
function setupTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'ua-ap-test-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf-8');
  }
  return root;
}

/**
 * Run analyze-project.mjs. Returns { status, stdout, stderr, outputs }
 * where `outputs` is an object with parsed importMap, structure, and exportsMap
 * (or null for each on failure).
 */
function runScript(projectRoot, outputDir) {
  const result = spawnSync('node', [SCRIPT, projectRoot, outputDir], {
    encoding: 'utf-8',
  });

  let importMap = null;
  let structure = null;
  let exportsMap = null;

  try {
    importMap = JSON.parse(readFileSync(join(outputDir, 'import-map.json'), 'utf-8'));
  } catch { /* missing on hard failure */ }

  try {
    structure = JSON.parse(readFileSync(join(outputDir, 'structure-results.json'), 'utf-8'));
  } catch { /* missing on hard failure */ }

  try {
    exportsMap = JSON.parse(readFileSync(join(outputDir, 'exports-map.json'), 'utf-8'));
  } catch { /* missing on hard failure */ }

  return { status: result.status, stdout: result.stdout, stderr: result.stderr, importMap, structure, exportsMap };
}

/**
 * Create a scan-result.json in the output directory.
 */
function writeScanResult(outputDir, files, options = {}) {
  const scanResult = {
    projectName: options.projectName || 'test-project',
    projectDescription: options.projectDescription || 'Test project',
    languages: options.languages || [],
    frameworks: options.frameworks || [],
    files,
    importMap: options.importMap || {},
  };
  writeFileSync(join(outputDir, 'scan-result.json'), JSON.stringify(scanResult), 'utf-8');
}

describe('analyze-project.mjs — basic', () => {
  let projectRoot;
  let outputDir;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('AP-001: produces 3 output files for basic project (TS + CSS + config)', () => {
    projectRoot = setupTree({
      'src/index.ts': 'export function main() {}\n',
      'src/utils.ts': 'export function helper() {}\n',
      'src/styles.css': '@import "./reset.css";\nbody { margin: 0; }',
      'src/reset.css': 'body { padding: 0; }',
      'package.json': '{"name": "test-project"}',
    });

    outputDir = join(projectRoot, '.understand-anything-trae', 'intermediate');
    mkdirSync(outputDir, { recursive: true });

    writeScanResult(outputDir, [
      { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
      { path: 'src/utils.ts', language: 'typescript', fileCategory: 'code' },
      { path: 'src/styles.css', language: 'css', fileCategory: 'code' },
      { path: 'src/reset.css', language: 'css', fileCategory: 'code' },
      { path: 'package.json', language: 'json', fileCategory: 'config' },
    ]);

    const r = runScript(projectRoot, outputDir);

    expect(r.status).toBe(0);

    // All 3 output files produced with scriptCompleted: true
    expect(r.importMap).not.toBeNull();
    expect(r.importMap.scriptCompleted).toBe(true);

    expect(r.structure).not.toBeNull();
    expect(r.structure.scriptCompleted).toBe(true);

    expect(r.exportsMap).not.toBeNull();
    expect(r.exportsMap.scriptCompleted).toBe(true);
  });

  it('AP-002: import resolution (A.ts imports B.ts)', () => {
    projectRoot = setupTree({
      'src/a.ts': `import { b } from './b';\nexport const a = b;\n`,
      'src/b.ts': `export const b = 1;\n`,
    });

    outputDir = join(projectRoot, '.understand-anything-trae', 'intermediate');
    mkdirSync(outputDir, { recursive: true });

    writeScanResult(outputDir, [
      { path: 'src/a.ts', language: 'typescript', fileCategory: 'code' },
      { path: 'src/b.ts', language: 'typescript', fileCategory: 'code' },
    ]);

    const r = runScript(projectRoot, outputDir);

    expect(r.status).toBe(0);
    expect(r.importMap.importMap['src/a.ts']).toContain('src/b.ts');
    expect(r.importMap.importMap['src/b.ts']).toEqual([]);
  });

  it('AP-003: export symbols (file with export function/class)', () => {
    projectRoot = setupTree({
      'src/index.ts':
        'export function foo() { return 1; }\n' +
        'export class Bar { run() {} }\n',
    });

    outputDir = join(projectRoot, '.understand-anything-trae', 'intermediate');
    mkdirSync(outputDir, { recursive: true });

    writeScanResult(outputDir, [
      { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
    ]);

    const r = runScript(projectRoot, outputDir);

    expect(r.status).toBe(0);
    expect(r.exportsMap.exportsMap['src/index.ts']).toEqual(
      expect.arrayContaining(['foo', 'Bar']),
    );
  });

  it('AP-004: determinism (same project twice → all 3 outputs byte-identical)', () => {
    projectRoot = setupTree({
      'src/a.ts': `import { b } from './b';\nexport const a = b;\n`,
      'src/b.ts': `export const b = 1;\n`,
    });

    outputDir = join(projectRoot, '.understand-anything-trae', 'intermediate');
    mkdirSync(outputDir, { recursive: true });

    writeScanResult(outputDir, [
      { path: 'src/a.ts', language: 'typescript', fileCategory: 'code' },
      { path: 'src/b.ts', language: 'typescript', fileCategory: 'code' },
    ]);

    const r1 = runScript(projectRoot, outputDir);
    expect(r1.status).toBe(0);

    const importMap1 = readFileSync(join(outputDir, 'import-map.json'), 'utf-8');
    const structure1 = readFileSync(join(outputDir, 'structure-results.json'), 'utf-8');
    const exportsMap1 = readFileSync(join(outputDir, 'exports-map.json'), 'utf-8');

    const r2 = runScript(projectRoot, outputDir);
    expect(r2.status).toBe(0);

    const importMap2 = readFileSync(join(outputDir, 'import-map.json'), 'utf-8');
    const structure2 = readFileSync(join(outputDir, 'structure-results.json'), 'utf-8');
    const exportsMap2 = readFileSync(join(outputDir, 'exports-map.json'), 'utf-8');

    expect(importMap1).toBe(importMap2);
    expect(structure1).toBe(structure2);
    expect(exportsMap1).toBe(exportsMap2);
  });

  it('AP-005: empty/corrupt files (filesSkipped contains corrupt files, rest normal)', () => {
    projectRoot = setupTree({
      'src/good.ts': 'export function good() { return 1; }\n',
    });

    outputDir = join(projectRoot, '.understand-anything-trae', 'intermediate');
    mkdirSync(outputDir, { recursive: true });

    // Reference a file that doesn't exist on disk
    writeScanResult(outputDir, [
      { path: 'src/good.ts', language: 'typescript', fileCategory: 'code' },
      { path: 'src/missing.ts', language: 'typescript', fileCategory: 'code' },
    ]);

    const r = runScript(projectRoot, outputDir);

    expect(r.status).toBe(0);
    // The missing file should be in filesSkipped
    expect(r.structure.filesSkipped).toContain('src/missing.ts');
    // The good file should still be analyzed
    expect(r.structure.results.find(s => s.path === 'src/good.ts')).toBeDefined();
    // Warning emitted for missing file
    expect(r.stderr).toMatch(/Warning: analyze-project: analysis failed for src\/missing\.ts/);
  });

  it('AP-006: mixed language project (TS + CSS + HTML + Markdown)', () => {
    projectRoot = setupTree({
      'src/app.ts': 'export function app() {}\n',
      'src/style.css': 'body { margin: 0; }\n',
      'src/page.html': '<!DOCTYPE html><html><head><script src="./app.js"></script></head></html>',
      'README.md': '# Project\n\nDescription.\n',
    });

    outputDir = join(projectRoot, '.understand-anything-trae', 'intermediate');
    mkdirSync(outputDir, { recursive: true });

    writeScanResult(outputDir, [
      { path: 'src/app.ts', language: 'typescript', fileCategory: 'code' },
      { path: 'src/style.css', language: 'css', fileCategory: 'code' },
      { path: 'src/page.html', language: 'html', fileCategory: 'markup' },
      { path: 'README.md', language: 'markdown', fileCategory: 'docs' },
    ]);

    const r = runScript(projectRoot, outputDir);

    expect(r.status).toBe(0);

    // TS file: code category with exports
    const tsResult = r.structure.results.find(s => s.path === 'src/app.ts');
    expect(tsResult).toBeDefined();
    expect(tsResult.fileCategory).toBe('code');
    expect(tsResult.functions.length).toBeGreaterThan(0);

    // CSS file: code category
    const cssResult = r.structure.results.find(s => s.path === 'src/style.css');
    expect(cssResult).toBeDefined();
    expect(cssResult.fileCategory).toBe('code');

    // HTML file: markup category
    const htmlResult = r.structure.results.find(s => s.path === 'src/page.html');
    expect(htmlResult).toBeDefined();

    // Markdown file: docs category
    const mdResult = r.structure.results.find(s => s.path === 'README.md');
    expect(mdResult).toBeDefined();

    // Non-code files have empty imports/exports
    expect(r.importMap.importMap['README.md']).toEqual([]);
    expect(r.exportsMap.exportsMap['README.md']).toEqual([]);
  });
});
