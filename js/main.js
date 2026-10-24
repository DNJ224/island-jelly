import { clamp, dot, mix, norm } from './math.js';
import { chooseQuality, HALF, PALETTES, terrainH, TILT_MAX, WL0 } from './world.js';
import { JellyWater } from './water.js';
import { IslandPhysics } from './physics.js';
import { IslandGeometry } from './geometry.js';
import { View } from './view.js';
import { createWebGLRenderer } from './webgl.js';
import { createWebGPURenderer } from './webgpu.js';

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const coarse = matchMedia('(pointer: coarse)').matches;
const pointers = new Map();
let sim = null;
let view = null;
let renderer = null;
let paused = false;
let ready = false;
let gesture = null;
let pinch = null;
let deviceTilt = false;
let lastTime = 0;
let frameHandle = 0;
let meterValue = 0;
let lastTally = '';
let lastUI = -1;
let frameMs = 16;
let physicsMs = 0;
let backendLabel = 'WebGL';

const debug = (window.__ij = {
  ready: false,
  error: null,
  step: (n) => {
    for (let k = 0; k < (n || 1); k++) sim.step(1 / 120);
    renderer.render(sim);
  },
  drop: (kind, x, z) => sim.drop(kind, x, z),
  reset: () => reset(),
  stir: (x, z, speed = 1) => sim.water.stir(x, z, speed),
  tilt: (x, z, held = true) => {
    sim.targetTilt = [clamp(x, -TILT_MAX, TILT_MAX), clamp(z, -TILT_MAX, TILT_MAX)];
    sim.heldTilt = held;
    if (!held) sim.releaseTilt();
  },
  counts: () => sim.counts(),
  energy: () => sim.water.energy,
  setPaused: (value) => setPaused(value),
  project: (p) => view.project(sim.toWorld(p)),
  projectBody: (id) => {
    const body = id == null ? sim.bodies.find((b) => b.hung) : sim.bodies.find((b) => b.id === id);
    if (!body) return null;
    return view.project(sim.toWorld(body.p));
  },
  projectPalm: (i) => view.project(sim.toWorld(sim.palmPoint(i, 1))),
  get state() {
    if (!ready) return null;
    return {
      time: sim.time,
      paused,
      flavour: PALETTES[sim.palette].name,
      firmness: sim.firm,
      damping: sim.water.damp,
      tide: sim.water.level - WL0,
      tilt: Array.from(sim.tilt),
      shear: Array.from(sim.shear),
      squash: sim.squash[0],
      counts: sim.counts(),
      energy: sim.water.energy,
      bubbles: sim.bubbles.length,
      decor: sim.decor.length,
      gesture: gesture?.kind || null,
      valid: sim.validate(),
      waterResets: sim.water.resets,
      frameMs,
      physicsMs,
      renderCpuMs: renderer.cpuMs,
      drawFrames: renderer.frameCount,
      backbuffer: [renderer.width, renderer.height],
      errors: renderer.errors.slice(),
      backend: renderer.backend,
    };
  },
});

function showFallback(error) {
  ready = false;
  debug.ready = false;
  debug.error = String(error?.message || error || 'unavailable');
  cancelAnimationFrame(frameHandle);
  $('fallback').hidden = false;
  $('loading').style.display = 'none';
  $('status').classList.add('unavailable');
  $('status-text').textContent = '无法显示';
}

function setPaused(value) {
  paused = !!value;
  lastTime = performance.now();
  $('pause').textContent = paused ? '继续' : '暂停';
  $('pause').setAttribute('aria-pressed', String(paused));
  $('status').classList.toggle('paused', paused);
  $('status-text').textContent = paused ? `${backendLabel} · 已暂停` : `${backendLabel} · 实时`;
}

function updateUI(force = false) {
  if (!sim) return;
  if (force || sim.time - lastUI > 0.15) {
    lastUI = sim.time;
    const tally = sim.counts();
    const key = [tally.afloat, tally.sunk, tally.ashore].join(',');
    if (key !== lastTally) {
      lastTally = key;
      $('afloat').textContent = tally.afloat;
      $('sunk').textContent = tally.sunk;
      $('ashore').textContent = tally.ashore;
    }
  }
  const target = clamp(Math.sqrt(sim.water.energy) * 13, 0, 100);
  meterValue = mix(meterValue, target, 0.06);
  $('energy-bar').style.width = meterValue + '%';
  $('energy-bar').parentElement.setAttribute('aria-valuenow', String(Math.round(meterValue)));
}

