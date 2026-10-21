import '../style.css';
import { Game } from '../game/game';
import { HUNTERS, HumanHunter, type HunterEntry } from '../game/hunters';
import { Match } from '../game/match';
import { describeHunter, mountHunterPicker } from '../game/picker';
import { BATTLE, TICKS_PER_SECOND } from '../game/rules';
import { GameView } from '../game/view';
import { mountNav } from '../nav';
import { Hud } from './hud';
import { Mirrored } from './mirror';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

mountNav();

const bowlEl = $<HTMLDivElement>('bowl');
const statusEl = $<HTMLParagraphElement>('status');
const startBtn = $<HTMLButtonElement>('start-btn');
const recordEl = $<HTMLSpanElement>('record');

const MAX_TICKS_PER_FRAME = 120; // after a stall, catch up this much and drop the rest
const READY_MS = 1200; // READY, frozen, before the clock starts
const GO_MS = 700; // how long GO! stays up once it has
const RECORD_KEY = 'fishbowl-battle-record';

const YOU = HUNTERS.find((h) => h.human)!;
const OPPONENTS = HUNTERS.filter((h) => !h.human);
let opponent = OPPONENTS.find((h) => h.id === 'model')!;

const you = new HumanHunter();
const newSeed = () => 1 + Math.floor(Math.random() * 1_000_000);
let seed = newSeed();
const game = new Game(seed, BATTLE);
// The AI fishes from the right-hand boat, seeing the bowl flipped so it faces right like always.
const match = new Match(game, [you, new Mirrored(opponent.make())]);
const view = new GameView();
let hud: Hud;

/** idle: fish swim, nobody fishes. ready: frozen on READY. play: the clock runs. over: the result is up. */
type Phase = 'idle' | 'ready' | 'play' | 'over';
let phase: Phase = 'idle';
let phaseAt = 0;
let result = '';

// ---- the record against each opponent, kept in this browser ----
type Record = { w: number; l: number; d: number };
function loadRecord(): { [id: string]: Record } {
  try {
    return JSON.parse(localStorage.getItem(RECORD_KEY) ?? '{}');
  } catch {
    return {};
  }
}
let record = loadRecord();
const recordOf = (id: string) => record[id] ?? { w: 0, l: 0, d: 0 };
function addResult(mine: number, theirs: number) {
  const r = { ...recordOf(opponent.id) };
  if (mine > theirs) r.w++;
  else if (mine < theirs) r.l++;
  else r.d++;
  record = { ...record, [opponent.id]: r };
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(record));
  } catch {
    // private mode or storage off: the record lasts until the page closes
  }
}

// ---- bowl scale: 384x216 surface, nearest-neighbour up to the div's width ----
new ResizeObserver(() => {
  bowlEl.style.setProperty('--s', String(bowlEl.clientWidth / BATTLE.width));
}).observe(bowlEl);

// ---- you: click to cast, click or space to reel ----
function press(e?: PointerEvent) {
  if (phase === 'idle' || phase === 'over') return start();
  if (phase !== 'play') return;
  if (!e) return you.reel();
  const r = bowlEl.getBoundingClientRect();
  you.press(((e.clientX - r.left) * BATTLE.width) / r.width, ((e.clientY - r.top) * BATTLE.height) / r.height, game.lines[0].state === 'idle');
}
bowlEl.addEventListener('pointerdown', (e) => press(e));
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, select, textarea')) return;
  e.preventDefault();
  press();
});

// ---- rounds ----
function start() {
  seed = newSeed();
  match.stop(seed);
  view.clear();
  phase = 'ready';
  phaseAt = performance.now();
  sync();
}

function stop() {
  match.stop(seed);
  view.clear();
  phase = 'idle';
  sync();
}

function finished() {
  const [mine, theirs] = game.lines.map((l) => l.stats.score);
  addResult(mine, theirs);
  result = mine > theirs ? 'you win!' : mine < theirs ? `${opponent.id} wins` : 'draw';
  phase = 'over';
  phaseAt = performance.now();
  sync();
}

