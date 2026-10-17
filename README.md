# fishbowl

An 8-bit aquarium for benchmarking 2D web renderers.

![Pixel-art fish swimming over seaweed, rocks and a treasure chest](docs/bowl.png)

The same seeded fish swim through the same frames under six different renderers. Add fish until it lags, run timed tests, and compare the numbers.

## Renderers

| Renderer | How it draws the bowl |
|---|---|
| `canvas2d` | Raw Canvas2D, one `drawImage` call per fish. This is the baseline. |
| `webgl` | Raw WebGL2, with every fish in a single instanced draw call. |
| `pixi` | PixiJS v8, one `Sprite` per fish. |
| `konva` | Konva's scene graph on Canvas2D, one cropped `Konva.Image` per fish. |
| `two` | Two.js on its WebGL renderer, one `Two.Sprite` per fish. |
| `p5` | p5.js v1 in instance mode. |

Each renderer is a small adapter behind the same interface (`init`, `setCount`, `update`, `render`, `destroy`). Adapters are loaded with a dynamic import, so each library ends up in its own bundle chunk. The bench drives every renderer from a single `requestAnimationFrame` loop rather than the library's own ticker.

## Benchmark

- **Run 10s:** a 2-second warmup, then 10 seconds measured at the current fish count.
- **Ramp:** starts at 500 fish and multiplies the count by 1.25 every 2 seconds, stopping once the p95 frame time passes 18 ms. It reports the highest count that held.
- **Run all / ramp all:** runs every renderer in turn, tearing each one down before the next.

Each run measures average FPS, p50/p95/p99 frame time, dropped frames (against the detected refresh rate), CPU time per frame, sim time, load and init time, time to first frame, JS heap peak, heap leaked after teardown, and gzipped bundle size per renderer. Results are saved locally and can be exported as JSON or CSV.

The comparison is kept fair on purpose:

- The sim advances one fixed tick per frame from a seeded RNG, so every renderer is handed identical frames.
- Fish flee the cursor in free play, but live input is switched off during benchmark runs.
- The dev and preview servers send cross-origin isolation headers, so `performance.now()` resolves to about 5 µs instead of 100 µs.

## The art

There are no image files. The fish are ASCII pixel maps in [`src/sprites.ts`](src/sprites.ts): five species built from three hand-drawn shapes plus palette swaps. The tail-wag frames and left-facing versions are generated, and everything is packed into a single sprite atlas that all six renderers share. The scenery in [`src/scenery.ts`](src/scenery.ts) is painted in code as well.

## Running it

```bash
npm install
npm run dev
```

For numbers worth comparing, use the production build, which also writes the gzip sizes:

```bash
npm run build
npm run preview
```

Then keep a single tab open, close DevTools, and plug your laptop in.

## Project layout

```
src/
  adapters/     one file per renderer, plus the shared interface
  sim.ts        seeded fish and bubbles, cursor flee behavior
  sprites.ts    pixel maps, palettes, atlas builder
  scenery.ts    background painter
  runner.ts     render loop, renderer switching, run and ramp
  metrics.ts    frame stats, percentiles, heap sampling
  main.ts       page wiring
scripts/
  bundle-sizes.mjs   gzip size per renderer, from the Vite manifest
```

Built with Vite and TypeScript.
