import { createAudio } from './audio.js';
import {
  DIM_MS,
  REEL_LEN,
  SPIN_MS,
  START_AT,
  UNLOCK_MS,
  WINNER_AT,
  ease,
} from './timing.js';
import { blankLedger, netOf, recordDrop, recoveredOf, resetCurrent, returnRate, splitLedgers } from './ledger.js';
import { lookupPrice } from './prices.js';
import {
  GOLD,
  TIERS,
  PHASES,
  buildReel,
  displayName,
  displayPercents,
  eachPercent,
  funBreakdown,
  prepare,
  randomUnit,
  parsePrice,
  rollDrop,
  snapGoldRate,
  tierPercent,
  uiColor,
} from './roll.js';

const EXPECT_OPENS = 385;
const NOMAD_YUAN = 741;
const STORE_KEY = 'dn-case-v1';

const audio = createAudio();
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';
const forceTier = debug ? (params.get('force') || '') : '';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let cat = null;
let manifest = null;
let priceDoc = null;
let busy = false;
let skipFlag = false;
let fast = params.get('fast') === '1' || reduceMotion;
let lastDrop = null;
let state = loadState();

function loadState() {
  const blank = {
    key: 17,
    casePrice: 5.5,
    sound: true,
    prices: {},
    fun: false,
    goldRate: 5,
    real: blankLedger(),
    funLedger: blankLedger(),
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return blank;
    const saved = JSON.parse(raw);
    const ledgers = splitLedgers(saved);
    const prices = saved.prices && typeof saved.prices === 'object' && !Array.isArray(saved.prices) ? saved.prices : {};
    let key = Number(saved.key);
    let casePrice = Number(saved.casePrice);
    if (!Number.isFinite(key) || key < 0) key = blank.key;
    if (!Number.isFinite(casePrice) || casePrice < 0) casePrice = blank.casePrice;
    return {
      key,
      casePrice,
      sound: saved.sound !== false,
      prices,
      ...ledgers,
    };
  } catch {
    return blank;
  }
}

function ledger() {
  return state.fun ? state.funLedger : state.real;
}

