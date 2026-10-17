/** Internal resolution of the bowl. The surface is scaled up with nearest-neighbour CSS. */
export const WIDTH = 320;
export const HEIGHT = 180;

/** Every sprite lives in a uniform grid cell of the atlas. */
export const CELL_W = 16;
export const CELL_H = 12;
export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 6;

export interface Assets {
  width: number;
  height: number;
  /** Sprite atlas: ATLAS_COLS x ATLAS_ROWS cells of CELL_W x CELL_H. */
  atlas: HTMLCanvasElement;
  /** Full-frame static scenery, WIDTH x HEIGHT. */
  background: HTMLCanvasElement;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
}

/** What the renderer draws each frame: `count` sprites, top-left positions in whole pixels. */
export interface SimState {
  count: number;
  x: Float32Array;
  y: Float32Array;
  sprite: Uint8Array;
}

export interface RendererAdapter {
  id: string;
  label: string;
  init(container: HTMLElement, assets: Assets): Promise<void>;
  /** Grow or shrink the library's retained objects to `n` sprites. */
  setCount(n: number): void;
  /** Push positions / sprite frames from the shared sim into the library. */
  update(state: SimState): void;
  /** Draw one frame. */
  render(): void;
  /** Free every DOM node and GPU resource the adapter created. */
  destroy(): Promise<void>;
}

export type AdapterFactory = () => RendererAdapter;

/** Source rect of a sprite index inside the atlas. */
export function cellOf(index: number): { sx: number; sy: number } {
  return { sx: (index % ATLAS_COLS) * CELL_W, sy: Math.floor(index / ATLAS_COLS) * CELL_H };
}
