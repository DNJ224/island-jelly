import { HALF, PALMS } from './world.js';
import { clamp, cross, dot, matInverse, matMul, mix, norm, perspectiveGL, perspectiveGPU, lookAt } from './math.js';

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.yaw = 0.62;
    this.pitch = 0.42;
    this.zoom = 1;
    this.target = [0, 0.85, 0];
    this.eye = [0, 2, 8];
    this.vp = new Float32Array(16);
    this.inverse = new Float32Array(16);
    this.distance = 12;
    this.sheet = false;
    this.resetting = false;
    this.reduced = false;
    this.fitKey = '';
    this.fitCache = 12;
    this.zMode = 'webgl';
  }

  fitDistance() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const key = [w, h, this.yaw.toFixed(3), this.pitch.toFixed(3)].join('/');
    if (this.fitKey === key) return this.fitCache;
    this.fitKey = key;
    const mobile = w <= 900;
    const left = mobile ? 14 : Math.min(330, w * 0.23);
    const right = mobile ? 14 : 326;
    const centerX = mobile ? w / 2 : (Math.min(330, w * 0.23) + (w - 310)) / 2;
    const centerY = h * (mobile ? 0.55 : 0.4725);
    const top = mobile ? Math.min(215, h * 0.25) : 80;
    const bottom = mobile ? Math.min(200, h * 0.24) : 128;
    const cp = Math.cos(this.pitch);
    const forward = [Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp];
    const rightV = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const up = cross(forward, rightV);
    const aspect = w / h;
    const f = 1 / Math.tan((17 * Math.PI) / 180);
    const points = [];
    for (const x of [-HALF, HALF]) {
      for (const z of [-HALF, HALF]) {
        for (const y of [0, 1.36]) points.push([x, y, z]);
      }
    }
    for (const palm of PALMS) {
      for (const q of [0, 0.9, -0.9]) {
        points.push([palm.x + palm.lean[0] + q, palm.y + palm.h + 0.25, palm.z + palm.lean[1]]);
        points.push([palm.x + palm.lean[0], palm.y + palm.h, palm.z + palm.lean[1] + q]);
      }
    }
    let distance = 10.6;
    for (const p of points) {
      const rx = p[0] - this.target[0];
      const ry = p[1] - this.target[1];
      const rz = p[2] - this.target[2];
      const x = rx * rightV[0] + ry * rightV[1] + rz * rightV[2];
      const y = rx * up[0] + ry * up[1] + rz * up[2];
      const z = rx * forward[0] + ry * forward[1] + rz * forward[2];
      const spaceX = (((x > 0 ? w - right - centerX : centerX - left) / w) * 2);
      const spaceY = (((y > 0 ? centerY - top : h - bottom - centerY) / h) * 2);
      distance = Math.max(
        distance,
        z + ((f / aspect) * Math.abs(x)) / Math.max(0.18, spaceX),
        z + (f * Math.abs(y)) / Math.max(0.25, spaceY),
      );
    }
    this.fitCache = clamp(distance + 0.16, 10.6, 28);
    return this.fitCache;
  }

  update() {
    if (this.resetting) {
      const k = this.reduced ? 1 : 0.13;
      this.yaw = mix(this.yaw, 0.62, k);
      this.pitch = mix(this.pitch, 0.42, k);
      this.zoom = mix(this.zoom, 1, k);
      if (Math.abs(this.yaw - 0.62) + Math.abs(this.pitch - 0.42) + Math.abs(this.zoom - 1) < 0.001) {
        this.resetting = false;
      }
    }
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const aspect = w / h;
    this.distance = clamp(this.fitDistance() * this.zoom, 3.5, 28);
    const cp = Math.cos(this.pitch);
    this.eye = [
      Math.sin(this.yaw) * cp * this.distance,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * cp * this.distance,
    ];
    const view = lookAt(this.eye, this.target);
    const projection =
      this.zMode === 'webgl'
        ? perspectiveGL((34 * Math.PI) / 180, aspect)
        : perspectiveGPU((34 * Math.PI) / 180, aspect);
    if (w > 900) {
      const left = Math.min(330, w * 0.23);
      const targetX = (left + (w - 310)) / 2;
      projection[8] = 1 - (2 * targetX) / w;
      projection[9] = -0.055;
    } else {
      const scale = this.sheet ? (aspect > 1.2 ? 0.55 : 0.61) : aspect < 0.65 ? 0.94 : 1;
      projection[0] *= scale;
      projection[5] *= scale;
      projection[9] = this.sheet ? (aspect > 1.2 ? -0.62 : -0.45) : 0.1;
      if (h < 480 && !this.sheet) projection[9] = 0;
    }
    matMul(this.vp, projection, view);
    matInverse(this.inverse, this.vp);
  }

  project(p) {
    const m = this.vp;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return {
      x: (x / w) * 0.5 * this.canvas.clientWidth + this.canvas.clientWidth * 0.5,
      y: (0.5 - (y / w) * 0.5) * this.canvas.clientHeight,
    };
  }

  ray(x, y) {
    const m = this.inverse;
    const cx = (x / this.canvas.clientWidth) * 2 - 1;
    const cy = 1 - (y / this.canvas.clientHeight) * 2;
    const w = m[3] * cx + m[7] * cy + m[11] + m[15];
    const qx = (m[0] * cx + m[4] * cy + m[8] + m[12]) / w;
    const qy = (m[1] * cx + m[5] * cy + m[9] + m[13]) / w;
    const qz = (m[2] * cx + m[6] * cy + m[10] + m[14]) / w;
    return {
      origin: [this.eye[0], this.eye[1], this.eye[2]],
      direction: norm([qx - this.eye[0], qy - this.eye[1], qz - this.eye[2]]),
    };
  }
}

void dot;
