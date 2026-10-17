import Konva from 'konva';
import type { Assets, RendererAdapter } from './types';

/** Konva: retained scene graph on Canvas2D. One Konva.Image per fish, cropped from the atlas. */
export default function create(): RendererAdapter {
  let stage: Konva.Stage;
  let layer: Konva.Layer;
  let a: Assets;
  const nodes: Konva.Image[] = [];
  const shown: number[] = []; // sprite index each node is currently cropped to

  const crop = (s: number) => ({ x: (s % a.cols) * a.cellW, y: Math.floor(s / a.cols) * a.cellH, width: a.cellW, height: a.cellH });

  return {
    id: 'konva',
    label: 'konva',

    async init(container, assets) {
      a = assets;
      Konva.pixelRatio = 1;
      const host = document.createElement('div');
      container.appendChild(host);
      stage = new Konva.Stage({ container: host, width: a.width, height: a.height, listening: false });
      layer = new Konva.Layer({ listening: false, imageSmoothingEnabled: false });
      stage.add(layer);
      layer.add(new Konva.Image({ image: a.background, x: 0, y: 0, listening: false, perfectDrawEnabled: false }));
    },

    setCount(n) {
      while (nodes.length < n) {
        const node = new Konva.Image({
          image: a.atlas,
          crop: crop(0),
          width: a.cellW,
          height: a.cellH,
          listening: false,
          perfectDrawEnabled: false,
        });
        layer.add(node);
        nodes.push(node);
        shown.push(0);
      }
      while (nodes.length > n) {
        nodes.pop()!.destroy();
        shown.pop();
      }
    },

    update({ count, x, y, sprite }) {
      for (let i = 0; i < count; i++) {
        const node = nodes[i];
        node.x(x[i]);
        node.y(y[i]);
        if (shown[i] !== sprite[i]) {
          shown[i] = sprite[i];
          node.crop(crop(sprite[i]));
        }
      }
    },

    render() {
      layer.draw();
    },

    async destroy() {
      nodes.length = 0;
      shown.length = 0;
      const host = stage.container();
      stage.destroy();
      host.remove();
    },
  };
}
