#!/usr/bin/env node
/**
 * extract-metadata.mjs
 *
 * Deterministic metadata extraction for the understand skill's Phase 1.
 * Replaces the LLM-based Step A of project-scanner.md — reads package.json,
 * README, and scan-result.json to produce name, description, frameworks, and
 * languages without any LLM inference.
 *
 * Usage:
 *   node extract-metadata.mjs <projectRoot> <outputPath>
 *
 * Output JSON shape:
 *   {
 *     "name": "package-name" | "<directory-name>",
 *     "description": "synthesized or raw description",
 *     "rawDescription": "package description" | "",
 *     "readmeHead": "first 10 lines" | "",
 *     "frameworks": ["React", "Vite", ...],
 *     "languages": ["typescript", "css", "markdown", ...]
 *   }
 *
 * Logging: stderr only (stdout reserved for piped tooling).
 * Graceful degradation: missing files produce empty defaults, never a crash.
 * Exit code: 0 on all paths except missing CLI arguments (exit 1).
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join, basename } from 'node:path';

// ---------------------------------------------------------------------------
// Known frameworks map
//
// Keys are package.json dependency names; values are the friendly names
// emitted in the `frameworks` array. Order matters — frameworks are emitted
// in definition order for deterministic output.
// ---------------------------------------------------------------------------
const KNOWN_FRAMEWORKS = {
  'react': 'React',
  'vue': 'Vue',
  'svelte': 'Svelte',
  '@angular/core': 'Angular',
  'express': 'Express',
  'fastify': 'Fastify',
  'koa': 'Koa',
  'next': 'Next.js',
  'nuxt': 'Nuxt',
  'vite': 'Vite',
  'vitest': 'Vitest',
  'jest': 'Jest',
  'mocha': 'Mocha',
  'tailwindcss': 'Tailwind CSS',
  'prisma': 'Prisma',
  'typeorm': 'TypeORM',
  'sequelize': 'Sequelize',
  'mongoose': 'Mongoose',
  'redux': 'Redux',
  'zustand': 'Zustand',
  'mobx': 'MobX',
};

// ---------------------------------------------------------------------------
// README extraction
// ---------------------------------------------------------------------------

/**
 * Read the first 10 lines of the first matching README file found at the
 * project root. Tries README.md, README.rst, README, readme.md in order.
 * Returns the joined lines (with newlines), or '' if no README exists.
 */
