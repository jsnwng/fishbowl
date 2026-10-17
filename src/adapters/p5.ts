import p5 from 'p5';
import type { Assets, RendererAdapter, SimState } from './types';

/** p5.js v1 in instance mode. Its own loop is off; the bench calls redraw() once per frame. */
export default function create(): RendererAdapter {
  let inst: any;
  let a: Assets;
  let atlasImg: any;
  let bgImg: any;
  let st: SimState | null = null;

  const toImage = (p: any, src: HTMLCanvasElement) => {
    const img = p.createImage(src.width, src.height);
    img.drawingContext.drawImage(src, 0, 0);
    return img;
  };

  return {
    id: 'p5',
    label: 'p5',

    init(container, assets) {
      a = assets;
      return new Promise<void>((resolve) => {
        inst = new p5((p: any) => {
          p.setup = () => {
            p.pixelDensity(1);
            p.createCanvas(a.width, a.height);
            p.noSmooth();
            p.noLoop();
            atlasImg = toImage(p, a.atlas);
            bgImg = toImage(p, a.background);
            resolve();
          };
          p.draw = () => {
            p.image(bgImg, 0, 0);
            if (!st) return;
            const { count, x, y, sprite } = st;
            const { cellW: w, cellH: h, cols } = a;
            for (let i = 0; i < count; i++) {
              const s = sprite[i];
              p.image(atlasImg, x[i], y[i], w, h, (s % cols) * w, ((s / cols) | 0) * h, w, h);
            }
          };
        }, container);
      });
    },

    setCount() {},

    update(state) {
      st = state;
    },

    render() {
      inst.redraw();
    },

    async destroy() {
      st = null;
      inst.remove();
    },
  };
}
