import type { Game } from '../game/game';
import { TICKS_PER_SECOND } from '../game/rules';
import type { GameEvent } from '../game/types';
import { fishRef, type FishRef } from '../chatter/moments';
import { PERSONAS } from '../chatter/lines';
import { mulberry32 } from '../rng';

/*
 * The AI talks to you while you fish against it: one line at a time, in a speech bubble over
 * its boat, in the same voice it has on the chatter page. This is what it reacts to, the lines it
 * says without a model, and the prompt the battle's chat model is trained and run on.
 */

/** Something worth a remark, from the AI's side: "me" is the AI, "you" is the human player. */
export type BattleMoment =
  | { kind: 'start' }
  | { kind: 'my_catch'; fish: FishRef }
  | { kind: 'your_catch'; fish: FishRef }
  | { kind: 'you_spooked_me'; count: number }
  | { kind: 'i_spooked_you'; count: number }
  | { kind: 'my_stolen'; fish: FishRef }
  | { kind: 'your_stolen'; fish: FishRef }
  | { kind: 'your_empty' }
  | { kind: 'lead'; who: 'me' | 'you' }
  | { kind: 'final' }
  | { kind: 'end'; result: 'win' | 'lose' | 'draw' };

/** The kinds of line, for the hand-written sets and for balancing the training data. */
export type BattleSlot = Exclude<BattleMoment['kind'], 'lead' | 'end'> | 'lead_me' | 'lead_you' | 'win' | 'lose' | 'draw';

export interface BattleContext {
  mine: number;
  yours: number;
  secondsLeft: number;
}

export interface BattleRequest {
  speaker: string;
  moment: BattleMoment;
  ctx: BattleContext;
}

export const slotOf = (m: BattleMoment): BattleSlot =>
  m.kind === 'lead' ? (m.who === 'me' ? 'lead_me' : 'lead_you') : m.kind === 'end' ? m.result : m.kind;

const AI = 1; // the AI's boat; you're 0
const SPOOK_RADIUS = 50; // a splash this close to the other hook counts as spooking its fish
const FINAL_SECONDS = 10;

/** Turns a battle's game events into moments, from the AI's side. One per round. */
export class BattleTracker {
  private leader: 'me' | 'you' | null = null;
  private saidFinal = false;

  start(): BattleMoment[] {
    this.leader = null;
    this.saidFinal = false;
    return [{ kind: 'start' }];
  }

  onEvents(events: GameEvent[], game: Game): BattleMoment[] {
    const out: BattleMoment[] = [];
    const mine = game.lines[AI];
    const yours = game.lines[1 - AI];
    for (const e of events) {
      switch (e.type) {
        case 'catch':
          out.push({ kind: e.line === AI ? 'my_catch' : 'your_catch', fish: fishRef(e.species) });
          break;
        case 'stolen':
          out.push({ kind: e.line === AI ? 'my_stolen' : 'your_stolen', fish: fishRef(e.species) });
          break;
        case 'empty':
          if (e.line !== AI) out.push({ kind: 'your_empty' });
          break;
        case 'splash': {
          // a splash that lands near the other fisherman's baited hook and scares fish there
          const other = e.line === AI ? yours : mine;
          const baited = other.state === 'waiting' && other.freshness > 0;
          const near = Math.abs(other.hookX - e.x) + Math.abs(other.hookY - e.y) < SPOOK_RADIUS;
          if (e.scared >= 2 && baited && near) out.push({ kind: e.line === AI ? 'i_spooked_you' : 'you_spooked_me', count: e.scared });
          break;
        }
        case 'end': {
          const [a, b] = [mine.stats.score, yours.stats.score];
          out.push({ kind: 'end', result: a > b ? 'win' : a < b ? 'lose' : 'draw' });
          break;
        }
      }
    }
    if (game.running) {
      const a = mine.stats.score;
      const b = yours.stats.score;
      const leader = a > b ? 'me' : b > a ? 'you' : this.leader;
      if (leader && leader !== this.leader && a + b > 0) {
        if (this.leader) out.push({ kind: 'lead', who: leader }); // a change, not the first point
        this.leader = leader;
      }
      if (!this.saidFinal && game.ticksLeft <= FINAL_SECONDS * TICKS_PER_SECOND) {
        this.saidFinal = true;
        out.push({ kind: 'final' });
      }
    }
    return out;
  }
}

export const battleContext = (game: Game): BattleContext => ({
  mine: game.lines[AI].stats.score,
  yours: game.lines[1 - AI].stats.score,
  secondsLeft: Math.ceil(game.ticksLeft / TICKS_PER_SECOND),
});

// ---- the prompt: the teacher, the trained model and the browser all see this text ----

/** The battle chat model's system message. Must match SYSTEM in training/train_voice.py --battle. */
export const BATTLE_SYSTEM = 'You write one short line a fisherman says to the human player fishing against them, in the fisherman\'s voice.';

