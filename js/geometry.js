import { clamp, cross, dot, norm } from './math.js';
import { HALF, PALMS, SIDE, TAU, WL0, terrainH, terrainNormal } from './world.js';

class MeshBuilder {
  constructor() {
    this.v = [];
    this.i = [];
  }

  vertex(p, n, uv = [0, 0], extra = [-1, 0, 0, 0]) {
    const index = this.v.length / 12;
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], extra[0], extra[1], extra[2], extra[3]);
    return index;
  }

  tri(a, b, c) {
    const ax = this.v[a * 12];
    const ay = this.v[a * 12 + 1];
    const az = this.v[a * 12 + 2];
    const bx = this.v[b * 12] - ax;
    const by = this.v[b * 12 + 1] - ay;
    const bz = this.v[b * 12 + 2] - az;
    const cx = this.v[c * 12] - ax;
    const cy = this.v[c * 12 + 1] - ay;
    const cz = this.v[c * 12 + 2] - az;
    const nx = this.v[a * 12 + 3];
    const ny = this.v[a * 12 + 4];
    const nz = this.v[a * 12 + 5];
    const fx = by * cz - bz * cy;
    const fy = bz * cx - bx * cz;
    const fz = bx * cy - by * cx;
    if (fx * nx + fy * ny + fz * nz < 0) this.i.push(a, c, b);
    else this.i.push(a, b, c);
  }

  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  finish() {
    return { vertices: new Float32Array(this.v), indices: new Uint32Array(this.i) };
  }
}

function sidePoint(side, t) {
  if (side === 0) return [t, HALF];
  if (side === 1) return [HALF, -t];
  if (side === 2) return [-t, -HALF];
  return [-HALF, t];
}

const SIDE_NORMAL = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 0, -1],
  [-1, 0, 0],
];

export class IslandGeometry {
  constructor(quality) {
    this.quality = quality;
    this.meshes = {
      terrain: this.terrain(quality.terrain),
      soil: this.soil(quality.soil),
      water: this.water(quality.gn),
      walls: this.walls(quality.gn),
    };
    const palms = this.palms();
    this.meshes.trunks = palms.trunks;
    this.meshes.leaves = palms.leaves;
    this.meshes.sphere = this.sphere();
  }

