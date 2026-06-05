<h1 align="center">Understand Anything Trae</h1>
<p align="center">
  <strong>将任意代码库、知识库或文档转化为可探索、可搜索、可对话的交互式知识图谱</strong>
  <br />
  <em>支持 Trae 和 Trae CN。</em>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#-快速开始"><img src="https://img.shields.io/badge/快速开始-blue" alt="Quick Start" /></a>
  <a href="https://github.com/creayma-del/Understand-Anything-Trae/blob/main/LICENSE"><img src="https://img.shields.io/badge/许可证-MIT-yellow" alt="License: MIT" /></a>
  <a href="#trae"><img src="https://img.shields.io/badge/Trae-7e22ce" alt="Trae" /></a>
</p>

---

**当你刚加入一个新团队，面对 20 万行代码，你从哪里开始？**

Understand Anything Trae 是一个 Trae 插件，通过多智能体（multi-agent）架构分析你的项目，构建包含文件、函数、类以及依赖关系的知识图谱，并提供一个可视化交互界面，帮助你理解整个系统。不再"盲读代码"，而是从全局视角理解系统结构。

> **目标不是用代码库的复杂程度来惊艳你 —— 而是默默告诉你每一块是怎么拼在一起的。**

---

## ✨ 核心功能

### 探索代码结构图

将你的代码库以交互式知识图谱的形式呈现——每个文件、函数和类都是可点击、可搜索、可探索的节点。选择任意节点即可查看通俗易懂的摘要、依赖关系和引导式学习路径。

### 理解业务逻辑

切换到领域视图，查看代码如何映射到真实的业务流程——以水平图的形式展示领域、流程和步骤。

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 引导式学习</h3>
      <p>自动生成架构学习路径，按依赖顺序学习。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 语义搜索</h3>
      <p>支持模糊搜索 + 语义搜索，例如搜索"哪些部分处理身份验证？"即可在整个图中获取相关结果。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 变更影响分析</h3>
      <p>提交更改前，查看更改会影响系统的哪些部分。了解更改对整个代码库的连锁反应。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 用户角色自适应 UI</h3>
      <p>根据用户类型（初级开发 / 项目经理 / 高级用户）调整其详细程度。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ 层级可视化</h3>
      <p>按架构层级自动分组 — API，服务，数据，UI, 系统工具 — 并附有颜色编码图例。</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 语言概念</h3>
      <p>86 种语言特定概念（泛型、闭包、响应式存储、SFC 模式等）将在上下文中逐一解释。</p>
    </td>
  </tr>
</table>

---

## 🚀 快速开始

### 1. 安装插件

使用一键安装脚本：

**macOS / Linux：**
```bash
curl -fsSL https://raw.githubusercontent.com/creayma-del/Understand-Anything-Trae/main/install.sh | bash -s trae
```

**Windows（PowerShell）：**
```powershell
iwr -useb https://raw.githubusercontent.com/creayma-del/Understand-Anything-Trae/main/install.ps1 | iex
```

### 2. 分析你的代码库

```bash
/understand
```

多智能体（multi-agent）架构会：扫描你的项目，提取函数 / 类 / 依赖，构建知识图谱保存至 `.understand-anything-trae/knowledge-graph.json`。

**本地化输出：** 使用 `--language` 参数生成指定语言的内容：

```bash
# 生成英文内容（知识图节点描述和 Dashboard UI）
/understand --language en

# 支持的语言：zh（默认）、en
```

`--language` 参数会影响：
- 知识图谱中的节点摘要和描述
- Dashboard UI 的标签、按钮和提示
- 导览路线的解释说明

### 3. 打开数据看板

```bash
/understand-dashboard
```

打开交互式网页数据看板，您的代码库将以图表形式呈现 — 按架构层级进行颜色编码，支持搜索和点击。选择任意节点即可查看其代码、关系以及简明易懂的解释。

### 4. 深度使用

```bash
# 分析当前修改的影响
/understand-diff

# 提取业务领域知识（领域、流程、步骤）
/understand-domain

# 直接重跑即可 —— 默认增量更新，只分析变更的文件
/understand

# 安装 post-commit 钩子，每次提交自动增量更新
/understand --auto-update

# 大型 monorepo？把分析范围限定到某个子目录
/understand src/frontend
```

---

## 🌐 安装

Understand-Anything-Trae 专为 Trae 和 Trae CN 设计。

### Trae / Trae CN

**macOS / Linux：**
```bash
curl -fsSL https://raw.githubusercontent.com/creayma-del/Understand-Anything-Trae/main/install.sh | bash -s trae
```

