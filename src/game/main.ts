import '../style.css';
import { HEIGHT, WIDTH } from '../adapters/types';
import { Game } from './game';
import { HUNTERS, HumanHunter } from './hunters';
import { RULES, TICKS_PER_SECOND } from './rules';
import { WAIT, type Hunter } from './types';
import { describeHunter, mountHunterPicker } from './picker';
import { GameView } from './view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const bowlEl = $<HTMLDivElement>('bowl');
const statusEl = $<HTMLParagraphElement>('status');
const startBtn = $<HTMLButtonElement>('start-btn');

const catches = (n: number) => `${n} ${n === 1 ? 'catch' : 'catches'}`;
const pts = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;
const MAX_TICKS_PER_FRAME = 120; // after a stall, catch up this much and drop the rest

let seed = 1;
let speed = 1;
let entry = HUNTERS[0];
let hunter: Hunter = entry.make();
const game = new Game(seed);
const view = new GameView();
const log: string[] = [];

// ---- bowl scale: 320x180 surface, nearest-neighbour up to the div's width ----
new ResizeObserver(() => {
  bowlEl.style.setProperty('--s', String(bowlEl.clientWidth / WIDTH));
}).observe(bowlEl);

// ---- you: click to cast, click or space to reel ----
function toBowl(e: PointerEvent) {
  const r = bowlEl.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * WIDTH) / r.width, y: ((e.clientY - r.top) * HEIGHT) / r.height };
}
bowlEl.addEventListener('pointerdown', (e) => {
  if (!(hunter instanceof HumanHunter)) return;
  if (!game.running) return start();
  const p = toBowl(e);
  hunter.press(p.x, p.y, game.line === 'idle');
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !(hunter instanceof HumanHunter) || !game.running) return;
  e.preventDefault();
  hunter.reel();
});

// ---- runs ----
function start() {
  view.clear();
  game.reset(seed);
  hunter.reset(seed);
  game.start();
  sync();
}

function stop() {
  view.clear();
  game.reset(seed);
  sync();
}

function finished() {
  const s = game.stats;
  log.unshift(`${entry.id} · seed ${seed} · ${catches(s.catches)} · ${pts(s.score)}`);
  log.length = Math.min(log.length, 6);
  $('log').textContent = log.join('\n');
  sync();
}

// ---- loop: fixed ticks, as many per frame as the speed asks for ----
let acc = 0;
let last = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = last ? now - last : 0;
  last = now;
  acc += (dt / 1000) * TICKS_PER_SECOND * speed;
  let n = Math.floor(acc);
  if (n > MAX_TICKS_PER_FRAME) {
    n = MAX_TICKS_PER_FRAME;
    acc = 0;
  } else acc -= n;
  for (let i = 0; i < n; i++) {
    const events = game.step(game.running ? hunter.decide(game.observe()) : WAIT);
    if (events.length) view.onEvents(events, game);
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
describeHunter(infoEl, entry);

mountHunterPicker($('hunter'), HUNTERS, (picked) => {
  entry = picked;
  describeHunter(infoEl, entry);
  hunter = entry.make();
  view.setCoat(entry.coat);
  if (entry.human) setSpeed(1); // people play in real time
  stop();
});

function setSpeed(s: number) {
  speed = s;
  document.querySelectorAll<HTMLAnchorElement>('[data-speed]').forEach((a) => a.classList.toggle('on', Number(a.dataset.speed) === s));
}

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
  if (game.running) parts.push(`${clock} left`, catches(s.catches), pts(s.score));
  else if (game.done) parts.push(`done`, catches(s.catches), pts(s.score));
  else parts.push(`${RULES.runTicks / TICKS_PER_SECOND / 60} min`, entry.human ? 'click start or the bowl' : `${speed}× speed`);
  statusEl.textContent = parts.join(' · ');
}
setInterval(drawStatus, 250);

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act], [data-speed]');
  if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.dataset.speed) return setSpeed(Number(el.dataset.speed));
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
  }
});

// ---- boot ----
async function boot() {
  const surface = document.createElement('div');
  surface.className = 'surface';
  bowlEl.appendChild(surface);
  await view.init(surface, game, entry.coat);
  setSpeed(speed);
  // The default hunter starts fishing right away, so the page opens on something happening.
  if (entry.human) sync();
  else start();
  requestAnimationFrame(frame);
}

void boot();
