import { HALF, WL0, terrainH } from './world.js';
import { clamp } from './math.js';

export class JellyWater {
  constructor(quality) {
    this.n = quality.gn;
    this.gdx = 5.2 / quality.gn;
    const n = this.n;
    const cells = n * n;
    this.h = new Float32Array(cells);
    this.D = new Float32Array(cells);
    this.terrain = new Float32Array(cells);
    this.lap = new Float32Array(cells);
    this.u = new Float32Array((n + 1) * n);
    this.w = new Float32Array((n + 1) * n);
    this.depthU = new Float32Array(this.u.length);
    this.depthW = new Float32Array(this.w.length);
    this.texture = new Float32Array(cells * 4);
    this.firm = 0.5;
    this.damp = 0.3;
    this.level = WL0;
    this.energy = 0;
    this.resets = 0;
    this.wetCount = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -HALF + (i + 0.5) * this.gdx;
        const z = -HALF + (j + 0.5) * this.gdx;
        this.terrain[j * n + i] = terrainH(x, z);
      }
    }
    this.setLevel(WL0);
  }

  setLevel(level) {
    const n = this.n;
    const D = this.D;
    const h = this.h;
    this.level = level;
    this.wetCount = 0;
    for (let i = 0; i < D.length; i++) {
      D[i] = Math.max(0, level - this.terrain[i]);
      if (D[i] < 0.012) {
        D[i] = 0;
        h[i] = 0;
      } else this.wetCount++;
    }
    const du = this.depthU;
    const dw = this.depthW;
    du.fill(0);
    dw.fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 1; i < n; i++) {
        du[j * (n + 1) + i] = Math.min(D[j * n + i - 1], D[j * n + i]);
      }
    }
    for (let j = 1; j < n; j++) {
      for (let i = 0; i < n; i++) {
        dw[j * n + i] = Math.min(D[(j - 1) * n + i], D[j * n + i]);
      }
    }
    const u = this.u;
    const w = this.w;
    for (let i = 0; i < u.length; i++) if (!du[i]) u[i] = 0;
    for (let i = 0; i < w.length; i++) if (!dw[i]) w[i] = 0;
  }

  reset() {
    this.h.fill(0);
    this.u.fill(0);
    this.w.fill(0);
    this.energy = 0;
    this.pack();
  }

  addVolume(x, z, vol, radius) {
    if (!Number.isFinite(x + z + vol) || Math.abs(vol) < 1e-11) return;
    const n = this.n;
    const gdx = this.gdx;
    const r = Math.max(radius, gdx * 0.8);
    const minX = clamp(Math.floor((x - r * 2.7 + HALF) / gdx), 0, n - 1);
    const maxX = clamp(Math.ceil((x + r * 2.7 + HALF) / gdx), 0, n - 1);
    const minZ = clamp(Math.floor((z - r * 2.7 + HALF) / gdx), 0, n - 1);
    const maxZ = clamp(Math.ceil((z + r * 2.7 + HALF) / gdx), 0, n - 1);
    const inv = 1 / (2 * r * r);
    const D = this.D;
    const h = this.h;
    let sum = 0;
    for (let j = minZ; j <= maxZ; j++) {
      const dz = -HALF + (j + 0.5) * gdx - z;
      for (let i = minX; i <= maxX; i++) {
        const k = j * n + i;
        if (!D[k]) continue;
        const dx = -HALF + (i + 0.5) * gdx - x;
        sum += Math.exp(-(dx * dx + dz * dz) * inv);
      }
    }
    if (sum < 1e-12) return;
    const scale = vol / (sum * gdx * gdx);
    for (let j = minZ; j <= maxZ; j++) {
      const dz = -HALF + (j + 0.5) * gdx - z;
      const row = j * n;
      for (let i = minX; i <= maxX; i++) {
        const k = row + i;
        if (!D[k]) continue;
        const dx = -HALF + (i + 0.5) * gdx - x;
        h[k] += scale * Math.exp(-(dx * dx + dz * dz) * inv);
      }
    }
  }

  stir(x, z, speed) {
    this.addVolume(x, z, -0.0016 * (0.35 + clamp(speed, 0, 3)), 0.085);
  }

  step(dt, gx, gz) {
    const n = this.n;
    const h = this.h;
    const D = this.D;
    const L = this.lap;
    const u = this.u;
    const w = this.w;
    const du = this.depthU;
    const dw = this.depthW;
    const ix = 1 / this.gdx;
    const ix2 = ix * ix;
    const g = 3.4 * (0.75 + 0.5 * this.firm);
    const sigma = 0.00012 * (0.5 + this.firm);
    const drag = Math.exp(-(0.18 + 1.6 * this.damp) * dt);
    const fx = gx * 0.6;
    const fz = gz * 0.6;

    for (let j = 0; j < n; j++) {
      const row = j * n;
      for (let i = 0; i < n; i++) {
        const k = row + i;
        if (!D[k]) {
          L[k] = 0;
          continue;
        }
        const v = h[k];
        const a = i && D[k - 1] ? h[k - 1] : v;
        const b = i < n - 1 && D[k + 1] ? h[k + 1] : v;
        const c = j && D[k - n] ? h[k - n] : v;
        const d = j < n - 1 && D[k + n] ? h[k + n] : v;
        L[k] = (a + b + c + d - 4 * v) * ix2;
      }
    }

    for (let j = 0; j < n; j++) {
      const urow = j * (n + 1);
      const hrow = j * n;
      for (let i = 1; i < n; i++) {
        const f = urow + i;
        if (!du[f]) {
          u[f] = 0;
          continue;
        }
        const k = hrow + i;
        const acc = -g * (h[k] - h[k - 1]) * ix + sigma * (L[k] - L[k - 1]) * ix + fx;
        u[f] = clamp((u[f] + dt * acc) * drag, -4, 4);
      }
    }

    for (let j = 1; j < n; j++) {
      const row = j * n;
      const prev = row - n;
      for (let i = 0; i < n; i++) {
        const f = row + i;
        if (!dw[f]) {
          w[f] = 0;
          continue;
        }
        const acc = -g * (h[f] - h[prev + i]) * ix + sigma * (L[f] - L[prev + i]) * ix + fz;
        w[f] = clamp((w[f] + dt * acc) * drag, -4, 4);
      }
    }

    let sum = 0;
    for (let j = 0; j < n; j++) {
      const row = j * n;
      const urow = j * (n + 1);
      for (let i = 0; i < n; i++) {
        const k = row + i;
        if (!D[k]) continue;
        const a = urow + i;
        const flux =
          du[a + 1] * u[a + 1] -
          du[a] * u[a] +
          dw[k + n] * w[k + n] -
          dw[k] * w[k];
        h[k] = clamp(h[k] - dt * ix * flux, -0.9 * D[k], 0.45);
        sum += h[k];
      }
    }

    const correction = (sum / Math.max(1, this.wetCount)) * Math.min(1, 1.5 * dt);
    let energy = 0;
    for (let k = 0; k < h.length; k++) {
      if (!D[k]) continue;
      h[k] -= correction;
      const v = h[k];
      energy += v * v;
    }
    this.energy = energy;
    if (!Number.isFinite(energy) || energy > 1e5) {
      this.resets++;
      this.reset();
    }
  }

  height(x, z) {
    const n = this.n;
    const gdx = this.gdx;
    const fx = clamp((x + HALF) / gdx - 0.5, 0, n - 1.001);
    const fz = clamp((z + HALF) / gdx - 0.5, 0, n - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const b = fx - i;
    const a = fz - j;
    const k = j * n + i;
    const h = this.h;
    const h00 = h[k];
    const h10 = h[k + 1];
    const h01 = h[k + n];
    const h11 = h[k + n + 1];
    return this.level + (h00 + (h10 - h00) * b) * (1 - a) + (h01 + (h11 - h01) * b) * a;
  }

  sample(x, z, out) {
    const n = this.n;
    const gdx = this.gdx;
    const i = clamp(Math.floor((x + HALF) / gdx), 0, n - 1);
    const j = clamp(Math.floor((z + HALF) / gdx), 0, n - 1);
    const s = this.height(x, z);
    const dx = (this.height(x + gdx, z) - this.height(x - gdx, z)) / (2 * gdx);
    const dz = (this.height(x, z + gdx) - this.height(x, z - gdx)) / (2 * gdx);
    const len = Math.hypot(dx, 1, dz) || 1;
    out.height = s;
    out.nx = -dx / len;
    out.ny = 1 / len;
    out.nz = -dz / len;
    out.fx = (this.u[j * (n + 1) + i] + this.u[j * (n + 1) + i + 1]) * 0.5;
    out.fz = (this.w[j * n + i] + this.w[(j + 1) * n + i]) * 0.5;
    out.wet = this.D[j * n + i] > 0;
    return out;
  }

  pack() {
    const n = this.n;
    const h = this.h;
    const t = this.texture;
    const gdx = this.gdx;
    const scale = 1 / (2 * gdx);
    for (let j = 0; j < n; j++) {
      const row = j * n;
      const up = Math.min(j + 1, n - 1) * n;
      const dn = Math.max(j - 1, 0) * n;
      for (let i = 0; i < n; i++) {
        const k = row + i;
        const q = k * 4;
        t[q] = h[k];
        t[q + 1] = (h[row + Math.min(i + 1, n - 1)] - h[row + Math.max(i - 1, 0)]) * scale;
        t[q + 2] = (h[up + i] - h[dn + i]) * scale;
        t[q + 3] = this.terrain[k];
      }
    }
    return t;
  }
}
