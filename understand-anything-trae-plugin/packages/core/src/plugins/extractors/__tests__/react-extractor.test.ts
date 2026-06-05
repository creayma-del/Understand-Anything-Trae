import { describe, it, expect, beforeAll } from "vitest";
import { TreeSitterPlugin } from "../../tree-sitter-plugin.js";
import { ReactExtractor } from "../react-extractor.js";

describe("ReactExtractor", () => {
  let plugin: TreeSitterPlugin;

  beforeAll(async () => {
    // 使用 ReactExtractor 替代默认的 TypeScriptExtractor
    plugin = new TreeSitterPlugin(undefined, [new ReactExtractor()]);
    await plugin.init();
  });

  // REACT-001: 内置 hooks 识别
  it("REACT-001: 应识别从 react 导入的内置 hooks 并标记 importKind", () => {
    const code = `
import { useState, useEffect } from 'react';
function App() {
  const [x] = useState(0);
  useEffect(() => {}, []);
}
`;
    const result = plugin.analyzeFile("test.tsx", code);

    // useState/useEffect 是调用而非声明，不应出现在 functions 中
    const hookFns = result.functions.filter(f => f.name === 'useState' || f.name === 'useEffect');
    expect(hookFns).toHaveLength(0);

    // imports 中 react 导入的 importKind 应为 'hook'
    const reactImport = result.imports.find(imp => imp.source === 'react');
    expect(reactImport).toBeDefined();
    expect(reactImport!.importKind).toBe('hook');
  });

  // REACT-002: 自定义 hook 识别
  it("REACT-002: 应识别 use[A-Z] 命名的自定义 hook", () => {
    const code = `
function useCustomHook() {
  const [x] = useState(0);
  return x;
}
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const hookFn = result.functions.find(f => f.name === 'useCustomHook');
    expect(hookFn).toBeDefined();
    expect(hookFn!.tags).toContain('hook');
    expect(hookFn!.tags).toContain('custom-hook');
  });

  // REACT-003: 函数组件声明
  it("REACT-003: 应识别 PascalCase 函数返回 JSX 为函数组件", () => {
    const code = `
function MyComponent() {
  return <div />;
}
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const compFn = result.functions.find(f => f.name === 'MyComponent');
    expect(compFn).toBeDefined();
    expect(compFn!.tags).toContain('component');
    expect(compFn!.tags).toContain('function-component');
  });

  // REACT-004: 箭头函数组件
  it("REACT-004: 应识别 PascalCase 箭头函数返回 JSX 为函数组件", () => {
    const code = `
const MyComponent = () => <div />;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const compFn = result.functions.find(f => f.name === 'MyComponent');
    expect(compFn).toBeDefined();
    expect(compFn!.tags).toContain('component');
    expect(compFn!.tags).toContain('function-component');
  });

  // REACT-005: forwardRef 组件
  it("REACT-005: 应识别 forwardRef 包裹的组件", () => {
    const code = `
import { forwardRef } from 'react';
const MyInput = forwardRef((props, ref) => <input ref={ref} />);
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const compFn = result.functions.find(f => f.name === 'MyInput');
    expect(compFn).toBeDefined();
    expect(compFn!.tags).toContain('component');
    expect(compFn!.tags).toContain('function-component');
    expect(compFn!.tags).toContain('forward-ref');
  });

  // REACT-006: JSX 组件组合
  it("REACT-006: 应识别 JSX 中子组件引用并生成 contains 边", () => {
    const code = `
import Child from './Child';
function Parent() {
  return <Child />;
}
`;
    const callGraph = plugin.extractCallGraph("test.tsx", code);

    const containsEdge = callGraph.find(
      e => e.caller === 'Parent' && e.callee === 'Child' && e.relationType === 'contains',
    );
    expect(containsEdge).toBeDefined();
  });

  // REACT-007: 非 HTML 误判防护
  it("REACT-007: 不应为小写 HTML 标签生成 contains 边", () => {
    const code = `
function App() {
  return <div><span>text</span></div>;
}
`;
    const callGraph = plugin.extractCallGraph("test.tsx", code);

    const divEdge = callGraph.find(e => e.callee === 'div' && e.relationType === 'contains');
    const spanEdge = callGraph.find(e => e.callee === 'span' && e.relationType === 'contains');
    expect(divEdge).toBeUndefined();
    expect(spanEdge).toBeUndefined();
  });

  // REACT-008: Context 定义
  it("REACT-008: 应识别 createContext 调用并标记 context-definition", () => {
    const code = `
import { createContext } from 'react';
const ThemeContext = createContext('light');
`;
    const result = plugin.analyzeFile("test.tsx", code);

    // createContext 从 react 导入，但不在 REACT_HOOKS 中
    // identifyContextRelations 会将 importKind 标记为 'context'
    const reactImport = result.imports.find(imp => imp.source === 'react');
    expect(reactImport).toBeDefined();
    expect(reactImport!.importKind).toBe('context');
  });

  // REACT-009: Context 消费
  it("REACT-009: 应识别 useContext 调用并标记 context-consumer + depends_on 边", () => {
    const code = `
import { useContext } from 'react';
function App() {
  const theme = useContext(ThemeContext);
}
`;
    const result = plugin.analyzeFile("test.tsx", code);
    const callGraph = plugin.extractCallGraph("test.tsx", code);

    const appFn = result.functions.find(f => f.name === 'App');
    expect(appFn).toBeDefined();
    expect(appFn!.tags).toContain('context-consumer');

    const dependsEdge = callGraph.find(
      e => e.caller === 'App' && e.callee === 'ThemeContext' && e.relationType === 'depends_on',
    );
    expect(dependsEdge).toBeDefined();
  });

  // REACT-010: HOC 包装（memo）
  it("REACT-010: 应识别 memo 包裹的组件并生成 depends_on 边", () => {
    const code = `
import { memo } from 'react';
const MemoComp = memo(MyComponent);
`;
    const result = plugin.analyzeFile("test.tsx", code);
    const callGraph = plugin.extractCallGraph("test.tsx", code);

    // MemoComp 应被标记为 hoc-wrapped
    const memoFn = result.functions.find(f => f.name === 'MemoComp');
    expect(memoFn).toBeDefined();
    expect(memoFn!.tags).toContain('hoc-wrapped');

    // CallGraph 中应有 MyComponent -> memo 的 depends_on 边
    const dependsEdge = callGraph.find(
      e => e.caller === 'MyComponent' && e.callee === 'memo' && e.relationType === 'depends_on',
    );
    expect(dependsEdge).toBeDefined();
  });

  // REACT-011: HOC 包装（connect）
  it("REACT-011: 应识别 connect()() 双重调用模式并生成 depends_on 边", () => {
    const code = `
import { connect } from 'react-redux';
export default connect(mapState, mapDispatch)(MyComponent);
`;
    const callGraph = plugin.extractCallGraph("test.tsx", code);

    const dependsEdge = callGraph.find(
      e => e.caller === 'MyComponent' && e.callee === 'connect' && e.relationType === 'depends_on',
    );
    expect(dependsEdge).toBeDefined();
  });

  // REACT-012: 误判防护（PascalCase 工具函数）
  it("REACT-012: PascalCase 函数不返回 JSX 不应被标记为组件", () => {
    const code = `
function FormatDate() {
  return new Date().toString();
}
`;
    const result = plugin.analyzeFile("test.ts", code);

    const fn = result.functions.find(f => f.name === 'FormatDate');
    expect(fn).toBeDefined();
    expect(fn!.tags).toBeUndefined();
  });

  // REACT-013: 误判防护（use 前缀非 hook）
  it("REACT-013: use 前缀但非 use[A-Z] 模式不应被标记为 hook", () => {
    const code = `
function used() {
  return true;
}
`;
    const result = plugin.analyzeFile("test.ts", code);

    const fn = result.functions.find(f => f.name === 'used');
    expect(fn).toBeDefined();
    expect(fn!.tags).toBeUndefined();
  });

  // REACT-014: TypeScript React.FC 兼容性
  it("REACT-014: 应识别 React.FC 类型标注的组件", () => {
    const code = `
import React from 'react';
const MyComponent: React.FC<Props> = () => <div />;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const compFn = result.functions.find(f => f.name === 'MyComponent');
    expect(compFn).toBeDefined();
    expect(compFn!.tags).toContain('component');
    expect(compFn!.tags).toContain('function-component');
  });

  // REACT-015: 类组件识别
  it("REACT-015: 应识别 extends React.Component 的类组件", () => {
    const code = `
import React from 'react';
class MyComponent extends React.Component {
  render() {
    return <div />;
  }
}
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const cls = result.classes.find(c => c.name === 'MyComponent');
    expect(cls).toBeDefined();
    expect(cls!.tags).toContain('component');
    expect(cls!.tags).toContain('class-component');
  });

  // REACT-016: styled-components 基础识别（P1.8 更新）
  it("REACT-016: 应识别 styled.xxx 模式并标记 css-in-js 标签", () => {
    const code = `
import styled from 'styled-components';
const Button = styled.button\`color: red;\`;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    // P1.8: styled.button`...` 被识别为 CSS-in-JS 样式组件
    const btnFn = result.functions.find(f => f.name === 'Button');
    expect(btnFn).toBeDefined();
    expect(btnFn!.tags).toContain('css-in-js');
    expect(btnFn!.tags).toContain('styled-components');
    expect(btnFn!.tags).toContain('styled-component');
  });

  // REACT-017: emotion 识别（P1.8 更新）
  it("REACT-017: 应识别 @emotion/styled 和 @emotion/css 模式", () => {
    const code = `
import styled from '@emotion/styled';
import { css } from '@emotion/css';
const Button = styled.button\`color: red;\`;
const style = css\`color: blue\`;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    // P1.8: styled.button`...` 从 @emotion/styled 导入，标记为 emotion
    const btnFn = result.functions.find(f => f.name === 'Button');
    expect(btnFn).toBeDefined();
    expect(btnFn!.tags).toContain('css-in-js');
    expect(btnFn!.tags).toContain('emotion');
    expect(btnFn!.tags).toContain('styled-component');

    // P1.8: css`...` 模板字面量
    const styleFn = result.functions.find(f => f.name === 'style');
    expect(styleFn).toBeDefined();
    expect(styleFn!.tags).toContain('css-in-js');
    expect(styleFn!.tags).toContain('emotion');
  });

  // ---- CSS-in-JS 模式识别测试 (P1.8) ----

  // CIJ-001: styled-components 基础 (styled.div)
  it("CIJ-001: 应识别 styled-components 的 styled.xxx 模式并标记标签和 importKind", () => {
    const code = `
import styled from 'styled-components';
const Button = styled.button\`color: red;\`;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const btnFn = result.functions.find(f => f.name === 'Button');
    expect(btnFn).toBeDefined();
    expect(btnFn!.tags).toContain('css-in-js');
    expect(btnFn!.tags).toContain('styled-components');
    expect(btnFn!.tags).toContain('styled-component');

    const scImport = result.imports.find(imp => imp.source === 'styled-components');
    expect(scImport).toBeDefined();
    expect(scImport!.importKind).toBe('css-in-js');
  });

  // CIJ-002: styled-components 继承 (styled(Comp))
  it("CIJ-002: 应识别 styled(Comp) 继承模式", () => {
    const code = `
import styled from 'styled-components';
const BaseButton = styled.button\`color: red;\`;
const BlueButton = styled(BaseButton)\`color: blue;\`;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const baseFn = result.functions.find(f => f.name === 'BaseButton');
    expect(baseFn).toBeDefined();
    expect(baseFn!.tags).toContain('styled-components');

    const blueFn = result.functions.find(f => f.name === 'BlueButton');
    expect(blueFn).toBeDefined();
    expect(blueFn!.tags).toContain('styled-components');
    expect(blueFn!.tags).toContain('css-in-js');
  });

  // CIJ-003: Emotion css 模板字面量
  it("CIJ-003: 应识别 @emotion/css 的 css 模板字面量模式", () => {
    const code = `
import { css } from '@emotion/css';
const style = css\`color: blue;\`;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const styleFn = result.functions.find(f => f.name === 'style');
    expect(styleFn).toBeDefined();
    expect(styleFn!.tags).toContain('css-in-js');
    expect(styleFn!.tags).toContain('emotion');

    const emotionImport = result.imports.find(imp => imp.source === '@emotion/css');
    expect(emotionImport).toBeDefined();
    expect(emotionImport!.importKind).toBe('css-in-js');
  });

  // CIJ-004: Emotion styled (@emotion/styled)
  it("CIJ-004: 应识别 @emotion/styled 的 styled.xxx 模式（非 styled-components）", () => {
    const code = `
import styled from '@emotion/styled';
const Button = styled.button\`color: red;\`;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const btnFn = result.functions.find(f => f.name === 'Button');
    expect(btnFn).toBeDefined();
    expect(btnFn!.tags).toContain('css-in-js');
    expect(btnFn!.tags).toContain('emotion');
    expect(btnFn!.tags).toContain('styled-component');
    // 确保不是 styled-components 标签
    expect(btnFn!.tags).not.toContain('styled-components');

    const emotionImport = result.imports.find(imp => imp.source === '@emotion/styled');
    expect(emotionImport).toBeDefined();
    expect(emotionImport!.importKind).toBe('css-in-js');
  });

  // CIJ-005: styled-jsx (import from styled-jsx/css)
  it("CIJ-005: 应识别 styled-jsx/css 的 css 标签模板模式", () => {
    const code = `
import css from 'styled-jsx/css';
const styles = css\`div { color: red }\`;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const stylesFn = result.functions.find(f => f.name === 'styles');
    expect(stylesFn).toBeDefined();
    expect(stylesFn!.tags).toContain('css-in-js');
    expect(stylesFn!.tags).toContain('styled-jsx');

    const jsxImport = result.imports.find(imp => imp.source === 'styled-jsx/css');
    expect(jsxImport).toBeDefined();
    expect(jsxImport!.importKind).toBe('css-in-js');
  });

  // CIJ-006: JSS/MUI (makeStyles)
  it("CIJ-006: 应识别 @mui/styles 的 makeStyles 模式", () => {
    const code = `
import { makeStyles } from '@mui/styles';
const useStyles = makeStyles((theme) => ({ root: { color: theme.palette.primary } }));
`;
    const result = plugin.analyzeFile("test.tsx", code);

    const useStylesFn = result.functions.find(f => f.name === 'useStyles');
    expect(useStylesFn).toBeDefined();
    expect(useStylesFn!.tags).toContain('css-in-js');
    expect(useStylesFn!.tags).toContain('mui');

    const muiImport = result.imports.find(imp => imp.source === '@mui/styles');
    expect(muiImport).toBeDefined();
    expect(muiImport!.importKind).toBe('css-in-js');
  });

  // CIJ-007: 非 CSS-in-JS 误判防护
  it("CIJ-007: 非 CSS-in-JS 库的同名 API 不应被误标记", () => {
    const code = `
const styled = { button: 'btn' };
const Button = styled.button;
`;
    const result = plugin.analyzeFile("test.tsx", code);

    // 未从 CSS-in-JS 库导入 styled，不应标记 css-in-js 标签
    const btnFn = result.functions.find(f => f.name === 'Button');
    // styled.button 在此场景下不是 call_expression，不会被识别
    expect(btnFn?.tags?.includes('css-in-js')).toBeFalsy();
  });

  // 回归测试: 现有 TypeScript 提取行为不变
  describe("回归测试", () => {
    it("基础 TS 结构提取应保持不变", () => {
      const code = `
import { EventEmitter } from 'events';

function greet(name: string): string {
  return "Hello " + name;
}

class Calculator {
  add(n: number): number {
    return n;
  }
}
`;
      const result = plugin.analyzeFile("test.ts", code);

      expect(result.functions.some(f => f.name === 'greet')).toBe(true);
      expect(result.classes.some(c => c.name === 'Calculator')).toBe(true);
      expect(result.imports.some(imp => imp.source === 'events')).toBe(true);
    });

    it("非 React TS/JS 文件 tags/importKind/relationType 应为 undefined", () => {
      const code = `
function processData(data: string): number {
  return data.length;
}

const helper = (x: number) => x * 2;
`;
      const result = plugin.analyzeFile("test.ts", code);

      for (const fn of result.functions) {
        expect(fn.tags).toBeUndefined();
      }
      for (const imp of result.imports) {
        expect(imp.importKind).toBeUndefined();
      }

      const callGraph = plugin.extractCallGraph("test.ts", code);
      for (const entry of callGraph) {
        expect(entry.relationType).toBeUndefined();
      }
    });

    it("基础调用图提取应保持不变", () => {
      const code = `
function main() {
  const result = greet("World");
}

function greet(name: string): string {
  return formatMessage(name);
}
`;
      const callGraph = plugin.extractCallGraph("test.ts", code);

      const greetCall = callGraph.find(
        e => e.caller === 'main' && e.callee === 'greet',
      );
      expect(greetCall).toBeDefined();
      expect(greetCall!.relationType).toBeUndefined();
    });
  });
});
