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
import type { Backend } from './model.worker';
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

// ---- the chat model: hand-written lines until the trained one loads ----
const statusLine = $<HTMLParagraphElement>('voice-status');
const toggles = document.querySelectorAll<HTMLButtonElement>('[data-voice]');
const mb = (n: number) => `${Math.round(n / 1e6)}`;
let loading: string | null = null; // the status while the model downloads
/**
 * Phones are off by default: on an iPhone the GPU path crashed the browser (memory, most likely:
 * iOS holds the weights both in memory and on the GPU, and kills the page over its limit).
 * ?phone=1 lets a phone try the CPU path (8-bit weights, held once) while that's being tested.
 */
const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
const phone =
  nav.userAgentData?.mobile ?? (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820));
const params = new URLSearchParams(location.search);
const phoneTest = params.has('phone');
const forceCpu = params.has('cpu'); // try the CPU path on a desktop
const blocked = phone && !phoneTest;
const backend: Backend = !phone && !forceCpu && 'gpu' in navigator ? { device: 'webgpu', dtype: 'q4f16' } : { device: 'wasm', dtype: 'q8', lowMemory: phone || params.has('low') };
const sizeMb = backend.device === 'webgpu' ? ModelVoice.mb : ModelVoice.mbCpu;

/**
 * Breadcrumbs: each loading step is saved, with its time, as it happens. If the page dies partway,
 * the next visit shows the trail in the status line and doesn't try again on its own, so a crash
 * can't loop before anyone reads it. On a phone there's no debugger to ask.
 */
const CRUMBS = 'fishbowl.live.model-load';
type Trail = { backend: string; start: number; steps: [string, number][]; done?: boolean };
let trail: Trail | null = null;
const saveTrail = () => {
  try {
    localStorage.setItem(CRUMBS, JSON.stringify(trail));
  } catch {}
};
const crumb = (stage: string) => {
  if (!trail || trail.done) return; // after the first line, loading is over and nothing more is recorded
  if (stage === 'done') trail.done = true;
  else trail.steps.push([stage, Date.now() - trail.start]);
  saveTrail();
};
/** The last try, if it never finished: "downloading the model 0.4s → setting up 9.8s → …" */
let lastTry = '';
try {
  const last: Trail | null = JSON.parse(localStorage.getItem(CRUMBS) ?? 'null');
  if (last && !last.done && last.steps?.length) {
    const [stage, ms] = last.steps[last.steps.length - 1];
    lastTry = `last try (${last.backend}) stopped at: ${stage} (${(ms / 1000).toFixed(1)}s)`;
    ui.notice(`${lastTry}. trail: ${last.steps.map(([st, t]) => `${st} ${(t / 1000).toFixed(1)}s`).join(' → ')}`);
  }
} catch {}

let failed = '';
function drawVoice() {
  const on = voice === canned ? 'canned' : 'model';
  toggles.forEach((t) => {
    const checked = t.dataset.voice === on;
    t.classList.toggle('on', checked);
    t.setAttribute('aria-checked', String(checked));
    if (t.dataset.voice === 'model') t.disabled = blocked;
  });
  let status: string;
  if (blocked) status = 'the trained model needs a desktop browser for now';
  else if (lastTry && voice === canned && !model && !loading) status = `${lastTry} · tap trained model to retry`;
  else if (failed) status = `the trained model couldn't load here: ${failed}`;
  else if (loading) status = loading;
  else if (voice === canned) status = model ? 'picked from a hand-written list' : `picked from a hand-written list · model is ${sizeMb} MB`;
  else {
    // round to 50 ms so the line doesn't twitch with every message
    const ms = model ? Math.round(model.msPerLine / 50) * 50 : 0;
    status = `${sizeMb} MB · your ${model?.device === 'webgpu' ? 'gpu' : 'cpu'}${ms ? ` · ~${ms} ms a line` : ''}`;
  }
  statusLine.textContent = status;
  // the one status that's allowed to wrap: it's read once, and on a phone it wouldn't fit
  statusLine.classList.toggle('wrap', status.startsWith('last try'));
}
async function useModel() {
  if (blocked) return drawVoice();
  if (model) {
    voice = model;
    return drawVoice();
  }
  if (loading) return;
  failed = '';
  loading = 'downloading the model…';
  lastTry = '';
  trail = { backend: backend.device, start: Date.now(), steps: [] };
  crumb('starting');
  drawVoice();
  const m = new ModelVoice(
    backend,
    (loaded, total) => {
      loading = `downloading the model · ${mb(loaded)}/${total ? mb(total) : sizeMb} MB`;
      drawVoice();
    },
    (stage) => {
      crumb(stage);
      if (stage.startsWith('downloaded')) {
        loading = 'setting up the model…';
        drawVoice();
      }
    },
  );
  try {
    await m.ready;
    crumb('ready, writing the first line');
    model = m;
    voice = m;
    ui.notice(`trained model loaded in ${(m.loadMs / 1000).toFixed(1)}s, on the ${m.device === 'webgpu' ? 'gpu' : 'cpu'}`);
    // the first line is the last risky step; after it, loading is done
    const t0 = Date.now();
    const wait = setInterval(() => {
      if (m.times.length) {
        crumb('done');
        clearInterval(wait);
      } else if (Date.now() - t0 > 60000) clearInterval(wait);
    }, 500);
  } catch (err) {
    failed = (err as Error).message;
    crumb(`error: ${failed}`);
  }
  loading = null;
  drawVoice();
}
toggles.forEach((t) =>
  t.addEventListener('click', () => {
    if (t.dataset.voice === 'model') void useModel();
    else {
      voice = canned;
      drawVoice();
    }
  }),
);
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
  if (el.dataset.act === 'start') start();
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
  // the game first, then the model: give the stream a moment to get going
  // not after an unfinished try: that might be a crash, and it shouldn't happen again unasked
  if (!blocked && !lastTry) setTimeout(() => void useModel(), 1500);
}

void boot();
