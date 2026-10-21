import { CELL_H, CELL_W } from '../adapters/types';
import { mulberry32, rngFor } from '../rng';
import { FLEE, RULES, SOLO, SPECIES_RULES, WATERLINE, type Bowl, type Rod } from './rules';
import { WAIT, type Action, type AskReason, type FishView, type GameEvent, type LineState, type Observation, type RunStats } from './types';

const TOTAL_WEIGHT = SPECIES_RULES.reduce((s, sp) => s + sp.weight, 0);

export type FishState = 'swim' | 'nibble' | 'hooked' | 'gone';

/** One fish. x/y is the top-left of its sprite cell, without the visual bob. */
export interface Fish {
  id: number;
  species: number;
  state: FishState;
  x: number;
  y: number;
  vx: number;
  vy: number;
  homeY: number;
  burst: number; // 0 = cruising, 1 = full fright
  respawnAt: number;
  /** How far it moved vertically last tick: dodges, wandering, being drawn to bait. */
  dy: number;
  /** This fish's own random stream, for wandering. Seeded at spawn. */
  rng: () => number;
  /** Tick of its next chance to wander. */
  wanderAt: number;
  // looks only: never read by the rules
  bobAmp: number;
  bobFreq: number;
  bobPhase: number;
  tailRate: number;
  tail: number;
}

const centerX = (f: Fish) => f.x + CELL_W / 2;
const centerY = (f: Fish) => f.y + CELL_H / 2;
const mouthX = (f: Fish) => (f.vx > 0 ? f.x + CELL_W - 2 : f.x + 1);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// Math.sqrt is exact in every engine (Math.hypot isn't), which keeps a later port bit-for-bit.
const dist = (ax: number, ay: number, bx: number, by: number) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

/**
 * One fisherman's line: what it's doing, where the hook is, and that fisherman's score.
 * A solo game has one; a battle has one per player.
 */
export class Line {
  state: LineState = 'idle';
  hookX: number;
  hookY: number;
  castFromX: number;
  castFromY: number;
  castToX: number;
  castToY: number;
  /** Ticks into the current cast or reel, and how long it lasts. */
  lineT = 0;
  lineTicks = 0;
  waitT = 0;
  baitGone = false;
  nibbleFish = -1;
  nibbleLeft = 0;
  hookedFish = -1;
  stats: RunStats = blankStats();

  constructor(readonly rod: Rod) {
    this.hookX = this.castFromX = this.castToX = rod.x;
    this.hookY = this.castFromY = this.castToY = rod.y;
  }

  get freshness() {
    if (this.state !== 'waiting' && this.state !== 'nibble') return 0;
    if (this.baitGone) return 0;
    return Math.max(0, 1 - this.waitT / RULES.staleTicks);
  }

  /** Where the hook is, or is headed while casting. Null while the line is in. */
  get hookView() {
    if (this.state === 'idle') return null;
    return this.state === 'casting' ? { x: this.castToX, y: this.castToY } : { x: this.hookX, y: this.hookY };
  }
}

/**
 * The fishing game, headless and deterministic: same seed + same actions = same run.
 * No DOM, no Pixi, so it runs in Node for scoring and training.
 *
 * The bowl sets the size and how many fishermen there are: one on the players and live pages,
 * two in a battle, fishing the same fish. With one, every number comes out as it always has.
 *
 * The clock only runs between start() and the end of the run. Outside it the fish keep
 * swimming but actions are ignored, so the page can show an idle bowl.
 */
export class Game {
  fish: Fish[] = [];
  lines: Line[] = [];
  tick = 0;
  elapsed = 0;
  running = false;
  done = false;

  private seed = 1;
  private spawns = 0;
  private rng = mulberry32(0);
  private events: GameEvent[] = [];
  private maxX: number;

  constructor(
    seed = 1,
    readonly bowl: Bowl = SOLO,
  ) {
    this.maxX = bowl.width - CELL_W;
    this.reset(seed);
  }

