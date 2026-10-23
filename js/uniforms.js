import { lookAt, matMul, orthoGL, orthoGPU } from './math.js';
import { SUN } from './world.js';

export function writeUniforms(u, pack) {
  const { view, sim, palette, width, height, dpr, sun, sunVP, shadowSize, shafts, gn, gdx } = pack;
  u.set(view.vp, 0);
  u.set(view.inverse, 16);
  u.set(sim.M, 32);
  u.set(sim.Minv, 48);
  u.set(sunVP, 64);
  u[80] = view.eye[0];
  u[81] = view.eye[1];
  u[82] = view.eye[2];
  u[83] = 1;
  u[84] = width;
  u[85] = height;
  u[86] = sim.time;
  u[87] = dpr;
  u[88] = sun[0];
  u[89] = sun[1];
  u[90] = sun[2];
  u[91] = 0;
  u[92] = sim.water.level;
  u[93] = sim.firm;
  u[94] = sim.water.damp;
  u[95] = sim.palette;
  u[96] = sim.shear[0];
  u[97] = sim.shear[1];
  u[98] = sim.squash[0];
  u[99] = sim.reduced ? 1 : 0;
  put4(u, 100, palette.abs);
  put4(u, 104, palette.tint);
  put4(u, 108, palette.sand);
  for (let i = 0; i < 5; i++) put4(u, 112 + i * 4, palette.soil[i]);
  put4(u, 132, palette.leaf);
  put4(u, 136, palette.trunk);
  put4(u, 140, palette.coconut);
  put4(u, 144, palette.pebble);
  for (let i = 0; i < 3; i++) {
    u[148 + i * 4] = sim.palms[i].bend[0];
    u[149 + i * 4] = sim.palms[i].bend[1];
    u[150 + i * 4] = 0;
    u[151 + i * 4] = 0;
  }
  u[160] = gn;
  u[161] = gdx;
  u[162] = shadowSize;
  u[163] = shafts;
}

function put4(u, offset, v) {
  u[offset] = v[0];
  u[offset + 1] = v[1];
  u[offset + 2] = v[2];
  u[offset + 3] = 0;
}

export function sunMatrix(mode) {
  const eye = [SUN[0] * 12, SUN[1] * 12 + 0.85, SUN[2] * 12];
  const view = lookAt(eye, [0, 0.85, 0]);
  const ortho = mode === 'webgl' ? orthoGL(-4.1, 4.1, -4.1, 4.1, 0.1, 25) : orthoGPU(-4.1, 4.1, -4.1, 4.1, 0.1, 25);
  const out = new Float32Array(16);
  matMul(out, ortho, view);
  return out;
}

export function writeBodies(sim, dst) {
  let n = 0;
  const add = (p, r, kind, squash, seed) => {
    const o = n * 8;
    if (o + 8 > dst.length) return;
    dst[o] = p[0];
    dst[o + 1] = p[1];
    dst[o + 2] = p[2];
    dst[o + 3] = r;
    dst[o + 4] = kind;
    dst[o + 5] = squash;
    dst[o + 6] = seed;
    dst[o + 7] = 0;
    n++;
  };
  for (const b of sim.bodies) add(b.p, b.r, b.kind === 'coconut' ? 4 : 5, b.squash, b.seed);
  const shadow = n;
  for (const d of sim.decor) add(d.p, d.r, 7, 0, d.seed);
  for (const b of sim.bubbles) add(b.p, b.r * (1 + Math.sin(b.age * 4) * 0.06), 6, 0, b.phase);
  return { count: n, shadow };
}

export function drawingBuffer(canvas, budget) {
  const cw = Math.max(1, canvas.clientWidth || 1);
  const ch = Math.max(1, canvas.clientHeight || 1);
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2, Math.sqrt(budget / (cw * ch)));
  const w = Math.max(1, Math.round(cw * Math.max(0.45, dpr)));
  const h = Math.max(1, Math.round(ch * Math.max(0.45, dpr)));
  return { w, h, dpr: w / cw, cw, ch };
}
