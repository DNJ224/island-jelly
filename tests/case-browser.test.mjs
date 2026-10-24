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
  const cells = [...document.querySelectorAll('#grid .cell')];
  const rare = cells[cells.length - 1];
  const first = cells[0];
  const tile = first.querySelector('.tile');
  const cap = first.querySelector('.cap');
  const tileBox = tile.getBoundingClientRect();
  const capBox = cap.getBoundingClientRect();
  const tiers = [];
  for (const cell of cells) {
    if (tiers[tiers.length - 1] !== cell.dataset.tier) tiers.push(cell.dataset.tier);
  }
  const preview = document.getElementById('preview').innerText;
  const tileStyle = getComputedStyle(tile);
  const cols = getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').filter(Boolean).length;
  const toolH = document.querySelector('.tools button').getBoundingClientRect().height;
  return {
    guns: guns.length,
    cells: cells.length,
    rare: rare ? rare.dataset.color : '',
    rareText: rare ? rare.innerText : '',
    rareSrc: rare?.querySelector('img')?.getAttribute('src') || '',
    knivesHidden: !/蝴蝶刀|鲍伊猎刀|猎杀者匕首|暗影双匕|弯刀（★）/.test(preview),
    note: document.getElementById('odds-note').textContent,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    tiers: tiers.join(','),
    weapon: first.querySelector('.wep')?.textContent || '',
    skin: first.querySelector('.skin')?.textContent || '',
    weight: getComputedStyle(first.querySelector('.wep')).fontWeight,
    align: getComputedStyle(cap).textAlign,
    nameBelow: capBox.top >= tileBox.bottom - 1,
    bgImage: tileStyle.backgroundImage,
    bg: tileStyle.backgroundColor,
    cols,
    toolH,
    english: /Dual Berettas|Melondrama|Rapid Eye Movement|FAMAS \|/.test(preview),
    heading: document.querySelector('.preview-h h2')?.textContent || '',
    inspect: document.getElementById('btn-inspect')?.textContent || '',
    st: getComputedStyle(document.documentElement).getPropertyValue('--st').trim(),
    forceTier: window.__case.forceTier,
    debug: window.__case.debug,
    spinMs: window.__case.spinMs,
    unlockMs: window.__case.unlockMs,
    reelLen: window.__case.reelLen,
    winnerAt: window.__case.winnerAt,
    passes: window.__case.winnerAt - window.__case.startAt,
  };
});
check('17 guns and one gold tile', idle.guns === 17 && idle.cells === 18 && isGold(idle.rare) && idle.rareText.includes('稀有特殊物品') && idle.rareSrc.includes('rare_special_item.png'), JSON.stringify(idle));
check('preview hides knives', idle.knivesHidden);
check('preview order blue to gold', idle.tiers === 'milspec,restricted,classified,covert,rare_special', idle.tiers);
check('tile names sit under a flat grey well', idle.weapon === 'FN57' && idle.skin === '涂鸦潦草' && Number(idle.weight) >= 600 && idle.align === 'left' && idle.nameBelow && idle.bgImage === 'none' && idle.bg === 'rgb(94, 94, 94)', JSON.stringify(idle));
check('phone grid is 3 columns', idle.cols === 3, String(idle.cols));
check('english subtitles are not on the tiles', idle.english === false);
check('inspect heading', idle.heading === '包含以下物品之一' && idle.inspect === '检视物品');
check('odds labels', idle.note.includes('Valve 公布（二手来源）') && idle.note.includes('常见说法，未核实') && idle.note.includes('社区估算，非官方') && idle.note.includes('磨损在范围内均匀分布，简化处理'));
check('tap targets and stattrak color', idle.toolH >= 44 && idle.st === '#cf6a32', JSON.stringify({ toolH: idle.toolH, st: idle.st }));
check('force hidden on the public page', idle.debug === false && idle.forceTier === '');
check('reel timing', idle.spinMs === 5900 && idle.unlockMs === 1300 && idle.winnerAt === 37 && idle.reelLen === 48 && idle.passes >= 36 && idle.passes <= 38, JSON.stringify(idle));
check('no horizontal overflow', idle.overflow === false);
await page.screenshot({ path: `${shots}/case-idle.png` });

