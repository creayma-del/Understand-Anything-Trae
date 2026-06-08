# P2: Understand 命令性能优化设计

> 版本: 1.2
> 日期: 2026-06-08
> 状态: 已评审（含评审修订）
> 前置: P1（前端生态深化）已完成
> 变更/关联: 评审修订 v1.2：修正文件路径前缀（添加 understand-anything-trae-plugin/）、generate_imports_from_scan 签名对齐实际接口(assembled, scan_result_path)、移除 pyproject.toml 解析（项目约束：无 Python 支持/无新依赖）、补充 description 确定性合成逻辑、调整优化 A/B 实施策略（A 为过渡步骤可跳过）、tree-sitter init 计数脚注、端到端验证拆分 imports/non-imports 边

## 1. 目标与范围

### 1.1 问题

`/understand` 命令在 300+ 文件项目上全量分析耗时 20-40 分钟，核心瓶颈：

1. Phase 2 LLM 调用次数 = 批次数（300 文件 → ~20 次 LLM 调用）
2. tree-sitter WASM 重复初始化 23 次（5 个脚本 × 各自独立初始化）
3. Phase 1 和 Phase 3 的 LLM 调用可确定性替代（2 次冗余 LLM 调用）
4. LLM 丢弃 ~25% imports 边，需后处理恢复
5. 并发上限仅 5

### 1.2 目标

- 全量分析耗时降低 50%+（300 文件项目：20-40 分钟 → 8-15 分钟）
- 分析精度不损失，imports 边覆盖率从 ~75% 提升到 100%
- LLM 调用次数减少 40%+
- tree-sitter 初始化次数减少 90%+

### 1.3 范围

**包含**：
- 确定性脚本合并与管线优化
- 批次参数调优
- Phase 1 / Phase 3 LLM 调用确定性替代
- imports 边确定性生成
- 并发上限调整

**不包含**：
- 增量更新路径优化（已足够高效）
- LLM prompt 优化（属于模型层面，非架构层面）
- Dashboard 性能优化
- 新语言/框架支持

### 1.4 约束

- 所有优化必须保持分析结果与优化前等价（或更优）
- 不引入新的外部依赖
- 不修改 core 包的公共 API（PluginRegistry、TreeSitterPlugin 等接口不变）
- 保持增量更新路径完全兼容
- 所有新脚本必须遵循现有模式（CLI 参数、stderr 日志、JSON 输出）

---

## 2. 性能瓶颈量化分析

### 2.1 流水线耗时分布（300 文件项目估算）

| 阶段 | LLM 调用 | 确定性脚本 | tree-sitter 初始化 | 预估耗时 |
|------|---------|-----------|-------------------|---------|
| Phase 0 | 0 | shell | 0 | <1s |
| Phase 0.5 | 0 | Node 内联 | 0 | <1s |
| Phase 1 | 1 | scan + extract-import-map | 1 | 30-60s |
| Phase 1.5 | 0 | compute-batches | 1 | 5-15s |
| **Phase 2** | **20** | **extract-structure × 20** | **20** | **15-30min** |
| Phase 3 | 1 | merge-batch-graphs.py | 0 | 30-60s |
| Phase 4 | 1 | — | 0 | 30-60s |
| Phase 5 | 1 | — | 0 | 30-60s |
| Phase 6 | 0 | 内联验证 | 0 | <1s |
| Phase 7 | 0 | build-fingerprints | 1 | 3-10s |
| **合计** | **24** | — | **23** | **~20-40min** |

> **脚注**：Phase 7（build-fingerprints）的 tree-sitter 初始化独立于主 Phase 1-6 管线，表中单独计数。主管线 tree-sitter 初始化为 22 次，Phase 7 为 1 次，合计 23 次。

### 2.2 瓶颈根因

**瓶颈 1：Phase 2 LLM 调用量（占总耗时 90%+）**

每个批次派遣 1 个 file-analyzer 子代理。Louvain 社区检测 + 小批次合并后，300 文件项目产生 ~20 个批次。5 并发 → 4 轮调度。每轮 LLM 调用 30-120 秒。

