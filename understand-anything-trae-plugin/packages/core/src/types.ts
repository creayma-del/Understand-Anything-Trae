// Node types (21 total: 5 code + 8 non-code + 3 domain + 5 knowledge)
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "flow" | "step"
  | "article" | "entity" | "topic" | "claim" | "source";

// Edge types (35 total in 8 categories: Structural, Behavioral, Data flow, Dependencies, Semantic, Infrastructure/Schema, Domain, Knowledge)
export type EdgeType =
  | "imports" | "exports" | "contains" | "inherits" | "implements"  // Structural
  | "calls" | "subscribes" | "publishes" | "middleware"              // Behavioral
  | "reads_from" | "writes_to" | "transforms" | "validates"         // Data flow
  | "depends_on" | "tested_by" | "configures"                       // Dependencies
  | "related" | "similar_to"                                         // Semantic
  | "deploys" | "serves" | "provisions" | "triggers"                // Infrastructure
  | "migrates" | "documents" | "routes" | "defines_schema"          // Schema/Data
  | "contains_flow" | "flow_step" | "cross_domain"                  // Domain
  | "cites" | "contradicts" | "builds_on" | "exemplifies" | "categorized_under" | "authored_by"; // Knowledge

// Optional knowledge metadata for article/entity/topic/claim/source nodes
export interface KnowledgeMeta {
  wikilinks?: string[];
  backlinks?: string[];
  category?: string;
  content?: string;
}

// Optional domain metadata for domain/flow/step nodes
export interface DomainMeta {
  entities?: string[];
  businessRules?: string[];
  crossDomainInteractions?: string[];
  entryPoint?: string;
  entryType?: "http" | "cli" | "event" | "cron" | "manual";
}

// GraphNode with 21 types: 5 code + 8 non-code + 3 domain + 5 knowledge
export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  languageNotes?: string;
  domainMeta?: DomainMeta;
  knowledgeMeta?: KnowledgeMeta;
}

// GraphEdge with rich relationship modeling
export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  description?: string;
  weight: number; // 0-1
}

// Layer (logical grouping)
export interface Layer {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
}

// TourStep (for learn mode)
export interface TourStep {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}

// ProjectMeta
export interface ProjectMeta {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;
  analyzedAt: string;
  gitCommitHash: string;
}

// Root KnowledgeGraph
export interface KnowledgeGraph {
  version: string;
  kind?: "codebase" | "knowledge";
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
}

// Theme configuration (for dashboard customization)
export interface ThemeConfig {
  presetId: string;
  accentId: string;
}

// AnalysisMeta (for persistence)
export interface AnalysisMeta {
  lastAnalyzedAt: string;
  gitCommitHash: string;
  version: string;
  analyzedFiles: number;
  theme?: ThemeConfig;
}

// Project config (for auto-update opt-in and language preference)
export interface ProjectConfig {
  autoUpdate: boolean;
  outputLanguage?: string;
}

// Non-code structural sub-interfaces
export interface SectionInfo {
  name: string;
  level: number;
  lineRange: [number, number];
}

export interface DefinitionInfo {
  name: string;
  /** Parser-reported definition kind. Known values: "table", "view", "index", "message", "enum", "type", "input", "interface", "union", "scalar", "variable", "output", "resource", "data", "section", "target", "stage" */
  kind: string;
  lineRange: [number, number];
  fields: string[];
}

export interface ServiceInfo {
  name: string;
  image?: string;
  ports: number[];
  lineRange?: [number, number];
}

export interface EndpointInfo {
  method?: string;
  path: string;
  lineRange: [number, number];
}

export interface StepInfo {
  name: string;
  lineRange: [number, number];
}

export interface ResourceInfo {
  name: string;
  kind: string;
  lineRange: [number, number];
}

// HTML structural data
export interface HtmlElementInfo {
  tag: string;                           // 标签名，如 "div", "script", "link"
  lineRange: [number, number];           // 元素在文件中的行范围
  attributes: Record<string, string>;    // 属性键值对，如 { src: "./app.js", defer: "" }
  isSelfClosing: boolean;                // 是否自闭合标签，如 <meta />, <link />
}

/**
 * CSS/SCSS 规则信息，用于 StructuralAnalysis.cssRules 字段。
 * 涵盖普通规则、at-rule、mixin、function 和变量定义。
 */
export interface CssRuleInfo {
  /** CSS 选择器或 at-rule 标识符（如 ".button"、"@media (min-width: 768px)"） */
  selector: string;
  /** 规则在文件中的行范围 [起始行, 结束行] */
  lineRange: [number, number];
  /** 规则内包含的声明属性名列表（如 ["color", "font-size"]）。
   *  对于 type: 'variable'，此字段为空数组 []，变量名存储在 selector 中，
   *  以保持与其他类型（存储属性名）的语义一致性。 */
  declarations: string[];
  /** 规则类型 */
  type: 'rule' | 'at-rule' | 'mixin' | 'function' | 'variable';
  /** 语义标签列表（如 "scoped-style"、"css-modules"），由 VueSfcPlugin/SveltePlugin 合并时添加 */
  tags?: string[];
}

export interface ReferenceResolution {
  source: string;
  target: string;
  referenceType: string; // "file", "image", "schema", "service"
  line?: number;
}

// Plugin interfaces
export interface StructuralAnalysis {
  functions: Array<{ name: string; lineRange: [number, number]; params: string[]; returnType?: string; tags?: string[] }>;
  classes: Array<{ name: string; lineRange: [number, number]; methods: string[]; properties: string[]; tags?: string[] }>;
  imports: Array<{ source: string; specifiers: string[]; lineNumber: number; importKind?: 'module' | 'component' | 'hook' | 'context' | 'hoc' | 'css-in-js' }>;
  exports: Array<{ name: string; lineNumber: number; isDefault?: boolean }>;
  // Non-code structural data (all optional for backward compat)
  sections?: SectionInfo[];
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
  // HTML structural data (optional for backward compat)
  htmlElements?: HtmlElementInfo[];
  // CSS/SCSS structural data (optional for backward compat)
  cssRules?: CssRuleInfo[];
}

export interface ImportResolution {
  source: string;
  resolvedPath: string;
  specifiers: string[];
  /** resolvedPath 是否经过文件系统存在性验证。
   *  CssPlugin 的 resolveImports() 无法直接访问文件系统，
   *  因此始终返回 isVerified: false；
   *  实际验证由 extract-import-map.mjs 中的 resolveCssImport() 完成。 */
  isVerified?: boolean;
}

export interface CallGraphEntry {
  caller: string;
  callee: string;
  lineNumber: number;
  /** P1.4 新增: 关系类型，默认 'call' */
  relationType?: 'call' | 'contains' | 'depends_on';
}

export interface AnalyzerPlugin {
  name: string;
  languages: string[];
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports?(filePath: string, content: string): ImportResolution[];
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
  extractReferences?(filePath: string, content: string): ReferenceResolution[];
}
