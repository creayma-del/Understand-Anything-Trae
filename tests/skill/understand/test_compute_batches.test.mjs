import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-trae-plugin/skills/understand/compute-batches.mjs');
const FIXTURES = resolve(__dirname, 'fixtures');

function runScript(projectRoot, extraArgs = []) {
  return spawnSync('node', [SCRIPT, projectRoot, ...extraArgs], {
    encoding: 'utf-8',
  });
}

function setupProject(fixtureName) {
  const root = mkdtempSync(join(tmpdir(), 'ua-cb-test-'));
  mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });
  const fixturePath = join(FIXTURES, fixtureName);
  const dest = join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json');
  writeFileSync(dest, readFileSync(fixturePath, 'utf-8'));
  return root;
}

function readBatches(projectRoot) {
  const p = join(projectRoot, '.understand-anything-trae', 'intermediate', 'batches.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
}

describe('compute-batches.mjs — Louvain basic', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = setupProject('scan-result-3-cliques.json');
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('produces merged batches for 3 small cliques (each < MIN_BATCH_SIZE=5)', () => {
    const result = runScript(projectRoot);
    expect(result.status).toBe(0);

    const batches = readBatches(projectRoot);
    expect(batches.algorithm).toBe('louvain');
    expect(batches.totalFiles).toBe(9);
    // Each clique has 3 files < MIN_BATCH_SIZE=5 → all merged into 1 misc batch
    expect(batches.batches.length).toBe(1);
    expect(batches.batches[0].files.length).toBe(9);
    expect(batches.schemaVersion).toBe(1);
    expect(batches.totalBatches).toBe(1);
    expect(batches.batches.map(b => b.batchIndex)).toEqual([1]);
  });

  it('produces deterministic output across runs', () => {
    const r1 = runScript(projectRoot);
    expect(r1.status).toBe(0);
    const json1 = readFileSync(
      join(projectRoot, '.understand-anything-trae', 'intermediate', 'batches.json'),
      'utf-8',
    );

    const r2 = runScript(projectRoot);
    expect(r2.status).toBe(0);
    const json2 = readFileSync(
      join(projectRoot, '.understand-anything-trae', 'intermediate', 'batches.json'),
      'utf-8',
    );

    expect(json1).toBe(json2);
  });
});

describe('compute-batches.mjs — size enforcement', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = setupProject('scan-result-large-community.json');
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('splits a 40-node clique into a single batch (≤ 60)', () => {
    const result = runScript(projectRoot);
    expect(result.status).toBe(0);

    const batches = readBatches(projectRoot);
    expect(batches.algorithm).toBe('louvain');  // confirm fallback didn't fire
    expect(batches.totalFiles).toBe(40);
    // 40 ≤ MAX_COMMUNITY_SIZE=60, so no split — one batch
    expect(batches.batches.length).toBe(1);
    expect(batches.batches[0].files.length).toBe(40);
    // No Warning about community size exceeding max
    expect(result.stderr).not.toMatch(/Warning: compute-batches: community size/);
  });
});

describe('compute-batches.mjs — exports extraction', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('populates exports for code files via tree-sitter', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-exp-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'),
      'export function greet(name: string) { return "hi " + name; }\n' +
      'export class Greeter { greet(n: string) { return "hi " + n; } }\n');
    writeFileSync(join(root, 'src', 'b.ts'),
      'import { greet } from "./a";\nexport const helper = () => greet("world");\n');

    const scan = {
      name: 'exports-test',
      description: '',
      languages: ['typescript'],
      frameworks: [],
      files: [
        { path: 'src/a.ts', language: 'typescript', sizeLines: 2, fileCategory: 'code' },
        { path: 'src/b.ts', language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      ],
      totalFiles: 2, filteredByIgnore: 0, estimatedComplexity: 'small',
      importMap: { 'src/a.ts': [], 'src/b.ts': ['src/a.ts'] },
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    expect(batches.exportsByPath).toBeDefined();
    expect(batches.exportsByPath['src/a.ts']).toEqual(
      expect.arrayContaining(['greet', 'Greeter']));
    expect(batches.exportsByPath['src/b.ts']).toEqual(
      expect.arrayContaining(['helper']));
  });

  it('emits warning when file is missing from disk (read error path)', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-exp-err-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });
    // Note: NOT creating the file on disk — scan-result.json references it,
    // but the file doesn't exist, so the read branch fires.
    const scan = {
      name: 'missing-file-test',
      description: '',
      languages: ['typescript'],
      frameworks: [],
      files: [
        { path: 'src/missing.ts', language: 'typescript', sizeLines: 1, fileCategory: 'code' },
      ],
      totalFiles: 1, filteredByIgnore: 0, estimatedComplexity: 'small',
      importMap: { 'src/missing.ts': [] },
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);  // script must still succeed
    expect(result.stderr).toMatch(
      /Warning: compute-batches: exports extraction failed for src\/missing\.ts \(read error:/);

    const batches = readBatches(root);
    expect(batches.exportsByPath['src/missing.ts']).toEqual([]);
  });
});