**瓶颈 2：tree-sitter 重复初始化**

5 个脚本各自独立初始化 TreeSitterPlugin：
- `extract-import-map.mjs` × 1
- `compute-batches.mjs` × 1（导出符号提取）
- `extract-structure.mjs` × N（每个子代理内部）
- `build-fingerprints.mjs` × 1

单次初始化 ~260ms（WASM 运行时 + 10 种语言语法加载），23 次 ≈ 6s。但每个脚本还有文件 I/O + 解析开销，实际重复开销更大。

**瓶颈 3：Phase 1 LLM 冗余调用**

project-scanner 的 Step A 仅从 `package.json` / `README.md` 提取 `name`、`description`、`frameworks`，这些操作可确定性完成。

**瓶颈 4：Phase 3 LLM 冗余调用**

assemble-reviewer 做的是结构化检查（ID 唯一性、边引用完整性、imports 覆盖率），可确定性完成。

**瓶颈 5：imports 边 25% 丢失**

LLM 生成 imports 边时丢失约 25%，`merge-batch-graphs.py` 的 `recover_imports_from_scan()` 事后恢复。imports 边本就是确定性数据（来自 importMap），不应依赖 LLM。

---

## 3. 优化方案详细设计

### 3.1 优化 A：结构提取提升到主流程

**现状**：每个 file-analyzer 子代理内部运行 `extract-structure.mjs`，导致 tree-sitter 初始化 N 次。

**方案**：在 Phase 1.5 和 Phase 2 之间新增 **Phase 1.7 — 结构预提取**，一次性对所有文件运行结构提取，输出 `structure-results.json`。Phase 2 的 file-analyzer 子代理直接读取预提取结果。

**数据流**：

```
优化前:
  Phase 1.5 → Phase 2 (每个子代理: extract-structure.mjs → LLM 分析)

优化后:
  Phase 1.5 → Phase 1.7 (extract-all-structure.mjs → structure-results.json)
            → Phase 2 (每个子代理: 读取预提取结果 → LLM 分析)
```

**新脚本 `extract-all-structure.mjs`**：

- 输入：`scan-result.json`（Phase 1 产出）
- 处理：一次 tree-sitter 初始化，遍历所有文件，对每个文件调用 `registry.analyzeFile()` + `registry.extractCallGraph()`
- 输出：`structure-results.json`
  ```json
  {
    "scriptCompleted": true,
    "filesAnalyzed": 300,
    "filesSkipped": [],
    "results": [
      {
        "path": "src/index.ts",
        "language": "typescript",
        "fileCategory": "code",
        "totalLines": 150,
        "nonEmptyLines": 120,
        "functions": [...],
        "classes": [...],
        "exports": [...],
        "callGraph": [...],
        "metrics": { ... }
      }
    ]
  }
  ```

**file-analyzer.md 变更**：

Phase 1 从"运行 extract-structure.mjs"改为"从 structure-results.json 中读取本批次文件的结果"。子代理不再需要初始化 tree-sitter。

**SKILL.md Phase 2 变更**：

dispatch prompt 中注入本批次的结构预提取结果（从 `structure-results.json` 中按文件路径筛选），替代原来的 `batchImportData` 注入方式。

**精度影响**：零。结构提取是确定性的，在主流程或子代理中运行结果相同。

**效果**：
- tree-sitter 初始化：N → 1（仅主流程 1 次）
- 消除每个子代理的进程启动 + 文件 I/O 开销
- 300 文件项目：20 次 → 1 次，节省 ~5s 初始化 + ~15s 重复解析

---

### 3.2 优化 B：合并确定性脚本为统一管线

**现状**：`extract-import-map.mjs`、`compute-batches.mjs`（含导出符号提取）、`extract-all-structure.mjs`（优化 A 新增）各自独立初始化 tree-sitter，独立读取和解析文件。

**方案**：将三者合并为 `analyze-project.mjs`，一次 tree-sitter 初始化 + 一次文件遍历完成所有工作。

