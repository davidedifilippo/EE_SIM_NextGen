import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, open: false },
  worker: { format: 'es' },
  // 20 MB module with embedded WASM: pre-bundling it only slows the dev server down
  optimizeDeps: { exclude: ['eecircuit-engine'] },
});