function sheetState() {
  const mobile = innerWidth <= 900;
  const open = $('panel').classList.contains('open');
  $('panel-content').inert = mobile && !open;
  document.body.classList.toggle('sheet-open', mobile && open);
  $('sheet-handle').setAttribute('aria-expanded', String(open));
  if (view) view.sheet = mobile && open;
}

function reset() {
  if (!sim) return;
  clearGesture(false);
  pointers.clear();
  pinch = null;
  sim.water.setLevel(WL0);
  sim.reset();
  sim.firm = sim.water.firm = 0.5;
  sim.water.damp = 0.3;
  $('firmness').value = 50;
  $('damping').value = 30;
  $('tide').value = 0;
  $('firmness-value').textContent = '50';
  $('damping-value').textContent = '30';
  $('tide-value').textContent = '0 cm';
  meterValue = 0;
  lastTally = '';
  lastUI = -1;
  updateUI(true);
}

function localRay(x, y) {
  return sim.rayLocal(view.ray(x, y));
}

function sphereRay(ray, center, radius) {
  const ox = ray.origin[0] - center[0];
  const oy = ray.origin[1] - center[1];
  const oz = ray.origin[2] - center[2];
  const b = ox * ray.direction[0] + oy * ray.direction[1] + oz * ray.direction[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

function boxRay(ray, lo, hi) {
  let near = -1e9;
  let far = 1e9;
  let face = -1;
  for (let a = 0; a < 3; a++) {
    const q = ray.direction[a];
    if (Math.abs(q) < 1e-8) {
      if (ray.origin[a] < lo[a] || ray.origin[a] > hi[a]) return null;
      continue;
    }
    let u = (lo[a] - ray.origin[a]) / q;
    let v = (hi[a] - ray.origin[a]) / q;
    let side = a * 2;
    if (u > v) {
      const tmp = u;
      u = v;
      v = tmp;
      side++;
    }
    if (u > near) {
      near = u;
      face = side;
    }
    far = Math.min(far, v);
    if (near > far) return null;
  }
  return far > 0 ? { t: Math.max(0, near), far, face } : null;
}

function pick(x, y) {
  const ray = localRay(x, y);
  const scale = coarse ? 1.45 : 1.22;
  let closest = null;
  for (const body of sim.bodies) {
    const t = sphereRay(ray, body.p, body.r * scale);
    if (t !== null && (!closest || t < closest.t)) {
      closest = { kind: 'body', body, t, point: ray.origin.map((v, i) => v + ray.direction[i] * t) };
    }
  }
  if (closest) return closest;
  for (let i = 0; i < 3; i++) {
    const crown = sim.palmPoint(i, 1);
    const crownT = sphereRay(ray, crown, coarse ? 0.42 : 0.32);
    if (crownT !== null) return { kind: 'palm', palm: i, t: crownT, point: crown };
    for (let j = 1; j <= 5; j++) {
      const p = sim.palmPoint(i, j / 5);
      const t = sphereRay(ray, p, coarse ? 0.16 : 0.12);
      if (t !== null) return { kind: 'palm', palm: i, t, point: crown };
    }
  }
  const hit = boxRay(ray, [-HALF, 0, -HALF], [HALF, sim.water.level, HALF]);
  if (!hit) return { kind: 'orbit' };
  if (hit.face === 3 && ray.direction[1] < 0) {
    let t = (sim.water.level - ray.origin[1]) / ray.direction[1];
    for (let k = 0; k < 3; k++) {
      const x = ray.origin[0] + ray.direction[0] * t;
      const z = ray.origin[2] + ray.direction[2] * t;
      t = (sim.water.height(x, z) - ray.origin[1]) / ray.direction[1];
    }
    const p = ray.origin.map((v, i) => v + ray.direction[i] * t);
    if (Math.abs(p[0]) < HALF && Math.abs(p[2]) < HALF && terrainH(p[0], p[2]) < sim.water.height(p[0], p[2]) - 0.012) {
      return { kind: 'water', point: p };
    }
  }
  return { kind: 'tilt', point: ray.origin.map((v, i) => v + ray.direction[i] * hit.t) };
}

function planeHit(x, y, planePoint, planeNormal) {
  const ray = view.ray(x, y);
  const den = dot(ray.direction, planeNormal);
  if (Math.abs(den) < 1e-5) return null;
  const t = dot(planePoint.map((v, i) => v - ray.origin[i]), planeNormal) / den;
  return t > 0 ? ray.origin.map((v, i) => v + ray.direction[i] * t) : null;
}

function clearGesture(throwBody = true) {
  if (gesture?.kind === 'tilt') sim?.releaseTilt();
  if (gesture?.kind === 'palm') sim.palms[gesture.palm].held = false;
  if (gesture?.kind === 'body') {
    const body = gesture.body;
    body.held = false;
    body.target = null;
    body.sleep = 0;
    if (throwBody && gesture.history.length >= 2 && performance.now() - gesture.history.at(-1).time < 120) {
      const history = gesture.history;
      const last = history[history.length - 1];
      const first = history.find((p) => last.time - p.time < 110) || history[0];
      const dt = Math.max(0.02, (last.time - first.time) / 1000);
      body.v = last.p.map((v, i) => clamp(((v - first.p[i]) / dt) * 0.78, -6, 6));
    } else body.v = [0, 0, 0];
  }
  gesture = null;
  canvas.classList.remove('is-dragging');
}

function pointerPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function applyTilt(startTilt, dx, dy) {
  const right = sim.dirToLocal([Math.cos(view.yaw), 0, -Math.sin(view.yaw)]);
  const toward = sim.dirToLocal([Math.sin(view.yaw), 0, Math.cos(view.yaw)]);
  sim.targetTilt = [
    clamp(startTilt[0] + (right[2] * dx + toward[2] * dy) * 0.0013, -TILT_MAX, TILT_MAX),
    clamp(startTilt[1] - (right[0] * dx + toward[0] * dy) * 0.0013, -TILT_MAX, TILT_MAX),
  ];
  sim.heldTilt = true;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (!ready) return;
  const p = pointerPoint(e);
  pointers.set(e.pointerId, p);
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size > 1) {
    clearGesture(false);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: view.zoom,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        startTilt: [sim.tilt[0], sim.tilt[1]],
      };
      sim.heldTilt = true;
    }
    return;
  }
  const hit = e.button === 2 ? { kind: 'orbit' } : pick(p.x, p.y);
  gesture = {
    ...hit,
    start: p,
    last: p,
    time: performance.now(),
    startYaw: view.yaw,
    startPitch: view.pitch,
    startTilt: [sim.tilt[0], sim.tilt[1]],
    history: [],
  };
  view.resetting = false;
  canvas.classList.add('is-dragging');
  if (hit.kind === 'body' || hit.kind === 'palm') {
    const target = hit.kind === 'body' ? hit.body.p : sim.palmPoint(hit.palm, 1);
    const world = sim.toWorld(target);
    gesture.planePoint = world;
    gesture.planeNormal = norm(view.eye.map((v, i) => v - view.target[i]));
    gesture.offset = [0, 0, 0];
    const point = planeHit(p.x, p.y, world, gesture.planeNormal);
    if (point) gesture.offset = world.map((v, i) => v - point[i]);
    gesture.origin = [...target];
    if (hit.kind === 'body') {
      const body = hit.body;
      body.hung = null;
      body.held = true;
      body.target = [...body.p];
      body.sleep = 0;
      gesture.history.push({ p: [...body.p], time: performance.now() });
    } else {
      sim.palms[hit.palm].held = true;
      sim.palms[hit.palm].target = [sim.palms[hit.palm].bend[0], sim.palms[hit.palm].bend[1]];
      gesture.initialBend = [...sim.palms[hit.palm].target];
    }
  } else if (hit.kind === 'water') {
    sim.water.stir(hit.point[0], hit.point[2], 0.4);
    gesture.lastWater = hit.point;
  } else if (hit.kind === 'tilt') sim.heldTilt = true;
});

