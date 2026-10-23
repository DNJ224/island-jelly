import { noise, norm, smooth } from './math.js';

export const HALF = 2.6;
export const SIDE = 5.2;
export const WL0 = 1.3;
export const TAU = Math.PI * 2;
export const TILT_MAX = 0.17;

export function chooseQuality() {
  const touch =
    (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0) ||
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const w = typeof innerWidth === 'number' ? innerWidth : 1280;
  const h = typeof innerHeight === 'number' ? innerHeight : 800;
  const phone = touch && Math.min(w, h) <= 900;
  if (phone) {
    return {
      phone: true,
      gn: 128,
      shadow: 1024,
      caustics: 512,
      msaa: 2,
      pixels: 1_400_000,
      terrain: 96,
      soil: 96,
      shafts: 4,
      maxBodySteps: 8,
    };
  }
  return {
    phone: false,
    gn: 168,
    shadow: 2048,
    caustics: 768,
    msaa: 4,
    pixels: 2_400_000,
    terrain: 128,
    soil: 144,
    shafts: 6,
    maxBodySteps: 12,
  };
}

export function terrainH(x, z) {
  const r = Math.hypot((x + 0.3) / 1.75, (z + 0.5) / 1.48);
  let y = 0.88 - 0.34 * smooth(-3.8, 4.2, x + z);
  y += 0.016 * (noise(x * 3.1 + 19, z * 3.1 - 8) - 0.5);
  y += 0.003 * Math.sin(x * 24 + Math.sin(z * 7));
  y += 0.3 * (1 - smooth(0.1, 0.9, r)) + 0.45 * (1 - smooth(0.6, 1.2, r));
  y += 0.27 * Math.exp(-((x - 1.35) ** 2 / 0.35 + (z - 1.05) ** 2 / 0.85));
  y += 0.17 * Math.exp(-((x + 1.7) ** 2 + (z - 1.35) ** 2) / 0.03);
  y += 0.18 * Math.exp(-((x - 1.75) ** 2 + (z + 1.2) ** 2) / 0.036);
  return y;
}

export function terrainNormal(x, z) {
  const e = 0.012;
  return norm([
    terrainH(x - e, z) - terrainH(x + e, z),
    2 * e,
    terrainH(x, z - e) - terrainH(x, z + e),
  ]);
}

export const PALMS = [
  { x: -0.8, z: -0.54, h: 1.2, fronds: 9, lean: [-0.1, 0.04] },
  { x: 0.06, z: -0.28, h: 1.05, fronds: 9, lean: [0.13, 0.02] },
  { x: -0.32, z: -1.04, h: 0.88, fronds: 8, lean: [-0.04, -0.08] },
];
for (const palm of PALMS) palm.y = terrainH(palm.x, palm.z) - 0.012;

export const PALETTES = [
  {
    name: 'Lagoon',
    label: '潟湖',
    abs: [2.3, 0.52, 0.42],
    tint: [0.03, 0.34, 0.37],
    sand: [0.66, 0.48, 0.26],
    soil: [
      [0.15, 0.063, 0.035],
      [0.44, 0.23, 0.075],
      [0.67, 0.22, 0.26],
      [0.79, 0.62, 0.35],
      [0.43, 0.33, 0.18],
    ],
    leaf: [0.11, 0.43, 0.19],
    trunk: [0.57, 0.3, 0.13],
    coconut: [0.24, 0.12, 0.049],
    pebble: [0.62, 0.57, 0.48],
    accent: '#178a8a',
  },
  {
    name: 'Raspberry',
    label: '树莓',
    abs: [0.34, 2.2, 1.25],
    tint: [0.44, 0.05, 0.17],
    sand: [0.77, 0.53, 0.44],
    soil: [
      [0.2, 0.065, 0.063],
      [0.48, 0.23, 0.19],
      [0.74, 0.16, 0.29],
      [0.87, 0.6, 0.54],
      [0.49, 0.3, 0.27],
    ],
    leaf: [0.5, 0.14, 0.25],
    trunk: [0.62, 0.3, 0.26],
    coconut: [0.29, 0.105, 0.096],
    pebble: [0.71, 0.51, 0.56],
    accent: '#bd4871',
  },
  {
    name: 'Lime',
    label: '青柠',
    abs: [1.45, 0.5, 2.6],
    tint: [0.12, 0.25, 0.035],
    sand: [0.67, 0.57, 0.3],
    soil: [
      [0.18, 0.105, 0.03],
      [0.43, 0.31, 0.11],
      [0.59, 0.39, 0.27],
      [0.83, 0.71, 0.43],
      [0.44, 0.4, 0.21],
    ],
    leaf: [0.27, 0.49, 0.06],
    trunk: [0.59, 0.36, 0.12],
    coconut: [0.27, 0.17, 0.04],
    pebble: [0.62, 0.64, 0.43],
    accent: '#6d8e2a',
  },
];

export const SUN = norm([-0.55, 1, 0.65]);
