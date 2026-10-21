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

/** One fisherman at the match: who's playing, and the bookkeeping for when to ask them. */
export class Seat {
  actions: LoggedAction[] = [];
  decisions: Decision[] = [];
  asks = 0;
  errors = 0;
  pending: (Asked & { promise: Promise<void> }) | null = null;
  ready: (Asked & { action: Action; doneAt: number }) | null = null;
  /** An answer that came while the game was blocked on another seat, applied on the next tick. */
  held: Action | null = null;
  lastAsk = -Infinity;
  seenLine: LineState = 'idle';

  constructor(public hunter: Hunter) {}

  clear(line: LineState) {
    this.actions = [];
    this.decisions = [];
    this.asks = 0;
    this.errors = 0;
    this.pending = null;
    this.ready = null;
    this.held = null;
    this.lastAsk = -Infinity;
    this.seenLine = line;
  }
}

/**
 * One run: a game, a hunter per fisherman, and the rules for when each gets asked. The pages,
 * the score script and training all drive runs through this, so they play by the same rules.
 */
export class Match {
  seats: Seat[];
  mode: Mode = 'realtime';
  /** Main-thread ms spent inside hunter.decide() since the last takeMainMs(). */
  private mainMs = 0;

  constructor(
    readonly game: Game,
    hunters: Hunter | Hunter[],
  ) {
    this.seats = (Array.isArray(hunters) ? hunters : [hunters]).map((h) => new Seat(h));
  }

  // The first seat, for the pages with one fisherman.
  get hunter() {
    return this.seats[0].hunter;
  }
  set hunter(h: Hunter) {
    this.seats[0].hunter = h;
  }
  get actions() {
    return this.seats[0].actions;
  }
  get decisions() {
    return this.seats[0].decisions;
  }
  get asks() {
    return this.seats[0].asks;
  }
  get errors() {
    return this.seats[0].errors;
  }

  /** Fresh run on this seed. */
  start(seed: number) {
    this.game.reset(seed);
    this.seats.forEach((s, i) => {
      s.hunter.reset(seed);
      s.clear(this.game.lines[i].state);
    });
    this.game.start();
  }

  /** Back to an idle bowl on this seed, dropping any answer still on its way. */
  stop(seed: number) {
    for (const s of this.seats) {
      s.pending = null;
      s.ready = null;
      s.held = null;
    }
    this.game.reset(seed);
  }

  get thinking(): boolean {
    return this.seats.some((s) => s.pending !== null);
  }

  /** In turn based, the game can't move while a hunter is still thinking. */
  get blocked(): boolean {
    return this.mode === 'turns' && this.thinking;
  }

  takeMainMs(): number {
    const ms = this.mainMs;
    this.mainMs = 0;
    return ms;
  }

  /** Advance one tick (or not, if blocked). Returns the game's events. */
  step(): GameEvent[] {
    const game = this.game;
    if (!game.running) return game.step(this.seats.map(() => WAIT));

    const actions = this.seats.map((s, i) => this.next(s, i));
    if (this.blocked) {
      // keep what the seats that did answer said, for the tick the game moves on
      this.seats.forEach((s, i) => {
        if (!s.pending) s.held = actions[i];
      });
      return [];
    }

    const tick = game.tick;
    const events = game.step(actions);
    this.seats.forEach((s, i) => {
      if (actions[i].type !== 'wait') s.actions.push([tick, actions[i]]);
    });
    return events;
  }

  /** Headless: play to the end, waiting on slow hunters as needed (turn based or not). */
  async runToEnd() {
    while (this.game.running) {
      const pending = this.seats.find((s) => s.pending)?.pending;
      if (pending) await pending.promise;
      else this.step();
    }
  }

  /** This seat's action for this tick: a held or finished answer, or a new question. */
  private next(s: Seat, i: number): Action {
    if (s.held) {
      const a = s.held;
      s.held = null;
      return a;
    }
    if (s.ready) {
      const r = s.ready;
      s.ready = null;
      s.decisions.push({ thinkMs: r.doneAt - r.at, lagTicks: this.game.tick - r.tick });
      return r.action;
    }
    if (s.pending) return WAIT;
    const reason = this.reasonToAsk(s, i);
    return reason ? this.ask(s, i, reason) : WAIT;
  }

  /** Is this tick a decision point for this seat? */
  private reasonToAsk(s: Seat, i: number): AskReason | null {
    const game = this.game;
    const line = game.lines[i].state;
    const changed = line !== s.seenLine;
    const from = s.seenLine;
    s.seenLine = line;
    const due = game.tick - s.lastAsk >= RULES.askEvery;

    if (line === 'casting' || line === 'reeling') return s.hunter.everyTick ? 'check' : null;
    if (line === 'nibble' && changed) return 'nibble';
    if (line === 'idle' && (changed || due)) return 'idle';
    if (line === 'waiting' && changed) return from === 'casting' ? 'landed' : 'check';
    if (due || s.hunter.everyTick) return 'check';
    return null;
  }

  private ask(s: Seat, i: number, reason: AskReason): Action {
    const game = this.game;
    s.asks++;
    s.lastAsk = game.tick;
    const obs = game.observe(reason, i);
    const t0 = performance.now();
    let answer: Action | Promise<Action>;
    try {
      answer = s.hunter.decide(obs);
    } catch {
      s.errors++;
      return WAIT;
    } finally {
      this.mainMs += performance.now() - t0;
    }
    if (!(answer instanceof Promise)) {
      s.decisions.push({ thinkMs: performance.now() - t0, lagTicks: 0 });
      return answer;
    }

    const asked: Asked = { tick: game.tick, at: t0 };
    const promise = answer.then(
      (action) => {
        if (s.pending?.promise !== promise) return; // stopped or restarted meanwhile
        s.pending = null;
        s.ready = { ...asked, action, doneAt: performance.now() };
      },
      () => {
        if (s.pending?.promise !== promise) return;
        s.pending = null;
        s.errors++;
      },
    );
    s.pending = { ...asked, promise };
    return WAIT;
  }
}
