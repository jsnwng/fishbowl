import { Application, CanvasSource, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { ATLAS_COLS, ATLAS_ROWS, CELL_H, CELL_W } from '../adapters/types';
import { mulberry32 } from '../rng';
import { chestXFor, sandTopFor } from '../scenery';
import { BUBBLE_BASE, buildAtlas, fishSprite } from '../sprites';
import { buildBoat, buildFisherman, buildGameBackground, seatAt, type Coat } from './art';
import type { Game, Line } from './game';
import { RULES } from './rules';
import type { GameEvent } from './types';

const BUBBLES = 10;
const SPLASH_TICKS = 24;
const POPUP_TICKS = 70;
const CAST_ARC = 22; // px the hook rises mid-cast, for looks only

interface Effect {
  kind: 'splash' | 'popup';
  x: number;
  y: number;
  start: number;
  text?: Text;
}

const nearest = (resource: HTMLCanvasElement) => new CanvasSource({ resource, scaleMode: 'nearest' });

/**
 * Draws a Game with PixiJS: the bowl at the game's size, and a fisherman, boat and line per rod.
 * It only reads game state; nothing here feeds back into the rules, so the bob, the cast arc,
 * bubbles and effects can change without changing any score.
 */
export class GameView {
  /** Drawn over everything, for a page's own layer (the battle's scoreboard). */
  readonly overlay = new Container();
  private app = new Application();
  private frames: Texture[] = [];
  private fishSprites: Sprite[] = [];
  private bubbleSprites: Sprite[] = [];
  private line = new Graphics();
  private fx = new Graphics();
  private fxLayer = new Container();
  private effects: Effect[] = [];
  private bubbles = { x: new Float32Array(BUBBLES), y: new Float32Array(BUBBLES), v: new Float32Array(BUBBLES), size: new Uint8Array(BUBBLES) };
  private bubbleRng = mulberry32(5);
  private lastTick = 0;
  private men: Sprite[] = [];
  private width = 0;
  private sandTop = 0;
  private chestX = 0;

  async init(container: HTMLElement, game: Game, coats: Coat | Coat[]) {
    const { width, height } = game.bowl;
    this.width = width;
    this.sandTop = sandTopFor(height);
    this.chestX = chestXFor(width);
    await this.app.init({
      width,
      height,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      autoStart: false,
      sharedTicker: false,
      preference: 'webgl',
      roundPixels: true,
      background: '#000000',
    });
    this.app.ticker.stop();
    container.appendChild(this.app.canvas);

    const atlas = nearest(buildAtlas());
    for (let i = 0; i < ATLAS_COLS * ATLAS_ROWS; i++) {
      const frame = new Rectangle((i % ATLAS_COLS) * CELL_W, Math.floor(i / ATLAS_COLS) * CELL_H, CELL_W, CELL_H);
      this.frames.push(new Texture({ source: atlas, frame }));
    }

    const stage = this.app.stage;
    stage.addChild(new Sprite(new Texture({ source: nearest(buildGameBackground(width, height)) })));

    for (let j = 0; j < BUBBLES; j++) {
      this.spawnBubble(j, true);
      this.bubbleSprites.push(stage.addChild(new Sprite(this.frames[BUBBLE_BASE])));
    }
    const fishLayer = stage.addChild(new Container());
    for (let i = 0; i < game.fish.length; i++) this.fishSprites.push(fishLayer.addChild(new Sprite(this.frames[0])));

    stage.addChild(this.line);
    const boat = new Texture({ source: nearest(buildBoat()) });
    const list = Array.isArray(coats) ? coats : [coats];
    game.bowl.rods.forEach((rod, i) => {
      const at = seatAt(rod);
      const man = stage.addChild(new Sprite());
      man.position.set(at.manX, at.manY);
      man.scale.x = rod.facing;
      this.men.push(man);
      this.setCoat(list[i] ?? list[0], i);
      stage.addChild(new Graphics()).moveTo(at.handX, at.handY).lineTo(rod.x, rod.y).stroke({ width: 1, color: 0x5a3a1a });
      const hull = stage.addChild(new Sprite(boat));
      hull.position.set(at.boatX, at.boatY);
      hull.scale.x = rod.facing;
    });
    stage.addChild(this.fx);
    stage.addChild(this.fxLayer);
    stage.addChild(this.overlay);
  }

  /** Turn this tick's events into effects. */
  onEvents(events: GameEvent[], game: Game) {
    for (const e of events) {
      if (e.type === 'splash') this.effects.push({ kind: 'splash', x: e.x, y: e.y, start: game.tick });
      else if (e.type === 'catch') {
        const rod = game.lines[e.line].rod;
        this.popup(`+${e.points}`, '#ffe060', rod.x, rod.y + 4, game.tick);
      } else if (e.type === 'stolen') {
        const l = game.lines[e.line];
        this.popup('stolen', '#bbbbbb', l.hookX, l.hookY - 6, game.tick);
      }
    }
  }

  /** Repaint a fisherman (the first, unless told) in this hunter's raincoat. */
  setCoat(coat: Coat, seat = 0) {
    const man = this.men[seat];
    const old = man.texture;
    man.texture = new Texture({ source: nearest(buildFisherman(coat)) });
    if (old !== Texture.EMPTY) old.destroy(true);
  }

  /** Clear effects, e.g. on reset. */
  clear() {
    for (const e of this.effects) e.text?.destroy();
    this.effects = [];
  }

  draw(game: Game) {
    const t = game.tick;

    game.fish.forEach((f, i) => {
      const sp = this.fishSprites[i];
      sp.visible = f.state !== 'gone';
      if (!sp.visible) return;
      const bob = f.state === 'swim' ? Math.sin(f.bobPhase + t * f.bobFreq) * f.bobAmp : 0;
      sp.x = Math.round(f.x);
      sp.y = Math.round(f.y + bob);
      sp.texture = this.frames[fishSprite(f.species, f.vx < 0, Math.floor(f.tail) & 1)];
    });

    this.line.clear();
    for (const l of game.lines) this.drawLine(l, t);
    this.drawBubbles(Math.min(4, t - this.lastTick)); // by ticks, so bubbles keep pace with the speed setting
    this.lastTick = t;
    this.drawEffects(t);
    this.app.render();
  }

  private drawLine(l: Line, tick: number) {
    if (l.state === 'idle') return;
    const g = this.line;
    let hx = l.hookX;
    let hy = l.hookY;
    if (l.state === 'casting') hy -= Math.sin((Math.PI * l.lineT) / l.lineTicks) * CAST_ARC;
    if (l.state === 'nibble') hx += (tick >> 1) & 1 ? 1 : -1; // the line twitches
    g.moveTo(l.rod.x + 0.5, l.rod.y + 0.5)
      .lineTo(Math.round(hx) + 0.5, Math.round(hy) + 0.5)
      .stroke({ width: 1, color: 0xe8e8e8, alpha: 0.6 });
    // the hook, with bait that greys out as it goes stale
    const fresh = l.freshness;
    const bait = l.state === 'casting' ? 0xff6aa0 : fresh > 0 ? mix(0x8a8a8a, 0xff6aa0, fresh) : 0xc0c0c0;
    g.rect(Math.round(hx) - 1, Math.round(hy), 2, 2).fill({ color: bait });
  }

  private drawBubbles(ticks: number) {
    const b = this.bubbles;
    for (let j = 0; j < BUBBLES; j++) {
      b.y[j] -= b.v[j] * Math.max(0, ticks);
      if (b.y[j] < RULES.minY) this.spawnBubble(j, false);
      const sp = this.bubbleSprites[j];
      sp.x = Math.round(b.x[j]);
      sp.y = Math.round(b.y[j]);
      sp.texture = this.frames[BUBBLE_BASE + b.size[j]];
    }
  }

  private spawnBubble(j: number, scatter: boolean) {
    const r = this.bubbleRng;
    const b = this.bubbles;
    b.x[j] = j % 2 === 0 ? this.chestX + 5 + r() * 4 : 4 + r() * (this.width - 12);
    b.y[j] = scatter ? RULES.minY + r() * (this.sandTop - RULES.minY) : this.sandTop - 4 + r() * 6;
    b.v[j] = 0.2 + r() * 0.4;
    b.size[j] = Math.floor(r() * 3);
  }

  private popup(text: string, fill: string, x: number, y: number, start: number) {
    const label = new Text({ text, style: { fontFamily: 'Courier New, monospace', fontSize: 10, fontWeight: 'bold', fill } });
    label.anchor.set(0.5, 1);
    label.position.set(Math.round(x), Math.round(y));
    this.fxLayer.addChild(label);
    this.effects.push({ kind: 'popup', x, y, start, text: label });
  }

  private drawEffects(t: number) {
    const g = this.fx;
    g.clear();
    this.effects = this.effects.filter((e) => {
      const age = t - e.start;
      if (e.kind === 'splash') {
        if (age > SPLASH_TICKS) return false;
        const p = age / SPLASH_TICKS;
        g.circle(e.x, e.y, 2 + p * (RULES.splashRadius - 2)).stroke({ width: 1, color: 0xd8f2ff, alpha: 0.8 * (1 - p) });
        return true;
      }
      if (age > POPUP_TICKS) {
        e.text!.destroy();
        return false;
      }
      e.text!.y = Math.round(e.y - (age / POPUP_TICKS) * 14);
      e.text!.alpha = 1 - Math.max(0, age / POPUP_TICKS - 0.6) / 0.4;
      return true;
    });
  }
}

/** Blend two 0xRRGGBB colors: t = 0 gives a, t = 1 gives b. */
function mix(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift;
  return ch(16) | ch(8) | ch(0);
}
