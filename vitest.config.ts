import { defineConfig } from 'vitest/config';

// Single-config aggregation for the whole monorepo. Picks up:
//   - tests/**                                          — relocated skill tests (out-of-plugin so they
//                                                         do not ship via the marketplace bundle)
//   - understand-anything-trae-plugin/src/**             — skill TS source tests
//   - understand-anything-trae-plugin/packages/dashboard/**  — dashboard utils tests
//
// The `@understand-anything-trae/core` package owns its own vitest.config.ts and is
// invoked separately via `pnpm --filter @understand-anything-trae/core test`; its
// files are excluded here to avoid double-counting.
export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.{js,mjs,ts}',
      'understand-anything-trae-plugin/src/**/*.test.{js,mjs,ts}',
      'understand-anything-trae-plugin/packages/dashboard/**/*.test.{js,mjs,ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'understand-anything-trae-plugin/packages/core/**',
    ],
  },
});
