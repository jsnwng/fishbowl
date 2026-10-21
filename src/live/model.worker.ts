/// <reference lib="webworker" />
// The trained chat model, off the main thread so writing a line never costs the game a frame.
// The page sends { load } once, then { id, prompt } per line; this answers with { id, text, ms }.
import { AutoModelForCausalLM, AutoTokenizer, TextStreamer, env, type PreTrainedModel, type PreTrainedTokenizer } from '@huggingface/transformers';
import { SYSTEM } from './prompt';

/** Where the model runs: the GPU with 4-bit weights, or the CPU (WebAssembly) with 8-bit ones. */
export type Backend = { device: 'webgpu'; dtype: 'q4f16' } | { device: 'wasm'; dtype: 'q8'; lowMemory?: boolean; opt?: string };
export type ToWorker = { type: 'load'; host: string; id: string; backend: Backend } | { type: 'line'; id: number; prompt: string };
export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'stage'; stage: string }
  | { type: 'ready'; device: string; loadMs: number }
  | { type: 'error'; message: string }
  | { type: 'line'; id: number; text: string; ms: number };

const post = (m: FromWorker) => self.postMessage(m);
let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let queue = Promise.resolve();

async function load(host: string, id: string, backend: Backend) {
  const t0 = performance.now();
  // The model lives in object storage (Cloudflare R2), not in the site: at 118 MB it's over
  // GitHub's file limit, and it's a build output anyway. Files load from <host><id>/<file>.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = host;
  env.remotePathTemplate = '{model}/';
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'done' && p.file?.endsWith('.onnx')) post({ type: 'stage', stage: 'downloaded, setting up the model' });
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
  post({ type: 'stage', stage: 'loading the tokenizer' });
  tokenizer = await AutoTokenizer.from_pretrained(id);
  post({ type: 'stage', stage: 'downloading the model' });
  // Low memory (phones): an iPhone tab died on the first line, after loading fine. Two likely causes,
  // both off here: threads (they need shared WebAssembly memory, which iOS has trouble growing) and
  // prepacking (ONNX Runtime keeps a second, rearranged copy of the weights after the first run).
  const low = backend.device === 'wasm' && backend.lowMemory;
  if (low && env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
  // and no browser-cache copy of the 137 MB file on top of the one being loaded
  if (low) env.useBrowserCache = false;
  const session_options: Record<string, unknown> = low ? { enableCpuMemArena: false, enableMemPattern: false, extra: { session: { disable_prepacking: '1' } } } : {};
  // ?opt=disabled|basic|extended|all: how much ONNX Runtime rewrites the graph at load (testing memory)
  if (backend.device === 'wasm' && backend.opt) session_options.graphOptimizationLevel = backend.opt;
  model = await AutoModelForCausalLM.from_pretrained(id, { device: backend.device, dtype: backend.dtype, progress_callback, session_options } as any);
  post({ type: 'ready', device: backend.device, loadMs: performance.now() - t0 });
}

async function line(id: number, prompt: string) {
  if (!tokenizer || !model) return;
  const t0 = performance.now();
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt },
  ];
  const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true }) as Record<string, any>;
  post({ type: 'stage', stage: 'writing a line: reading the prompt' });
  let words = 0;
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    callback_function: () => {},
    token_callback_function: () => {
      if (words++ === 0) post({ type: 'stage', stage: 'writing a line: first word' });
    },
  });
  const output = (await model.generate({
    ...inputs,
    streamer,
    max_new_tokens: 24,
    do_sample: true,
    temperature: 0.8,
    top_p: 0.9,
  })) as any;
  const start = inputs.input_ids.dims[1];
  const ids = Array.from(output.tolist()[0] as bigint[]).slice(start);
  const text = tokenizer.decode(ids.map(Number), { skip_special_tokens: true });
  post({ type: 'stage', stage: 'writing a line: done' });
  post({ type: 'line', id, text, ms: performance.now() - t0 });
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'load') {
    load(m.host, m.id, m.backend).catch((err) => post({ type: 'error', message: String(err?.message ?? err) }));
  } else {
    // one line at a time: the model is single-threaded on the GPU anyway
    queue = queue.then(() => line(m.id, m.prompt)).catch((err) => post({ type: 'error', message: String(err?.message ?? err) }));
  }
};