// ---- loop: real time only ----
let acc = 0;
let last = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = last ? now - last : 0;
  last = now;
  if (phase === 'ready' && now - phaseAt >= READY_MS) {
    match.start(seed);
    phase = 'play';
    phaseAt = now;
    acc = 0;
    sync();
  }
  if (phase !== 'ready') {
    acc += (dt / 1000) * TICKS_PER_SECOND;
    let n = Math.floor(acc);
    if (n > MAX_TICKS_PER_FRAME) {
      n = MAX_TICKS_PER_FRAME;
      acc = 0;
    } else acc -= n;
    for (let i = 0; i < n; i++) {
      const events = match.step();
      if (events.length) view.onEvents(events, game);
      if (events.some((e) => e.type === 'end')) finished();
    }
  }
  drawHud(now);
  view.draw(game);
}

function drawHud(now: number) {
  const [mine, theirs] = game.lines.map((l) => l.stats.score);
  const secs = Math.ceil(game.ticksLeft / TICKS_PER_SECOND);
  hud.scores({ name: 'you', score: mine, color: YOU.coat.main }, { name: opponent.id, score: theirs, color: opponent.coat.main }, secs);
  if (phase === 'idle') hud.say('ready?', 'click the bowl to start');
  else if (phase === 'ready') hud.say('ready');
  else if (phase === 'play') hud.say(now - phaseAt < GO_MS ? 'go!' : '');
  else hud.say(result, 'click for a rematch', result === 'you win!' ? '#ffe060' : '#ffffff');
}

// ---- the page around the bowl ----
const infoBtn = $<HTMLButtonElement>('hunter-info-btn');
const infoEl = $<HTMLDivElement>('hunter-info');
infoBtn.addEventListener('click', () => {
  infoEl.hidden = !infoEl.hidden;
  infoBtn.setAttribute('aria-expanded', String(!infoEl.hidden));
});

mountHunterPicker($('hunter'), OPPONENTS, (picked: HunterEntry) => {
  opponent = picked;
  describeHunter(infoEl, opponent);
  match.seats[1].hunter = new Mirrored(opponent.make());
  view.setCoat(opponent.coat, 1);
  stop();
});
// the picker starts on its first entry; point it at the default opponent instead
document.querySelector<HTMLInputElement>(`input[name="hunter"][value="${opponent.id}"]`)!.checked = true;
describeHunter(infoEl, opponent);

function sync() {
  const live = phase === 'ready' || phase === 'play';
  startBtn.textContent = live ? '■ stop' : phase === 'over' ? '▶ rematch' : '▶ start';
  startBtn.dataset.act = live ? 'stop' : 'start';
  startBtn.classList.toggle('go', !live);
  startBtn.classList.toggle('stop', live);
  const r = recordOf(opponent.id);
  recordEl.textContent = `vs ${opponent.id}: ${r.w} won · ${r.l} lost${r.d ? ` · ${r.d} drawn` : ''}`;
  drawStatus();
}

function drawStatus() {
  const [mine, theirs] = game.lines.map((l) => l.stats.score);
  const secs = Math.ceil(game.ticksLeft / TICKS_PER_SECOND);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const parts = [`you vs ${opponent.id}`];
  if (phase === 'play') parts.push(`${clock} left`, `${mine} to ${theirs}`);
  else if (phase === 'over') parts.push(result, `${mine} to ${theirs}`);
  else if (phase === 'ready') parts.push('ready');
  else parts.push('2 min', 'click start or the bowl');
  statusEl.textContent = parts.join(' · ');
}
setInterval(drawStatus, 250);

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el) return;
  if (el.tagName === 'BUTTON') el.blur(); // so space reels instead of pressing the button again
  if (el.dataset.act === 'start') start();
  else if (el.dataset.act === 'stop') stop();
});

// ---- boot ----
async function boot() {
  const surface = document.createElement('div');
  surface.className = 'surface';
  surface.style.width = `${BATTLE.width}px`;
  surface.style.height = `${BATTLE.height}px`;
  bowlEl.appendChild(surface);
  await view.init(surface, game, [YOU.coat, opponent.coat]);
  hud = new Hud(view.overlay, BATTLE.width);
  sync();
  requestAnimationFrame(frame);
}

void boot();
