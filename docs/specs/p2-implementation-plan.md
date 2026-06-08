# P2: 可落地执行计划方案

> 版本: 1.1
> 日期: 2026-06-08
> 状态: 已评审（含评审修订）
> 前置: P1（前端生态深化）已完成
> 关联设计文档: [p2-performance-optimization.md](./p2-performance-optimization.md)
> 变更: 评审修订：合并阶段 3+4、修正 buildResult 签名、补充 description 合成逻辑、细化回滚方案

## 1. 前置验证

| 验证项 | 验证方法 | 预期结果 | 状态 |
|--------|---------|---------|------|
| tree-sitter 单次初始化可覆盖全量文件分析 | 阅读 `analyze-project.mjs` 设计 | TreeSitterPlugin.init() 一次后可 analyzeFile() 任意次 | 待验证 |
| 60 文件批次元数据 token 量 | 取 60 文件项目的 scan-result.json，估算 token 数 | < 30k token（128k 窗口的 25%） | 待验证 |
| extract-metadata.mjs 框架列表与 project-scanner.md 一致 | 对比 KNOWN_FRAMEWORKS 与 Step A 列表 | 完全覆盖 | 待验证 |
| compute-batches.mjs 可从外部文件读取 exports | 阅读 extractExports() 函数 | 可替换为 JSON 读取 | 待验证 |
| merge-batch-graphs.py importMap 可用性 | 检查 scan-result.json 是否包含 importMap | importMap 在 Phase 1 产出 | 待验证 |

---

## 2. 实施阶段划分

### 依赖关系图

```
阶段 1 (优化 C + G) ─────────────────────────────────────────┐
  │ 无依赖，改动最小                                            │
  ▼                                                            │
阶段 2 (优化 F) ──────────────────────────────────────────────┤
  │ 依赖阶段 1 的批次参数                                       │
  ▼                                                            │
阶段 3 (优化 A) ──────────────────────────────────────────────┤
  │ 依赖阶段 2 完成（file-analyzer 变更需同步）                  │
  ▼                                                            │
阶段 4 (优化 B) ──────────────────────────────────────────────┤
  │ 依赖阶段 3 的 extract-all-structure.mjs                     │
  ▼                                                            │
阶段 5 (优化 D + E) ──────────────────────────────────────────┘
  │ 依赖阶段 4 的 analyze-project.mjs
  ▼
验收
```

---

### 阶段 1: 优化 C（批次参数调优）+ 优化 G（并发上限）

**原因**: 改动最小（仅常量修改），风险最低，效果最直接。

#### 优化 C: 批次参数调优

| 步骤 | 任务 | 产出文件 | 验证方式 |
|------|------|---------|---------|
| 1.1 | 修改 `MAX_COMMUNITY_SIZE` 35→60 | `compute-batches.mjs` | CB-001 通过 |
| 1.2 | 修改 `MIN_BATCH_SIZE` 3→5 | `compute-batches.mjs` | CB-002 通过 |
| 1.3 | 修改 `MAX_MERGE_TARGET` 25→40 | `compute-batches.mjs` | CB-002 通过 |
| 1.4 | 修改 `count-fallback batchSize` 12→25 | `compute-batches.mjs` | CB-003 通过 |
| 1.5 | 修改非 code `MAX_E` 20→35 | `compute-batches.mjs` | CB-004 通过 |
| 1.6 | 更新 compute-batches 测试 | `test_compute_batches.test.mjs` | CB-001~004 通过 |
| 1.7 | 运行全量测试 | — | `pnpm test` 全部通过 |

#### 优化 G: 并发上限

| 步骤 | 任务 | 产出文件 | 验证方式 |
|------|------|---------|---------|
| 1.8 | 修改并发上限 5→8 | `SKILL.md` | 文本搜索确认 |
| 1.9 | 更新 Phase 2 进度报告模板 | `SKILL.md` | 文本搜索确认 |

---

### 阶段 2: 优化 F（imports 边确定性生成）

