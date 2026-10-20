import { SPECIES } from '../sprites';
import type { Game } from '../game/game';
import type { HunterEntry } from '../game/hunters';
import { leadFor } from '../game/hunters/heuristic';
import { SPECIES_RULES, TICKS_PER_SECOND } from '../game/rules';
import type { Action, GameEvent, Hunter, Observation } from '../game/types';

/** A fish as the chat talks about it. */
export interface FishRef {
  name: string;
  points: number;
}

/** What a player chose at a cast: a particular fish, a spot with no fish in mind, or no cast. */
export type Pick = { kind: 'fish'; fish: FishRef } | { kind: 'spot'; x: number } | { kind: 'wait' };

/** What one of the other players would have done with the same view of the bowl. */
export interface Opinion {
  speaker: string;
  pick: Pick;
}

/** Something worth reacting to. The streamer's own results, plus the cast the chat can second-guess. */
export type Moment =
  | { kind: 'start' }
  | { kind: 'cast'; pick: Pick; opinions: Opinion[] }
  | { kind: 'scared'; count: number }
  | { kind: 'catch'; fish: FishRef }
  | { kind: 'stolen'; fish: FishRef }
  | { kind: 'empty' }
  | { kind: 'dry'; seconds: number }
  | { kind: 'end'; score: number; catches: number };

/** The run so far, so a line can mention the score or the clock. */
export interface Context {
  streamer: string;
  score: number;
  catches: number;
  secondsLeft: number;
}

export const fishRef = (species: number): FishRef => ({ name: SPECIES[species].name, points: SPECIES_RULES[species].points });

/** Name a cast: the fish it leads, if any. Heuristic and model casts always lead a fish; the others don't. */
export function pickFor(action: Action, obs: Observation): Pick {
  if (action.type !== 'cast') return { kind: 'wait' };
  for (const f of obs.fish) {
    const p = leadFor(f, obs);
    if (p && Math.abs(p.x - action.x) < 1e-6 && Math.abs(p.y - action.y) < 1e-6) return { kind: 'fish', fish: fishRef(f.species) };
  }
  return { kind: 'spot', x: Math.round(action.x) };
}

/**
 * Wraps the streamer so the other players see every decision too. Each keeps its own copy and is
 * asked the same question; their answers never reach the game. At a cast, what they would have
 * done is saved for the chat.
 */
export class WatchedHunter implements Hunter {
  id: string;
  everyTick?: boolean;
  private shadows: { id: string; hunter: Hunter }[];
  private lastOpinions: Opinion[] = [];
  private lastObs: Observation | null = null;

  constructor(
    readonly inner: Hunter,
    others: HunterEntry[],
  ) {
    this.id = inner.id;
    this.everyTick = inner.everyTick;
    this.shadows = others.map((e) => ({ id: e.id, hunter: e.make() }));
  }

  reset(seed: number) {
    this.inner.reset(seed);
    for (const s of this.shadows) s.hunter.reset(seed);
  }

  decide(obs: Observation) {
    this.lastObs = obs;
    // Shadows are synchronous hand-written or tiny-model players, so this costs microseconds.
    const opinions = this.shadows.map((s) => ({ speaker: s.id, pick: pickFor(s.hunter.decide(obs) as Action, obs) }));
    if (obs.line === 'idle') this.lastOpinions = opinions;
    return this.inner.decide(obs);
  }

  /** The other players' picks at the streamer's latest cast decision. */
  opinionsAtCast(action: { x: number; y: number }): { pick: Pick; opinions: Opinion[] } {
    const pick = this.lastObs ? pickFor({ type: 'cast', ...action }, this.lastObs) : ({ kind: 'spot', x: Math.round(action.x) } as Pick);
    return { pick, opinions: this.lastOpinions };
  }
}

const DRY_SECONDS = 25;

/** Turns a tick's raw game events into moments the stream reacts to. One per run of the game. */
export class MomentTracker {
  private lastCatchTick = 0;
  private lastDryTick = 0;

  constructor(private watched: () => WatchedHunter | null) {}

  start(): Moment[] {
    this.lastCatchTick = 0;
    this.lastDryTick = 0;
    return [{ kind: 'start' }];
  }

  onEvents(events: GameEvent[], game: Game): Moment[] {
    const out: Moment[] = [];
    for (const e of events) {
      switch (e.type) {
        case 'cast': {
          const w = this.watched();
          if (w) out.push({ kind: 'cast', ...w.opinionsAtCast(e) });
          break;
        }
        case 'splash':
          if (e.scared >= 2) out.push({ kind: 'scared', count: e.scared });
          break;
        case 'catch':
          this.lastCatchTick = game.tick;
          out.push({ kind: 'catch', fish: fishRef(e.species) });
          break;
        case 'stolen':
          out.push({ kind: 'stolen', fish: fishRef(e.species) });
          break;
        case 'empty':
          out.push({ kind: 'empty' });
          break;
        case 'end':
          out.push({ kind: 'end', score: e.score, catches: e.catches });
          break;
      }
    }
    const since = Math.max(this.lastCatchTick, this.lastDryTick);
    if (game.running && game.tick - since > DRY_SECONDS * TICKS_PER_SECOND) {
      this.lastDryTick = game.tick;
      out.push({ kind: 'dry', seconds: Math.round((game.tick - this.lastCatchTick) / TICKS_PER_SECOND) });
    }
    return out;
  }
}

export const contextOf = (game: Game, streamer: string): Context => ({
  streamer,
  score: game.stats.score,
  catches: game.stats.catches,
  secondsLeft: Math.ceil(game.ticksLeft / TICKS_PER_SECOND),
});