describe('compute-batches.mjs — non-code grouping', () => {
  let root;
  let batches;

  beforeEach(() => {
    root = setupProject('scan-result-non-code.json');
    const result = runScript(root);
    expect(result.status).toBe(0);
    batches = readBatches(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('Group A: bundles Dockerfile cluster per directory', () => {
    // Root-level cluster: Dockerfile + .dockerignore → one batch
    const rootDockerBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'Dockerfile'));
    expect(rootDockerBatch).toBeDefined();
    const paths = rootDockerBatch.files.map(f => f.path).sort();
    expect(paths).toEqual(['.dockerignore', 'Dockerfile']);

    // services/api cluster is a separate batch
    const apiDockerBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'services/api/Dockerfile'));
    expect(apiDockerBatch).toBeDefined();
    expect(apiDockerBatch).not.toBe(rootDockerBatch);
    expect(apiDockerBatch.files.map(f => f.path).sort()).toEqual([
      'services/api/Dockerfile',
    ]);
  });

  it('Group B: .github/workflows/* all in one batch', () => {
    const wfBatch = batches.batches.find(b =>
      b.files.some(f => f.path.startsWith('.github/workflows/')));
    expect(wfBatch).toBeDefined();
    const wfPaths = wfBatch.files.map(f => f.path).filter(p => p.startsWith('.github/workflows/'));
    expect(wfPaths.sort()).toEqual([
      '.github/workflows/ci.yml', '.github/workflows/deploy.yml',
    ]);
  });

  it('Group C: .gitlab-ci.yml + .circleci/* in one batch', () => {
    const ciBatch = batches.batches.find(b =>
      b.files.some(f => f.path === '.gitlab-ci.yml'));
    expect(ciBatch).toBeDefined();
    const ciPaths = ciBatch.files.map(f => f.path).sort();
    expect(ciPaths).toEqual(['.circleci/config.yml', '.gitlab-ci.yml']);
  });

  it('Group D: SQL migrations under migrations/ in one batch', () => {
    const migBatch = batches.batches.find(b =>
      b.files.some(f => f.path.startsWith('migrations/')));
    expect(migBatch).toBeDefined();
    const migPaths = migBatch.files.map(f => f.path).filter(p => p.startsWith('migrations/'));
    expect(migPaths.sort()).toEqual([
      'migrations/001_init.sql', 'migrations/002_users.sql',
    ]);
  });

  it('non-code batch indices follow code batches', () => {
    const codeBatches = batches.batches.filter(b =>
      b.files.every(f => f.fileCategory === 'code'));
    const nonCodeBatches = batches.batches.filter(b =>
      b.files.some(f => f.fileCategory !== 'code'));
    expect(codeBatches.length).toBeGreaterThan(0);
    expect(nonCodeBatches.length).toBeGreaterThan(0);
    const maxCodeIdx = Math.max(...codeBatches.map(b => b.batchIndex));
    const minNonCodeIdx = Math.min(...nonCodeBatches.map(b => b.batchIndex));
    expect(minNonCodeIdx).toBeGreaterThan(maxCodeIdx);
  });
});