  terrain(n) {
    const mesh = new MeshBuilder();
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = -HALF + (i * SIDE) / n;
        const z = -HALF + (j * SIDE) / n;
        mesh.vertex([x, terrainH(x, z), z], terrainNormal(x, z), [i / n, j / n]);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        mesh.quad(a, a + 1, a + n + 2, a + n + 1);
      }
    }
    return mesh.finish();
  }

  soil(n) {
    const mesh = new MeshBuilder();
    for (let side = 0; side < 4; side++) {
      const normal = SIDE_NORMAL[side];
      const base = mesh.v.length / 12;
      for (let j = 0; j <= 6; j++) {
        for (let i = 0; i <= n; i++) {
          const t = -HALF + (i * SIDE) / n;
          const [x, z] = sidePoint(side, t);
          const y = (terrainH(x, z) * j) / 6;
          mesh.vertex([x, y, z], normal, [i / n, j / 6]);
        }
      }
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < n; i++) {
          const a = base + j * (n + 1) + i;
          mesh.quad(a, a + 1, a + n + 2, a + n + 1);
        }
      }
    }
    const a = mesh.vertex([-HALF, 0, -HALF], [0, -1, 0]);
    const b = mesh.vertex([HALF, 0, -HALF], [0, -1, 0]);
    const c = mesh.vertex([HALF, 0, HALF], [0, -1, 0]);
    const d = mesh.vertex([-HALF, 0, HALF], [0, -1, 0]);
    mesh.quad(a, b, c, d);
    return mesh.finish();
  }

  water(gn) {
    const mesh = new MeshBuilder();
    const gdx = SIDE / gn;
    for (let j = 0; j <= gn; j++) {
      for (let i = 0; i <= gn; i++) {
        mesh.vertex([-HALF + i * gdx, WL0, -HALF + j * gdx], [0, 1, 0], [i / gn, j / gn], [0, 0, 0, 0]);
      }
    }
    for (let j = 0; j < gn; j++) {
      for (let i = 0; i < gn; i++) {
        const a = j * (gn + 1) + i;
        mesh.quad(a, a + 1, a + gn + 2, a + gn + 1);
      }
    }
    return mesh.finish();
  }

  walls(gn) {
    const mesh = new MeshBuilder();
    const gdx = SIDE / gn;
    for (let side = 0; side < 4; side++) {
      const normal = SIDE_NORMAL[side];
      const base = mesh.v.length / 12;
      for (let j = 0; j <= 1; j++) {
        for (let i = 0; i <= gn; i++) {
          const t = -HALF + i * gdx;
          const [x, z] = sidePoint(side, t);
          mesh.vertex([x, j, z], normal, [i / gn, j], [1, 0, 0, 0]);
        }
      }
      for (let i = 0; i < gn; i++) {
        const a = base + i;
        mesh.quad(a, a + 1, a + gn + 2, a + gn + 1);
      }
    }
    return mesh.finish();
  }

  tube(mesh, path, radius, segments, sides, palm, flutter = 0, phase = 0) {
    const base = mesh.v.length / 12;
    const s = PALMS[palm];
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      const p = path(t);
      const a = path(clamp(t - 0.001, 0, 1));
      const b = path(clamp(t + 0.001, 0, 1));
      const dir = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const ref = Math.abs(dir[1]) > 0.85 ? [1, 0, 0] : [0, 1, 0];
      const u = norm(cross(dir, ref));
      const v = cross(dir, u);
      const r = radius(t);
      for (let k = 0; k <= sides; k++) {
        const ang = (k / sides) * TAU;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        const n = [u[0] * c + v[0] * sn, u[1] * c + v[1] * sn, u[2] * c + v[2] * sn];
        const q = [p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r];
        const weight = clamp((p[1] - s.y) / s.h, 0, 1);
        mesh.vertex(q, n, [k / sides, t], [palm, weight, flutter * t, phase]);
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < sides; i++) {
        const a = base + j * (sides + 1) + i;
        mesh.quad(a, a + 1, a + sides + 2, a + sides + 1);
      }
    }
  }

  leaf(mesh, path, width, palm, phase) {
    const s = PALMS[palm];
    const N = 9;
    const base = mesh.v.length / 12;
    for (let j = 0; j <= N; j++) {
      const t = j / N;
      const p = path(t);
      const a = path(Math.max(0, t - 0.002));
      const b = path(Math.min(1, t + 0.002));
      const dir = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const across = norm(cross(dir, [0, 1, 0]));
      const up = norm(cross(across, dir));
      const w = width * Math.sin(Math.PI * t) ** 0.75 + 0.001;
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        const q = [
          p[0] + across[0] * c * w + up[0] * sn * 0.005,
          p[1] + across[1] * c * w + up[1] * sn * 0.005,
          p[2] + across[2] * c * w + up[2] * sn * 0.005,
        ];
        const n = norm([
          across[0] * c * 0.4 + up[0] * sn,
          across[1] * c * 0.4 + up[1] * sn,
          across[2] * c * 0.4 + up[2] * sn,
        ]);
        mesh.vertex(q, n, [t, k / 4], [palm, clamp((p[1] - s.y) / s.h, 0, 1), t, phase]);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < 4; k++) {
        const a = base + j * 4 + k;
        const b = base + j * 4 + ((k + 1) % 4);
        mesh.quad(a, b, b + 4, a + 4);
      }
    }
  }

  palms() {
    const trunks = new MeshBuilder();
    const leaves = new MeshBuilder();
    for (let p = 0; p < PALMS.length; p++) {
      const s = PALMS[p];
      this.tube(
        trunks,
        (t) => [s.x + s.lean[0] * t * t, s.y + s.h * t, s.z + s.lean[1] * t * t],
        (t) => (0.059 - 0.027 * t) * (1 + 0.075 * Math.cos(t * TAU * 23)),
        48,
        10,
        p,
        0,
        p * 2,
      );
      const crown = [s.x + s.lean[0], s.y + s.h, s.z + s.lean[1]];
      for (let f = 0; f < s.fronds; f++) {
        const angle = (f * TAU) / s.fronds + p * 1.19;
        const len = 0.7 + 0.19 * Math.sin(f * 2.3 + p);
        const dir = [Math.cos(angle), 0, Math.sin(angle)];
        const side = [-dir[2], 0, dir[0]];
        const spine = (t) => [
          crown[0] + dir[0] * len * t,
          crown[1] + 0.23 * Math.sin(Math.PI * t) - 0.2 * t * t,
          crown[2] + dir[2] * len * t,
        ];
        this.tube(leaves, spine, (t) => 0.012 * (1 - t * 0.88), 14, 5, p, 0.25, f + p * 11);
        for (let k = 0; k < 12; k++) {
          const t = 0.08 + k * 0.071;
          const root = spine(t);
          const length = (0.09 + 0.22 * Math.sin(Math.PI * t) ** 0.7) * (1 - 0.28 * t);
          for (const sign of [-1, 1]) {
            const path = (u) => [
              root[0] + side[0] * sign * length * u + dir[0] * (0.14 * u - 0.08 * u * u),
              root[1] + 0.025 * Math.sin(Math.PI * u) - 0.15 * u * u,
              root[2] + side[2] * sign * length * u + dir[2] * (0.14 * u - 0.08 * u * u),
            ];
            this.leaf(leaves, path, 0.027 * (1 - t * 0.55), p, f * 2 + k * 0.3);
          }
        }
        this.leaf(leaves, (u) => spine(0.8 + 0.2 * u), 0.022, p, f + 7);
      }
    }
    return { trunks: trunks.finish(), leaves: leaves.finish() };
  }

  sphere() {
    const mesh = new MeshBuilder();
    const u = 24;
    const v = 16;
    for (let j = 0; j <= v; j++) {
      for (let i = 0; i <= u; i++) {
        const a = (i / u) * TAU;
        const b = (j / v) * Math.PI;
        const p = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
        mesh.vertex(p, p, [i / u, j / v]);
      }
    }
    for (let j = 0; j < v; j++) {
      for (let i = 0; i < u; i++) {
        const a = j * (u + 1) + i;
        mesh.quad(a, a + 1, a + u + 2, a + u + 1);
      }
    }
    return mesh.finish();
  }
}

void dot;
