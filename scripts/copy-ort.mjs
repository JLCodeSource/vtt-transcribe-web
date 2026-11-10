// Self-host the ONNX Runtime WebAssembly files so the page never fetches code from a CDN.
// (transformers.js otherwise loads them from cdn.jsdelivr.net at runtime.)
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const src = 'node_modules/onnxruntime-web/dist';
mkdirSync('public/ort', { recursive: true });
for (const f of readdirSync(src)) {
  if (/^ort-wasm-simd-threaded.*\.(mjs|wasm)$/.test(f)) cpSync(`${src}/${f}`, `public/ort/${f}`);
}
