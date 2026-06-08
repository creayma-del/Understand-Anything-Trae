import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-trae-plugin/skills/understand/extract-metadata.mjs',
);

/**
 * Build a project tree from a `{ relPath: contents }` object. Creates parent
 * directories as needed.
 */
function setupTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'ua-em-test-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf-8');
  }
  return root;
}

/**
 * Tracks every temp output dir created by runScript() so the global
 * cleanup can sweep them between tests.
 */
const _runScriptOutputDirs = [];

/**
 * Run extract-metadata.mjs against `projectRoot`. Returns
 * { status, stdout, stderr, output } where `output` is the parsed JSON
 * written by the script (or null on failure).
 */
function runScript(projectRoot) {
  const outputDir = mkdtempSync(join(tmpdir(), 'ua-em-out-'));
  _runScriptOutputDirs.push(outputDir);
  const outputPath = join(outputDir, 'metadata.json');
  const result = spawnSync('node', [SCRIPT, projectRoot, outputPath], {
    encoding: 'utf-8',
  });
  let output = null;
  try {
    output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  } catch {
    /* output missing on hard failure */
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output };
}

// Sweep every output dir created during a test back to disk-empty between
// tests.
afterEach(() => {
  while (_runScriptOutputDirs.length) {
    const d = _runScriptOutputDirs.pop();
    rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// EM-001: Standard Node.js project
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — EM-001 standard Node.js project', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('extracts name/description/frameworks from package.json + README.md', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({
        name: 'my-app',
        description: 'A cool application',
        dependencies: { react: '^18' },
        devDependencies: { vite: '^5' },
      }),
      'README.md': '# My App\n\nThis is my app.\n',
      'src/index.ts': 'export const x = 1;\n',
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.name).toBe('my-app');
    expect(r.output.rawDescription).toBe('A cool application');
    expect(r.output.description).toBe('A cool application');
    expect(r.output.readmeHead).toContain('# My App');
    expect(r.output.frameworks).toContain('React');
    expect(r.output.frameworks).toContain('Vite');
    // languages is empty because no scan-result.json
    expect(r.output.languages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EM-002: No package.json
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — EM-002 no package.json', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('falls back to directory name for name, empty rawDescription, empty frameworks', () => {
    projectRoot = setupTree({
      'README.md': '# My Project\n\nSome description here.\n',
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    // Name should be the directory name
    expect(r.output.name).toBe(basename(projectRoot));
    expect(r.output.rawDescription).toBe('');
    expect(r.output.frameworks).toEqual([]);
    // Description synthesized from README
    expect(r.output.description).toContain('Some description here');
  });
});

// ---------------------------------------------------------------------------
// EM-003: No README
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — EM-003 no README', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('produces empty readmeHead but correct name and rawDescription', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({
        name: 'no-readme-project',
        description: 'Project without README',
      }),
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.name).toBe('no-readme-project');
    expect(r.output.rawDescription).toBe('Project without README');
    expect(r.output.readmeHead).toBe('');
    expect(r.output.description).toBe('Project without README');
  });
});

// ---------------------------------------------------------------------------
// EM-004: Framework detection
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — EM-004 framework detection', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('detects frameworks from both dependencies and devDependencies in KNOWN_FRAMEWORKS order', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({
        name: 'framework-test',
        dependencies: { react: '^18' },
        devDependencies: { vite: '^5' },
      }),
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    // React appears before Vite in KNOWN_FRAMEWORKS definition order
    expect(r.output.frameworks).toEqual(['React', 'Vite']);
  });
});

// ---------------------------------------------------------------------------
// EM-005: Infrastructure detection
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — EM-005 infrastructure detection', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('detects Docker and GitHub Actions from file presence', () => {
    projectRoot = setupTree({
      'Dockerfile': 'FROM node:22\n',
      '.github/workflows/ci.yml': 'name: CI\non: push\n',
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.frameworks).toContain('Docker');
    expect(r.output.frameworks).toContain('GitHub Actions');
    // Infrastructure appended after dependency-based frameworks
    const dockerIdx = r.output.frameworks.indexOf('Docker');
    const ghaIdx = r.output.frameworks.indexOf('GitHub Actions');
    expect(dockerIdx).toBeLessThan(ghaIdx);
  });
});

