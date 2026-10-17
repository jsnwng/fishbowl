import { realpathSync } from 'node:fs';
import { defineConfig } from 'vite';

// Cross-origin isolation lifts performance.now() from 100µs to ~5µs resolution, which the
// per-frame cpu/sim timings need. Everything the app loads is same-origin, so it's safe.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // Resolve symlinks/redirected folders so the HTML entry and root agree (Windows app folders).
  root: realpathSync.native(process.cwd()),
  base: './',
  server: { headers: isolation },
  preview: { headers: isolation },
  build: {
    manifest: true,
    chunkSizeWarningLimit: 2000,
  },
});
