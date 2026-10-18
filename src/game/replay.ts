import type { LoggedAction, Mode } from './match';
import { FLEE, RULES, SPECIES_RULES } from './rules';
import { WAIT, type Action, type Hunter, type Observation } from './types';

/** Everything needed to play a run back exactly: the seed, and what was done on which tick. */
export interface Replay {
  v: 1;
  /** Hash of the rules it was recorded under. A different hash means it may not play back the same. */
  rules: string;
  seed: number;
  hunter: string;
  mode: Mode;
  catches: number;
  score: number;
  actions: LoggedAction[];
}

/** FNV-1a over the rule tables, as 8 hex digits. */
export function rulesHash(): string {
  const text = JSON.stringify([RULES, SPECIES_RULES, FLEE]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function parseReplay(text: string): Replay {
  const r = JSON.parse(text) as Replay;
  if (r.v !== 1 || !Array.isArray(r.actions) || typeof r.seed !== 'number') throw new Error('not a fishbowl replay');
  return r;
}

/** Plays a recorded run back: on each logged tick, it does what was done then. */
export class ReplayHunter implements Hunter {
  everyTick = true;
  readonly id: string;
  private byTick = new Map<number, Action>();

  constructor(readonly replay: Replay) {
    this.id = `replay: ${replay.hunter}`;
    for (const [tick, action] of replay.actions) this.byTick.set(tick, action);
  }

  reset() {}

  decide(obs: Observation): Action {
    return this.byTick.get(obs.tick) ?? WAIT;
  }
}
