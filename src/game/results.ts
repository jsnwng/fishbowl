import { percentile } from '../metrics';
import type { Decision, Mode } from './match';

/** One finished run, as the results table shows it. */
export interface FishingResult {
  at: string;
  hunter: string;
  mode: Mode;
  speed: number;
  seed: number;
  catches: number;
  score: number;
  asks: number;
  thinkP50: number;
  thinkP95: number;
  lagP95: number;
  frameP95: number;
  dropPct: number;
  refreshHz: number;
  rules: string;
}

/** p50/p95 think time and p95 lag over a run's decisions. */
export function decisionStats(decisions: Decision[]) {
  const think = Float64Array.from(decisions, (d) => d.thinkMs).sort();
  const lag = Float64Array.from(decisions, (d) => d.lagTicks).sort();
  return { thinkP50: percentile(think, 0.5), thinkP95: percentile(think, 0.95), lagP95: percentile(lag, 0.95) };
}

const KEY = 'fishbowl.fisherman.v1';

export function loadResults(): FishingResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FishingResult[]) : [];
  } catch {
    return [];
  }
}

export function saveResults(rows: FishingResult[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // storage unavailable (private window, quota): results still live for this page
  }
}

/** Think time reads from microseconds to seconds, so keep a couple of significant digits. */
const ms = (v: number) => (v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(0));
const n1 = (v: number) => v.toFixed(1);
const modeName = (m: Mode) => (m === 'turns' ? 'turn based' : 'real time');

interface Column {
  head: string;
  cell: (r: FishingResult) => string;
  csv: (r: FishingResult) => string | number;
}

const COLUMNS: Column[] = [
  { head: 'hunter', cell: (r) => r.hunter, csv: (r) => r.hunter },
  { head: 'mode', cell: (r) => modeName(r.mode), csv: (r) => r.mode },
  { head: 'speed', cell: (r) => `${r.speed}×`, csv: (r) => r.speed },
  { head: 'seed', cell: (r) => String(r.seed), csv: (r) => r.seed },
  { head: 'catches', cell: (r) => String(r.catches), csv: (r) => r.catches },
  { head: 'pts', cell: (r) => String(r.score), csv: (r) => r.score },
  { head: 'asks', cell: (r) => String(r.asks), csv: (r) => r.asks },
  { head: 'think p50', cell: (r) => ms(r.thinkP50), csv: (r) => r.thinkP50 },
  { head: 'think p95', cell: (r) => ms(r.thinkP95), csv: (r) => r.thinkP95 },
  { head: 'lag p95', cell: (r) => String(r.lagP95), csv: (r) => r.lagP95 },
  { head: 'frame p95', cell: (r) => n1(r.frameP95), csv: (r) => r.frameP95 },
  { head: 'drop%', cell: (r) => n1(r.dropPct), csv: (r) => r.dropPct },
];

export function renderTable(table: HTMLTableElement, rows: FishingResult[]) {
  const head = `<tr>${COLUMNS.map((c) => `<th>${c.head}</th>`).join('')}</tr>`;
  const body = rows.length
    ? rows
        .slice()
        .reverse()
        .map((r) => `<tr>${COLUMNS.map((c) => `<td>${escapeHtml(c.cell(r))}</td>`).join('')}</tr>`)
        .join('')
    : `<tr><td class="empty" colspan="${COLUMNS.length}">no finished runs yet</td></tr>`;
  table.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

export function toCsv(rows: FishingResult[]): string {
  const esc = (v: string | number) => (typeof v === 'number' ? String(+v.toFixed(3)) : `"${v.replace(/"/g, '""')}"`);
  const lines = [['at', ...COLUMNS.map((c) => c.head), 'refreshHz', 'rules'].map(esc).join(',')];
  for (const r of rows) lines.push([esc(r.at), ...COLUMNS.map((c) => esc(c.csv(r))), esc(r.refreshHz), esc(r.rules)].join(','));
  return lines.join('\n');
}

// Hunter names come from the registry and replay files, so escape them before they go into HTML.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
