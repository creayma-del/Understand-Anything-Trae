import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { TypeScriptExtractor } from "./typescript-extractor.js";
import { traverse, findChild, findChildren } from "./base-extractor.js";

/**
 * React 内置 hooks 列表
 */
const REACT_HOOKS = new Set([
  'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
  'useContext', 'useReducer', 'useLayoutEffect', 'useDebugValue',
  'useDeferredValue', 'useTransition', 'useId', 'useSyncExternalStore',
  'useInsertionEffect', 'useImperativeHandle',
]);

/**
 * React HOC 函数名列表
 */
const REACT_HOCS = new Set([
  'memo', 'forwardRef',
]);

/**
 * CSS-in-JS 库导入源映射。
 * key 为库名，value 为该库对应的 npm 包名列表。
 */
const CSS_IN_JS_IMPORT_SOURCES = {
  'styled-components': ['styled-components'],
  'emotion': ['@emotion/styled', '@emotion/react', '@emotion/css'],
  'styled-jsx': ['styled-jsx', 'styled-jsx/css'],
  'jss': ['jss', 'react-jss'],
  'mui': ['@mui/styles', '@material-ui/styles'],
} as const;

/**
 * CSS-in-JS 样式定义信息
 */
interface CssInJsDefinition {
  /** 样式组件/变量名 */
  name: string;
  /** 所属 CSS-in-JS 库 */
  library: 'styled-components' | 'emotion' | 'styled-jsx' | 'jss' | 'mui';
  /** 识别的具体模式（如 'styled.xxx', 'css', 'makeStyles' 等） */
  pattern: string;
  /** 定义所在行号 */
  lineNumber: number;
  /** 所属函数（如组件名） */
  parentFunction?: string;
}

/**
 * React JSX 语义提取器。
 *
 * 继承 TypeScriptExtractor，在基础 TS/JS 结构提取之上
 * 增量分析 React 特有模式：hooks、组件、JSX 组合、Context、HOC。
 */
export class ReactExtractor extends TypeScriptExtractor implements LanguageExtractor {
  readonly languageIds = ['typescript', 'javascript'];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    // 阶段 1: 调用父类提取基础结构
    const result = super.extractStructure(rootNode);

    // 阶段 2: 增量分析 React 模式
    this.identifyHooks(result, rootNode);
    this.identifyComponents(result, rootNode);
    this.identifyJsxComposition(result, rootNode);
    this.identifyContextRelations(result, rootNode);
    this.identifyHocPatterns(result, rootNode);
    // P1.8 新增: CSS-in-JS 模式识别
    this.identifyCssInJs(result, rootNode);

    return result;
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    // 阶段 1: 调用父类提取基础调用图
    const entries = super.extractCallGraph(rootNode);

    // 阶段 2: 增量分析 React 关系边
    this.addContainsEdges(entries, rootNode);
    this.addDependsOnEdges(entries, rootNode);

