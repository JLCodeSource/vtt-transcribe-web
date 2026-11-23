import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// transformers.js drags a 27 MB copy of the ORT wasm into the bundle that we never load
// (we serve it from /ort/ instead, see src/lib/local.ts): drop it from the output.
const dropBundledWasm = {
  name: 'drop-bundled-ort-wasm',
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const k of Object.keys(bundle)) if (/assets\/ort-wasm.*\.wasm$/.test(k)) delete bundle[k];
  },
};

export default defineConfig({
  plugins: [svelte(), dropBundledWasm],
  resolve: {
    conditions: ['browser', 'module', process.env.VITEST ? 'development' : 'production', 'default'],
  },
  server: { host: '0.0.0.0', port: 3000 },
  base: './', // relative asset URLs: works from any sub-path (e.g. GitHub Pages project sites)
  build: { outDir: 'dist', target: 'es2022' },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,svelte}'],
      exclude: ['src/__tests__/**'],
      reporter: ['text', 'html'],
    },
  },
});
