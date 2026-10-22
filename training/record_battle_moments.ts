/// <reference types="node" />
// Records what happens in battles, for the battle chat model's training set. Plays headless
// battles with each AI in the right-hand boat and a stand-in for "you" in the left (every AI
// takes a turn as you), runs the same moment tracking as the battle page, and writes one
// request per line the AI could say.
//
//   npx tsx training/record_battle_moments.ts [count]     -> training/data/battle-moments.jsonl
//
// The count is how many to keep (default 1400), spread evenly over who's talking and about what,
// so rare moments (a draw, spooked fish) aren't drowned out.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Mirrored } from '../src/battle/mirror';
import { BattleTracker, PERSONAS, battleContext, battleOptions, describeBattle, slotOf, type BattleRequest } from '../src/battle/talk';
import { Game } from '../src/game/game';
import { HUNTERS } from '../src/game/hunters';
import { Match } from '../src/game/match';
import { BATTLE } from '../src/game/rules';
import { mulberry32 } from '../src/rng';

const keep = Number(process.argv[2] ?? 1400);
const GAMES = 12; // per pairing: 4 speakers x 4 stand-ins
const rng = mulberry32(2027);

const bots = HUNTERS.filter((h) => !h.human);
const make = (e: (typeof bots)[number]) => (e.battle ?? e.make)();

const all: BattleRequest[] = [];
let seed = 9000; // away from the seeds anything is scored on
for (const speaker of bots) {
  for (const you of bots) {
    for (let g = 0; g < GAMES; g++) {
      const match = new Match(new Game(1, BATTLE), [make(you), new Mirrored(make(speaker))]);
      match.mode = 'turns';
      const tracker = new BattleTracker();
      match.start(seed++);
      const emit = (ms: ReturnType<BattleTracker['start']>) => {
        for (const moment of ms) all.push({ speaker: speaker.id, moment, ctx: battleContext(match.game) });
      };
      emit(tracker.start());
      while (match.game.running) {
        if (match.thinking) await new Promise((r) => setTimeout(r));
        else emit(tracker.onEvents(match.step(), match.game));
      }
    }
  }
}

// Some moments almost never happen between two AIs (a draw, the heuristic losing, a close lead
// change), but they will against people. Top each one up with made-up scores that fit it, so the
// teacher has something to write for every kind. The prompt only ever shows the scores and the
// clock, so these read exactly like real ones.
const MIN_PER_KIND = 30;
const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const scoresFor = (who: 'me' | 'you' | 'even') => {
  const low = int(0, 30);
  const high = low + int(1, 10);
  return who === 'even' ? { mine: low, yours: low } : who === 'me' ? { mine: high, yours: low } : { mine: low, yours: high };
};
const made: Record<string, () => BattleRequest['moment'] & { at?: 'me' | 'you' | 'even'; secs?: number }> = {
  win: () => ({ kind: 'end', result: 'win', at: 'me', secs: 0 }),
  lose: () => ({ kind: 'end', result: 'lose', at: 'you', secs: 0 }),
  draw: () => ({ kind: 'end', result: 'draw', at: 'even', secs: 0 }),
  lead_me: () => ({ kind: 'lead', who: 'me', at: 'me' }),
  lead_you: () => ({ kind: 'lead', who: 'you', at: 'you' }),
  you_spooked_me: () => ({ kind: 'you_spooked_me', count: int(2, 5) }),
  i_spooked_you: () => ({ kind: 'i_spooked_you', count: int(2, 5) }),
};
for (const speaker of bots) {
  for (const [slot, moment] of Object.entries(made)) {
    const have = all.filter((r) => r.speaker === speaker.id && slotOf(r.moment) === slot).length;
    for (let i = have; i < MIN_PER_KIND; i++) {
      const { at, secs, ...m } = moment();
      const s = scoresFor(at ?? (['me', 'you', 'even'] as const)[int(0, 2)]);
      all.push({ speaker: speaker.id, moment: m as BattleRequest['moment'], ctx: { ...s, secondsLeft: secs ?? int(12, 110) } });
    }
  }
}

// Spread the kept requests evenly over (speaker, slot), shuffled within each group.
const groups = new Map<string, BattleRequest[]>();
for (const r of all) {
  const key = `${r.speaker}|${slotOf(r.moment)}`;
  if (!battleOptions(r).length) continue;
  (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
}
for (const g of groups.values()) {
  for (let i = g.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [g[i], g[j]] = [g[j], g[i]];
  }
}
const picked: BattleRequest[] = [];
for (let round = 0; picked.length < keep; round++) {
  let added = 0;
  for (const g of groups.values()) {
    if (round < g.length && picked.length < keep) {
      picked.push(g[round]);
      added++;
    }
  }
  if (!added) break;
}

mkdirSync('training/data', { recursive: true });
const out = picked.map((r, i) =>
  JSON.stringify({
    id: i,
    speaker: r.speaker,
    role: 'opponent',
    slot: slotOf(r.moment),
    persona: PERSONAS[r.speaker],
    prompt: describeBattle(r),
    examples: battleOptions(r),
  }),
);
writeFileSync('training/data/battle-moments.jsonl', out.join('\n') + '\n');
const sizes = [...groups.entries()].map(([k, g]) => `${k} ${g.length}`);
console.log(`${all.length} possible lines from ${bots.length * bots.length * GAMES} battles, ${groups.size} kinds; kept ${picked.length}`);
console.log(sizes.join(', '));
console.log(picked.slice(0, 2).map(describeBattle).join('\n\n'));