**原因**: 依赖阶段 1 的批次参数（批次大小影响 imports 边数量），但不依赖新脚本。

| 步骤 | 任务 | 产出文件 | 验证方式 |
|------|------|---------|---------|
| 2.1 | 在 merge-batch-graphs.py 中新增 `generate_imports_from_scan()` | `merge-batch-graphs.py` | MBG-001~004 通过 |
| 2.2 | 修改合并主流程：调用 `generate_imports_from_scan()` 替代 `recover_imports_from_scan()` | `merge-batch-graphs.py` | 现有测试通过 |
| 2.3 | 修改 file-analyzer.md：移除 imports 边创建指令 | `file-analyzer.md` | 文本确认无 "Import edge creation rule" |
| 2.4 | 修改 SKILL.md Phase 2：dispatch prompt 中保留 batchImportData 但不再要求生成 imports 边 | `SKILL.md` | 文本确认 |
| 2.5 | 新增 MBG-001~004 测试 | `test_merge_batch_graphs.py` | 全部通过 |
| 2.6 | 运行全量测试 | — | `pnpm test` + `python -m unittest` 全部通过 |

**关键实现细节**：

`generate_imports_from_scan()` 逻辑：
1. 从 `scan-result.json` 读取 `importMap`
2. 遍历 importMap，为每对 (source, targets) 生成 imports 边
3. source/target 映射到节点 ID：`file:<path>`
4. 跳过映射失败的路径（文件可能被 ignore 过滤）
5. 与已有 imports 边去重（保留 LLM 可能生成的额外语义 imports 边）
6. 统计覆盖率并输出到 stderr

---

### 阶段 3: 优化 A（结构提取提升到主流程）

**原因**: 依赖阶段 2 完成（file-analyzer.md 已修改 imports 边指令），需要同步修改 file-analyzer.md。

| 步骤 | 任务 | 产出文件 | 验证方式 |
|------|------|---------|---------|
| 3.1 | 创建 `extract-all-structure.mjs` | `extract-all-structure.mjs` | 脚本可执行 |
| 3.2 | 实现主流程：读取 scan-result.json → 初始化 tree-sitter → 遍历所有文件 → 输出 structure-results.json | `extract-all-structure.mjs` | EAS-001~007 通过 |
| 3.3 | 修改 SKILL.md：新增 Phase 1.7 | `SKILL.md` | Phase 1.7 定义完整 |
| 3.4 | 修改 SKILL.md Phase 2：dispatch prompt 注入本批次的结构预提取结果 | `SKILL.md` | dispatch template 包含 structure data |
| 3.5 | 修改 file-analyzer.md：Phase 1 从"运行脚本"改为"读取预提取结果" | `file-analyzer.md` | Phase 1 不再运行 extract-structure.mjs |
| 3.6 | 编写 EAS-001~007 测试 | `test_extract_all_structure.test.mjs` | 全部通过 |
| 3.7 | 运行全量测试 | — | `pnpm test` 全部通过 |

**关键实现细节**：

`extract-all-structure.mjs` 基于 `extract-structure.mjs` 改造：
- 输入从 `(input.json, output.json)` 改为 `(projectRoot, outputDir)`
- 内部读取 `scan-result.json` 获取文件列表
- 输出 `structure-results.json` 到 `<outputDir>/structure-results.json`
- 复用 `extract-structure.mjs` 的 `buildResult()` 函数

SKILL.md Phase 1.7 定义：
```
## Phase 1.7 — STRUCTURE PRE-EXTRACT

Report: `[Phase 1.7/7] Pre-extracting file structures...`

Run the bundled structure pre-extraction script:
```bash
node <SKILL_DIR>/extract-all-structure.mjs $PROJECT_ROOT $PROJECT_ROOT/.understand-anything-trae/intermediate
```

Reads `.understand-anything-trae/intermediate/scan-result.json`, writes `.understand-anything-trae/intermediate/structure-results.json`.

Capture stderr. Append any line starting with `Warning:` to `$PHASE_WARNINGS`.
```