const pts = (f: FishRef) => `${f.points}-pt ${f.name}`;

/**
 *   speaker: heuristic (fishing against the human player)
 *   moment: the human player caught a 3-pt angelfish
 *   score: you 12, the human player 9, 0:45 left
 */
export function describeBattle(req: BattleRequest): string {
  const m = req.moment;
  let what: string;
  switch (m.kind) {
    case 'start':
      what = 'the round just started';
      break;
    case 'my_catch':
      what = `you caught a ${pts(m.fish)}`;
      break;
    case 'your_catch':
      what = `the human player caught a ${pts(m.fish)}`;
      break;
    case 'you_spooked_me':
      what = `the human player's splash scared ${m.count} fish away from your hook`;
      break;
    case 'i_spooked_you':
      what = `your splash scared ${m.count} fish away from the human player's hook`;
      break;
    case 'my_stolen':
      what = `a ${pts(m.fish)} stole your bait`;
      break;
    case 'your_stolen':
      what = `a ${pts(m.fish)} stole the human player's bait`;
      break;
    case 'your_empty':
      what = 'the human player reeled in nothing';
      break;
    case 'lead':
      what = m.who === 'me' ? 'you just took the lead' : 'the human player just took the lead';
      break;
    case 'final':
      what = '10 seconds left';
      break;
    case 'end':
      what = m.result === 'win' ? 'the round is over and you won' : m.result === 'lose' ? 'the round is over and the human player won' : 'the round is over, a draw';
      break;
  }
  const { mine, yours, secondsLeft } = req.ctx;
  const left = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
  return [
    `speaker: ${req.speaker} (fishing against the human player)`,
    `moment: ${what}`,
    `score: you ${mine}, the human player ${yours}${m.kind === 'end' ? '' : `, ${left} left`}`,
  ].join('\n');
}

// ---- hand-written lines: the fallback, and the teacher's examples ----

// {fish} {pts} the fish · {mine} {yours} the scores · {count} fish scared
type Lines = Record<BattleSlot, string[]>;

export const BATTLE_LINES: Record<string, Lines> = {
  heuristic: {
    start: ['two minutes. may the better policy win.', 'I have the numbers. do you?'],
    my_catch: ['{fish}, {pts}. as calculated.', '{pts}. that is {mine} to {yours}.', 'textbook lead.'],
    your_catch: ['a {fish}. statistically, you were due.', 'noted. {yours} for you.', 'lucky angle.'],
    you_spooked_me: ['you splashed my fish. deliberate?', '{count} fish scared off my hook. rude.'],
    i_spooked_you: ['your fish were in my splash radius. sorry.', 'the splash radius is 22px. you were inside it.'],
    my_stolen: ['missed the strike window. once.', 'the {fish} got lucky.'],
    your_stolen: ['the window is 0.4s. reel faster.', 'that {fish} was yours to lose.'],
    your_empty: ['empty reel. inefficient.', 'nothing. recast with a lead.'],
    lead_me: ['back on top. as expected.', 'lead restored.'],
    lead_you: ['you lead. temporarily.', 'an anomaly. correcting.'],
    final: ['ten seconds. no wasted casts.', 'final ten. watch this.'],
    win: ['{mine} to {yours}. the math holds.', 'gg. optimal play wins.'],
    lose: ['{yours} to {mine}. I want a rematch.', 'gg. rerunning the numbers.'],
    draw: ['a draw. statistically unlikely.', 'even. again?'],
  },
  model: {
    start: ['hi! I learned from the heuristic, go easy on me!', "let's do this! I've been practicing!"],
    my_catch: ['I got a {fish}! did you see?', '{pts}! the heuristic would be proud!', 'yes! {mine} now!'],
    your_catch: ['nice {fish}! how did you aim that?', 'whoa, {pts} for you!', 'you are good at this!'],
    you_spooked_me: ['hey! those were my fish!', 'you scared {count} of my fish!'],
    i_spooked_you: ['oops, sorry about your fish!', 'did I scare your fish? sorry!'],
    my_stolen: ['oh no, the {fish} got away!', 'I reeled too late!'],
    your_stolen: ['oh, it took your bait!', 'so close! the {fish} got away!'],
    your_empty: ['nothing there? me neither sometimes!', 'empty! try leading the fish!'],
    lead_me: ['I am winning! really?', 'I took the lead!'],
    lead_you: ['you passed me! okay!', 'you are ahead now!'],
    final: ['ten seconds! hurry!', 'almost over!'],
    win: ['I won! good game!', '{mine} to {yours}! thank you for playing!'],
    lose: ['you won! good game!', 'gg! I will keep learning!'],
    draw: ['a tie! good game!', 'we tied! again?'],
  },
  'cast and wait': {
    start: ["take your time. the fish aren't going anywhere.", 'good day for it.'],
    my_catch: ['there it is. a {fish}.', 'patience pays. {pts}.', 'came right to me.'],
    your_catch: ['nice {fish}. you chased it though.', 'good one. {yours} for you.'],
    you_spooked_me: ["you're splashing my spot, friend.", "easy. you scared {count} off my hook."],
    i_spooked_you: ["didn't mean to. that's just where I always cast.", 'sorry. I only know the one spot.'],
    my_stolen: ['it took the bait. it happens.', "it'll be back."],
    your_stolen: ['you jumped at it. let it bite.', 'patience. that {fish} was yours.'],
    your_empty: ['nothing? you pulled too soon.', "you're reeling a lot."],
    lead_me: ['slow and steady.', 'still out here.'],
    lead_you: ["you're ahead. plenty of time.", "doesn't matter. I'll wait."],
    final: ['ten seconds. no rush.', 'almost done.'],
    win: ['good game. you move too much.', '{mine} to {yours}. patience.'],
    lose: ['good game. you earned it.', 'well fished.'],
    draw: ['a tie. fair enough.', 'even. good day for it.'],
  },
  random: {
    start: ['ok which way do I point this', 'hi!! do fish have names'],
    my_catch: ['WAIT I CAUGHT ONE', 'a {fish}?? how', 'lol {pts}'],
    your_catch: ['show off lol', 'how are you doing that', 'nice {fish} i guess'],
    you_spooked_me: ['hey those were my fish maybe', 'SPLASH lol'],
    i_spooked_you: ['did i do that lol', 'oops'],
    my_stolen: ['the {fish} stole it lol', 'rip my bait'],
    your_stolen: ['LOL it took your bait', 'rip'],
    your_empty: ['nothing lol same', 'we are the same'],
    lead_me: ['IM WINNING??', 'wait how am i ahead'],
    lead_you: ['ok fair', 'i was never winning'],
    final: ['10 seconds!! panic', 'CAST CAST CAST'],
    win: ['I WON?? gg', 'gg no idea how'],
    lose: ['gg lol', 'gg i tried'],
    draw: ['a tie lol', 'gg we are equal'],
  },
};

