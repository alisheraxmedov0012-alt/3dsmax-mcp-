// Vite config for the GLB harness. Run from the repository root:
//   npx vite --config tools/glb-harness/vite.config.mjs
//
// `@repo` points at the repository root so the pages import the real export
// pipeline instead of a copy of it.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export default {
  root: here,
  server: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [here, repoRoot] },
    proxy: {
      '/artefakt': { target: 'http://127.0.0.1:5300', changeOrigin: true },
    },
  },
  resolve: {
    alias: { '@repo': repoRoot },
  },
  optimizeDeps: { exclude: ['three'] },
};