**Windows（PowerShell）：**
```powershell
iwr -useb https://raw.githubusercontent.com/creayma-del/Understand-Anything-Trae/main/install.ps1 | iex
```

安装脚本会将仓库克隆到 `~/.understand-anything-trae/repo`，并为 Trae 创建相应的符号链接。安装完成后请重启 Trae。

- 后续更新：`./install.sh --update`
- 卸载：`./install.sh --uninstall trae`

### 平台兼容

| 平台 | 状态 | 安装方式 |
|----------|--------|----------------|
| Trae | ✅ 支持 | `install.sh trae` |
| Trae CN | ✅ 支持 | `install.sh trae` |

---

## 📦 与团队共享知识图谱

图谱就是一份 JSON 文件——**提交一次，团队成员就可以跳过整条流水线**。适合新人上手、PR 评审和 docs-as-code 工作流。

**需要提交的内容：** `.understand-anything-trae/` 下的全部文件，*除了* `intermediate/` 和 `diff-overlay.json`（这些是本地临时文件）。

```gitignore
.understand-anything-trae/intermediate/
.understand-anything-trae/diff-overlay.json
```

**保持最新：** 启用 `/understand --auto-update` —— 一个 post-commit 钩子会增量更新图谱，每次提交都能得到匹配的图谱版本。也可以在发布前手动重跑 `/understand`。

**大型图谱（10 MB 以上）：** 使用 **git-lfs** 跟踪。

```bash
git lfs install
git lfs track ".understand-anything-trae/*.json"
git add .gitattributes .understand-anything-trae/
```

---

## 🔧 技术原理

### 支持的语言

**代码语言（4 种）：** TypeScript、JavaScript、Vue SFC、Svelte

**非代码语言（15 种）：** Markdown、YAML、JSON Config、TOML、Env、Dockerfile、SQL、GraphQL、Prisma、Makefile、Shell、HTML、CSS、reStructuredText、Plain Text

**框架（4 种）：** React、Vue、Next.js、Express

### Tree-sitter + LLM 混合分析

把确定性的事情交给静态分析，把需要语义理解的事情交给 LLM：

- **Tree-sitter（确定性）** —— 将源码解析为具体语法树，提取结构性事实：导入、导出、函数 / 类定义、调用点、继承关系。在 scan 阶段预先解析为 `importMap` 并传给 file-analyzer，避免它们再从源码推导一次 import。同样的输入永远得到同样的输出，并作为增量更新的指纹基础。
- **LLM（语义）** —— 读取解析后的结构以及原始源码，生成解析器做不了的事：plain-English 摘要、标签、架构层归属、业务领域映射、引导路径、语言概念标注。

正因为这个分工，图谱在结构层面是可复现的（同样的代码总是产生同样的边），同时在语义层面又能捕捉意图（一个文件是「为了什么」存在，而不仅仅是它 import 了什么）。

### 多智能体架构

`/understand` 命令调用 6 个 agent，`/understand-domain` 额外增加第 7 个：

| Agent | 职责 |
|-------|------|
| `project-scanner` | 扫描项目文件，检测语言和框架 |
| `file-analyzer` | 提取代码结构（函数、类和导入），生成图节点和边 |
| `assemble-reviewer` | 组装批次结果并验证图谱完整性 |
| `architecture-analyzer` | 识别架构层 |
| `tour-builder` | 生成引导式学习路径 |
| `graph-reviewer` | 验证图的完整性和引用完整性（默认内联运行；使用 `--review` 进行完整 LLM 审查） |
| `domain-analyzer` | 提取业务领域、流程和处理步骤（由 `/understand-domain` 使用） |

此外，`knowledge-graph-guide` 提供知识图谱的交互式使用指南。

文件分析器并行运行（最多 5 个并发，每批 20-30 个文件）。支持增量更新 — 仅重新分析自上次运行以来发生更改的文件。

## 🤝 贡献

欢迎贡献！以下是贡献指南：

1. Fork 项目
2. 新建分支 (`git checkout -b feature/my-feature`)
3. 运行测试 (`pnpm --filter @understand-anything-trae/core test`)
4. 提交更改并创建一个 PR 请求

对于重大变更，请先提交 issue，以便我们讨论解决方案。

---

<p align="center">
  <strong>不再盲读代码，而是理解整个系统</strong>
</p>


<p align="center">
  <em>感谢每一位使用过、贡献过的朋友 —— 知道它替你们省下了一些时间，就是当初做它最值得的理由。</em>
</p>

<p align="center">
  MIT 许可证 &copy; <a href="https://github.com/creayma-del">creayma-del</a>
</p>