await page.click('#btn-ledger');
await page.waitForSelector('#ledger-dlg[open]');
const ledger = await page.evaluate(() => ({
  key: document.getElementById('key-price').value,
  casePrice: document.getElementById('case-price').value,
  text: document.getElementById('ledger-dlg').innerText,
}));
check('ledger defaults', ledger.key === '17.00' && ledger.casePrice === '5.50', JSON.stringify(ledger));
check('ledger sources', ledger.text.includes('2026-10-24 21:53') && ledger.text.includes('skinsniper.com/zh/cs2-store') && ledger.text.includes('buff.163.com/goods/886606') && ledger.text.includes('Steam 市场约 ¥8.47') && ledger.text.includes('BUFF 参考价，2026-10-24') && ledger.text.includes('385 × ¥22.50 = ¥8662.50'), ledger.text.slice(0, 700));
await page.fill('#case-price', '');
await page.locator('#case-price').evaluate((el) => el.blur());
const restored = await page.locator('#case-price').inputValue();
check('empty price restores the previous value', restored === '5.50', restored);
await page.fill('#case-price', '0');
await page.locator('#case-price').evaluate((el) => el.blur());
const zeroed = await page.locator('#case-price').inputValue();
check('explicit zero is kept', zeroed === '0.00', zeroed);
await page.fill('#case-price', '5.5');
await page.locator('#case-price').evaluate((el) => el.blur());
await page.click('#ledger-close');

await page.click('#btn-inspect');
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

await page.click('#open');
await page.waitForTimeout(3800);
const mid = await page.evaluate(() => ({
  revealHidden: document.getElementById('reveal').hidden,
  transform: document.getElementById('reel').style.transform,
  cards: document.querySelectorAll('.card').length,
}));
check('reel is spinning', mid.revealHidden && mid.cards === 48 && mid.transform.includes('translate3d'), JSON.stringify(mid));
await page.screenshot({ path: `${shots}/case-mid-spin.png` });