**数据流**：

```
优化前:
  extract-import-map.mjs  → init tree-sitter → 解析所有文件 → importMap
  compute-batches.mjs     → init tree-sitter → 解析所有文件 → exports → batches
  extract-all-structure   → init tree-sitter → 解析所有文件 → structure

优化后:
  analyze-project.mjs     → init tree-sitter → 一次遍历 → importMap + exports + structure
  compute-batches.mjs     → 读取 exports → Louvain → batches（无需 tree-sitter）
```

**`analyze-project.mjs` 设计**：

```
输入: <projectRoot> <outputDir>
处理:
  1. 读取 scan-result.json
  2. 初始化 TreeSitterPlugin + PluginRegistry（一次）
  3. 遍历所有文件:
     a. registry.analyzeFile() → 结构数据
     b. registry.extractCallGraph() → 调用图
     c. 提取导入路径 → importMap
     d. 提取导出符号 → exportsMap
  4. 写入 import-map.json
  5. 写入 structure-results.json
  6. 写入 exports-map.json
输出: 3 个 JSON 文件到 <outputDir>/
```

**`compute-batches.mjs` 变更**：

不再自己初始化 tree-sitter 提取导出符号，改为读取 `exports-map.json`。Louvain 社区检测逻辑不变。

**保留原脚本**：

`extract-import-map.mjs` 和 `extract-structure.mjs` 保留为独立入口，供增量更新等场景使用。`compute-batches.mjs` 保留为独立入口，但内部 `extractExports()` 函数改为优先读取 `exports-map.json`，回退到 tree-sitter 初始化。

**精度影响**：零。逻辑完全相同，只是合并执行。

**实施策略说明**：优化 A（extract-all-structure.mjs）是过渡性步骤，将被优化 B（analyze-project.mjs）完全包含。若 P2.4（优化 B）直接实施，P2.3（优化 A）的 extract-all-structure.mjs 可跳过，无需单独开发。

**效果**：
- tree-sitter 初始化：3 → 1
- 文件读取 + 解析：3 次 → 1 次
- 300 文件项目节省 ~6-30s

---

### 3.3 优化 C：增大批次大小

**现状**：`MAX_COMMUNITY_SIZE = 35`，`MIN_BATCH_SIZE = 3`，`MAX_MERGE_TARGET = 25`。

**方案**：调整 `compute-batches.mjs` 的硬编码参数。

| 参数 | 当前值 | 优化值 | 理由 |
|------|--------|--------|------|
| `MAX_COMMUNITY_SIZE` | 35 | 60 | 现代 LLM 上下文窗口 128k+，35 文件元数据约 8-15k token，60 文件约 15-30k token，远未填满 |
| `MIN_BATCH_SIZE` | 3 | 5 | 减少过小批次的调度开销（子代理启动 + prompt 构造 ~5-10s/次） |
| `MAX_MERGE_TARGET` | 25 | 40 | 合并后批次更大，减少总批次数 |
| `count-fallback batchSize` | 12 | 25 | 回退模式也用更大批次 |
| 非 code `MAX_E` | 20 | 35 | 非代码文件元数据更小（无 functions/classes/callGraph） |
| `MAX_NEIGHBORS` | 50 | 50 | 不变，已足够覆盖跨批上下文 |

**精度影响**：极低。Louvain 社区检测的语义分批优势在 60 文件以内仍然有效。`neighborMap` 的 `MAX_NEIGHBORS = 50` 已足够覆盖跨批上下文。唯一风险是单次 LLM 调用的上下文更长，但 60 文件的元数据 + neighborMap 约 15-30k token，远在 128k 上下文窗口内。

**效果**：
- 300 文件项目：~20 批次 → ~12 批次
- LLM 调用减少 40%

---

### 3.4 优化 D：Phase 1 LLM → 确定性提取

**现状**：project-scanner 子代理的 Step A（LLM）读取 README + manifests 合成 `name`、`description`、`frameworks`、`languages`。

