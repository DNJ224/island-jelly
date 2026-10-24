import assert from 'node:assert/strict';
import { JellyWater } from '../js/water.js';
import { IslandPhysics } from '../js/physics.js';
import { HALF, WL0, terrainH } from '../js/world.js';

const quality = {
  phone: false,
  gn: 96,
  shadow: 256,
  caustics: 128,
  msaa: 1,
  pixels: 1_000_000,
  terrain: 32,
  soil: 16,
  shafts: 2,
  maxBodySteps: 12,
};

function make() {
  const water = new JellyWater(quality);
  return new IslandPhysics(water, quality);
}

const sim = make();
assert.equal(sim.bodies.length, 16, '9 coconuts + 7 pebbles');
assert.equal(sim.bodies.filter((b) => b.hung).length, 9);
assert.equal(sim.bodies.filter((b) => b.kind === 'pebble').length, 7);
assert.equal(sim.decor.length, 80);
assert.ok(sim.validate());

const top = terrainH(-0.3, -0.5);
assert.ok(top > WL0 + 0.12 && top < WL0 + 0.35, `island top ${top}`);

let depthSum = 0;
let depthN = 0;
let depthMin = 99;
let depthMax = -99;
for (let i = 0; i <= 24; i++) {
  const t = -HALF + (i * 5.2) / 24;
  for (const [x, z] of [
    [HALF, t],
    [-HALF, t],
    [t, HALF],
    [t, -HALF],
  ]) {
    const depth = WL0 - terrainH(x, z);
    depthSum += depth;
    depthN++;
    depthMin = Math.min(depthMin, depth);
    depthMax = Math.max(depthMax, depth);
  }
}
const depthMean = depthSum / depthN;
assert.ok(depthMean > 0.35 && depthMean < 0.9, `wall depth mean ${depthMean}`);
console.log('wall depth', depthMean.toFixed(3), 'range', depthMin.toFixed(3), depthMax.toFixed(3));

const beach = sim.bodies.filter((b) => b.kind === 'pebble');
for (const b of beach) {
  assert.ok(b.sleep === 1, 'beach pebble starts asleep');
  assert.ok(terrainH(b.p[0], b.p[2]) > WL0, 'pebble is on dry sand');
}
const spots = beach.map((b) => b.p.slice());
for (let i = 0; i < 240; i++) sim.step(1 / 60);
for (let i = 0; i < beach.length; i++) {
  const d = Math.hypot(beach[i].p[0] - spots[i][0], beach[i].p[1] - spots[i][1], beach[i].p[2] - spots[i][2]);
  assert.ok(d < 1e-3, `pebble drifted ${d}`);
}
assert.ok(sim.validate());
assert.equal(sim.water.resets, 0);

const before = sim.water.energy;
sim.water.stir(1.4, 1.1, 2);
sim.water.stir(1.5, 1.0, 2);
for (let i = 0; i < 8; i++) sim.step(1 / 120);
assert.ok(sim.water.energy > before + 1e-6, `stir energy ${sim.water.energy}`);
const peak = sim.water.energy;
for (let i = 0; i < 180; i++) sim.step(1 / 60);
assert.ok(sim.water.energy < peak * 0.5, `damping ${peak} -> ${sim.water.energy}`);
assert.ok(sim.validate());

sim.targetTilt[0] = 0.16;
sim.targetTilt[1] = -0.1;
sim.heldTilt = true;
for (let i = 0; i < 90; i++) sim.step(1 / 60);
assert.ok(Math.abs(sim.tilt[0]) > 0.1, 'tilt follows');
const leaned = sim.palms.some((p) => Math.hypot(p.bend[0], p.bend[1]) > 0.01);
assert.ok(leaned, 'palms lean downhill');
assert.ok(sim.water.energy > 1e-5, 'tilt sloshes');
const pebblesAfter = beach.map((b) => b.p.slice());
for (let i = 0; i < beach.length; i++) {
  const d = Math.hypot(
    beach[i].p[0] - pebblesAfter[i][0],
    beach[i].p[1] - pebblesAfter[i][1],
    beach[i].p[2] - pebblesAfter[i][2],
  );
  assert.ok(d < 0.02, `pebble rolled on a modest tilt ${d}`);
}
sim.releaseTilt();
for (let i = 0; i < 240; i++) sim.step(1 / 60);
assert.ok(Math.hypot(sim.tilt[0], sim.tilt[1]) < 0.03, `tilt settled ${sim.tilt[0]} ${sim.tilt[1]}`);
assert.ok(sim.validate());

const coco = sim.drop('coconut', 1.6, 0.4);
const pebble = sim.drop('pebble', 1.7, 0.2);
assert.ok(coco && pebble);
for (let i = 0; i < 300; i++) sim.step(1 / 60);
const surface = sim.water.height(coco.p[0], coco.p[2]);
assert.ok(coco.p[1] + coco.r > surface - 0.02, 'coconut reaches the surface');
assert.ok(coco.p[1] - coco.r < surface, 'coconut is in the water');
assert.ok(coco.p[1] > terrainH(coco.p[0], coco.p[2]) + 0.05, 'coconut is not on the seabed');
assert.ok(pebble.contact, 'pebble hit something');
assert.ok(pebble.p[1] < sim.water.level - 0.05, 'pebble sank');
const tally = sim.counts();
assert.ok(tally.afloat + tally.sunk + tally.ashore >= 1);
assert.ok(sim.validate());
assert.equal(sim.water.resets, 0);

sim.water.firm = 0;
sim.water.damp = 0;
for (let k = 0; k < 40; k++) sim.water.stir((k % 7) * 0.3 - 1, (k % 5) * 0.4 - 0.5, 3);
for (let i = 0; i < 60; i++) sim.step(1 / 30);
assert.ok(sim.validate(), 'aggressive stir stays finite');

const t0 = performance.now();
const bench = make();
for (let i = 0; i < 60; i++) bench.step(1 / 60);
const ms = performance.now() - t0;
console.log(`gn=96 1s sim ${ms.toFixed(1)} ms`);

const q168 = { ...quality, gn: 168 };
const t1 = performance.now();
const heavy = new IslandPhysics(new JellyWater(q168), q168);
for (let i = 0; i < 30; i++) heavy.step(1 / 60);
console.log(`gn=168 0.5s sim ${(performance.now() - t1).toFixed(1)} ms`);

console.log('sim ok', tally);
