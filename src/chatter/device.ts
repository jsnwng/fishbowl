import type { Backend } from './model.worker';

/**
 * Where a trained chat model can run here. Not on phones: on an iPhone the page climbed past
 * 2 GB of memory loading the model, on the GPU and on the CPU alike, and iOS killed the tab. The
 * model itself needs about 210 MB; the rest is the browser runtime around it. Phones keep the
 * hand-written lines.
 */
const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
export const phone =
  nav.userAgentData?.mobile ?? (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820));

/** The GPU with 4-bit weights, or the CPU (WebAssembly) with 8-bit ones where there's no WebGPU. */
export const backend: Backend = 'gpu' in navigator ? { device: 'webgpu', dtype: 'q4f16' } : { device: 'wasm', dtype: 'q8' };
