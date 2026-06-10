import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { TypeScriptExtractor } from "./typescript-extractor.js";
import { findChild, findChildren } from "./base-extractor.js";

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
 * Consolidated React patterns collected in a single AST walk.
 * Replaces 8+ separate full-AST traversals for better performance.
 */
interface ReactPatterns {
  createContextCalls: Array<{ name: string; lineNumber: number }>;
  useContextCalls: Array<{ contextName: string; parentFunction: string; lineNumber: number }>;
  jsxComponentRefs: Array<{ componentName: string; parentFunction: string; lineNumber: number }>;
  hocPatterns: Array<{ hocName: string; wrappedName: string; lineNumber: number; variableName?: string }>;
  forwardRefDeclarations: Array<{ name: string; lineRange: [number, number] }>;
  /** Function names whose body contains JSX return */
  functionsReturningJsx: Set<string>;
  /** Variable declarator names with React.FC type annotation */
  reactFcFunctions: Set<string>;
  /** Class names that extend React.Component or React.PureComponent */
  reactComponentClasses: Set<string>;
  cssInJsDefinitions: CssInJsDefinition[];
}

/**
 * React JSX 语义提取器。
 *
 * 继承 TypeScriptExtractor，在基础 TS/JS 结构提取之上
 * 增量分析 React 特有模式：hooks、组件、JSX 组合、Context、HOC。
 *
 * Performance: uses a single consolidated AST walk (collectReactPatterns)
 * instead of 8+ separate full-tree traversals.
 */
export class ReactExtractor extends TypeScriptExtractor implements LanguageExtractor {
  readonly languageIds = ['typescript', 'javascript'];

  /** Cached patterns from the current extraction run */
  private _patterns: ReactPatterns | null = null;

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    // 阶段 1: 调用父类提取基础结构
    const result = super.extractStructure(rootNode);

    // 阶段 1.5: 单次 AST 遍历收集所有 React 模式（替代 8+ 次独立遍历）
    this._patterns = this.collectReactPatterns(rootNode, result);

    // 阶段 2: 使用缓存数据分析 React 模式（无额外 AST 遍历）
    this.identifyHooks(result, rootNode);
    this.identifyComponents(result);
    this.identifyJsxComposition(result, rootNode);
    this.identifyContextRelations(result);
    this.identifyHocPatterns(result);
    // P1.8 新增: CSS-in-JS 模式识别
    this.identifyCssInJs(result);

    // Clear cache — each extraction gets a fresh AST rootNode from TreeSitterPlugin,
    // so cached patterns from a previous call would be stale.
    this._patterns = null;

    return result;
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    // 阶段 1: 调用父类提取基础调用图
    const entries = super.extractCallGraph(rootNode);

    // Lazy init: if extractStructure was not called first (e.g., standalone extractCallGraph),
    // collect patterns on demand with a minimal result for import-based detection.
    if (!this._patterns) {
      const minimalResult: StructuralAnalysis = {
        functions: [], classes: [], imports: [], exports: [],
      };
      this._patterns = this.collectReactPatterns(rootNode, minimalResult);
    }

    // 阶段 2: 使用缓存的 patterns（无额外 AST 遍历）
    this.addContainsEdges(entries);
    this.addDependsOnEdges(entries);

    // Clear cache after extraction complete
    this._patterns = null;

