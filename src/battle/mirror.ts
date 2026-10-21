import type { Action, Hunter, Observation } from '../game/types';

/**
 * Lets a hunter play from the right-hand boat as if it were on the left: it sees the bowl
 * flipped left to right, so its rod faces right like it always has, and its casts are flipped
 * back. The model learned facing right on the solo bowl; this way it never knows the difference.
 */
export class Mirrored implements Hunter {
  id: string;
  everyTick?: boolean;

  constructor(readonly inner: Hunter) {
    this.id = inner.id;
    this.everyTick = inner.everyTick;
  }

  reset(seed: number) {
    this.inner.reset(seed);
  }

  decide(obs: Observation): Action | Promise<Action> {
    const w = obs.bowl.width;
    const flip = (p: { x: number; y: number } | null) => p && { ...p, x: w - p.x };
    const seen: Observation = {
      ...obs,
      rod: { x: w - obs.rod.x, y: obs.rod.y, facing: -obs.rod.facing as 1 | -1 },
      hook: flip(obs.hook),
      fish: obs.fish.map((f) => ({ ...f, x: w - f.x, vx: -f.vx })),
      rival: obs.rival && { ...obs.rival, hook: flip(obs.rival.hook) },
    };
    const back = (a: Action): Action => (a.type === 'cast' ? { ...a, x: w - a.x } : a);
    const answer = this.inner.decide(seen);
    return answer instanceof Promise ? answer.then(back) : back(answer);
  }
}
