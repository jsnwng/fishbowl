import Two from 'two.js';
import type { Assets, RendererAdapter } from './types';

type TwoSprite = InstanceType<typeof Two.Sprite>;

/** Two.js on its WebGL renderer. Two.Sprite natively slices a grid sprite sheet via `index`. */
export default function create(): RendererAdapter {
  let two: Two;
  let a: Assets;
  let atlasTex: InstanceType<typeof Two.Texture>;
  let group: InstanceType<typeof Two.Group>;
  const sprites: TwoSprite[] = [];

  return {
    id: 'two',
    label: 'two',

    async init(container, assets) {
      a = assets;
      two = new Two({ type: Two.Types.webgl, width: a.width, height: a.height, autostart: false, ratio: 1 });
      two.appendTo(container);
      const bg = new Two.Sprite(new Two.Texture(a.background), a.width / 2, a.height / 2, 1, 1);
      two.add(bg);
      atlasTex = new Two.Texture(a.atlas);
      group = two.makeGroup();
    },

    setCount(n) {
      while (sprites.length < n) {
        const sp = new Two.Sprite(atlasTex, 0, 0, a.cols, a.rows);
        group.add(sp);
        sprites.push(sp);
      }
      while (sprites.length > n) group.remove(sprites.pop()!);
    },

    update({ count, x, y, sprite }) {
      // Two positions sprites by their centre; the sim hands out top-left corners.
      const hw = a.cellW / 2;
      const hh = a.cellH / 2;
      for (let i = 0; i < count; i++) {
        const sp = sprites[i];
        sp.translation.set(x[i] + hw, y[i] + hh);
        if (sp.index !== sprite[i]) sp.index = sprite[i];
      }
    },

    render() {
      two.update();
    },

    async destroy() {
      sprites.length = 0;
      two.clear();
      const el = two.renderer.domElement as HTMLCanvasElement;
      (el.getContext('webgl2') ?? el.getContext('webgl'))?.getExtension('WEBGL_lose_context')?.loseContext();
      el.remove();
      // Two keeps every instance in a static list; drop ours so it can be collected.
      const instances = (Two as unknown as { Instances: Two[] }).Instances;
      const at = instances.indexOf(two);
      if (at >= 0) instances.splice(at, 1);
    },
  };
}