canvas.addEventListener('pointermove', (e) => {
  if (!ready) return;
  const p = pointerPoint(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (pointers.size >= 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const fit = view.fitDistance();
    view.zoom = clamp((pinch.zoom * pinch.distance) / Math.max(1, d), 3.5 / fit, 28 / fit);
    view.resetting = false;
    applyTilt(pinch.startTilt, (a.x + b.x) / 2 - pinch.cx, (a.y + b.y) / 2 - pinch.cy);
    return;
  }
  if (!gesture) {
    if (coarse) return;
    const hit = pick(p.x, p.y);
    canvas.className = hit.kind === 'water' ? 'is-water' : hit.kind === 'tilt' ? 'is-tilt' : hit.kind === 'body' || hit.kind === 'palm' ? 'is-pick' : '';
    return;
  }
  const now = performance.now();
  const dt = Math.max(0.004, (now - gesture.time) / 1000);
  const dx = p.x - gesture.start.x;
  const dy = p.y - gesture.start.y;
  if (gesture.kind === 'orbit') {
    view.yaw = gesture.startYaw - dx * 0.005;
    view.pitch = clamp(gesture.startPitch + dy * 0.004, 0.12, 1.22);
  } else if (gesture.kind === 'tilt') {
    applyTilt(gesture.startTilt, dx, dy);
  } else if (gesture.kind === 'water') {
    const ray = localRay(p.x, p.y);
    if (ray.direction[1] < -0.01) {
      const t = (sim.water.level - ray.origin[1]) / ray.direction[1];
      const point = ray.origin.map((v, i) => v + ray.direction[i] * t);
      if (Math.abs(point[0]) < HALF - 0.02 && Math.abs(point[2]) < HALF - 0.02) {
        const before = gesture.lastWater || point;
        const dist = Math.hypot(point[0] - before[0], point[2] - before[2]);
        const speed = dist / dt;
        const steps = Math.min(24, Math.max(1, Math.ceil(dist / 0.055)));
        for (let k = 1; k <= steps; k++) {
          const u = k / steps;
          sim.water.stir(mix(before[0], point[0], u), mix(before[2], point[2], u), speed / steps);
        }
        gesture.lastWater = point;
      }
    }
  } else {
    const world = planeHit(p.x, p.y, gesture.planePoint, gesture.planeNormal);
    if (world) {
      const point = sim.toLocal(world.map((v, i) => v + gesture.offset[i]));
      if (gesture.kind === 'body') {
        const body = gesture.body;
        point[0] = clamp(point[0], -HALF + body.r, HALF - body.r);
        point[2] = clamp(point[2], -HALF + body.r, HALF - body.r);
        point[1] = clamp(point[1], terrainH(point[0], point[2]) + body.r, 4.4);
        body.target = point;
        gesture.history.push({ p: [...point], time: now });
        while (gesture.history.length > 10 || (gesture.history.length > 2 && now - gesture.history[0].time > 150)) gesture.history.shift();
      } else {
        const palm = sim.palms[gesture.palm];
        palm.target = [
          clamp(gesture.initialBend[0] + point[0] - gesture.origin[0], -0.7, 0.7),
          clamp(gesture.initialBend[1] + point[2] - gesture.origin[2], -0.7, 0.7),
        ];
      }
    }
  }
  gesture.last = p;
  gesture.time = now;
});

function pointerEnd(e) {
  pointers.delete(e.pointerId);
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (pinch) {
    if (pointers.size < 2) {
      pinch = null;
      if (sim?.heldTilt && !deviceTilt) sim.releaseTilt();
    }
    clearGesture(false);
    return;
  }
  clearGesture(e.type === 'pointerup');
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('lostpointercapture', (e) => {
  if (pointers.has(e.pointerId)) {
    pointers.delete(e.pointerId);
    clearGesture(false);
  }
});
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!ready) return;
    e.preventDefault();
    view.resetting = false;
    const fit = view.fitDistance();
    view.zoom = clamp(view.zoom * Math.exp(e.deltaY * 0.001), 3.5 / fit, 28 / fit);
  },
  { passive: false },
);
document.addEventListener(
  'touchmove',
  (e) => {
    if (!e.target.closest('#panel')) e.preventDefault();
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (!ready || e.code !== 'Space' || e.repeat || e.target.closest('input, button, a')) return;
  e.preventDefault();
  sim.drop(Math.random() < 0.5 ? 'coconut' : 'pebble');
  updateUI(true);
});

