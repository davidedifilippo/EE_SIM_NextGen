import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, open: false },
  worker: { format: 'es' },
  // 20 MB module with embedded WASM. It must stay pre-bundled: served as a plain module it
  // gets a 45 MB inline source map, and the first analysis on a tablet takes that much longer.
  optimizeDeps: { include: ['eecircuit-engine'] },
});
