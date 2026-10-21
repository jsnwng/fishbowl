import { CELL_H, HEIGHT, WIDTH } from '../adapters/types';
import { SAND_TOP } from '../scenery';

/** Sky above, water below. The fisherman's boat sits on this line. */
export const WATERLINE = 26;

/** Where the rod tip is. Every cast starts here and every reel ends here. */
export const ROD_X = 178;
export const ROD_Y = WATERLINE - 18;

export const TICKS_PER_SECOND = 60;

/** Every tunable number in the game. Tune these by playing and with `npm run score`. */
export const RULES = {
  runTicks: 120 * TICKS_PER_SECOND, // a run is 2 minutes of sim time
  fish: 30,
  // hunters are asked whenever the line changes state, and this often otherwise
  askEvery: 30,

  // casting: the hook flies to (x, y). Far casts take longer.
  castBaseTicks: 20,
  castTicksPerPx: 0.25,
  // reeling in, empty or with a fish on
  reelTicks: 50,

  // splash scare: fish this close to where the hook lands bolt
  splashRadius: 22,

  // bait: pulls fish in while fresh, goes stale over this many ticks (linearly)
  staleTicks: 6 * TICKS_PER_SECOND,
  attractRadius: 30, // at full freshness; shrinks as the bait goes stale. Only fish heading toward the hook notice it.
  attractDive: 0.25, // px/tick of vertical drift toward the hook

  // biting: a fish's mouth within this of the hook may start a nibble
  biteRadius: 5,
  biteChance: 0.03, // per tick, times freshness
  strikeWindow: 24, // ticks to reel after a nibble starts (~0.4s at 1x)

  // a caught fish swims back in from the edge after this long
  respawnTicks: 2 * TICKS_PER_SECOND,

  // wandering: every so often a calm fish may turn around or pick a new depth
  wanderMinTicks: 60,
  wanderMaxTicks: 180,
  turnChance: 0.5,
  depthChance: 0.5,
  depthRange: 40, // px up or down from where it is
  wanderDive: 0.2, // px/tick while gliding to a new depth

  // where fish can swim (top-left of the sprite cell)
  minY: WATERLINE + 2,
  maxY: SAND_TOP - CELL_H - 6,
} as const;

/** A fisherman's rod tip. `facing` is which way the fisherman looks: 1 right, -1 left. */
export interface Rod {
  x: number;
  y: number;
  facing: 1 | -1;
}

/** The bowl a game is played in: its size, where fish can swim, and one rod per player. */
export interface Bowl {
  width: number;
  height: number;
  minY: number;
  maxY: number;
  rods: Rod[];
}

/** Where fish can swim in a bowl this tall: the same margins as the solo bowl's RULES.minY/maxY. */
const swimRange = (height: number) => ({ minY: WATERLINE + 2, maxY: height - (HEIGHT - SAND_TOP) - CELL_H - 6 });

/** The players and live pages: 320x180, one fisherman. */
export const SOLO: Bowl = { width: WIDTH, height: HEIGHT, minY: RULES.minY, maxY: RULES.maxY, rods: [{ x: ROD_X, y: ROD_Y, facing: 1 }] };

/** pt.4: 384x216 (1.2x, still 16:9), you on the left facing right, the AI on the right facing left. */
export const BATTLE_GAP = 40; // px from the middle to each rod tip
export const BATTLE: Bowl = {
  width: 384,
  height: 216,
  ...swimRange(216),
  rods: [
    { x: 192 - BATTLE_GAP, y: ROD_Y, facing: 1 },
    { x: 192 + BATTLE_GAP, y: ROD_Y, facing: -1 },
  ],
};

/** Per species, in SPECIES order (goldfish, clownfish, blue tang, puffer, angelfish). */
export const SPECIES_RULES = [
  { points: 1, weight: 30, speed: 0.35, skittish: 1 },
  { points: 2, weight: 25, speed: 0.45, skittish: 1 },
  { points: 5, weight: 10, speed: 0.6, skittish: 1.3 }, // fast and rare
  { points: 1, weight: 20, speed: 0.2, skittish: 0.8 }, // slow and easy
  { points: 3, weight: 15, speed: 0.3, skittish: 1.5 }, // jumpy
] as const;

// Flee response, the same shape as the cursor flee in src/sim.ts.
export const FLEE = {
  burstMax: 2, // full fright = cruise speed x (1 + burstMax)
  burstDecay: 0.97, // ~2.5s back to cruising
  maxVy: 1.2, // vertical kick at full threat
  vyDamp: 0.92,
  wallMargin: 12, // don't turn to face a wall this close
} as const;