// ---------------------------------------------------------------------------
// EM-006: Determinism
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — EM-006 determinism', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('produces byte-identical output across runs for the same input tree', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({
        name: 'deterministic-test',
        description: 'Testing determinism',
        dependencies: { react: '^18', vite: '^5' },
      }),
      'README.md': '# Test\n\nA test project.\n',
    });

    const r1 = runScript(projectRoot);
    const r2 = runScript(projectRoot);
    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);
    expect(JSON.stringify(r1.output)).toBe(JSON.stringify(r2.output));
  });
});

// ---------------------------------------------------------------------------
// EM-008: Description synthesis from README
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — EM-008 description synthesis', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('synthesizes description from README first paragraph when no rawDescription', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({
        name: 'synth-test',
        // No description field
      }),
      'README.md': '# My Project\n\nThis is the first paragraph of the README. It describes the project.\n\nThis is the second paragraph.\n',
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.rawDescription).toBe('');
    // Should skip the heading and empty line, take first paragraph
    expect(r.output.description).toBe(
      'This is the first paragraph of the README. It describes the project.',
    );
  });

  it('truncates long README paragraphs at 200 chars at word boundary', () => {
    const longParagraph = 'A '.repeat(150); // 300 chars
    projectRoot = setupTree({
      'package.json': JSON.stringify({ name: 'long-desc' }),
      'README.md': `# Title\n\n${longParagraph}\n`,
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.description.length).toBeLessThanOrEqual(203); // 200 + "..."
    expect(r.output.description.endsWith('...')).toBe(true);
    expect(r.output.description.length).toBeGreaterThan(0);
  });

  it('returns "No description available" when both rawDescription and readmeHead are empty', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({ name: 'empty-desc' }),
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.description).toBe('No description available');
  });
});

// ---------------------------------------------------------------------------
// EM-009: Monorepo
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — EM-009 monorepo', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('uses root package.json name, ignoring sub-directory package.json', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({
        name: 'my-monorepo',
        description: 'A monorepo project',
      }),
      'packages/app/package.json': JSON.stringify({
        name: '@my/app',
        description: 'Sub-package app',
      }),
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.name).toBe('my-monorepo');
    expect(r.output.rawDescription).toBe('A monorepo project');
  });
});

// ---------------------------------------------------------------------------
// EM-010: devDependencies framework detection
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — EM-010 devDependencies framework detection', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('detects frameworks from devDependencies only', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({
        name: 'dev-deps-test',
        devDependencies: { vite: '^5', vitest: '^1' },
      }),
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.frameworks).toContain('Vite');
    expect(r.output.frameworks).toContain('Vitest');
    // Vite comes before Vitest in KNOWN_FRAMEWORKS definition order
    const viteIdx = r.output.frameworks.indexOf('Vite');
    const vitestIdx = r.output.frameworks.indexOf('Vitest');
    expect(viteIdx).toBeLessThan(vitestIdx);
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: languages from scan-result.json
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — languages from scan-result.json', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('reads languages from scan-result.json stats.byLanguage keys', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({ name: 'lang-test' }),
    });
    // Create the intermediate directory and scan-result.json
    const interDir = join(projectRoot, '.understand-anything-trae', 'intermediate');
    mkdirSync(interDir, { recursive: true });
    writeFileSync(
      join(interDir, 'scan-result.json'),
      JSON.stringify({
        stats: {
          byLanguage: {
            typescript: 22,
            css: 5,
            markdown: 4,
          },
        },
      }),
      'utf-8',
    );

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.languages).toEqual(['css', 'markdown', 'typescript']);
  });

  it('returns empty languages array when scan-result.json is missing', () => {
    projectRoot = setupTree({
      'package.json': JSON.stringify({ name: 'no-scan-result' }),
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.languages).toEqual([]);
    expect(r.stderr).toMatch(
      /Warning: extract-metadata: cannot read scan-result\.json for languages/,
    );
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: invalid package.json
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — invalid package.json', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('warns on invalid JSON and falls back to directory name', () => {
    projectRoot = setupTree({
      'package.json': '{ invalid json }}}',
      'README.md': '# Project\n',
    });

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.name).toBe(basename(projectRoot));
    expect(r.output.rawDescription).toBe('');
    expect(r.stderr).toMatch(
      /Warning: extract-metadata: package\.json exists but is not valid JSON — skipping/,
    );
  });
});

// ---------------------------------------------------------------------------
// CLI guard
// ---------------------------------------------------------------------------
describe('extract-metadata.mjs — CLI entry guard', () => {
  it('fails fast with usage message when projectRoot is missing', () => {
    const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage: extract-metadata\.mjs/);
  });
});
