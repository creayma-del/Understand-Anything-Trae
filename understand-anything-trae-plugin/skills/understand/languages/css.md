# CSS Language Prompt Snippet

## Key Concepts

- **Selectors**: Element, class (`.name`), ID (`#name`), attribute (`[attr]`), and pseudo-class (`:hover`) targeting
- **Specificity**: Inline > ID > Class > Element cascade priority determining which rules win
- **Box Model**: `margin`, `border`, `padding`, `content` dimensions controlling element sizing
- **Flexbox**: `display: flex` with `justify-content`, `align-items` for one-dimensional layouts
- **Grid**: `display: grid` with `grid-template-columns/rows` for two-dimensional layouts
- **Custom Properties (Variables)**: `--name: value` with `var(--name)` for reusable design tokens
- **Media Queries**: `@media (max-width: ...)` for responsive design breakpoints
- **SCSS/Sass Features**: Nesting, `$variables`, `@mixin`, `@include`, `@extend`, `@use`, `@forward`
- **CSS Modules**: Scoped class names (`.module.css`) preventing global style collisions
- **Cascade Layers**: `@layer` for explicit control over cascade ordering

## Notable File Patterns

- `*.css` — Standard CSS stylesheets
- `*.scss` / `*.sass` — Sass/SCSS preprocessor files
- `*.less` — Less preprocessor files
- `*.module.css` / `*.module.scss` — CSS Modules (scoped styles)
- `globals.css` / `reset.css` / `normalize.css` — Global base styles
- `tailwind.config.js` — Tailwind CSS configuration (though a JS file)
- `variables.scss` / `_variables.scss` — Design token definitions

## Edge Patterns

- CSS files are `related` to the HTML or component files that import them for styling
- SCSS partial files (`_*.scss`) are `depends_on` by the main stylesheet that `@use`s them
- CSS variable definition files are `related` to all stylesheets that reference those variables
- CSS Modules are `related` to the component files that import them

## SCSS/Sass Specifics

### Module System
- `@use 'module'` — loads a module and makes its members available as `module.$var` or `module.mixin()`
- `@use 'module' as *` — loads a module and makes its members available without namespace
- `@forward 'module'` — re-exports a module's members from the current file
- `@use` replaces the deprecated `@import` (which is global and causes duplication)

### Partial Files
- Files starting with `_` (e.g., `_variables.scss`) are partials — not compiled to CSS directly
- Partials are loaded via `@use 'variables'` (omit the `_` prefix and extension)
- Common partials: `_variables.scss`, `_mixins.scss`, `_functions.scss`, `_reset.scss`

### Built-in Functions
- `lighten()`, `darken()`, `adjust-hue()` — color manipulation
- `map-get()`, `map-merge()` — map operations
- `str-index()`, `str-insert()` — string operations
- `math.div()`, `math.round()` — math operations (Sass 1.33+)

### Sass Indented Syntax (.sass)
- Uses indentation instead of braces and semicolons
- Properties are declared as `property: value` (colon suffix, no semicolons). Note: The older `:property value` (colon prefix) syntax is deprecated.
- Same features as SCSS but different syntax

## Tailwind CSS Specifics

### Configuration
- `tailwind.config.js/ts` — defines content paths, theme extensions, plugins
- `@tailwind base;` / `@tailwind components;` / `@tailwind utilities;` — CSS entry directives
- `content: ['./src/**/*.{html,js,ts,jsx,tsx,vue,svelte}']` — purge configuration

### Utility Patterns
- `@apply` — inlines utility classes in custom CSS
- `theme()` — references theme values in custom CSS: `color: theme('colors.primary')`
- `@layer` — Tailwind uses cascade layers for base/components/utilities ordering
- Arbitrary values: `w-[100px]`, `text-[#1da1f2]`, `grid-cols-[repeat(4,1fr)]`

### Edge Patterns for Tailwind
- `tailwind.config.js` is `configures` all CSS files that use `@tailwind` directives
- Component files using utility classes are `related` to `tailwind.config.js`
- `@apply` usage creates `depends_on` edges to the Tailwind utility layer

## PostCSS Specifics

### Configuration
- `postcss.config.js/ts` — defines PostCSS plugins and their options
- `.postcssrc.js` / `.postcssrc.json` / `.postcssrc.yml` — alternative config formats
- Common plugins: `autoprefixer`, `postcss-preset-env`, `cssnano`, `tailwindcss`

### Edge Patterns for PostCSS
- `postcss.config.js` is `configures` all CSS files processed by the build pipeline
- PostCSS plugins transform CSS at build time — not visible in source code
- `postcss.config.js` often `depends_on` `tailwind.config.js` when using Tailwind as a PostCSS plugin

## Summary Style

> "Global stylesheet defining CSS custom properties for the design system color palette and typography."
> "Responsive layout styles with flexbox and grid for the dashboard page across 3 breakpoints."
> "SCSS partial defining shared mixins for spacing, shadows, and media query breakpoints."
