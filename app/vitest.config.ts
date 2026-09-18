import { defineConfig } from 'vitest/config';

// Node-only unit tests. Inline (empty) PostCSS config prevents vite from
// picking up unrelated postcss.config.mjs files in parent directories.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  css: {
    postcss: { plugins: [] },
  },
});