SKILL.md Phase 2 dispatch prompt 变更：
```
> Pre-extracted structure data for this batch (use directly — do NOT re-run extract-structure.mjs):
> ```json
> <structure data for batch files from structure-results.json>
> ```
```

file-analyzer.md Phase 1 变更：
- 移除 Step 1（准备 input JSON）和 Step 2（执行 extract-structure.mjs）
- Step 3 改为"读取 dispatch prompt 中的预提取结构数据"
- 保留 Step 3 的数据格式说明（与原 extract-structure.mjs 输出格式一致）

---

### 阶段 4: 优化 B（合并确定性脚本）

**原因**: 依赖阶段 3 的 `extract-all-structure.mjs`，将其与 `extract-import-map.mjs` 和 `compute-batches.mjs` 的导出符号提取合并。

| 步骤 | 任务 | 产出文件 | 验证方式 |
|------|------|---------|---------|
| 4.1 | 创建 `analyze-project.mjs` | `analyze-project.mjs` | 脚本可执行 |
| 4.2 | 实现统一管线：一次 tree-sitter 初始化 → importMap + exportsMap + structure | `analyze-project.mjs` | AP-001~006 通过 |
| 4.3 | 修改 compute-batches.mjs：`extractExports()` 优先读取 exports-map.json | `compute-batches.mjs` | CB-005~006 通过 |
| 4.4 | 修改 SKILL.md Phase 1：替换 extract-import-map.mjs 为 analyze-project.mjs | `SKILL.md` | Phase 1 流程更新 |
| 4.5 | 修改 SKILL.md Phase 1.7：替换 extract-all-structure.mjs 为 analyze-project.mjs 的 structure 输出 | `SKILL.md` | Phase 1.7 流程更新 |
| 4.6 | 编写 AP-001~006 测试 | `test_analyze_project.test.mjs` | 全部通过 |
| 4.7 | 更新 CB-005~006 测试 | `test_compute_batches.test.mjs` | 全部通过 |
| 4.8 | 运行全量测试 | — | `pnpm test` 全部通过 |

**关键实现细节**：

`analyze-project.mjs` 内部结构：
```javascript
async function main() {
  const [,, projectRoot, outputDir] = process.argv;

  // 1. 读取 scan-result.json
  const scanResult = JSON.parse(readFileSync(join(outputDir, 'scan-result.json'), 'utf-8'));

  // 2. 初始化 tree-sitter（一次）
  const tsPlugin = new TreeSitterPlugin(tsConfigs);
  await tsPlugin.init();
  const registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry, tsPlugin, cssPlugin);

  // 3. 遍历所有文件
  const importMap = {};
  const exportsMap = {};
  const structureResults = [];

  for (const file of scanResult.files) {
    const content = readFileSync(join(projectRoot, file.path), 'utf-8');

    // 3a. 结构分析
    const analysis = registry.analyzeFile(file.path, content);
    const callGraph = registry.extractCallGraph(file.path, content);
    structureResults.push(buildResult(file, analysis, callGraph));

    // 3b. 导入路径提取
    const imports = extractImports(registry, file, content, projectRoot, scanResult);
    importMap[file.path] = imports;

    // 3c. 导出符号提取
    const exports = extractExportSymbols(analysis);
    exportsMap[file.path] = exports;
  }

  // 4. 写入三个输出文件
  writeFileSync(join(outputDir, 'import-map.json'), JSON.stringify({ importMap }, null, 2));
  writeFileSync(join(outputDir, 'structure-results.json'), JSON.stringify({ scriptCompleted: true, results: structureResults }, null, 2));
  writeFileSync(join(outputDir, 'exports-map.json'), JSON.stringify({ exportsMap }, null, 2));
}
```

