import { opinionOf, pickText, slotOf, type LineRequest } from './lines';

/** The chat model's system message. Must match SYSTEM in training/voice.ipynb, which it was trained with. */
export const SYSTEM = "You write one short chat line for a pixel-art fishing stream, in the speaker's voice.";

/**
 * A request as plain text: who's talking, where, and what just happened. The teacher reads this
 * to write a line, the trained voice learns to answer it, and the browser builds the same text
 * at runtime, so all three always see the exact same thing.
 *
 *   speaker: model (chat)
 *   streamer: cast and wait
 *   moment: cast and wait caught a 5-pt blue tang
 *   run: 9 pts, 3 caught, 1:12 left
 */
export function describe(req: LineRequest): string {
  const { ctx, moment: m } = req;
  const you = req.role === 'streamer';
  const who = you ? 'you' : ctx.streamer === 'you' ? 'the human player' : ctx.streamer;
  const s = (yours: string, theirs: string) => (you ? yours : theirs);
  let what: string;
  switch (m.kind) {
    case 'start':
      what = 'the stream just started';
      break;
    case 'cast':
      what = `${who} cast at ${pickText(m.pick)}`;
      break;
    case 'scared':
      what = `${who} splashed too close and scared ${m.count} fish`;
      break;
    case 'catch':
      what = `${who} caught a ${m.fish.points}-pt ${m.fish.name}`;
      break;
    case 'stolen':
      what = `a ${m.fish.points}-pt ${m.fish.name} stole ${s('your', 'the')} bait`;
      break;
    case 'empty':
      what = `${who} reeled in nothing`;
      break;
    case 'dry':
      what = `${m.seconds}s without a catch`;
      break;
    case 'end':
      what = `the run is over: ${m.score} pts, ${m.catches} caught`;
      break;
  }
  const lines = [`speaker: ${req.speaker} (${you ? 'streaming' : 'chat'})`];
  if (!you) lines.push(`streamer: ${ctx.streamer === 'you' ? 'the human player' : ctx.streamer}`);
  lines.push(`moment: ${what}`);
  const mine = opinionOf(req);
  if (mine && !you) lines.push(`you would have cast at: ${pickText(mine.pick)}${slotOf(req) === 'cast_same' ? ' (the same)' : ''}`);
  const left = `${Math.floor(ctx.secondsLeft / 60)}:${String(ctx.secondsLeft % 60).padStart(2, '0')}`;
  if (m.kind !== 'end') lines.push(`run: ${ctx.score} pts, ${ctx.catches} caught, ${left} left`);
  return lines.join('\n');
}
