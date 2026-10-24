import { createAudio } from './audio.js';
import {
  GOLD,
  TIERS,
  PHASES,
  buildReel,
  displayName,
  eachPercent,
  prepare,
  randomUnit,
  rollDrop,
  tierPercent,
  uiColor,
} from './roll.js';

const SPIN_MS = 5600;
const UNLOCK_MS = 380;
const REEL_LEN = 64;
const WINNER_AT = 54;
const START_AT = 2;
const STORE_KEY = 'dn-case-v1';

const audio = createAudio();
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const forceTier = params.get('force') || '';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let cat = null;
let manifest = null;
let busy = false;
let skipFlag = false;
let fast = params.get('fast') === '1' || reduceMotion;
let lastDrop = null;
let state = loadState();

function loadState() {
  const blank = {
    opens: 0,
    spent: 0,
    firstGoldAt: null,
    history: [],
    key: 17.5,
    casePrice: 0,
    sound: true,
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return blank;
    const saved = JSON.parse(raw);
    return { ...blank, ...saved, history: Array.isArray(saved.history) ? saved.history : [] };
  } catch {
    return blank;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

function yuan(value) {
  const n = Number.isFinite(value) ? value : 0;
  return `¥${n.toFixed(2)}`;
}

function readPrice(id, fallback) {
  const n = Number($(id).value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

function currentCost() {
  return readPrice('key-price', state.key) + readPrice('case-price', state.casePrice);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function fmtPct(value) {
  if (value < 0.1) return `${value.toFixed(6)}%`;
  if (value < 10) return `${value.toFixed(4)}%`;
  return `${value.toFixed(2)}%`;
}

function paintPrices() {
  $('key-price').value = String(state.key);
  $('case-price').value = String(state.casePrice);
  $('next-cost').textContent = `下一次开启计入 ${yuan(state.key + state.casePrice)}（钥匙 + 箱子）。`;
}

function paintLedger() {
  $('stat-opens').textContent = String(state.opens);
  $('stat-spent').textContent = yuan(state.spent);
  $('stat-gold').textContent = state.firstGoldAt == null ? '尚未开出' : `第 ${state.firstGoldAt} 次`;
  const list = $('history');
  list.replaceChildren();
  if (!state.history.length) {
    const empty = document.createElement('li');
    empty.className = 'fine';
    empty.textContent = '还没有开箱';
    list.append(empty);
    return;
  }
  state.history.slice(0, 40).forEach((row, index) => {
    const li = document.createElement('li');
    li.className = index === 0 ? 'hrow latest' : 'hrow';
    const swatch = document.createElement('i');
    swatch.className = 'swatch';
    swatch.dataset.color = row.color;
    swatch.dataset.tier = row.tier;
    swatch.style.background = row.color;
    const text = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = row.zh;
    const meta = document.createElement('small');
    meta.textContent = `${row.wear} · ${row.floatText}`;
    text.append(name, meta);
    li.append(swatch, text);
    list.append(li);
  });
}

function record(drop) {
  const names = displayName(drop);
  const cost = currentCost();
  state.key = readPrice('key-price', state.key);
  state.casePrice = readPrice('case-price', state.casePrice);
  state.opens += 1;
  state.spent += cost;
  if (drop.tier === 'rare_special' && state.firstGoldAt == null) state.firstGoldAt = state.opens;
  state.history.unshift({
    color: drop.color,
    tier: drop.tier,
    zh: names.zh,
    wear: drop.wear.zh,
    floatText: drop.floatValue.toFixed(4),
  });
  if (state.history.length > 200) state.history.length = 200;
  saveState();
  paintLedger();
}

function tileBackground(color) {
  return `radial-gradient(90% 85% at 50% 100%, ${color} 0%, #14161c 60%)`;
}

function renderPreview() {
  const img = $('case-img');
  img.src = manifest.case.image;
  img.alt = manifest.case.name_zh;
  img.addEventListener('error', () => { img.hidden = true; }, { once: true });

  const grid = $('grid');
  grid.append(makeTile({
    kind: 'rare',
    color: GOLD,
    image: manifest.rare_special_item_icon.image,
    zh: manifest.rare_special_item_icon.name_zh,
    en: 'Rare Special Item',
  }));

  const order = ['covert', 'classified', 'restricted', 'milspec'];
  const guns = manifest.items.filter((item) => item.tier !== 'rare_special');
  guns.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
  for (const item of guns) {
    grid.append(makeTile({
      kind: 'gun',
      color: uiColor(item),
      image: item.image,
      zh: item.name_zh,
      en: item.name_en,
    }));
  }

  $('odds-note').textContent = '品级概率为 Valve 公布（二手来源）：稀有特殊 0.26%、隐秘 0.64%、保密 3.20%、受限 15.98%、军规级 79.92%。StatTrak™ 10% 为常见说法，未核实。伽玛多普勒相位（相位 1–4 各 23.75%，绿宝石 5%）为社区估算，非官方。';
}

function makeTile({ kind, color, image, zh, en }) {
  const tile = document.createElement('article');
  tile.className = kind === 'rare' ? 'tile rare' : 'tile';
  tile.dataset.kind = kind;
  tile.dataset.color = color;
  tile.style.setProperty('--rarity', color);
  tile.style.background = tileBackground(color);
  const img = document.createElement('img');
  img.alt = zh;
  img.draggable = false;
  img.src = image;
  const name = document.createElement('span');
  name.className = 'tname';
  name.textContent = zh;
  const sub = document.createElement('span');
  sub.className = 'ten';
  sub.textContent = en;
  const bar = document.createElement('i');
  bar.className = 'bar';
  bar.style.background = color;
  img.addEventListener('error', () => {
    tile.classList.add('no-img');
    img.remove();
  }, { once: true });
  tile.append(img, name, sub, bar);
  return tile;
}

function renderContents() {
  const root = $('contents-body');
  const intro = document.createElement('p');
  intro.className = 'fine note';
  intro.textContent = '17 把枪加 30 把刀（5 种刀 × 6 款涂装）。预览里刀收在「★ 稀有特殊物品」后面，这里按开出时的条目列全，方便核对没有遗漏、也没有多出来的涂装。';
  const st = document.createElement('p');
  st.className = 'fine note';
  st.textContent = '任意掉落（含刀）另有 10% 概率为 StatTrak™。常见说法，未核实。';
  root.append(intro, st);

  const groups = [
    ['rare_special', manifest.items.filter((item) => item.tier === 'rare_special')],
    ['covert', manifest.items.filter((item) => item.tier === 'covert')],
    ['classified', manifest.items.filter((item) => item.tier === 'classified')],
    ['restricted', manifest.items.filter((item) => item.tier === 'restricted')],
    ['milspec', manifest.items.filter((item) => item.tier === 'milspec')],
  ];

  for (const [tierId, items] of groups) {
    const tier = TIERS.find((entry) => entry.id === tierId);
    const head = document.createElement('div');
    head.className = 'group-h';
    const title = document.createElement('h3');
    title.textContent = tierId === 'rare_special' ? '★ 稀有特殊物品' : tier.zh;
    title.style.color = tierId === 'rare_special' ? GOLD : uiColor(items[0]);
    const meta = document.createElement('span');
    meta.textContent = `${fmtPct(tierPercent(tierId))} · ${items.length} 件 · 每件 ${fmtPct(eachPercent(tierId, items.length))}`;
    head.append(title, meta);
    root.append(head);

    const note = document.createElement('p');
    note.className = 'fine note';
    if (tierId === 'rare_special') {
      note.textContent = '品级概率为 Valve 公布（二手来源）。刀和涂装在金色里均匀抽取。伽玛多普勒开出后再掷相位：相位 1–4 各 23.75%，绿宝石 5%，社区估算，非官方。不含幻彩 2 号的多普勒、大理石渐变、虎牙等。开箱界面里刀显示为金色，而不是物品自身的隐秘红。';
    } else {
      note.textContent = '品级概率为 Valve 公布（二手来源）。同品级内均匀抽取。';
    }
    root.append(note);

    for (const item of items) {
      const color = uiColor(item);
      const row = document.createElement('div');
      row.className = 'entry';
      row.dataset.kind = 'entry';
      row.dataset.tier = item.tier;
      row.dataset.color = color;
      row.dataset.name = item.name_en;
      row.style.setProperty('--rarity', color);
      const dot = document.createElement('i');
      dot.className = 'dot';
      const text = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = item.name_zh;
      const sub = document.createElement('small');
      sub.textContent = `${item.name_en} · 磨损 ${item.float_min.toFixed(2)}–${item.float_max.toFixed(2)}`;
      text.append(name, sub);
      const odds = document.createElement('span');
      odds.className = 'odds';
      odds.textContent = fmtPct(eachPercent(tierId, items.length));
      row.append(dot, text, odds);
      root.append(row);
    }
  }

  const phase = document.createElement('p');
  phase.className = 'fine note';
  phase.textContent = `相位权重（社区估算，非官方）：${PHASES.map((entry) => `${entry.zh} ${(entry.weight / 100).toFixed(2)}%`).join('，')}。`;
  root.append(phase);
}

function makeCard(drop) {
  const card = document.createElement('div');
  card.className = drop.stattrak ? 'card is-st' : 'card';
  card.style.setProperty('--rarity', drop.color);
  card.dataset.color = drop.color;
  card.dataset.tier = drop.tier;
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.src = drop.image;
  const name = document.createElement('span');
  name.className = 'fname';
  name.textContent = drop.item.name_zh;
  const bar = document.createElement('i');
  bar.className = 'bar';
  bar.style.background = drop.color;
  img.addEventListener('error', () => {
    card.classList.add('no-img');
    img.remove();
  }, { once: true });
  card.append(img, name, bar);
  if (drop.stattrak) {
    const tag = document.createElement('em');
    tag.className = 'st-tag';
    tag.textContent = 'ST';
    card.append(tag);
  }
  return card;
}

function ease(t) {
  const k = 3.15;
  return (1 - Math.exp(-k * t)) / (1 - Math.exp(-k));
}

function clearGoldFx() {
  $('stage').classList.remove('is-gold');
  document.querySelectorAll('.sparks').forEach((node) => node.remove());
}

function spawnSparks() {
  const layer = document.createElement('div');
  layer.className = 'sparks';
  for (let i = 0; i < 16; i += 1) {
    const spark = document.createElement('i');
    spark.style.left = `${18 + Math.random() * 64}%`;
    spark.style.setProperty('--dx', `${-70 + Math.random() * 140}px`);
    spark.style.setProperty('--dy', `${-30 - Math.random() * 130}px`);
    spark.style.animationDelay = `${Math.random() * 0.15}s`;
    layer.append(spark);
  }
  $('stage').append(layer);
}

function showReveal(drop) {
  const names = displayName(drop);
  const reveal = $('reveal');
  reveal.hidden = false;
  reveal.style.setProperty('--rarity', drop.color);
  reveal.dataset.color = drop.color;
  reveal.dataset.tier = drop.tier;
  const gold = drop.tier === 'rare_special';
  $('stage').classList.toggle('is-gold', gold);
  if (gold) spawnSparks();
  const img = $('reveal-img');
  const fallback = $('reveal-fallback');
  img.hidden = false;
  fallback.hidden = true;
  img.alt = names.zh;
  img.src = drop.image;
  img.onerror = () => {
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = names.zh;
  };
  $('reveal-st').hidden = !drop.stattrak;
  $('reveal-tier').textContent = gold ? '★ 稀有特殊物品' : drop.tierZh;
  $('reveal-tier').style.color = drop.color;
  const zh = names.zh.replace(/^StatTrak™ /, '');
  const en = names.en.replace(/^StatTrak™ /, '');
  $('reveal-zh').textContent = zh;
  $('reveal-zh').style.color = gold ? GOLD : '#f4f1ea';
  $('reveal-en').textContent = en;
  $('reveal-wear').textContent = `${drop.wear.zh} · ${drop.wear.en}`;
  $('reveal-float').textContent = drop.floatValue.toFixed(8);
  $('float-pin').style.left = `${Math.min(100, Math.max(0, drop.floatValue * 100))}%`;
  $('reveal-range').textContent = `磨损区间 ${drop.item.float_min.toFixed(2)} – ${drop.item.float_max.toFixed(2)}`;
  $('again').hidden = false;
  $('back').hidden = false;
  $('live').textContent = names.zh;
  if (!audio.muted) audio.reveal(drop.tier);
}

function focusWinner() {
  const cards = [...$('reel').children];
  cards.forEach((card, index) => {
    card.classList.toggle('winner', index === WINNER_AT);
    card.classList.toggle('dim', index !== WINNER_AT);
  });
}

function spinReel() {
  const reel = $('reel');
  const card = reel.querySelector('.card');
  const gap = parseFloat(getComputedStyle(card).marginRight) || 0;
  const cardW = card.offsetWidth;
  const stride = cardW + gap;
  const viewW = reel.parentElement.clientWidth;
  const jitter = cardW * (0.12 + randomUnit() * 0.76);
  const start = START_AT * stride + cardW * 0.5 - viewW / 2;
  const end = WINNER_AT * stride + jitter - viewW / 2;
  const distance = end - start;
  let lastIndex = START_AT;
  let prevTime = 0;
  let prevPos = start;
  reel.style.transform = `translate3d(${-start}px,0,0)`;

  return new Promise((resolve) => {
    const started = performance.now();
    const frame = (now) => {
      if (skipFlag) {
        reel.style.transform = `translate3d(${-end}px,0,0)`;
        reel.style.filter = 'none';
        resolve();
        return;
      }
      const t = Math.min(1, (now - started) / SPIN_MS);
      const pos = start + distance * ease(t);
      reel.style.transform = `translate3d(${-pos}px,0,0)`;
      const index = Math.floor((pos + viewW / 2) / stride);
      if (prevTime) {
        const dt = (now - prevTime) / 1000;
        const cardsPerSec = dt > 0 ? Math.abs(pos - prevPos) / dt / stride : 0;
        if (index !== lastIndex) {
          const crossed = Math.max(1, index - lastIndex);
          const speed = Math.max(0, Math.min(1, cardsPerSec / 30));
          if (!audio.muted) {
            for (let i = 0; i < Math.min(crossed, 3); i += 1) audio.tick(speed, i * 0.01);
          }
          lastIndex = index;
        }
        const blur = cardsPerSec > 14 ? Math.min(1.5, (cardsPerSec - 14) / 18) : 0;
        reel.style.filter = blur ? `blur(${blur.toFixed(2)}px)` : 'none';
      }
      prevTime = now;
      prevPos = pos;
      if (t < 1) requestAnimationFrame(frame);
      else {
        reel.style.transform = `translate3d(${-end}px,0,0)`;
        reel.style.filter = 'none';
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

function showStage() {
  $('preview').hidden = true;
  $('stage').hidden = false;
  $('reveal').hidden = true;
  $('again').hidden = true;
  $('back').hidden = true;
  clearGoldFx();
}

function showPreview() {
  $('stage').hidden = true;
  $('preview').hidden = false;
  $('reveal').hidden = true;
  clearGoldFx();
}

async function openCase() {
  if (busy || !cat) return;
  busy = true;
  skipFlag = false;
  $('open').disabled = true;
  $('open').textContent = '开启中…';
  audio.arm();
  try {
    const drop = rollDrop(cat, forceTier ? { forceTier } : {});
    lastDrop = drop;
    showStage();
    const reel = $('reel');
    reel.replaceChildren();
    reel.style.filter = 'none';
    const built = buildReel(cat, drop, REEL_LEN, WINNER_AT);
    for (const entry of built) reel.append(makeCard(entry));
    $('live').textContent = '正在开启';

    if (fast) {
      const card = reel.querySelector('.card');
      const gap = parseFloat(getComputedStyle(card).marginRight) || 0;
      const stride = card.offsetWidth + gap;
      const viewW = reel.parentElement.clientWidth;
      const jitter = card.offsetWidth * (0.12 + randomUnit() * 0.76);
      const end = WINNER_AT * stride + jitter - viewW / 2;
      reel.style.transform = `translate3d(${-end}px,0,0)`;
    } else {
      if (!audio.muted) audio.unlock();
      await new Promise((resolve) => { setTimeout(resolve, UNLOCK_MS); });
      await spinReel();
    }

    focusWinner();
    if (!fast) await new Promise((resolve) => { setTimeout(resolve, 280); });
    record(drop);
    showReveal(drop);
  } finally {
    $('open').disabled = false;
    $('open').textContent = '开启武器箱';
    busy = false;
  }
}

function setFast(on) {
  fast = on;
  $('btn-fast').setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on && busy) skipFlag = true;
}

function setSound(on) {
  state.sound = on;
  audio.setMuted(!on);
  $('btn-sound').setAttribute('aria-pressed', on ? 'true' : 'false');
  $('btn-sound').textContent = on ? '声音' : '静音';
  saveState();
}

function bind() {
  $('open').addEventListener('click', () => { openCase(); });
  $('again').addEventListener('click', () => { openCase(); });
  $('back').addEventListener('click', showPreview);
  $('btn-fast').addEventListener('click', () => setFast(!fast));
  $('btn-sound').addEventListener('click', () => {
    const on = $('btn-sound').getAttribute('aria-pressed') !== 'true';
    if (on) audio.arm();
    setSound(on);
  });
  $('btn-contents').addEventListener('click', () => $('contents-dlg').showModal());
  $('contents-close').addEventListener('click', () => $('contents-dlg').close());
  $('btn-ledger').addEventListener('click', () => {
    paintLedger();
    $('ledger-dlg').showModal();
  });
  $('ledger-close').addEventListener('click', () => $('ledger-dlg').close());
  for (const dialog of [$('contents-dlg'), $('ledger-dlg')]) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
  for (const id of ['key-price', 'case-price']) {
    $(id).addEventListener('input', () => {
      state.key = readPrice('key-price', state.key);
      state.casePrice = readPrice('case-price', state.casePrice);
      $('next-cost').textContent = `下一次开启计入 ${yuan(state.key + state.casePrice)}（钥匙 + 箱子）。`;
      saveState();
    });
  }
  $('clear-ledger').addEventListener('click', () => {
    if (!window.confirm('清空开箱记录？')) return;
    state.opens = 0;
    state.spent = 0;
    state.firstGoldAt = null;
    state.history = [];
    saveState();
    paintLedger();
  });
}

async function main() {
  const response = await fetch(new URL('./manifest.json', import.meta.url));
  if (!response.ok) throw new Error('manifest');
  manifest = await response.json();
  cat = prepare(manifest);
  if (state.sound === false) setSound(false);
  else setSound(true);
  setFast(fast);
  paintPrices();
  paintLedger();
  renderPreview();
  renderContents();
  bind();
  window.__case = {
    ready: true,
    uiColor,
    GOLD,
    get lastDrop() { return lastDrop; },
  };
}

main().catch(() => {
  const note = document.createElement('p');
  note.className = 'fine pad';
  note.textContent = '箱子数据没有载入。';
  document.body.append(note);
});
