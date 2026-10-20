import type { Context, Moment, Opinion, Pick } from './moments';

/**
 * Hand-written lines for each player, the baseline the trained voice has to beat. They also
 * fill in while the model loads, and show the teacher what each voice sounds like.
 *
 * Each player sounds like how it plays:
 *   heuristic       hand-written rules. precise, talks in points and pixels, a little smug.
 *   model           a small network that learned by watching the heuristic. earnest, defers to it.
 *   cast and wait   same spot every time. patient, unbothered, an old-timer.
 *   random          does anything. chaotic, off topic.
 */
export type Role = 'streamer' | 'chat';

/** Which set of lines a moment uses. A cast splits on whether the speaker would have done the same. */
export type Slot = Exclude<Moment['kind'], 'cast'> | 'cast' | 'cast_same' | 'cast_diff';

type Lines = Partial<Record<Slot, { streamer?: string[]; chat?: string[] }>>;

// {streamer} who's fishing · {fish} {pts} the fish in question (pts reads "1 pt", "5 pts") · {mine} what the speaker would
// have cast at · {theirs} what the streamer cast at · {score} {catches} {left} the run so far ·
// {count} fish scared · {seconds} since the last catch
export const LINES: Record<string, Lines> = {
  heuristic: {
    start: {
      streamer: ['two minutes. 30 fish. let\'s be efficient.', 'running the numbers before the first cast.'],
      chat: ['let\'s see some leads, {streamer}', 'two minutes on the clock. no wasted casts please'],
    },
    cast: { streamer: ['{theirs}. best points per second on the board.', 'leading the {fish} by a splash radius.'] },
    cast_same: { chat: ['same pick I\'d make. {theirs}', 'correct. {theirs} was the best value'] },
    cast_diff: { chat: ['{mine} was worth more per second', 'I\'d have gone {mine}. just saying', 'suboptimal. {mine} was right there'] },
    scared: {
      streamer: ['{count} spooked. landed too close.', 'splash radius is 22px. I know that.'],
      chat: ['that splash scared {count} fish', 'too close. {count} fish gone'],
    },
    catch: {
      streamer: ['{fish}, {pts}. right where the math said.', '{pts} more. {score} total.', 'textbook.'],
      chat: ['{fish} in the boat. acceptable', '{pts}, efficient', 'the numbers liked that {fish}'],
    },
    stolen: {
      streamer: ['missed the window on a {fish}. that one\'s on me.', 'the strike window is 0.4s. noted.'],
      chat: ['reel faster. 0.4s window', 'the {fish} took it. that was a timing error'],
    },
    empty: {
      streamer: ['nothing. resetting for a better angle.', 'empty reel. recasting.'],
      chat: ['empty reel. should have recast sooner', 'zero points on that one'],
    },
    dry: {
      streamer: ['{seconds}s without a catch. the fish are turning on me.', 'variance. it evens out.'],
      chat: ['{seconds}s and nothing. pick better targets', 'recast. the bait is stale by now'],
    },
    end: {
      streamer: ['{catches} catches, {score} pts. about what the numbers predict.', '{score} pts. I\'ll take it.'],
      chat: ['{score} pts. could be optimized', 'gg {streamer}, {catches} catches'],
    },
  },
  model: {
    start: {
      streamer: ['ok. I\'ll do what the heuristic would do. mostly.', 'hi chat. trying not to embarrass my teacher.'],
      chat: ['hi {streamer}!', 'good luck {streamer}, I\'m taking notes'],
    },
    cast: { streamer: ['{theirs}. I think that\'s what the heuristic would pick.', 'going for the {fish}. I\'ve seen this one before.'] },
    cast_same: { chat: ['I\'d pick {theirs} too', 'same as me. we learned from the same teacher'] },
    cast_diff: { chat: ['hm, I\'d have gone {mine}', 'pretty sure the heuristic says {mine}'] },
    scared: {
      streamer: ['oops. {count} fish scared. the heuristic wouldn\'t do that.', 'I copied that cast wrong.'],
      chat: ['{count} fish scared, I\'d avoid that', 'that splash was close'],
    },
    catch: {
      streamer: ['got a {fish}! just like I practiced.', '{pts}! the heuristic would be proud.', 'it worked!'],
      chat: ['nice {fish}!', 'I\'m learning so much from this', '{pts}, nice'],
    },
    stolen: {
      streamer: ['the {fish} got away. I hesitated.', 'I should have reeled. I knew that.'],
      chat: ['reel on the nibble! that\'s rule 3', 'unlucky, the {fish} took it'],
    },
    empty: {
      streamer: ['nothing on the hook. that one wasn\'t in my training data.', 'empty. trying again.'],
      chat: ['empty, happens', 'it\'s ok, recast'],
    },
    dry: {
      streamer: ['{seconds}s, no fish. I think I\'m doing it right?', 'still waiting. this felt different in practice.'],
      chat: ['{seconds}s without a catch, maybe recast?', 'what would the heuristic do here'],
    },
    end: {
      streamer: ['{catches} catches! almost as many as my teacher.', '{score} pts. I tried my best.'],
      chat: ['gg {streamer}!', '{catches} catches, great run'],
    },
  },
  'cast and wait': {
    start: {
      streamer: ['same spot as always. it hasn\'t let me down yet.', 'cast once, then wait. that\'s the whole secret.'],
      chat: ['take your time, {streamer}', 'patience out there'],
    },
    cast: { streamer: ['the usual spot.', 'right where I always cast.'] },
    cast_same: { chat: ['good spot. patience now', 'now you wait'] },
    cast_diff: { chat: ['you could just cast at the usual spot', 'why chase them? let them come to you', 'all that aiming. just wait'] },
    scared: {
      streamer: ['scared a few off. they\'ll be back.', 'no rush. they always come back.'],
      chat: ['that\'s what aiming gets you', 'calm down out there'],
    },
    catch: {
      streamer: ['there we go. a {fish}. waited for it.', 'see? good things come to those who wait.', 'a {fish}. worth the wait.'],
      chat: ['patience pays', 'nice {fish}', 'there you go'],
    },
    stolen: {
      streamer: ['the {fish} took the bait. it happens.', 'lost one. plenty more in the bowl.'],
      chat: ['happens to all of us', 'they\'ll be back'],
    },
    empty: {
      streamer: ['nothing. back to the usual spot.', 'empty. no matter.'],
      chat: ['no worries, cast again', 'empty. stay calm'],
    },
    dry: {
      streamer: ['{seconds}s. that\'s nothing. I\'ve waited longer.', 'quiet out here. I like it.'],
      chat: ['{seconds}s is nothing, keep waiting', 'stay put. they\'ll come'],
    },
    end: {
      streamer: ['{catches} catches. not bad for sitting still.', 'time\'s up. same spot next time.'],
      chat: ['gg {streamer}', '{catches} catches. respectable'],
    },
  },
  random: {
    start: {
      streamer: ['where is the bowl', 'ok who gave me a rod', 'i have no plan and i love that'],
      chat: ['first', 'hi {streamer} hi', 'is this the fish stream'],
    },
    cast: { streamer: ['casting somewhere. anywhere.', 'this way? sure'] },
    cast_same: { chat: ['WAIT i would have done that', 'same!! by accident'] },
    cast_diff: { chat: ['should have cast at the boat', 'i would have cast at the sky', 'left. no, right. no'] },
    scared: {
      streamer: ['bye fish', 'they run when they see me'],
      chat: ['SPLASH', '{count} fish just left the chat'],
    },
    catch: {
      streamer: ['wait it worked?', 'I CAUGHT A {fish}', 'no idea how that happened'],
      chat: ['WHAT', '{fish}!!!', 'clip it'],
    },
    stolen: {
      streamer: ['the {fish} said no', 'was I supposed to reel'],
      chat: ['lol', 'the {fish} wins'],
    },
    empty: {
      streamer: ['the hook is very clean', 'caught: nothing. again'],
      chat: ['empty lol', 'nothing!!'],
    },
    dry: {
      streamer: ['is it lunch', '{seconds}s of pure vibes'],
      chat: ['do fish sleep', 'try reeling backwards'],
    },
    end: {
      streamer: ['{catches} catches?? sure', 'that was a lot. what happened'],
      chat: ['gg', 'again again'],
    },
  },
};