`compute-batches.mjs` 的 `extractExports()` 变更：
```javascript
async function extractExports(projectRoot, codeFiles) {
  // 优先读取 exports-map.json
  const exportsMapPath = join(projectRoot, '.understand-anything-trae', 'intermediate', 'exports-map.json');
  if (existsSync(exportsMapPath)) {
    const data = JSON.parse(readFileSync(exportsMapPath, 'utf-8'));
    return new Map(Object.entries(data.exportsMap));
  }

  // 回退到 tree-sitter 初始化（增量更新场景）
  process.stderr.write('Warning: compute-batches: exports-map.json not found — falling back to tree-sitter initialization\n');
  // ... 原有逻辑
}
```

---

### 阶段 5: 优化 D（Phase 1 LLM→确定性）+ 优化 E（Phase 3 LLM→确定性）

**原因**: 依赖阶段 4 的 `analyze-project.mjs`（Phase 1 流程重构需要），两个优化可并行实施。

#### 优化 D: extract-metadata.mjs

| 步骤 | 任务 | 产出文件 | 验证方式 |
|------|------|---------|---------|
| 5.1 | 创建 `extract-metadata.mjs` | `extract-metadata.mjs` | 脚本可执行 |
| 5.2 | 实现 package.json / pyproject.toml / README.md 解析 | `extract-metadata.mjs` | EM-001~008 通过 |
| 5.3 | 实现框架匹配（KNOWN_FRAMEWORKS） | `extract-metadata.mjs` | EM-004~005 通过 |
| 5.4 | 实现基础设施工具检测 | `extract-metadata.mjs` | EM-005 通过 |
| 5.5 | 修改 SKILL.md Phase 1：不再派遣 project-scanner 子代理 | `SKILL.md` | Phase 1 流程更新 |
| 5.6 | 修改 project-scanner.md：Step A 改为运行 extract-metadata.mjs | `project-scanner.md` | Step A 描述更新 |
| 5.7 | 编写 EM-001~008 测试 | `test_extract_metadata.test.mjs` | 全部通过 |
| 5.8 | 运行全量测试 | — | `pnpm test` 全部通过 |

#### 优化 E: validate-assembly.mjs

| 步骤 | 任务 | 产出文件 | 验证方式 |
|------|------|---------|---------|
| 5.9 | 创建 `validate-assembly.mjs` | `validate-assembly.mjs` | 脚本可执行 |
| 5.10 | 实现节点 ID 唯一性检查 | `validate-assembly.mjs` | VA-002 通过 |
| 5.11 | 实现边引用完整性检查 | `validate-assembly.mjs` | VA-003 通过 |
| 5.12 | 实现 imports 覆盖率统计 | `validate-assembly.mjs` | VA-004 通过 |
| 5.13 | 实现复杂度规范化 | `validate-assembly.mjs` | VA-005 通过 |
| 5.14 | 实现孤立节点检测 | `validate-assembly.mjs` | VA-006 通过 |
| 5.15 | 修改 SKILL.md Phase 3：替换 assemble-reviewer 子代理为脚本调用 | `SKILL.md` | Phase 3 流程更新 |
| 5.16 | 编写 VA-001~007 测试 | `test_validate_assembly.test.mjs` | 全部通过 |
| 5.17 | 运行全量测试 | — | `pnpm test` 全部通过 |

**关键实现细节**：

SKILL.md Phase 1 重构后流程：
```
## Phase 1 — SCAN

Report: `[Phase 1/7] Scanning project...`

1. Run scan script:
   node <SKILL_DIR>/scan-project.mjs $PROJECT_ROOT $PROJECT_ROOT/.understand-anything-trae/intermediate/scan-raw.json

2. Run unified analysis script:
   node <SKILL_DIR>/analyze-project.mjs $PROJECT_ROOT $PROJECT_ROOT/.understand-anything-trae/intermediate

3. Run metadata extraction script:
   node <SKILL_DIR>/extract-metadata.mjs $PROJECT_ROOT $PROJECT_ROOT/.understand-anything-trae/intermediate/metadata.json

4. Merge scan-raw.json + import-map.json + metadata.json → scan-result.json
   (Inline Node.js script to merge the three outputs)

No LLM dispatch needed in Phase 1.
```