**方案**：新增 `extract-metadata.mjs` 脚本，确定性完成 Step A 的工作。

**`extract-metadata.mjs` 设计**：

```
输入: <projectRoot> <outputPath>
处理:
  1. 读取 package.json → name, description, dependencies, devDependencies
  2. 读取 README.md → 前 10 行作为 readmeHead
  3. 从依赖列表匹配已知框架 → frameworks[]
  4. 检测基础设施工具:
     - Dockerfile 存在 → "Docker"
     - .github/workflows/*.yml 存在 → "GitHub Actions"
     - .gitlab-ci.yml 存在 → "GitLab CI"
  5. 从 scan-project.mjs 的 byLanguage 统计 → languages[]
  6. 合成 description（确定性逻辑）:
     a. 若 rawDescription（来自 package.json）非空 → 使用 rawDescription
     b. 否则若 readmeHead 非空 → 跳过 # 标题行和空行，取第一个非空非标题段落，在 200 字符词边界处截断
     c. 否则 → "No description available"
输出:
  {
    "name": "package-name" | "<directory-name>",
    "description": "合成后的描述",
    "rawDescription": "package description" | "",
    "readmeHead": "first 10 lines" | "",
    "frameworks": ["React", "Vite", ...],
    "languages": ["typescript", "css", "markdown", ...]
  }
```

**框架匹配规则**（从 `project-scanner.md` Step A 提取）：

```javascript
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
```

**SKILL.md Phase 1 变更**：

不再派遣 project-scanner 子代理，改为：
1. 运行 `scan-project.mjs`（文件枚举）
2. 运行 `analyze-project.mjs`（导入/导出/结构提取，优化 B）
3. 运行 `extract-metadata.mjs`（元数据提取，替代 LLM Step A）
4. 合并三个输出为 `scan-result.json`

**project-scanner.md 变更**：

Step A 从 LLM 改为运行 `extract-metadata.mjs`。Step B/C 不变。

**精度影响**：极低。
- `name`：直接从 `package.json` 读取，比 LLM 合成更准确
- `description`：确定性合成逻辑：优先使用 package.json 的 description，回退到 README 首段（200 字符截断），最终回退到 "No description available"；比 LLM 合成更一致
- `frameworks`：精确匹配依赖名，比 LLM 推断更可靠
- `languages`：从统计结果生成，与 LLM 结果等价

**效果**：省 1 次 LLM 调用（30-60s）

---

### 3.5 优化 E：Phase 3 assemble-review → 确定性验证

**现状**：assemble-reviewer 子代理审查合并后的 `assembled-graph.json`。

**方案**：新增 `validate-assembly.mjs` 脚本，确定性完成审查工作。

**`validate-assembly.mjs` 设计**：

```
输入: <projectRoot> <assembledGraphPath> <importMapPath> <outputPath>
处理:
  1. 读取 assembled-graph.json + importMap
  2. 检查节点 ID 唯一性
  3. 检查必填字段（id, type, name, summary, tags）
  4. 检查边引用完整性（source/target 存在于节点集）
  5. 检查 imports 边覆盖率（对比 importMap）
  6. 规范化复杂度值（low→simple, medium→moderate, high→complex）
  7. 检测重复节点/边
  8. 检测孤立节点（无任何边连接的节点）
输出:
  {
    "valid": true/false,
    "issues": [...],
    "warnings": [...],
    "stats": {
      "totalNodes": N,
      "totalEdges": N,
      "importsCoverage": 0.95,
      "orphanNodes": N,
      "duplicateNodes": N,
      "duplicateEdges": N
    }
  }
```

**SKILL.md Phase 3 变更**：

不再派遣 assemble-reviewer 子代理，改为运行 `validate-assembly.mjs`。将 issues/warnings 合并到 `$PHASE_WARNINGS`。

**精度影响**：零。审查检查项全部是结构化的、规则化的，确定性脚本比 LLM 更可靠。

**效果**：省 1 次 LLM 调用（30-60s）

---

### 3.6 优化 F：imports 边确定性生成

