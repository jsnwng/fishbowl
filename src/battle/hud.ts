import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { GLYPH_H, paintText, textWidth } from './font';

const ROW1 = 3;
const ROW2 = ROW1 + GLYPH_H + 2;
const EDGE = 6;
const BANNER_Y = 84; // the middle of the water, under the boats

/** One line of pixel text that only repaints when it changes. */
class Label {
  readonly sprite = new Sprite();
  private key = '';

  constructor(
    parent: Container,
    private scale = 1,
  ) {
    this.sprite.scale.set(scale);
    parent.addChild(this.sprite);
  }

  /** Put `text` at x, lined up by its left edge, center or right edge. */
  set(text: string, color: string, x: number, y: number, align: 'left' | 'center' | 'right' = 'left') {
    const key = `${text}|${color}`;
    if (key !== this.key) {
      this.key = key;
      const old = this.sprite.texture;
      this.sprite.texture = new Texture({ source: new CanvasSource({ resource: paintText(text, color), scaleMode: 'nearest' }) });
      if (old !== Texture.EMPTY) old.destroy(true);
    }
    const w = textWidth(text.toUpperCase()) * this.scale;
    this.sprite.position.set(Math.round(align === 'left' ? x : align === 'center' ? x - w / 2 : x - w), y);
    this.sprite.visible = text.length > 0;
  }
}

export interface Side {
  name: string;
  score: number;
  color: string;
}

/**
 * The scoreboard across the sky, like an NES game's: you top left, the AI top right, the clock
 * in the middle. A banner across the water says READY, GO and who won.
 */
export class Hud {
  private leftName: Label;
  private leftScore: Label;
  private rightName: Label;
  private rightScore: Label;
  private timeName: Label;
  private time: Label;
  private banner: Label;
  private sub: Label;

  constructor(
    parent: Container,
    private width: number,
  ) {
    const layer = parent.addChild(new Container());
    this.leftName = new Label(layer);
    this.leftScore = new Label(layer);
    this.rightName = new Label(layer);
    this.rightScore = new Label(layer);
    this.timeName = new Label(layer);
    this.time = new Label(layer);
    this.banner = new Label(layer, 2);
    this.sub = new Label(layer);
  }

  scores(left: Side, right: Side, seconds: number) {
    const pad = (n: number) => String(n).padStart(6, '0');
    this.leftName.set(left.name, left.color, EDGE, ROW1);
    this.leftScore.set(pad(left.score), '#ffffff', EDGE, ROW2);
    this.rightName.set(right.name, right.color, this.width - EDGE, ROW1, 'right');
    this.rightScore.set(pad(right.score), '#ffffff', this.width - EDGE, ROW2, 'right');
    this.timeName.set('time', '#ffffff', this.width / 2, ROW1, 'center');
    this.time.set(String(seconds).padStart(3, '0'), '#ffffff', this.width / 2, ROW2, 'center');
  }

  /** Big text across the water, with a smaller line under it. Empty strings hide them. */
  say(text: string, sub = '', color = '#ffffff') {
    this.banner.set(text, color, this.width / 2, BANNER_Y, 'center');
    this.sub.set(sub, '#ffffff', this.width / 2, BANNER_Y + GLYPH_H * 2 + 6, 'center');
  }
}
