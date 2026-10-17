import { RENDERERS } from './adapters';
import { ATLAS_COLS, ATLAS_ROWS, CELL_H, CELL_W, HEIGHT, WIDTH, type Assets, type RendererAdapter } from './adapters/types';
import { Recorder, Ring, heapMB, settle, sleep, type FrameStats } from './metrics';
import { buildBackground } from './scenery';
import { MAX_FISH, Sim } from './sim';
import { buildAtlas } from './sprites';

export type Mode = 'run' | 'ramp';

export interface RunResult extends FrameStats {
  id: string;
  at: string;
  renderer: string;
  mode: Mode;
  /** Fixed run: the fish count. Ramp: the highest count whose p95 stayed under budget. */
  fish: number;
  refreshHz: number;
  loadMs: number;
  initMs: number;
  firstFrameMs: number;
  heapPeakMB: number | null;
  /** Heap after destroy minus heap before load. Filled in when the renderer is torn down. */
  heapLeakMB: number | null;
}

interface Startup {
  loadMs: number;
  initMs: number;
  firstFrameMs: number;
  heapBefore: number | null;
}

export const RUN_SECONDS = 10;
export const WARMUP_SECONDS = 2;
export const RAMP_START = 500;
export const RAMP_FACTOR = 1.25;
export const RAMP_BUDGET_MS = 18;

class Aborted extends Error {}

function buildAssets(): Assets {
  return {
    width: WIDTH,
    height: HEIGHT,
    atlas: buildAtlas(),
    background: buildBackground(),
    cellW: CELL_W,
    cellH: CELL_H,
    cols: ATLAS_COLS,
    rows: ATLAS_ROWS,
  };
}

/** Owns the render loop, the active renderer and the benchmarks. */
export class Bowl {
  readonly sim = new Sim(42);
  readonly live = new Ring(160);
  rendererId = '';
  busy = false;
  task = '';
  refreshMs = 1000 / 60;

  onResult: (r: RunResult) => void = () => {};
  onResultsPatched: () => void = () => {};
  onChange: () => void = () => {};

  private adapter: RendererAdapter | null = null;
  private surface: HTMLElement | null = null;
  private startup: Startup | null = null;
  private resultsForAdapter: RunResult[] = [];
  private switching: Promise<void> | null = null;
  private recorder: Recorder | null = null;
  private peakHeap: number | null = null;
  private firstFramePending = false;
  private initStart = 0;
  private last = 0;
  private aborted = false;

  constructor(private host: HTMLElement) {
    requestAnimationFrame(this.frame);
  }

  get fish() {
    return this.sim.fish;
  }

  private frame = (t: number) => {
    requestAnimationFrame(this.frame);
    const a = this.adapter;
    if (!a) {
      this.last = 0;
      return;
    }
    const t0 = performance.now();
    this.sim.step();
    const t1 = performance.now();
    a.update(this.sim.state);
    a.render();
    const t2 = performance.now();

    if (this.firstFramePending) {
      this.firstFramePending = false;
      if (this.startup) this.startup.firstFrameMs = t2 - this.initStart;
    }
    if (this.last) {
      const dt = t - this.last;
      this.live.push(dt, t2 - t1, t1 - t0);
      this.recorder?.push(dt, t2 - t1, t1 - t0);
    }
    this.last = t;
  };

  /** Tear down the current renderer (if any) and bring up `id`. */
  setRenderer(id: string): Promise<void> {
    const run = async () => {
      if (this.switching) await this.switching;
      await this.teardown();
      const entry = RENDERERS.find((r) => r.id === id);
      if (!entry) throw new Error(`unknown renderer ${id}`);

      await settle(150);
      const heapBefore = heapMB();
      const tl = performance.now();
      const mod = await entry.load();
      const loadMs = performance.now() - tl;

      const adapter = mod.default();
      const surface = document.createElement('div');
      surface.className = 'surface';
      this.host.appendChild(surface);
      this.initStart = performance.now();
      await adapter.init(surface, buildAssets());
      const initMs = performance.now() - this.initStart;
      adapter.setCount(this.sim.total);

      this.adapter = adapter;
      this.surface = surface;
      this.rendererId = id;
      this.startup = { loadMs, initMs, firstFrameMs: 0, heapBefore };
      this.firstFramePending = true;
      this.live.clear();
      this.onChange();
    };
    this.switching = run().finally(() => (this.switching = null));
    return this.switching;
  }