describe('compute-batches.mjs — Group E MAX_E split', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('fits 25 .md files under docs/ into a single batch (≤ 35)', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-maxe-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });

    const files = [];
    const importMap = {};
    for (let i = 0; i < 25; i++) {
      const p = `docs/page${String(i).padStart(2, '0')}.md`;
      files.push({ path: p, language: 'markdown', sizeLines: 10, fileCategory: 'docs' });
      importMap[p] = [];
    }
    const scan = {
      name: 'maxe-test', description: '',
      languages: ['markdown'], frameworks: [],
      files, totalFiles: 25, filteredByIgnore: 0,
      estimatedComplexity: 'small', importMap,
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    // All 25 docs/ files go through Group E with MAX_E = 35, fit in one batch.
    const docsBatches = batches.batches.filter(b =>
      b.files.every(f => f.path.startsWith('docs/')));
    expect(docsBatches.length).toBe(1);
    expect(docsBatches[0].files.length).toBe(25);
  });
});

describe('compute-batches.mjs — neighborMap + batchImportData', () => {
  let batches;
  let batchOf;  // path → batchIndex
  let projectRoot;

  beforeEach(() => {
    projectRoot = setupProject('scan-result-3-cliques.json');
    const result = runScript(projectRoot);
    expect(result.status).toBe(0);
    batches = readBatches(projectRoot);
    batchOf = new Map();
    for (const b of batches.batches) {
      for (const f of b.files) batchOf.set(f.path, b.batchIndex);
    }
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('batchImportData mirrors scan importMap per batch', () => {
    for (const b of batches.batches) {
      for (const f of b.files) {
        expect(b.batchImportData[f.path]).toBeDefined();
        expect(Array.isArray(b.batchImportData[f.path])).toBe(true);
      }
    }
    // src/auth/login.ts imports src/auth/session.ts and src/auth/tokens.ts
    const loginBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'src/auth/login.ts'));
    expect(loginBatch.batchImportData['src/auth/login.ts'].sort()).toEqual([
      'src/auth/session.ts', 'src/auth/tokens.ts',
    ]);
  });

  it('neighborMap excludes same-batch files', () => {
    // The fixture's three cliques each go into one batch — all imports are
    // intra-batch, so no neighbor map should reference any same-batch file.
    for (const b of batches.batches) {
      const sameBatchPaths = new Set(b.files.map(f => f.path));
      for (const [, neighbors] of Object.entries(b.neighborMap)) {
        for (const n of neighbors) {
          expect(sameBatchPaths.has(n.path)).toBe(false);
        }
      }
    }
  });

  it('neighborMap entries carry symbols when target has exports', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-cb-nbr-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });
    mkdirSync(join(root, 'src', 'a'), { recursive: true });
    mkdirSync(join(root, 'src', 'b'), { recursive: true });

    // Cluster A: 5 tightly-imported files (≥ MIN_BATCH_SIZE=5 to survive merge).
    // a/core.ts exports symbols.
    writeFileSync(join(root, 'src', 'a', 'core.ts'),
      'export function findUser(id: string) { return null; }\nexport class User {}\n');
    writeFileSync(join(root, 'src', 'a', 'helper1.ts'),
      'import { findUser } from "./core";\nexport const h1 = () => findUser("x");\n');
    writeFileSync(join(root, 'src', 'a', 'helper2.ts'),
      'import { User } from "./core";\nimport { h1 } from "./helper1";\nexport const h2 = () => h1();\n');
    writeFileSync(join(root, 'src', 'a', 'util1.ts'),
      'import { findUser } from "./core";\nexport const u1 = () => findUser("a");\n');
    writeFileSync(join(root, 'src', 'a', 'util2.ts'),
      'import { u1 } from "./util1";\nexport const u2 = () => u1();\n');

    // Cluster B: 5 tightly-imported files (≥ MIN_BATCH_SIZE=5 to survive merge).
    // b/entry.ts has ONE cross-cluster import to a/core.ts.
    writeFileSync(join(root, 'src', 'b', 'entry.ts'),
      'import { findUser } from "../a/core";\nexport const entry = () => findUser("y");\n');
    writeFileSync(join(root, 'src', 'b', 'middle.ts'),
      'import { entry } from "./entry";\nexport const middle = () => entry();\n');
    writeFileSync(join(root, 'src', 'b', 'leaf.ts'),
      'import { middle } from "./middle";\nexport const leaf = () => middle();\n');
    writeFileSync(join(root, 'src', 'b', 'svc1.ts'),
      'import { entry } from "./entry";\nexport const s1 = () => entry();\n');
    writeFileSync(join(root, 'src', 'b', 'svc2.ts'),
      'import { s1 } from "./svc1";\nexport const s2 = () => s1();\n');

    const files = [
      { path: 'src/a/core.ts',    language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/a/helper1.ts', language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/a/helper2.ts', language: 'typescript', sizeLines: 3, fileCategory: 'code' },
      { path: 'src/a/util1.ts',   language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/a/util2.ts',   language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/b/entry.ts',   language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/b/middle.ts',  language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/b/leaf.ts',    language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/b/svc1.ts',    language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/b/svc2.ts',    language: 'typescript', sizeLines: 2, fileCategory: 'code' },
    ];
    const scan = {
      name: 't', description: '',
      languages: ['typescript'], frameworks: [],
      files,
      totalFiles: 10, filteredByIgnore: 0, estimatedComplexity: 'small',
      importMap: {
        'src/a/core.ts': [],
        'src/a/helper1.ts': ['src/a/core.ts'],
        'src/a/helper2.ts': ['src/a/core.ts', 'src/a/helper1.ts'],
        'src/a/util1.ts': ['src/a/core.ts'],
        'src/a/util2.ts': ['src/a/util1.ts'],
        'src/b/entry.ts': ['src/a/core.ts'],  // CROSS-CLUSTER
        'src/b/middle.ts': ['src/b/entry.ts'],
        'src/b/leaf.ts': ['src/b/middle.ts'],
        'src/b/svc1.ts': ['src/b/entry.ts'],
        'src/b/svc2.ts': ['src/b/svc1.ts'],
      },
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);
    const out = readBatches(root);

    // Expect 2 communities (cluster A and cluster B). Verify that some batch's
    // neighborMap entry references src/a/core.ts with its symbols.
    let sawSymbols = false;
    for (const batch of out.batches) {
      for (const [, neighbors] of Object.entries(batch.neighborMap)) {
        for (const n of neighbors) {
          if (n.path === 'src/a/core.ts') {
            expect(n.symbols).toEqual(expect.arrayContaining(['findUser', 'User']));
            sawSymbols = true;
          }
        }
      }
    }
    expect(sawSymbols).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});