function onOrientation(e) {
  if (!deviceTilt || !sim || pointers.size || gesture) return;
  const gamma = ((e.gamma || 0) * Math.PI) / 180;
  const beta = ((e.beta || 0) * Math.PI) / 180;
  sim.heldTilt = true;
  sim.targetTilt = [
    clamp(gamma * 0.45, -TILT_MAX, TILT_MAX),
    clamp((beta - Math.PI / 4) * 0.28, -TILT_MAX, TILT_MAX),
  ];
}

$('device-tilt').onclick = async () => {
  if (deviceTilt) {
    deviceTilt = false;
    window.removeEventListener('deviceorientation', onOrientation);
    $('device-tilt').setAttribute('aria-pressed', 'false');
    if (sim && !gesture && !pinch) sim.releaseTilt();
    return;
  }
  const ask = globalThis.DeviceOrientationEvent?.requestPermission;
  if (typeof ask === 'function') {
    try {
      const result = await ask.call(DeviceOrientationEvent);
      if (result !== 'granted') return;
    } catch {
      return;
    }
  }
  deviceTilt = true;
  window.addEventListener('deviceorientation', onOrientation);
  $('device-tilt').setAttribute('aria-pressed', 'true');
};

$('drop-pebble').onclick = () => {
  if (ready) {
    sim.drop('pebble');
    updateUI(true);
  }
};
$('drop-coconut').onclick = () => {
  if (ready) {
    sim.drop('coconut');
    updateUI(true);
  }
};
$('pause').onclick = () => setPaused(!paused);
$('reset').onclick = () => reset();
$('reset-view').onclick = () => {
  if (view) view.resetting = true;
};
for (const button of document.querySelectorAll('[data-flavour]')) {
  button.onclick = () => {
    if (!sim) return;
    sim.palette = Number(button.dataset.flavour);
    for (const other of document.querySelectorAll('[data-flavour]')) other.setAttribute('aria-pressed', String(other === button));
    document.documentElement.style.setProperty('--accent', PALETTES[sim.palette].accent);
  };
}
$('firmness').oninput = (e) => {
  if (!sim) return;
  sim.firm = sim.water.firm = Number(e.target.value) / 100;
  $('firmness-value').textContent = e.target.value;
};
$('damping').oninput = (e) => {
  if (!sim) return;
  sim.water.damp = Number(e.target.value) / 100;
  $('damping-value').textContent = e.target.value;
};
$('tide').oninput = (e) => {
  if (!sim) return;
  const v = Number(e.target.value) / 1000;
  sim.water.setLevel(WL0 + v);
  const cm = Math.round(v * 100);
  $('tide-value').textContent = (cm > 0 ? '+' : '') + cm + ' cm';
  for (const body of sim.bodies) if (!body.hung) body.sleep = 0;
};
$('sheet-handle').onclick = () => {
  $('panel').classList.toggle('open');
  sheetState();
};
window.addEventListener('resize', sheetState);
sheetState();

