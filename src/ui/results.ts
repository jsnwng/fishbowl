import type { RunResult } from '../runner';

const KEY = 'fishbowl.results.v1';

export function loadResults(): RunResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RunResult[]) : [];
  } catch {
    return [];
  }
}

export function saveResults(rows: RunResult[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // storage unavailable (private window, quota) — results still live for this page
  }
}

const n0 = (v: number) => Math.round(v).toLocaleString();
const n1 = (v: number) => v.toFixed(1);
const mb = (v: number | null) => (v === null ? 'n/a' : v.toFixed(1));
const kb = (v: number | undefined) => (v === undefined ? '—' : n0(v));

interface Column {
  head: string;
  cell: (r: RunResult, gzip: Record<string, number>) => string;
  csv: (r: RunResult, gzip: Record<string, number>) => string | number | null;
}

const COLUMNS: Column[] = [
  { head: 'renderer', cell: (r) => r.renderer, csv: (r) => r.renderer },
  { head: 'mode', cell: (r) => r.mode, csv: (r) => r.mode },
  { head: 'fish', cell: (r) => n0(r.fish), csv: (r) => r.fish },
  { head: 'fps', cell: (r) => n1(r.avgFps), csv: (r) => r.avgFps },
  { head: 'p50', cell: (r) => n1(r.p50), csv: (r) => r.p50 },
  { head: 'p95', cell: (r) => n1(r.p95), csv: (r) => r.p95 },
  { head: 'p99', cell: (r) => n1(r.p99), csv: (r) => r.p99 },
  { head: 'drop%', cell: (r) => n1(r.dropPct), csv: (r) => r.dropPct },
  { head: 'cpu', cell: (r) => n1(r.cpuAvg), csv: (r) => r.cpuAvg },
  { head: 'init', cell: (r) => n0(r.loadMs + r.initMs), csv: (r) => r.loadMs + r.initMs },
  { head: '1st', cell: (r) => n0(r.firstFrameMs), csv: (r) => r.firstFrameMs },
  { head: 'heap', cell: (r) => mb(r.heapPeakMB), csv: (r) => r.heapPeakMB },
  { head: 'leak', cell: (r) => mb(r.heapLeakMB), csv: (r) => r.heapLeakMB },
  { head: 'gzip kb', cell: (r, g) => kb(g[r.renderer]), csv: (r, g) => g[r.renderer] ?? null },
];

export function renderTable(table: HTMLTableElement, rows: RunResult[], gzip: Record<string, number>) {
  const head = `<tr>${COLUMNS.map((c) => `<th>${c.head}</th>`).join('')}</tr>`;
  const body = rows.length
    ? rows
        .slice()
        .reverse()
        .map((r) => `<tr>${COLUMNS.map((c) => `<td>${c.cell(r, gzip)}</td>`).join('')}</tr>`)
        .join('')
    : `<tr><td class="empty" colspan="${COLUMNS.length}">no runs yet</td></tr>`;
  table.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

export function toCsv(rows: RunResult[], gzip: Record<string, number>): string {
  const esc = (v: string | number | null) => (v === null ? '' : typeof v === 'number' ? String(+v.toFixed(3)) : `"${v.replace(/"/g, '""')}"`);
  const lines = [['at', ...COLUMNS.map((c) => c.head), 'refreshHz', 'frames', 'simAvg'].map((h) => esc(h)).join(',')];
  for (const r of rows) {
    lines.push([esc(r.at), ...COLUMNS.map((c) => esc(c.csv(r, gzip))), esc(r.refreshHz), esc(r.frames), esc(r.simAvg)].join(','));
  }
  return lines.join('\n');
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