**现状**：LLM 尝试从 `batchImportData` 生成 imports 边（丢失 ~25%），`merge-batch-graphs.py` 的 `recover_imports_from_scan()` 事后恢复。

**方案**：LLM 不再生成 imports 边，`merge-batch-graphs.py` 直接从 `importMap` 确定性生成全部 imports 边。

**数据流**：

```
优化前:
  file-analyzer → LLM 生成 imports 边（~75% 覆盖率）
  merge-batch-graphs.py → recover_imports_from_scan() 补充遗漏

优化后:
  file-analyzer → 不生成 imports 边
  merge-batch-graphs.py → generate_imports_from_scan() 确定性生成全部 imports 边
```

**file-analyzer.md 变更**：

移除 imports 边创建指令（Step 3 中 "Import edge creation rule" 整节），改为说明"imports 边由合并脚本确定性生成，file-analyzer 不需要生成 imports 边"。

**merge-batch-graphs.py 变更**：

将 `recover_imports_from_scan()` 改名为 `generate_imports_from_scan()`，从"补充遗漏"改为主流程：

```python
def generate_imports_from_scan(assembled, scan_result_path):
    """从 importMap 确定性生成全部 imports 边。"""
    import json
    with open(scan_result_path) as f:
        scan_result = json.load(f)
    import_map = scan_result.get('importMap', {})

    nodes = assembled.get('nodes', [])
    file_path_to_id = {}
    for n in nodes:
        if n.get('filePath'):
            file_path_to_id[n['filePath']] = n['id']

    imports_edges = []
    for source_path, targets in import_map.items():
        source_id = file_path_to_id.get(source_path)
        if not source_id:
            continue
        for target_path in targets:
            target_id = file_path_to_id.get(target_path)
            if not target_id:
                continue
            imports_edges.append({
                'source': source_id,
                'target': target_id,
                'type': 'imports',
                'direction': 'forward',
                'weight': 0.7,
            })

    # 去重：移除 LLM 已生成的 imports 边（如果有的话）
    existing_edges = assembled.get('edges', [])
    existing_imports = {(e['source'], e['target']) for e in existing_edges if e.get('type') == 'imports'}
    new_edges = [e for e in imports_edges if (e['source'], e['target']) not in existing_imports]

    return new_edges
```

**SKILL.md Phase 2 变更**：

dispatch prompt 中仍注入 `batchImportData`（供 LLM 理解文件间依赖关系），但不再要求 LLM 生成 imports 边。移除 "Import edge creation rule" 相关的 dispatch 指令。

**精度影响**：正面。确定性生成的 imports 边比 LLM 更准确、更完整。覆盖率从 ~75% 提升到 100%。

**效果**：
- 消除 LLM 生成 imports 边的 token 开销
- 消除后处理恢复逻辑
- imports 边覆盖率 100%

---

### 3.7 优化 G：提高并发上限

**现状**：SKILL.md 规定 "Run up to 5 subagents concurrently"。

**方案**：将并发上限从 5 提高到 8。

**SKILL.md Phase 2 变更**：

```
- Run up to **5 subagents concurrently**
+ Run up to **8 subagents concurrently**
```

**精度影响**：零。并发度不影响分析结果。

**效果**：
- 12 个批次（优化 C 后）：ceil(12/8) = 2 轮 vs ceil(12/5) = 3 轮
- 减少 1 轮调度时间

---

## 4. 优化效果汇总

### 4.1 量化对比（300 文件项目）

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| LLM 调用次数 | 4 + 20 = 24 | 2 + 12 = 14 | -42% |
| tree-sitter 初始化次数 | ~23 | ~2 | -91% |
| 文件重复读取次数 | ~3x | ~1x | -67% |
| imports 边覆盖率 | ~75% | 100% | +25% |
| 预估总耗时 | 20-40 分钟 | 8-15 分钟 | ~55% |

### 4.2 精度影响矩阵