await page.waitForFunction(() => {
  const reveal = document.getElementById('reveal');
  return reveal && !reveal.hidden && parseFloat(getComputedStyle(reveal).opacity) > 0.95;
}, null, { timeout: 15000 });
const reveal = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card')];
  const fillers = cards.filter((card) => !card.classList.contains('winner'));
  return {
    zh: document.getElementById('reveal-zh').textContent,
    en: document.getElementById('reveal-en').textContent,
    wear: document.getElementById('reveal-wear').textContent,
    floatText: document.getElementById('reveal-float').textContent,
    shown: document.getElementById('again').hidden === false,
    stTags: document.querySelectorAll('.st-tag').length,
    fillerGold: fillers.filter((card) => card.dataset.tier === 'rare_special').length,
    tierFont: parseFloat(getComputedStyle(document.getElementById('reveal-tier')).fontSize),
    winnerAt: cards.findIndex((card) => card.classList.contains('winner')),
    dimmed: document.getElementById('stage').classList.contains('is-dim'),
  };
});
check('reveal shows a drop', Boolean(reveal.zh) && Boolean(reveal.en) && reveal.wear.includes('·') && /^\d\.\d{8}$/.test(reveal.floatText) && reveal.shown && reveal.winnerAt === 37 && reveal.dimmed, JSON.stringify(reveal));
check('reel has no stattrak tag and no filler gold', reveal.stTags === 0 && reveal.fillerGold === 0, JSON.stringify(reveal));
check('rarity label is at least 15px', reveal.tierFont >= 15, String(reveal.tierFont));
await page.screenshot({ path: `${shots}/case-reveal.png` });
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
const gated = await goldPage.evaluate(() => ({ debug: window.__case.debug, forceTier: window.__case.forceTier }));
check('bare force=gold is ignored', gated.debug === false && gated.forceTier === '', JSON.stringify(gated));
await goldPage.goto(`${base}?debug=1&force=gold`, { waitUntil: 'domcontentloaded' });
await goldPage.waitForFunction(() => window.__case && window.__case.ready && window.__case.forceTier === 'gold', null, { timeout: 15000 });
await goldPage.click('#open');
await goldPage.waitForFunction(() => {
  const reveal = document.getElementById('reveal');
  return reveal && !reveal.hidden && parseFloat(getComputedStyle(reveal).opacity) > 0.95;
}, null, { timeout: 15000 });
const gold = await goldPage.evaluate(() => {
  const winner = document.querySelector('.card.winner');
  const bar = winner?.querySelector('.bar');
  const revealEl = document.getElementById('reveal');
  const tierEl = document.getElementById('reveal-tier');
  const swatch = document.querySelector('#history .swatch');
  const style = (el) => (el ? getComputedStyle(el).backgroundColor : '');
  const fillers = [...document.querySelectorAll('.card')].filter((card) => !card.classList.contains('winner'));
  return {
    tier: revealEl.dataset.tier,
    revealColor: revealEl.dataset.color,
    nameColor: document.getElementById('reveal-zh').style.color,
    tierBg: style(tierEl),
    tierColor: getComputedStyle(tierEl).color,
    tierFont: parseFloat(getComputedStyle(tierEl).fontSize),
    bar: style(bar),
    card: winner?.dataset.color || '',
    winnerSrc: winner?.querySelector('img')?.getAttribute('src') || '',
    winnerText: winner?.textContent || '',
    revealSrc: document.getElementById('reveal-img').getAttribute('src') || '',
    swatch: style(swatch),
    swatchData: swatch?.dataset.color || '',
    zh: document.getElementById('reveal-zh').textContent,
    floatText: document.getElementById('reveal-float').textContent,
    goldClass: document.getElementById('stage').classList.contains('is-gold'),
    rays: getComputedStyle(document.querySelector('.rays')).display,
    stTags: document.querySelectorAll('.st-tag').length,
    fillerGold: fillers.filter((card) => card.dataset.tier === 'rare_special').length,
    fillerIcon: fillers.filter((card) => (card.querySelector('img')?.getAttribute('src') || '').includes('rare_special_item')).length,
    winnerAt: [...document.querySelectorAll('.card')].findIndex((card) => card.classList.contains('winner')),
  };
});
const knifeName = /刀|匕/.test(gold.zh);
check('forced gold reveal', gold.tier === 'rare_special' && gold.goldClass && gold.zh.includes('★') && knifeName, JSON.stringify(gold));
check('gold is not covert red', isGold(gold.revealColor) && isGold(gold.card) && isGold(gold.bar) && isGold(gold.swatch) && isGold(gold.swatchData), JSON.stringify(gold));
check('gold name and glow', isGold(gold.nameColor) && gold.rays !== 'none' && /^\d\.\d{8}$/.test(gold.floatText));
check('gold chip is readable', isGold(gold.tierBg) && gold.tierFont >= 15 && !isGold(gold.tierColor), JSON.stringify(gold));
check('winning gold card is the mystery icon', gold.winnerAt === 37 && gold.winnerSrc.includes('rare_special_item.png') && gold.winnerText.includes('★ 稀有特殊物品') && !/刀|匕首/.test(gold.winnerText) && !gold.revealSrc.includes('rare_special_item') && gold.stTags === 0 && gold.fillerGold === 0 && gold.fillerIcon === 0, JSON.stringify(gold));
await goldPage.screenshot({ path: `${shots}/case-gold.png` });
check('gold console', goldLogs.length === 0, goldLogs.join(' | '));
await goldContext.close();