/** The hand-written options for a request, with the fish and scores filled in. */
export function battleOptions(req: BattleRequest): string[] {
  const m = req.moment;
  const lines = BATTLE_LINES[req.speaker]?.[slotOf(m)] ?? [];
  const fish = 'fish' in m ? m.fish : null;
  const count = 'count' in m ? m.count : 0;
  return lines.map((l) =>
    l
      .replaceAll('{fish}', fish?.name ?? 'fish')
      .replaceAll('{pts}', fish ? `${fish.points} ${fish.points === 1 ? 'pt' : 'pts'}` : '')
      .replaceAll('{mine}', String(req.ctx.mine))
      .replaceAll('{yours}', String(req.ctx.yours))
      .replaceAll('{count}', String(count)),
  );
}

export { PERSONAS };

/** Anything that can write a battle line: the hand-written ones, or the trained model. */
export interface BattleVoice {
  line(req: BattleRequest): Promise<string | null>;
}

/** Picks a hand-written line, not one it said recently. */
export class CannedBattleVoice implements BattleVoice {
  private rng = mulberry32(13);
  private recent: string[] = [];
  line(req: BattleRequest) {
    const options = battleOptions(req);
    const fresh = options.filter((o) => !this.recent.includes(o));
    const pool = fresh.length ? fresh : options;
    const text = pool.length ? pool[Math.floor(this.rng() * pool.length)] : null;
    if (text) this.recent = [...this.recent, text].slice(-10);
    return Promise.resolve(text);
  }
}

// How likely each moment is to get a line, and the gap between lines so the bubble can be read.
const ODDS: Record<BattleMoment['kind'], number> = {
  start: 1,
  my_catch: 0.6,
  your_catch: 0.6,
  you_spooked_me: 0.9,
  i_spooked_you: 0.7,
  my_stolen: 0.6,
  your_stolen: 0.7,
  your_empty: 0.25,
  lead: 0.9,
  final: 1,
  end: 1,
};
const GAP_MS = 3200;
const STALE_MS = 4000; // a line that took longer than this is about something else by now

/** Decides when the AI talks: one line at a time, the big moments first, never stale. */
export class BattleDirector {
  private rng = mulberry32(17);
  private last = -Infinity;
  private busy = false;

  constructor(
    private voice: () => BattleVoice,
    private onSay: (text: string) => void,
  ) {}

  react(moment: BattleMoment, speaker: string, ctx: BattleContext) {
    const now = performance.now();
    const must = moment.kind === 'end' || moment.kind === 'start';
    if (this.busy && !must) return;
    if (!must && (now - this.last < GAP_MS || this.rng() >= ODDS[moment.kind])) return;
    this.last = now;
    this.busy = true;
    void this.voice()
      .line({ speaker, moment, ctx })
      .then((text) => {
        this.busy = false;
        if (text && performance.now() - now <= STALE_MS) this.onSay(text);
      });
  }
}
