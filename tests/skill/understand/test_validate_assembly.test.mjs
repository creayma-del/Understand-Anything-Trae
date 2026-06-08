import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "../../../understand-anything-trae-plugin/skills/understand/validate-assembly.mjs");

let tmpDir;

function makeGraph(nodes = [], edges = []) {
  return { nodes, edges };
}

function makeNode(overrides = {}) {
  return {
    id: "file:src/index.ts",
    type: "file",
    name: "index.ts",
    summary: "Main entry point",
    tags: ["entry"],
    filePath: "src/index.ts",
    complexity: "moderate",
    ...overrides,
  };
}

function makeEdge(overrides = {}) {
  return {
    source: "file:src/index.ts",
    target: "file:src/utils.ts",
    type: "imports",
    direction: "forward",
    weight: 0.7,
    ...overrides,
  };
}

function makeImportMap(map = {}) {
  return { importMap: map };
}

function runValidate(graphPath, importMapPath, outputPath) {
  const result = spawnSync("node", [SCRIPT, graphPath, importMapPath, outputPath], {
    encoding: "utf-8",
  });
  let output = null;
  try {
    output = JSON.parse(readFileSync(outputPath, "utf-8"));
  } catch {
    /* output missing on failure */
  }
  return { status: result.status, stderr: result.stderr, output };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "va-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("validate-assembly — valid graph", () => {
  it("VA-001: valid graph passes all checks", () => {
    const graph = makeGraph(
      [
        makeNode(),
        makeNode({
          id: "file:src/utils.ts",
          name: "utils.ts",
          summary: "Utilities",
          tags: ["utility"],
          filePath: "src/utils.ts",
          complexity: "simple",
        }),
      ],
      [makeEdge()]
    );
    const importMap = makeImportMap({ "src/index.ts": ["src/utils.ts"] });

    const graphPath = join(tmpDir, "assembled-graph.json");
    const importMapPath = join(tmpDir, "import-map.json");
    const outputPath = join(tmpDir, "assemble-review.json");

    writeFileSync(graphPath, JSON.stringify(graph));
    writeFileSync(importMapPath, JSON.stringify(importMap));

    const { status, output } = runValidate(graphPath, importMapPath, outputPath);

    expect(status).toBe(0);
    expect(output.valid).toBe(true);
    expect(output.issues).toEqual([]);
    expect(output.stats.importsCoverage).toBe(1);
    expect(output.stats.orphanNodes).toBe(0);
    expect(output.stats.fixedComplexity).toBe(0);
  });
});

describe("validate-assembly — duplicate node ID", () => {
  it("VA-002: reports duplicate node IDs", () => {
    const graph = makeGraph(
      [
        makeNode(),
        makeNode({ summary: "Entry duplicate" }),
      ],
      []
    );
    const importMap = makeImportMap({});

    const graphPath = join(tmpDir, "assembled-graph.json");
    const importMapPath = join(tmpDir, "import-map.json");
    const outputPath = join(tmpDir, "assemble-review.json");

    writeFileSync(graphPath, JSON.stringify(graph));
    writeFileSync(importMapPath, JSON.stringify(importMap));

    const { status, output } = runValidate(graphPath, importMapPath, outputPath);

    expect(status).toBe(0);
    expect(output.valid).toBe(false);
    expect(output.issues.some(i => i.includes("Duplicate node ID"))).toBe(true);
    expect(output.stats.duplicateNodes).toBeGreaterThanOrEqual(1);
  });
});

describe("validate-assembly — dangling edge reference", () => {
  it("VA-003: reports edges with missing source/target", () => {
    const graph = makeGraph(
      [
        makeNode({
          id: "file:src/utils.ts",
          name: "utils.ts",
          summary: "Utils",
          tags: ["utility"],
          filePath: "src/utils.ts",
        }),
      ],
      [
        makeEdge({ source: "file:src/missing.ts" }),
      ]
    );
    const importMap = makeImportMap({});

    const graphPath = join(tmpDir, "assembled-graph.json");
    const importMapPath = join(tmpDir, "import-map.json");
    const outputPath = join(tmpDir, "assemble-review.json");

    writeFileSync(graphPath, JSON.stringify(graph));
    writeFileSync(importMapPath, JSON.stringify(importMap));

    const { status, output } = runValidate(graphPath, importMapPath, outputPath);

    expect(status).toBe(0);
    expect(output.valid).toBe(false);
    expect(output.issues.some(i => i.includes("not found"))).toBe(true);
  });
});