const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const deskPage = await desk.newPage();
const deskLogs = watch(deskPage);
await deskPage.goto(base, { waitUntil: 'domcontentloaded' });
await deskPage.waitForFunction(() => window.__case && window.__case.ready, null, { timeout: 15000 });
const deskState = await deskPage.evaluate(() => {
  const cells = [...document.querySelectorAll('#grid .cell')];
  const cols = getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').filter(Boolean).length;
  return {
    guns: document.querySelectorAll('[data-kind="gun"]').length,
    rare: cells[cells.length - 1]?.dataset.color || '',
    cols,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
});
check('desktop preview', deskState.guns === 17 && isGold(deskState.rare) && deskState.cols === 7 && deskState.overflow === false, JSON.stringify(deskState));
await deskPage.screenshot({ path: `${shots}/case-desktop.png` });
await deskPage.screenshot({ path: `${shots}/case-preview.png` });
await deskPage.click('#btn-fast');
await deskPage.click('#open');
await deskPage.waitForFunction(() => {
  const img = document.getElementById('reveal-img');
  const reveal = document.getElementById('reveal');
  return img && reveal && !reveal.hidden && img.complete && img.naturalWidth > 0 && parseFloat(getComputedStyle(reveal).opacity) > 0.95;
}, null, { timeout: 12000 });
const fit = await deskPage.evaluate(() => {
  const again = document.getElementById('again').getBoundingClientRect();
  const back = document.getElementById('back').getBoundingClientRect();
  const img = document.getElementById('reveal-img').getBoundingClientRect();
  return {
    againBottom: again.bottom,
    backBottom: back.bottom,
    vh: window.innerHeight,
    imgH: img.height,
  };
});
check('desktop reveal fits one screen', fit.backBottom <= fit.vh + 1 && fit.againBottom <= fit.vh + 1 && fit.imgH > 20 && fit.imgH <= 160, JSON.stringify(fit));
await deskPage.screenshot({ path: `${shots}/case-desktop-reveal.png` });
check('desktop console', deskLogs.length === 0, deskLogs.join(' | '));
await desk.close();

const funContext = await browser.newContext({
  viewport: phone,
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const funPage = await funContext.newPage();
const funLogs = watch(funPage);
funPage.on('dialog', (dialog) => {
  check('reset asks before clearing', dialog.message() === '重置当前账本？');
  dialog.accept();
});
await funPage.goto(base, { waitUntil: 'domcontentloaded' });
await funPage.waitForFunction(() => window.__case && window.__case.ready, null, { timeout: 15000 });
const funSetup = await funPage.evaluate(() => {
  const real = document.getElementById('mode-real');
  const funBtn = document.getElementById('mode-fun');
  const slider = document.getElementById('gold-rate');
  return {
    opens: document.querySelectorAll('#open').length,
    openText: document.getElementById('open').textContent,
    realPressed: real.getAttribute('aria-pressed'),
    funPressed: funBtn.getAttribute('aria-pressed'),
    controlsHidden: document.getElementById('fun-controls').hidden,
    badgeHidden: document.getElementById('fun-badge-open').hidden,
    stageHidden: document.getElementById('fun-badge-stage').hidden,
    realH: real.getBoundingClientRect().height,
    funH: funBtn.getBoundingClientRect().height,
    sliderH: slider.getBoundingClientRect().height,
    label: document.querySelector('.odds-label')?.textContent || '',
    gear: document.querySelectorAll('[aria-label="设置"], .settings, #settings').length,
  };
});
check('odds row is on the preview and real mode is the default', funSetup.opens === 1 && funSetup.openText === '开启武器箱' && funSetup.realPressed === 'true' && funSetup.funPressed === 'false' && funSetup.controlsHidden && funSetup.badgeHidden && funSetup.stageHidden && funSetup.label === '概率设置' && funSetup.gear === 0, JSON.stringify(funSetup));
check('mode buttons are 44px', funSetup.realH >= 44 && funSetup.funH >= 44, JSON.stringify(funSetup));
await funPage.click('#btn-fast');
await funPage.click('#open');
await funPage.waitForFunction(() => {
  const reveal = document.getElementById('reveal');
  return reveal && !reveal.hidden && document.getElementById('reveal-price').textContent.includes('¥');
}, null, { timeout: 12000 });
await funPage.click('#back');
await funPage.click('#mode-fun');
const switched = await funPage.evaluate(() => ({
  fun: window.__case.fun,
  opens: document.getElementById('stat-opens').textContent,
  controls: document.getElementById('fun-controls').hidden,
  badge: document.getElementById('fun-badge-open').hidden,
  sliderH: document.getElementById('gold-rate').getBoundingClientRect().height,
}));
check('fun ledger starts separate from real', switched.fun === true && switched.opens === '0' && switched.controls === false && switched.badge === false && switched.sliderH >= 44, JSON.stringify(switched));
await funPage.evaluate(() => {
  const slider = document.getElementById('gold-rate');
  slider.value = '12.5';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
});
const live = await funPage.evaluate(() => ({
  rate: window.__case.goldRate,
  label: document.getElementById('gold-rate-label').textContent,
  percents: document.getElementById('fun-percents').textContent,
  note: document.getElementById('odds-note').textContent,
}));
check('gold slider republishes the other tiers', live.rate === 12.5 && live.label === '12.5%' && live.percents === '隐秘 9.21% · 保密 18.42% · 受限 27.63% · 军规级 32.24%' && live.note.includes('非真实概率') && live.note.includes('12.50%') && live.note.includes('磨损在范围内均匀分布，简化处理'), JSON.stringify(live));
await funPage.screenshot({ path: `${shots}/case-fun-phone.png` });
await funPage.setViewportSize({ width: 1280, height: 800 });
await funPage.screenshot({ path: `${shots}/case-fun-desktop.png` });
await funPage.setViewportSize(phone);
await funPage.click('#open');
await funPage.waitForFunction(() => {
  const reveal = document.getElementById('reveal');
  const badge = document.getElementById('fun-badge-stage');
  return reveal && !reveal.hidden && badge && badge.hidden === false && document.getElementById('reveal-price').textContent.includes('¥');
}, null, { timeout: 12000 });
await funPage.click('#back');
await funPage.click('#btn-ledger');
await funPage.waitForSelector('#ledger-dlg[open]');
const funLedger = await funPage.evaluate(() => ({
  text: document.getElementById('ledger-dlg').innerText,
  resetH: document.getElementById('reset-ledger').getBoundingClientRect().height,
  opens: document.getElementById('stat-opens').textContent,
  rate: document.getElementById('stat-return').textContent,
}));
check('fun ledger shows this mode only', funLedger.opens === '1' && funLedger.rate !== '—' && funLedger.text.includes('非真实概率') && funLedger.text.includes('当前：娱乐模式') && funLedger.text.includes('参考价：BUFF 在售最低价（csgotrader 数据，2026-10-24）') && funLedger.resetH >= 44, JSON.stringify({ opens: funLedger.opens, rate: funLedger.rate, resetH: funLedger.resetH }));
await funPage.screenshot({ path: `${shots}/case-fun-ledger.png` });
await funPage.click('#reset-ledger');
const afterReset = await funPage.evaluate(() => ({
  opens: document.getElementById('stat-opens').textContent,
  recovered: document.getElementById('stat-recovered').textContent,
  rate: document.getElementById('stat-return').textContent,
  gold: document.getElementById('gold-rate').value,
  key: document.getElementById('key-price').value,
}));
check('reset clears only the fun ledger', afterReset.opens === '0' && afterReset.recovered === '¥0.00' && afterReset.rate === '—' && afterReset.gold === '12.5' && afterReset.key === '17.00', JSON.stringify(afterReset));
await funPage.click('#ledger-close');
await funPage.click('#mode-real');
const realKept = await funPage.evaluate(() => document.getElementById('stat-opens').textContent);
check('real ledger survives the fun reset', realKept === '1', realKept);
await funPage.reload({ waitUntil: 'domcontentloaded' });
await funPage.waitForFunction(() => window.__case && window.__case.ready, null, { timeout: 15000 });
const persisted = await funPage.evaluate(() => ({
  fun: window.__case.fun,
  rate: window.__case.goldRate,
  realOpens: JSON.parse(localStorage.getItem('dn-case-v1')).real.opens,
  funOpens: JSON.parse(localStorage.getItem('dn-case-v1')).funLedger.opens,
}));
check('mode and slider persist, ledgers stay apart', persisted.fun === false && persisted.rate === 12.5 && persisted.realOpens === 1 && persisted.funOpens === 0, JSON.stringify(persisted));
check('fun console', funLogs.length === 0, funLogs.join(' | '));
await funContext.close();

await browser.close();
if (failures.length) {
  console.error(`FAILED\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('case browser checks passed');
