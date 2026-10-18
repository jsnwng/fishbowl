import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type BuildOptions, type Connect, type Plugin } from 'vite';

// Resolve symlinks/redirected folders so the HTML entry and root agree (Windows app folders).
const root = realpathSync.native(process.cwd());

// Cross-origin isolation lifts performance.now() from 100µs to ~5µs resolution, which the
// per-frame cpu/sim timings need. Everything the app loads is same-origin, so it's safe.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// The fisherman page is a second build (`--mode fisherman`) on top of the bench's dist/.
// Built together, Rollup would share pixi chunks between the pages and the bench's pixi
// bundle size would grow with whatever the game uses.
const fishermanBuild: BuildOptions = {
  emptyOutDir: false,
  manifest: false,
  assetsDir: 'fisherman/assets',
  chunkSizeWarningLimit: 2000,
  rollupOptions: { input: resolve(root, 'fisherman/index.html') },
};

// Without the trailing slash, Vite's SPA fallback serves the bench's index.html at /fisherman.
// Redirect it like a static host would (vercel.json does the same for the live site).
const toFisherman: Connect.NextHandleFunction = (req, res, next) => {
  const [path, query] = (req.url ?? '').split('?');
  if (path !== '/fisherman') return next();
  res.statusCode = 301;
  res.setHeader('Location', `/fisherman/${query ? `?${query}` : ''}`);
  res.end();
};
const fishermanSlash: Plugin = {
  name: 'fisherman-trailing-slash',
  configureServer: (server) => void server.middlewares.use(toFisherman),
  configurePreviewServer: (server) => void server.middlewares.use(toFisherman),
};

export default defineConfig(({ mode }) => ({
  root,
  base: './',
  plugins: [fishermanSlash],
  server: { headers: isolation },
  preview: { headers: isolation },
  build:
    mode === 'fisherman'
      ? fishermanBuild
      : {
          manifest: true,
          chunkSizeWarningLimit: 2000,
        },
}));
