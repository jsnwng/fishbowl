import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type BuildOptions, type Connect, type Plugin } from 'vite';

// Resolve symlinks/redirected folders so the HTML entry and root agree (Windows app folders).
const root = realpathSync.native(process.cwd());

// Cross-origin isolation lifts performance.now() from 100µs to ~5µs resolution, which the
// per-frame cpu/sim timings need. Everything the app loads is same-origin, so it's safe.
// Only on the pages that time things (renderers, players). Not on /live/: there, isolation makes
// the chat model's WebAssembly use shared memory, and an iPhone ran out of memory loading it.
// vercel.json matches.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Each page is its own build on top of the bench's dist/. Built together, Rollup would share
// pixi chunks between pages and the bench's measured bundle sizes would move with them.
const builds: Record<string, BuildOptions> = {
  // `vite build`: the renderer benchmark. Its manifest feeds scripts/bundle-sizes.mjs.
  production: {
    manifest: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: resolve(root, 'renderers/index.html') },
  },
  // `vite build --mode players`: the fisherman game.
  players: {
    emptyOutDir: false,
    manifest: false,
    assetsDir: 'players/assets',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: resolve(root, 'players/index.html') },
  },
  // `vite build --mode live`: the fisherman streaming, with chat.
  live: {
    emptyOutDir: false,
    manifest: false,
    assetsDir: 'live/assets',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: resolve(root, 'live/index.html') },
  },
  // `vite build --mode story`: the home page at the root.
  story: {
    emptyOutDir: false,
    manifest: false,
    assetsDir: 'story/assets',
    rollupOptions: { input: resolve(root, 'index.html') },
  },
};

// Old and slash-less paths. Without these, Vite's SPA fallback would serve the story page
// at /players and friends. vercel.json does the same for the live site.
const REDIRECTS: Record<string, string> = {
  '/fisherman': '/players/',
  '/fisherman/': '/players/',
  '/fisherman/index.html': '/players/',
  '/renderers': '/renderers/',
  '/players': '/players/',
  '/live': '/live/',
};
const redirect: Connect.NextHandleFunction = (req, res, next) => {
  const [path, query] = (req.url ?? '').split('?');
  const to = REDIRECTS[path];
  if (!to) return next();
  res.statusCode = 301;
  res.setHeader('Location', `${to}${query ? `?${query}` : ''}`);
  res.end();
};
const isolate: Connect.NextHandleFunction = (req, res, next) => {
  if (/^\/(renderers|players)\//.test(req.url ?? '')) for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v);
  next();
};
const redirects: Plugin = {
  name: 'site-redirects',
  configureServer: (server) => void server.middlewares.use(redirect).use(isolate),
  configurePreviewServer: (server) => void server.middlewares.use(redirect).use(isolate),
};

export default defineConfig(({ mode }) => ({
  root,
  base: './',
  plugins: [redirects],
  build: builds[mode] ?? builds.production,
}));
