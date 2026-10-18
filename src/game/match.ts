import type { Game } from './game';
import { RULES } from './rules';
import { WAIT, type Action, type AskReason, type GameEvent, type Hunter, type LineState } from './types';

/**
 * real time: the game keeps running while a hunter thinks, so slow answers arrive late.
 * turn based: the game waits at each decision point, so only the quality of the answer counts.
 */
export type Mode = 'realtime' | 'turns';

/** An action and the tick it was applied on. Enough to replay a run exactly. */
export type LoggedAction = [tick: number, action: Action];

export interface Decision {
  /** Wall-clock time from asking to the answer, ms. */
  thinkMs: number;
  /** Game ticks that passed before the answer was applied. 0 unless real time and slow. */
  lagTicks: number;
}

interface Asked {
  tick: number;
  at: number;
}

/**
 * One run: a game, a hunter, and the rules for when the hunter gets asked. The page and the
 * score script both drive runs through this, so they always play by the same rules.
 */
export class Match {
  hunter: Hunter;
  mode: Mode = 'realtime';
  actions: LoggedAction[] = [];
  decisions: Decision[] = [];
  asks = 0;
  errors = 0;
  /** Main-thread ms spent inside hunter.decide() since the last takeMainMs(). */
  private mainMs = 0;

  private pending: (Asked & { promise: Promise<void> }) | null = null;
  private ready: (Asked & { action: Action; doneAt: number }) | null = null;
  private lastAsk = -Infinity;
  private seenLine: LineState = 'idle';

  constructor(
    readonly game: Game,
    hunter: Hunter,
  ) {
    this.hunter = hunter;
  }

  /** Fresh run on this seed. */
  start(seed: number) {
    this.game.reset(seed);
    this.hunter.reset(seed);
    this.actions = [];
    this.decisions = [];
    this.asks = 0;
    this.errors = 0;
    this.pending = null;
    this.ready = null;
    this.lastAsk = -Infinity;
    this.seenLine = this.game.line;
    this.game.start();
  }

  /** Back to an idle bowl on this seed, dropping any answer still on its way. */
  stop(seed: number) {
    this.pending = null;
    this.ready = null;
    this.game.reset(seed);
  }

  get thinking(): boolean {
    return this.pending !== null;
  }

  /** In turn based, the game can't move while the hunter is still thinking. */
  get blocked(): boolean {
    return this.mode === 'turns' && this.pending !== null;
  }

  takeMainMs(): number {
    const ms = this.mainMs;
    this.mainMs = 0;
    return ms;
  }

  /** Advance one tick (or not, if blocked). Returns the game's events. */
  step(): GameEvent[] {
    const game = this.game;
    if (!game.running) return game.step(WAIT);

    let action: Action = WAIT;
    if (this.ready) {
      const r = this.ready;
      this.ready = null;
      this.decisions.push({ thinkMs: r.doneAt - r.at, lagTicks: game.tick - r.tick });
      action = r.action;
    } else if (!this.pending) {
      const reason = this.reasonToAsk();
      if (reason) action = this.ask(reason);
    }
    if (this.blocked) return [];

    const tick = game.tick;
    const events = game.step(action);
    if (action.type !== 'wait') this.actions.push([tick, action]);
    return events;
  }

  /** Headless: play to the end, waiting on slow hunters as needed (turn based or not). */
  async runToEnd() {
    while (this.game.running) {
      if (this.pending) await this.pending.promise;
      else this.step();
    }
  }

  /** Is this tick a decision point? */
  private reasonToAsk(): AskReason | null {
    const game = this.game;
    const line = game.line;
    const changed = line !== this.seenLine;
    const from = this.seenLine;
    this.seenLine = line;
    const due = game.tick - this.lastAsk >= RULES.askEvery;

    if (line === 'casting' || line === 'reeling') return this.hunter.everyTick ? 'check' : null;
    if (line === 'nibble' && changed) return 'nibble';
    if (line === 'idle' && (changed || due)) return 'idle';
    if (line === 'waiting' && changed) return from === 'casting' ? 'landed' : 'check';
    if (due || this.hunter.everyTick) return 'check';
    return null;
  }

  private ask(reason: AskReason): Action {
    const game = this.game;
    this.asks++;
    this.lastAsk = game.tick;
    const obs = game.observe(reason);
    const t0 = performance.now();
    let answer: Action | Promise<Action>;
    try {
      answer = this.hunter.decide(obs);
    } catch {
      this.errors++;
      return WAIT;
    } finally {
      this.mainMs += performance.now() - t0;
    }
    if (!(answer instanceof Promise)) {
      this.decisions.push({ thinkMs: performance.now() - t0, lagTicks: 0 });
      return answer;
    }

    const asked: Asked = { tick: game.tick, at: t0 };
    const promise = answer.then(
      (action) => {
        if (this.pending?.promise !== promise) return; // stopped or restarted meanwhile
        this.pending = null;
        this.ready = { ...asked, action, doneAt: performance.now() };
      },
      () => {
        if (this.pending?.promise !== promise) return;
        this.pending = null;
        this.errors++;
      },
    );
    this.pending = { ...asked, promise };
    return WAIT;
  }
}
