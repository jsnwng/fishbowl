/// <reference types="node" />
// Plays every hunter over many seeds, headless and as fast as the CPU allows, and prints
// a table. Use it to tune src/game/rules.ts: the ordering should be heuristic > cast and
// wait > random, with clear gaps. Same seeds in, same numbers out.
//
//   npm run score                 20 seeds
//   npm run score -- --seeds 100
import { Game } from '../src/game/game';
import { HUNTERS } from '../src/game/hunters';
import type { Hunter, RunStats } from '../src/game/types';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const seeds = flag('seeds', 20);

function play(hunter: Hunter, seed: number): RunStats {
  const game = new Game(seed);
  hunter.reset(seed);
  game.start();
  while (!game.done) game.step(hunter.decide(game.observe()));
  return game.stats;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const fmt = (xs: number[]) => `${mean(xs).toFixed(1).padStart(5)} ± ${sd(xs).toFixed(1).padEnd(4)}`;

console.log(`${seeds} seeds per hunter\n`);
console.log(['hunter'.padEnd(14), 'catches'.padEnd(13), 'points'.padEnd(13), 'casts', 'empty', 'stolen', 'ms/run'].join('  '));
for (const entry of HUNTERS) {
  if (entry.human) continue;
  const hunter = entry.make();
  const runs: RunStats[] = [];
  const t0 = performance.now();
  for (let s = 1; s <= seeds; s++) runs.push(play(hunter, s));
  const ms = (performance.now() - t0) / seeds;
  const col = (k: keyof RunStats) => runs.map((r) => r[k]);
  console.log(
    [
      entry.id.padEnd(14),
      fmt(col('catches')),
      fmt(col('score')),
      mean(col('casts')).toFixed(0).padStart(5),
      mean(col('empties')).toFixed(0).padStart(5),
      mean(col('stolen')).toFixed(1).padStart(6),
      ms.toFixed(1).padStart(6),
    ].join('  '),
  );
}