describe("validate-assembly — imports coverage", () => {
  it("VA-004: calculates imports coverage correctly", () => {
    const graph = makeGraph(
      [
        makeNode({ id: "file:src/a.ts", name: "a.ts", filePath: "src/a.ts", summary: "A", tags: ["a"] }),
        makeNode({ id: "file:src/b.ts", name: "b.ts", filePath: "src/b.ts", summary: "B", tags: ["b"] }),
        makeNode({ id: "file:src/c.ts", name: "c.ts", filePath: "src/c.ts", summary: "C", tags: ["c"] }),
        makeNode({ id: "file:src/d.ts", name: "d.ts", filePath: "src/d.ts", summary: "D", tags: ["d"] }),
      ],
      [
        makeEdge({ source: "file:src/a.ts", target: "file:src/b.ts" }),
      ]
    );
    const importMap = makeImportMap({
      "src/a.ts": ["src/b.ts"],
      "src/c.ts": ["src/d.ts"],
    });

    const graphPath = join(tmpDir, "assembled-graph.json");
    const importMapPath = join(tmpDir, "import-map.json");
    const outputPath = join(tmpDir, "assemble-review.json");

    writeFileSync(graphPath, JSON.stringify(graph));
    writeFileSync(importMapPath, JSON.stringify(importMap));

    const { status, output } = runValidate(graphPath, importMapPath, outputPath);

    expect(status).toBe(0);
    expect(output.stats.importsCoverage).toBeCloseTo(0.5, 1);
    expect(output.warnings.some(w => w.includes("Imports edge coverage"))).toBe(true);
  });
});

describe("validate-assembly — complexity normalization", () => {
  it("VA-005: normalizes non-standard complexity values", () => {
    const graph = makeGraph(
      [
        makeNode({ id: "file:src/index.ts", name: "index.ts", filePath: "src/index.ts", complexity: "low" }),
        makeNode({ id: "file:src/app.ts", name: "app.ts", filePath: "src/app.ts", summary: "App", tags: ["app"], complexity: "high" }),
        makeNode({ id: "file:src/utils.ts", name: "utils.ts", filePath: "src/utils.ts", summary: "Utils", tags: ["utility"], complexity: "moderate" }),
      ],
      []
    );
    const importMap = makeImportMap({});

    const graphPath = join(tmpDir, "assembled-graph.json");
    const importMapPath = join(tmpDir, "import-map.json");
    const outputPath = join(tmpDir, "assemble-review.json");

    writeFileSync(graphPath, JSON.stringify(graph));
    writeFileSync(importMapPath, JSON.stringify(importMap));

    const { status, output } = runValidate(graphPath, importMapPath, outputPath);

    expect(status).toBe(0);
    expect(output.stats.fixedComplexity).toBe(2);

    const fixedGraph = JSON.parse(readFileSync(graphPath, "utf-8"));
    const indexNode = fixedGraph.nodes.find(n => n.id === "file:src/index.ts");
    const appNode = fixedGraph.nodes.find(n => n.id === "file:src/app.ts");
    const utilsNode = fixedGraph.nodes.find(n => n.id === "file:src/utils.ts");

    expect(indexNode.complexity).toBe("simple");
    expect(appNode.complexity).toBe("complex");
    expect(utilsNode.complexity).toBe("moderate");
  });
});

describe("validate-assembly — orphan nodes", () => {
  it("VA-006: reports nodes with no edges as warnings", () => {
    const graph = makeGraph(
      [
        makeNode({ id: "file:src/index.ts", name: "index.ts", filePath: "src/index.ts", summary: "Entry", tags: ["entry"] }),
        makeNode({ id: "file:src/orphan.ts", name: "orphan.ts", filePath: "src/orphan.ts", summary: "Orphan", tags: ["orphan"] }),
      ],
      []
    );
    const importMap = makeImportMap({});

    const graphPath = join(tmpDir, "assembled-graph.json");
    const importMapPath = join(tmpDir, "import-map.json");
    const outputPath = join(tmpDir, "assemble-review.json");

    writeFileSync(graphPath, JSON.stringify(graph));
    writeFileSync(importMapPath, JSON.stringify(importMap));

    const { status, output } = runValidate(graphPath, importMapPath, outputPath);

    expect(status).toBe(0);
    expect(output.stats.orphanNodes).toBe(2);
    expect(output.warnings.some(w => w.includes("has no edges (orphan)"))).toBe(true);
    expect(output.valid).toBe(true);
  });
});

describe("validate-assembly — missing required field", () => {
  it("VA-007: reports nodes with missing required fields", () => {
    const graph = makeGraph(
      [
        { id: "file:src/index.ts", type: "file", name: "index.ts", tags: ["entry"] },
      ],
      []
    );
    const importMap = makeImportMap({});

    const graphPath = join(tmpDir, "assembled-graph.json");
    const importMapPath = join(tmpDir, "import-map.json");
    const outputPath = join(tmpDir, "assemble-review.json");

    writeFileSync(graphPath, JSON.stringify(graph));
    writeFileSync(importMapPath, JSON.stringify(importMap));

    const { status, output } = runValidate(graphPath, importMapPath, outputPath);

    expect(status).toBe(0);
    expect(output.valid).toBe(false);
    expect(output.issues.some(i => i.includes("missing summary"))).toBe(true);
  });
});