| 优化项 | 精度影响 | 说明 |
|--------|---------|------|
| A. 结构提取提升到主流程 | 零 | 确定性操作，位置不影响结果 |
| B. 合并确定性脚本 | 零 | 逻辑相同，仅合并执行 |
| C. 增大批次大小 | 极低 | Louvain 语义分批在 60 文件内仍有效 |
| D. Phase 1 LLM→确定性 | 极低 | name/frameworks 更准确；description 确定性合成（package.json → README 首段 → 回退值） |
| E. Phase 3 LLM→确定性 | 零 | 结构化检查，脚本比 LLM 更可靠 |
| F. imports 边确定性生成 | 正面 | 覆盖率 75%→100% |
| G. 提高并发上限 | 零 | 并发度不影响结果 |

---

## 5. 测试覆盖方案

### 5.1 新增测试文件

| 测试文件 | 测试目标 | 测试框架 |
|---------|---------|---------|
| `tests/skill/understand/test_extract_all_structure.test.mjs` | extract-all-structure.mjs | Vitest + spawnSync |
| `tests/skill/understand/test_analyze_project.test.mjs` | analyze-project.mjs | Vitest + spawnSync |
| `tests/skill/understand/test_extract_metadata.test.mjs` | extract-metadata.mjs | Vitest + spawnSync |
| `tests/skill/understand/test_validate_assembly.test.mjs` | validate-assembly.mjs | Vitest + spawnSync |
| `tests/skill/understand/test_merge_batch_graphs.py`（扩展） | imports 边确定性生成 | unittest |

### 5.2 测试用例清单

#### 5.2.1 extract-all-structure.mjs 测试

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| EAS-001 | 基础 TypeScript 项目 | 含 TS 文件的临时目录 | 输出包含 functions/classes/exports/callGraph |
| EAS-002 | 混合语言项目 | TS + CSS + HTML + Markdown | 每种语言正确分类和提取 |
| EAS-003 | 空/损坏文件 | 含空文件和二进制文件 | filesSkipped 包含损坏文件，其余正常 |
| EAS-004 | 确定性 | 同一项目运行两次 | 输出 byte-identical |
| EAS-005 | Vue SFC 文件 | 含 .vue 文件 | 提取 script 块中的函数和类 |
| EAS-006 | CSS/SCSS 文件 | 含 .css/.scss 文件 | 提取 @import/@use 关系 |
| EAS-007 | 大文件 | 单文件 500+ 行 | 正确提取所有结构，不截断 |

#### 5.2.2 analyze-project.mjs 测试

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| AP-001 | 基础项目 | 含 TS + CSS + 配置文件 | 同时输出 import-map.json + structure-results.json + exports-map.json |
| AP-002 | 导入解析 | A.ts imports B.ts | importMap 包含 A→B |
| AP-003 | 导出符号 | 文件含 export function/class | exportsMap 包含符号名 |
| AP-004 | Monorepo 多 tsconfig | 含 packages/a/tsconfig.json + packages/b/tsconfig.json | 路径别名正确解析 |
| AP-005 | 确定性 | 同一项目运行两次 | 三个输出文件 byte-identical |
| AP-006 | 与独立脚本结果等价 | 同一项目分别运行 analyze-project.mjs 和独立脚本 | importMap/structure/exports 结果一致 |

#### 5.2.3 extract-metadata.mjs 测试

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| EM-001 | 标准 Node.js 项目 | 含 package.json + README.md | name/description/frameworks 正确提取 |
| EM-002 | 无 package.json | 仅 README.md | name 回退到目录名，description 从 README 首段合成 |
| EM-003 | 无 README | 仅 package.json | readmeHead 为空，description 使用 rawDescription |
| EM-004 | 框架检测 | package.json 含 react + vite 依赖 | frameworks 包含 "React" 和 "Vite" |
| EM-005 | 基础设施检测 | 含 Dockerfile + .github/workflows/ci.yml | frameworks 包含 "Docker" 和 "GitHub Actions" |
| EM-006 | 确定性 | 同一项目运行两次 | 输出 byte-identical |
| EM-007 | 空项目 | 无任何 manifest | name 回退到目录名，description 为 "No description available" |
| EM-008 | description 合成：rawDescription 优先 | package.json 有 description | description 等于 rawDescription |
| EM-009 | description 合成：README 首段回退 | 无 package.json description，README 有内容 | description 取 README 首段（跳过 # 标题行和空行，200 字符词边界截断） |
| EM-010 | description 合成：最终回退 | 无 description 无 README | description 为 "No description available" |

