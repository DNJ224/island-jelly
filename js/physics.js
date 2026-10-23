import { clamp, norm, transform, transformInto } from './math.js';
import { HALF, PALMS, TAU, TILT_MAX, WL0, terrainH, terrainNormal } from './world.js';

const WAVE = { height: 0, nx: 0, ny: 1, nz: 0, fx: 0, fz: 0, wet: false };

export class IslandPhysics {
  constructor(water, quality) {
    this.water = water;
    this.quality = quality;
    this.firm = 0.5;
    this.reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.palette = 0;
    this.nextId = 0;
    this.seed = 401;
    this.bodyAccumulator = 0;
    this.waterAccumulator = 0;
    this.maxBodySteps = quality.maxBodySteps;
    this.tally = { afloat: 0, sunk: 0, ashore: 0, total: 0 };
    this.gravity = [0, -9.8, 0];
    this.reset();
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  reset() {
    this.time = 0;
    this.tilt = new Float64Array(4);
    this.targetTilt = [0, 0];
    this.heldTilt = false;
    this.angularAcceleration = [0, 0];
    this.shear = new Float64Array(4);
    this.squash = new Float64Array(2);
    this.M = new Float32Array(16);
    this.Minv = new Float32Array(16);
    this.lift = 0;
    this.palms = PALMS.map(() => ({ bend: new Float64Array(4), target: [0, 0], held: false }));
    this.bodies = [];
    this.bubbles = [];
    this.decor = [];
    this.bodyAccumulator = 0;
    this.waterAccumulator = 0;
    this.seed = 401;
    this.water.reset();
    this.updateTransform();
    for (let p = 0; p < 3; p++) {
      for (let j = 0; j < 3; j++) {
        const body = this.makeBody('coconut', this.coconutSpot(p, j));
        body.hung = { p, j };
        this.bodies.push(body);
      }
    }
    for (let j = 0; j < 7; j++) {
      let best = null;
      let bestScore = 1e9;
      const base = j * 2.399963;
      for (let k = 0; k < 130; k++) {
        const angle = base + ((k % 13) - 6) * 0.028;
        const radius = 0.35 + Math.floor(k / 13) * 0.115;
        const x = -0.3 + Math.cos(angle) * radius * 1.25;
        const z = -0.5 + Math.sin(angle) * radius;
        const y = terrainH(x, z);
        const ny = terrainNormal(x, z)[1];
        const score = Math.abs(y - (WL0 + 0.07)) + Math.max(0, 0.93 - ny) * 3;
        if (y <= WL0 + 0.035 || y >= WL0 + 0.13 || score >= bestScore) continue;
        let clear = true;
        for (const body of this.bodies) {
          if (body.hung) continue;
          if (Math.hypot(body.p[0] - x, body.p[2] - z) <= 0.22) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        best = [x, y, z];
        bestScore = score;
      }
      if (!best) {
        const angle = (j * TAU) / 7;
        best = [-0.3 + Math.cos(angle) * 0.64, 0, -0.5 + Math.sin(angle) * 0.52];
        best[1] = terrainH(best[0], best[2]);
      }
      const body = this.makeBody('pebble', best);
      body.p[1] += body.r / terrainNormal(body.p[0], body.p[2])[1];
      body.contact = true;
      body.sleep = 1;
      this.bodies.push(body);
    }
    for (let k = 0; k < 80; k++) {
      let x = 0;
      let z = 0;
      let y = 0;
      for (let a = 0; a < 30; a++) {
        x = (this.random() * 2 - 1) * (HALF - 0.08);
        z = (this.random() * 2 - 1) * (HALF - 0.08);
        const ground = terrainH(x, z);
        y = ground + 0.045 + (WL0 - 0.09 - ground) * this.random();
        if (ground < WL0 - 0.14) break;
      }
      this.decor.push({ p: [x, y, z], r: 0.012 + this.random() * 0.023, seed: this.random() });
    }
    this.counts();
  }

  makeBody(kind, p) {
    const r = kind === 'coconut' ? 0.11 : 0.075 + this.random() * 0.025;
    const density = kind === 'coconut' ? 0.62 : 2.4;
    const volume = (4 / 3) * Math.PI * r * r * r;
    return {
      id: ++this.nextId,
      kind,
      r,
      density,
      volume,
      mass: volume * density,
      p: [p[0], p[1], p[2]],
      v: [0, 0, 0],
      prevVolume: 0,
      submerged: 0,
      seed: this.random(),
      sleep: 0,
      sleepTime: 0,
      contact: false,
      squash: 0,
      squashV: 0,
      spin: [0, 0],
      held: false,
      target: null,
      hung: null,
      splashAt: -1e3,
    };
  }

  coconutSpot(p, j) {
    const a = (j * TAU) / 3 + p * 1.3;
    const s = PALMS[p];
    const b = this.palms[p].bend;
    return [
      s.x + s.lean[0] + b[0] + Math.cos(a) * 0.112,
      s.y + s.h - 0.105 + Math.sin(a) * 0.018,
      s.z + s.lean[1] + b[1] + Math.sin(a) * 0.105,
    ];
  }

  palmPoint(p, t) {
    const s = PALMS[p];
    const b = this.palms[p].bend;
    return [
      s.x + (s.lean[0] + b[0]) * t * t,
      s.y + s.h * t,
      s.z + (s.lean[1] + b[1]) * t * t,
    ];
  }

  drop(kind = 'pebble', x, z) {
    if (this.bodies.length >= 40) {
      const i = this.bodies.findIndex((b) => !b.hung && !b.held);
      if (i < 0) return null;
      this.bodies.splice(i, 1);
    }
    if (x === undefined) {
      x = 0;
      z = 0;
      for (let k = 0; k < 100; k++) {
        x = (this.random() * 2 - 1) * (HALF - 0.25);
        z = (this.random() * 2 - 1) * (HALF - 0.25);
        if (terrainH(x, z) < this.water.level - 0.32) break;
      }
    }
    const body = this.makeBody(kind, [x, 2.7, z]);
    this.bodies.push(body);
    return body;
  }

  kick(dx, dz, squash = 0.3) {
    const factor = this.reduced ? 0.4 : 1;
    this.shear[2] += clamp(dx, -2, 2) * 0.25 * factor;
    this.shear[3] += clamp(dz, -2, 2) * 0.25 * factor;
    this.squash[1] += clamp(squash, -2, 2) * 0.3 * factor;
  }

  releaseTilt() {
    this.heldTilt = false;
    this.targetTilt[0] = 0;
    this.targetTilt[1] = 0;
    this.squash[1] -= Math.hypot(this.tilt[2], this.tilt[3]) * 0.5;
  }

  wob(p) {
    const sy = 1 - clamp(this.squash[0], -0.13, 0.13);
    const lat = 1 / Math.sqrt(sy);
    return [p[0] * lat + this.shear[0] * p[1], p[1] * sy, p[2] * lat + this.shear[1] * p[1]];
  }

  unwob(p) {
    const sy = 1 - clamp(this.squash[0], -0.13, 0.13);
    const lat = 1 / Math.sqrt(sy);
    const y = p[1] / sy;
    return [(p[0] - this.shear[0] * y) / lat, y, (p[2] - this.shear[1] * y) / lat];
  }

  toWorld(p) {
    const q = this.wob(p);
    return transform(this.M, q);
  }

  toLocal(p) {
    return this.unwob(transform(this.Minv, p));
  }

  dirToLocal(p) {
    const a = this.toLocal(p);
    const b = this.toLocal([0, 0, 0]);
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  rayLocal(ray) {
    return { origin: this.toLocal(ray.origin), direction: norm(this.dirToLocal(ray.direction)) };
  }

  updateTransform() {
    const ax = this.tilt[0];
    const az = this.tilt[1];
    const cx = Math.cos(ax);
    const sx = Math.sin(ax);
    const cz = Math.cos(az);
    const sz = Math.sin(az);
    const m = this.M;
    m[0] = cz;
    m[1] = sz;
    m[2] = 0;
    m[3] = 0;
    m[4] = -sz * cx;
    m[5] = cz * cx;
    m[6] = sx;
    m[7] = 0;
    m[8] = sz * sx;
    m[9] = -cz * sx;
    m[10] = cx;
    m[11] = 0;
    m[12] = 0;
    m[14] = 0;
    m[15] = 1;
    const sy = 1 - clamp(this.squash[0], -0.13, 0.13);
    this.lift = (HALF * (Math.abs(m[1]) + Math.abs(m[9]))) / Math.sqrt(sy);
    m[13] = this.lift;
    invert4(this.Minv, m);
    transformInto(this.Minv, 0, -9.8, 0, 0, this.gravity);
  }

  counts() {
    const t = this.tally;
    t.afloat = 0;
    t.sunk = 0;
    t.ashore = 0;
    for (const b of this.bodies) {
      if (b.hung) {
        t.ashore++;
        continue;
      }
      const s = this.water.height(b.p[0], b.p[2]);
      const land = terrainH(b.p[0], b.p[2]);
      if (b.contact && b.p[1] + b.r < s - 0.01) t.sunk++;
      else if (b.contact && land >= s - 0.018) t.ashore++;
      else if (b.p[1] - b.r < s && b.p[1] + b.r > land + 0.01) t.afloat++;
    }
    t.total = this.bodies.length;
    return t;
  }

  step(dt) {
    dt = Math.min(dt, 0.05);
    this.bodyAccumulator += dt;
    let count = 0;
    const limit = this.maxBodySteps;
    while (this.bodyAccumulator >= 1 / 240 && count++ < limit) {
      this.bodyStep(1 / 240);
      this.bodyAccumulator -= 1 / 240;
      this.waterAccumulator += 1 / 240;
      if (this.waterAccumulator >= 1 / 120) {
        this.water.step(1 / 120, this.gravity[0], this.gravity[2]);
        this.waterAccumulator -= 1 / 120;
      }
    }
    this.updateTransform();
    this.bodyAccumulator = Math.min(this.bodyAccumulator, 1 / 240);
    this.waterAccumulator = Math.min(this.waterAccumulator, 1 / 120);
    this.counts();
  }

  bodyStep(dt) {
    this.time += dt;
    const tilt = this.tilt;
    const heldK = this.heldTilt ? 300 : 70;
    const heldC = this.heldTilt ? 24 : 7.5;
    for (let j = 0; j < 2; j++) {
      const a = heldK * (this.targetTilt[j] - tilt[j]) - heldC * tilt[j + 2];
      this.angularAcceleration[j] = a;
      tilt[j + 2] += a * dt;
      tilt[j] = clamp(tilt[j] + tilt[j + 2] * dt, -TILT_MAX, TILT_MAX);
    }
    this.updateTransform();
    const sw = TAU * (2 + 2.2 * this.firm);
    const qw = TAU * (2.6 + 2.4 * this.firm);
    const reduced = this.reduced ? 0.4 : 1;
    for (let j = 0; j < 2; j++) {
      const drive = -this.angularAcceleration[1 - j] * (j ? -1 : 1) * 0.9 * reduced;
      this.shear[j + 2] += (-sw * sw * this.shear[j] - sw * 0.42 * this.shear[j + 2] + drive) * dt;
      this.shear[j] = clamp(this.shear[j] + this.shear[j + 2] * dt, -0.15, 0.15);
    }
    this.squash[1] += (-qw * qw * this.squash[0] - qw * 0.42 * this.squash[1]) * dt;
    this.squash[0] = clamp(this.squash[0] + this.squash[1] * dt, -0.13, 0.13);

    for (let p = 0; p < 3; p++) {
      const palm = this.palms[p];
      const w = TAU * 1.05;
      for (let j = 0; j < 2; j++) {
        const gravity = this.gravity[j ? 2 : 0] * 0.21;
        const breeze = this.reduced
          ? 0
          : Math.sin(this.time * 1.25 + p * 2.3 + j) * 0.34 + Math.sin(this.time * 2.7 + p) * 0.12;
        const whip = -this.angularAcceleration[1 - j] * (j ? -1 : 1) * 0.055;
        const k = palm.held ? 160 : w * w;
        const goal = palm.held ? palm.target[j] : 0;
        palm.bend[j + 2] +=
          (-k * (palm.bend[j] - goal) - w * (palm.held ? 2.1 : 0.55) * palm.bend[j + 2] + gravity + whip + breeze) *
          dt;
        palm.bend[j] = clamp(palm.bend[j] + palm.bend[j + 2] * dt, -0.7, 0.7);
      }
    }

    const water = this.water;
    const tiltMag = Math.hypot(tilt[0], tilt[1]);
    for (const b of this.bodies) {
      if (b.hung) {
        const spot = this.coconutSpot(b.hung.p, b.hung.j);
        b.p[0] = spot[0];
        b.p[1] = spot[1];
        b.p[2] = spot[2];
        continue;
      }
      const wave = water.sample(b.p[0], b.p[2], WAVE);
      const cap = clamp(wave.height - (b.p[1] - b.r), 0, 2 * b.r);
      const vol = wave.wet ? Math.PI * cap * cap * (b.r - cap / 3) : 0;
      const frac = vol / b.volume;
      const before = b.submerged;
      b.submerged = frac;
      if (Math.abs(vol - b.prevVolume) > 1e-8) {
        water.addVolume(
          b.p[0],
          b.p[2],
          clamp(vol - b.prevVolume, -b.volume * 0.2, b.volume * 0.2),
          b.r * 0.9,
        );
      }
      b.prevVolume = vol;
      if (frac > 0.025 && before < 0.025 && b.v[1] < -0.65 && this.time - b.splashAt > 0.4) {
        const impact = -b.v[1];
        b.splashAt = this.time;
        water.addVolume(b.p[0], b.p[2], -Math.min(0.012, b.volume * impact * 0.55), b.r * 1.3);
        for (let k = 0; k < 8; k++) {
          const a = (k * TAU) / 8;
          water.addVolume(
            b.p[0] + Math.cos(a) * b.r * 1.8,
            b.p[2] + Math.sin(a) * b.r * 1.8,
            Math.min(0.009, b.volume * impact * 0.4) / 8,
            b.r * 0.7,
          );
        }
        this.burst(b.p[0], wave.height, b.p[2], impact);
        this.kick(b.v[0] * b.mass * 10, b.v[2] * b.mass * 10, impact * b.mass * 20);
      }
      const flow = Math.hypot(wave.fx, wave.fz);
      const wake =
        b.held ||
        (b.contact && b.submerged > 0.1 && flow > 0.08) ||
        tiltMag > 0.012 ||
        ((b.kind === 'coconut' || !b.contact) &&
          Math.abs(wave.height - b.p[1]) < b.r * 1.6 &&
          water.energy > 0.03);
      if (wake) {
        b.sleep = 0;
        b.sleepTime = 0;
      }
      if (b.sleep) {
        b.squash *= 0.98;
        continue;
      }
      b.contact = false;
      let px = b.p[0];
      let py = b.p[1];
      let pz = b.p[2];
      let vx = b.v[0];
      let vy = b.v[1];
      let vz = b.v[2];
      let ax;
      let ay;
      let az;
      if (b.held && b.target) {
        ax = 460 * (b.target[0] - px) - 35 * vx;
        ay = 460 * (b.target[1] - py) - 35 * vy;
        az = 460 * (b.target[2] - pz) - 35 * vz;
      } else {
        ax = this.gravity[0] + (wave.nx * 9.8 * vol) / b.mass;
        ay = this.gravity[1] + (wave.ny * 9.8 * vol) / b.mass;
        az = this.gravity[2] + (wave.nz * 9.8 * vol) / b.mass;
        const rx = vx - wave.fx * 0.7;
        const ry = vy;
        const rz = vz - wave.fz * 0.7;
        const speed = Math.hypot(rx, ry, rz);
        const denom = Math.max(0.65, b.density);
        ax -= (rx * frac * (2.8 + speed * 2.4)) / denom;
        ay -= (ry * frac * (7 + speed * 2.4)) / denom;
        az -= (rz * frac * (2.8 + speed * 2.4)) / denom;
      }
      vx = clamp(vx + ax * dt, -9, 9);
      vy = clamp(vy + ay * dt, -9, 9);
      vz = clamp(vz + az * dt, -9, 9);
      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;
      b.p[0] = px;
      b.p[1] = py;
      b.p[2] = pz;
      b.v[0] = vx;
      b.v[1] = vy;
      b.v[2] = vz;
      this.sandContact(b, dt);
      for (const axis of [0, 2]) {
        const lim = HALF - b.r - 0.003;
        if (Math.abs(b.p[axis]) > lim) {
          b.p[axis] = clamp(b.p[axis], -lim, lim);
          b.v[axis] *= -0.38;
          b.sleep = 0;
        }
      }
      this.palmCollide(b);
      const speed = Math.hypot(b.v[0], b.v[1], b.v[2]);
      if (speed < 0.038 && b.contact && !b.held) b.sleepTime += dt;
      else b.sleepTime = 0;
      if (b.sleepTime > 0.5) {
        b.sleep = 1;
        b.v[0] = 0;
        b.v[1] = 0;
        b.v[2] = 0;
      }
      b.squashV += (-200 * b.squash - 14 * b.squashV) * dt;
      b.squash = clamp(b.squash + b.squashV * dt, -0.1, 0.23);
      b.spin[0] += (b.v[2] / b.r) * dt;
      b.spin[1] -= (b.v[0] / b.r) * dt;
      if (b.kind === 'pebble' && frac > 0.95 && !b.contact && this.random() < dt * 7 && this.bubbles.length < 260) {
        this.bubbles.push({
          p: [b.p[0], b.p[1] + b.r, b.p[2]],
          r: 0.012,
          v: 0.21,
          age: 0,
          phase: this.random() * TAU,
        });
      }
      if (!Number.isFinite(b.p[0] + b.p[1] + b.p[2])) {
        b.p[0] = 1.8;
        b.p[1] = 2.7;
        b.p[2] = 1.8;
        b.v[0] = 0;
        b.v[1] = 0;
        b.v[2] = 0;
        b.prevVolume = 0;
      }
    }

    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (a.hung && b.hung) continue;
        const dx = b.p[0] - a.p[0];
        const dy = b.p[1] - a.p[1];
        const dz = b.p[2] - a.p[2];
        const len2 = dx * dx + dy * dy + dz * dz;
        const reach = a.r + b.r;
        if (len2 >= reach * reach || len2 < 1e-12) continue;
        const len = Math.sqrt(len2);
        const nx = dx / len;
        const ny = dy / len;
        const nz = dz / len;
        const rvx = b.v[0] - a.v[0];
        const rvy = b.v[1] - a.v[1];
        const rvz = b.v[2] - a.v[2];
        const speed = rvx * nx + rvy * ny + rvz * nz;
        if (a.hung || b.hung) {
          if (Math.abs(speed) < 0.4) continue;
          if (a.hung) {
            a.hung = null;
            a.v[0] = rvx * 0.4;
            a.v[1] = rvy * 0.4;
            a.v[2] = rvz * 0.4;
            a.sleep = 0;
          }
          if (b.hung) {
            b.hung = null;
            b.v[0] = rvx * 0.4;
            b.v[1] = rvy * 0.4;
            b.v[2] = rvz * 0.4;
            b.sleep = 0;
          }
        }
        const ia = a.held ? 0 : 1 / a.mass;
        const ib = b.held ? 0 : 1 / b.mass;
        const inv = 1 / (ia + ib || 1);
        const pen = reach - len;
        a.p[0] -= nx * pen * ia * inv;
        a.p[1] -= ny * pen * ia * inv;
        a.p[2] -= nz * pen * ia * inv;
        b.p[0] += nx * pen * ib * inv;
        b.p[1] += ny * pen * ib * inv;
        b.p[2] += nz * pen * ib * inv;
        if (speed < 0) {
          const impulse = -1.3 * speed * inv;
          a.v[0] -= nx * impulse * ia;
          a.v[1] -= ny * impulse * ia;
          a.v[2] -= nz * impulse * ia;
          b.v[0] += nx * impulse * ib;
          b.v[1] += ny * impulse * ib;
          b.v[2] += nz * impulse * ib;
        }
        a.sleep = b.sleep = 0;
        a.sleepTime = b.sleepTime = 0;
      }
    }

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const bubble = this.bubbles[i];
      bubble.age += dt;
      bubble.p[0] += Math.sin(bubble.phase + bubble.age * 5) * 0.018 * dt;
      bubble.p[2] += Math.cos(bubble.phase + bubble.age * 4) * 0.015 * dt;
      bubble.p[1] += bubble.v * dt;
      const surface = water.height(bubble.p[0], bubble.p[2]);
      if (bubble.p[1] + bubble.r >= surface || bubble.age > 7) {
        water.addVolume(bubble.p[0], bubble.p[2], bubble.r * bubble.r * bubble.r * 1.2, 0.05);
        this.bubbles.splice(i, 1);
      }
    }
    if (!this.reduced && this.random() < dt * 0.8) {
      const x = (this.random() * 2 - 1) * 2.3;
      const z = (this.random() * 2 - 1) * 2.3;
      if (terrainH(x, z) < water.level - 0.13) water.addVolume(x, z, 0.00004, 0.07);
    }
    if (this.random() < dt * 0.65 && this.bubbles.length < 260) {
      const x = (this.random() * 2 - 1) * 2.4;
      const z = (this.random() * 2 - 1) * 2.4;
      const y = terrainH(x, z);
      if (y < water.level - 0.2) {
        this.bubbles.push({ p: [x, y + 0.02, z], r: 0.014, v: 0.12, age: 0, phase: this.random() * TAU });
      }
    }
  }

