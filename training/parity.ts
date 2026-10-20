/// <reference types="node" />
// The TypeScript half of parity.py: replays saved observations through the browser
// clone and compares its features and choices with Python's. Run parity.py, not this.
import { readFileSync } from 'node:fs';
import { CloneHunter, encode } from '../src/game/hunters/clone';
import type { Action, Observation } from '../src/game/types';

const steps: { obs: Observation; features: number[]; action: Action }[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const hunter = new CloneHunter();
let worstFeature = 0;
let different = 0;
for (const step of steps) {
  const features = encode(step.obs);
  if (features.length !== step.features.length) throw new Error(`${features.length} features, python has ${step.features.length}`);
  features.forEach((v, i) => (worstFeature = Math.max(worstFeature, Math.abs(v - step.features[i]))));
  const a = hunter.decide(step.obs) as Action;
  const b = step.action;
  const same = a.type === b.type && (a.type !== 'cast' || (b.type === 'cast' && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9));
  if (!same) different++;
}
console.log(`features: largest difference ${worstFeature}`);
console.log(`choices: ${steps.length - different} of ${steps.length} the same`);
if (worstFeature > 1e-9 || different > 0) process.exit(1);
