import type { Assets, RendererAdapter, SimState } from './types';

const VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in float aX;
layout(location = 2) in float aY;
layout(location = 3) in float aSprite;
uniform vec2 uRes;
uniform vec2 uCell;
uniform vec2 uTexSize;
uniform float uCols;
out vec2 vUv;
void main() {
  vec2 p = vec2(aX, aY) + aCorner * uCell;
  vec2 clip = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float col = mod(aSprite, uCols);
  float row = floor(aSprite / uCols);
  vUv = (vec2(col, row) + aCorner) * uCell / uTexSize;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv);
}`;

/** Upper bound: one instanced draw call for every sprite, positions streamed as raw typed arrays. */
export default function create(): RendererAdapter {
  let canvas: HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let a: Assets;
  let prog: WebGLProgram;
  let vao: WebGLVertexArrayObject;
  let corners: WebGLBuffer;
  let bx: WebGLBuffer, by: WebGLBuffer, bs: WebGLBuffer;
  let atlasTex: WebGLTexture, bgTex: WebGLTexture;
  let cap = 0;
  let st: SimState | null = null;
  const u: Record<string, WebGLUniformLocation | null> = {};

  function shader(type: number, src: string) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  }

  function texture(img: HTMLCanvasElement) {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function instanceBuffer(loc: number, type: number) {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 1, type, false, 0, 0);
    gl.vertexAttribDivisor(loc, 1);
    return b;
  }

  function grow(n: number) {
    if (n <= cap) return;
    cap = Math.max(n, Math.ceil(cap * 1.5), 1024);
    gl.bindBuffer(gl.ARRAY_BUFFER, bx);
    gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, by);
    gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bs);
    gl.bufferData(gl.ARRAY_BUFFER, cap, gl.DYNAMIC_DRAW);
  }

  function draw(tex: WebGLTexture, cellW: number, cellH: number, texW: number, texH: number, cols: number, count: number) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform2f(u.uCell, cellW, cellH);
    gl.uniform2f(u.uTexSize, texW, texH);
    gl.uniform1f(u.uCols, cols);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  return {
    id: 'webgl',
    label: 'webgl',

    async init(container, assets) {
      a = assets;
      canvas = document.createElement('canvas');
      canvas.width = a.width;
      canvas.height = a.height;
      container.appendChild(canvas);
      const ctx = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true });
      if (!ctx) throw new Error('WebGL2 not available');
      gl = ctx;

      prog = gl.createProgram()!;
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
      gl.useProgram(prog);
      for (const k of ['uRes', 'uCell', 'uTexSize', 'uCols', 'uTex']) u[k] = gl.getUniformLocation(prog, k);
      gl.uniform2f(u.uRes, a.width, a.height);
      gl.uniform1i(u.uTex, 0);

      vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      corners = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      bx = instanceBuffer(1, gl.FLOAT);
      by = instanceBuffer(2, gl.FLOAT);
      bs = instanceBuffer(3, gl.UNSIGNED_BYTE);
      grow(1024);

      atlasTex = texture(a.atlas);
      bgTex = texture(a.background);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.viewport(0, 0, a.width, a.height);
    },

    setCount(n) {
      grow(n);
    },

    update(state) {
      st = state;
      grow(state.count);
      const n = state.count;
      gl.bindBuffer(gl.ARRAY_BUFFER, bx);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.x, 0, n);
      gl.bindBuffer(gl.ARRAY_BUFFER, by);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.y, 0, n);
      gl.bindBuffer(gl.ARRAY_BUFFER, bs);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.sprite, 0, n);
    },

    render() {
      // Background: one "instance" at 0,0 whose cell is the whole frame. Instance 0 of the
      // streamed buffers would be a fish, so draw it with the instanced attributes disabled.
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.disableVertexAttribArray(3);
      gl.vertexAttrib1f(1, 0);
      gl.vertexAttrib1f(2, 0);
      gl.vertexAttrib1f(3, 0);
      draw(bgTex, a.width, a.height, a.width, a.height, 1, 1);
      gl.enableVertexAttribArray(1);
      gl.enableVertexAttribArray(2);
      gl.enableVertexAttribArray(3);
      if (st) draw(atlasTex, a.cellW, a.cellH, a.atlas.width, a.atlas.height, a.cols, st.count);
    },

    async destroy() {
      gl.deleteBuffer(corners);
      gl.deleteBuffer(bx);
      gl.deleteBuffer(by);
      gl.deleteBuffer(bs);
      gl.deleteTexture(atlasTex);
      gl.deleteTexture(bgTex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
      st = null;
    },
  };
}