  // The first fisherman's line, for the pages that only have one.
  get line() {
    return this.lines[0].state;
  }
  get hookX() {
    return this.lines[0].hookX;
  }
  get hookY() {
    return this.lines[0].hookY;
  }
  get lineT() {
    return this.lines[0].lineT;
  }
  get lineTicks() {
    return this.lines[0].lineTicks;
  }
  get freshness() {
    return this.lines[0].freshness;
  }
  get stats() {
    return this.lines[0].stats;
  }

  /** Back to tick 0 with this seed's fish. The clock is stopped until start(). */
  reset(seed = this.seed) {
    this.seed = seed;
    this.tick = 0;
    this.elapsed = 0;
    this.running = false;
    this.done = false;
    this.rng = mulberry32(Math.imul(seed, 31) + 7);
    this.spawns = 0;
    this.lines = this.bowl.rods.map((rod) => new Line(rod));
    this.fish = [];
    for (let i = 0; i < RULES.fish; i++) {
      const f = this.blankFish(i);
      this.spawn(f, false);
      this.fish.push(f);
    }
  }

  start() {
    this.running = true;
    this.done = false;
  }

  get ticksLeft() {
    return Math.max(0, RULES.runTicks - this.elapsed);
  }

  /** Advance one tick, with one action per fisherman (or a single action, alone). Returns what happened. */
  step(actions: Action | Action[]): GameEvent[] {
    const list = Array.isArray(actions) ? actions : [actions];
    this.events = [];
    this.tick++;
    if (this.running) {
      this.elapsed++;
      this.lines.forEach((l, i) => this.act(l, i, list[i] ?? WAIT));
    }
    this.lines.forEach((l, i) => this.advanceLine(l, i));
    for (const f of this.fish) this.moveFish(f);
    this.checkBites();
    if (this.running && this.elapsed >= RULES.runTicks) this.finish();
    return this.events;
  }

  /** What fisherman `seat` sees: the fish, their own line, and the other fisherman's if there is one. */
  observe(reason: AskReason = 'check', seat = 0): Observation {
    const fish: FishView[] = [];
    for (const f of this.fish) {
      if (f.state !== 'swim' && f.state !== 'nibble') continue;
      const sp = SPECIES_RULES[f.species];
      fish.push({ id: f.id, x: centerX(f), y: centerY(f), vx: f.vx * (1 + f.burst * FLEE.burstMax), vy: f.dy, species: f.species, points: sp.points, scared: f.burst > 0 });
    }
    const me = this.lines[seat];
    const other = this.lines.length > 1 ? this.lines[(seat + 1) % this.lines.length] : null;
    return {
      tick: this.tick,
      reason,
      ticksLeft: this.ticksLeft,
      score: me.stats.score,
      catches: me.stats.catches,
      line: me.state,
      rod: { x: me.rod.x, y: me.rod.y, facing: me.rod.facing },
      hook: me.hookView,
      freshness: me.freshness,
      nibbleLeft: me.state === 'nibble' ? me.nibbleLeft : 0,
      fish,
      bowl: { width: this.bowl.width, height: this.bowl.height, maxY: this.bowl.maxY },
      rival: other && { line: other.state, hook: other.hookView, freshness: other.freshness, score: other.stats.score },
    };
  }

  // ---- the line ----

  private act(l: Line, i: number, a: Action) {
    if (a.type === 'wait') return;
    if (a.type === 'cast') {
      if (l.state !== 'idle') {
        l.stats.invalid++;
        return;
      }
      const x = clamp(a.x, 2, this.bowl.width - 2);
      const y = clamp(a.y, WATERLINE + 4, this.bowl.maxY + CELL_H);
      l.state = 'casting';
      l.castFromX = l.rod.x;
      l.castFromY = l.rod.y;
      l.castToX = x;
      l.castToY = y;
      l.lineT = 0;
      l.lineTicks = Math.round(RULES.castBaseTicks + dist(l.rod.x, l.rod.y, x, y) * RULES.castTicksPerPx);
      l.stats.casts++;
      this.events.push({ type: 'cast', line: i, x, y });
      return;
    }
    // reel
    if (l.state === 'nibble') {
      const f = this.fish[l.nibbleFish];
      f.state = 'hooked';
      l.hookedFish = f.id;
      l.nibbleFish = -1;
      this.events.push({ type: 'hooked', line: i, fish: f.id, species: f.species });
    } else if (l.state === 'waiting') {
      l.stats.empties++;
      this.events.push({ type: 'empty', line: i });
    } else {
      l.stats.invalid++; // nothing to reel while the line is in or mid-cast
      return;
    }
    l.state = 'reeling';
    l.castFromX = l.hookX;
    l.castFromY = l.hookY;
    l.lineT = 0;
    l.lineTicks = RULES.reelTicks;
  }

