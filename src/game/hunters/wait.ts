import { WATERLINE } from '../rules';
import { WAIT, type Action, type Hunter, type Observation } from '../types';

// The spot it always casts at: just in front of the rod, a fair way down.
const AHEAD = 18;
const DEPTH = WATERLINE + 60;

/**
 * Casts at the same spot every time and waits. Reels the moment something bites, and
 * only recasts once the bait is fully stale or gone. If this scores close to the
 * heuristic, the rules are too easy: aim and patience aren't paying off.
 */
export class WaitHunter implements Hunter {
  id = 'cast and wait';

  reset() {}

  decide(obs: Observation): Action {
    if (obs.line === 'idle') return { type: 'cast', x: obs.rod.x - AHEAD * obs.rod.facing, y: DEPTH };
    if (obs.line === 'nibble') return { type: 'reel' };
    if (obs.line === 'waiting' && obs.freshness <= 0) return { type: 'reel' };
    return WAIT;
  }
}
