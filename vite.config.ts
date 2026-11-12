import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The ngspice worker carries its WASM inside, 20 MB. It is not downloaded on install, which would cost
 * that much data to whoever only looks: it is kept the first time the page loads it, so the precise
 * analysis works offline from then on.
 */
const NGSPICE_WORKER = /\/assets\/ngspice\.worker-[\w-]+\.js$/;

/** The edition with the breadboard is published in a folder of the main one, and installs as an app of its own. */
const IS_BREADBOARD = process.env.VITE_EDITION === 'breadboard';

export default defineConfig({
  plugins: [
    react(),
    // Installable and usable offline. Only on a secure page (HTTPS or localhost): on a plain address in
    // the local network the browser does not run the service worker, and the app works as before.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: IS_BREADBOARD ? 'EE_SIM Breadboard' : 'EE_SIM_NextGen',
        short_name: IS_BREADBOARD ? 'EE_SIM BB' : 'EE_SIM',
        description: 'Simulatore di circuiti elettronici nel browser',
        lang: 'it',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#06152f',
        theme_color: '#06152f',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        globIgnores: ['**/ngspice.worker-*.js'],
        runtimeCaching: [
          {
            // A pattern, not a function: the service worker is a separate file, and a function would lose what it refers to
            urlPattern: NGSPICE_WORKER,
            handler: 'CacheFirst',
            // One version only: a new build has a new name, and the old one would stay for nothing
            options: { cacheName: 'ngspice', expiration: { maxEntries: 1 } },
          },
        ],
        // A new version takes over at the next opening, without waiting for every tab to close
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // A shared circuit travels after #, which never reaches the server: the cached page opens it
        navigateFallback: 'index.html',
        // The other edition lives in a folder of this one, with a page and a service worker of its own
        ...(IS_BREADBOARD ? {} : { navigateFallbackDenylist: [/\/breadboard\//] }),
      },
    }),
  ],
  base: './',
  server: { port: 5173, open: false },
  worker: { format: 'es' },
  // 20 MB module with embedded WASM. It must stay pre-bundled: served as a plain module it
  // gets a 45 MB inline source map, and the first analysis on a tablet takes that much longer.
  optimizeDeps: { include: ['eecircuit-engine'] },
});