  private advanceLine(l: Line, i: number) {
    switch (l.state) {
      case 'casting': {
        l.lineT++;
        const p = l.lineT / l.lineTicks;
        l.hookX = l.castFromX + (l.castToX - l.castFromX) * p;
        l.hookY = l.castFromY + (l.castToY - l.castFromY) * p;
        if (l.lineT >= l.lineTicks) this.land(l, i);
        break;
      }
      case 'waiting':
        l.waitT++;
        break;
      case 'nibble':
        l.waitT++;
        if (--l.nibbleLeft <= 0) this.steal(l, i);
        break;
      case 'reeling': {
        l.lineT++;
        const p = Math.min(1, l.lineT / l.lineTicks);
        l.hookX = l.castFromX + (l.rod.x - l.castFromX) * p;
        l.hookY = l.castFromY + (l.rod.y - l.castFromY) * p;
        if (l.lineT >= l.lineTicks) this.landCatch(l, i);
        break;
      }
    }
  }

  /** The hook hits the water: splash, then the bait starts working. The splash scares anyone's fish. */
  private land(l: Line, i: number) {
    l.hookX = l.castToX;
    l.hookY = l.castToY;
    l.state = 'waiting';
    l.waitT = 0;
    l.baitGone = false;
    let scared = 0;
    for (const f of this.fish) {
      if (f.state !== 'swim') continue;
      if (this.scare(f, l.hookX, l.hookY, RULES.splashRadius * SPECIES_RULES[f.species].skittish)) scared++;
    }
    this.events.push({ type: 'splash', line: i, x: l.hookX, y: l.hookY, scared });
  }

  /** The strike window ran out: the fish takes the bait and bolts. */
  private steal(l: Line, i: number) {
    const f = this.fish[l.nibbleFish];
    f.state = 'swim';
    this.scare(f, l.hookX, l.hookY, CELL_W * 2);
    l.nibbleFish = -1;
    l.baitGone = true;
    l.state = 'waiting';
    l.stats.stolen++;
    this.events.push({ type: 'stolen', line: i, fish: f.id, species: f.species });
  }

  private landCatch(l: Line, i: number) {
    if (l.hookedFish >= 0) {
      const f = this.fish[l.hookedFish];
      const points = SPECIES_RULES[f.species].points;
      l.stats.score += points;
      l.stats.catches++;
      f.state = 'gone';
      f.respawnAt = this.tick + RULES.respawnTicks;
      this.events.push({ type: 'catch', line: i, fish: f.id, species: f.species, points });
    }
    this.lineIn(l);
  }

  private lineIn(l: Line) {
    if (l.nibbleFish >= 0) this.fish[l.nibbleFish].state = 'swim';
    if (l.hookedFish >= 0 && this.fish[l.hookedFish].state === 'hooked') this.fish[l.hookedFish].state = 'swim';
    l.state = 'idle';
    l.hookX = l.rod.x;
    l.hookY = l.rod.y;
    l.lineT = 0;
    l.lineTicks = 0;
    l.waitT = 0;
    l.baitGone = false;
    l.nibbleFish = -1;
    l.nibbleLeft = 0;
    l.hookedFish = -1;
  }

  private finish() {
    this.running = false;
    this.done = true;
    for (const l of this.lines) this.lineIn(l);
    const first = this.lines[0].stats;
    this.events.push({ type: 'end', score: first.score, catches: first.catches, scores: this.lines.map((l) => l.stats.score) });
  }

