/** What the line is doing. */
export type LineState = 'idle' | 'casting' | 'waiting' | 'nibble' | 'reeling';

export type Action = { type: 'cast'; x: number; y: number } | { type: 'reel' } | { type: 'wait' };

export const WAIT: Action = { type: 'wait' };

/** What happened on a tick. Drives the view's effects (and later, the commentator). */
export type GameEvent =
  | { type: 'cast'; x: number; y: number }
  | { type: 'splash'; x: number; y: number; scared: number }
  | { type: 'nibble'; fish: number; species: number }
  | { type: 'hooked'; fish: number; species: number }
  | { type: 'catch'; fish: number; species: number; points: number }
  | { type: 'stolen'; fish: number; species: number }
  | { type: 'empty' }
  | { type: 'end'; score: number; catches: number };

/** One fish as a hunter sees it. Positions are the fish's center, in bowl pixels. */
export interface FishView {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: number;
  points: number;
  scared: boolean;
}

/** Everything a hunter gets to see on a tick. */
export interface Observation {
  tick: number;
  ticksLeft: number;
  score: number;
  catches: number;
  line: LineState;
  rod: { x: number; y: number };
  /** Where the hook is (or is headed while casting). Null while the line is in. */
  hook: { x: number; y: number } | null;
  /** 1 = fresh bait, 0 = stale or gone. */
  freshness: number;
  /** Ticks left to reel in a nibbling fish; 0 when nothing is biting. */
  nibbleLeft: number;
  fish: FishView[];
}

/** Anything that fishes: a person, fixed code, a trained policy, an LLM. */
export interface Hunter {
  id: string;
  /** Called before each run, so seeded hunters replay the same way. */
  reset(seed: number): void;
  /** Called once per tick while the clock runs. */
  decide(obs: Observation): Action;
}

export interface RunStats {
  score: number;
  catches: number;
  casts: number;
  empties: number;
  stolen: number;
  invalid: number;
}
