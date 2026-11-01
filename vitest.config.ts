import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // UI tests opt into jsdom per file with `@vitest-environment jsdom`.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
  },
});
