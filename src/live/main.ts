import '../style.css';
import { HEIGHT, WIDTH } from '../adapters/types';
import { mountNav } from '../nav';
import { Game } from '../game/game';
import { HUNTERS, HumanHunter, type HunterEntry } from '../game/hunters';
import { Match } from '../game/match';
import { describeHunter, mountHunterPicker } from '../game/picker';
import { TICKS_PER_SECOND } from '../game/rules';
import { GameView } from '../game/view';
import { CannedVoice, Director, type Voice } from './director';
import { ModelVoice } from './model-voice';
import { MomentTracker, WatchedHunter, contextOf, type Moment } from './moments';
import { StreamUI } from './stream';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

mountNav();

const bowlEl = $<HTMLDivElement>('bowl');
const statusEl = $<HTMLParagraphElement>('status');
const startBtn = $<HTMLButtonElement>('start-btn');

const NEXT_RUN_MS = 6000; // between runs, the stream rolls on to the next seed
const MAX_TICKS_PER_FRAME = 120;

// The model streams first: it's the player this page is about.
let entry = HUNTERS.find((h) => h.id === 'model') ?? HUNTERS[0];
let seed = 1;
const game = new Game(seed);
const view = new GameView();
const viewersOf = (e: HunterEntry) => HUNTERS.filter((h) => h !== e && !h.human).map((h) => h.id);
// you're watching too, unless you're the one fishing
const watching = (e: HunterEntry) => viewersOf(e).length + (e.human ? 0 : 1);
const watch = (e: HunterEntry) => new WatchedHunter(e.make(), HUNTERS.filter((h) => h !== e && !h.human));
const match = new Match(game, watch(entry));
match.mode = 'realtime';

const ui = new StreamUI($('bubble'), $('bubble-tail'), $('chat-log'), $('viewers'), HUNTERS);
const canned = new CannedVoice();
let model: ModelVoice | null = null;
let voice: Voice = canned;
const director = new Director(
  () => voice,
  (s) => ui.say(s),
);
const moments = new MomentTracker(() => (match.hunter instanceof WatchedHunter ? match.hunter : null));
let nextRun = 0;

function react(ms: Moment[]) {
  const ctx = contextOf(game, entry.id);
  for (const m of ms) director.react(m, ctx, entry.human ? null : entry.id, viewersOf(entry));
}

// ---- the chat model: hand-written lines until you load the trained one ----
const voiceEl = $<HTMLParagraphElement>('voice');
const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
function drawVoice() {
  if (voice === canned) {
    voiceEl.innerHTML = `chat: hand-written lines · <a href="#" data-act="model">use the trained model (${ModelVoice.mb} MB)</a>`;
  } else if (model) {
    const ms = model.msPerLine;
    voiceEl.innerHTML = `chat: trained model, on ${model.device === 'webgpu' ? 'your gpu' : 'your cpu'}${ms ? ` · ${Math.round(ms)} ms a line` : ''} · <a href="#" data-act="canned">hand-written</a>`;
  }
}
async function useModel() {
  if (model) {
    voice = model;
    return drawVoice();
  }
  voiceEl.textContent = 'chat: loading the trained model…';
  const m = new ModelVoice((loaded, total) => {
    voiceEl.textContent = `chat: loading the trained model, ${mb(loaded)}${total ? ` of ${mb(total)}` : ''}`;
  });
  try {
    await m.ready;
    model = m;
    voice = m;
    ui.notice(`trained model loaded in ${(m.loadMs / 1000).toFixed(1)}s`);
  } catch (err) {
    voiceEl.textContent = `chat: couldn't load the trained model (${(err as Error).message}). hand-written lines for now.`;
    return;
  }
  drawVoice();
}
setInterval(() => model && voice === model && drawVoice(), 2000);
drawVoice();

// ---- bowl scale and you ----
new ResizeObserver(() => {
  bowlEl.style.setProperty('--s', String(bowlEl.clientWidth / WIDTH));
}).observe(bowlEl);

