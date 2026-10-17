export interface FrameStats {
  frames: number;
  avgFps: number;
  p50: number;
  p95: number;
  p99: number;
  /** % of frames longer than 1.5x the display refresh interval. */
  dropPct: number;
  /** update() + render() per frame, ms. */
  cpuAvg: number;
  /** sim.step() per frame, ms. Same for every renderer. */
  simAvg: number;
}

export function percentile(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Collects per-frame timings for one measurement window. */
export class Recorder {
  dt: number[] = [];
  cpu: number[] = [];
  sim: number[] = [];

  push(dt: number, cpu: number, sim: number) {
    this.dt.push(dt);
    this.cpu.push(cpu);
    this.sim.push(sim);
  }

  stats(refreshMs: number): FrameStats {
    const sorted = Float64Array.from(this.dt).sort();
    const avgDt = mean(this.dt);
    const dropped = this.dt.filter((d) => d > refreshMs * 1.5).length;
    return {
      frames: this.dt.length,
      avgFps: avgDt ? 1000 / avgDt : 0,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      dropPct: this.dt.length ? (dropped / this.dt.length) * 100 : 0,
      cpuAvg: mean(this.cpu),
      simAvg: mean(this.sim),
    };
  }
}

/** Fixed-size ring of recent frames for the live status line and sparkline. */
export class Ring {
  readonly dt: Float32Array;
  readonly cpu: Float32Array;
  readonly sim: Float32Array;
  private i = 0;
  filled = 0;

  constructor(readonly size: number) {
    this.dt = new Float32Array(size);
    this.cpu = new Float32Array(size);
    this.sim = new Float32Array(size);
  }

  push(dt: number, cpu: number, sim: number) {
    this.dt[this.i] = dt;
    this.cpu[this.i] = cpu;
    this.sim[this.i] = sim;
    this.i = (this.i + 1) % this.size;
    this.filled = Math.min(this.size, this.filled + 1);
  }

  /** Values of one series, oldest -> newest. */
  ordered(series: 'dt' | 'cpu' | 'sim' = 'dt'): number[] {
    const src = this[series];
    const out: number[] = [];
    for (let k = 0; k < this.filled; k++) out.push(src[(this.i - this.filled + k + this.size) % this.size]);
    return out;
  }

  recent(n: number): { fps: number; cpu: number; sim: number } {
    const k = Math.min(n, this.filled);
    let dt = 0;
    let cpu = 0;
    let sim = 0;
    for (let j = 1; j <= k; j++) {
      const idx = (this.i - j + this.size) % this.size;
      dt += this.dt[idx];
      cpu += this.cpu[idx];
      sim += this.sim[idx];
    }
    return { fps: dt ? (1000 * k) / dt : 0, cpu: k ? cpu / k : 0, sim: k ? sim / k : 0 };
  }

  clear() {
    this.i = 0;
    this.filled = 0;
  }
}

/** JS heap in MB. Chromium only (performance.memory); null elsewhere. */
export function heapMB(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize / 1048576 : null;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Give the GC a chance (window.gc exists when Chrome runs with --js-flags=--expose-gc). */
export async function settle(ms: number) {
  (window as unknown as { gc?: () => void }).gc?.();
  await sleep(ms);
}

/** Median rAF interval over ~40 frames. */
export function detectRefreshMs(): Promise<number> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let last = 0;
    const tick = (t: number) => {
      if (last) deltas.push(t - last);
      last = t;
      if (deltas.length < 40) requestAnimationFrame(tick);
      else {
        deltas.sort((a, b) => a - b);
        resolve(deltas[deltas.length >> 1] || 1000 / 60);
      }
    };
    requestAnimationFrame(tick);
  });
}
