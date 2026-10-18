import type { Coat } from '../art';
import type { Hunter } from '../types';
import { HeuristicHunter } from './heuristic';
import { HumanHunter } from './human';
import { RandomHunter } from './random';
import { WaitHunter } from './wait';

export interface HunterEntry {
  id: string;
  /** People play at 1x; the score script skips them. */
  human?: boolean;
  /** Raincoat colors, so you can tell who's fishing at a glance. */
  coat: Coat;
  /** One or two plain sentences for the info panel. */
  blurb: string;
  make: () => Hunter;
}

/** The first entry is the page's default. */
export const HUNTERS: HunterEntry[] = [
  {
    id: 'heuristic',
    coat: { main: '#d8402a', shade: '#962a1a' },
    blurb: "hand-written rules, no learning. picks the fish worth the most per second, casts where it's headed, and reels the instant something bites.",
    make: () => new HeuristicHunter(),
  },
  {
    id: 'you',
    human: true,
    coat: { main: '#f0a020', shade: '#b06a10' },
    blurb: 'click to cast, click or space to reel. plays in real time.',
    make: () => new HumanHunter(),
  },
  {
    id: 'cast and wait',
    coat: { main: '#3aa04a', shade: '#1e6a2a' },
    blurb: "casts at the same spot every time and waits for a bite. a check on the rules: if it ever gets close to the heuristic, aiming doesn't matter enough.",
    make: () => new WaitHunter(),
  },
  {
    id: 'random',
    coat: { main: '#9a50c8', shade: '#62308a' },
    blurb: 'casts anywhere and reels whenever. the floor every other hunter has to clear.',
    make: () => new RandomHunter(),
  },
];

export { HumanHunter };