SKILL.md Phase 3 重构后流程：
```
## Phase 3 — ASSEMBLE VALIDATION

Report: `[Phase 3/7] Validating assembled graph...`

Run the bundled validation script:
```bash
node <SKILL_DIR>/validate-assembly.mjs $PROJECT_ROOT \
  $PROJECT_ROOT/.understand-anything-trae/intermediate/assembled-graph.json \
  $PROJECT_ROOT/.understand-anything-trae/intermediate/import-map.json \
  $PROJECT_ROOT/.understand-anything-trae/intermediate/assemble-review.json
```

Read the validation output. Add any issues/warnings to `$PHASE_WARNINGS`.

No LLM dispatch needed in Phase 3.
```

---

## 3. 验收阶段

| 步骤 | 任务 | 验证方式 |
|------|------|---------|
| V.1 | 运行全量 Vitest 测试 | `pnpm test` 全部通过 |
| V.2 | 运行 core 包测试 | `pnpm --filter @understand-anything-trae/core test` 全部通过 |
| V.3 | 运行 Python 测试 | `python -m unittest tests.skill.understand.test_merge_batch_graphs -v` 全部通过 |
| V.4 | ESLint 检查 | `pnpm lint` 零错误 |
| V.5 | 端到端验证 | 对本项目运行 `/understand --full`，对比 knowledge-graph.json |
| V.6 | 性能基准 | 记录全量分析耗时，确认 < 15 分钟 |

---

## 4. 文件变更总览

### 新增文件（8 个）

| 文件路径 | 类型 | 阶段 |
|---------|------|------|
| `skills/understand/extract-all-structure.mjs` | 确定性脚本 | 3 |
| `skills/understand/analyze-project.mjs` | 确定性脚本 | 4 |
| `skills/understand/extract-metadata.mjs` | 确定性脚本 | 5 |
| `skills/understand/validate-assembly.mjs` | 确定性脚本 | 5 |
| `tests/skill/understand/test_extract_all_structure.test.mjs` | 测试 | 3 |
| `tests/skill/understand/test_analyze_project.test.mjs` | 测试 | 4 |
| `tests/skill/understand/test_extract_metadata.test.mjs` | 测试 | 5 |
| `tests/skill/understand/test_validate_assembly.test.mjs` | 测试 | 5 |

### 修改文件（7 个）

| 文件路径 | 变更摘要 | 阶段 |
|---------|---------|------|
| `skills/understand/compute-batches.mjs` | 参数调优 + exports-map.json 读取 | 1, 4 |
| `skills/understand/merge-batch-graphs.py` | imports 边确定性生成 | 2 |
| `skills/understand/SKILL.md` | Phase 1/1.5/1.7/2/3 流程调整 + 并发上限 | 1, 2, 3, 4, 5 |
| `agents/file-analyzer.md` | Phase 1 改为读取预提取结果 + 移除 imports 边指令 | 2, 3 |
| `agents/project-scanner.md` | Step A 改为运行 extract-metadata.mjs | 5 |
| `tests/skill/understand/test_compute_batches.test.mjs` | 新增 CB-001~006 | 1, 4 |
| `tests/skill/understand/test_merge_batch_graphs.py` | 新增 MBG-001~004 | 2 |

---

## 5. 测试覆盖方案

### 5.1 测试用例总览

| 模块 | 测试 ID 数量 | 测试文件 |
|------|-------------|---------|
| extract-all-structure.mjs | 7 (EAS-001~007) | test_extract_all_structure.test.mjs |
| analyze-project.mjs | 6 (AP-001~006) | test_analyze_project.test.mjs |
| extract-metadata.mjs | 8 (EM-001~008) | test_extract_metadata.test.mjs |
| validate-assembly.mjs | 7 (VA-001~007) | test_validate_assembly.test.mjs |
| compute-batches.mjs 扩展 | 6 (CB-001~006) | test_compute_batches.test.mjs |
| merge-batch-graphs.py 扩展 | 4 (MBG-001~004) | test_merge_batch_graphs.py |
| **合计** | **38** | — |