    return entries;
  }

  // ── Consolidated single-walk collector ──────────────────────────────

  /**
   * Single AST walk that collects all React-specific patterns.
   * Replaces: findCreateContextCalls, findUseContextCalls, findJsxComponentRefs,
   * findHocPatterns, identifyForwardRefComponents, functionReturnsJsx (per-fn),
   * hasReactFcAnnotation (per-fn), and CSS-in-JS finders.
   *
   * Uses a function stack to track the current enclosing function,
   * and a JSX-depth flag to know when we're inside JSX context.
   */
  private collectReactPatterns(rootNode: TreeSitterNode, result: StructuralAnalysis): ReactPatterns {
    const patterns: ReactPatterns = {
      createContextCalls: [],
      useContextCalls: [],
      jsxComponentRefs: [],
      hocPatterns: [],
      forwardRefDeclarations: [],
      functionsReturningJsx: new Set(),
      reactFcFunctions: new Set(),
      reactComponentClasses: new Set(),
      cssInJsDefinitions: [],
    };

    // Pre-detect CSS-in-JS libraries from imports (no AST walk needed)
    const cssInJsLibraries = this.detectCssInJsLibraries(result);
    const hasStyledLib = cssInJsLibraries.has('styled-components') || cssInJsLibraries.has('emotion');
    const hasEmotionLib = cssInJsLibraries.has('emotion');
    const hasStyledJsxLib = cssInJsLibraries.has('styled-jsx');
    const hasJssMuiLib = cssInJsLibraries.has('jss') || cssInJsLibraries.has('mui');
    const defaultStyledLib: 'styled-components' | 'emotion' | null =
      hasStyledLib ? (
        cssInJsLibraries.has('styled-components') && !cssInJsLibraries.has('emotion') ? 'styled-components' :
        cssInJsLibraries.has('emotion') && !cssInJsLibraries.has('styled-components') ? 'emotion' :
        'styled-components'
      ) : null;

    const functionStack: string[] = [];

    const resolveStyledLibrary = (
      identifierText: string,
      fallback: 'styled-components' | 'emotion' | null,
    ): 'styled-components' | 'emotion' => {
      if (identifierText !== 'styled') {
        const scSpecifiers = cssInJsLibraries.get('styled-components') ?? [];
        if (scSpecifiers.includes(identifierText)) return 'styled-components';
        const emSpecifiers = cssInJsLibraries.get('emotion') ?? [];
        if (emSpecifiers.includes(identifierText)) return 'emotion';
      }
      return fallback ?? 'styled-components';
    };

    const walk = (node: TreeSitterNode) => {
      const isFunctionLike =
        node.type === 'function_declaration' ||
        node.type === 'arrow_function' ||
        node.type === 'function_expression' ||
        node.type === 'method_definition';

      let pushedName = '';

      // ── Function stack management ──
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

      // ── call_expression patterns ──
      if (node.type === 'call_expression') {
        const func = node.childForFieldName('function');
        const funcText = func?.text ?? '';

        // createContext calls
        if (funcText === 'createContext' || funcText === 'React.createContext') {
          const parent = node.parent;
          if (parent?.type === 'variable_declarator') {
            const nameNode = parent.childForFieldName('name');
            if (nameNode) {
              patterns.createContextCalls.push({
                name: nameNode.text,
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }

        // useContext calls
        if (funcText === 'useContext' || funcText === 'React.useContext') {
          const args = node.childForFieldName('arguments');
          if (args) {
            const firstArg = args.children.find(c => c.type === 'identifier');
            if (firstArg) {
              patterns.useContextCalls.push({
                contextName: firstArg.text,
                parentFunction: functionStack[functionStack.length - 1] ?? '<module>',
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }

        // HOC patterns: memo(Component) / forwardRef(...)
        if (REACT_HOCS.has(funcText)) {
          const args = node.childForFieldName('arguments');
          if (args) {
            if (funcText === 'forwardRef') {
              // forwardRef: extract variable declarator name for component detection
              const parent = node.parent;
              if (parent?.type === 'variable_declarator') {
                const nameNode = parent.childForFieldName('name');
                if (nameNode) {
                  patterns.forwardRefDeclarations.push({
                    name: nameNode.text,
                    lineRange: [parent.startPosition.row + 1, parent.endPosition.row + 1],
                  });
                }
              }
            } else {
              // memo(Component): extract wrapped component name + variable name
              const firstArg = args.children.find(c => c.type === 'identifier');
              if (firstArg && /^[A-Z]/.test(firstArg.text)) {
                // Check if assigned to a variable: const MemoComp = memo(...)
                let variableName: string | undefined;
                const parent = node.parent;
                if (parent?.type === 'variable_declarator') {
                  const nameNode = parent.childForFieldName('name');
                  if (nameNode) variableName = nameNode.text;
                }
                patterns.hocPatterns.push({
                  hocName: funcText,
                  wrappedName: firstArg.text,
                  lineNumber: node.startPosition.row + 1,
                  variableName,
                });
              }
            }
          }
        }

        // Arbitrary HOC: withRouter(Component) etc.
        if (/^[a-z]/.test(funcText) && !REACT_HOOKS.has(funcText) && !REACT_HOCS.has(funcText)) {
          const args = node.childForFieldName('arguments');
          if (args) {
            const firstArg = args.children.find(c => c.type === 'identifier' && /^[A-Z]/.test(c.text));
            if (firstArg) {
              let variableName: string | undefined;
              const parent = node.parent;
              if (parent?.type === 'variable_declarator') {
                const nameNode = parent.childForFieldName('name');
                if (nameNode) variableName = nameNode.text;
              }
              patterns.hocPatterns.push({
                hocName: funcText,
                wrappedName: firstArg.text,
                lineNumber: node.startPosition.row + 1,
                variableName,
              });
            }
          }
        }

        // Double-call HOC: connect(mapStateToProps)(Component)
        if (func?.type === 'call_expression') {
          const outerArgs = node.childForFieldName('arguments');
          if (outerArgs) {
            const component = outerArgs.children.find(c => c.type === 'identifier' && /^[A-Z]/.test(c.text));
            if (component) {
              const innerFunc = func.childForFieldName('function');
              if (innerFunc) {
                let variableName: string | undefined;
                const parent = node.parent;
                if (parent?.type === 'variable_declarator') {
                  const nameNode = parent.childForFieldName('name');
                  if (nameNode) variableName = nameNode.text;
                }
                patterns.hocPatterns.push({
                  hocName: innerFunc.text,
                  wrappedName: component.text,
                  lineNumber: node.startPosition.row + 1,
                  variableName,
                });
              }
            }
          }
        }

        // ── CSS-in-JS call expressions ──
        if (hasStyledLib) {
          // styled.div`...` / styled.button`...`
          if (func?.type === 'member_expression') {
            const object = func.childForFieldName('object');
            const property = func.childForFieldName('property');
            if (object?.text === 'styled' && property) {
              const parent = node.parent;
              if (parent?.type === 'variable_declarator') {
                const nameNode = parent.childForFieldName('name');
                if (nameNode) {
                  patterns.cssInJsDefinitions.push({
                    name: nameNode.text,
                    library: resolveStyledLibrary(object.text, defaultStyledLib),
                    pattern: 'styled.xxx',
                    lineNumber: node.startPosition.row + 1,
                  });
                }
              }
            }

            // .attrs() chain
            if (property?.text === 'attrs') {
              const obj = func.childForFieldName('object');
              if (obj?.type === 'call_expression') {
                const parent = node.parent;
                let variableParent = parent;
                if (parent?.type === 'call_expression') {
                  variableParent = parent.parent;
                }
                if (variableParent?.type === 'variable_declarator') {
                  const nameNode = variableParent.childForFieldName('name');
                  if (nameNode) {
                    const innerFunc = obj.childForFieldName('function');
                    let styledIdentifier = '';
                    if (innerFunc?.type === 'member_expression') {
                      styledIdentifier = innerFunc.childForFieldName('object')?.text ?? '';
                    } else if (innerFunc?.type === 'identifier') {
                      styledIdentifier = innerFunc.text;
                    }
                    patterns.cssInJsDefinitions.push({
                      name: nameNode.text,
                      library: resolveStyledLibrary(styledIdentifier, defaultStyledLib),
                      pattern: 'styled.attrs',
                      lineNumber: node.startPosition.row + 1,
                    });
                  }
                }
              }
            }
          }

          // styled("div")`...` / styled(Comp)`...`
          if (func?.type === 'identifier' && func.text === 'styled') {
            const args = node.childForFieldName('arguments');
            if (args && args.children.length > 0) {
              const firstArg = args.children.find(c => c.type !== ',' && c.type !== '(' && c.type !== ')');
              if (firstArg) {
                const parent = node.parent;
                let variableParent = parent;
                if (parent?.type === 'call_expression') {
                  variableParent = parent.parent;
                }
                if (variableParent?.type === 'variable_declarator') {
                  const nameNode = variableParent.childForFieldName('name');
                  if (nameNode) {
                    const isComponent = /^[A-Z]/.test(firstArg.text);
                    patterns.cssInJsDefinitions.push({
                      name: nameNode.text,
                      library: resolveStyledLibrary(func.text, defaultStyledLib),
                      pattern: isComponent ? 'styled(Comp)' : 'styled("xxx")',
                      lineNumber: node.startPosition.row + 1,
                    });
                  }
                }
              }
            }
          }
        }

        // Emotion css`...` / css({...})
        if (hasEmotionLib && func?.type === 'identifier' && func.text === 'css') {
          const parent = node.parent;
          if (parent?.type === 'variable_declarator') {
            const nameNode = parent.childForFieldName('name');
            if (nameNode) {
              patterns.cssInJsDefinitions.push({
                name: nameNode.text,
                library: 'emotion',
                pattern: 'css',
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }

        // styled-jsx css tag template
        if (hasStyledJsxLib && func?.type === 'identifier' && func.text === 'css') {
          const parent = node.parent;
          if (parent?.type === 'variable_declarator') {
            const nameNode = parent.childForFieldName('name');
            if (nameNode) {
              patterns.cssInJsDefinitions.push({
                name: nameNode.text,
                library: 'styled-jsx',
                pattern: 'css-tag',
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }

        // JSS/MUI: makeStyles, createStyles, withStyles
        if (hasJssMuiLib) {
          const isMui = cssInJsLibraries.has('mui');
          if (funcText === 'makeStyles' || funcText === 'createStyles' || funcText === 'withStyles') {
            const parent = node.parent;
            if (parent?.type === 'variable_declarator') {
              const nameNode = parent.childForFieldName('name');
              if (nameNode) {
                patterns.cssInJsDefinitions.push({
                  name: nameNode.text,
                  library: isMui ? 'mui' : 'jss',
                  pattern: funcText,
                  lineNumber: node.startPosition.row + 1,
                });
              }
            } else if (funcText === 'createStyles' || funcText === 'withStyles') {
              patterns.cssInJsDefinitions.push({
                name: funcText,
                library: isMui ? 'mui' : 'jss',
                pattern: funcText,
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
        }
      }

      // ── JSX component references ──
      if (node.type === 'jsx_self_closing_element' || node.type === 'jsx_opening_element') {
        const nameNode = node.childForFieldName('name');
        if (nameNode && /^[A-Z]/.test(nameNode.text)) {
          patterns.jsxComponentRefs.push({
            componentName: nameNode.text,
            parentFunction: functionStack[functionStack.length - 1] ?? '<module>',
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      // ── JSX element presence (for functionReturnsJsx detection) ──
      if (
        (node.type === 'jsx_element' || node.type === 'jsx_self_closing_element' || node.type === 'jsx_fragment') &&
        functionStack.length > 0
      ) {
        patterns.functionsReturningJsx.add(functionStack[functionStack.length - 1]);
      }

      // ── React.FC type annotation detection ──
      if (node.type === 'variable_declarator') {
        const typeAnnotation = findChild(node, 'type_annotation');
        if (typeAnnotation) {
          const text = typeAnnotation.text;
          if (/React\.(FC|FunctionComponent|SFC)/.test(text)) {
            const nameNode = node.childForFieldName('name');
            if (nameNode) {
              patterns.reactFcFunctions.add(nameNode.text);
            }
          }
        }
      }

      // ── Class component detection (extends React.Component / PureComponent) ──
      if (node.type === 'class_declaration') {
        const heritage = findChild(node, 'class_heritage');
        if (heritage) {
          const text = heritage.text;
          if (/React\.(Component|PureComponent)|extends\s+(Component|PureComponent)/.test(text)) {
            const nameNode = node.children.find(c => c.type === 'type_identifier' || c.type === 'identifier');
            if (nameNode) {
              patterns.reactComponentClasses.add(nameNode.text);
            }
          }
        }
      }

      // ── Emotion css prop: <div css={{...}}> ──
      if (hasEmotionLib && node.type === 'jsx_attribute') {
        const nameNode = node.childForFieldName('name');
        if (nameNode?.text === 'css') {
          patterns.cssInJsDefinitions.push({
            name: '<css-prop>',
            library: 'emotion',
            pattern: 'css-prop',
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      // ── styled-jsx: <style jsx> ──
      if (hasStyledJsxLib && node.type === 'jsx_opening_element') {
        const nameNode = node.childForFieldName('name');
        if (nameNode?.text === 'style') {
          const attributes = findChildren(node, 'jsx_attribute');
          const hasJsxAttr = attributes.some(attr => attr.childForFieldName('name')?.text === 'jsx');
          const hasGlobalAttr = attributes.some(attr => attr.childForFieldName('name')?.text === 'global');
          if (hasJsxAttr) {
            patterns.cssInJsDefinitions.push({
              name: '<style jsx>',
              library: 'styled-jsx',
              pattern: hasGlobalAttr ? 'style-jsx-global' : 'style-jsx',
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }

      // ── Recurse children ──
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }

      if (pushedName) functionStack.pop();
    };

    walk(rootNode);
    return patterns;
  }

  // ---- React 模式识别方法 (now use cached _patterns, no AST traversal) ----

  /**
   * 识别 hooks 调用模式。
   * No AST traversal needed — only inspects result.functions and result.imports.
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
   * Uses cached _patterns for JSX-return and React.FC checks — no per-function AST traversal.
   */
  private identifyComponents(result: StructuralAnalysis): void {
    const patterns = this._patterns!;

    for (const fn of result.functions) {
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(fn.name)) continue;

      // 检查是否已被标记为 hook（组件和 hook 互斥）
      if (fn.tags?.includes('hook')) continue;

      // 规则 1: PascalCase + 返回 JSX（从缓存数据查找，无 AST 遍历）
      if (patterns.functionsReturningJsx.has(fn.name)) {
        fn.tags = [...(fn.tags ?? []), 'component', 'function-component'];
        continue;
      }

      // 规则 2: React.FC 类型标注（从缓存数据查找，无 AST 遍历）
      if (patterns.reactFcFunctions.has(fn.name)) {
        fn.tags = [...(fn.tags ?? []), 'component', 'function-component'];
        continue;
      }
    }

    // 规则 3: forwardRef 包裹（从缓存数据查找，无 AST 遍历）
    for (const fwd of patterns.forwardRefDeclarations) {
      const existingFn = result.functions.find(fn => fn.name === fwd.name);
      if (existingFn) {
        existingFn.tags = [...(existingFn.tags ?? []), 'component', 'function-component', 'forward-ref'];
      } else {
        result.functions.push({
          name: fwd.name,
          lineRange: fwd.lineRange,
          params: [],
          tags: ['component', 'function-component', 'forward-ref'],
        });
      }
    }

    // 规则 4: 类组件（从缓存数据查找，无 AST 遍历）
    for (const cls of result.classes) {
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(cls.name)) continue;
      if (patterns.reactComponentClasses.has(cls.name)) {
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
   * No-op — handled by extractCallGraph's addContainsEdges using cached patterns.
   */
  private identifyJsxComposition(_result: StructuralAnalysis, _rootNode: TreeSitterNode): void {
    // 由 extractCallGraph 中的 addContainsEdges 处理
  }

  /**
   * 识别 Context 关系。
   * Uses cached _patterns — no AST traversal.
   */
  private identifyContextRelations(result: StructuralAnalysis): void {
    const patterns = this._patterns!;

    // 3. 标记函数
    for (const fn of result.functions) {
      // 检查函数体内是否包含 createContext
      for (const ctx of patterns.createContextCalls) {
        if (ctx.lineNumber >= fn.lineRange[0] && ctx.lineNumber <= fn.lineRange[1]) {
          fn.tags = [...(fn.tags ?? []), 'context-definition'];
        }
      }
      // 检查函数体内是否包含 useContext
      for (const consumer of patterns.useContextCalls) {
        if (consumer.lineNumber >= fn.lineRange[0] && consumer.lineNumber <= fn.lineRange[1]) {
          fn.tags = [...(fn.tags ?? []), 'context-consumer'];
        }
      }
    }

    // 4. 标记 Context 相关导入（不覆盖已设置的 importKind）
    const contextNames = new Set(patterns.createContextCalls.map(c => c.name));
    for (const imp of result.imports) {
      if (imp.importKind) continue;
      const contextSpecifiers = imp.specifiers.filter(s => contextNames.has(s) || /Context$/.test(s));
      if (contextSpecifiers.length > 0 && contextSpecifiers.length === imp.specifiers.length) {
        imp.importKind = 'context';
      }
    }
  }

  /**
   * 识别 HOC 包装模式。
   * Uses cached _patterns — no AST traversal.
   */
  private identifyHocPatterns(result: StructuralAnalysis): void {
    const patterns = this._patterns!;

    for (const hoc of patterns.hocPatterns) {
      let foundInFunctions = false;

      // The effective name is the variable the HOC result is assigned to,
      // or the wrapped component name if not assigned (e.g., export default memo(Comp))
      const effectiveName = hoc.variableName ?? hoc.wrappedName;

      // 在 exports 中查找被 HOC 包装的组件
      for (const exp of result.exports) {
        if (exp.lineNumber === hoc.lineNumber) {
          for (const fn of result.functions) {
            if (fn.name === hoc.wrappedName || fn.name === effectiveName) {
              fn.tags = [...(fn.tags ?? []), 'hoc-wrapped'];
              foundInFunctions = true;
            }
          }
        }
      }

      // 在变量声明中查找被 HOC 包装的组件
      for (const fn of result.functions) {
        if ((fn.name === hoc.wrappedName || fn.name === effectiveName) &&
            hoc.lineNumber >= fn.lineRange[0] && hoc.lineNumber <= fn.lineRange[1]) {
          fn.tags = [...(fn.tags ?? []), 'hoc-wrapped'];
          foundInFunctions = true;
        }
      }

      // Also check by exact variable name match
      if (!foundInFunctions && hoc.variableName) {
        const byVarName = result.functions.find(fn => fn.name === hoc.variableName);
        if (byVarName) {
          byVarName.tags = [...(byVarName.tags ?? []), 'hoc-wrapped'];
          foundInFunctions = true;
        }
      }

      // HOC 包装的变量可能不在 functions 中 — 用 variableName（如有）或 wrappedName 添加
      if (!foundInFunctions) {
        result.functions.push({
          name: effectiveName,
          lineRange: [hoc.lineNumber, hoc.lineNumber],
          params: [],
          tags: ['hoc-wrapped'],
        });
      }
    }

    // 标记 HOC 相关导入（不覆盖已设置的 importKind）
    const hocNames = new Set(patterns.hocPatterns.map(h => h.hocName));
    for (const imp of result.imports) {
      if (imp.importKind) continue;
      const hocSpecifiers = imp.specifiers.filter(s => hocNames.has(s) || REACT_HOCS.has(s));
      if (hocSpecifiers.length > 0 && hocSpecifiers.length === imp.specifiers.length) {
        imp.importKind = 'hoc';
      }
    }
  }

  // ---- CallGraph 关系边扩展 (now use cached _patterns) ----

  /**
   * 添加 contains 边（父组件 -> 子组件）
   * Uses cached _patterns — no AST traversal.
   */
  private addContainsEdges(entries: CallGraphEntry[]): void {
    for (const ref of this._patterns!.jsxComponentRefs) {
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
   * Uses cached _patterns — no AST traversal.
   */
  private addDependsOnEdges(entries: CallGraphEntry[]): void {
    // Context depends_on 边
    for (const consumer of this._patterns!.useContextCalls) {
      entries.push({
        caller: consumer.parentFunction,
        callee: consumer.contextName,
        lineNumber: consumer.lineNumber,
        relationType: 'depends_on',
      });
    }

    // HOC depends_on 边
    for (const hoc of this._patterns!.hocPatterns) {
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

  // ---- CSS-in-JS 模式识别 (now uses cached _patterns) ----

  /**
   * 识别 CSS-in-JS 模式。
   * Uses cached _patterns — no AST traversal.
   */
  private identifyCssInJs(result: StructuralAnalysis): void {
    const patterns = this._patterns!;
    if (patterns.cssInJsDefinitions.length === 0) return;

    // Mark functions and add CSS-in-JS definitions
    for (const def of patterns.cssInJsDefinitions) {
      const existingFn = result.functions.find(fn => fn.name === def.name);
      if (existingFn) {
        const existingTags = existingFn.tags ?? [];
        if (existingTags.includes('component')) {
          existingFn.tags = [...existingTags, 'css-in-js', def.library];
        } else {
          existingFn.tags = [...existingTags, 'css-in-js', def.library, 'styled-component'];
        }
      } else {
        result.functions.push({
          name: def.name,
          lineRange: [def.lineNumber, def.lineNumber],
          params: [],
          tags: ['css-in-js', def.library, 'styled-component'],
        });
      }
    }

    // Mark CSS-in-JS imports
    this.markCssInJsImports(result);
  }

  /**
   * 检测项目中使用的 CSS-in-JS 库。
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
   * 标记 CSS-in-JS 相关导入的 importKind。
   */
  private markCssInJsImports(result: StructuralAnalysis): void {
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
