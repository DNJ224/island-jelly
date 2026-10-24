import { chromium } from 'playwright-core';

const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
const base = process.env.IJ_URL || 'http://127.0.0.1:4173/';
const shots = process.env.IJ_SHOTS || '/opt/cursor/artifacts/screenshots';

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
  ],
});

const failures = [];
function check(name, cond, detail = '') {
  if (!cond) failures.push(name + (detail ? ': ' + detail : ''));
  else console.log('pass', name);
}

function watch(page) {
  const logs = [];
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (text.includes('favicon')) return;
    if (type === 'error' || type === 'warning') logs.push(type + ': ' + text);
  });
  page.on('pageerror', (err) => logs.push('pageerror: ' + err.message));
  return logs;
}

async function open(viewport, init) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width < 500 ? 2 : 1,
    hasTouch: true,
    isMobile: Math.min(viewport.width, viewport.height) <= 500,
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const logs = watch(page);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ij && (window.__ij.ready || window.__ij.error), null, { timeout: 30000 });
  return { context, page, logs };
}

const phone = { width: 390, height: 844 };
const gpu = await open(phone);
check('webgpu ready', await gpu.page.evaluate(() => window.__ij.ready));
check('webgpu backend', (await gpu.page.evaluate(() => window.__ij.state.backend)) === 'webgpu');
check('fallback hidden', await gpu.page.evaluate(() => document.getElementById('fallback').hidden));
const acted = await gpu.page.evaluate(async () => {
  const ij = window.__ij;
  const before = ij.energy();
  ij.stir(0.4, 0.3, 2);
  ij.tilt(0.15, -0.05, true);
  for (let i = 0; i < 12; i++) await ij.step(1);
  const tilted = Math.hypot(ij.state.tilt[0], ij.state.tilt[1]);
  ij.drop('coconut', 1.05, 0.15);
  ij.drop('pebble', 0.85, -0.4);
  await ij.step(360);
  const counts = { ...ij.counts() };
  const energy = ij.energy();
  document.querySelector('[data-flavour="2"]').click();
  const firm = document.getElementById('firmness');
  firm.value = 80;
  firm.dispatchEvent(new Event('input'));
  const damp = document.getElementById('damping');
  damp.value = 12;
  damp.dispatchEvent(new Event('input'));
  const tide = document.getElementById('tide');
  tide.value = 40;
  tide.dispatchEvent(new Event('input'));
  document.getElementById('pause').click();
  const paused = ij.state.paused && document.getElementById('pause').textContent === '继续';
  document.getElementById('pause').click();
  const resumed = !ij.state.paused;
  const flavoured = ij.state.flavour === 'Lime' && ij.state.firmness === 0.8 && ij.state.damping === 0.12 && Math.abs(ij.state.tide - 0.04) < 1e-6;
  document.getElementById('reset').click();
  const reset = ij.state.flavour === 'Lime' && ij.state.firmness === 0.5 && ij.state.tide === 0 && ij.counts().total === 16;
  return { before, energy, tilted, counts, paused, resumed, flavoured, reset, valid: ij.state.valid, resets: ij.state.waterResets, errors: ij.state.errors };
});
check('stir raises energy', acted.energy > acted.before + 0.001, String(acted.energy));
check('tilt moves the block', acted.tilted > 0.05, String(acted.tilted));
check('drop updates the tally', acted.counts.total === 18 && acted.counts.afloat + acted.counts.sunk >= 1, JSON.stringify(acted.counts));
check('sliders and flavour apply', acted.flavoured);
check('pause and resume', acted.paused && acted.resumed);
check('reset restores the sea', acted.reset);
check('simulation stays finite', acted.valid && acted.resets === 0 && acted.errors.length === 0, JSON.stringify(acted.errors));
await gpu.page.evaluate(async () => {
  window.__ij.reset();
  document.getElementById('reset-view').click();
  await window.__ij.step(1);
});
await gpu.page.screenshot({ path: `${shots}/phone-portrait.png` });