    return entries;
  }

  // ---- React 模式识别方法 ----

  /**
   * 识别 hooks 调用模式。
   *
   * 规则:
   * 1. 内置 hook: 函数名在 REACT_HOOKS 集合中 + 从 'react' 导入
   * 2. 自定义 hook: 函数名匹配 use[A-Z] 模式 + 从 hook 文件导入或当前文件定义
   *
   * 交叉验证: 仅当函数名匹配 hook 模式 且 (从 react 导入 或 use[A-Z] 命名)
   *           才标记为 hook，避免误判
   */
  private identifyHooks(result: StructuralAnalysis, _rootNode: TreeSitterNode): void {
    // 1. 构建从 'react' 导入的 specifiers 集合
    const reactImports = this.collectReactImports(result);

    // 2. 标记函数中的 hooks
    for (const fn of result.functions) {
      if (REACT_HOOKS.has(fn.name) && reactImports.has(fn.name)) {
        // 内置 hook
        fn.tags = [...(fn.tags ?? []), 'hook', 'builtin-hook'];
      } else if (/^use[A-Z]/.test(fn.name)) {
        // 自定义 hook（use[A-Z] 命名约定）
        fn.tags = [...(fn.tags ?? []), 'hook', 'custom-hook'];
      }
    }

    // 3. 标记 imports 中的 hook 导入
    for (const imp of result.imports) {
      if (imp.source === 'react') {
        const hookSpecifiers = imp.specifiers.filter(s => REACT_HOOKS.has(s));
        if (hookSpecifiers.length > 0) {
          imp.importKind = 'hook';
        }
      } else {
        const hookSpecifiers = imp.specifiers.filter(s => /^use[A-Z]/.test(s));
        if (hookSpecifiers.length > 0 && hookSpecifiers.length === imp.specifiers.length) {
          imp.importKind = 'hook';
        }
      }
    }
  }

  /**
   * 识别组件声明。
   *
   * 规则:
   * 1. 函数名 PascalCase + 返回 JSX -> function-component
   * 2. 函数名 PascalCase + React.FC / React.FunctionComponent 类型标注 -> function-component
   * 3. forwardRef 包裹 -> function-component + forward-ref
   * 4. 类名 PascalCase + extends React.Component / React.PureComponent -> class-component
   */
  private identifyComponents(result: StructuralAnalysis, rootNode: TreeSitterNode): void {
    for (const fn of result.functions) {
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(fn.name)) continue;

      // 检查是否已被标记为 hook（组件和 hook 互斥）
      if (fn.tags?.includes('hook')) continue;

      // 规则 1: PascalCase + 返回 JSX（通过遍历函数体检测 jsx_element / jsx_self_closing_element）
      if (this.functionReturnsJsx(rootNode, fn)) {
        fn.tags = [...(fn.tags ?? []), 'component', 'function-component'];
        continue;
      }

      // 规则 2: React.FC 类型标注
      if (this.hasReactFcAnnotation(rootNode, fn)) {
        fn.tags = [...(fn.tags ?? []), 'component', 'function-component'];
        continue;
      }
    }

    // 规则 3: forwardRef 包裹
    this.identifyForwardRefComponents(result, rootNode);

    // 规则 4: 类组件
    for (const cls of result.classes) {
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(cls.name)) continue;
      if (this.classExtendsReactComponent(rootNode, cls)) {
        cls.tags = ['component', 'class-component'];
      }
    }

    // 标记组件导入（不覆盖已设置的 importKind）
    for (const imp of result.imports) {
      if (imp.importKind) continue; // 已被前面的识别方法标记，不覆盖
      const componentSpecifiers = imp.specifiers.filter(s => /^[A-Z][a-zA-Z0-9]*$/.test(s));
      if (componentSpecifiers.length > 0 && componentSpecifiers.length === imp.specifiers.length) {
        imp.importKind = 'component';
      }
    }
  }

  /**
   * 识别 JSX 组件组合。
   *
   * 规则: JSX 中 <PascalCase /> 标签
   * 交叉验证: 仅当 PascalCase 名称在当前文件 imports 中存在时生成 contains 边
   * 排除: HTML 标准标签（div, span, header 等）不生成边
   *
   * 注: 此方法在结构层面不直接体现，通过 CallGraphEntry.relationType = 'contains' 体现
   */
  private identifyJsxComposition(_result: StructuralAnalysis, _rootNode: TreeSitterNode): void {
    // 由 extractCallGraph 中的 addContainsEdges 处理
  }

  /**
   * 识别 Context 关系。
   *
   * 规则:
   * 1. createContext() 调用 -> context-definition 标签
   * 2. useContext(ContextName) 调用 -> context-consumer 标签 + depends_on 边
   */
  private identifyContextRelations(result: StructuralAnalysis, rootNode: TreeSitterNode): void {
    // 1. 遍历 AST 查找 createContext 调用
    const contextDefinitions = this.findCreateContextCalls(rootNode);

    // 2. 遍历 AST 查找 useContext 调用
    const contextConsumers = this.findUseContextCalls(rootNode);

    // 3. 标记函数
    for (const fn of result.functions) {
      // 检查函数体内是否包含 createContext
      for (const ctx of contextDefinitions) {
        if (ctx.lineNumber >= fn.lineRange[0] && ctx.lineNumber <= fn.lineRange[1]) {
          fn.tags = [...(fn.tags ?? []), 'context-definition'];
        }
      }
      // 检查函数体内是否包含 useContext
      for (const consumer of contextConsumers) {
        if (consumer.lineNumber >= fn.lineRange[0] && consumer.lineNumber <= fn.lineRange[1]) {
          fn.tags = [...(fn.tags ?? []), 'context-consumer'];
        }
      }
    }

    // 4. 标记 Context 相关导入（不覆盖已设置的 importKind）
    const contextNames = new Set(contextDefinitions.map(c => c.name));
    for (const imp of result.imports) {
      if (imp.importKind) continue; // 已被前面的识别方法标记，不覆盖
      const contextSpecifiers = imp.specifiers.filter(s => contextNames.has(s) || /Context$/.test(s));
      if (contextSpecifiers.length > 0 && contextSpecifiers.length === imp.specifiers.length) {
        imp.importKind = 'context';
      }
    }
  }

  /**
   * 识别 HOC 包装模式。
   *
   * 规则:
   * 1. export default hocName(Component) -> hoc-wrapped 标签
   * 2. const Wrapped = memo(Component) -> hoc-wrapped 标签
   * 3. const Wrapped = forwardRef((props, ref) => {}) -> hoc-wrapped + forward-ref 标签
   * 4. connect()() 双重调用模式 -> hoc-wrapped 标签
   */
  private identifyHocPatterns(result: StructuralAnalysis, rootNode: TreeSitterNode): void {
    // 遍历 AST 查找 HOC 模式
    const hocWrappers = this.findHocPatterns(rootNode);

    for (const hoc of hocWrappers) {
      let foundInFunctions = false;

      // 在 exports 中查找被 HOC 包装的组件
      for (const exp of result.exports) {
        if (exp.lineNumber === hoc.lineNumber) {
          // 标记对应的函数
          for (const fn of result.functions) {
            if (fn.name === hoc.wrappedName) {
              fn.tags = [...(fn.tags ?? []), 'hoc-wrapped'];
              foundInFunctions = true;
            }
          }
        }
      }

      // 在变量声明中查找被 HOC 包装的组件
      for (const fn of result.functions) {
        if (fn.name === hoc.wrappedName && hoc.lineNumber >= fn.lineRange[0] && hoc.lineNumber <= fn.lineRange[1]) {
          fn.tags = [...(fn.tags ?? []), 'hoc-wrapped'];
          foundInFunctions = true;
        }
      }

      // HOC 包装的变量可能不在 functions 中（如 memo(Component) 不是 arrow_function）
      // 需要查找 AST 中的变量声明并添加到 functions
      if (!foundInFunctions) {
        const hocVar = this.findHocVariableDeclaration(rootNode, hoc);
        if (hocVar) {
          result.functions.push({
            name: hocVar.name,
            lineRange: hocVar.lineRange,
            params: [],
            tags: ['hoc-wrapped'],
          });
        }
      }
    }

    // 标记 HOC 相关导入（不覆盖已设置的 importKind）
    const hocNames = new Set(hocWrappers.map(h => h.hocName));
    for (const imp of result.imports) {
      if (imp.importKind) continue; // 已被前面的识别方法标记，不覆盖
      const hocSpecifiers = imp.specifiers.filter(s => hocNames.has(s) || REACT_HOCS.has(s));
      if (hocSpecifiers.length > 0 && hocSpecifiers.length === imp.specifiers.length) {
        imp.importKind = 'hoc';
      }
    }
  }

  // ---- CallGraph 关系边扩展 ----

  /**
   * 添加 contains 边（父组件 -> 子组件）
   */
  private addContainsEdges(entries: CallGraphEntry[], rootNode: TreeSitterNode): void {
    // 遍历 AST 查找 JSX 中 <PascalCase /> 标签
    const jsxComponents = this.findJsxComponentRefs(rootNode);
    for (const ref of jsxComponents) {
      entries.push({
        caller: ref.parentFunction,
        callee: ref.componentName,
        lineNumber: ref.lineNumber,
        relationType: 'contains',
      });
    }
  }

  /**
   * 添加 depends_on 边（Context 消费 -> 定义、HOC 包装）
   */
  private addDependsOnEdges(entries: CallGraphEntry[], rootNode: TreeSitterNode): void {
    // Context depends_on 边
    const contextConsumers = this.findUseContextCalls(rootNode);
    for (const consumer of contextConsumers) {
      entries.push({
        caller: consumer.parentFunction,
        callee: consumer.contextName,
        lineNumber: consumer.lineNumber,
        relationType: 'depends_on',
      });
    }

    // HOC depends_on 边
    const hocWrappers = this.findHocPatterns(rootNode);
    for (const hoc of hocWrappers) {
      entries.push({
        caller: hoc.wrappedName,
        callee: hoc.hocName,
        lineNumber: hoc.lineNumber,
        relationType: 'depends_on',
      });
    }
  }

  // ---- 辅助方法 ----

  /** 收集从 'react' 导入的所有 specifiers */
  private collectReactImports(result: StructuralAnalysis): Set<string> {
    const specifiers = new Set<string>();
    for (const imp of result.imports) {
      if (imp.source === 'react') {
        for (const spec of imp.specifiers) {
          specifiers.add(spec);
        }
      }
    }
    return specifiers;
  }

  /** 检查函数是否返回 JSX */
  private functionReturnsJsx(rootNode: TreeSitterNode, fn: StructuralAnalysis['functions'][0]): boolean {
    let found = false;
    traverse(rootNode, (node) => {
      if (found) return;
      // 定位函数节点
      if (
        (node.type === 'function_declaration' || node.type === 'arrow_function') &&
        node.startPosition.row + 1 === fn.lineRange[0]
      ) {
        // 在函数体内查找 JSX 节点
        traverse(node, (child) => {
          if (
            child.type === 'jsx_element' ||
            child.type === 'jsx_self_closing_element' ||
            child.type === 'jsx_fragment'
          ) {
            found = true;
          }
        });
      }
    });
    return found;
  }

  /** 检查函数是否有 React.FC 类型标注 */
  private hasReactFcAnnotation(rootNode: TreeSitterNode, fn: StructuralAnalysis['functions'][0]): boolean {
    let found = false;
    traverse(rootNode, (node) => {
      if (found) return;
      if (
        node.type === 'variable_declarator' &&
        node.startPosition.row + 1 === fn.lineRange[0]
      ) {
        const typeAnnotation = findChild(node, 'type_annotation');
        if (typeAnnotation) {
          const text = typeAnnotation.text;
          if (/React\.(FC|FunctionComponent|SFC)/.test(text)) {
            found = true;
          }
        }
      }
    });
    return found;
  }

  /** 识别 forwardRef 包裹的组件 */
  private identifyForwardRefComponents(result: StructuralAnalysis, rootNode: TreeSitterNode): void {
    traverse(rootNode, (node) => {
      if (node.type === 'call_expression' && node.childForFieldName('function')?.text === 'forwardRef') {
        const parent = node.parent;
        if (parent?.type === 'variable_declarator') {
          const nameNode = parent.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const existingFn = result.functions.find(fn => fn.name === name);
            if (existingFn) {
              existingFn.tags = [...(existingFn.tags ?? []), 'component', 'function-component', 'forward-ref'];
            } else {
              // forwardRef(...) 的值不是 arrow_function，TypeScriptExtractor 不会提取
              // 需要手动添加到 functions 数组
              result.functions.push({
                name,
                lineRange: [parent.startPosition.row + 1, parent.endPosition.row + 1],
                params: [],
                tags: ['component', 'function-component', 'forward-ref'],
              });
            }
          }
        }
      }
    });
  }

  /** 检查类是否继承 React.Component */
  private classExtendsReactComponent(rootNode: TreeSitterNode, cls: StructuralAnalysis['classes'][0]): boolean {
    let found = false;
    traverse(rootNode, (node) => {
      if (found) return;
      if (node.type === 'class_declaration' && node.startPosition.row + 1 === cls.lineRange[0]) {
        const heritage = findChild(node, 'class_heritage');
        if (heritage) {
          const text = heritage.text;
          if (/React\.(Component|PureComponent)|extends\s+(Component|PureComponent)/.test(text)) {
            found = true;
          }
        }
      }
    });
    return found;
  }

  /** 查找 createContext 调用 */
  private findCreateContextCalls(rootNode: TreeSitterNode): Array<{ name: string; lineNumber: number }> {
    const results: Array<{ name: string; lineNumber: number }> = [];
    traverse(rootNode, (node) => {
      if (node.type === 'call_expression') {
        const func = node.childForFieldName('function');
        if (func?.text === 'createContext' || func?.text === 'React.createContext') {
          const parent = node.parent;
          if (parent?.type === 'variable_declarator') {
            const nameNode = parent.childForFieldName('name');
            if (nameNode) {
              results.push({
                name: nameNode.text,
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }
      }
    });
    return results;
  }

  /** 查找 useContext 调用 */
  private findUseContextCalls(rootNode: TreeSitterNode): Array<{ contextName: string; parentFunction: string; lineNumber: number }> {
    const results: Array<{ contextName: string; parentFunction: string; lineNumber: number }> = [];
    const functionStack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      const isFunctionLike =
        node.type === 'function_declaration' ||
        node.type === 'arrow_function' ||
        node.type === 'function_expression';

      let pushedName = '';
      if (isFunctionLike) {
        let name: string | undefined;
        if (node.type === 'function_declaration') {
          name = (node.childForFieldName('name') ?? node.children.find(c => c.type === 'identifier'))?.text;
        } else {
          const parent = node.parent;
          if (parent?.type === 'variable_declarator') {
            name = parent.childForFieldName('name')?.text;
          }
        }
        if (name) {
          functionStack.push(name);
          pushedName = name;
        }
      }

      if (node.type === 'call_expression') {
        const func = node.childForFieldName('function');
        if (func?.text === 'useContext' || func?.text === 'React.useContext') {
          const args = node.childForFieldName('arguments');
          if (args) {
            const firstArg = args.children.find(c => c.type === 'identifier');
            if (firstArg) {
              results.push({
                contextName: firstArg.text,
                parentFunction: functionStack[functionStack.length - 1] ?? '<module>',
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }

      if (pushedName) functionStack.pop();
    };

    walk(rootNode);
    return results;
  }

  /** 查找 HOC 包装模式 */
  private findHocPatterns(rootNode: TreeSitterNode): Array<{ hocName: string; wrappedName: string; lineNumber: number }> {
    const results: Array<{ hocName: string; wrappedName: string; lineNumber: number }> = [];

    traverse(rootNode, (node) => {
      if (node.type === 'call_expression') {
        const func = node.childForFieldName('function');
        if (!func) return;

        const funcText = func.text;

        // 模式 1: memo(Component) / forwardRef(...)
        if (REACT_HOCS.has(funcText)) {
          const args = node.childForFieldName('arguments');
          if (args) {
            // forwardRef 内部是箭头函数，不提取 wrappedName
            // memo(Component) 提取 Component 名
            const firstArg = args.children.find(c => c.type === 'identifier');
            if (firstArg && /^[A-Z]/.test(firstArg.text)) {
              results.push({
                hocName: funcText,
                wrappedName: firstArg.text,
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }

        // 模式 2: connect()() / withRouter(Component) — 任意 HOC
        if (/^[a-z]/.test(funcText) && !REACT_HOOKS.has(funcText)) {
          const args = node.childForFieldName('arguments');
          if (args) {
            const firstArg = args.children.find(c => c.type === 'identifier' && /^[A-Z]/.test(c.text));
            if (firstArg) {
              results.push({
                hocName: funcText,
                wrappedName: firstArg.text,
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }

        // 模式 3: connect(mapStateToProps)(Component) — 双重调用
        if (func.type === 'call_expression') {
          const outerArgs = node.childForFieldName('arguments');
          if (outerArgs) {
            const component = outerArgs.children.find(c => c.type === 'identifier' && /^[A-Z]/.test(c.text));
            if (component) {
              const innerFunc = func.childForFieldName('function');
              if (innerFunc) {
                results.push({
                  hocName: innerFunc.text,
                  wrappedName: component.text,
                  lineNumber: node.startPosition.row + 1,
                });
              }
            }
          }
        }
      }
    });

    return results;
  }

  /** 查找 JSX 中的组件引用 */
  private findJsxComponentRefs(rootNode: TreeSitterNode): Array<{ componentName: string; parentFunction: string; lineNumber: number }> {
    const results: Array<{ componentName: string; parentFunction: string; lineNumber: number }> = [];
    const functionStack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      const isFunctionLike =
        node.type === 'function_declaration' ||
        node.type === 'arrow_function' ||
        node.type === 'function_expression' ||
        node.type === 'method_definition';

      let pushedName = '';
      if (isFunctionLike) {
        let name: string | undefined;
        if (node.type === 'function_declaration') {
          name = (node.childForFieldName('name') ?? node.children.find(c => c.type === 'identifier'))?.text;
        } else if (node.type === 'method_definition') {
          name = node.children.find(c => c.type === 'property_identifier')?.text;
        } else {
          const parent = node.parent;
          if (parent?.type === 'variable_declarator') {
            name = parent.childForFieldName('name')?.text;
          }
        }
        if (name) {
          functionStack.push(name);
          pushedName = name;
        }
      }

      // 检测 JSX 元素
      if (node.type === 'jsx_self_closing_element' || node.type === 'jsx_opening_element') {
        const nameNode = node.childForFieldName('name');
        if (nameNode && /^[A-Z]/.test(nameNode.text)) {
          results.push({
            componentName: nameNode.text,
            parentFunction: functionStack[functionStack.length - 1] ?? '<module>',
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }

      if (pushedName) functionStack.pop();
    };

    walk(rootNode);
    return results;
  }

  /** 查找 HOC 包装对应的变量声明（用于将 HOC 包装的变量添加到 functions） */
  private findHocVariableDeclaration(rootNode: TreeSitterNode, hoc: { hocName: string; wrappedName: string; lineNumber: number }): { name: string; lineRange: [number, number] } | null {
    let result: { name: string; lineRange: [number, number] } | null = null;

    traverse(rootNode, (node) => {
      if (result) return;
      if (node.type === 'variable_declarator' && node.startPosition.row + 1 === hoc.lineNumber) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          result = {
            name: nameNode.text,
            lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          };
        }
      }
    });

    return result;
  }

  // ---- CSS-in-JS 模式识别方法 (P1.8) ----

  /**
   * 识别 CSS-in-JS 模式。
   *
   * 识别流程:
   * 1. 扫描导入语句，确定项目中使用的 CSS-in-JS 库
   * 2. 遍历 AST，按库匹配对应的模式
   * 3. 标记函数/变量的 tags
   * 4. 标记导入的 importKind
   *
   * 交叉验证:
   * - styled.xxx 必须确认导入源（styled-components vs @emotion/styled）
   * - css 模板字面量必须确认从 @emotion/css 导入
   * - makeStyles/createStyles 必须确认从 @mui/styles 或 jss 导入
   */
  private identifyCssInJs(result: StructuralAnalysis, rootNode: TreeSitterNode): void {
    // 1. 扫描导入，构建 CSS-in-JS 库使用图
    const cssInJsLibraries = this.detectCssInJsLibraries(result);

    // 2. 如果未检测到任何 CSS-in-JS 库，跳过（避免无谓的 AST 遍历）
    if (cssInJsLibraries.size === 0) return;

    // 3. 遍历 AST 识别各库的模式
    const definitions = this.findCssInJsDefinitions(rootNode, cssInJsLibraries);

    // 4. 标记函数 tags，或将 CSS-in-JS 定义添加为新的函数条目
    for (const def of definitions) {
      const existingFn = result.functions.find(fn => fn.name === def.name);
      if (existingFn) {
        const existingTags = existingFn.tags ?? [];
        // 如果已被标记为 component，追加 css-in-js 标签
        if (existingTags.includes('component')) {
          existingFn.tags = [...existingTags, 'css-in-js', def.library];
        } else {
          // 否则，标记为 css-in-js + styled-component
          existingFn.tags = [...existingTags, 'css-in-js', def.library, 'styled-component'];
        }
      } else {
        // CSS-in-JS 样式定义不在 functions 中（如 styled.button`...` 不是 arrow_function），
        // 需要手动添加到 functions 数组
        result.functions.push({
          name: def.name,
          lineRange: [def.lineNumber, def.lineNumber],
          params: [],
          tags: ['css-in-js', def.library, 'styled-component'],
        });
      }
    }

    // 5. 标记 imports 的 importKind
    this.markCssInJsImports(result, cssInJsLibraries);
  }

  /**
   * 检测项目中使用的 CSS-in-JS 库。
   *
   * 扫描 result.imports，将导入源与 CSS_IN_JS_IMPORT_SOURCES 映射匹配，
   * 返回库名到 specifier 列表的映射。
   */
  private detectCssInJsLibraries(result: StructuralAnalysis): Map<string, string[]> {
    const libraries = new Map<string, string[]>();

    for (const imp of result.imports) {
      for (const [lib, sources] of Object.entries(CSS_IN_JS_IMPORT_SOURCES)) {
        if ((sources as readonly string[]).includes(imp.source)) {
          if (!libraries.has(lib)) {
            libraries.set(lib, []);
          }
          libraries.get(lib)!.push(...imp.specifiers);
        }
      }
    }

    return libraries;
  }

  /**
   * 查找 CSS-in-JS 样式定义。
   *
   * 消歧策略：styled-components 和 Emotion 共享 styled.xxx API，
   * 需通过导入源区分。detectCssInJsLibraries() 已预先扫描导入，
   * 此处根据检测结果分别标记。
   *
   * 当两个库同时导入时，findStyledPatterns 会为每个 styled 调用
   * 根据其绑定的导入源确定所属库（详见 findStyledPatterns 实现）。
   */
  private findCssInJsDefinitions(
    rootNode: TreeSitterNode,
    libraries: Map<string, string[]>,
  ): CssInJsDefinition[] {
    const definitions: CssInJsDefinition[] = [];

    // styled-components / Emotion styled 模式
    // 两个库可能同时存在，需分别处理
    if (libraries.has('styled-components') || libraries.has('emotion')) {
      definitions.push(...this.findStyledPatterns(rootNode, libraries));
    }

    // Emotion css 模式
    if (libraries.has('emotion')) {
      definitions.push(...this.findEmotionCssPatterns(rootNode));
    }

    // styled-jsx 模式（优先通过导入检测，AST 标签检测作为辅助）
    if (libraries.has('styled-jsx')) {
      definitions.push(...this.findStyledJsxPatterns(rootNode));
    }

    // JSS/MUI 模式
    if (libraries.has('jss') || libraries.has('mui')) {
      definitions.push(...this.findJssMuiPatterns(rootNode, libraries));
    }

    return definitions;
  }

  /**
   * 查找 styled.xxx / styled(Comp) 模式。
   *
   * 消歧逻辑：当 styled-components 和 @emotion/styled 同时导入时，
   * 需确定每个 styled 调用绑定的是哪个导入源。
   *
   * 策略：
   * 1. 如果仅导入一个库，所有 styled 调用归属于该库
   * 2. 如果两个库同时导入，通过变量绑定关系确定：
   *    - import styled from 'styled-components' → styled 绑定到 styled-components
   *    - import styled from '@emotion/styled' → styled 绑定到 emotion
   *    - 如果使用了别名（import scStyled from 'styled-components'），
   *      通过 specifier 与 AST 中标识符的匹配来确定
   */
  private findStyledPatterns(
    rootNode: TreeSitterNode,
    libraries: Map<string, string[]>,
  ): CssInJsDefinition[] {
    const definitions: CssInJsDefinition[] = [];

    // 确定默认库：当仅有一个 styled 库时使用
    const hasStyledComponents = libraries.has('styled-components');
    const hasEmotionStyled = libraries.has('emotion') &&
      libraries.get('emotion')?.some(s => s.includes('styled')) === true;
    const defaultLib: 'styled-components' | 'emotion' | null =
      hasStyledComponents && !hasEmotionStyled ? 'styled-components' :
      hasEmotionStyled && !hasStyledComponents ? 'emotion' : null;

    /**
     * 根据标识符名确定 styled 所属库。
     *
     * 如果标识符不是 'styled'，可能是别名导入，
     * 检查 libraries 中是否有对应的 specifier。
     * 默认：styled 标识符使用 fallback（单库时确定，双库时默认 styled-components）
     */
    const resolveStyledLibrary = (
      identifierText: string,
      fallback: 'styled-components' | 'emotion' | null,
    ): 'styled-components' | 'emotion' => {
      if (identifierText !== 'styled') {
        // 检查 styled-components 的 specifier
        const scSpecifiers = libraries.get('styled-components') ?? [];
        if (scSpecifiers.includes(identifierText)) return 'styled-components';
        // 检查 emotion 的 specifier
        const emSpecifiers = libraries.get('emotion') ?? [];
        if (emSpecifiers.includes(identifierText)) return 'emotion';
      }
      // 默认：styled 标识符使用 fallback（单库时确定，双库时默认 styled-components）
      return fallback ?? 'styled-components';
    };

    traverse(rootNode, (node) => {
      if (node.type === 'call_expression') {
        const func = node.childForFieldName('function');
        if (!func) return;

        // 模式 1: styled.div`...` / styled.button`...`
        if (func.type === 'member_expression') {
          const object = func.childForFieldName('object');
          const property = func.childForFieldName('property');
          if (object?.text === 'styled' && property) {
            const parent = node.parent;
            if (parent?.type === 'variable_declarator') {
              const nameNode = parent.childForFieldName('name');
              if (nameNode) {
                definitions.push({
                  name: nameNode.text,
                  library: resolveStyledLibrary(object.text, defaultLib),
                  pattern: 'styled.xxx',
                  lineNumber: node.startPosition.row + 1,
                });
              }
            }
          }
        }

        // 模式 2: styled("div")`...` / styled(Comp)`...`
        if (func.type === 'identifier' && func.text === 'styled') {
          const args = node.childForFieldName('arguments');
          if (args && args.children.length > 0) {
            const firstArg = args.children.find(c => c.type !== ',' && c.type !== '(' && c.type !== ')');
            if (firstArg) {
              const parent = node.parent;
              // styled(Comp) 可能被外层 call_expression 包裹（模板字面量参数）
              let variableParent = parent;
              if (parent?.type === 'call_expression') {
                variableParent = parent.parent;
              }
              if (variableParent?.type === 'variable_declarator') {
                const nameNode = variableParent.childForFieldName('name');
                if (nameNode) {
                  const isComponent = /^[A-Z]/.test(firstArg.text);
                  definitions.push({
                    name: nameNode.text,
                    library: resolveStyledLibrary(func.text, defaultLib),
                    pattern: isComponent ? 'styled(Comp)' : 'styled("xxx")',
                    lineNumber: node.startPosition.row + 1,
                  });
                }
              }
            }
          }
        }

        // 模式 3: .attrs() 链式调用
        if (func.type === 'member_expression') {
          const property = func.childForFieldName('property');
          if (property?.text === 'attrs') {
            const obj = func.childForFieldName('object');
            if (obj?.type === 'call_expression') {
              // 向上查找 variable_declarator 获取名称
              const parent = node.parent;
              let variableParent = parent;
              if (parent?.type === 'call_expression') {
                variableParent = parent.parent;
              }
              if (variableParent?.type === 'variable_declarator') {
                const nameNode = variableParent.childForFieldName('name');
                if (nameNode) {
                  // 从内层 call_expression 的 function 中提取 styled 标识符
                  const innerFunc = obj.childForFieldName('function');
                  let styledIdentifier = '';
                  if (innerFunc?.type === 'member_expression') {
                    const innerObj = innerFunc.childForFieldName('object');
                    styledIdentifier = innerObj?.text ?? '';
                  } else if (innerFunc?.type === 'identifier') {
                    styledIdentifier = innerFunc.text;
                  }
                  definitions.push({
                    name: nameNode.text,
                    library: resolveStyledLibrary(styledIdentifier, defaultLib),
                    pattern: 'styled.attrs',
                    lineNumber: node.startPosition.row + 1,
                  });
                }
              }
            }
          }
        }
      }
    });

    return definitions;
  }

  /**
   * 查找 Emotion css 模板字面量模式。
   *
   * 检测:
   * 1. css`...` 模板字面量（从 @emotion/css 导入）
   * 2. css({...}) 对象样式
   * 3. css prop JSX 属性（需 Babel 插件支持）
   */
  private findEmotionCssPatterns(rootNode: TreeSitterNode): CssInJsDefinition[] {
    const definitions: CssInJsDefinition[] = [];

    traverse(rootNode, (node) => {
      if (node.type === 'call_expression') {
        const func = node.childForFieldName('function');
        if (func?.type === 'identifier' && func.text === 'css') {
          const parent = node.parent;
          if (parent?.type === 'variable_declarator') {
            const nameNode = parent.childForFieldName('name');
            if (nameNode) {
              definitions.push({
                name: nameNode.text,
                library: 'emotion',
                pattern: 'css',
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }
      }

      // css prop 模式: <div css={{...}}>
      if (node.type === 'jsx_attribute') {
        const nameNode = node.childForFieldName('name');
        if (nameNode?.text === 'css') {
          definitions.push({
            name: '<css-prop>',
            library: 'emotion',
            pattern: 'css-prop',
            lineNumber: node.startPosition.row + 1,
          });
        }
      }
    });

    return definitions;
  }

  /**
   * 查找 styled-jsx 模式。
   *
   * 检测策略：
   * 1. 优先检测 styled-jsx/css 导入的 css 标签模板（script 内可见）
   * 2. 辅助检测 <style jsx> JSX 标签（受限于 tree-sitter 是否解析 JSX 节点）
   */
  private findStyledJsxPatterns(rootNode: TreeSitterNode): CssInJsDefinition[] {
    const definitions: CssInJsDefinition[] = [];

    traverse(rootNode, (node) => {
      // 方式 1: styled-jsx/css 的 css 标签模板
      // import css from 'styled-jsx/css'
      // const styles = css`div { color: red }`
      if (node.type === 'call_expression') {
        const func = node.childForFieldName('function');
        if (func?.type === 'identifier' && func.text === 'css') {
          const parent = node.parent;
          if (parent?.type === 'variable_declarator') {
            const nameNode = parent.childForFieldName('name');
            if (nameNode) {
              definitions.push({
                name: nameNode.text,
                library: 'styled-jsx',
                pattern: 'css-tag',
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }
      }

      // 方式 2: <style jsx> JSX 标签（辅助检测）
      // 注意：TypeScriptExtractor 的 rootNode 可能不包含 JSX 元素节点
      if (node.type === 'jsx_opening_element') {
        const nameNode = node.childForFieldName('name');
        if (nameNode?.text === 'style') {
          // 检查是否有 jsx 属性
          const attributes = findChildren(node, 'jsx_attribute');
          const hasJsxAttr = attributes.some(attr => {
            const attrName = attr.childForFieldName('name');
            return attrName?.text === 'jsx';
          });
          const hasGlobalAttr = attributes.some(attr => {
            const attrName = attr.childForFieldName('name');
            return attrName?.text === 'global';
          });

          if (hasJsxAttr) {
            definitions.push({
              name: '<style jsx>',
              library: 'styled-jsx',
              pattern: hasGlobalAttr ? 'style-jsx-global' : 'style-jsx',
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }
    });

    return definitions;
  }

  /**
   * 查找 JSS/MUI 模式。
   *
   * 检测:
   * 1. makeStyles() — @mui/styles / react-jss
   * 2. createStyles() — @mui/styles / jss
   * 3. withStyles() — @mui/styles（HOC 风格）
   */
  private findJssMuiPatterns(
    rootNode: TreeSitterNode,
    libraries: Map<string, string[]>,
  ): CssInJsDefinition[] {
    const definitions: CssInJsDefinition[] = [];
    const isMui = libraries.has('mui');

    traverse(rootNode, (node) => {
      if (node.type === 'call_expression') {
        const func = node.childForFieldName('function');
        if (!func) return;

        const funcText = func.text;

        // makeStyles() 模式
        if (funcText === 'makeStyles') {
          const parent = node.parent;
          if (parent?.type === 'variable_declarator') {
            const nameNode = parent.childForFieldName('name');
            if (nameNode) {
              definitions.push({
                name: nameNode.text,
                library: isMui ? 'mui' : 'jss',
                pattern: 'makeStyles',
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }

        // createStyles() 模式
        if (funcText === 'createStyles') {
          definitions.push({
            name: 'createStyles',
            library: isMui ? 'mui' : 'jss',
            pattern: 'createStyles',
            lineNumber: node.startPosition.row + 1,
          });
        }

        // withStyles() 模式（HOC 风格）
        if (funcText === 'withStyles') {
          const args = node.childForFieldName('arguments');
          if (args) {
            definitions.push({
              name: 'withStyles',
              library: isMui ? 'mui' : 'jss',
              pattern: 'withStyles',
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }
    });

    return definitions;
  }

  /**
   * 标记 CSS-in-JS 相关导入的 importKind。
   */
  private markCssInJsImports(result: StructuralAnalysis, _libraries: Map<string, string[]>): void {
    for (const imp of result.imports) {
      for (const sources of Object.values(CSS_IN_JS_IMPORT_SOURCES)) {
        if ((sources as readonly string[]).includes(imp.source)) {
          imp.importKind = 'css-in-js';
          break;
        }
      }
    }
  }
}
