import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-trae-plugin/skills/understand/extract-import-map.mjs');

/**
 * Helper: write a source tree from a `files` object: { 'a/b.ts': '...', ... }.
 * Creates parent dirs as needed. Returns the temp project root.
 */
function setupTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'ua-eim-test-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf-8');
  }
  return root;
}

/**
 * Run the extract-import-map.mjs script. Returns
 * { status, stdout, stderr, output } where `output` is the parsed JSON
 * written by the script (or null on failure to read).
 *
 * `extraNodeArgs` is prepended to the node argv before the script path, so
 * tests can pass `--import` loader hooks to force specific failure modes.
 */
function runScript(projectRoot, input, extraNodeArgs = []) {
  const inputPath = join(projectRoot, 'ua-eim-input.json');
  const outputPath = join(projectRoot, 'ua-eim-output.json');
  writeFileSync(inputPath, JSON.stringify(input), 'utf-8');
  const result = spawnSync(
    'node',
    [...extraNodeArgs, SCRIPT, inputPath, outputPath],
    { encoding: 'utf-8' },
  );
  let output = null;
  try {
    output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  } catch {
    /* output missing on hard failure */
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output };
}

describe('extract-import-map.mjs — TypeScript / JavaScript resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves typescript relative imports with extension probes', () => {
    projectRoot = setupTree({
      'src/index.ts': `import { foo } from './utils';\nimport cfg from './config';\nfoo(cfg);\n`,
      'src/utils.ts': `export function foo(x: unknown) { return x; }\n`,
      'src/config.ts': `export default { debug: true };\n`,
      'README.md': '# project\n',
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/utils.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/config.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'README.md', language: 'markdown', fileCategory: 'docs' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.scriptCompleted).toBe(true);
    expect(result.output.importMap['src/index.ts']).toEqual([
      'src/config.ts',
      'src/utils.ts',
    ]);
    expect(result.output.importMap['src/utils.ts']).toEqual([]);
    // Non-code file gets empty array
    expect(result.output.importMap['README.md']).toEqual([]);

    expect(result.output.stats.filesScanned).toBe(4);
    expect(result.output.stats.filesWithImports).toBe(1);
    expect(result.output.stats.totalEdges).toBe(2);
  });

  it('resolves tsconfig paths aliases', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
            '~lib/*': ['src/lib/*'],
          },
        },
      }),
      'src/index.ts': `import { greet } from '@/utils/greet';\nimport { add } from '~lib/math';\n`,
      'src/utils/greet.ts': `export function greet(name: string) { return 'hi ' + name; }\n`,
      'src/lib/math.ts': `export const add = (a: number, b: number) => a + b;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/utils/greet.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/lib/math.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.ts']).toEqual([
      'src/lib/math.ts',
      'src/utils/greet.ts',
    ]);
  });

  it('resolves /index.ts barrel imports', () => {
    projectRoot = setupTree({
      'src/index.ts': `import { thing } from './stuff';\n`,
      'src/stuff/index.ts': `export const thing = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/stuff/index.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.ts']).toEqual(['src/stuff/index.ts']);
  });

  it('drops external package imports', () => {
    projectRoot = setupTree({
      'src/index.ts': `import express from 'express';\nimport { z } from 'zod';\nimport { foo } from './local';\n`,
      'src/local.ts': `export const foo = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/local.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Only the local import survives; express/zod are external.
    expect(result.output.importMap['src/index.ts']).toEqual(['src/local.ts']);
  });

  it('resolves javascript require() calls', () => {
    projectRoot = setupTree({
      'src/index.js': `const cfg = require('./config');\nconst utils = require('../shared/utils');\n`,
      'src/config.js': `module.exports = { x: 1 };\n`,
      'shared/utils.js': `module.exports = { y: 2 };\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.js', language: 'javascript', fileCategory: 'code' },
        { path: 'src/config.js', language: 'javascript', fileCategory: 'code' },
        { path: 'shared/utils.js', language: 'javascript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.js']).toEqual([
      'shared/utils.js',
      'src/config.js',
    ]);
  });

  it('resolves per-package tsconfig paths in a monorepo without cross-package leakage', () => {
    // Two pnpm-workspace packages, each carrying its own tsconfig with its
    // own `paths`. The resolver MUST dispatch per-importer to the nearest
    // tsconfig — and aliases from one package must NOT resolve files in
    // another package (each tsconfig anchors its baseUrl at its own dir).
    projectRoot = setupTree({
      'packages/foo/tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@foo/*': ['src/*'] },
        },
      }),
      'packages/foo/src/x.ts': `import { y } from '@foo/y';\nexport const x = y;\n`,
      'packages/foo/src/y.ts': `export const y = 1;\n`,
      'packages/bar/tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@bar/*': ['src/*'] },
        },
      }),
      'packages/bar/src/x.ts':
        `import { y } from '@bar/y';\n` +
        `import { fy } from '@foo/y';\n` +   // must NOT resolve from bar
        `export const x = y;\n`,
      'packages/bar/src/y.ts': `export const y = 2;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'packages/foo/tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'packages/foo/src/x.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'packages/foo/src/y.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'packages/bar/tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'packages/bar/src/x.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'packages/bar/src/y.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // foo/x sees its own @foo/y -> foo/src/y.ts only.
    expect(result.output.importMap['packages/foo/src/x.ts']).toEqual([
      'packages/foo/src/y.ts',
    ]);
    // bar/x sees its own @bar/y -> bar/src/y.ts. The cross-package @foo/y
    // import does NOT resolve because bar's tsconfig has no @foo/* alias.
    expect(result.output.importMap['packages/bar/src/x.ts']).toEqual([
      'packages/bar/src/y.ts',
    ]);
    expect(result.output.importMap['packages/bar/src/x.ts']).not.toContain(
      'packages/foo/src/y.ts',
    );
  });

  // ── Issue #214: tsconfig path-alias targets with leading "./" ───────────
  // create-next-app ships `"@/*": ["./*"]` as the default. With a root
  // tsconfig the candidate would stay as "./lib/thing" while ctx.fileSet
  // stores normalized "lib/thing", silently dropping every cross-module
  // import edge. Three originally broken cases plus one regression guard
  // for the already working `["*"]` form.

  it('resolves tsconfig paths with leading "./" target and no baseUrl (#214)', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          paths: { '@/*': ['./*'] },
        },
      }),
      'src/app.ts': `import { x } from '@/lib/thing';\nconst _ = x;\n`,
      'lib/thing.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/app.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'lib/thing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/app.ts']).toContain('lib/thing.ts');
  });

  it('resolves tsconfig paths with leading "./" target and baseUrl "." (#214)', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./*'] },
        },
      }),
      'src/app.ts': `import { x } from '@/lib/thing';\nconst _ = x;\n`,
      'lib/thing.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/app.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'lib/thing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/app.ts']).toContain('lib/thing.ts');
  });

  it('resolves tsconfig paths with leading "./" target and baseUrl "src" (#214)', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: 'src',
          paths: { '@/*': ['./*'] },
        },
      }),
      'src/app.ts': `import { x } from '@/thing';\nconst _ = x;\n`,
      'src/thing.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/app.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/thing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/app.ts']).toContain('src/thing.ts');
  });

  it('keeps resolving tsconfig paths with bare "*" target (#214 regression guard)', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          paths: { '@/*': ['*'] },
        },
      }),
      'src/app.ts': `import { x } from '@/lib/thing';\nconst _ = x;\n`,
      'lib/thing.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/app.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'lib/thing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/app.ts']).toContain('lib/thing.ts');
  });
});

describe('extract-import-map.mjs — Python resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves python relative imports', () => {
    projectRoot = setupTree({
      'src/app.py': `from . import helpers\nfrom .utils import shout\nfrom ..core import boot\n`,
      'src/helpers.py': `def help(): pass\n`,
      'src/utils.py': `def shout(): pass\n`,
      'core.py': `def boot(): pass\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/app.py', language: 'python', fileCategory: 'code' },
        { path: 'src/helpers.py', language: 'python', fileCategory: 'code' },
        { path: 'src/utils.py', language: 'python', fileCategory: 'code' },
        { path: 'core.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // `from . import helpers` resolves `helpers` as a sibling submodule
    // (`src/helpers.py`) even though `src/__init__.py` is absent — PEP 328
    // implicit namespace packages don't require it. `from .utils import shout`
    // resolves to `src/utils.py`. `from ..core import boot` -> `core.py`.
    expect(result.output.importMap['src/app.py']).toEqual([
      'core.py',
      'src/helpers.py',
      'src/utils.py',
    ]);
  });

  // Regression for PR review #2 on PR #204: `from . import x` was
  // dropped when no `__init__.py` was present at the importer's package
  // dir, because resolvePythonProbe gated specifier probing on the package
  // marker. Modern Python (PEP 420 namespace packages) commonly omits it.
  it('resolves `from . import x` for namespace packages (no __init__.py)', () => {
    projectRoot = setupTree({
      'src/svc/main.py':
        `from . import helpers, util\nfrom . import nested\n`,
      'src/svc/helpers.py': `def help(): pass\n`,
      'src/svc/util.py': `def u(): pass\n`,
      'src/svc/nested/__init__.py': `# package\n`,
      // Crucially: NO src/svc/__init__.py — namespace package
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/svc/main.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc/helpers.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc/util.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc/nested/__init__.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // All three siblings should resolve — helpers.py + util.py as direct
    // .py modules, nested/ as a package via its __init__.py.
    expect(result.output.importMap['src/svc/main.py']).toEqual([
      'src/svc/helpers.py',
      'src/svc/nested/__init__.py',
      'src/svc/util.py',
    ]);
  });

  it('resolves python absolute imports and __init__.py matching', () => {
    projectRoot = setupTree({
      'main.py': `import src.utils.formatter\nfrom src.utils import formatter\nfrom src import config\n`,
      'src/__init__.py': '',
      'src/utils/__init__.py': '',
      'src/utils/formatter.py': `def fmt(): pass\n`,
      'src/config.py': `DEBUG = True\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'main.py', language: 'python', fileCategory: 'code' },
        { path: 'src/__init__.py', language: 'python', fileCategory: 'code' },
        { path: 'src/utils/__init__.py', language: 'python', fileCategory: 'code' },
        { path: 'src/utils/formatter.py', language: 'python', fileCategory: 'code' },
        { path: 'src/config.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // `import src.utils.formatter` -> src/utils/formatter.py
    // `from src.utils import formatter` -> src/utils/__init__.py + src/utils/formatter.py
    // `from src import config` -> src/__init__.py + src/config.py
    expect(result.output.importMap['main.py']).toEqual([
      'src/__init__.py',
      'src/config.py',
      'src/utils/__init__.py',
      'src/utils/formatter.py',
    ]);
  });

  it('drops python external package imports', () => {
    projectRoot = setupTree({
      'app.py': `import os\nimport sys\nimport requests\nfrom datetime import datetime\nfrom .local import thing\n`,
      'local.py': `thing = 1\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'app.py', language: 'python', fileCategory: 'code' },
        { path: 'local.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // os/sys/requests/datetime are external; only ./local resolves.
    expect(result.output.importMap['app.py']).toEqual(['local.py']);
  });

  it('resolves absolute imports against the importers per-service root in multi-service repos', () => {
    // Mirrors microservices-demo: each service ships its own sibling files
    // under src/<service>/, and uses bare `import helpers` to reach them.
    // The probe MUST walk up from the importer's dir (not just probe
    // projectRoot). The same module name in two services must NOT cross-
    // resolve — importer-dir scope wins.
    projectRoot = setupTree({
      'src/svc_a/main.py':
        `import helpers\nfrom helpers import shout\n`,
      'src/svc_a/helpers.py':
        `def shout(): pass\n`,
      'src/svc_b/main.py':
        `import helpers\nfrom helpers import shout\n`,
      'src/svc_b/helpers.py':
        `def shout(): pass\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/svc_a/main.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc_a/helpers.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc_b/main.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc_b/helpers.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Each service's main.py resolves to its OWN helpers.py — no cross-link.
    expect(result.output.importMap['src/svc_a/main.py']).toEqual([
      'src/svc_a/helpers.py',
    ]);
    expect(result.output.importMap['src/svc_a/main.py']).not.toContain(
      'src/svc_b/helpers.py',
    );
    expect(result.output.importMap['src/svc_b/main.py']).toEqual([
      'src/svc_b/helpers.py',
    ]);
    expect(result.output.importMap['src/svc_b/main.py']).not.toContain(
      'src/svc_a/helpers.py',
    );
  });
});


describe('extract-import-map.mjs — per-file failure resilience', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('continues processing when a file is missing from disk', () => {
    // Build a project with one real file and one declared-but-missing file.
    // The missing file is still in the input list (the project-scanner
    // discovered it before something deleted it), so the resolver must
    // emit a Warning: line and set importMap[<missing>] = [] without
    // aborting the whole script.
    projectRoot = setupTree({
      'src/real.ts': `import { thing } from './other';\nexport const x = 1;\n`,
      'src/other.ts': `export const thing = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/real.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/other.ts', language: 'typescript', fileCategory: 'code' },
        // Declared but does not exist on disk
        { path: 'src/missing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Script completed cleanly
    expect(result.output.scriptCompleted).toBe(true);
    // Real files resolved
    expect(result.output.importMap['src/real.ts']).toEqual(['src/other.ts']);
    expect(result.output.importMap['src/other.ts']).toEqual([]);
    // Missing file is in importMap with []
    expect(result.output.importMap['src/missing.ts']).toEqual([]);
    // A warning was emitted on stderr for the missing file
    expect(result.stderr).toMatch(/Warning: extract-import-map: import resolution failed for src\/missing\.ts/);
    expect(result.stderr).toMatch(/importMap\[src\/missing\.ts\]=\[\]/);
  });

  it('emits a stats summary on stderr', () => {
    projectRoot = setupTree({
      'a.ts': `import { b } from './b';\n`,
      'b.ts': `export const b = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'a.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'b.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /extract-import-map: filesScanned=2 filesWithImports=1 totalEdges=1/,
    );
  });
});

describe('extract-import-map.mjs — output schema invariants', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('every input file appears in importMap (even with zero imports)', () => {
    projectRoot = setupTree({
      'a.ts': `// no imports\nexport const a = 1;\n`,
      'README.md': '# x\n',
      'Dockerfile': 'FROM node:22\n',
      'package.json': '{}\n',
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'a.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'README.md', language: 'markdown', fileCategory: 'docs' },
        { path: 'Dockerfile', language: 'dockerfile', fileCategory: 'infra' },
        { path: 'package.json', language: 'json', fileCategory: 'config' },
      ],
    });

    expect(result.status).toBe(0);
    expect(Object.keys(result.output.importMap).sort()).toEqual([
      'Dockerfile', 'README.md', 'a.ts', 'package.json',
    ]);
    for (const arr of Object.values(result.output.importMap)) {
      expect(Array.isArray(arr)).toBe(true);
    }
  });

  it('produces deterministic output across runs', () => {
    projectRoot = setupTree({
      'src/a.ts': `import { b } from './b';\nimport { c } from './c';\n`,
      'src/b.ts': `export const b = 1;\n`,
      'src/c.ts': `export const c = 2;\n`,
    });

    const input = {
      projectRoot,
      files: [
        { path: 'src/a.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/b.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/c.ts', language: 'typescript', fileCategory: 'code' },
      ],
    };

    const r1 = runScript(projectRoot, input);
    const r2 = runScript(projectRoot, input);
    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);
    expect(JSON.stringify(r1.output)).toBe(JSON.stringify(r2.output));
  });
});

// ===========================================================================
// Hardening regression tests
//
// These tests cover the failure modes called out in code review:
//   - graceful tree-sitter init failure (IMPORTANT 1)
//   - tsconfig parse resilience (IMPORTANT 2)
//   - comment-aware import regexes for JS/Ruby/Rust (MINOR 4)
//   - tighter Kotlin import grammar (MINOR 5)
//   - multi-match Gradle/Maven dotted-FQN behavior (MINOR 6)
//   - composer.json malformed warning (MINOR 7)
//   - Rust 'use crate::' with no crate root — one-time warning (MINOR 9)
// ===========================================================================

describe('extract-import-map.mjs — regex comment-strip resilience', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('JS require() inside a // line comment is NOT picked up', () => {
    projectRoot = setupTree({
      'src/index.js':
        `// require('./fake');  <- commented out, must be ignored\n` +
        `/* require('./alsofake'); also commented */\n` +
        `const real = require('./real');\n`,
      'src/real.js': `module.exports = { x: 1 };\n`,
      'src/fake.js': `module.exports = { fake: true };\n`,
      'src/alsofake.js': `module.exports = { fake: true };\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.js', language: 'javascript', fileCategory: 'code' },
        { path: 'src/real.js', language: 'javascript', fileCategory: 'code' },
        { path: 'src/fake.js', language: 'javascript', fileCategory: 'code' },
        { path: 'src/alsofake.js', language: 'javascript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Only the real require survives; both commented-out requires are dropped.
    expect(result.output.importMap['src/index.js']).toEqual(['src/real.js']);
    expect(result.output.importMap['src/index.js']).not.toContain('src/fake.js');
    expect(result.output.importMap['src/index.js']).not.toContain('src/alsofake.js');
  });
});


describe('extract-import-map.mjs — tsconfig parse resilience', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('emits a Warning: when tsconfig.json is malformed and falls back to no aliases', () => {
    projectRoot = setupTree({
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", ', // unterminated
      'src/index.ts':
        `import { foo } from '@/utils';\nimport { bar } from './sibling';\n`,
      'src/sibling.ts': `export const bar = 1;\n`,
      'src/utils.ts': `export const foo = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/sibling.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/utils.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /Warning: extract-import-map: tsconfig\.json at .* failed to parse/,
    );
    // Phrased "from this config" in the plural-tsconfigs implementation
    // because per-file walk-up now identifies the specific bad tsconfig.
    expect(result.stderr).toMatch(/path aliases.*will not be applied/);
    // Aliased import unresolved; relative import still resolves.
    expect(result.output.importMap['src/index.ts']).toEqual(['src/sibling.ts']);
  });

  it('falls back to raw-text parse when a paths value contains "//" that the stripper would damage', () => {
    // tsconfig with NO comments but a string literal containing "//". The
    // naive stripper would chew the second `//` away and break the JSON;
    // the raw-text fallback should rescue the parse.
    const tsconfigRaw = `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@scheme//foo/*": ["src/foo/*"]
    }
  }
}
`;
    projectRoot = setupTree({
      'tsconfig.json': tsconfigRaw,
      'src/index.ts': `import { x } from '@scheme//foo/bar';\n`,
      'src/foo/bar.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/foo/bar.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Either path: the stripper damages the string but the raw retry rescues,
    // OR the stripper happens not to damage it. Either way, no warning fires
    // and the alias must resolve.
    expect(result.stderr).not.toMatch(/tsconfig\.json .* failed to parse/);
    expect(result.output.importMap['src/index.ts']).toEqual(['src/foo/bar.ts']);
  });
});

describe('extract-import-map.mjs — tree-sitter init graceful failure', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('emits a Warning: and produces empty importMap entries when tree-sitter init throws', () => {
    // Force tree-sitter init to fail by intercepting the `web-tree-sitter`
    // module load with an ESM loader hook. This simulates the real-world
    // failure mode where the WASM grammar binaries are missing or
    // inaccessible (cache eviction, restricted sandbox, etc.).
    projectRoot = setupTree({
      'src/index.ts': `import { x } from './lib';\nexport const y = x;\n`,
      'src/lib.ts': `export const x = 1;\n`,
    });

    // Write the loader hook + register module to the temp project root.
    const hookPath = join(projectRoot, 'ua-eim-fail-hook.mjs');
    const loaderPath = join(projectRoot, 'ua-eim-fail-loader.mjs');
    writeFileSync(
      hookPath,
      `export async function resolve(specifier, ctx, nextResolve) {\n` +
      `  if (specifier === 'web-tree-sitter') {\n` +
      `    throw new Error('synthetic: web-tree-sitter unavailable in test');\n` +
      `  }\n` +
      `  return nextResolve(specifier, ctx);\n` +
      `}\n`,
      'utf-8',
    );
    writeFileSync(
      loaderPath,
      `import { register } from 'node:module';\n` +
      `import { pathToFileURL } from 'node:url';\n` +
      `register(pathToFileURL(${JSON.stringify(hookPath)}).href);\n`,
      'utf-8',
    );

    const result = runScript(
      projectRoot,
      {
        projectRoot,
        files: [
          { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
          { path: 'src/lib.ts', language: 'typescript', fileCategory: 'code' },
        ],
      },
      ['--import', loaderPath],
    );

    expect(result.status).toBe(0);
    // Script completed cleanly with the documented degraded output.
    expect(result.output.scriptCompleted).toBe(true);
    expect(result.stderr).toMatch(
      /Warning: extract-import-map: tree-sitter init failed/,
    );
    expect(result.stderr).toMatch(/structural graph will have no import edges/);
    // Both code files get empty importMap entries.
    expect(result.output.importMap['src/index.ts']).toEqual([]);
    expect(result.output.importMap['src/lib.ts']).toEqual([]);
    // Stats reflect the degraded run: no edges, no files with imports.
    expect(result.output.stats.filesScanned).toBe(2);
    expect(result.output.stats.filesWithImports).toBe(0);
    expect(result.output.stats.totalEdges).toBe(0);
  });
});