const sheet = await gpu.page.evaluate(async () => {
  const ij = window.__ij;
  ij.stir(-0.2, 0.8, 1.5);
  ij.tilt(0.1, 0.08, true);
  ij.drop('coconut', 0.4, 1.1);
  await ij.step(80);
  document.getElementById('sheet-handle').click();
  const opened = {
    open: document.getElementById('panel').classList.contains('open'),
    expanded: document.getElementById('sheet-handle').getAttribute('aria-expanded'),
    inert: document.getElementById('panel-content').inert,
  };
  const before = ij.counts().total;
  document.getElementById('drop-pebble').click();
  document.getElementById('sheet-handle').click();
  return {
    opened,
    dropped: ij.counts().total > before,
    closed: !document.getElementById('panel').classList.contains('open') && document.getElementById('panel-content').inert,
  };
});
check('sheet opens', sheet.opened.open && sheet.opened.expanded === 'true' && sheet.opened.inert === false, JSON.stringify(sheet.opened));
check('panel button drops a pebble', sheet.dropped);
await gpu.page.evaluate(() => document.getElementById('sheet-handle').click());
await gpu.page.screenshot({ path: `${shots}/phone-sheet.png` });
await gpu.page.evaluate(() => document.getElementById('sheet-handle').click());
check('sheet closes', sheet.closed);
const thrown = await gpu.page.evaluate(async () => {
  const ij = window.__ij;
  ij.reset();
  await ij.step(1);
  return ij.projectBody(null);
});
if (thrown && Number.isFinite(thrown.x)) {
  const box = await gpu.page.locator('#world').boundingBox();
  const x = box.x + thrown.x;
  const y = box.y + thrown.y;
  await gpu.page.mouse.move(x, y);
  await gpu.page.mouse.down();
  await gpu.page.mouse.move(x + 30, y + 120, { steps: 8 });
  await gpu.page.mouse.up();
}
const throwResult = await gpu.page.evaluate(async () => {
  const ij = window.__ij;
  await ij.step(240);
  const wet = ij.counts().afloat + ij.counts().sunk;
  return { wet, counts: { ...ij.counts() } };
});
check('throw sends a coconut into the water', throwResult.wet > 0, JSON.stringify(throwResult));
await gpu.page.waitForTimeout(2200);
const alive = await gpu.page.evaluate(() => ({
  ready: window.__ij.ready,
  err: document.getElementById('world').dataset.gpuError || window.__ij.error || '',
  frames: window.__ij.ready ? window.__ij.state.drawFrames : -1,
  frameMs: window.__ij.ready ? window.__ij.state.frameMs : -1,
  renderCpuMs: window.__ij.ready ? window.__ij.state.renderCpuMs : -1,
  physicsMs: window.__ij.ready ? window.__ij.state.physicsMs : -1,
  back: window.__ij.ready ? window.__ij.state.backbuffer : null,
}));
console.log('webgpu timings', JSON.stringify(alive));
check('webgpu stays ready', alive.ready && !alive.err, JSON.stringify(alive));
check('webgpu console', gpu.logs.length === 0, gpu.logs.join(' | '));
await gpu.context.close();

const land = await open({ width: 844, height: 390 });
check('landscape ready', await land.page.evaluate(() => window.__ij.ready && window.__ij.state.backend === 'webgpu'));
await land.page.waitForFunction(() => Number(document.getElementById('world').dataset.presented) > 0, null, { timeout: 20000 });
await land.page.screenshot({ path: `${shots}/phone-landscape.png` });
check('landscape console', land.logs.length === 0, land.logs.join(' | '));
await land.context.close();

const gl = await open(phone, () => {
  Object.defineProperty(navigator, 'gpu', { configurable: true, get: () => undefined });
});
const glState = await gl.page.evaluate(() => ({
  backend: window.__ij.state && window.__ij.state.backend,
  hidden: document.getElementById('fallback').hidden,
  status: document.getElementById('status-text').textContent,
}));
check('webgl runs when gpu is removed', glState.backend === 'webgl' && glState.hidden, JSON.stringify(glState));
await gl.page.evaluate(async () => {
  const ij = window.__ij;
  ij.stir(0.2, 0.5, 2);
  ij.tilt(0.12, -0.04, true);
  ij.drop('coconut', 1, 0.2);
  await ij.step(160);
});
await gl.page.screenshot({ path: `${shots}/phone-webgl.png` });
check('webgl console', gl.logs.length === 0, gl.logs.join(' | '));
await gl.context.close();

const none = await open(phone, () => {
  Object.defineProperty(navigator, 'gpu', { configurable: true, get: () => undefined });
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    if (type === 'webgl' || type === 'webgl2' || type === 'webgpu') return null;
    return orig.call(this, type, ...args);
  };
});
const fallback = await none.page.evaluate(() => ({
  hidden: document.getElementById('fallback').hidden,
  status: document.getElementById('status-text').textContent,
  ready: window.__ij.ready,
}));
check('notice only when both backends fail', fallback.hidden === false && fallback.ready === false && fallback.status === '无法显示', JSON.stringify(fallback));
await none.context.close();

const desk = await open({ width: 1280, height: 800 });
check('desktop ready', await desk.page.evaluate(() => window.__ij.ready));
await desk.page.waitForFunction(() => Number(document.getElementById('world').dataset.presented) > 0, null, { timeout: 20000 });
await desk.page.screenshot({ path: `${shots}/desktop.png` });
check('desktop console', desk.logs.length === 0, desk.logs.join(' | '));
await desk.context.close();

await browser.close();
if (failures.length) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('browser checks passed');
