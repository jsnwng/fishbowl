import { WAIT, type Action, type Hunter } from '../types';

/** You. The page queues clicks and key presses; each one is spent on the next tick. */
export class HumanHunter implements Hunter {
  id = 'you';
  everyTick = true; // a click can come at any moment
  private queued: Action | null = null;

  /** Click in the bowl: cast there if the line is in, otherwise reel. */
  press(x: number, y: number, lineIn: boolean) {
    this.queued = lineIn ? { type: 'cast', x, y } : { type: 'reel' };
  }

  reel() {
    this.queued = { type: 'reel' };
  }

  reset() {
    this.queued = null;
  }

  decide(): Action {
    const a = this.queued ?? WAIT;
    this.queued = null;
    return a;
  }
}
