// The bridge between Python and the real game.
//
// Python starts this as a child process and talks to it in JSON, one message per line:
// it sends a command on stdin, and gets one reply on stdout. The game here is the same
// src/game code the website runs, so training and the site can never drift apart.
//
//   {"cmd":"reset","seed":1}         -> start a run, reply with the first decision point
//   {"cmd":"reset","seed":1,"battle":{"seat":1,"opponent":"random"}}
//                                    -> a battle instead: Python fishes from one boat (0 left,
//                                       1 right) against that opponent. From the right boat the
//                                       bowl is seen mirrored, as on the battle page.
//   {"cmd":"step","action":{...}}    -> answer the current decision point, reply with the next
//   {"cmd":"close"}                  -> exit
//
// Every reply: { obs, reward, done, stats, teacher }
//   obs      what the player sees now (src/game/types.ts Observation), null when done
//   reward   points scored since the previous reply
//   done     the run is over
//   stats    catches, casts, empties, ... so far (Python's boat, in a battle)
//   teacher  what the hand-written heuristic would do here, for behavior cloning
//
// Under the hood it's a Match in turn-based mode: the game pauses at each decision point
// until Python answers, exactly like `npm run score`. Same seed + same actions = same run.
import { createInterface } from 'node:readline';
import { Mirrored } from '../src/battle/mirror';
import { Game } from '../src/game/game';
import { HUNTERS } from '../src/game/hunters';
import { HeuristicHunter } from '../src/game/hunters/heuristic';
import { Match } from '../src/game/match';
import { BATTLE } from '../src/game/rules';
import type { Action, Hunter, Observation } from '../src/game/types';

/** A player whose decisions come from Python. decide() hands the observation out and waits. */
class RemoteHunter implements Hunter {
  id = 'python';
  asked: { obs: Observation; answer: (a: Action) => void } | null = null;
  reset() {
    this.asked = null;
  }
  decide(obs: Observation): Promise<Action> {
    return new Promise((answer) => (this.asked = { obs, answer }));
  }
}

const remote = new RemoteHunter();
const teacher = new HeuristicHunter();
const solo = new Match(new Game(), remote);
solo.mode = 'turns';
let match = solo;
let seat = 0;
let lastScore = 0;

/** A battle on the 384x216 bowl, Python in `at`, the named opponent in the other boat. */
function battle(at: number, opponent: string): Match {
  const entry = HUNTERS.find((h) => h.id === opponent && !h.human);
  if (!entry) throw new Error(`no opponent called ${opponent}`);
  const them = entry.make();
  const seats = at === 0 ? [remote, new Mirrored(them)] : [them, new Mirrored(remote)];
  const m = new Match(new Game(1, BATTLE), seats);
  m.mode = 'turns';
  return m;
}

/** Run the game until it needs a decision from Python or the run ends. */
async function advance() {
  while (match.game.running && !remote.asked) {
    match.step();
    await Promise.resolve(); // let an answered decision settle before the next step
  }
}

function reply() {
  const { stats } = match.game.lines[seat];
  const reward = stats.score - lastScore;
  lastScore = stats.score;
  const obs = remote.asked?.obs ?? null;
  // The teacher sees every decision point too, so its own timers stay in step with the run.
  const suggestion = obs ? teacher.decide(obs) : null;
  return { obs, reward, done: !match.game.running, stats, teacher: suggestion };
}

const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n');

async function handle(line: string) {
  const msg = JSON.parse(line);
  switch (msg.cmd) {
    case 'reset': {
      seat = msg.battle ? Number(msg.battle.seat ?? 0) : 0;
      match = msg.battle ? battle(seat, msg.battle.opponent ?? 'heuristic') : solo;
      match.start(msg.seed ?? 1);
      teacher.reset();
      lastScore = 0;
      await advance();
      return send(reply());
    }
    case 'step': {
      const asked = remote.asked;
      if (!asked) return send({ error: 'no decision is pending; call reset first' });
      remote.asked = null;
      asked.answer(msg.action as Action);
      await advance();
      return send(reply());
    }
    case 'close':
      process.exit(0);
    default:
      return send({ error: `unknown cmd ${msg.cmd}` });
  }
}

// Handle commands strictly one at a time, in order.
let queue: Promise<unknown> = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  queue = queue.then(() => handle(line)).catch((err) => send({ error: String(err) }));
});