function setLedger(next) {
  if (state.fun) state.funLedger = next;
  else state.real = next;
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

function formatPrice(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function recoveredValue() {
  return recoveredOf(ledger());
}

function quoteFor(drop) {
  if (!priceDoc || !drop) return null;
  return lookupPrice(priceDoc, drop.item.id, drop.wear.id, drop.stattrak, drop.phase);
}

function formatSigned(value) {
  const abs = Math.abs(value);
  const body = yuan(abs);
  if (value > 0) return `+${body}`;
  if (value < 0) return `-${body}`;
  return body;
}

function paintMoney(el, value, { unknown = '价格未知' } = {}) {
  el.classList.remove('pl-pos', 'pl-neg');
  if (value == null || !Number.isFinite(value)) {
    el.textContent = unknown;
    return;
  }
  el.textContent = formatSigned(value);
  if (value > 0) el.classList.add('pl-pos');
  else if (value < 0) el.classList.add('pl-neg');
}

function rollOpts(extra = {}) {
  const opts = { ...extra };
  if (state.fun) {
    opts.fun = true;
    opts.goldPercent = state.goldRate;
  }
  if (forceTier) opts.forceTier = forceTier;
  return opts;
}

function activeTable() {
  return state.fun ? funBreakdown(state.goldRate) : null;
}

function formatNum(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
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

function paintCostNotes() {
  const cost = state.key + state.casePrice;
  $('next-cost').textContent = `下一次开启计入 ${yuan(cost)}（钥匙 + 箱子）。`;
  if (state.fun) {
    const opens = 100 / state.goldRate;
    $('expect-cost').textContent = `娱乐模式，非真实概率。金色 ${formatNum(state.goldRate)}% ≈ ${formatNum(opens)} 次开到一把刀。期望花费 ${formatNum(opens)} × ${yuan(cost)} = ${yuan(opens * cost)}。`;
    return;
  }
  $('expect-cost').textContent = `金色 0.26% ≈ ${EXPECT_OPENS} 次开到一把刀。期望花费 ${EXPECT_OPENS} × ${yuan(cost)} = ${yuan(EXPECT_OPENS * cost)}。对照流浪者匕首 ${yuan(NOMAD_YUAN)}，BUFF 参考价，2026-10-24。`;
}

function paintPrices() {
  $('key-price').value = formatPrice(state.key);
  $('case-price').value = formatPrice(state.casePrice);
  paintCostNotes();
}

function paintReturn(spent, recovered) {
  const rate = returnRate(recovered, spent);
  $('stat-return').textContent = rate == null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

function paintPriceSource() {
  const source = priceDoc && priceDoc.source ? priceDoc.source : '未注明';
  const date = priceDoc && priceDoc.date ? priceDoc.date : '未注明';
  $('price-source').textContent = `参考价来源：${source}。日期：${date}。空价表示未查到，界面显示「价格未知」。`;
}

function paintLedger() {
  const book = ledger();
  const recovered = recoveredValue();
  $('stat-opens').textContent = String(book.opens);
  $('stat-spent').textContent = yuan(book.spent);
  $('stat-recovered').textContent = yuan(recovered);
  paintMoney($('stat-net'), netOf(book), { unknown: '¥0.00' });
  paintReturn(book.spent, recovered);
  $('stat-unknown').textContent = String(book.unknownCount || 0);
  $('stat-golds').textContent = String(book.goldCount);
  $('stat-gold').textContent = book.firstGoldAt == null ? '尚未开出' : `第 ${book.firstGoldAt} 次`;
  $('ledger-mode').textContent = state.fun ? '当前：娱乐模式' : '当前：真实模式';
  $('fun-badge-ledger').hidden = !state.fun;
  const list = $('history');
  list.replaceChildren();
  if (!book.history.length) {
    const empty = document.createElement('li');
    empty.className = 'fine';
    empty.textContent = '还没有开箱';
    list.append(empty);
    return;
  }
  book.history.forEach((row, index) => {
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
    const phase = row.phase || '无相位';
    const st = row.stattrak ? 'StatTrak™' : '非 StatTrak';
    meta.textContent = `${row.wear} · ${st} · ${phase}${row.floatText ? ` · ${row.floatText}` : ''}`;
    const money = document.createElement('span');
    money.className = 'hmoney';
    const price = document.createElement('b');
    price.textContent = Number.isFinite(row.value) ? yuan(row.value) : '价格未知';
    const pl = document.createElement('small');
    if (Number.isFinite(row.profit)) {
      pl.textContent = formatSigned(row.profit);
      if (row.profit > 0) pl.classList.add('pl-pos');
      else if (row.profit < 0) pl.classList.add('pl-neg');
    } else {
      pl.textContent = '盈亏 —';
    }
    money.append(price, pl);
    text.append(name, meta);
    li.append(swatch, text, money);
    list.append(li);
  });
}

function record(drop, value) {
  const names = displayName(drop);
  const cost = state.key + state.casePrice;
  setLedger(recordDrop(ledger(), {
    itemId: drop.item.id,
    tier: drop.tier,
    color: drop.color,
    zh: names.zh,
    wear: drop.wear.zh,
    stattrak: drop.stattrak,
    phase: drop.phase ? drop.phase.zh : null,
    floatText: drop.floatValue.toFixed(4),
    cost,
    value,
  }));
  saveState();
  paintLedger();
}

function skinZh(item) {
  const parts = item.name_zh.split(' | ');
  return parts.length > 1 ? parts.slice(1).join(' | ') : '';
}

function paintOddsNote() {
  const shared = 'StatTrak™ 10% 为常见说法，未核实。伽玛多普勒相位（相位 1–4 各 23.75%，绿宝石 5%）为社区估算，非官方。磨损在范围内均匀分布，简化处理。';
  if (!state.fun) {
    $('odds-note').textContent = `品级概率为 Valve 公布（二手来源）：稀有特殊 0.26%、隐秘 0.64%、保密 3.20%、受限 15.98%、军规级 79.92%。${shared}`;
    return;
  }
  const shown = displayPercents(funBreakdown(state.goldRate));
  const bits = [
    ['稀有特殊', shown.rare_special],
    ['隐秘', shown.covert],
    ['保密', shown.classified],
    ['受限', shown.restricted],
    ['军规级', shown.milspec],
  ];
  const line = bits.map(([label, value]) => `${label} ${value.toFixed(2)}%`).join('、');
  $('odds-note').textContent = `娱乐模式，非真实概率。当前品级：${line}。${shared}`;
}

function paintMode() {
  $('mode-real').setAttribute('aria-pressed', state.fun ? 'false' : 'true');
  $('mode-fun').setAttribute('aria-pressed', state.fun ? 'true' : 'false');
  $('fun-controls').hidden = !state.fun;
  $('gold-rate').value = String(state.goldRate);
  const rateText = Number.isInteger(state.goldRate) ? String(state.goldRate) : state.goldRate.toFixed(1);
  $('gold-rate-label').textContent = `${rateText}%`;
  const shown = displayPercents(funBreakdown(state.goldRate));
  $('fun-percents').textContent = `隐秘 ${shown.covert.toFixed(2)}% · 保密 ${shown.classified.toFixed(2)}% · 受限 ${shown.restricted.toFixed(2)}% · 军规级 ${shown.milspec.toFixed(2)}%`;
  for (const id of ['fun-badge-open', 'fun-badge-stage', 'fun-badge-ledger']) $(id).hidden = !state.fun;
  paintOddsNote();
  paintCostNotes();
  if (manifest) renderContents();
}

function renderPreview() {
  const img = $('case-img');
  img.src = manifest.case.image;
  img.alt = manifest.case.name_zh;
  img.addEventListener('error', () => { img.hidden = true; }, { once: true });

  const grid = $('grid');
  const order = ['milspec', 'restricted', 'classified', 'covert'];
  const guns = manifest.items.filter((item) => item.tier !== 'rare_special');
  guns.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
  for (const item of guns) {
    grid.append(makeTile({
      kind: 'gun',
      tier: item.tier,
      color: uiColor(item),
      image: item.image,
      weapon: item.weapon_zh,
      skin: skinZh(item),
    }));
  }
  grid.append(makeTile({
    kind: 'rare',
    tier: 'rare_special',
    color: GOLD,
    image: manifest.rare_special_item_icon.image,
    weapon: '★ 稀有特殊物品',
    skin: '',
  }));

  paintOddsNote();
}

function makeTile({ kind, tier, color, image, weapon, skin }) {
  const cell = document.createElement('article');
  cell.className = kind === 'rare' ? 'cell rare' : 'cell';
  cell.dataset.kind = kind;
  cell.dataset.tier = tier;
  cell.dataset.color = color;
  const tile = document.createElement('div');
  tile.className = 'tile';
  const img = document.createElement('img');
  img.alt = skin ? `${weapon} | ${skin}` : weapon;
  img.draggable = false;
  img.src = image;
  const bar = document.createElement('i');
  bar.className = 'bar';
  bar.style.background = color;
  img.addEventListener('error', () => {
    tile.classList.add('no-img');
    img.remove();
  }, { once: true });
  tile.append(img, bar);
  const cap = document.createElement('p');
  cap.className = 'cap';
  const wep = document.createElement('b');
  wep.className = 'wep';
  wep.textContent = weapon;
  const finish = document.createElement('span');
  finish.className = 'skin';
  finish.textContent = skin;
  cap.append(wep, finish);
  cell.append(tile, cap);
  return cell;
}

function renderContents() {
  const root = $('contents-body');
  root.replaceChildren();
  const table = activeTable();
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
    meta.textContent = `${fmtPct(tierPercent(tierId, table))} · ${items.length} 件 · 每件 ${fmtPct(eachPercent(tierId, items.length, table))}`;
    head.append(title, meta);
    root.append(head);

    const note = document.createElement('p');
    note.className = 'fine note';
    if (state.fun && tierId === 'rare_special') {
      note.textContent = '娱乐模式，非真实概率。刀和涂装在金色里均匀抽取。伽玛多普勒开出后再掷相位：相位 1–4 各 23.75%，绿宝石 5%，社区估算，非官方。不含幻彩 2 号的多普勒、大理石渐变、虎牙等。开箱界面里刀显示为金色，而不是物品自身的隐秘红。';
    } else if (state.fun) {
      note.textContent = '娱乐模式，非真实概率。同品级内均匀抽取。';
    } else if (tierId === 'rare_special') {
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
      odds.textContent = fmtPct(eachPercent(tierId, items.length, table));
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
  const gold = drop.tier === 'rare_special';
  const card = document.createElement('div');
  card.className = gold ? 'card mystery' : 'card';
  card.style.setProperty('--rarity', drop.color);
  card.dataset.color = drop.color;
  card.dataset.tier = drop.tier;
  const label = gold ? '★ 稀有特殊物品' : drop.item.name_zh;
  const img = document.createElement('img');
  img.alt = label;
  img.draggable = false;
  img.src = gold ? manifest.rare_special_item_icon.image : drop.image;
  const name = document.createElement('span');
  name.className = 'fname';
  name.textContent = label;
  const bar = document.createElement('i');
  bar.className = 'bar';
  bar.style.background = drop.color;
  img.addEventListener('error', () => {
    card.classList.add('no-img');
    img.remove();
  }, { once: true });
  card.append(img, name, bar);
  return card;
}

function clearGoldFx() {
  $('stage').classList.remove('is-gold', 'is-dim');
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

function paintName(el, text) {
  el.replaceChildren();
  const marker = 'StatTrak™';
  const at = text.indexOf(marker);
  if (at < 0) {
    el.textContent = text;
    return;
  }
  if (at > 0) el.append(document.createTextNode(text.slice(0, at)));
  const mark = document.createElement('span');
  mark.className = 'st-word';
  mark.textContent = marker;
  el.append(mark);
  const rest = text.slice(at + marker.length);
  if (rest) el.append(document.createTextNode(rest));
}

function paintOpenResult(value, cost) {
  const priceEl = $('reveal-price');
  const plEl = $('reveal-pl');
  priceEl.classList.remove('pl-pos', 'pl-neg');
  plEl.classList.remove('pl-pos', 'pl-neg');
  if (value == null || !Number.isFinite(value)) {
    priceEl.textContent = '价格未知';
    plEl.textContent = '本次盈亏 —';
    return;
  }
  priceEl.textContent = `参考价 ${yuan(value)}`;
  const profit = value - cost;
  plEl.textContent = `本次盈亏 ${formatSigned(profit)}`;
  if (profit > 0) plEl.classList.add('pl-pos');
  else if (profit < 0) plEl.classList.add('pl-neg');
}

function showReveal(drop, value, cost) {
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
  $('reveal-st').hidden = true;
  const tierEl = $('reveal-tier');
  tierEl.textContent = gold ? '★ 稀有特殊物品' : drop.tierZh;
  tierEl.style.background = drop.color;
  tierEl.style.color = gold ? '#1c1408' : '#f7f4ee';
  paintName($('reveal-zh'), names.zh);
  $('reveal-zh').style.color = gold ? GOLD : '#f4f1ea';
  paintName($('reveal-en'), names.en);
  $('reveal-wear').textContent = `${drop.wear.zh} · ${drop.wear.en}`;
  paintOpenResult(value, cost);
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
          const speed = Math.max(0, Math.min(1, cardsPerSec / 16));
          if (!audio.muted) {
            for (let i = 0; i < Math.min(crossed, 3); i += 1) audio.tick(speed, i * 0.01);
          }
          lastIndex = index;
        }
        const blur = cardsPerSec > 8 ? Math.min(1.4, (cardsPerSec - 8) / 10) : 0;
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
    const drop = rollDrop(cat, rollOpts());
    lastDrop = drop;
    showStage();
    const reel = $('reel');
    reel.replaceChildren();
    reel.style.filter = 'none';
    const built = buildReel(cat, drop, REEL_LEN, WINNER_AT, rollOpts());
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

    if (!fast) await new Promise((resolve) => { setTimeout(resolve, DIM_MS); });
    $('stage').classList.add('is-dim');
    focusWinner();
    const cost = state.key + state.casePrice;
    const value = quoteFor(drop);
    record(drop, value);
    showReveal(drop, value, cost);
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
    setSound(on);
    if (on) audio.arm();
  });
  const openContents = () => $('contents-dlg').showModal();
  $('btn-contents').addEventListener('click', openContents);
  $('btn-inspect').addEventListener('click', openContents);
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
  for (const [id, key] of [['key-price', 'key'], ['case-price', 'casePrice']]) {
    $(id).addEventListener('input', () => {
      const text = $(id).value.trim();
      if (text === '') return;
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0) return;
      state[key] = Math.round(n * 100) / 100;
      paintCostNotes();
      saveState();
    });
    $(id).addEventListener('blur', () => {
      const next = parsePrice($(id).value, state[key]);
      state[key] = next;
      $(id).value = formatPrice(next);
      paintCostNotes();
      saveState();
    });
  }
  $('mode-real').addEventListener('click', () => {
    if (!state.fun) return;
    state.fun = false;
    saveState();
    paintMode();
    paintLedger();
  });
  $('mode-fun').addEventListener('click', () => {
    if (state.fun) return;
    state.fun = true;
    saveState();
    paintMode();
    paintLedger();
  });
  $('gold-rate').addEventListener('input', () => {
    state.goldRate = snapGoldRate($('gold-rate').value);
    state.fun = true;
    saveState();
    paintMode();
  });
  $('reset-ledger').addEventListener('click', () => {
    if (!window.confirm('重置当前账本？')) return;
    state = resetCurrent(state);
    saveState();
    paintLedger();
  });
}

function commitItemPrice(input) {
  const id = input.dataset.priceId;
  const text = input.value.trim();
  if (text === '') {
    delete state.prices[id];
    input.value = '';
  } else {
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) {
      const prev = state.prices[id];
      input.value = Number.isFinite(prev) ? formatPrice(prev) : '';
    } else {
      const rounded = Math.round(n * 100) / 100;
      state.prices[id] = rounded;
      input.value = formatPrice(rounded);
    }
  }
  saveState();
  paintLedger();
}

function renderPriceBook() {
  const root = $('price-book');
  const order = ['milspec', 'restricted', 'classified', 'covert', 'rare_special'];
  for (const tierId of order) {
    const tier = TIERS.find((entry) => entry.id === tierId);
    const items = manifest.items.filter((item) => item.tier === tierId);
    const head = document.createElement('h3');
    head.textContent = tierId === 'rare_special' ? '★ 稀有特殊物品' : tier.zh;
    head.style.color = tierId === 'rare_special' ? GOLD : uiColor(items[0]);
    const list = document.createElement('div');
    list.className = 'ref-list';
    for (const item of items) {
      const label = document.createElement('label');
      label.className = 'ref-price';
      const name = document.createElement('span');
      name.textContent = item.name_zh;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '0.01';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.placeholder = '未填';
      input.dataset.priceId = item.id;
      input.setAttribute('aria-label', `${item.name_zh} 参考价`);
      const saved = state.prices[item.id];
      input.value = Number.isFinite(saved) ? formatPrice(saved) : '';
      input.addEventListener('input', () => {
        const text = input.value.trim();
        if (text === '') return;
        const n = Number(text);
        if (!Number.isFinite(n) || n < 0) return;
        state.prices[item.id] = Math.round(n * 100) / 100;
        paintLedger();
        saveState();
      });
      input.addEventListener('blur', () => commitItemPrice(input));
      label.append(name, input);
      list.append(label);
    }
    root.append(head, list);
  }
}

async function main() {
  const [response, priceResponse] = await Promise.all([
    fetch(new URL('./manifest.json', import.meta.url)),
    fetch(new URL('./prices.json', import.meta.url)),
  ]);
  if (!response.ok || !priceResponse.ok) throw new Error('manifest');
  manifest = await response.json();
  priceDoc = await priceResponse.json();
  if (!priceDoc || !priceDoc.items) throw new Error('prices');
  cat = prepare(manifest);
  if (state.sound === false) setSound(false);
  else setSound(true);
  setFast(fast);
  paintPrices();
  paintPriceSource();
  paintLedger();
  renderPreview();
  renderPriceBook();
  paintMode();
  bind();
  window.__case = {
    ready: true,
    uiColor,
    GOLD,
    debug,
    forceTier,
    spinMs: SPIN_MS,
    unlockMs: UNLOCK_MS,
    reelLen: REEL_LEN,
    winnerAt: WINNER_AT,
    startAt: START_AT,
    get fun() { return state.fun; },
    get goldRate() { return state.goldRate; },
    get lastDrop() { return lastDrop; },
  };
}

main().catch(() => {
  const note = document.createElement('p');
  note.className = 'fine pad';
  note.textContent = '箱子数据没有载入。';
  document.body.append(note);
});
