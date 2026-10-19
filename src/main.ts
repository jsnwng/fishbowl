import './style.css';
import { RENDERERS } from './adapters';
import { mountNav } from './nav';
import { HEIGHT, WIDTH } from './adapters/types';
import { detectRefreshMs } from './metrics';
import { Bowl, type RunResult } from './runner';
import { download, loadResults, renderTable, saveResults, toCsv } from './ui/results';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

mountNav();

const bowlEl = $<HTMLDivElement>('bowl');
const statusEl = $<HTMLParagraphElement>('status');
const sparkEl = $<HTMLCanvasElement>('spark');
const tableEl = $<HTMLTableElement>('results');
const rendererSel = $<HTMLSelectElement>('renderer');
const runBtn = $<HTMLButtonElement>('run-btn');
const rampBtn = $<HTMLButtonElement>('ramp-btn');

const DEFAULT_FISH = 200;

const bowl = new Bowl(bowlEl);
let results: RunResult[] = loadResults();
let gzip: Record<string, number> = {};

// ---- bowl scale: 320x180 surface, nearest-neighbour up to the div's width ----
new ResizeObserver(() => {
  bowlEl.style.setProperty('--s', String(bowlEl.clientWidth / WIDTH));
}).observe(bowlEl);

// ---- cursor: fish flee it in free play (benchmarks switch this off in the runner) ----
function pointTo(e: PointerEvent) {
  const r = bowlEl.getBoundingClientRect();
  bowl.sim.setPointer(((e.clientX - r.left) * WIDTH) / r.width, ((e.clientY - r.top) * HEIGHT) / r.height);
}
bowlEl.addEventListener('pointermove', pointTo);
bowlEl.addEventListener('pointerdown', pointTo);
bowlEl.addEventListener('pointerleave', () => bowl.sim.clearPointer());
bowlEl.addEventListener('pointercancel', () => bowl.sim.clearPointer());
bowlEl.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') bowl.sim.clearPointer(); // a lifted finger isn't hovering
});

// ---- controls ----
rendererSel.innerHTML = RENDERERS.map((r) => `<option value="${r.id}">${r.id}</option>`).join('');
$('footnote').textContent = import.meta.env.DEV
  ? '* dev build: rough numbers. use npm run build.'
  : '* for clean numbers: one tab, no devtools.';

rendererSel.addEventListener('change', () => {
  if (!bowl.busy) void bowl.setRenderer(rendererSel.value);
});
function syncMenu() {
  const busy = bowl.busy;
  document.body.classList.toggle('busy', busy);
  if (bowl.rendererId) rendererSel.value = bowl.rendererId;
  rendererSel.disabled = busy;
  // What the buttons will measure, like the variant line under a product title.
  $('bench-sub').textContent = `${bowl.rendererId || '…'} · ${bowl.fish.toLocaleString()} fish`;
  // While anything runs, the primary button becomes the way out.
  runBtn.textContent = busy ? 'stop' : 'run 10s';
  runBtn.dataset.act = busy ? 'stop' : 'run';
  runBtn.classList.toggle('primary', !busy);
  runBtn.classList.toggle('stop', busy);
  rampBtn.disabled = busy;
}

// ---- status line + sparkline, 4x a second so the UI doesn't skew the frame loop ----
const spark = sparkEl.getContext('2d')!;

const FRAME_SCALE_MS = 50; // grey/red bars: 0..50ms, linear
const SIM_MIN_MS = 0.01; // aqua trace: 0.01..10ms, log scale, so microsecond sim costs still show
const SIM_MAX_MS = 10;
const SIM_SMOOTH = 8; // frames

