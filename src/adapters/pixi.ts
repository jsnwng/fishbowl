import { Application, CanvasSource, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { RendererAdapter } from './types';

/** PixiJS v8: one Sprite per fish, textures are sub-frames of a shared atlas source. */
export default function create(): RendererAdapter {
  let app: Application;
  let layer: Container;
  let frames: Texture[] = [];
  const sprites: Sprite[] = [];

  return {
    id: 'pixi',
    label: 'pixi',

    async init(container, a) {
      app = new Application();
      await app.init({
        width: a.width,
        height: a.height,
        antialias: false,
        resolution: 1,
        autoDensity: false,
        autoStart: false,
        sharedTicker: false,
        preference: 'webgl',
        roundPixels: true,
        background: '#000000',
      });
      app.ticker.stop();
      container.appendChild(app.canvas);

      const source = new CanvasSource({ resource: a.atlas, scaleMode: 'nearest' });
      frames = [];
      for (let i = 0; i < a.cols * a.rows; i++) {
        const frame = new Rectangle((i % a.cols) * a.cellW, Math.floor(i / a.cols) * a.cellH, a.cellW, a.cellH);
        frames.push(new Texture({ source, frame }));
      }
      const bg = new Texture({ source: new CanvasSource({ resource: a.background, scaleMode: 'nearest' }) });
      app.stage.addChild(new Sprite(bg));
      layer = new Container();
      app.stage.addChild(layer);
    },

    setCount(n) {
      while (sprites.length < n) sprites.push(layer.addChild(new Sprite(frames[0])));
      while (sprites.length > n) sprites.pop()!.destroy();
    },

    update({ count, x, y, sprite }) {
      for (let i = 0; i < count; i++) {
        const sp = sprites[i];
        sp.x = x[i];
        sp.y = y[i];
        const t = frames[sprite[i]];
        if (sp.texture !== t) sp.texture = t;
      }
    },

    render() {
      app.render();
    },

    async destroy() {
      sprites.length = 0;
      app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    },
  };
}
