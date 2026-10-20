import { mulberry32 } from '../rng';
import { cannedOptions, type LineRequest, type Role } from './lines';
import type { Context, Moment } from './moments';

/** Anything that can turn a request into a line: canned lines now, a trained model later. */
export interface Voice {
  name: string;
  line(req: LineRequest): Promise<string | null>;
}

/** Picks one of the hand-written lines. */
export class CannedVoice implements Voice {
  name = 'canned lines';
  private rng = mulberry32(11);
  private recent: string[] = []; // nobody says the same thing twice in quick succession
  line(req: LineRequest) {
    const options = cannedOptions(req);
    const fresh = options.filter((o) => !this.recent.includes(o));
    const pool = fresh.length ? fresh : options;
    const text = pool.length ? pool[Math.floor(this.rng() * pool.length)] : null;
    if (text) this.recent = [...this.recent, text].slice(-12);
    return Promise.resolve(text);
  }
}

export interface Said {
  speaker: string;
  role: Role;
  text: string;
  /** ms from the moment to the line showing up. */
  delayMs: number;
}

// How likely each moment is to get a reaction, from the streamer and from chat.
// chat is [chance anyone talks, most people who talk].
const STREAMER_ODDS: Record<Moment['kind'], number> = { start: 1, cast: 0.15, scared: 0.5, catch: 1, stolen: 0.8, empty: 0.35, dry: 1, end: 1 };
const CHAT_ODDS: Record<Moment['kind'], [number, number]> = {
  start: [1, 2],
  cast: [0.4, 1],
  scared: [0.6, 1],
  catch: [0.9, 2],
  stolen: [0.9, 2],
  empty: [0.4, 1],
  dry: [0.8, 1],
  end: [1, 3],
};

const STREAMER_GAP_MS = 3500; // the bubble needs time to be read
const CHAT_GAP_MS = 700; // between chat messages
const STALE_MS = 6000; // a reaction later than this is about something else by now
const MAX_PENDING = 4;

/**
 * Decides who talks and when, so five voices don't all talk over every cast. The streamer gets
 * the speech bubble; the others are viewers in chat, a beat behind like any stream. Lines are
 * requested as soon as the moment happens, so a slow voice has the chat delay to finish in.
 */
export class Director {
  private rng = mulberry32(7);
  private lastBubble = -Infinity;
  private lastChat = -Infinity;
  private lastChatSpeaker = '';
  private pending = 0;

  constructor(
    private voice: () => Voice,
    private onSay: (s: Said) => void,
  ) {}

  /** streamer: who's fishing, or null when it's you (you don't get a bubble). viewers: everyone else. */
  react(moment: Moment, ctx: Context, streamer: string | null, viewers: string[]) {
    const now = performance.now();
    if (streamer && now - this.lastBubble > STREAMER_GAP_MS && this.rng() < STREAMER_ODDS[moment.kind]) {
      this.lastBubble = now;
      this.ask({ speaker: streamer, role: 'streamer', moment, ctx }, now, 0);
    }
    const [chance, most] = CHAT_ODDS[moment.kind];
    if (this.rng() >= chance) return;
    // At a cast, the viewers who'd have done something different speak up first.
    let order = this.shuffle(viewers.filter((v) => v !== this.lastChatSpeaker));
    if (moment.kind === 'cast') {
      const differs = (v: string) => {
        const o = moment.opinions.find((x) => x.speaker === v);
        return o && JSON.stringify(o.pick) !== JSON.stringify(moment.pick) ? 0 : 1;
      };
      order = order.sort((a, b) => differs(a) - differs(b));
    }
    const count = 1 + Math.floor(this.rng() * most);
    order.slice(0, count).forEach((speaker, i) => {
      const beat = 500 + i * 900 + this.rng() * 1500; // stream delay, and people type at different speeds
      this.ask({ speaker, role: 'chat', moment, ctx }, now, beat);
    });
  }

  private ask(req: LineRequest, at: number, beatMs: number) {
    if (req.role === 'chat' && this.pending >= MAX_PENDING) return;
    if (req.role === 'chat') this.pending++;
    void this.voice()
      .line(req)
      .then((text) => {
        const wait = Math.max(0, at + beatMs - performance.now());
        setTimeout(() => {
          if (req.role === 'chat') this.pending--;
          if (!text) return;
          const now = performance.now();
          if (now - at > STALE_MS) return;
          if (req.role === 'chat') {
            // keep chat readable: hold a message back a moment if another just landed
            const hold = this.lastChat + CHAT_GAP_MS - now;
            this.lastChat = Math.max(now, this.lastChat + CHAT_GAP_MS);
            this.lastChatSpeaker = req.speaker;
            setTimeout(() => this.onSay({ speaker: req.speaker, role: req.role, text, delayMs: performance.now() - at }), Math.max(0, hold));
          } else this.onSay({ speaker: req.speaker, role: req.role, text, delayMs: now - at });
        }, wait);
      });
  }

  private shuffle<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