function frame(now) {
  frameHandle = requestAnimationFrame(frame);
  if (!ready) return;
  const dt = Math.min(0.05, lastTime ? (now - lastTime) / 1000 : 0.016);
  lastTime = now;
  const t0 = performance.now();
  if (!paused) {
    const p0 = performance.now();
    sim.step(dt);
    physicsMs = physicsMs ? physicsMs * 0.9 + (performance.now() - p0) * 0.1 : performance.now() - p0;
  }
  if (!(renderer.pending > 1)) renderer.render(sim);
  frameMs = frameMs ? frameMs * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0;
  updateUI();
}

async function boot() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    const quality = chooseQuality();
    const geo = new IslandGeometry(quality);
    const water = new JellyWater(quality);
    sim = new IslandPhysics(water, quality);
    view = new View(canvas);
    view.reduced = sim.reduced;
    try {
      renderer = await createWebGPURenderer(canvas, geo, quality, view, () => showFallback(new Error('device lost')));
    } catch {
      renderer = createWebGLRenderer(canvas, geo, quality, view);
    }
    backendLabel = renderer.backend === 'webgpu' ? 'WebGPU' : 'WebGL';
    ready = true;
    debug.ready = true;
    $('loading').style.display = 'none';
    $('status-text').textContent = `${backendLabel} · 实时`;
    updateUI(true);
    lastTime = performance.now();
    frameHandle = requestAnimationFrame(frame);
  } catch (error) {
    showFallback(error);
  }
}

boot();
