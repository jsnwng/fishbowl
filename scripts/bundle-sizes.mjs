// Reads Vite's build manifest and writes dist/renderers/bundle-sizes.json: gzip KB per renderer.
// A renderer's size = every chunk reachable from its adapter (static + lazy imports),
// minus chunks the app shell already loads. Lazy chunks are included, so libraries that
// split out optional renderers (pixi's WebGPU path, say) report an upper bound.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const dist = 'dist';
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'));

function closure(key, followDynamic, seen = new Set(), stop = new Set()) {
  if (seen.has(key) || stop.has(key)) return seen;
  seen.add(key);
  const m = manifest[key];
  for (const k of m.imports ?? []) closure(k, followDynamic, seen, stop);
  if (followDynamic) for (const k of m.dynamicImports ?? []) closure(k, followDynamic, seen, stop);
  return seen;
}

// The benchmark page; its own manifest key, since it lives at /renderers/.
const PAGE = 'renderers/index.html';
const shell = closure(PAGE, false);
const gz = (file) => gzipSync(readFileSync(join(dist, file))).length;

// The adapters are the app shell's lazy imports. Rollup sometimes merges an adapter into its
// library's chunk (pixi), which drops the src key, so name each one by its chunk file instead.
const out = {};
for (const key of manifest[PAGE].dynamicImports ?? []) {
  const m = /^assets\/(\w+)-[\w-]+\.js$/.exec(manifest[key].file);
  if (!m) continue;
  let bytes = 0;
  for (const k of closure(key, true, new Set(), shell)) {
    if (shell.has(k)) continue;
    const entry = manifest[k];
    bytes += gz(entry.file);
    for (const css of entry.css ?? []) bytes += gz(css);
  }
  out[m[1]] = Math.round(bytes / 102.4) / 10;
}

writeFileSync(join(dist, 'renderers', 'bundle-sizes.json'), JSON.stringify(out, null, 2));
console.log('gzip KB per renderer:', out);
