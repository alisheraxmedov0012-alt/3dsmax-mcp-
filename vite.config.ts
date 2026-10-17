import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Unit tests run in Node. Component tests opt into jsdom per file with a
    // `// @vitest-environment jsdom` docblock, so the DOM library is only paid
    // for by the tests that need it.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
