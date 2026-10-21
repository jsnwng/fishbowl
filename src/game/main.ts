import '../style.css';
import { HEIGHT, WIDTH } from '../adapters/types';
import { Recorder, detectRefreshMs } from '../metrics';
import { mountNav } from '../nav';
import { download } from '../ui/results';
import { Game } from './game';
import { HUNTERS, HumanHunter, type HunterEntry } from './hunters';
import { Match, type Mode } from './match';
import { describeHunter, mountHunterPicker } from './picker';
import { ReplayHunter, parseReplay, rulesHash, type Replay } from './replay';
import { decisionStats, loadResults, renderTable, saveResults, toCsv, type FishingResult } from './results';
import { RULES, TICKS_PER_SECOND } from './rules';
import { GameView } from './view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

mountNav();

const bowlEl = $<HTMLDivElement>('bowl');
const statusEl = $<HTMLParagraphElement>('status');
const startBtn = $<HTMLButtonElement>('start-btn');
const tableEl = $<HTMLTableElement>('results');
const replayFile = $<HTMLInputElement>('replay-file');

const catches = (n: number) => `${n} ${n === 1 ? 'catch' : 'catches'}`;
const pts = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;
const ms = (v: number) => (v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(0));
const MAX_TICKS_PER_FRAME = 120; // after a stall, catch up this much and drop the rest

let seed = 1;
let speed = 1;
let entry = HUNTERS[0];
const game = new Game(seed);
const match = new Match(game, entry.make());
const view = new GameView();
const rules = rulesHash();
let refreshMs = 1000 / 60;
let results: FishingResult[] = loadResults();
let lastReplay: Replay | null = null;
/** Set while a replay plays back; the picked hunter comes back when it ends. */
let replaying: Replay | null = null;
let note = ''; // one-off message for the status line, e.g. how a replay ended

// per frame during a run: dt, cpu (steps + render), and main-thread think time (Recorder's third slot)
let recorder: Recorder | null = null;

// ---- bowl scale: 320x180 surface, nearest-neighbour up to the div's width ----
new ResizeObserver(() => {
  bowlEl.style.setProperty('--s', String(bowlEl.clientWidth / WIDTH));
}).observe(bowlEl);

// ---- you: click to cast, click or space to reel ----
const human = () => (match.hunter instanceof HumanHunter ? match.hunter : null);
function toBowl(e: PointerEvent) {
  const r = bowlEl.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * WIDTH) / r.width, y: ((e.clientY - r.top) * HEIGHT) / r.height };
}
bowlEl.addEventListener('pointerdown', (e) => {
  const you = human();
  if (!you) return;
  if (!game.running) return start();
  const p = toBowl(e);
  you.press(p.x, p.y, game.line === 'idle');
});
document.addEventListener('keydown', (e) => {
  const you = human();
  if (e.code !== 'Space' || !you || !game.running) return;
  e.preventDefault();
  you.reel();
});

// ---- runs ----
function start() {
  if (replaying) endReplay();
  note = '';
  view.clear();
  match.start(seed);
  recorder = new Recorder();
  sync();
}

function stop() {
  if (replaying) endReplay();
  view.clear();
  match.stop(seed);
  recorder = null;
  sync();
}

function finished() {
  const s = game.stats;
  if (replaying) {
    const r = replaying;
    note = s.score === r.score && s.catches === r.catches ? `replay matches the run (${catches(s.catches)})` : `replay differs: recorded ${pts(r.score)}, got ${pts(s.score)}`;
    if (r.rules !== rules) note += ' · recorded under different rules';
    endReplay();
  } else {
    const frames = recorder?.stats(refreshMs);
    results.push({
      at: new Date().toISOString(),
      hunter: entry.id,
      mode: match.mode,
      speed,
      seed,
      catches: s.catches,
      score: s.score,
      asks: match.asks,
      ...decisionStats(match.decisions),
      frameP95: frames?.p95 ?? 0,
      dropPct: frames?.dropPct ?? 0,
      refreshHz: Math.round(1000 / refreshMs),
      rules,
    });
    saveResults(results);
    renderTable(tableEl, results);
    lastReplay = { v: 1, rules, seed, hunter: entry.id, mode: match.mode, catches: s.catches, score: s.score, actions: match.actions };
  }
  recorder = null;
  sync();
}

// ---- replays: a seed and a list of actions, played back through a ReplayHunter ----
function playReplay(r: Replay) {
  stop();
  replaying = r;
  seed = r.seed;
  match.hunter = new ReplayHunter(r);
  view.setCoat((HUNTERS.find((h) => h.id === r.hunter) ?? entry).coat);
  note = '';
  view.clear();
  match.start(seed);
  sync();
}

function endReplay() {
  replaying = null;
  match.hunter = entry.make();
  view.setCoat(entry.coat);
}

replayFile.addEventListener('change', async () => {
  const file = replayFile.files?.[0];
  replayFile.value = '';
  if (!file) return;
  try {
    playReplay(parseReplay(await file.text()));
  } catch {
    note = "couldn't read that replay file";
    drawStatus();
  }
});

