/// <reference types="node" />
// Plays every hunter over many seeds, headless and as fast as the CPU allows, and prints
// a table. Use it to tune src/game/rules.ts: the ordering should be heuristic > cast and
// wait > random, with clear gaps. Same seeds in, same numbers out.
//
// Runs go through Match in turn-based mode, the same decision points as the page. Slow
// hunters really wait, so they're skipped unless you pass --all.
//
//   npm run score                 20 seeds
//   npm run score -- --seeds 100
//   npm run score -- --all        include slow hunters (minutes)
//   npm run score -- --battle     every AI against every AI in the battle bowl, both boats
import { Mirrored } from '../src/battle/mirror';
import { Game } from '../src/game/game';
import { HUNTERS } from '../src/game/hunters';
import { Match } from '../src/game/match';
import { BATTLE } from '../src/game/rules';
import { decisionStats } from '../src/game/results';
import type { RunStats } from '../src/game/types';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const seeds = flag('seeds', 20);
const all = args.includes('--all');
const battle = args.includes('--battle');

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const fmt = (xs: number[]) => `${mean(xs).toFixed(1).padStart(5)} ± ${sd(xs).toFixed(1).padEnd(4)}`;

if (battle) await battles();
else await solo();

async function solo() {
  console.log(`${seeds} seeds per hunter, turn based\n`);
  console.log(['hunter'.padEnd(14), 'catches'.padEnd(13), 'points'.padEnd(13), 'asks', 'casts', 'empty', 'stolen', 'think ms', 'ms/run'].join('  '));
  for (const entry of HUNTERS) {
    if (entry.human || (entry.slow && !all)) continue;
    const match = new Match(new Game(), entry.make());
    match.mode = 'turns';
    const runs: RunStats[] = [];
    const asks: number[] = [];
    const think: number[] = [];
    const t0 = performance.now();
    for (let s = 1; s <= seeds; s++) {
      match.start(s);
      await match.runToEnd();
      runs.push({ ...match.game.stats });
      asks.push(match.asks);
      think.push(decisionStats(match.decisions).thinkP50);
    }
    const ms = (performance.now() - t0) / seeds;
    const col = (k: keyof RunStats) => runs.map((r) => r[k]);
    console.log(
      [
        entry.id.padEnd(14),
        fmt(col('catches')),
        fmt(col('score')),
        mean(asks).toFixed(0).padStart(4),
        mean(col('casts')).toFixed(0).padStart(5),
        mean(col('empties')).toFixed(0).padStart(5),
        mean(col('stolen')).toFixed(1).padStart(6),
        mean(think).toFixed(4).padStart(8),
        ms.toFixed(1).padStart(6),
      ].join('  '),
    );
  }
}

/**
 * Each AI on the left boat against each AI on the right, the same seeds both ways round.
 * A cell is how often the left one wins, then the average points, left to right. The
 * diagonal (an AI against itself) should sit near 50%, or one boat has an edge.
 */
async function battles() {
  const bots = HUNTERS.filter((h) => !h.human && (!h.slow || all));
  console.log(`${seeds} seeds per pairing, battle bowl, turn based. rows: left boat, columns: right boat
`);
  console.log([''.padEnd(14), ...bots.map((b) => b.id.padEnd(18))].join('  '));
  for (const left of bots) {
    const cells: string[] = [];
    for (const right of bots) {
      const match = new Match(new Game(1, BATTLE), [left.make(), new Mirrored(right.make())]);
      match.mode = 'turns';
      let wins = 0;
      let draws = 0;
      const pts: [number, number][] = [];
      for (let s = 1; s <= seeds; s++) {
        match.start(s);
        await match.runToEnd();
        const [a, b] = match.game.lines.map((l) => l.stats.score);
        if (a > b) wins++;
        else if (a === b) draws++;
        pts.push([a, b]);
      }
      const pct = Math.round(((wins + draws / 2) / seeds) * 100);
      cells.push(`${String(pct).padStart(3)}%  ${mean(pts.map((p) => p[0])).toFixed(0).padStart(2)}-${mean(pts.map((p) => p[1])).toFixed(0).padEnd(2)}`.padEnd(18));
    }
    console.log([left.id.padEnd(14), ...cells].join('  '));
  }
}
