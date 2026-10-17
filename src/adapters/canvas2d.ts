import type { Assets, RendererAdapter, SimState } from './types';

/** Baseline: immediate-mode drawImage per sprite, nothing retained. */
export default function create(): RendererAdapter {
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let a: Assets;
  let st: SimState | null = null;

  return {
    id: 'canvas2d',
    label: 'canvas2d',

    async init(container, assets) {
      a = assets;
      canvas = document.createElement('canvas');
      canvas.width = a.width;
      canvas.height = a.height;
      container.appendChild(canvas);
      ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.imageSmoothingEnabled = false;
    },

    setCount() {},

    update(state) {
      st = state;
    },

    render() {
      ctx.drawImage(a.background, 0, 0);
      if (!st) return;
      const { count, x, y, sprite } = st;
      const { atlas, cellW: w, cellH: h, cols } = a;
      for (let i = 0; i < count; i++) {
        const s = sprite[i];
        ctx.drawImage(atlas, (s % cols) * w, ((s / cols) | 0) * h, w, h, x[i], y[i], w, h);
      }
    },

    async destroy() {
      canvas.width = 0;
      canvas.remove();
      st = null;
    },
  };
}