function extractReadmeHead(projectRoot) {
  const readmeNames = ['README.md', 'README.rst', 'README', 'readme.md'];
  for (const name of readmeNames) {
    const filePath = join(projectRoot, name);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').slice(0, 10);
        return lines.join('\n');
      } catch {
        process.stderr.write(
          `Warning: extract-metadata: ${name} exists but cannot be read — skipping\n`,
        );
        return '';
      }
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Description synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesize a description from rawDescription and readmeHead.
 *
 * 1. If rawDescription (from package.json) is non-empty, use it directly.
 * 2. Else if readmeHead is non-empty:
 *    - Skip lines starting with `#` (markdown headings)
 *    - Skip empty lines
 *    - Collect the first non-empty, non-heading paragraph
 *    - Truncate at 200 characters at a word boundary; append "..." if truncated
 * 3. Else return "No description available"
 */
function synthesizeDescription(rawDescription, readmeHead) {
  if (rawDescription) return rawDescription;

  if (readmeHead) {
    const lines = readmeHead.split('\n');
    const paragraphLines = [];
    let inParagraph = false;
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip heading lines (starting with #)
      if (/^#{1,6}\s/.test(trimmed)) continue;
      // Skip empty lines
      if (trimmed === '') {
        if (inParagraph) break; // Paragraph ended
        continue;
      }
      // First non-empty non-heading line starts the paragraph
      inParagraph = true;
      paragraphLines.push(trimmed);
    }
    const paragraph = paragraphLines.join(' ');
    if (paragraph) {
      if (paragraph.length <= 200) return paragraph;
      // Truncate at word boundary
      const truncated = paragraph.slice(0, 200);
      const lastSpace = truncated.lastIndexOf(' ');
      return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '...';
    }
  }

  return 'No description available';
}

// ---------------------------------------------------------------------------
// Infrastructure detection
// ---------------------------------------------------------------------------

/**
 * Detect Docker presence: Dockerfile or Dockerfile.* at project root.
 */
function detectDockerfile(projectRoot) {
  try {
    const entries = readdirSync(projectRoot);
    for (const entry of entries) {
      if (entry === 'Dockerfile' || entry.startsWith('Dockerfile.')) {
        return true;
      }
    }
  } catch (err) {
    process.stderr.write(
      `Warning: extract-metadata: Dockerfile detection failed — ${err.message}\n`,
    );
  }
  return false;
}

/**
 * Detect GitHub Actions: .github/workflows/*.yml or *.yaml files.
 */
function detectGitHubActions(projectRoot) {
  const workflowsDir = join(projectRoot, '.github', 'workflows');
  try {
    if (!existsSync(workflowsDir)) return false;
    const entries = readdirSync(workflowsDir);
    return entries.some(e => e.endsWith('.yml') || e.endsWith('.yaml'));
  } catch (err) {
    process.stderr.write(
      `Warning: extract-metadata: GitHub Actions detection failed — ${err.message}\n`,
    );
  }
  return false;
}

/**
 * Detect GitLab CI: .gitlab-ci.yml at project root.
 */
function detectGitLabCI(projectRoot) {
  return existsSync(join(projectRoot, '.gitlab-ci.yml'));
}

// ---------------------------------------------------------------------------
// Languages extraction
// ---------------------------------------------------------------------------

/**
 * Read scan-result.json and extract the keys of stats.byLanguage,
 * sorted alphabetically. Returns [] if the file is missing or malformed.
 */
function extractLanguages(scanResultPath) {
  try {
    const scanResult = JSON.parse(readFileSync(scanResultPath, 'utf-8'));
    const byLanguage = scanResult?.stats?.byLanguage;
    if (byLanguage && typeof byLanguage === 'object') {
      return Object.keys(byLanguage).sort();
    }
  } catch {
    process.stderr.write(
      'Warning: extract-metadata: cannot read scan-result.json for languages — returning empty array\n',
    );
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const [, , projectRoot, outputPath] = process.argv;
  if (!projectRoot || !outputPath) {
    process.stderr.write(
      'Usage: extract-metadata.mjs <projectRoot> <outputPath>\n',
    );
    process.exit(1);
  }

  // 1. Read package.json
  let name = null;
  let rawDescription = '';
  const depKeys = [];
  const pkgPath = join(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      name = pkg.name || null;
      rawDescription = pkg.description || '';
      if (pkg.dependencies) depKeys.push(...Object.keys(pkg.dependencies));
      if (pkg.devDependencies) depKeys.push(...Object.keys(pkg.devDependencies));
    } catch {
      process.stderr.write(
        'Warning: extract-metadata: package.json exists but is not valid JSON — skipping\n',
      );
    }
  }

  // 2. Name fallback to directory name
  if (!name) {
    name = basename(projectRoot);
  }

  // 3. README head
  const readmeHead = extractReadmeHead(projectRoot);

  // 4. Framework matching — iterate KNOWN_FRAMEWORKS in definition order
  //    for deterministic output
  const frameworks = [];
  for (const [depKey, friendlyName] of Object.entries(KNOWN_FRAMEWORKS)) {
    if (depKeys.includes(depKey)) {
      frameworks.push(friendlyName);
    }
  }

  // 5. Infrastructure detection — appended in fixed order
  if (detectDockerfile(projectRoot)) frameworks.push('Docker');
  if (detectGitHubActions(projectRoot)) frameworks.push('GitHub Actions');
  if (detectGitLabCI(projectRoot)) frameworks.push('GitLab CI');

  // 6. Languages from scan-result.json
  const scanResultPath = join(
    projectRoot,
    '.understand-anything-trae',
    'intermediate',
    'scan-result.json',
  );
  const languages = extractLanguages(scanResultPath);

  // 7. Synthesize description and assemble output
  const description = synthesizeDescription(rawDescription, readmeHead);
  const result = { name, description, rawDescription, readmeHead, frameworks, languages };

  writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf-8');

  process.stderr.write(
    `extract-metadata: name=${name} frameworks=${frameworks.length} languages=${languages.length}\n`,
  );
}

main();
