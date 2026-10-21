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
  id = 'model';

  reset() {}

  decide(obs: Observation): Action {
    return choose(forward(encode(obs)), obs);
  }
}

/**
 * The network's scores into an action: wait, reel, or a cast at its favorite fish, skipping
 * any that are scared, missing, or about to turn at the glass. The battle model shares this.
 */
export function choose(out: number[], obs: Observation): Action {
  const kind = argmax(out.slice(0, 3));
  if (kind === 0) return WAIT;
  if (kind === 1) return { type: 'reel' };
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

const LINE_STATES = ['idle', 'casting', 'waiting', 'nibble', 'reeling'];
const K = weights.K;

/** The fish encode() describes, in its order: nearest the hook, or the rod while the line is in. */
export function nearestFish(obs: Observation): FishView[] {
  const start = obs.hook ?? obs.rod;
  const d2 = (f: FishView) => (f.x - start.x) ** 2 + (f.y - start.y) ** 2;
  return [...obs.fish].sort((a, b) => d2(a) - d2(b)).slice(0, K);
}

/**
 * The 40 numbers the network was trained on. A line-for-line port of encode() in
 * training/features.py; training/parity.py checks the two agree.
 */
export function encode(obs: Observation, width = WIDTH, height = HEIGHT): number[] {
  const features: number[] = LINE_STATES.map((s) => (obs.line === s ? 1 : 0));
  if (obs.hook) features.push(obs.hook.x / width, obs.hook.y / height);
  else features.push(0, 0);
  features.push(obs.freshness, obs.nibbleLeft / 24, obs.ticksLeft / 7200);
  const start = obs.hook ?? obs.rod;
  const nearest = nearestFish(obs);
  for (const f of nearest) {
    features.push((f.x - start.x) / width, (f.y - start.y) / height, f.vx / 2, f.vy, f.points / 5, f.scared ? 1 : 0);
  }
  for (let i = nearest.length; i < K; i++) features.push(0, 0, 0, 0, 0, 0);
  return features;
}

export interface Layer {
  w: number[][];
  b: number[];
}

/** Run the layers in order, ReLU between them. Each layer's w is (out, in), as PyTorch stores it. */
export function forward(input: number[], layers: Layer[] = weights.layers): number[] {
  let x = input;
  layers.forEach((layer, i) => {
    const last = i === layers.length - 1;
    x = layer.w.map((row, o) => {
      let sum = layer.b[o];
      for (let k = 0; k < row.length; k++) sum += row[k] * x[k];
      return last ? sum : Math.max(0, sum);
    });
  });
  return x;
}

export function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
  return best;
}