  palmCollide(b) {
    let px = b.p[0];
    let py = b.p[1];
    let pz = b.p[2];
    let vx = b.v[0];
    let vy = b.v[1];
    let vz = b.v[2];
    for (let p = 0; p < 3; p++) {
      const s = PALMS[p];
      const bend = this.palms[p].bend;
      const bx = s.lean[0] + bend[0];
      const bz = s.lean[1] + bend[1];
      for (let k = 0; k < 7; k++) {
        const t0 = k / 7;
        const t1 = (k + 1) / 7;
        const ax = s.x + bx * t0 * t0;
        const ay = s.y + s.h * t0;
        const az = s.z + bz * t0 * t0;
        const cx = s.x + bx * t1 * t1;
        const cy = s.y + s.h * t1;
        const cz = s.z + bz * t1 * t1;
        const sx = cx - ax;
        const sy = cy - ay;
        const sz = cz - az;
        const vv = sx * sx + sy * sy + sz * sz || 1e-8;
        const ux = px - ax;
        const uy = py - ay;
        const uz = pz - az;
        const t = clamp((ux * sx + uy * sy + uz * sz) / vv, 0, 1);
        const qx = ax + sx * t;
        const qy = ay + sy * t;
        const qz = az + sz * t;
        const dx = px - qx;
        const dy = py - qy;
        const dz = pz - qz;
        const len = Math.hypot(dx, dy, dz);
        const radius = b.r + 0.05 * (1 - 0.4 * t);
        if (len < radius && len > 1e-6) {
          const inv = 1 / len;
          const nx = dx * inv;
          const ny = dy * inv;
          const nz = dz * inv;
          const vn = vx * nx + vy * ny + vz * nz;
          const pen = radius - len;
          px += nx * pen;
          py += ny * pen;
          pz += nz * pen;
          if (vn < 0) {
            vx -= nx * vn * 1.35;
            vy -= ny * vn * 1.35;
            vz -= nz * vn * 1.35;
          }
          bend[2] += vx * 0.008;
          bend[3] += vz * 0.008;
        }
      }
    }
    b.p[0] = px;
    b.p[1] = py;
    b.p[2] = pz;
    b.v[0] = vx;
    b.v[1] = vy;
    b.v[2] = vz;
  }

