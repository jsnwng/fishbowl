# fishbowl

An 8-bit aquarium for benchmarking 2d web renderers.

![pixel-art fish swimming over seaweed, rocks and a treasure chest](docs/bowl.png)

the same seeded fish swim through the same frames under six renderers. add fish until it lags, run timed tests, compare the numbers.

## Renderers

| renderer | how it draws the bowl |
|---|---|
| canvas2d | raw `drawImage` per fish. the baseline. |
| webgl | raw webgl2, every fish in one instanced draw call. |
| pixi | pixijs v8, one `Sprite` per fish. |
| konva | konva scene graph on canvas2d, one cropped `Konva.Image` per fish. |
| two | two.js on its webgl renderer, `Two.Sprite` per fish. |
| p5 | p5.js v1 in instance mode. |

each one is a small adapter behind the same interface (`init`, `setCount`, `update`, `render`, `destroy`), loaded with a dynamic import so it's its own bundle chunk. the bench drives every renderer from one `requestAnimationFrame` loop, never the library's own ticker.

## Benchmark

- **run 10s**: 2s warmup, then 10s measured at the current fish count.
- **ramp**: start at 500 fish, ×1.25 every 2s, stop when p95 frame time passes 18ms. reports the most fish that held.
- **run all / ramp all**: every renderer in turn, torn down in between.

measured per run: avg fps, p50 / p95 / p99 frame time, dropped frames (against the detected refresh rate), cpu time per frame, sim time, load + init + first frame, js heap peak and leak after teardown, gzip size per renderer. results save locally and export as json or csv.

kept fair on purpose:

- the sim advances one fixed tick per frame from a seeded rng, so every renderer is handed identical frames.
- fish flee the cursor in free play, but live input is switched off during runs.
- the dev server sends cross-origin isolation headers, so `performance.now()` resolves to ~5µs instead of 100µs.

## The Art

no image files. the fish are ascii pixel maps in [`src/sprites.ts`](src/sprites.ts), five species from three hand-drawn shapes plus palette swaps. tail-wag frames and left-facing versions are generated, then everything is packed into one sprite atlas all six renderers share. the scenery in [`src/scenery.ts`](src/scenery.ts) is painted in code too.

## Run it

```bash
npm install
npm run dev
```

for numbers worth comparing, use the production build (it also writes the gzip sizes):

```bash
npm run build
npm run preview
```

then: one tab, devtools closed, laptop plugged in.

## Layout

```
src/
  adapters/     one file per renderer + the shared interface
  sim.ts        seeded fish + bubbles, cursor flee behaviour
  sprites.ts    pixel maps, palettes, atlas builder
  scenery.ts    background painter
  runner.ts     render loop, renderer switching, run / ramp
  metrics.ts    frame stats, percentiles, heap sampling
  main.ts       page wiring
scripts/
  bundle-sizes.mjs   gzip size per renderer from the vite manifest
```

built with vite + typescript.
