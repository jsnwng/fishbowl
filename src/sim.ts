import { CELL_H, CELL_W, WIDTH, type SimState } from './adapters/types';
import { mulberry32, rngFor } from './rng';
import { CHEST_X, SAND_TOP } from './scenery';
import { BUBBLE_BASE, SPECIES, fishSprite } from './sprites';

export const MAX_FISH = 200_000;
export const BUBBLES = 24;

const SPEED = [0.35, 0.45, 0.6, 0.2, 0.3]; // px per tick, per species
const MAX_X = WIDTH - CELL_W;
const MIN_Y = 6;
const MAX_Y = SAND_TOP - CELL_H - 6;

// Flee tuning, in bowl pixels and ticks.
const AWARE_RADIUS = 36; // a still cursor is noticed this close
const SPEED_RADIUS = 6; // extra radius per px/tick of cursor speed...
const MAX_EXTRA_RADIUS = 30; // ...up to this much
const BURST_MAX = 2; // full fright = cruise speed x (1 + BURST_MAX)
const BURST_DECAY = 0.97; // ~1s back to cruising at 60fps
const DODGE = 0.35; // vertical push per tick at full threat
const MAX_VY = 1.2;
const VY_DAMP = 0.92;
const WALL_MARGIN = 12; // don't turn to face a wall that's this close
const HABITUATE_TICKS = 120; // a still cursor stops being scary over ~2s...
const HABITUATED_RADIUS = 0.4; // ...shrinking to this fraction of the awareness radius
const STILL_SPEED = 0.05; // px/tick below which the cursor counts as still
const HOME_PULL = 0.003; // once calm, drift back to the home depth (~4s half-life)

/**
 * Deterministic fish + bubble simulation. Advances one fixed tick per frame (not per ms),
 * so every renderer is handed the identical sequence of frames.
 *
 * Fish flee the cursor in free play. Benchmarks turn `pointerEnabled` off so live input
 * can't make one renderer's run differ from another's.
 *
 * Output layout: fish in [0, fish), bubbles in [fish, fish + BUBBLES). Bubbles draw on top.
 */
export class Sim {
  fish = 0;
  tick = 0;
  pointerEnabled = true;

  private cap = 0;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private sprite = new Uint8Array(0);

  // per-fish parameters
  private fx = new Float32Array(0);
  private vx = new Float32Array(0);
  private baseY = new Float32Array(0);
  private amp = new Float32Array(0);
  private freq = new Float32Array(0);
  private phase = new Float32Array(0);
  private species = new Uint8Array(0);
  private tailRate = new Uint8Array(0);
  private tail = new Float32Array(0); // tail-beat phase; frame = floor(tail) & 1
  private burst = new Float32Array(0); // 0 = cruising, 1 = full fright
  private vy = new Float32Array(0); // vertical dodge velocity
  private homeY = new Float32Array(0); // preferred depth; dodges drift back to it

  // pointer, in bowl pixels
  private px = 0;
  private py = 0;
  private prevPx = 0;
  private prevPy = 0;
  private pointerSpeed = 0;
  private pointerActive = false;
  private pointerFresh = false;
  private stillTicks = 0;

  // bubbles
  private bx = new Float32Array(BUBBLES);
  private by = new Float32Array(BUBBLES);
  private bv = new Float32Array(BUBBLES);
  private bsize = new Uint8Array(BUBBLES);
  private bph = new Float32Array(BUBBLES);
  private bubbleRng = mulberry32(0);

  constructor(private seed = 42) {
    this.ensure(BUBBLES);
    this.reset();
  }

  get total(): number {
    return this.fish + BUBBLES;
  }

  get state(): SimState {
    return { count: this.total, x: this.x, y: this.y, sprite: this.sprite };
  }

  setFish(n: number) {
    n = Math.max(0, Math.min(MAX_FISH, Math.floor(n)));
    this.ensure(n + BUBBLES);
    for (let i = this.fish; i < n; i++) this.initFish(i);
    this.fish = n;
    this.writeOutputs();
  }

  setPointer(x: number, y: number) {
    if (!this.pointerActive) this.pointerFresh = true;
    this.px = x;
    this.py = y;
    this.pointerActive = true;
  }