  sandContact(b, dt) {
    const h = terrainH(b.p[0], b.p[2]);
    const e = 0.012;
    let nx = terrainH(b.p[0] - e, b.p[2]) - terrainH(b.p[0] + e, b.p[2]);
    let ny = 2 * e;
    let nz = terrainH(b.p[0], b.p[2] - e) - terrainH(b.p[0], b.p[2] + e);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const gap = (b.p[1] - h) * ny - b.r;
    if (gap > 0.004) return;
    let vx = b.v[0];
    let vy = b.v[1];
    let vz = b.v[2];
    let vn = vx * nx + vy * ny + vz * nz;
    if (gap < 0) {
      b.p[0] -= nx * gap;
      b.p[1] -= ny * gap;
      b.p[2] -= nz * gap;
    }
    b.contact = true;
    if (vn < 0) {
      const bounce = vn < -0.45 ? 0.2 : 0;
      const scale = vn * (1 + bounce);
      vx -= nx * scale;
      vy -= ny * scale;
      vz -= nz * scale;
      if (vn < -0.6) {
        b.squashV += Math.min(2, -vn) * 0.55;
        this.kick(vx * b.mass * 8, vz * b.mass * 8, -vn * b.mass * 9);
      }
    }
    const normalSpeed = vx * nx + vy * ny + vz * nz;
    const tx = vx - nx * normalSpeed;
    const ty = vy - ny * normalSpeed;
    const tz = vz - nz * normalSpeed;
    const speed = Math.hypot(tx, ty, tz);
    const gdn = this.gravity[0] * nx + this.gravity[1] * ny + this.gravity[2] * nz;
    const normalAccel = Math.max(0, -gdn - (9.8 * b.submerged) / b.density);
    const mu = b.kind === 'pebble' ? 0.62 : 0.42;
    const drop = Math.min(speed, mu * normalAccel * dt);
    if (speed > 1e-8) {
      const s = drop / speed;
      vx -= tx * s;
      vy -= ty * s;
      vz -= tz * s;
    }
    if (speed < 0.015 && Math.hypot(this.tilt[0], this.tilt[1]) < 0.01 && !b.held) {
      b.v[0] = 0;
      b.v[1] = Math.max(0, normalSpeed) * ny;
      b.v[2] = 0;
    } else {
      b.v[0] = vx;
      b.v[1] = vy;
      b.v[2] = vz;
    }
  }

