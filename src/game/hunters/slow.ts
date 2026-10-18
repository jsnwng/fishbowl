import type { Action, Hunter, Observation } from '../types';
import { HeuristicHunter } from './heuristic';

/**
 * The heuristic with a fake think time: same decisions, each one arriving `delayMs` late.
 * It's a stand-in for a model while the harness gets built, and it shows what thinking time
 * alone costs in real time.
 */
export class SlowHunter implements Hunter {
  private inner = new HeuristicHunter();

  constructor(
    readonly id: string,
    private delayMs: number,
  ) {}

  reset() {
    this.inner.reset();
  }

  decide(obs: Observation): Promise<Action> {
    const action = this.inner.decide(obs);
    return new Promise((resolve) => setTimeout(() => resolve(action), this.delayMs));
  }
}
