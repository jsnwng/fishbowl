/// <reference lib="webworker" />
// The trained chat model, off the main thread so writing a line never costs the game a frame.
// The page sends { load } once, then { id, prompt } per line; this answers with { id, text, ms }.
import { AutoModelForCausalLM, AutoTokenizer, env, type PreTrainedModel, type PreTrainedTokenizer } from '@huggingface/transformers';
import { SYSTEM } from './prompt';

export type ToWorker = { type: 'load'; root: string; id: string } | { type: 'line'; id: number; prompt: string };
export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: string; loadMs: number }
  | { type: 'error'; message: string }
  | { type: 'line'; id: number; text: string; ms: number };

const post = (m: FromWorker) => self.postMessage(m);
let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let queue = Promise.resolve();

async function load(root: string, id: string) {
  const t0 = performance.now();
  // the model ships with the site (public/live/voice/), so nothing is fetched from anywhere else.
  // root is a path like /live/: a full URL would count as remote, which is switched off
  env.allowRemoteModels = false;
  env.allowLocalModels = true; // off by default in browsers
  env.localModelPath = root;
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: 'progress', loaded, total });
  };
  const device = 'gpu' in navigator ? 'webgpu' : 'wasm';
  tokenizer = await AutoTokenizer.from_pretrained(id);
  model = await AutoModelForCausalLM.from_pretrained(id, { device, dtype: 'q4f16', progress_callback });
  post({ type: 'ready', device, loadMs: performance.now() - t0 });
}

async function line(id: number, prompt: string) {
  if (!tokenizer || !model) return;
  const t0 = performance.now();
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt },
  ];
  const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true }) as Record<string, any>;
  const output = (await model.generate({
    ...inputs,
    max_new_tokens: 24,
    do_sample: true,
    temperature: 0.8,
    top_p: 0.9,
  })) as any;
  const start = inputs.input_ids.dims[1];
  const ids = Array.from(output.tolist()[0] as bigint[]).slice(start);
  const text = tokenizer.decode(ids.map(Number), { skip_special_tokens: true });
  post({ type: 'line', id, text, ms: performance.now() - t0 });
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'load') {
    load(m.root, m.id).catch((err) => post({ type: 'error', message: String(err?.message ?? err) }));
  } else {
    // one line at a time: the model is single-threaded on the GPU anyway
    queue = queue.then(() => line(m.id, m.prompt)).catch((err) => post({ type: 'error', message: String(err?.message ?? err) }));
  }
};