  burst(x, y, z, impact) {
    const n = Math.floor(clamp(impact * 5, 8, 25));
    for (let j = 0; j < n && this.bubbles.length < 260; j++) {
      const a = this.random() * TAU;
      const r = 0.03 + this.random() * 0.14;
      this.bubbles.push({
        p: [x + Math.cos(a) * r, y - 0.01 - this.random() * 0.08, z + Math.sin(a) * r],
        r: 0.009 + this.random() * 0.027,
        v: 0.12 + this.random() * 0.22,
        age: 0,
        phase: this.random() * TAU,
      });
    }
  }

  validate() {
    if (!Number.isFinite(this.water.energy)) return false;
    for (const b of this.bodies) {
      if (!Number.isFinite(b.p[0] + b.p[1] + b.p[2] + b.v[0] + b.v[1] + b.v[2])) return false;
    }
    for (const v of this.shear) if (!Number.isFinite(v)) return false;
    for (const v of this.tilt) if (!Number.isFinite(v)) return false;
    for (const v of this.squash) if (!Number.isFinite(v)) return false;
    return true;
  }
}

function invert4(out, a) {
  const t = [
    [a[0], a[4], a[8], a[12], 1, 0, 0, 0],
    [a[1], a[5], a[9], a[13], 0, 1, 0, 0],
    [a[2], a[6], a[10], a[14], 0, 0, 1, 0],
    [a[3], a[7], a[11], a[15], 0, 0, 0, 1],
  ];
  for (let c = 0; c < 4; c++) {
    let k = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(t[r][c]) > Math.abs(t[k][c])) k = r;
    const row = t[k];
    t[k] = t[c];
    t[c] = row;
    const v = t[c][c];
    if (Math.abs(v) < 1e-12) return out;
    for (let j = 0; j < 8; j++) t[c][j] /= v;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = t[r][c];
      for (let j = 0; j < 8; j++) t[r][j] -= f * t[c][j];
    }
  }
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = t[r][c + 4];
  return out;
}
