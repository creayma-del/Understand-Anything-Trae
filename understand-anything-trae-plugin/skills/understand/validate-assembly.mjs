#!/usr/bin/env node

/**
 * validate-assembly.mjs — Deterministic assembly validation script
 *
 * Replaces Phase 3's assemble-reviewer LLM subagent call.
 * Performs structural validation checks on assembled-graph.json,
 * auto-fixes complexity values, and outputs validation results.
 *
 * Usage: node validate-assembly.mjs <assembledGraphPath> <importMapPath> <outputPath>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [,, assembledGraphPath, importMapPath, outputPath] = process.argv;

if (!assembledGraphPath || !importMapPath || !outputPath) {
  process.stderr.write('Usage: validate-assembly.mjs <assembledGraphPath> <importMapPath> <outputPath>\n');
  process.exit(1);
}

try {
  // 1. Read inputs
  let graph;
  let importMapData;
  let importMap;

  try {
    graph = JSON.parse(readFileSync(resolve(assembledGraphPath), 'utf-8'));
  } catch (err) {
    process.stderr.write(`Warning: Could not read/parse assembled graph: ${err.message}\n`);
    graph = { nodes: [], edges: [] };
  }

  try {
    importMapData = JSON.parse(readFileSync(resolve(importMapPath), 'utf-8'));
    importMap = importMapData.importMap || importMapData;
  } catch (err) {
    process.stderr.write(`Warning: Could not read/parse import map: ${err.message}\n`);
    importMap = {};
  }

  // Ensure arrays exist
  if (!Array.isArray(graph.nodes)) graph.nodes = [];
  if (!Array.isArray(graph.edges)) graph.edges = [];

  // 2. Initialize
  const issues = [];
  const warnings = [];

  // ── Check a: Node ID uniqueness ──────────────────────────────────────
  const seen = new Map(); // id → firstIndex
  graph.nodes.forEach((node, i) => {
    if (!node.id) return; // missing ID handled by check b
    if (seen.has(node.id)) {
      issues.push(`Duplicate node ID '${node.id}' at indices ${seen.get(node.id)} and ${i}`);
    } else {
      seen.set(node.id, i);
    }
  });

  // ── Check b: Required field completeness ─────────────────────────────
  const REQUIRED_FIELDS = ['id', 'type', 'name', 'summary', 'tags'];

  graph.nodes.forEach((node, i) => {
    for (const field of REQUIRED_FIELDS) {
      if (node[field] === undefined || node[field] === null) {
        issues.push(`Node[${i}] '${node.id || '<no-id>'}' missing ${field}`);
      }
    }
  });

  // ── Check c: Edge reference integrity ────────────────────────────────
  const nodeIds = new Set(graph.nodes.map(n => n.id).filter(Boolean));

  graph.edges.forEach((edge, i) => {
    if (!nodeIds.has(edge.source)) {
      issues.push(`Edge[${i}] source '${edge.source}' not found in node set`);
    }
    if (!nodeIds.has(edge.target)) {
      issues.push(`Edge[${i}] target '${edge.target}' not found in node set`);
    }
  });

  // ── Check d: Imports edge coverage ───────────────────────────────────
  // Build filePath → nodeId mapping (only type="file" nodes)
  const filePathToNodeId = new Map();
  for (const node of graph.nodes) {
    if (node.type === 'file' && node.filePath) {
      filePathToNodeId.set(node.filePath, node.id);
    }
  }

  // Count mappable import pairs from importMap
  let totalMappable = 0;
  const mappablePairs = new Set(); // "sourceId→targetId"
  for (const [sourcePath, targetPaths] of Object.entries(importMap)) {
    const sourceId = filePathToNodeId.get(sourcePath);
    if (!sourceId) continue;
    for (const targetPath of targetPaths) {
      const targetId = filePathToNodeId.get(targetPath);
      if (!targetId) continue;
      totalMappable++;
      mappablePairs.add(`${sourceId}\u2192${targetId}`);
    }
  }

  // Count existing imports edges
  const existingImports = new Set();
  for (const edge of graph.edges) {
    if (edge.type === 'imports') {
      existingImports.add(`${edge.source}\u2192${edge.target}`);
    }
  }

  // Calculate coverage
  let covered = 0;
  for (const pair of mappablePairs) {
    if (existingImports.has(pair)) covered++;
  }

  const importsCoverage = totalMappable > 0 ? covered / totalMappable : 1;

  if (importsCoverage < 1) {
    warnings.push(
      `Imports edge coverage: ${(importsCoverage * 100).toFixed(1)}% ` +
      `(${covered}/${totalMappable} mappable import pairs have edges)`
    );
  }

  // ── Check e: Complexity normalization ────────────────────────────────
  // Must match merge-batch-graphs.py NORMALIZE_COMPLEXITY exactly
  const COMPLEXITY_MAP = {
    'low': 'simple',
    'easy': 'simple',
    'basic': 'simple',
    'medium': 'moderate',
    'intermediate': 'moderate',
    'high': 'complex',
    'hard': 'complex',
    'difficult': 'complex',
  };

  const VALID_COMPLEXITY = new Set(['simple', 'moderate', 'complex']);

  let fixedComplexity = 0;
  graph.nodes.forEach((node) => {
    if (!node.complexity) return;
    const lower = String(node.complexity).toLowerCase();
    if (VALID_COMPLEXITY.has(lower)) {
      node.complexity = lower; // ensure lowercase
      return;
    }
    if (COMPLEXITY_MAP[lower]) {
      node.complexity = COMPLEXITY_MAP[lower];
      fixedComplexity++;
    }
    // Unknown complexity values are not modified; reported by issues if needed
  });

  // ── Check f: Duplicate nodes/edges detection ─────────────────────────
  // Semantic duplicate nodes: same (type, name, filePath) triple
  const nodeSignature = (n) => `${n.type}::${n.name}::${n.filePath || ''}`;
  const nodeSigs = new Map(); // signature → [indices]
  graph.nodes.forEach((node, i) => {
    const sig = nodeSignature(node);
    if (!nodeSigs.has(sig)) nodeSigs.set(sig, []);
    nodeSigs.get(sig).push(i);
  });
  let duplicateNodes = 0;
  for (const [sig, indices] of nodeSigs) {
    if (indices.length > 1) {
      duplicateNodes += indices.length - 1;
      warnings.push(
        `Duplicate node signature '${sig}' at indices [${indices.join(', ')}]`
      );
    }
  }

  // Duplicate edges: same (source, target, type) triple
  const edgeSignature = (e) => `${e.source}\u2192${e.target}::${e.type}`;
  const edgeSigs = new Map();
  graph.edges.forEach((edge, i) => {
    const sig = edgeSignature(edge);
    if (!edgeSigs.has(sig)) edgeSigs.set(sig, []);
    edgeSigs.get(sig).push(i);
  });
  let duplicateEdges = 0;
  for (const [sig, indices] of edgeSigs) {
    if (indices.length > 1) {
      duplicateEdges += indices.length - 1;
      warnings.push(
        `Duplicate edge '${sig}' at indices [${indices.join(', ')}]`
      );
    }
  }

  // ── Check g: Orphan nodes ────────────────────────────────────────────
  const withEdges = new Set([
    ...graph.edges.map(e => e.source),
    ...graph.edges.map(e => e.target),
  ]);

  let orphanNodes = 0;
  graph.nodes.forEach((node) => {
    if (node.id && !withEdges.has(node.id)) {
      orphanNodes++;
      warnings.push(`Node '${node.id}' has no edges (orphan)`);
    }
  });

  // ── Auto-fix: Write back complexity-normalized graph ─────────────────
  if (fixedComplexity > 0) {
    writeFileSync(resolve(assembledGraphPath), JSON.stringify(graph, null, 2));
    process.stderr.write(`Fixed ${fixedComplexity} complexity value(s)\n`);
  }

  // ── Build result ─────────────────────────────────────────────────────
  const result = {
    valid: issues.length === 0,
    issues,
    warnings,
    stats: {
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      importsCoverage,
      orphanNodes,
      duplicateNodes,
      duplicateEdges,
      fixedComplexity,
    },
  };

  writeFileSync(resolve(outputPath), JSON.stringify(result, null, 2));

  // ── stderr summary ───────────────────────────────────────────────────
  process.stderr.write([
    'Validating assembled graph...',
    `  Nodes: ${result.stats.totalNodes}, Edges: ${result.stats.totalEdges}`,
    `  Imports coverage: ${(importsCoverage * 100).toFixed(1)}%`,
    `  Orphan nodes: ${orphanNodes}`,
    `  Duplicate nodes: ${duplicateNodes}, Duplicate edges: ${duplicateEdges}`,
    fixedComplexity > 0 ? `  Fixed ${fixedComplexity} complexity value(s)` : '',
    `Validation complete: ${issues.length} issue(s), ${warnings.length} warning(s)`,
  ].filter(Boolean).join('\n') + '\n');

} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