describe('compute-batches.mjs — neighborMap truncation', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('truncates and warns when neighbors > 50', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-trunc-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });
    // hub.ts imported by 60 other files
    const files = [{ path: 'src/hub.ts', language: 'typescript', sizeLines: 1, fileCategory: 'code' }];
    const importMap = { 'src/hub.ts': [] };
    for (let i = 0; i < 60; i++) {
      const p = `src/leaf${i}.ts`;
      files.push({ path: p, language: 'typescript', sizeLines: 1, fileCategory: 'code' });
      importMap[p] = ['src/hub.ts'];
    }
    const scan = {
      name: 't', description: '', languages: ['typescript'], frameworks: [],
      files, totalFiles: files.length, filteredByIgnore: 0,
      estimatedComplexity: 'moderate', importMap,
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));
    const result = runScript(root);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /neighborMap for src\/hub\.ts has high 1-hop degree 60 — exceeds soft cap of 50/);
    const out = readBatches(root);
    // Find hub.ts and confirm its neighbor list capped at 50 (in whichever batch it landed)
    for (const b of out.batches) {
      const nbrs = b.neighborMap['src/hub.ts'];
      if (nbrs) expect(nbrs.length).toBeLessThanOrEqual(50);
    }
  });
});

describe('compute-batches.mjs — fallback', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('falls back to count-based when Louvain throws (env-injected mock)', () => {
    // We can't easily monkey-patch louvain mid-script in Vitest because the
    // script runs in a subprocess. Instead, set an env var the script honors:
    // UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW=1 → script throws inside its
    // Louvain branch, exercising the fallback path.
    root = setupProject('scan-result-3-cliques.json');
    const result = spawnSync('node',
      [SCRIPT, root],
      { encoding: 'utf-8', env: { ...process.env, UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW: '1' } },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /Warning: compute-batches: Louvain failed.*falling back to count-based grouping \(25 files\/batch\)/);
    const out = readBatches(root);
    expect(out.algorithm).toBe('count-fallback');
    expect(out.totalFiles).toBe(9);
    // Count-based: 25 files per batch → all 9 fit in one batch
    const codeBatchFileCount = out.batches
      .filter(b => b.files.every(f => f.fileCategory === 'code'))
      .reduce((sum, b) => sum + b.files.length, 0);
    expect(codeBatchFileCount).toBe(9);
  });
});

