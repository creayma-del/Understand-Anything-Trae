import { defineConfig } from 'vitest/config';

// The plugin package includes test files in src/__tests__/. This config
// includes that location so that `pnpm test` (which runs `vitest run`)
// discovers all tests.
export default defineConfig({
  test: {
    include: [
      'src/**/*.test.{ts,tsx,mjs}',
      'packages/core/src/**/*.test.{ts,tsx,mjs}',
    ],
  },
});