  private async teardown() {
    const a = this.adapter;
    if (!a) return;
    this.adapter = null;
    await a.destroy();
    this.surface?.remove();
    this.surface = null;
    await settle(300);
    const after = heapMB();
    const before = this.startup?.heapBefore ?? null;
    if (after !== null && before !== null && this.resultsForAdapter.length) {
      for (const r of this.resultsForAdapter) r.heapLeakMB = after - before;
      this.onResultsPatched();
    }
    this.resultsForAdapter = [];
  }

  setFish(n: number) {
    this.sim.setFish(n);
    this.adapter?.setCount(this.sim.total);
    this.onChange();
  }

  stop() {
    if (this.busy) this.aborted = true;
  }

  /** Fixed count: warmup, then RUN_SECONDS measured. */
  runFixed(): Promise<RunResult | null> {
    return this.exclusive('run', async () => this.measureFixed());
  }

  /** Grow the bowl until p95 frame time blows the budget. */
  runRamp(): Promise<RunResult | null> {
    return this.exclusive('ramp', async () => this.measureRamp());
  }

  /** Every renderer in turn, then back to the one you were on. */
  async runAll(mode: Mode): Promise<void> {
    const original = this.rendererId;
    const fish = this.fish;
    await this.exclusive(`${mode} all`, async () => {
      for (const r of RENDERERS) {
        this.setFish(fish);
        await this.setRenderer(r.id);
        await this.wait(300);
        if (mode === 'run') await this.measureFixed();
        else await this.measureRamp();
      }
    });
    this.setFish(fish);
    if (this.rendererId !== original) await this.setRenderer(original);
  }

  private async measureFixed(): Promise<RunResult> {
    this.sim.reset();
    this.task = `run · warmup`;
    this.onChange();
    await this.collect(WARMUP_SECONDS * 1000);
    this.task = `run · measuring ${RUN_SECONDS}s`;
    this.onChange();
    const rec = await this.collect(RUN_SECONDS * 1000);
    return this.emit('run', this.fish, rec);
  }

  private async measureRamp(): Promise<RunResult> {
    const start = this.fish;
    let n = RAMP_START;
    let best: { n: number; rec: Recorder } | null = null;
    try {
      while (n <= MAX_FISH) {
        this.setFish(n);
        this.sim.reset();
        this.task = `ramp · ${n.toLocaleString()} fish`;
        this.onChange();
        await this.collect(500);
        const rec = await this.collect(1500);
        const p95 = rec.stats(this.refreshMs).p95;
        this.task = `ramp · ${n.toLocaleString()} fish · p95 ${p95.toFixed(1)}ms`;
        this.onChange();
        if (p95 > RAMP_BUDGET_MS) break;
        best = { n, rec };
        n = Math.ceil(n * RAMP_FACTOR);
      }
    } finally {
      this.setFish(start);
    }
    return this.emit('ramp', best?.n ?? 0, best?.rec ?? new Recorder());
  }

  private async exclusive<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    if (this.busy) return null;
    this.busy = true;
    this.aborted = false;
    this.task = label;
    // Live input would hand each renderer a different sequence of frames.
    this.sim.pointerEnabled = false;
    this.onChange();
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Aborted) return null;
      throw e;
    } finally {
      this.sim.pointerEnabled = true;
      this.recorder = null;
      this.busy = false;
      this.task = '';
      this.onChange();
    }
  }

  private async collect(ms: number): Promise<Recorder> {
    if (this.switching) await this.switching;
    const rec = new Recorder();
    this.recorder = rec;
    this.peakHeap = heapMB();
    const end = performance.now() + ms;
    while (performance.now() < end) {
      await this.wait(Math.min(250, end - performance.now()));
      const h = heapMB();
      if (h !== null && (this.peakHeap === null || h > this.peakHeap)) this.peakHeap = h;
    }
    this.recorder = null;
    return rec;
  }

  private async wait(ms: number) {
    await sleep(Math.max(0, ms));
    if (this.aborted) throw new Aborted();
  }

  private emit(mode: Mode, fish: number, rec: Recorder): RunResult {
    const s = this.startup!;
    const r: RunResult = {
      id: Math.random().toString(36).slice(2, 10),
      at: new Date().toISOString(),
      renderer: this.rendererId,
      mode,
      fish,
      refreshHz: Math.round(1000 / this.refreshMs),
      ...rec.stats(this.refreshMs),
      loadMs: s.loadMs,
      initMs: s.initMs,
      firstFrameMs: s.firstFrameMs,
      heapPeakMB: this.peakHeap,
      heapLeakMB: null,
    };
    this.resultsForAdapter.push(r);
    this.onResult(r);
    return r;
  }
}
