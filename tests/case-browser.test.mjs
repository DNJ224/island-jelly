import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
const base = process.env.CASE_URL || 'http://127.0.0.1:4173/case/';
const shots = process.env.CASE_SHOTS || '/opt/cursor/artifacts/screenshots';
mkdirSync(shots, { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--disable-dev-shm-usage'],
});

const failures = [];
function check(name, cond, detail = '') {
  if (!cond) failures.push(name + (detail ? `: ${detail}` : ''));
  else console.log('pass', name);
}

function isGold(value) {
  if (!value) return false;
  const text = String(value).replace(/\s/g, '').toLowerCase();
  return text === '#e4ae39' || text === 'rgb(228,174,57)';
}

function watch(page) {
  const logs = [];
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    const loc = msg.location()?.url || '';
    if (text.includes('favicon') || loc.includes('favicon')) return;
    if (type === 'error' || type === 'warning') logs.push(`${type}: ${text}`);
  });
  page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
  return logs;
}

const phone = { width: 390, height: 844 };

const context = await browser.newContext({
  viewport: phone,
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  recordVideo: { dir: '/tmp/case-video', size: phone },
});
const page = await context.newPage();
const logs = watch(page);
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__case && window.__case.ready, null, { timeout: 15000 });
await page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll('#grid img')];
  return imgs.length >= 18 && imgs.every((img) => img.complete);
}, null, { timeout: 15000 });

const idle = await page.evaluate(() => {
  const guns = document.querySelectorAll('[data-kind="gun"]');
  const rare = document.querySelector('[data-kind="rare"]');
  const preview = document.getElementById('preview').innerText;
  return {
    guns: guns.length,
    rare: rare ? rare.dataset.color : '',
    rareText: rare ? rare.innerText : '',
    knivesHidden: !/蝴蝶刀|鲍伊猎刀|猎杀者匕首|暗影双匕|弯刀（★）/.test(preview),
    note: document.getElementById('odds-note').textContent,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
});
check('17 guns and one gold tile', idle.guns === 17 && isGold(idle.rare) && idle.rareText.includes('稀有特殊物品'), JSON.stringify(idle));
check('preview hides knives', idle.knivesHidden);
check('odds labels', idle.note.includes('Valve 公布（二手来源）') && idle.note.includes('常见说法，未核实') && idle.note.includes('社区估算，非官方'));
check('no horizontal overflow', idle.overflow === false);
await page.screenshot({ path: `${shots}/case-idle.png` });

await page.click('#open');
await page.waitForTimeout(2200);
const mid = await page.evaluate(() => ({
  revealHidden: document.getElementById('reveal').hidden,
  transform: document.getElementById('reel').style.transform,
  cards: document.querySelectorAll('.card').length,
}));
check('reel is spinning', mid.revealHidden && mid.cards === 64 && mid.transform.includes('translate3d'), JSON.stringify(mid));
await page.screenshot({ path: `${shots}/case-mid-spin.png` });

await page.waitForFunction(() => document.getElementById('reveal').hidden === false, null, { timeout: 12000 });
const reveal = await page.evaluate(() => ({
  zh: document.getElementById('reveal-zh').textContent,
  en: document.getElementById('reveal-en').textContent,
  wear: document.getElementById('reveal-wear').textContent,
  floatText: document.getElementById('reveal-float').textContent,
  shown: document.getElementById('again').hidden === false,
}));
check('reveal shows a drop', Boolean(reveal.zh) && Boolean(reveal.en) && reveal.wear.includes('·') && /^\d\.\d{8}$/.test(reveal.floatText) && reveal.shown, JSON.stringify(reveal));
await page.screenshot({ path: `${shots}/case-reveal.png` });

await page.click('#btn-contents');
await page.waitForSelector('#contents-dlg[open]');
const audit = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-kind="entry"]')];
  const knives = rows.filter((row) => row.dataset.tier === 'rare_special');
  return {
    n: rows.length,
    guns: rows.filter((row) => row.dataset.tier !== 'rare_special').length,
    knives: knives.length,
    gold: knives.filter((row) => row.dataset.color.toLowerCase() === '#e4ae39').length,
    red: knives.filter((row) => row.dataset.color.toLowerCase() === '#eb4b4b').length,
    text: document.getElementById('contents-body').innerText,
  };
});
check('contents lists 17 + 30', audit.n === 47 && audit.guns === 17 && audit.knives === 30, JSON.stringify({ n: audit.n, guns: audit.guns, knives: audit.knives }));
check('contents knives are gold', audit.gold === 30 && audit.red === 0);
check('contents labels phases', audit.text.includes('社区估算，非官方') && audit.text.includes('常见说法，未核实'));
await page.screenshot({ path: `${shots}/case-contents.png` });
await page.click('#contents-close');
check('phone console', logs.length === 0, logs.join(' | '));