#### 5.2.4 validate-assembly.mjs 测试

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| VA-001 | 有效图 | 合法 assembled-graph.json | valid: true, issues: [] |
| VA-002 | 重复节点 ID | 两个节点 id 相同 | issues 包含 "Duplicate node ID" |
| VA-003 | 悬空边引用 | 边的 source 不存在于节点集 | issues 包含 "not found" |
| VA-004 | imports 覆盖率 | importMap 有 100 条，图中有 95 条 imports 边 | stats.importsCoverage ≈ 0.95 |
| VA-005 | 复杂度规范化 | 节点 complexity: "low" | 自动规范化为 "simple" |
| VA-006 | 孤立节点 | 节点无任何边连接 | warnings 包含孤立节点信息 |
| VA-007 | 必填字段缺失 | 节点缺少 summary | issues 包含 "missing summary" |

#### 5.2.5 compute-batches.mjs 扩展测试

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| CB-001 | 大社区拆分（新阈值） | 70 文件社区 | 拆分为 2 个批次（每 ≤60） |
| CB-002 | 小批次合并（新阈值） | 4 文件批次 | 合并到 misc 批次（< MIN_BATCH_SIZE=5） |
| CB-003 | 回退批次大小 | Louvain 失败 | 每批 25 文件 |
| CB-004 | 非 code 批次大小 | 40 个 config 文件同目录 | 每批 ≤35 文件 |
| CB-005 | 从 exports-map.json 读取 | exports-map.json 存在 | 不初始化 tree-sitter |
| CB-006 | exports-map.json 不存在回退 | exports-map.json 缺失 | 回退到 tree-sitter 初始化 |

#### 5.2.6 merge-batch-graphs.py 扩展测试

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| MBG-001 | imports 边确定性生成 | importMap 含 A→B, A→C | 生成 2 条 imports 边 |
| MBG-002 | 与 LLM imports 边去重 | LLM 生成 A→B，importMap 含 A→B, A→C | 保留 LLM 的 A→B，新增 A→C |
| MBG-003 | 无 LLM imports 边 | 批次输出无 imports 边 | 全部从 importMap 生成 |
| MBG-004 | importMap 路径不存在 | importMap 引用不存在的文件 | 跳过该路径，不生成悬空边 |

### 5.3 回归测试

所有优化实施后，必须通过以下回归测试：

1. **全量测试套件**：`pnpm test`（Vitest）+ `python -m unittest`（Python）
2. **core 包测试**：`pnpm --filter @understand-anything-trae/core test`
3. **端到端验证**：对本项目自身运行 `/understand --full`，对比优化前后的 `knowledge-graph.json`：
   - 节点数差异 < 5%
   - imports 边数应增加 ~25-33%
   - 非 imports 边数差异 < 5%
   - 所有节点 ID 格式正确
   - 无悬空边引用

---

## 6. 涉及文件清单

### 6.1 新增文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `understand-anything-trae-plugin/skills/understand/extract-all-structure.mjs` | 确定性脚本 | 全量结构预提取 |
| `understand-anything-trae-plugin/skills/understand/analyze-project.mjs` | 确定性脚本 | 统一分析管线（导入+导出+结构） |
| `understand-anything-trae-plugin/skills/understand/extract-metadata.mjs` | 确定性脚本 | 项目元数据提取 |
| `understand-anything-trae-plugin/skills/understand/validate-assembly.mjs` | 确定性脚本 | 组装验证 |
| `tests/skill/understand/test_extract_all_structure.test.mjs` | 测试 | EAS-001 ~ EAS-007 |
| `tests/skill/understand/test_analyze_project.test.mjs` | 测试 | AP-001 ~ AP-006 |
| `tests/skill/understand/test_extract_metadata.test.mjs` | 测试 | EM-001 ~ EM-010 |
| `tests/skill/understand/test_validate_assembly.test.mjs` | 测试 | VA-001 ~ VA-007 |

