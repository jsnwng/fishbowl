import { CELL_H, CELL_W, WIDTH } from '../adapters/types';
import { mulberry32, rngFor } from '../rng';
import { FLEE, ROD_X, ROD_Y, RULES, SPECIES_RULES, WATERLINE } from './rules';
import type { Action, AskReason, FishView, GameEvent, LineState, Observation, RunStats } from './types';

const MAX_X = WIDTH - CELL_W;
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
 * The fishing game, headless and deterministic: same seed + same actions = same run.
 * No DOM, no Pixi, so it runs in Node for scoring (and later, training).
 *
 * The clock only runs between start() and the end of the run. Outside it the fish keep
 * swimming but actions are ignored, so the page can show an idle bowl.
 */
export class Game {
  fish: Fish[] = [];
  tick = 0;
  elapsed = 0;
  running = false;
  done = false;
  stats: RunStats = blankStats();

  line: LineState = 'idle';
  hookX = ROD_X;
  hookY = ROD_Y;
  castFromX = ROD_X;
  castFromY = ROD_Y;
  castToX = ROD_X;
  castToY = ROD_Y;
  /** Ticks into the current cast or reel, and how long it lasts. */
  lineT = 0;
  lineTicks = 0;
  waitT = 0;
  baitGone = false;
  nibbleFish = -1;
  nibbleLeft = 0;
  hookedFish = -1;

  private seed = 1;
  private spawns = 0;
  private rng = mulberry32(0);
  private events: GameEvent[] = [];

  constructor(seed = 1) {
    this.reset(seed);
  }

  /** Back to tick 0 with this seed's fish. The clock is stopped until start(). */
  reset(seed = this.seed) {
    this.seed = seed;
    this.tick = 0;
    this.elapsed = 0;
    this.running = false;
    this.done = false;
    this.stats = blankStats();
    this.rng = mulberry32(Math.imul(seed, 31) + 7);
    this.spawns = 0;
    this.nibbleFish = -1;
    this.hookedFish = -1;
    this.fish = [];
    for (let i = 0; i < RULES.fish; i++) {
      const f = this.blankFish(i);
      this.spawn(f, false);
      this.fish.push(f);
    }
    this.lineIn();
  }

  start() {
    this.running = true;
    this.done = false;
  }

  get ticksLeft() {
    return Math.max(0, RULES.runTicks - this.elapsed);
  }

  get freshness() {
    if (this.line !== 'waiting' && this.line !== 'nibble') return 0;
    if (this.baitGone) return 0;
    return Math.max(0, 1 - this.waitT / RULES.staleTicks);
  }

  /** Advance one tick. Returns what happened on it. */
  step(action: Action): GameEvent[] {
    this.events = [];
    this.tick++;
    if (this.running) {
      this.elapsed++;
      this.act(action);
    }
    this.advanceLine();
    for (const f of this.fish) this.moveFish(f);
    this.checkBites();
    if (this.running && this.elapsed >= RULES.runTicks) this.finish();
    return this.events;
  }

  observe(reason: AskReason = 'check'): Observation {
    const fish: FishView[] = [];
    for (const f of this.fish) {
      if (f.state !== 'swim' && f.state !== 'nibble') continue;
      const sp = SPECIES_RULES[f.species];
      fish.push({ id: f.id, x: centerX(f), y: centerY(f), vx: f.vx * (1 + f.burst * FLEE.burstMax), vy: f.dy, species: f.species, points: sp.points, scared: f.burst > 0 });
    }
    const out = this.line === 'idle';
    return {
      tick: this.tick,
      reason,
      ticksLeft: this.ticksLeft,
      score: this.stats.score,
      catches: this.stats.catches,
      line: this.line,
      rod: { x: ROD_X, y: ROD_Y },
      hook: out ? null : this.line === 'casting' ? { x: this.castToX, y: this.castToY } : { x: this.hookX, y: this.hookY },
      freshness: this.freshness,
      nibbleLeft: this.line === 'nibble' ? this.nibbleLeft : 0,
      fish,
    };
  }

  // ---- the line ----

