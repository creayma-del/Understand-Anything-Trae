# CSS-in-JS Language Prompt Snippet

## Key Concepts

- **CSS-in-JS**: A styling technique where CSS is written in JavaScript, enabling dynamic styling, scoping, and co-location of styles with components
- **styled-components**: Tagged template literal API (`styled.xxx`) that generates React components with scoped styles; supports theming via `ThemeProvider`, props-based dynamic styles, and component inheritance via `styled(Comp)`
- **Emotion**: Flexible CSS-in-JS library with multiple APIs — `styled` (similar to styled-components), `css` template literal / object styles, and the `css` JSX prop; supports framework-agnostic usage via `@emotion/css`
- **styled-jsx**: Built-in CSS-in-JS for Next.js; uses `<style jsx>` tags inside JSX for scoped styles and `<style jsx global>` for global styles; full CSS syntax support
- **JSS**: JavaScript-to-CSS compiler using object notation; `createStyles()` for type-safe style definitions; powers MUI's legacy styling API
- **MUI Styles**: Material-UI's JSS-based styling API (`makeStyles`, `withStyles`, `createStyles`); deprecated in MUI v5+ in favor of the `sx` prop and `tss-react`
- **Theming**: CSS-in-JS libraries provide theme context (`ThemeProvider`) for consistent design tokens across components
- **Dynamic Styles**: Props-driven style computation (e.g., `color: ${props => props.primary ? 'blue' : 'gray'}`)
- **Style Composition**: Combining multiple style definitions via composition patterns (e.g., `styled(StyledComp)` for inheritance, Emotion's composition with `css`)

## Notable File Patterns

- `*.styles.ts` — Style definition files (common in Emotion/JSS projects)
- `*.styled.ts` — styled-components definition files
- `styles/` — Directory containing style definitions
- `theme.ts` / `theme.tsx` — Theme configuration files
- `useStyles.ts` — Custom hook files for JSS/MUI makeStyles
- `*.emotion.ts` — Emotion-specific style files

## Edge Patterns

- `styled.div` creates a `styled-component` that is both a React component and a style definition — `contains` edge to rendered elements, `depends_on` edge to theme context (inferred by file-analyzer from tags)
- `styled(ExistingComponent)` creates a `styled-component` with an `inherits` edge to `ExistingComponent` (inferred by file-analyzer from tags)
- `css` template literal from Emotion creates a style definition — `depends_on` edge to the consuming component (inferred by file-analyzer from tags)
- `<style jsx>` inside a component creates a `depends_on` edge from the component to its scoped styles (inferred by file-analyzer from tags)
- `makeStyles()` creates a style hook — `depends_on` edge from the consuming component to the style definition, and to the theme if used (inferred by file-analyzer from tags)
- `withStyles()` is both a HOC and a style definition — `depends_on` edge to the style definition and `hoc-wrapped` tag on the wrapped component (inferred by file-analyzer from tags)
- `ThemeProvider` creates a `context-definition` for the theme — `depends_on` edges from styled-components that consume theme values (inferred by file-analyzer from tags)
- `.attrs()` on a styled-component creates a `related` edge to the attribute configuration (inferred by file-analyzer from tags)
- CSS-in-JS imports (`styled-components`, `@emotion/styled`, etc.) are marked with `importKind: 'css-in-js'` — file-analyzer uses this to infer library dependency edges

## Summary Style

> "styled-component defining a Button with primary/secondary variants, consumes theme colors via props-based dynamic styles."
> "Emotion css prop usage in a form component, applying dynamic validation styles based on field state."
> "styled-jsx scoped styles for a Next.js page component, using global theme variables via :global() selector."
> "MUI makeStyles hook defining table row styles with theme-based spacing and color tokens."