describe('compute-batches.mjs — merge-small', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = setupProject('scan-result-singletons.json');
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('merges 100 isolated singletons into a small number of misc batches', () => {
    const result = runScript(projectRoot);
    expect(result.status).toBe(0);

    const batches = readBatches(projectRoot);
    expect(batches.totalFiles).toBe(100);

    // With merge-small (MAX_MERGE_TARGET=40): ceil(100 / 40) = 3 misc batches.
    expect(batches.batches.length).toBe(3);

    // All files accounted for
    const totalAssigned = batches.batches.reduce((sum, b) => sum + b.files.length, 0);
    expect(totalAssigned).toBe(100);

    // Bucket-fullness check: 100 / 40 = 2 remainder 20, so [40, 40, 20].
    const sizes = batches.batches.map(b => b.files.length).sort((a, b) => b - a);
    expect(sizes).toEqual([40, 40, 20]);

    // Info: (not Warning:) — merge-small is a routine optimization, not a
    // fallback path. See compute-batches.mjs mergeSmallBatches WHY comment.
    expect(result.stderr).toMatch(
      /Info: compute-batches: merged \d+ small batches \(\d+ files\) into \d+ misc batches/);
    expect(result.stderr).not.toMatch(/Warning: compute-batches: merged \d+ small batches/);
  });

  it('preserves non-mergeable batches: Dockerfile cluster not pooled into misc', () => {
    // Dedicated fixture: 30 isolated TS singletons + 1 Dockerfile-only cluster.
    // Group A marks the Dockerfile batch mergeable=false; even though its size
    // (1) is below MIN_BATCH_SIZE=3, mergeSmallBatches must leave it intact.
    const altRoot = setupProject('scan-result-merge-respects-non-mergeable.json');
    try {
      const result = runScript(altRoot);
      expect(result.status).toBe(0);

      const out = readBatches(altRoot);
      expect(out.totalFiles).toBe(31);

      const dockerBatch = out.batches.find(b =>
        b.files.some(f => f.path === 'services/api/Dockerfile'));
      expect(dockerBatch).toBeDefined();
      // Standalone: exactly the Dockerfile, nothing pooled in alongside it.
      expect(dockerBatch.files.length).toBe(1);
      expect(dockerBatch.files[0].path).toBe('services/api/Dockerfile');

      // The TS singletons must still merge into at least one misc batch —
      // and that misc batch must NOT contain the Dockerfile.
      const miscBatches = out.batches.filter(b =>
        b.files.some(f => f.path.startsWith('src/leaf')));
      expect(miscBatches.length).toBeGreaterThanOrEqual(1);
      for (const m of miscBatches) {
        for (const f of m.files) {
          expect(f.path).not.toBe('services/api/Dockerfile');
        }
      }

      // Every TS singleton accounted for across the misc bucket(s).
      const tsInMisc = miscBatches.flatMap(b => b.files.map(f => f.path))
        .filter(p => p.startsWith('src/leaf'));
      expect(tsInMisc.length).toBe(30);
    } finally {
      rmSync(altRoot, { recursive: true, force: true });
    }
  });
});