  // ---- fish ----

  /**
   * Each waiting line gets its chance at a bite. With two fishermen the one checked first takes
   * turns, so neither always wins a fish that reaches both hooks on the same tick.
   */
  private checkBites() {
    const n = this.lines.length;
    const first = n > 1 ? this.tick % n : 0;
    for (let k = 0; k < n; k++) {
      const i = (first + k) % n;
      this.checkBite(this.lines[i], i);
    }
  }

  private checkBite(l: Line, i: number) {
    if (l.state !== 'waiting') return;
    const fresh = l.freshness;
    if (fresh <= 0) return;
    for (const f of this.fish) {
      if (f.state !== 'swim' || f.burst > 0) continue;
      if (dist(mouthX(f), centerY(f), l.hookX, l.hookY) > RULES.biteRadius) continue;
      if (this.rng() >= RULES.biteChance * fresh) continue;
      f.state = 'nibble';
      l.state = 'nibble';
      l.nibbleFish = f.id;
      l.nibbleLeft = RULES.strikeWindow;
      this.events.push({ type: 'nibble', line: i, fish: f.id, species: f.species });
      return;
    }
  }

  private moveFish(f: Fish) {
    switch (f.state) {
      case 'gone':
        if (this.tick >= f.respawnAt) this.spawn(f, true);
        return;
      case 'hooked': {
        const l = this.lines.find((l) => l.hookedFish === f.id)!;
        f.x = l.hookX - CELL_W / 2;
        f.y = l.hookY - CELL_H / 2;
        f.tail += 0.5; // thrashing
        return;
      }
      case 'nibble':
        f.tail += 0.25;
        return;
    }

    const { minY, maxY } = this.bowl;
    const startY = f.y;
    if (this.tick >= f.wanderAt) this.wander(f);
    const attracted = this.attract(f);

    // Horizontal: cruise speed, boosted while frightened, bouncing off the glass.
    // Only bounce when heading out, so respawned fish can swim in from off-screen.
    let nx = f.x + f.vx * (1 + f.burst * FLEE.burstMax);
    if (nx < 0 && f.vx < 0) {
      nx = -nx;
      f.vx = -f.vx;
    } else if (nx > this.maxX && f.vx > 0) {
      nx = 2 * this.maxX - nx;
      f.vx = -f.vx;
    }
    f.x = nx;

    // Vertical: a dodge glides the fish off its line; once calm it eases back to its home depth.
    if (f.vy !== 0) {
      f.y = clamp(f.y + f.vy, minY, maxY);
      f.vy *= FLEE.vyDamp;
      if (Math.abs(f.vy) < 0.01) f.vy = 0;
    } else if (!attracted && f.burst === 0 && f.y !== f.homeY) {
      // glide to its home depth at a steady pace (after a dodge, or a wander picked a new depth)
      f.y += clamp(f.homeY - f.y, -RULES.wanderDive, RULES.wanderDive);
    }
    f.dy = f.y - startY;

    f.tail += (1 + f.burst * 3) / f.tailRate;
    if (f.burst > 0) {
      f.burst *= FLEE.burstDecay;
      if (f.burst < 0.01) f.burst = 0;
    }
  }

  /**
   * Fresh bait pulls calm fish in, but only fish that can see it: the hook has to be ahead
   * of them. They drift to its depth and swim into it. With two hooks in reach, the nearer wins.
   */
  private attract(f: Fish): boolean {
    if (f.burst > 0) return false;
    const mx = mouthX(f);
    let best: Line | null = null;
    let bestD = Infinity;
    for (const l of this.lines) {
      if (l.state !== 'waiting') continue;
      const fresh = l.freshness;
      if (fresh <= 0) continue;
      const ahead = f.vx > 0 ? l.hookX >= mx - RULES.biteRadius : l.hookX <= mx + RULES.biteRadius;
      if (!ahead) continue;
      const d = dist(mx, centerY(f), l.hookX, l.hookY);
      if (d > RULES.attractRadius * fresh || d >= bestD) continue;
      best = l;
      bestD = d;
    }
    if (!best) return false;
    const dy = best.hookY - centerY(f);
    f.y = clamp(f.y + clamp(dy, -RULES.attractDive, RULES.attractDive), this.bowl.minY, this.bowl.maxY);
    return true;
  }

