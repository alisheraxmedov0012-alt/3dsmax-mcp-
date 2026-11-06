// Vite config for the Premium Desk product harness. Run from the repo root:
//   npx vite --config tools/product/vite.config.mjs
//
// `@repo` points at the repository root, so the page imports the shipped
// product fixture, scene, viewer and exporters instead of a copy.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export default {
  root: here,
  server: {
    port: 5299,
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [here, repoRoot] },
    proxy: {
      '/artefakt': { target: 'http://127.0.0.1:5401', changeOrigin: true },
    },
  },
  resolve: {
    alias: { '@repo': repoRoot },
  },
  optimizeDeps: { exclude: ['three'] },
};
