import { ATLAS_COLS, ATLAS_ROWS, CELL_H, CELL_W } from './adapters/types';

/*
 * 8-bit fish, drawn facing right (tail on the left), 16x10.
 *   .  transparent   o  outline   b  body   l  belly
 *   s  stripe        f  fin       k  eye    w  eye shine
 */
const STANDARD = [
  '......fff.......',
  '.....obbbbo.....',
  'ff..obbbbbbbo...',
  'fffobbbsbbbbkbo.',
  '.ffobbbsbbbbbbbo',
  '.ffobblsllllllo.',
  'fffoblllllllllo.',
  'ff..olllllllo...',
  '.....offllo.....',
  '......ff........',
];

const PUFFER = [
  '......o.o.o.....',
  '.....obbbbbo....',
  '....obbbbbbbo...',
  'ff.obbbbbbkwbo..',
  'fffobbbbbbbbbbo.',
  'fffollllllllllo.',
  'ff.olllllllllo..',
  '....olllllllo...',
  '.....ollllo.....',
  '......o.o.o.....',
];

const ANGEL = [
  '.......f........',
  '......ffo.......',
  '.....obbbo......',
  'ff..obsbbbbo....',
  'fffobbsbbbkbo...',
  '.ffobbsbbbbbbo..',
  'fffobbsllllo....',
  'ff..olsllo......',
  '......ffo.......',
  '.......f........',
];

type Palette = Record<'o' | 'b' | 'l' | 's' | 'f' | 'k' | 'w', string>;

interface Species {
  name: string;
  map: string[];
  palette: Palette;
}

const EYE = { k: '#000000', w: '#ffffff' };

export const SPECIES: Species[] = [
  { name: 'goldfish', map: STANDARD, palette: { o: '#7a2a00', b: '#ff8a1c', l: '#ffc266', s: '#ff8a1c', f: '#ff5a1c', ...EYE } },
  { name: 'clownfish', map: STANDARD, palette: { o: '#1a1a1a', b: '#ff6a00', l: '#ff9a3c', s: '#ffffff', f: '#ff6a00', ...EYE } },
  { name: 'blue tang', map: STANDARD, palette: { o: '#0b1a4a', b: '#2a6bff', l: '#4a8bff', s: '#0b1a4a', f: '#ffd400', ...EYE } },
  { name: 'puffer', map: PUFFER, palette: { o: '#5a4a10', b: '#d8c050', l: '#fff4c0', s: '#d8c050', f: '#c0a030', ...EYE } },
  { name: 'angelfish', map: ANGEL, palette: { o: '#303030', b: '#e8e8e8', l: '#f8f8f8', s: '#202020', f: '#b0b0b0', ...EYE } },
];

/** Atlas row holding the bubble sprites; columns are sizes 0..3. */
export const BUBBLE_ROW = SPECIES.length;
export const BUBBLE_BASE = BUBBLE_ROW * ATLAS_COLS;

/** Sprite index for a fish: 4 cells per species = [right f0, right f1, left f0, left f1]. */
export function fishSprite(species: number, facingLeft: boolean, frame: number): number {
  return species * ATLAS_COLS + (facingLeft ? 2 : 0) + frame;
}

const TAIL_COLS = 4;

/** Second swim frame: the tail columns shift down one pixel. */
function wagFrame(map: string[]): string[] {
  return map.map((row, y) => {
    const above = y > 0 ? map[y - 1] : '.'.repeat(row.length);
    return above.slice(0, TAIL_COLS) + row.slice(TAIL_COLS);
  });
}

function mirror(map: string[]): string[] {
  return map.map((row) => [...row].reverse().join(''));
}

function paint(ctx: CanvasRenderingContext2D, map: string[], palette: Palette, ox: number, oy: number) {
  for (let y = 0; y < map.length; y++) {
    const row = map[y];
    if (row.length !== CELL_W) throw new Error(`sprite row ${y} is ${row.length} wide, expected ${CELL_W}`);
    for (let x = 0; x < row.length; x++) {
      const c = row[x] as keyof Palette | '.';
      if (c === '.') continue;
      ctx.fillStyle = palette[c];
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

function paintBubble(ctx: CanvasRenderingContext2D, size: number, ox: number, oy: number) {
  const rim = '#bfe9ff';
  const shine = '#ffffff';
  ctx.fillStyle = rim;
  switch (size) {
    case 0: // single pixel
      ctx.fillRect(ox, oy, 1, 1);
      break;
    case 1: // 2x2
      ctx.fillRect(ox, oy, 2, 2);
      break;
    case 2: // 4x4 ring
      ctx.fillRect(ox + 1, oy, 2, 1);
      ctx.fillRect(ox + 1, oy + 3, 2, 1);
      ctx.fillRect(ox, oy + 1, 1, 2);
      ctx.fillRect(ox + 3, oy + 1, 1, 2);
      ctx.fillStyle = shine;
      ctx.fillRect(ox + 1, oy + 1, 1, 1);
      break;
    default: // 6x6 ring
      ctx.fillRect(ox + 2, oy, 2, 1);
      ctx.fillRect(ox + 2, oy + 5, 2, 1);
      ctx.fillRect(ox, oy + 2, 1, 2);
      ctx.fillRect(ox + 5, oy + 2, 1, 2);
      ctx.fillRect(ox + 1, oy + 1, 1, 1);
      ctx.fillRect(ox + 4, oy + 1, 1, 1);
      ctx.fillRect(ox + 1, oy + 4, 1, 1);
      ctx.fillRect(ox + 4, oy + 4, 1, 1);
      ctx.fillStyle = shine;
      ctx.fillRect(ox + 2, oy + 2, 1, 1);
  }
}

/** Builds a fresh atlas canvas. Each renderer gets its own copy so destroy() can't affect the next one. */
export function buildAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL_W;
  canvas.height = ATLAS_ROWS * CELL_H;
  const ctx = canvas.getContext('2d')!;
  const padY = Math.floor((CELL_H - 10) / 2);

  SPECIES.forEach((sp, row) => {
    const frames = [sp.map, wagFrame(sp.map)];
    const variants = [frames[0], frames[1], mirror(frames[0]), mirror(frames[1])];
    variants.forEach((map, col) => paint(ctx, map, sp.palette, col * CELL_W, row * CELL_H + padY));
  });

  for (let size = 0; size < ATLAS_COLS; size++) {
    paintBubble(ctx, size, size * CELL_W, BUBBLE_ROW * CELL_H);
  }
  return canvas;
}