const video = page.video();
await context.close();
if (video) await video.saveAs('/opt/cursor/artifacts/case-open.webm');

const goldContext = await browser.newContext({
  viewport: phone,
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const goldPage = await goldContext.newPage();
const goldLogs = watch(goldPage);
await goldPage.goto(`${base}?force=gold`, { waitUntil: 'domcontentloaded' });
await goldPage.waitForFunction(() => window.__case && window.__case.ready, null, { timeout: 15000 });
await goldPage.click('#open');
await goldPage.waitForFunction(() => document.getElementById('reveal').hidden === false, null, { timeout: 12000 });
const gold = await goldPage.evaluate(() => {
  const bar = document.querySelector('.card.winner .bar');
  const revealEl = document.getElementById('reveal');
  const swatch = document.querySelector('#history .swatch');
  const style = (el) => (el ? getComputedStyle(el).backgroundColor : '');
  return {
    tier: revealEl.dataset.tier,
    revealColor: revealEl.dataset.color,
    nameColor: document.getElementById('reveal-zh').style.color,
    tierColor: document.getElementById('reveal-tier').style.color,
    bar: style(bar),
    card: document.querySelector('.card.winner')?.dataset.color || '',
    swatch: style(swatch),
    swatchData: swatch?.dataset.color || '',
    zh: document.getElementById('reveal-zh').textContent,
    goldClass: document.getElementById('stage').classList.contains('is-gold'),
    rays: getComputedStyle(document.querySelector('.rays')).display,
  };
});
check('forced gold reveal', gold.tier === 'rare_special' && gold.goldClass && gold.zh.includes('★'), JSON.stringify(gold));
check('gold is not covert red', isGold(gold.revealColor) && isGold(gold.card) && isGold(gold.bar) && isGold(gold.swatch) && isGold(gold.swatchData), JSON.stringify(gold));
check('gold name and glow', isGold(gold.nameColor) && isGold(gold.tierColor) && gold.rays !== 'none');
await goldPage.screenshot({ path: `${shots}/case-gold.png` });
check('gold console', goldLogs.length === 0, goldLogs.join(' | '));
await goldContext.close();

const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const deskPage = await desk.newPage();
const deskLogs = watch(deskPage);
await deskPage.goto(base, { waitUntil: 'domcontentloaded' });
await deskPage.waitForFunction(() => window.__case && window.__case.ready, null, { timeout: 15000 });
const deskState = await deskPage.evaluate(() => ({
  guns: document.querySelectorAll('[data-kind="gun"]').length,
  rare: document.querySelector('[data-kind="rare"]')?.dataset.color || '',
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
}));
check('desktop preview', deskState.guns === 17 && isGold(deskState.rare) && deskState.overflow === false, JSON.stringify(deskState));
await deskPage.screenshot({ path: `${shots}/case-desktop.png` });
check('desktop console', deskLogs.length === 0, deskLogs.join(' | '));
await desk.close();

await browser.close();
if (failures.length) {
  console.error(`FAILED\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('case browser checks passed');
