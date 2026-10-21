import type { Action, Hunter, Observation } from '../types';
import { choose, encode, forward } from './clone';
import weights from './battle-weights.json';

/**
 * The model, retrained for the battle bowl (training/train_battle.py): the same pick-a-fish
 * network as the solo clone, taught by the heuristic in battles against every other AI, and
 * told six more things about the other fisherman. Like every AI on the battle page it sees
 * the bowl from the left, facing right; the right-hand boat gets it mirrored.
 */
export class BattleModelHunter implements Hunter {
  id = 'model';

  reset() {}

  decide(obs: Observation): Action {
    return choose(forward(encodeBattle(obs), weights.layers), obs);
  }
}

/**
 * The 46 numbers: encode()'s 40 scaled to this bowl, then the other fisherman. A line-for-line
 * port of encode_battle() in training/features.py; training/parity.py --battle checks them.
 */
export function encodeBattle(obs: Observation): number[] {
  const { width: w, height: h } = obs.bowl;
  const features = encode(obs, w, h);
  const r = obs.rival;
  const start = obs.hook ?? obs.rod;
  if (r?.hook) features.push((r.hook.x - start.x) / w, (r.hook.y - start.y) / h, 1);
  else features.push(0, 0, 0);
  features.push(r && (r.line === 'waiting' || r.line === 'nibble') ? 1 : 0);
  features.push(r ? r.freshness : 0);
  features.push(r ? Math.max(-1, Math.min(1, (obs.score - r.score) / 20)) : 0);
  return features;
}
