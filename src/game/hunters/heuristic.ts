import { RULES, SPECIES_RULES, WATERLINE } from '../rules';
import { WAIT, type Action, type FishView, type Hunter, type Observation } from '../types';

const RECAST_FRESHNESS = 0.35; // reel in and recast once the bait is this stale
const GIVE_UP_TICKS = 90; // ...or once nothing has come near it for this long
const LEAD_GAP = 4; // px past the splash radius, so the splash just misses

/**
 * Hand-written rules, no learning: pick the fish worth the most per tick of effort,
 * drop the hook in its path just outside splash range, and strike the instant it bites.
 *
 * This is a policy: observation in, action out. It's also the teacher a trained
 * policy will copy first.
 */
export class HeuristicHunter implements Hunter {
  id = 'heuristic';
  private lastNear = 0; // tick something last came near the hook

  reset() {
    this.lastNear = 0;
  }

  decide(obs: Observation): Action {
    switch (obs.line) {
      case 'idle':
        this.lastNear = obs.tick;
        return this.pickCast(obs) ?? WAIT;
      case 'nibble':
        return { type: 'reel' };
      case 'waiting': {
        if (obs.freshness < RECAST_FRESHNESS) return { type: 'reel' };
        const hook = obs.hook!;
        const reach = RULES.attractRadius * obs.freshness;
        const near = obs.fish.some((f) => !f.scared && Math.abs(f.x - hook.x) < reach && Math.abs(f.y - hook.y) < reach);
        if (near) this.lastNear = obs.tick;
        return obs.tick - this.lastNear > GIVE_UP_TICKS ? { type: 'reel' } : WAIT;
      }
      default:
        return WAIT;
    }
  }

  private pickCast(obs: Observation): Action | null {
    let best: { x: number; y: number; value: number } | null = null;
    for (const f of obs.fish) {
      if (f.scared) continue;
      const plan = leadFor(f, obs);
      if (plan && !rivalGetsItFirst(f, plan.x, obs) && (!best || plan.value > best.value)) best = plan;
    }
    return best ? { type: 'cast', x: best.x, y: best.y } : null;
  }
}

/**
 * In a battle: will this fish swim into the other fisherman's baited hook before it reaches
 * the spot we'd cast at? Then it's theirs, so pick another. Alone, nothing is ever skipped.
 */
function rivalGetsItFirst(f: FishView, castX: number, obs: Observation): boolean {
  const r = obs.rival;
  if (!r?.hook || (r.line !== 'casting' && r.freshness <= 0)) return false;
  const dir = f.vx > 0 ? 1 : -1;
  const toRival = (r.hook.x - f.x) * dir;
  const toOurs = (castX - f.x) * dir;
  return toRival > 0 && toRival < toOurs && Math.abs(r.hook.y - f.y) < RULES.attractRadius;
}

/**
 * Where to drop the hook so this fish swims into it, and what that's worth per tick.
 * Null if the fish will turn at the glass first. The clone uses this too: it picks the
 * fish, and this does the aiming.
 */
export function leadFor(f: FishView, obs: Observation) {
  const dx = f.x - obs.rod.x;
  const dy = f.y - obs.rod.y;
  const castTicks = RULES.castBaseTicks + Math.sqrt(dx * dx + dy * dy) * RULES.castTicksPerPx;
  const dir = f.vx > 0 ? 1 : -1;
  const lead = RULES.splashRadius * SPECIES_RULES[f.species].skittish + LEAD_GAP;
  const x = f.x + f.vx * castTicks + dir * lead;
  if (x < 8 || x > obs.bowl.width - 8) return null; // it'll turn at the glass first
  const y = Math.max(WATERLINE + 6, f.y);
  const swimTicks = lead / Math.max(0.1, Math.abs(f.vx));
  const value = f.points / (castTicks + swimTicks + RULES.reelTicks);
  return { x, y, value };
}
