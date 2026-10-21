/** What the line is doing. */
export type LineState = 'idle' | 'casting' | 'waiting' | 'nibble' | 'reeling';

export type Action = { type: 'cast'; x: number; y: number } | { type: 'reel' } | { type: 'wait' };

export const WAIT: Action = { type: 'wait' };

/**
 * What happened on a tick. Drives the view's effects and the commentators. `line` is whose
 * line it happened on: always 0 with one fisherman, 0 or 1 in a battle.
 */
export type GameEvent =
  | { type: 'cast'; line: number; x: number; y: number }
  | { type: 'splash'; line: number; x: number; y: number; scared: number }
  | { type: 'nibble'; line: number; fish: number; species: number }
  | { type: 'hooked'; line: number; fish: number; species: number }
  | { type: 'catch'; line: number; fish: number; species: number; points: number }
  | { type: 'stolen'; line: number; fish: number; species: number }
  | { type: 'empty'; line: number }
  | { type: 'end'; score: number; catches: number; scores: number[] };

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

/**
 * Why the hunter is being asked. Hunters are asked at decision points, not every tick:
 * when the line changes state, and every RULES.askEvery ticks otherwise.
 */
export type AskReason = 'idle' | 'landed' | 'nibble' | 'check';

/** The other fisherman in a battle, as you'd see them from your boat. */
export interface RivalView {
  line: LineState;
  /** Where their hook is (or is headed while casting). Null while their line is in. */
  hook: { x: number; y: number } | null;
  freshness: number;
  score: number;
}

/** Everything a hunter gets to see when it's asked. */
export interface Observation {
  tick: number;
  reason: AskReason;
  ticksLeft: number;
  score: number;
  catches: number;
  line: LineState;
  /** Your rod tip, and which way you face (1 right, -1 left). */
  rod: { x: number; y: number; facing: 1 | -1 };
  /** Where the hook is (or is headed while casting). Null while the line is in. */
  hook: { x: number; y: number } | null;
  /** 1 = fresh bait, 0 = stale or gone. */
  freshness: number;
  /** Ticks left to reel in a nibbling fish; 0 when nothing is biting. */
  nibbleLeft: number;
  fish: FishView[];
  /** The bowl's size in pixels. */
  bowl: { width: number; height: number; maxY: number };
  /** The other fisherman, in a battle. Null when you're out there alone. */
  rival: RivalView | null;
}

/** Anything that fishes: a person, fixed code, a trained policy, an LLM. */
export interface Hunter {
  id: string;
  /** Ask on every tick instead of only at decision points (people clicking, replays). */
  everyTick?: boolean;
  /** Called before each run, so seeded hunters replay the same way. */
  reset(seed: number): void;
  /**
   * Called at each decision point while the clock runs. A slow hunter can return a promise:
   * in real time the game keeps going while it thinks, in turn based it waits.
   */
  decide(obs: Observation): Action | Promise<Action>;
}

export interface RunStats {
  score: number;
  catches: number;
  casts: number;
  empties: number;
  stolen: number;
  invalid: number;
}