  clearPointer() {
    this.pointerActive = false;
    this.pointerSpeed = 0;
    this.stillTicks = 0;
  }

  /** Back to tick 0 with every fish at its seeded start. Benchmarks call this so runs are comparable. */
  reset() {
    this.tick = 0;
    for (let i = 0; i < this.fish; i++) this.initFish(i);
    this.bubbleRng = mulberry32(this.seed * 7 + 1);
    for (let j = 0; j < BUBBLES; j++) this.initBubble(j, true);
    this.writeOutputs();
  }

  step() {
    const t = ++this.tick;
    const { fx, vx, x, y, sprite, burst, vy, baseY, tail } = this;
    const scared = this.pointerEnabled && this.pointerActive;

    let radius = 0;
    if (scared) {
      // Cursor speed in px/tick, smoothed. A fresh pointer has no history, so no spike.
      if (this.pointerFresh) {
        this.prevPx = this.px;
        this.prevPy = this.py;
        this.pointerFresh = false;
      }
      const moved = Math.hypot(this.px - this.prevPx, this.py - this.prevPy);
      this.pointerSpeed = this.pointerSpeed * 0.7 + moved * 0.3;
      this.prevPx = this.px;
      this.prevPy = this.py;
      // Fish get used to a cursor that just sits there, but still keep their distance.
      this.stillTicks = this.pointerSpeed < STILL_SPEED ? this.stillTicks + 1 : 0;
      const calm = Math.min(1, this.stillTicks / HABITUATE_TICKS);
      radius = AWARE_RADIUS * (1 - (1 - HABITUATED_RADIUS) * calm) + Math.min(MAX_EXTRA_RADIUS, this.pointerSpeed * SPEED_RADIUS);
    }
    const r2 = radius * radius;
    const fright = Math.min(1, this.pointerSpeed / 4); // fast cursor = bigger scare

    for (let i = 0; i < this.fish; i++) {
      if (scared) {
        const dx = fx[i] + CELL_W / 2 - this.px;
        const dy = y[i] + CELL_H / 2 - this.py;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) {
          const threat = 1 - Math.sqrt(d2) / radius;
          // Cursor ahead of the fish: turn and flee, unless that would mean facing a wall.
          const headingAway = vx[i] > 0 ? dx > 0 : dx < 0;
          if (!headingAway && threat > 0.15) {
            const nx = fx[i];
            const blocked = vx[i] > 0 ? nx < WALL_MARGIN : nx > MAX_X - WALL_MARGIN;
            if (!blocked) vx[i] = -vx[i];
          }
          const b = Math.min(1, threat * 1.5 + fright * 0.5);
          if (b > burst[i]) burst[i] = b;
          const push = (dy >= 0 ? 1 : -1) * threat * DODGE;
          vy[i] = Math.max(-MAX_VY, Math.min(MAX_VY, vy[i] + push));
        }
      }

      // Horizontal: cruise speed, boosted while frightened, bouncing off the glass.
      let nx = fx[i] + vx[i] * (1 + burst[i] * BURST_MAX);
      if (nx < 0) {
        nx = -nx;
        vx[i] = -vx[i];
      } else if (nx > MAX_X) {
        nx = 2 * MAX_X - nx;
        vx[i] = -vx[i];
      }
      fx[i] = nx;

      // Vertical: a dodge glides the fish off its line; once calm it eases back to its home depth.
      if (vy[i] !== 0) {
        baseY[i] = Math.max(MIN_Y, Math.min(MAX_Y, baseY[i] + vy[i]));
        vy[i] *= VY_DAMP;
        if (Math.abs(vy[i]) < 0.01) vy[i] = 0;
      } else if (burst[i] === 0 && baseY[i] !== this.homeY[i]) {
        const off = this.homeY[i] - baseY[i];
        baseY[i] = Math.abs(off) < 0.05 ? this.homeY[i] : baseY[i] + off * HOME_PULL;
      }

      tail[i] += (1 + burst[i] * 3) / this.tailRate[i];
      if (burst[i] > 0) {
        burst[i] *= BURST_DECAY;
        if (burst[i] < 0.01) burst[i] = 0;
      }

      x[i] = Math.round(nx);
      y[i] = Math.round(baseY[i] + Math.sin(this.phase[i] + t * this.freq[i]) * this.amp[i]);
      sprite[i] = fishSprite(this.species[i], vx[i] < 0, Math.floor(tail[i]) & 1);
    }