  private act(a: Action) {
    if (a.type === 'wait') return;
    if (a.type === 'cast') {
      if (this.line !== 'idle') {
        this.stats.invalid++;
        return;
      }
      const x = clamp(a.x, 2, WIDTH - 2);
      const y = clamp(a.y, WATERLINE + 4, RULES.maxY + CELL_H);
      this.line = 'casting';
      this.castFromX = ROD_X;
      this.castFromY = ROD_Y;
      this.castToX = x;
      this.castToY = y;
      this.lineT = 0;
      this.lineTicks = Math.round(RULES.castBaseTicks + dist(ROD_X, ROD_Y, x, y) * RULES.castTicksPerPx);
      this.stats.casts++;
      this.events.push({ type: 'cast', x, y });
      return;
    }
    // reel
    if (this.line === 'nibble') {
      const f = this.fish[this.nibbleFish];
      f.state = 'hooked';
      this.hookedFish = f.id;
      this.nibbleFish = -1;
      this.events.push({ type: 'hooked', fish: f.id, species: f.species });
    } else if (this.line === 'waiting') {
      this.stats.empties++;
      this.events.push({ type: 'empty' });
    } else {
      this.stats.invalid++; // nothing to reel while the line is in or mid-cast
      return;
    }
    this.line = 'reeling';
    this.castFromX = this.hookX;
    this.castFromY = this.hookY;
    this.lineT = 0;
    this.lineTicks = RULES.reelTicks;
  }

  private advanceLine() {
    switch (this.line) {
      case 'casting': {
        this.lineT++;
        const p = this.lineT / this.lineTicks;
        this.hookX = this.castFromX + (this.castToX - this.castFromX) * p;
        this.hookY = this.castFromY + (this.castToY - this.castFromY) * p;
        if (this.lineT >= this.lineTicks) this.land();
        break;
      }
      case 'waiting':
        this.waitT++;
        break;
      case 'nibble':
        this.waitT++;
        if (--this.nibbleLeft <= 0) this.steal();
        break;
      case 'reeling': {
        this.lineT++;
        const p = Math.min(1, this.lineT / this.lineTicks);
        this.hookX = this.castFromX + (ROD_X - this.castFromX) * p;
        this.hookY = this.castFromY + (ROD_Y - this.castFromY) * p;
        if (this.lineT >= this.lineTicks) this.landCatch();
        break;
      }
    }
  }

  /** The hook hits the water: splash, then the bait starts working. */
  private land() {
    this.hookX = this.castToX;
    this.hookY = this.castToY;
    this.line = 'waiting';
    this.waitT = 0;
    this.baitGone = false;
    let scared = 0;
    for (const f of this.fish) {
      if (f.state !== 'swim') continue;
      if (this.scare(f, this.hookX, this.hookY, RULES.splashRadius * SPECIES_RULES[f.species].skittish)) scared++;
    }
    this.events.push({ type: 'splash', x: this.hookX, y: this.hookY, scared });
  }

  /** The strike window ran out: the fish takes the bait and bolts. */
  private steal() {
    const f = this.fish[this.nibbleFish];
    f.state = 'swim';
    this.scare(f, this.hookX, this.hookY, CELL_W * 2);
    this.nibbleFish = -1;
    this.baitGone = true;
    this.line = 'waiting';
    this.stats.stolen++;
    this.events.push({ type: 'stolen', fish: f.id, species: f.species });
  }

  private landCatch() {
    if (this.hookedFish >= 0) {
      const f = this.fish[this.hookedFish];
      const points = SPECIES_RULES[f.species].points;
      this.stats.score += points;
      this.stats.catches++;
      f.state = 'gone';
      f.respawnAt = this.tick + RULES.respawnTicks;
      this.events.push({ type: 'catch', fish: f.id, species: f.species, points });
    }
    this.lineIn();
  }