### 6.2 修改文件

| 文件 | 变更说明 |
|------|---------|
| `understand-anything-trae-plugin/skills/understand/SKILL.md` | Phase 1/1.5/1.7/2/3 流程调整；并发上限 5→8 |
| `understand-anything-trae-plugin/agents/file-analyzer.md` | Phase 1 改为读取预提取结果；移除 imports 边创建指令 |
| `understand-anything-trae-plugin/agents/project-scanner.md` | Step A 改为运行 extract-metadata.mjs |
| `understand-anything-trae-plugin/skills/understand/compute-batches.mjs` | 参数调优；支持读取 exports-map.json |
| `understand-anything-trae-plugin/skills/understand/merge-batch-graphs.py` | imports 边确定性生成替代恢复逻辑 |
| `tests/skill/understand/test_compute_batches.test.mjs` | 新增 CB-001 ~ CB-006 |
| `tests/skill/understand/test_merge_batch_graphs.py` | 新增 MBG-001 ~ MBG-004 |

### 6.3 不变文件

| 文件 | 说明 |
|------|------|
| `understand-anything-trae-plugin/skills/understand/scan-project.mjs` | 文件枚举逻辑不变 |
| `understand-anything-trae-plugin/skills/understand/extract-import-map.mjs` | 保留为独立入口（增量更新用） |
| `understand-anything-trae-plugin/skills/understand/extract-structure.mjs` | 保留为独立入口（增量更新用） |
| `understand-anything-trae-plugin/skills/understand/build-fingerprints.mjs` | 指纹生成逻辑不变（后续可复用 structure-results） |
| `packages/core/src/**` | 公共 API 不变 |

---

## 7. 验收标准

### 7.1 功能验收

- [ ] `analyze-project.mjs` 输出的 importMap 与 `extract-import-map.mjs` 等价
- [ ] `analyze-project.mjs` 输出的 structure 与 `extract-structure.mjs` 等价
- [ ] `extract-metadata.mjs` 输出的 frameworks 与 project-scanner LLM 结果一致
- [ ] `validate-assembly.mjs` 检测到的 issues 与 assemble-reviewer LLM 结果一致
- [ ] imports 边覆盖率 = 100%（从 importMap 确定性生成）
- [ ] 增量更新路径完全兼容

### 7.2 性能验收

- [ ] 300 文件项目全量分析耗时 < 15 分钟
- [ ] tree-sitter 初始化次数 ≤ 2
- [ ] LLM 调用次数 ≤ 14（2 + 12 批次）

### 7.3 质量验收

- [ ] `pnpm test` 全部通过
- [ ] `pnpm --filter @understand-anything-trae/core test` 全部通过
- [ ] `python -m unittest` 全部通过
- [ ] ESLint 零错误
- [ ] 端到端验证：knowledge-graph.json 节点数差异 < 5%，imports 边数增加 ~25-33%，非 imports 边数差异 < 5%

---

## 8. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 增大批次大小导致 LLM 上下文溢出 | 低 | 高 | 60 文件元数据约 15-30k token，远在 128k 窗口内；可动态检测 token 数并回退 |
| extract-metadata.mjs 框架匹配不完整 | 中 | 低 | 使用与 project-scanner.md 相同的已知框架列表；未知框架不影响核心分析 |
| 合并脚本引入新 bug | 中 | 中 | 保留原脚本作为独立入口；AP-006 测试确保结果等价 |
| file-analyzer 移除 imports 边指令后 LLM 仍生成 | 低 | 低 | merge-batch-graphs.py 去重逻辑已处理 |
| 并发上限 8 导致 Trae IDE 调度问题 | 低 | 低 | 可通过配置回退到 5 |