    for (let j = 0; j < BUBBLES; j++) {
      this.by[j] -= this.bv[j];
      if (this.by[j] < -6) this.initBubble(j, false);
    }
    this.writeBubbles();
  }

  private initFish(i: number) {
    const r = rngFor(this.seed, i);
    const sp = Math.floor(r() * SPECIES.length);
    const speed = SPEED[sp] * (0.7 + 0.6 * r());
    this.species[i] = sp;
    this.vx[i] = r() < 0.5 ? -speed : speed;
    this.fx[i] = r() * MAX_X;
    this.baseY[i] = MIN_Y + r() * (MAX_Y - MIN_Y);
    this.homeY[i] = this.baseY[i];
    this.amp[i] = 1 + r() * 3;
    this.freq[i] = 0.015 + r() * 0.03;
    this.phase[i] = r() * Math.PI * 2;
    const tailOff = Math.floor(r() * 16);
    this.tailRate[i] = 6 + Math.floor(r() * 4);
    this.tail[i] = tailOff / this.tailRate[i];
    this.burst[i] = 0;
    this.vy[i] = 0;
  }

  private initBubble(j: number, scatter: boolean) {
    const r = this.bubbleRng;
    // a third of the bubbles come out of the treasure chest, the rest from random spots in the sand
    this.bx[j] = j % 3 === 0 ? CHEST_X + 5 + r() * 4 : 4 + r() * (WIDTH - 12);
    this.by[j] = scatter ? r() * SAND_TOP : SAND_TOP - 4 + r() * 6;
    this.bv[j] = 0.25 + r() * 0.5;
    this.bsize[j] = Math.floor(r() * 4);
    this.bph[j] = r() * 100;
  }

  private writeOutputs() {
    const t = this.tick;
    for (let i = 0; i < this.fish; i++) {
      this.x[i] = Math.round(this.fx[i]);
      this.y[i] = Math.round(this.baseY[i] + Math.sin(this.phase[i] + t * this.freq[i]) * this.amp[i]);
      this.sprite[i] = fishSprite(this.species[i], this.vx[i] < 0, Math.floor(this.tail[i]) & 1);
    }
    this.writeBubbles();
  }

  private writeBubbles() {
    const t = this.tick;
    const o = this.fish;
    for (let j = 0; j < BUBBLES; j++) {
      this.x[o + j] = Math.round(this.bx[j] + Math.sin((t + this.bph[j]) * 0.08) * 1.5);
      this.y[o + j] = Math.round(this.by[j]);
      this.sprite[o + j] = BUBBLE_BASE + this.bsize[j];
    }
  }

  private ensure(n: number) {
    if (n <= this.cap) return;
    const cap = Math.max(n, Math.ceil(this.cap * 1.5), 256);
    const grow = <T extends Float32Array | Uint8Array>(a: T, make: (n: number) => T): T => {
      const b = make(cap);
      b.set(a);
      return b;
    };
    const f32 = (k: number) => new Float32Array(k);
    const u8 = (k: number) => new Uint8Array(k);
    this.x = grow(this.x, f32);
    this.y = grow(this.y, f32);
    this.sprite = grow(this.sprite, u8);
    this.fx = grow(this.fx, f32);
    this.vx = grow(this.vx, f32);
    this.baseY = grow(this.baseY, f32);
    this.amp = grow(this.amp, f32);
    this.freq = grow(this.freq, f32);
    this.phase = grow(this.phase, f32);
    this.species = grow(this.species, u8);
    this.tailRate = grow(this.tailRate, u8);
    this.tail = grow(this.tail, f32);
    this.burst = grow(this.burst, f32);
    this.vy = grow(this.vy, f32);
    this.homeY = grow(this.homeY, f32);
    this.cap = cap;
  }
}