  private lineIn() {
    if (this.nibbleFish >= 0) this.fish[this.nibbleFish].state = 'swim';
    if (this.hookedFish >= 0 && this.fish[this.hookedFish].state === 'hooked') this.fish[this.hookedFish].state = 'swim';
    this.line = 'idle';
    this.hookX = ROD_X;
    this.hookY = ROD_Y;
    this.lineT = 0;
    this.lineTicks = 0;
    this.waitT = 0;
    this.baitGone = false;
    this.nibbleFish = -1;
    this.nibbleLeft = 0;
    this.hookedFish = -1;
  }

  private finish() {
    this.running = false;
    this.done = true;
    this.lineIn();
    this.events.push({ type: 'end', score: this.stats.score, catches: this.stats.catches });
  }

  // ---- fish ----

  private checkBites() {
    if (this.line !== 'waiting') return;
    const fresh = this.freshness;
    if (fresh <= 0) return;
    for (const f of this.fish) {
      if (f.state !== 'swim' || f.burst > 0) continue;
      if (dist(mouthX(f), centerY(f), this.hookX, this.hookY) > RULES.biteRadius) continue;
      if (this.rng() >= RULES.biteChance * fresh) continue;
      f.state = 'nibble';
      this.line = 'nibble';
      this.nibbleFish = f.id;
      this.nibbleLeft = RULES.strikeWindow;
      this.events.push({ type: 'nibble', fish: f.id, species: f.species });
      return;
    }
  }

  private moveFish(f: Fish) {
    switch (f.state) {
      case 'gone':
        if (this.tick >= f.respawnAt) this.spawn(f, true);
        return;
      case 'hooked':
        f.x = this.hookX - CELL_W / 2;
        f.y = this.hookY - CELL_H / 2;
        f.tail += 0.5; // thrashing
        return;
      case 'nibble':
        f.tail += 0.25;
        return;
    }

    const startY = f.y;
    if (this.tick >= f.wanderAt) this.wander(f);
    const attracted = this.attract(f);

    // Horizontal: cruise speed, boosted while frightened, bouncing off the glass.
    // Only bounce when heading out, so respawned fish can swim in from off-screen.
    let nx = f.x + f.vx * (1 + f.burst * FLEE.burstMax);
    if (nx < 0 && f.vx < 0) {
      nx = -nx;
      f.vx = -f.vx;
    } else if (nx > MAX_X && f.vx > 0) {
      nx = 2 * MAX_X - nx;
      f.vx = -f.vx;
    }
    f.x = nx;

    // Vertical: a dodge glides the fish off its line; once calm it eases back to its home depth.
    if (f.vy !== 0) {
      f.y = clamp(f.y + f.vy, RULES.minY, RULES.maxY);
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
   * of them. They drift to its depth and swim into it.
   */
  private attract(f: Fish): boolean {
    if (this.line !== 'waiting' || f.burst > 0) return false;
    const fresh = this.freshness;
    if (fresh <= 0) return false;
    const mx = mouthX(f);
    const ahead = f.vx > 0 ? this.hookX >= mx - RULES.biteRadius : this.hookX <= mx + RULES.biteRadius;
    if (!ahead) return false;
    if (dist(mx, centerY(f), this.hookX, this.hookY) > RULES.attractRadius * fresh) return false;
    const dy = this.hookY - centerY(f);
    f.y = clamp(f.y + clamp(dy, -RULES.attractDive, RULES.attractDive), RULES.minY, RULES.maxY);
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
      const nearWall = f.vx > 0 ? f.x < FLEE.wallMargin : f.x > MAX_X - FLEE.wallMargin;
      if (!nearWall) f.vx = -f.vx;
    }
    if (r() < RULES.depthChance) f.homeY = clamp(f.y + (r() * 2 - 1) * RULES.depthRange, RULES.minY, RULES.maxY);
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
      const blocked = f.vx > 0 ? f.x < FLEE.wallMargin : f.x > MAX_X - FLEE.wallMargin;
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
    f.species = sp;
    f.state = 'swim';
    f.vx = right ? speed : -speed;
    f.x = fromEdge ? (right ? -CELL_W : WIDTH) : r() * MAX_X;
    f.y = RULES.minY + r() * (RULES.maxY - RULES.minY);
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