describe('compute-batches.mjs — --changed-files', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('emits only batches containing changed files', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-changed-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });

    // Create 3 cliques of 5 files each (≥ MIN_BATCH_SIZE=5 to survive merge)
    const files = [];
    const importMap = {};
    for (const dir of ['auth', 'api', 'db']) {
      for (let i = 0; i < 5; i++) {
        const p = `src/${dir}/f${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = [];
        for (let j = 0; j < 5; j++) {
          if (j !== i) importMap[p].push(`src/${dir}/f${j}.ts`);
        }
      }
    }
    const scan = {
      name: 'changed-test', description: '',
      languages: ['typescript'], frameworks: [],
      files, totalFiles: 15, filteredByIgnore: 0,
      estimatedComplexity: 'small', importMap,
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const changedPath = join(root, 'changed.txt');
    // Only the auth clique is changed
    writeFileSync(changedPath, ['src/auth/f0.ts', 'src/auth/f2.ts'].join('\n'));

    const result = runScript(root, [`--changed-files=${changedPath}`]);
    expect(result.status).toBe(0);

    const out = readBatches(root);
    // Auth files are in batches; other cliques' batches must be omitted
    const allPaths = out.batches.flatMap(b => b.files.map(f => f.path));
    expect(allPaths).toContain('src/auth/f0.ts');
    expect(allPaths).toContain('src/auth/f2.ts');
    expect(allPaths).not.toContain('src/api/f0.ts');
    expect(allPaths).not.toContain('src/db/f0.ts');

    // neighborMap may still reference unchanged files (with their full-graph batchIndex)
    const loginBatch = out.batches.find(b =>
      b.files.some(f => f.path === 'src/auth/f0.ts'));
    expect(loginBatch).toBeDefined();
  });
});

describe('compute-batches.mjs — CB-001: large community splitting (new threshold 60)', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('CB-001: splits a 70-node clique into batches ≤ 60', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-cb001-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });

    const files = [];
    const importMap = {};
    for (let i = 0; i < 70; i++) {
      const p = `src/big/f${i}.ts`;
      files.push({ path: p, language: 'typescript', sizeLines: 50, fileCategory: 'code' });
      importMap[p] = [];
      for (let j = 0; j < 70; j++) {
        if (j !== i) importMap[p].push(`src/big/f${j}.ts`);
      }
    }
    const scan = {
      name: 'cb001-test', description: '',
      languages: ['typescript'], frameworks: [],
      files, totalFiles: 70, filteredByIgnore: 0,
      estimatedComplexity: 'moderate', importMap,
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    expect(batches.algorithm).toBe('louvain');
    expect(batches.totalFiles).toBe(70);
    // 70 > MAX_COMMUNITY_SIZE=60 → split into 2 batches
    expect(batches.batches.length).toBe(2);
    // Each batch ≤ 60
    for (const b of batches.batches) {
      expect(b.files.length).toBeLessThanOrEqual(60);
    }
    // Sum equals total
    const sum = batches.batches.reduce((acc, b) => acc + b.files.length, 0);
    expect(sum).toBe(70);
    // Warning was emitted
    expect(result.stderr).toMatch(/Warning: compute-batches: community size 70 > max 60/);
  });
});

describe('compute-batches.mjs — CB-002: small batch merging (new threshold 5)', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('CB-002: merges 4-file batch into misc (below MIN_BATCH_SIZE=5)', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-cb002-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });

    // Two isolated 4-file cliques — each below MIN_BATCH_SIZE=5
    const files = [];
    const importMap = {};
    for (let g = 0; g < 2; g++) {
      for (let i = 0; i < 4; i++) {
        const p = `src/g${g}/f${i}.ts`;
        files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
        importMap[p] = [];
        for (let j = 0; j < 4; j++) {
          if (j !== i) importMap[p].push(`src/g${g}/f${j}.ts`);
        }
      }
    }
    const scan = {
      name: 'cb002-test', description: '',
      languages: ['typescript'], frameworks: [],
      files, totalFiles: 8, filteredByIgnore: 0,
      estimatedComplexity: 'small', importMap,
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    // Both 4-file cliques are below MIN_BATCH_SIZE=5, merged into 1 misc batch
    expect(batches.batches.length).toBe(1);
    expect(batches.batches[0].files.length).toBe(8);
    expect(result.stderr).toMatch(/Info: compute-batches: merged 2 small batches/);
  });
});

describe('compute-batches.mjs — CB-003: fallback batch size (new value 25)', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('CB-003: count-fallback uses batchSize=25', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-cb003-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });

    // 60 isolated files → count-fallback with batchSize=25 → 3 batches
    const files = [];
    const importMap = {};
    for (let i = 0; i < 60; i++) {
      const p = `src/leaf${String(i).padStart(3, '0')}.ts`;
      files.push({ path: p, language: 'typescript', sizeLines: 10, fileCategory: 'code' });
      importMap[p] = [];
    }
    const scan = {
      name: 'cb003-test', description: '',
      languages: ['typescript'], frameworks: [],
      files, totalFiles: 60, filteredByIgnore: 0,
      estimatedComplexity: 'moderate', importMap,
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = spawnSync('node',
      [SCRIPT, root],
      { encoding: 'utf-8', env: { ...process.env, UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW: '1' } },
    );
    expect(result.status).toBe(0);

    const out = readBatches(root);
    expect(out.algorithm).toBe('count-fallback');
    // 60 files / 25 per batch = ceil(60/25) = 3 batches
    const codeBatches = out.batches.filter(b =>
      b.files.every(f => f.fileCategory === 'code'));
    expect(codeBatches.length).toBe(3);
    const sizes = codeBatches.map(b => b.files.length).sort((a, b) => b - a);
    expect(sizes).toEqual([25, 25, 10]);
  });
});

describe('compute-batches.mjs — CB-004: non-code Group E batch size (new value 35)', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('CB-004: splits 40 config files under config/ into [35, 5]', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-cb004-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });

    const files = [];
    const importMap = {};
    for (let i = 0; i < 40; i++) {
      const p = `config/app${String(i).padStart(2, '0')}.json`;
      files.push({ path: p, language: 'json', sizeLines: 10, fileCategory: 'config' });
      importMap[p] = [];
    }
    const scan = {
      name: 'cb004-test', description: '',
      languages: ['json'], frameworks: [],
      files, totalFiles: 40, filteredByIgnore: 0,
      estimatedComplexity: 'small', importMap,
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    // 40 config files under config/ → Group E with MAX_E=35 → [35, 5]
    const configBatches = batches.batches.filter(b =>
      b.files.every(f => f.path.startsWith('config/')));
    expect(configBatches.length).toBe(2);
    const sizes = configBatches.map(b => b.files.length).sort((a, b) => b - a);
    expect(sizes).toEqual([35, 5]);
  });
});

describe('compute-batches.mjs — CB-005: reads exports-map.json when available', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('CB-005: loads exports from exports-map.json (no tree-sitter init needed)', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-cb005-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });

    writeFileSync(join(root, 'src', 'a.ts'),
      'export function greet(name: string) { return "hi " + name; }\n');

    const scan = {
      name: 'cb005-test',
      description: '',
      languages: ['typescript'],
      frameworks: [],
      files: [
        { path: 'src/a.ts', language: 'typescript', sizeLines: 1, fileCategory: 'code' },
      ],
      totalFiles: 1, filteredByIgnore: 0, estimatedComplexity: 'small',
      importMap: { 'src/a.ts': [] },
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    // Write pre-extracted exports-map.json
    const exportsMap = {
      scriptCompleted: true,
      stats: { filesScanned: 1, filesWithExports: 1, totalSymbols: 1 },
      exportsMap: { 'src/a.ts': ['greet'] },
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'exports-map.json'),
      JSON.stringify(exportsMap));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    expect(batches.exportsByPath['src/a.ts']).toEqual(['greet']);

    // Should have loaded from exports-map.json (Info message, not Warning fallback)
    expect(result.stderr).toMatch(/Info: compute-batches: loaded exports from exports-map.json/);
    // Should NOT have the fallback warning
    expect(result.stderr).not.toMatch(/Warning: compute-batches: exports-map.json not found/);
  });
});

describe('compute-batches.mjs — CB-006: falls back to tree-sitter when exports-map.json missing', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('CB-006: falls back to tree-sitter when exports-map.json is missing', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-cb006-'));
    mkdirSync(join(root, '.understand-anything-trae', 'intermediate'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });

    writeFileSync(join(root, 'src', 'a.ts'),
      'export function greet(name: string) { return "hi " + name; }\n');

    const scan = {
      name: 'cb006-test',
      description: '',
      languages: ['typescript'],
      frameworks: [],
      files: [
        { path: 'src/a.ts', language: 'typescript', sizeLines: 1, fileCategory: 'code' },
      ],
      totalFiles: 1, filteredByIgnore: 0, estimatedComplexity: 'small',
      importMap: { 'src/a.ts': [] },
    };
    writeFileSync(
      join(root, '.understand-anything-trae', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    // No exports-map.json written — should fall back to tree-sitter

    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    // Should still have exports (from tree-sitter fallback)
    expect(batches.exportsByPath['src/a.ts']).toEqual(
      expect.arrayContaining(['greet']));

    // Should have the fallback warning
    expect(result.stderr).toMatch(
      /Warning: compute-batches: exports-map.json not found/);
  });
});