  /**
   * Now and then a calm fish changes its mind: it turns around, or picks a new depth.
   * This is what keeps aim from being pure math: a fish's path is a good guess, not a promise.
   */
  private wander(f: Fish) {
    const r = f.rng;
    f.wanderAt = this.tick + RULES.wanderMinTicks + Math.floor(r() * (RULES.wanderMaxTicks - RULES.wanderMinTicks));
    if (f.burst > 0) return;
    if (r() < RULES.turnChance) {
      const nearWall = f.vx > 0 ? f.x < FLEE.wallMargin : f.x > this.maxX - FLEE.wallMargin;
      if (!nearWall) f.vx = -f.vx;
    }
    if (r() < RULES.depthChance) f.homeY = clamp(f.y + (r() * 2 - 1) * RULES.depthRange, this.bowl.minY, this.bowl.maxY);
  }

  /** Bolt away from (px, py) if it's within `radius`. Returns whether the fish got scared. */
  private scare(f: Fish, px: number, py: number, radius: number): boolean {
    const dx = centerX(f) - px;
    const dy = centerY(f) - py;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= radius) return false;
    const threat = 1 - d / radius;
    const headingAway = f.vx > 0 ? dx > 0 : dx < 0;
    if (!headingAway) {
      const blocked = f.vx > 0 ? f.x < FLEE.wallMargin : f.x > this.maxX - FLEE.wallMargin;
      if (!blocked) f.vx = -f.vx;
    }
    f.burst = Math.max(f.burst, Math.min(1, threat * 1.5 + 0.5));
    f.vy = clamp(f.vy + (dy >= 0 ? 1 : -1) * threat * FLEE.maxVy, -FLEE.maxVy, FLEE.maxVy);
    return true;
  }

  private blankFish(id: number): Fish {
    return { id, species: 0, state: 'swim', x: 0, y: 0, vx: 0, vy: 0, homeY: 0, burst: 0, respawnAt: 0, dy: 0, rng: mulberry32(0), wanderAt: 0, bobAmp: 0, bobFreq: 0, bobPhase: 0, tailRate: 6, tail: 0 };
  }

  /** Seeded per spawn, so a fish's looks and path don't depend on anything else in the run. */
  private spawn(f: Fish, fromEdge: boolean) {
    const r = rngFor(this.seed, this.spawns++);
    let pick = r() * TOTAL_WEIGHT;
    let sp = 0;
    while (sp < SPECIES_RULES.length - 1 && pick >= SPECIES_RULES[sp].weight) pick -= SPECIES_RULES[sp++].weight;
    const speed = SPECIES_RULES[sp].speed * (0.7 + 0.6 * r());
    const right = r() < 0.5;
    const { minY, maxY } = this.bowl;
    f.species = sp;
    f.state = 'swim';
    f.vx = right ? speed : -speed;
    f.x = fromEdge ? (right ? -CELL_W : this.bowl.width) : r() * this.maxX;
    f.y = minY + r() * (maxY - minY);
    f.homeY = f.y;
    f.vy = 0;
    f.burst = 0;
    f.bobAmp = 1 + r() * 2;
    f.bobFreq = 0.015 + r() * 0.03;
    f.bobPhase = r() * Math.PI * 2;
    f.tailRate = 6 + Math.floor(r() * 4);
    f.tail = r() * 2;
    f.dy = 0;
    f.rng = r;
    f.wanderAt = this.tick + Math.floor(r() * RULES.wanderMaxTicks);
  }
}

function blankStats(): RunStats {
  return { score: 0, catches: 0, casts: 0, empties: 0, stolen: 0, invalid: 0 };
}