export function pickText(pick: Pick): string {
  if (pick.kind === 'fish') return `the ${pick.fish.points}-pt ${pick.fish.name}`;
  if (pick.kind === 'spot') return 'that spot';
  return 'waiting';
}

const samePick = (a: Pick, b: Pick) =>
  a.kind === b.kind && (a.kind !== 'fish' || (b.kind === 'fish' && a.fish.name === b.fish.name)) && (a.kind !== 'spot' || (b.kind === 'spot' && Math.abs(a.x - b.x) < 12));

/** One request for a line: who's talking, in which role, about what. */
export interface LineRequest {
  speaker: string;
  role: Role;
  moment: Moment;
  ctx: Context;
}

/** The speaker's own opinion at a cast, if it had one. */
export const opinionOf = (req: LineRequest): Opinion | undefined =>
  req.moment.kind === 'cast' ? req.moment.opinions.find((o) => o.speaker === req.speaker) : undefined;

/** Which lines a request uses. */
export function slotOf(req: LineRequest): Slot {
  const m = req.moment;
  if (m.kind !== 'cast' || req.role === 'streamer') return m.kind;
  const mine = opinionOf(req);
  return mine && samePick(mine.pick, m.pick) ? 'cast_same' : 'cast_diff';
}

/** The values a line can mention. */
export function varsOf(req: LineRequest): Record<string, string> {
  const m = req.moment;
  const left = `${Math.floor(req.ctx.secondsLeft / 60)}:${String(req.ctx.secondsLeft % 60).padStart(2, '0')}`;
  const v: Record<string, string> = {
    streamer: req.ctx.streamer,
    score: String(req.ctx.score),
    catches: String(req.ctx.catches),
    left,
  };
  if (m.kind === 'catch' || m.kind === 'stolen') Object.assign(v, { fish: m.fish.name, pts: ptsText(m.fish.points) });
  if (m.kind === 'cast') {
    v.theirs = pickText(m.pick);
    if (m.pick.kind === 'fish') Object.assign(v, { fish: m.pick.fish.name, pts: ptsText(m.pick.fish.points) });
    const mine = opinionOf(req);
    if (mine) v.mine = pickText(mine.pick);
  }
  if (m.kind === 'scared') v.count = String(m.count);
  if (m.kind === 'dry') v.seconds = String(m.seconds);
  if (m.kind === 'end') Object.assign(v, { score: String(m.score), catches: String(m.catches) });
  return v;
}

const ptsText = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;

const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

/** Lines that can be said for a request: every template whose placeholders it can fill. */
export function cannedOptions(req: LineRequest): string[] {
  const set = LINES[req.speaker]?.[slotOf(req)]?.[req.role] ?? [];
  const vars = varsOf(req);
  return set.filter((t) => [...t.matchAll(/\{(\w+)\}/g)].every(([, k]) => k in vars)).map((t) => fill(t, vars));
}
