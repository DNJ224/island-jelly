export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function matMul(out, a, b) {
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      out[j * 4 + i] =
        a[i] * b[j * 4] +
        a[4 + i] * b[j * 4 + 1] +
        a[8 + i] * b[j * 4 + 2] +
        a[12 + i] * b[j * 4 + 3];
    }
  }
  return out;
}

export function matInverse(out, a) {
  const t = Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => (c < 4 ? a[c * 4 + r] : +(c - 4 === r))),
  );
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

export function transformInto(m, x, y, z, w, out) {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  return out;
}

export function transform(m, p, w = 1) {
  return transformInto(m, p[0], p[1], p[2], w, [0, 0, 0]);
}

export function lookAt(eye, target) {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / zl;
  const z1 = zy / zl;
  const z2 = zz / zl;
  let xx = z2;
  let xy = 0;
  let xz = -z0;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  const y0 = z1 * xz - z2 * xy;
  const y1 = z2 * xx - z0 * xz;
  const y2 = z0 * xy - z1 * xx;
  return new Float32Array([
    xx, y0, z0, 0,
    xy, y1, z1, 0,
    xz, y2, z2, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
    -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
    1,
  ]);
}

export function perspectiveGPU(fov, aspect, near = 0.05, far = 80) {
  const m = new Float32Array(16);
  const f = 1 / Math.tan(fov / 2);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

export function perspectiveGL(fov, aspect, near = 0.05, far = 80) {
  const m = new Float32Array(16);
  const f = 1 / Math.tan(fov / 2);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function orthoGPU(l, r, b, t, n, f) {
  return new Float32Array([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, 1 / (n - f), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), n / (n - f), 1,
  ]);
}

export function orthoGL(l, r, b, t, n, f) {
  return new Float32Array([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, 2 / (n - f), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), (n + f) / (n - f), 1,
  ]);
}

export function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = smooth(0, 1, x - ix);
  const v = smooth(0, 1, z - iz);
  return mix(
    mix(hash2(ix, iz), hash2(ix + 1, iz), u),
    mix(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), u),
    v,
  );
}