function drawSpark() {
  const { width: w, height: h } = sparkEl;
  spark.clearRect(0, 0, w, h);
  const budget = bowl.refreshMs;
  spark.fillStyle = '#2a2a2a';
  spark.fillRect(0, h - Math.min(h, Math.round((budget / FRAME_SCALE_MS) * h)), w, 1);

  const dts = bowl.live.ordered('dt');
  const x0 = w - dts.length;
  dts.forEach((dt, i) => {
    const bar = Math.max(1, Math.min(h, Math.round((dt / FRAME_SCALE_MS) * h)));
    spark.fillStyle = dt > budget * 1.5 ? '#ff5a3c' : '#5a5a5a';
    spark.fillRect(x0 + i, h - bar, 1, bar);
  });

  // Rolling mean over a few frames: single readings sit near the timer's resolution.
  const span = Math.log10(SIM_MAX_MS / SIM_MIN_MS);
  const sims = bowl.live.ordered('sim');
  spark.fillStyle = '#19b3c4';
  let sum = 0;
  sims.forEach((ms, i) => {
    sum += ms - (i >= SIM_SMOOTH ? sims[i - SIM_SMOOTH] : 0);
    const avg = sum / Math.min(i + 1, SIM_SMOOTH);
    const level = Math.log10(Math.max(avg, SIM_MIN_MS) / SIM_MIN_MS) / span;
    const y = h - 1 - Math.round(Math.min(1, level) * (h - 1));
    spark.fillRect(x0 + i, y, 1, 1);
  });
}

function drawStatus() {
  const { fps, cpu, sim } = bowl.live.recent(30);
  const parts = [
    bowl.rendererId || '…',
    `${bowl.fish.toLocaleString()} fish`,
    `${fps.toFixed(0)} fps`,
    `cpu ${cpu.toFixed(1)}ms`,
    `sim ${sim < 0.1 ? sim.toFixed(2) : sim.toFixed(1)}ms`,
  ];
  if (bowl.task) parts.push(bowl.task);
  statusEl.textContent = parts.join(' · ');
}

const infoBtn = $<HTMLButtonElement>('spark-info-btn');
const infoEl = $<HTMLDivElement>('spark-info');
infoBtn.addEventListener('click', () => {
  infoEl.hidden = !infoEl.hidden;
  infoBtn.setAttribute('aria-expanded', String(!infoEl.hidden));
});

setInterval(() => {
  drawStatus();
  drawSpark();
}, 250);

// ---- results ----
function refreshTable() {
  renderTable(tableEl, results, gzip);
}

bowl.onResult = (r) => {
  results.push(r);
  saveResults(results);
  refreshTable();
};
bowl.onResultsPatched = () => {
  saveResults(results);
  refreshTable();
};
bowl.onChange = () => {
  syncMenu();
  drawStatus();
};

// ---- clicks ----
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act], [data-fish]');
  if (!el) return;
  if (el.tagName === 'A') e.preventDefault();

  if (el.dataset.fish) {
    if (!bowl.busy) bowl.setFish(bowl.fish + Number(el.dataset.fish));
    return;
  }
  switch (el.dataset.act) {
    case 'reset':
      if (!bowl.busy) {
        bowl.setFish(DEFAULT_FISH);
        bowl.sim.reset();
      }
      break;
    case 'run':
      void bowl.runFixed();
      break;
    case 'ramp':
      void bowl.runRamp();
      break;
    case 'run-all':
      void bowl.runAll('run');
      break;
    case 'ramp-all':
      void bowl.runAll('ramp');
      break;
    case 'stop':
      bowl.stop();
      break;
    case 'export-json':
      download('fishbowl-results.json', JSON.stringify({ gzipKB: gzip, results }, null, 2), 'application/json');
      break;
    case 'export-csv':
      download('fishbowl-results.csv', toCsv(results, gzip), 'text/csv');
      break;
    case 'clear':
      results = [];
      saveResults(results);
      refreshTable();
      break;
  }
});

// ---- boot ----
async function boot() {
  refreshTable();
  try {
    const res = await fetch('./bundle-sizes.json');
    if (res.ok) gzip = await res.json();
  } catch {
    // dev server: no build output yet, so the gzip column stays empty
  }
  refreshTable();
  bowl.refreshMs = await detectRefreshMs();
  $('refresh-ms').textContent = `${bowl.refreshMs.toFixed(1)}ms at ${Math.round(1000 / bowl.refreshMs)}hz`;
  bowl.setFish(DEFAULT_FISH);
  await bowl.setRenderer(RENDERERS[0].id);
}

void boot();
