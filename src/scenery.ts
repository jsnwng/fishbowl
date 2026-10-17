import { HEIGHT, WIDTH } from './adapters/types';
import { mulberry32 } from './rng';

/** Top of the sand; fish and bubbles stay above this line. */
export const SAND_TOP = HEIGHT - 22;
/** Where the treasure chest sits; bubbles rise from its lid. */
export const CHEST_X = 246;

const WATER = ['#2b93c9', '#2586bb', '#1f78ac', '#1a6a9c', '#155c8b', '#114e7a', '#0d4169', '#0a3559', '#082a49', '#06203b'];

function sandTop(x: number): number {
  return SAND_TOP + Math.round(Math.sin(x * 0.05) * 2 + Math.sin(x * 0.13 + 1) * 1);
}

function water(ctx: CanvasRenderingContext2D) {
  const band = HEIGHT / WATER.length;
  WATER.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, Math.floor(i * band), WIDTH, Math.ceil(band) + 1);
  });
  // Checkerboard dither on each band edge so the gradient reads as 8-bit, not banded.
  for (let i = 1; i < WATER.length; i++) {
    const y = Math.floor(i * band);
    ctx.fillStyle = WATER[i - 1];
    for (let x = 0; x < WIDTH; x += 2) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = WATER[i];
    for (let x = 1; x < WIDTH; x += 2) ctx.fillRect(x, y - 1, 1, 1);
  }
}

function lightRays(ctx: CanvasRenderingContext2D) {
  const rays = [
    { x: 40, w: 14, slope: 0.35 },
    { x: 95, w: 8, slope: 0.35 },
    { x: 150, w: 18, slope: 0.35 },
    { x: 230, w: 10, slope: 0.35 },
  ];
  for (const r of rays) {
    for (let y = 0; y < SAND_TOP; y++) {
      const alpha = 0.09 * (1 - y / SAND_TOP);
      ctx.fillStyle = `rgba(200, 240, 255, ${alpha.toFixed(3)})`;
      ctx.fillRect(Math.round(r.x + y * r.slope), y, r.w, 1);
    }
  }
}

function sand(ctx: CanvasRenderingContext2D, rnd: () => number) {
  for (let x = 0; x < WIDTH; x++) {
    const top = sandTop(x);
    ctx.fillStyle = '#e0c48a';
    ctx.fillRect(x, top, 1, 1);
    ctx.fillStyle = '#c2a061';
    ctx.fillRect(x, top + 1, 1, HEIGHT - top - 1);
  }
  const speckles = ['#a8844a', '#dcc088', '#b8945a'];
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rnd() * WIDTH);
    const y = sandTop(x) + 2 + Math.floor(rnd() * (HEIGHT - SAND_TOP));
    ctx.fillStyle = speckles[i % speckles.length];
    ctx.fillRect(x, y, 1, 1);
  }
}

function rock(ctx: CanvasRenderingContext2D, cx: number, rx: number, ry: number) {
  const base = sandTop(cx) + 2;
  for (let y = -ry; y <= 0; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
      const lit = x < -rx / 3 && y < -ry / 3;
      const dark = x > rx / 3 || y > -2;
      ctx.fillStyle = lit ? '#8a94a0' : dark ? '#3e454e' : '#5b6470';
      ctx.fillRect(cx + x, base + y, 1, 1);
    }
  }
}

function seaweed(ctx: CanvasRenderingContext2D, x0: number, height: number, phase: number) {
  const base = sandTop(x0) + 1;
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

function chest(ctx: CanvasRenderingContext2D) {
  const y0 = sandTop(CHEST_X + 7) - CHEST.length + 3;
  CHEST.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === '.') return;
      ctx.fillStyle = CHEST_COLORS[c];
      ctx.fillRect(CHEST_X + x, y0 + y, 1, 1);
    });
  });
}

/** Paints the static scenery once. Fresh canvas each call, like the atlas. */
export function buildBackground(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(1987);

  water(ctx);
  lightRays(ctx);
  seaweed(ctx, 22, 70, 0);
  seaweed(ctx, 30, 48, 2);
  seaweed(ctx, 118, 58, 1);
  seaweed(ctx, 205, 80, 3);
  seaweed(ctx, 212, 52, 5);
  seaweed(ctx, 298, 64, 4);
  sand(ctx, rnd);
  rock(ctx, 64, 12, 8);
  rock(ctx, 78, 7, 5);
  rock(ctx, 170, 16, 10);
  rock(ctx, 280, 9, 6);
  chest(ctx);
  return canvas;
}
