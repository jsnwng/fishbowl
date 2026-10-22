/// <reference types="node" />
// Records what happens on a stream, for the voice's training set. Plays headless games with
// each player as the streamer (and "you", played by the model), runs the same moment tracking
// and shadow opinions as the chatter page, and writes one request per line that could be said:
// the streamer's own reaction, and each viewer's in chat.
//
//   npx tsx training/record_moments.ts [count]     -> training/data/moments.jsonl
//
// The count is how many requests to keep (default 1500), spread evenly over who's talking,
// where, and about what, so rare moments (the end of a run, stolen bait) aren't drowned out.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Game } from '../src/game/game';
import { HUNTERS } from '../src/game/hunters';
import { Match } from '../src/game/match';
import { cannedOptions, PERSONAS, slotOf, type LineRequest, type Role } from '../src/chatter/lines';
import { contextOf, MomentTracker, WatchedHunter } from '../src/chatter/moments';
import { describe } from '../src/chatter/prompt';
import { mulberry32 } from '../src/rng';

const keep = Number(process.argv[2] ?? 1500);
const GAMES_PER_STREAMER = 60;
const rng = mulberry32(2026);

const bots = HUNTERS.filter((h) => !h.human);
const streamers = [...bots.map((h) => ({ label: h.id, entry: h })), { label: 'you', entry: bots.find((h) => h.id === 'model')! }];

const all: LineRequest[] = [];
let seed = 1000; // well away from the seeds anything is scored on
for (const s of streamers) {
  for (let g = 0; g < GAMES_PER_STREAMER; g++) {
    const others = bots.filter((h) => s.label === 'you' || h !== s.entry);
    const watched = new WatchedHunter(s.entry.make(), others);
    const match = new Match(new Game(), watched);
    const tracker = new MomentTracker(() => watched);
    match.start(seed++);
    const emit = (ms: ReturnType<MomentTracker['start']>) => {
      const ctx = contextOf(match.game, s.label);
      for (const moment of ms) {
        if (s.label !== 'you') all.push({ speaker: s.label, role: 'streamer', moment, ctx });
        for (const o of others) all.push({ speaker: o.id, role: 'chat', moment, ctx });
      }
    };
    emit(tracker.start());
    while (match.game.running) emit(tracker.onEvents(match.step(), match.game));
  }
}

// Spread the kept requests evenly over (speaker, role, slot), shuffled within each group.
const groups = new Map<string, LineRequest[]>();
for (const r of all) {
  const key = `${r.speaker}|${r.role}|${slotOf(r)}`;
  if (!cannedOptions(r).length) continue; // no example line fits, so the teacher has nothing to go on
  (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
}
for (const g of groups.values()) {
  for (let i = g.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [g[i], g[j]] = [g[j], g[i]];
  }
}
const picked: LineRequest[] = [];
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
    role: r.role as Role,
    slot: slotOf(r),
    persona: PERSONAS[r.speaker],
    prompt: describe(r),
    examples: cannedOptions(r),
  }),
);
writeFileSync('training/data/moments.jsonl', out.join('\n') + '\n');
console.log(`${all.length} possible lines from ${streamers.length * GAMES_PER_STREAMER} games, ${groups.size} kinds; kept ${picked.length}`);
console.log(picked.slice(0, 2).map(describe).join('\n\n'));