const human = () => {
  const h = match.hunter instanceof WatchedHunter ? match.hunter.inner : match.hunter;
  return h instanceof HumanHunter ? h : null;
};
bowlEl.addEventListener('pointerdown', (e) => {
  const you = human();
  if (!you) return;
  if (!game.running) return start();
  const r = bowlEl.getBoundingClientRect();
  you.press(((e.clientX - r.left) * WIDTH) / r.width, ((e.clientY - r.top) * HEIGHT) / r.height, game.line === 'idle');
});
document.addEventListener('keydown', (e) => {
  const you = human();
  if (e.code !== 'Space' || !you || !game.running) return;
  e.preventDefault();
  you.reel();
});

// ---- runs ----
function start() {
  nextRun = 0;
  view.clear();
  ui.clearBubble();
  match.start(seed);
  react(moments.start());
  sync();
}

function stop() {
  nextRun = 0;
  view.clear();
  ui.clearBubble();
  match.stop(seed);
  sync();
}

function finished() {
  // a bot's stream rolls on by itself; yours waits for you
  if (!entry.human) nextRun = performance.now() + NEXT_RUN_MS;
  sync();
}

// ---- loop: real time only, a stream doesn't fast-forward ----
let acc = 0;
let last = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = last ? now - last : 0;
  last = now;
  if (nextRun && now >= nextRun) {
    seed++;
    start();
  }
  acc += (dt / 1000) * TICKS_PER_SECOND;
  let n = Math.floor(acc);
  if (n > MAX_TICKS_PER_FRAME) {
    n = MAX_TICKS_PER_FRAME;
    acc = 0;
  } else acc -= n;
  for (let i = 0; i < n; i++) {
    const events = match.step();
    if (events.length) view.onEvents(events, game);
    if (game.running || events.length) react(moments.onEvents(events, game));
    if (events.some((e) => e.type === 'end')) finished();
  }
  view.draw(game);
}

// ---- controls ----
const infoBtn = $<HTMLButtonElement>('hunter-info-btn');
const infoEl = $<HTMLDivElement>('hunter-info');
infoBtn.addEventListener('click', () => {
  infoEl.hidden = !infoEl.hidden;
  infoBtn.setAttribute('aria-expanded', String(!infoEl.hidden));
});

mountHunterPicker($('hunter'), HUNTERS, (picked) => {
  entry = picked;
  describeHunter(infoEl, entry);
  match.hunter = watch(entry);
  view.setCoat(entry.coat);
  ui.setViewers(watching(entry));
  ui.notice(entry.human ? "you're live" : `${entry.id} is live`);
  if (entry.human) stop();
  else start();
});
// the picker starts on its first entry; point it at the streamer instead
document.querySelector<HTMLInputElement>(`input[name="hunter"][value="${entry.id}"]`)!.checked = true;
describeHunter(infoEl, entry);

function sync() {
  startBtn.textContent = game.running ? 'stop' : 'start';
  startBtn.dataset.act = game.running ? 'stop' : 'start';
  startBtn.classList.toggle('primary', !game.running);
  startBtn.classList.toggle('stop', game.running);
  drawStatus();
}

function drawStatus() {
  const s = game.stats;
  const secs = Math.ceil(game.ticksLeft / TICKS_PER_SECOND);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const parts = [entry.id, `seed ${seed}`];
  if (game.running) parts.push(`${clock} left`, `${s.catches} caught`, `${s.score} pts`);
  else if (game.done) parts.push('done', `${s.catches} caught`, `${s.score} pts`, entry.human ? 'click start' : 'next run soon');
  else parts.push(entry.human ? 'click start or the bowl' : 'starting');
  statusEl.textContent = parts.join(' · ');
}
setInterval(drawStatus, 250);

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.dataset.act === 'model') void useModel();
  else if (el.dataset.act === 'canned') {
    voice = canned;
    drawVoice();
  } else if (el.dataset.act === 'start') start();
  else if (el.dataset.act === 'stop') stop();
  else if (el.dataset.act === 'seed') {
    seed++;
    start();
  }
});

// ---- boot ----
async function boot() {
  const surface = document.createElement('div');
  surface.className = 'surface';
  bowlEl.prepend(surface);
  await view.init(surface, game, entry.coat);
  ui.setViewers(watching(entry));
  ui.notice(entry.human ? "you're live" : `${entry.id} is live`);
  start();
  requestAnimationFrame(frame);
}

void boot();