// ---- loop: fixed ticks, as many per frame as the speed asks for ----
let acc = 0;
let last = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = last ? now - last : 0;
  last = now;
  const t0 = performance.now();
  acc += (dt / 1000) * TICKS_PER_SECOND * speed;
  let n = Math.floor(acc);
  if (n > MAX_TICKS_PER_FRAME) {
    n = MAX_TICKS_PER_FRAME;
    acc = 0;
  } else acc -= n;
  for (let i = 0; i < n; i++) {
    const events = match.step();
    if (match.blocked) {
      acc = 0; // turn based: the clock waits for the hunter, so don't bank time meanwhile
      break;
    }
    if (events.length) view.onEvents(events, game);
    if (events.some((e) => e.type === 'end')) finished();
  }
  view.draw(game);
  const think = match.takeMainMs();
  const cpu = performance.now() - t0;
  if (dt && game.running) recorder?.push(dt, cpu, think);
}

// ---- controls ----
const infoBtn = $<HTMLButtonElement>('hunter-info-btn');
const infoEl = $<HTMLDivElement>('hunter-info');
infoBtn.addEventListener('click', () => {
  infoEl.hidden = !infoEl.hidden;
  infoBtn.setAttribute('aria-expanded', String(!infoEl.hidden));
});
describeHunter(infoEl, entry);

mountHunterPicker($('hunter'), HUNTERS, (picked: HunterEntry) => {
  if (replaying) endReplay();
  entry = picked;
  describeHunter(infoEl, entry);
  match.hunter = entry.make();
  view.setCoat(entry.coat);
  if (entry.human) setSpeed(1); // people play in real time
  stop();
});

function setSpeed(s: number) {
  speed = s;
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s));
}

function setMode(m: Mode) {
  match.mode = m;
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
}

function sync() {
  startBtn.textContent = game.running ? '■ stop' : '▶ start';
  startBtn.dataset.act = game.running ? 'stop' : 'start';
  startBtn.classList.toggle('go', !game.running);
  startBtn.classList.toggle('stop', game.running);
  document.body.classList.toggle('no-replay', !lastReplay);
  drawStatus();
}

function drawStatus() {
  const s = game.stats;
  const secs = Math.ceil(game.ticksLeft / TICKS_PER_SECOND);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const parts = [replaying ? `replay: ${replaying.hunter}` : entry.id, `seed ${seed}`];
  if (game.running) {
    parts.push(`${clock} left`, catches(s.catches), pts(s.score));
    const recent = match.decisions.slice(-20);
    if (match.thinking) parts.push('thinking…');
    else if (recent.length && !replaying) parts.push(`think ${ms(decisionStats(recent).thinkP50)}ms`);
  } else if (game.done) parts.push('done', catches(s.catches), pts(s.score));
  else parts.push(`${RULES.runTicks / TICKS_PER_SECOND / 60} min`, entry.human ? 'click start or the bowl' : `${speed}× speed`);
  if (note) parts.push(note);
  statusEl.textContent = parts.join(' · ');
}
setInterval(drawStatus, 250);

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act], [data-speed], [data-mode]');
  if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.tagName === 'BUTTON') el.blur(); // so space reels instead of pressing the button again
  if (el.dataset.speed) return setSpeed(Number(el.dataset.speed));
  if (el.dataset.mode) {
    setMode(el.dataset.mode as Mode);
    return stop(); // a run is one mode start to finish
  }
  switch (el.dataset.act) {
    case 'start':
      start();
      break;
    case 'stop':
    case 'reset':
      stop();
      break;
    case 'seed':
      seed++;
      stop();
      break;
    case 'replay':
      if (lastReplay) playReplay(lastReplay);
      break;
    case 'export-replay':
      if (lastReplay) download(`fishbowl-replay-${lastReplay.hunter.replace(/\W+/g, '-')}-seed${lastReplay.seed}.json`, JSON.stringify(lastReplay), 'application/json');
      break;
    case 'load-replay':
      replayFile.click();
      break;
    case 'export-json':
      download('fishbowl-fisherman-results.json', JSON.stringify(results, null, 2), 'application/json');
      break;
    case 'export-csv':
      download('fishbowl-fisherman-results.csv', toCsv(results), 'text/csv');
      break;
    case 'clear':
      results = [];
      saveResults(results);
      renderTable(tableEl, results);
      break;
  }
});

// ---- boot ----
async function boot() {
  renderTable(tableEl, results);
  const surface = document.createElement('div');
  surface.className = 'surface';
  bowlEl.appendChild(surface);
  await view.init(surface, game, entry.coat);
  setSpeed(speed);
  setMode(match.mode);
  // The default hunter starts fishing right away, so the page opens on something happening.
  if (entry.human) sync();
  else start();
  requestAnimationFrame(frame);
  refreshMs = await detectRefreshMs();
}

void boot();
