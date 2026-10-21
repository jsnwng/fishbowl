import { HEIGHT, WIDTH } from './adapters/types';
import { mulberry32 } from './rng';

/** Top of the sand; fish and bubbles stay above this line. */
export const SAND_TOP = HEIGHT - 22;
/** Where the treasure chest sits; bubbles rise from its lid. */
export const CHEST_X = 246;

/** The sand's top and the chest's spot in a bowl of another size. The bench's bowl is the default. */
export const sandTopFor = (h: number) => h - (HEIGHT - SAND_TOP);
export const chestXFor = (w: number) => Math.round((CHEST_X * w) / WIDTH);

const WATER = ['#2b93c9', '#2586bb', '#1f78ac', '#1a6a9c', '#155c8b', '#114e7a', '#0d4169', '#0a3559', '#082a49', '#06203b'];

/** The canvas being painted: its size, and an x scaled from the 320-wide layout below. */
interface Paint {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  top: number;
  at: (x: number) => number;
}

function sandTop(p: Paint, x: number): number {
  return p.top + Math.round(Math.sin(x * 0.05) * 2 + Math.sin(x * 0.13 + 1) * 1);
}

function water({ ctx, w, h }: Paint) {
  const band = h / WATER.length;
  WATER.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, Math.floor(i * band), w, Math.ceil(band) + 1);
  });
  // Checkerboard dither on each band edge so the gradient reads as 8-bit, not banded.
  for (let i = 1; i < WATER.length; i++) {
    const y = Math.floor(i * band);
    ctx.fillStyle = WATER[i - 1];
    for (let x = 0; x < w; x += 2) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = WATER[i];
    for (let x = 1; x < w; x += 2) ctx.fillRect(x, y - 1, 1, 1);
  }
}

function lightRays(p: Paint) {
  const rays = [
    { x: 40, w: 14, slope: 0.35 },
    { x: 95, w: 8, slope: 0.35 },
    { x: 150, w: 18, slope: 0.35 },
    { x: 230, w: 10, slope: 0.35 },
  ];
  for (const r of rays) {
    for (let y = 0; y < p.top; y++) {
      const alpha = 0.09 * (1 - y / p.top);
      p.ctx.fillStyle = `rgba(200, 240, 255, ${alpha.toFixed(3)})`;
      p.ctx.fillRect(Math.round(p.at(r.x) + y * r.slope), y, r.w, 1);
    }
  }
}

function sand(p: Paint, rnd: () => number) {
  const { ctx, w, h } = p;
  for (let x = 0; x < w; x++) {
    const top = sandTop(p, x);
    ctx.fillStyle = '#e0c48a';
    ctx.fillRect(x, top, 1, 1);
    ctx.fillStyle = '#c2a061';
    ctx.fillRect(x, top + 1, 1, h - top - 1);
  }
  const speckles = ['#a8844a', '#dcc088', '#b8945a'];
  const count = Math.round((260 * w) / WIDTH);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * w);
    const y = sandTop(p, x) + 2 + Math.floor(rnd() * (h - p.top));
    ctx.fillStyle = speckles[i % speckles.length];
    ctx.fillRect(x, y, 1, 1);
  }
}

function rock(p: Paint, cx: number, rx: number, ry: number) {
  cx = p.at(cx);
  const base = sandTop(p, cx) + 2;
  for (let y = -ry; y <= 0; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
      const lit = x < -rx / 3 && y < -ry / 3;
      const dark = x > rx / 3 || y > -2;
      p.ctx.fillStyle = lit ? '#8a94a0' : dark ? '#3e454e' : '#5b6470';
      p.ctx.fillRect(cx + x, base + y, 1, 1);
    }
  }
}

function seaweed(p: Paint, x0: number, height: number, phase: number) {
  const { ctx } = p;
  x0 = p.at(x0);
  const base = sandTop(p, x0) + 1;
  for (let i = 0; i < height; i++) {
    const y = base - i;
    const x = x0 + Math.round(Math.sin(i * 0.15 + phase) * 2);
    ctx.fillStyle = '#1d5e29';
    ctx.fillRect(x - 1, y, 1, 1);
    ctx.fillStyle = '#2e8b3e';
    ctx.fillRect(x, y, 2, 1);
    ctx.fillStyle = '#4fb85c';
    if (i % 3 === 0) ctx.fillRect(x + 1, y, 1, 1);
    // little leaves every few pixels, alternating sides
    if (i > 4 && i % 7 === 0) {
      const side = (i / 7) % 2 === 0 ? -1 : 1;
      ctx.fillStyle = '#2e8b3e';
      ctx.fillRect(side < 0 ? x - 3 : x + 2, y, 2, 1);
      ctx.fillRect(side < 0 ? x - 4 : x + 4, y - 1, 1, 1);
    }
  }
}

const CHEST = [
  '..oooooooooo..',
  '.obbbbbbbbbbo.',
  'obbgbbbbbbgbbo',
  'oooooooooooooo',
  'obbbbbyybbbbbo',
  'obbgbbyybbgbbo',
  'obbbbbbbbbbbbo',
  'oooooooooooooo',
];
const CHEST_COLORS: Record<string, string> = { o: '#3a200c', b: '#8a5226', g: '#e8b830', y: '#ffe060' };

function chest(p: Paint) {
  const cx = chestXFor(p.w);
  const y0 = sandTop(p, cx + 7) - CHEST.length + 3;
  CHEST.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === '.') return;
      p.ctx.fillStyle = CHEST_COLORS[c];
      p.ctx.fillRect(cx + x, y0 + y, 1, 1);
    });
  });
}

/**
 * Paints the static scenery once. Fresh canvas each call, like the atlas. Another size keeps
 * the same layout, spread to the new width (the battle bowl is 384x216).
 */
export function buildBackground(w = WIDTH, h = HEIGHT): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const p: Paint = { ctx: canvas.getContext('2d')!, w, h, top: sandTopFor(h), at: (x) => Math.round((x * w) / WIDTH) };
  const rnd = mulberry32(1987);

  water(p);
  lightRays(p);
  seaweed(p, 22, 70, 0);
  seaweed(p, 30, 48, 2);
  seaweed(p, 118, 58, 1);
  seaweed(p, 205, 80, 3);
  seaweed(p, 212, 52, 5);
  seaweed(p, 298, 64, 4);
  sand(p, rnd);
  rock(p, 64, 12, 8);
  rock(p, 78, 7, 5);
  rock(p, 170, 16, 10);
  rock(p, 280, 9, 6);
  chest(p);
  return canvas;
}