### 5.2 测试模式遵循

所有新测试遵循项目现有模式：

- **JS 脚本测试**：`spawnSync('node', [SCRIPT, ...])` 子进程模式
- **临时文件系统**：`mkdtempSync` + `setupTree()` + `afterEach rmSync`
- **确定性测试**：每个脚本包含"两次运行输出 byte-identical"测试
- **韧性测试**：每个脚本包含"文件缺失/不可读时继续处理"测试
- **stderr 验证**：`r.stderr.toMatch(/Warning: .../)`
- **describe 命名**：`脚本名 — 功能域`
- **Python 测试**：`importlib` 加载 + `unittest.TestCase`

---

## 6. 验收标准 Checklist

### 功能验收

- [ ] `analyze-project.mjs` 输出的 importMap 与 `extract-import-map.mjs` 等价（AP-006）
- [ ] `analyze-project.mjs` 输出的 structure 与 `extract-structure.mjs` 等价（AP-006）
- [ ] `extract-metadata.mjs` 输出的 frameworks 与 project-scanner LLM 结果一致（EM-004~005）
- [ ] `validate-assembly.mjs` 检测到的 issues 与 assemble-reviewer LLM 结果一致（VA-001~007）
- [ ] imports 边覆盖率 = 100%（MBG-001~003）
- [ ] 增量更新路径完全兼容（原脚本保留为独立入口）

### 性能验收

- [ ] 300 文件项目全量分析耗时 < 15 分钟
- [ ] tree-sitter 初始化次数 ≤ 2
- [ ] LLM 调用次数 ≤ 14

### 质量验收

- [ ] `pnpm test` 全部通过（含 38 个新增测试用例）
- [ ] `pnpm --filter @understand-anything-trae/core test` 全部通过
- [ ] `python -m unittest` 全部通过
- [ ] ESLint 零错误
- [ ] 端到端验证：knowledge-graph.json 节点数差异 < 5%

---

## 7. 风险与缓解

| 风险 | 阶段 | 缓解措施 |
|------|------|---------|
| 增大批次导致 LLM 上下文溢出 | 1 | 60 文件元数据约 15-30k token，远在 128k 窗口内；端到端验证时检测 |
| file-analyzer 移除 imports 边指令后 LLM 仍生成 | 2 | merge-batch-graphs.py 去重逻辑已处理；不影响正确性 |
| 合并脚本引入新 bug | 4 | 保留原脚本作为独立入口；AP-006 确保结果等价 |
| extract-metadata.mjs 框架列表不完整 | 5 | 使用与 project-scanner.md 相同的列表；未知框架不影响核心分析 |
| 并发上限 8 导致 Trae IDE 调度问题 | 1 | 可通过配置回退到 5；实际取决于 Trae IDE 调度器能力 |

---

## 8. 依赖变更汇总

**无新增外部依赖**。所有新脚本使用项目已有的：
- `@understand-anything-trae/core`（TreeSitterPlugin, PluginRegistry, CssPlugin 等）
- `graphology` + `graphology-communities-louvain`（已有，compute-batches.mjs 使用）
- Node.js 内置模块（fs, path, child_process 等）

---

## 9. 回滚方案

每个阶段独立可回滚：

| 阶段 | 回滚方式 |
|------|---------|
| 1 | 恢复 compute-batches.mjs 常量 + SKILL.md 并发上限 |
| 2 | 恢复 merge-batch-graphs.py 的 recover_imports_from_scan + file-analyzer.md imports 指令 |
| 3 | 删除 extract-all-structure.mjs + 恢复 file-analyzer.md Phase 1 + 恢复 SKILL.md Phase 1.7 |
| 4 | 删除 analyze-project.mjs + 恢复 SKILL.md Phase 1 + 恢复 compute-batches.mjs extractExports |
| 5 | 删除 extract-metadata.mjs + validate-assembly.mjs + 恢复 SKILL.md Phase 1/3 + 恢复 project-scanner.md |
