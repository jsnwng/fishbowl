import type { AdapterFactory } from './types';

export interface RendererEntry {
  id: string;
  /** Dynamic import so each library is its own chunk and its load time can be measured. */
  load: () => Promise<{ default: AdapterFactory }>;
}

export const RENDERERS: RendererEntry[] = [
  { id: 'canvas2d', load: () => import('./canvas2d') },
  { id: 'webgl', load: () => import('./webgl') },
  { id: 'pixi', load: () => import('./pixi') },
  { id: 'konva', load: () => import('./konva') },
  { id: 'two', load: () => import('./two') },
  { id: 'p5', load: () => import('./p5') },
];
