import { WIDTH } from '../adapters/types';
import { buildBackground } from '../scenery';
import { WATERLINE } from './rules';

/*
 * The fisherman and his boat, drawn the same way as the fish in src/sprites.ts:
 * one character per pixel, '.' is transparent.
 */

// facing right, rod hand on the right edge of row 7
const FISHERMAN = [
  '....ooo....',
  '...ohhho...',
  '..ohhhhho..',
  '.oHHHHHHHHo',
  '...osssko..',
  '...ossssso.',
  '..occcccco.',
  '.occcccccss',
  '.oCcccccco.',
  '.oCcccccco.',
  '.oCCCCCCCo.',
];

const BOAT = [
  'oo..........................oo',
  'owoooooooooooooooooooooooooowo',
  '.owwwwwwwwwwwwwwwwwwwwwwwwwwo.',
  '..obbbbbbbbbbbbbbbbbbbbbbbbo..',
  '...obbbbbbbbbbbbbbbbbbbbbbo...',
  '....oooooooooooooooooooooo....',
];

const COLORS: Record<string, string> = {
  o: '#1a1a1a', // outline
  h: '#f2c230', // hat
  H: '#b88a10', // hat brim
  s: '#f0b088', // skin
  k: '#1a1a1a', // eye
  c: '#d8402a', // raincoat
  C: '#962a1a', // raincoat shade
  w: '#c08850', // boat rim
  b: '#8a5226', // boat hull
};

/** Where things sit, top-left, in bowl pixels. The boat floats a few pixels into the water. */
export const BOAT_X = 140;
export const BOAT_Y = WATERLINE - 4;
export const FISHERMAN_X = 150;
export const FISHERMAN_Y = WATERLINE - 13;
/** The hand that holds the rod. */
export const HAND_X = FISHERMAN_X + 10;
export const HAND_Y = FISHERMAN_Y + 7;

/** Raincoat colors: the fisherman's 'c' and 'C' pixels. Each hunter has its own. */
export interface Coat {
  main: string;
  shade: string;
}

function paintMap(map: string[], colors: Record<string, string> = COLORS): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map[0].length;
  canvas.height = map.length;
  const ctx = canvas.getContext('2d')!;
  map.forEach((row, y) => {
    if (row.length !== canvas.width) throw new Error(`art row ${y} is ${row.length} wide, expected ${canvas.width}`);
    [...row].forEach((c, x) => {
      if (c === '.') return;
      ctx.fillStyle = colors[c];
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return canvas;
}

export const buildFisherman = (coat?: Coat) => paintMap(FISHERMAN, coat ? { ...COLORS, c: coat.main, C: coat.shade } : COLORS);
export const buildBoat = () => paintMap(BOAT);

const SKY = ['#5fb4e8', '#6cbbea', '#78c2ec', '#86c9ee', '#92d0f0', '#a0d6f2'];

const CLOUDS = [
  { x: 30, y: 5, w: 22 },
  { x: 236, y: 9, w: 16 },
];

/** The bowl scenery with sky above the waterline. */
export function buildGameBackground(): HTMLCanvasElement {
  const canvas = buildBackground();
  const ctx = canvas.getContext('2d')!;
  const band = WATERLINE / SKY.length;
  SKY.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, Math.floor(i * band), WIDTH, Math.ceil(band) + 1);
  });
  for (const cl of CLOUDS) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cl.x + 3, cl.y, cl.w - 6, 1);
    ctx.fillRect(cl.x, cl.y + 1, cl.w, 2);
    ctx.fillStyle = '#d8eefa';
    ctx.fillRect(cl.x + 2, cl.y + 3, cl.w - 4, 1);
  }
  // the surface: a bright line, then a dithered row into the water
  ctx.fillStyle = '#d8f2ff';
  ctx.fillRect(0, WATERLINE, WIDTH, 1);
  ctx.fillStyle = '#8ad0f0';
  for (let x = 0; x < WIDTH; x += 2) ctx.fillRect(x + ((x >> 3) & 1), WATERLINE + 1, 1, 1);
  return canvas;
}
