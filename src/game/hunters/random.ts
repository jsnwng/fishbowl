import { WIDTH } from '../../adapters/types';
import { mulberry32 } from '../../rng';
import { RULES, WATERLINE } from '../rules';
import { WAIT, type Action, type Hunter, type Observation } from '../types';

/** Casts anywhere, reels whenever (odds per ask). The floor every other hunter has to clear. */
export class RandomHunter implements Hunter {
  id = 'random';
  private rng = mulberry32(0);

  reset(seed: number) {
    this.rng = mulberry32(Math.imul(seed, 97) + 3);
  }

  decide(obs: Observation): Action {
    const r = this.rng;
    if (obs.line === 'idle') {
      if (r() < 0.5) return { type: 'cast', x: r() * WIDTH, y: WATERLINE + 4 + r() * (RULES.maxY - WATERLINE) };
    } else if (obs.line === 'waiting' || obs.line === 'nibble') {
      if (r() < 0.25) return { type: 'reel' };
    }
    return WAIT;
  }
}
