import { HEIGHT, WIDTH } from '../../adapters/types';
import { WAIT, type Action, type FishView, type Hunter, type Observation } from '../types';
import { leadFor } from './heuristic';
import weights from './clone-weights.json';

/**
 * A small neural network trained to copy the heuristic (training/clone.ipynb), split into
 * a brain and hands. The network decides: wait, reel or cast, and which of the 5 nearest
 * fish to go after. The heuristic's own aiming code (leadFor) decides where the hook lands.
 *
 * It's three layers of plain multiply-and-add over about 7,300 numbers, so it runs in
 * microseconds with no ML library.
 */
export class CloneHunter implements Hunter {
  id = 'clone';

  reset() {}

  decide(obs: Observation): Action {
    const out = forward(encode(obs));
    const kind = argmax(out.slice(0, 3));
    if (kind === 0) return WAIT;
    if (kind === 1) return { type: 'reel' };
    // A cast: the network's favorite fish first, skipping any that are scared, missing,
    // or about to turn at the glass.
    const fish = nearestFish(obs);
    const order = out
      .slice(3)
      .map((score, j) => ({ score, j }))
      .sort((a, b) => b.score - a.score);
    for (const { j } of order) {
      if (j >= fish.length || fish[j].scared) continue;
      const spot = leadFor(fish[j], obs);
      if (spot) return { type: 'cast', x: spot.x, y: spot.y };
    }
    return WAIT;
  }
}

const LINE_STATES = ['idle', 'casting', 'waiting', 'nibble', 'reeling'];
const K = weights.K;

/** The fish encode() describes, in its order: nearest the hook, or the rod while the line is in. */
function nearestFish(obs: Observation): FishView[] {
  const start = obs.hook ?? obs.rod;
  const d2 = (f: FishView) => (f.x - start.x) ** 2 + (f.y - start.y) ** 2;
  return [...obs.fish].sort((a, b) => d2(a) - d2(b)).slice(0, K);
}

/**
 * The 40 numbers the network was trained on. A line-for-line port of encode() in
 * training/features.py; training/parity.py checks the two agree.
 */
export function encode(obs: Observation): number[] {
  const features: number[] = LINE_STATES.map((s) => (obs.line === s ? 1 : 0));
  if (obs.hook) features.push(obs.hook.x / WIDTH, obs.hook.y / HEIGHT);
  else features.push(0, 0);
  features.push(obs.freshness, obs.nibbleLeft / 24, obs.ticksLeft / 7200);
  const start = obs.hook ?? obs.rod;
  const nearest = nearestFish(obs);
  for (const f of nearest) {
    features.push((f.x - start.x) / WIDTH, (f.y - start.y) / HEIGHT, f.vx / 2, f.vy, f.points / 5, f.scared ? 1 : 0);
  }
  for (let i = nearest.length; i < K; i++) features.push(0, 0, 0, 0, 0, 0);
  return features;
}

/** Run the layers in order, ReLU between them. Each layer's w is (out, in), as PyTorch stores it. */
export function forward(input: number[]): number[] {
  let x = input;
  weights.layers.forEach((layer, i) => {
    const last = i === weights.layers.length - 1;
    x = layer.w.map((row, o) => {
      let sum = layer.b[o];
      for (let k = 0; k < row.length; k++) sum += row[k] * x[k];
      return last ? sum : Math.max(0, sum);
    });
  });
  return x;
}

function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
  return best;
}
