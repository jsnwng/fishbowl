import type { LineRequest } from './lines';
import type { Backend, FromWorker, ToWorker } from './model.worker';
import { SYSTEM, describe } from './prompt';
import voiceVersion from './voice-version.json';

/** Which trained model to run, and how to put a request to it. */
export interface VoiceModel<R> {
  /** The folder in the bucket: voice/ for the live chat, battle-voice/ for the battle's opponent. */
  folder: string;
  /** What training/export_voice.py wrote: the version, its sizes and the bucket's URL. */
  version: { version: string; mb: number; mbCpu: number; host: string };
  /** The system message it was trained with. */
  system: string;
  /** The request as the text it was trained on. */
  describe: (req: R) => string;
}

const LIVE: VoiceModel<LineRequest> = { folder: 'voice', version: voiceVersion, system: SYSTEM, describe };

const MAX_CHARS = 64; // two lines of the speech bubble

/** What the model wrote -> a line that fits: the first line only, no stray quotes or names. */
function tidy(text: string, req: { speaker: string }): string | null {
  let t = text.split('\n')[0].trim();
  t = t.replace(/^["']+|["']+$/g, '').trim();
  t = t.replace(new RegExp(`^${req.speaker}\\s*:\\s*`, 'i'), '');
  if (!t || t.length > MAX_CHARS + 8) return null;
  // chat style, like the training lines: lowercase start, but leave "WHAT" and "I" alone
  const first = t.split(/\s/)[0];
  const shouting = first.length > 1 && first === first.toUpperCase();
  if (/^[A-Z]/.test(t) && first !== 'I' && !first.startsWith("I'") && !shouting) t = t[0].toLowerCase() + t.slice(1);
  return t;
}

/** A trained chat model, running in a worker. Starts loading when constructed. The live page's by default. */
export class ModelVoice<R extends { speaker: string } = LineRequest> {
  name = 'trained model';
  static readonly mb = voiceVersion.mb;
  static readonly mbCpu = voiceVersion.mbCpu;
  device = '';
  loadMs = 0;
  /** ms per line, newest last, for the page to report. */
  times: number[] = [];
  readonly ready: Promise<void>;
  private worker = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' });
  private waiting = new Map<number, (text: string | null) => void>();
  private requests = new Map<number, R>();
  private nextId = 0;

  constructor(
    backend: Backend,
    onProgress: (loaded: number, total: number) => void,
    private model: VoiceModel<R> = LIVE as unknown as VoiceModel<R>,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m.loaded, m.total);
        else if (m.type === 'ready') {
          this.device = m.device;
          this.loadMs = m.loadMs;
          resolve();
        } else if (m.type === 'error') reject(new Error(m.message));
        else if (m.type === 'line') {
          this.times = [...this.times, m.ms].slice(-50);
          const req = this.requests.get(m.id);
          this.requests.delete(m.id);
          this.waiting.get(m.id)?.(req ? tidy(m.text, req) : null);
          this.waiting.delete(m.id);
        }
      };
    });
    // voice/<version>/ in the bucket: written by training/export_voice.py, then uploaded
    // in dev, ?voicehost=http://localhost:8787/ loads an export before it's uploaded (training/serve_voice.py)
    const host = (import.meta.env.DEV && new URLSearchParams(location.search).get('voicehost')) || model.version.host;
    this.send({ type: 'load', host, id: `${model.folder}/${model.version.version}`, backend, system: model.system });
  }

  line(req: R): Promise<string | null> {
    const id = this.nextId++;
    this.requests.set(id, req);
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.send({ type: 'line', id, prompt: this.model.describe(req) });
    });
  }

  /** Median ms per line so far. */
  get msPerLine() {
    if (!this.times.length) return 0;
    const s = [...this.times].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  private send(m: ToWorker) {
    this.worker.postMessage(m);
  }
}
