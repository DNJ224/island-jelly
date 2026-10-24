import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ease, REEL_LEN, SPIN_MS, START_AT, UNLOCK_MS, WINNER_AT } from '../case/timing.js';
import {
  GOLD,
  PHASE_BASIS,
  PHASES,
  STATTRAK_WEIGHT,
  TIER_BASIS,
  TIERS,
  FILLER_BASIS,
  FUN_BASIS,
  buildReel,
  displayName,
  displayPercents,
  funBreakdown,
  parsePrice,
  prepare,
  rollDrop,
  rollFiller,
  rollPhase,
  snapGoldRate,
  uiColor,
  wearOf,
} from '../case/roll.js';
import { blankLedger, netOf, recordDrop, recoveredOf, resetCurrent, returnRate, settleOpen, splitLedgers } from '../case/ledger.js';
import { OPEN_COST, PRICE_SOURCE, PHASE_CODES, WEAR_CODES, emptyPriceBook, lookupPrice, wearCodeOf } from '../case/prices.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'case');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const cat = prepare(manifest);

const GUNS = [
  ['Five-SeveN | Scrawl', 'FN57 | 涂鸦潦草', 'milspec'],
  ['MAC-10 | Ensnared', 'MAC-10 | 坐牢', 'milspec'],
  ['MAG-7 | Foresight', 'MAG-7 | 先见之明', 'milspec'],
  ['MP5-SD | Necro Jr.', 'MP5-SD | 小小噩梦', 'milspec'],
  ['P2000 | Lifted Spirits', 'P2000 | 升天', 'milspec'],
  ['SCAR-20 | Poultrygeist', 'SCAR-20 | 暗夜活死鸡', 'milspec'],
  ['Sawed-Off | Spirit Board', '截短霰弹枪 | 灵应牌', 'milspec'],
  ['PP-Bizon | Space Cat', 'PP-野牛 | 太空猫', 'restricted'],
  ['G3SG1 | Dream Glade', 'G3SG1 | 梦之林地', 'restricted'],
  ['M4A1-S | Night Terror', 'M4A1消音版 | 夜无眠', 'restricted'],
  ['XM1014 | Zombie Offensive', 'XM1014 | 行尸攻势', 'restricted'],
  ['USP-S | Ticket to Hell', 'USP消音版 | 地狱门票', 'restricted'],
  ['Dual Berettas | Melondrama', '双持贝瑞塔 | 瓜瓜', 'classified'],
  ['FAMAS | Rapid Eye Movement', '法玛斯 | 目皆转睛', 'classified'],
  ['MP7 | Abyssal Apparition', 'MP7 | 幽幻深渊', 'classified'],
  ['AK-47 | Nightwish', 'AK-47 | 夜愿', 'covert'],
  ['MP9 | Starlight Protector', 'MP9 | 星使', 'covert'],
];

const KNIVES = ['Bowie Knife', 'Butterfly Knife', 'Falchion Knife', 'Huntsman Knife', 'Shadow Daggers'];
const KNIVES_ZH = ['鲍伊猎刀（★）', '蝴蝶刀（★）', '弯刀（★）', '猎杀者匕首（★）', '暗影双匕（★）'];
const FINISHES = ['Gamma Doppler', 'Lore', 'Autotronic', 'Black Laminate', 'Freehand', 'Bright Water'];
const FINISHES_ZH = ['伽玛多普勒', '传说', '自动化', '黑色层压板', '自由之手', '澄澈之水'];

const guns = manifest.items.filter((item) => item.tier !== 'rare_special');
const knives = manifest.items.filter((item) => item.tier === 'rare_special');
assert.equal(guns.length, 17);
assert.equal(knives.length, 30);
assert.equal(manifest.items.length, 47);
assert.equal(manifest.gamma_doppler_phase_variants.length, 25);
assert.equal(manifest.counts.regular, 17);
assert.equal(manifest.counts.rare_unique_skins, 30);
assert.deepEqual(manifest.discrepancies_vs_expected, {
  missing_regular: [],
  extra_regular: [],
  missing_rare: [],
  extra_rare: [],
});

const gunKey = (item) => `${item.name_en}|${item.name_zh}|${item.tier}`;
assert.deepEqual(guns.map(gunKey).sort(), GUNS.map((row) => row.join('|')).sort());

const expectedKnives = [];
for (let i = 0; i < KNIVES.length; i += 1) {
  for (let j = 0; j < FINISHES.length; j += 1) {
    expectedKnives.push(`★ ${KNIVES[i]} | ${FINISHES[j]}|${KNIVES_ZH[i]} | ${FINISHES_ZH[j]}|rare_special`);
  }
}
assert.deepEqual(knives.map(gunKey).sort(), expectedKnives.sort());

const banned = ['Marble Fade', 'Tiger Tooth', 'Slaughter', 'Ultraviolet', 'Damascus Steel', 'Rust Coat', 'Case Hardened', 'Doppler'];
for (const item of manifest.items) {
  const name = item.name_en.replaceAll('Gamma Doppler', '');
  for (const word of banned) assert.equal(name.includes(word), false, item.name_en);
}

const weightSum = TIERS.reduce((sum, tier) => sum + tier.weight, 0);
assert.equal(weightSum, TIER_BASIS);
assert.equal(weightSum, 10000);
assert.equal(PHASES.reduce((sum, phase) => sum + phase.weight, 0), PHASE_BASIS);
assert.equal(STATTRAK_WEIGHT / TIER_BASIS, 0.1);

const floats = Object.fromEntries(manifest.items.map((item) => [item.name_en, [item.float_min, item.float_max]]));
assert.deepEqual(floats['AK-47 | Nightwish'], [0, 1]);
assert.deepEqual(floats['MP9 | Starlight Protector'], [0, 0.8]);
assert.deepEqual(floats['XM1014 | Zombie Offensive'], [0, 0.5]);
assert.deepEqual(floats['SCAR-20 | Poultrygeist'], [0, 0.57]);
assert.deepEqual(floats['USP-S | Ticket to Hell'], [0, 0.76]);
assert.deepEqual(floats['★ Butterfly Knife | Gamma Doppler'], [0, 0.08]);
assert.deepEqual(floats['★ Falchion Knife | Lore'], [0, 0.65]);
assert.deepEqual(floats['★ Huntsman Knife | Lore'], [0, 0.65]);
assert.deepEqual(floats['★ Bowie Knife | Freehand'], [0, 0.48]);
assert.deepEqual(floats['★ Shadow Daggers | Bright Water'], [0, 0.5]);
assert.deepEqual(floats['★ Butterfly Knife | Autotronic'], [0, 0.85]);

assert.equal(wearOf(0).zh, '崭新出厂');
assert.equal(wearOf(0.069999).zh, '崭新出厂');
assert.equal(wearOf(0.07).zh, '略有磨损');
assert.equal(wearOf(0.15).zh, '久经沙场');
assert.equal(wearOf(0.38).zh, '破损不堪');
assert.equal(wearOf(0.45).zh, '战痕累累');
assert.equal(wearOf(1).en, 'Battle-Scarred');

assert.equal(GOLD, '#e4ae39');
for (const item of knives) {
  assert.equal(item.rarity_color.toLowerCase(), '#eb4b4b', `${item.name_en} manifest color`);
  assert.equal(uiColor(item), '#e4ae39');
  assert.notEqual(uiColor(item).toLowerCase(), item.rarity_color.toLowerCase());
}
for (const item of guns) {
  assert.equal(uiColor(item).toLowerCase(), item.rarity_color.toLowerCase());
  assert.notEqual(uiColor(item).toLowerCase(), '#e4ae39');
}
for (const variant of manifest.gamma_doppler_phase_variants) {
  assert.equal(variant.rarity_color.toLowerCase(), '#eb4b4b');
  assert.equal(variant.tier, 'rare_special');
}

const images = new Set(readdirSync(join(root, 'images')));
assert.equal(images.size, 74);
for (const item of [...manifest.items, ...manifest.gamma_doppler_phase_variants]) {
  assert.equal(existsSync(join(root, item.image)), true, item.image);
}
assert.equal(existsSync(join(root, manifest.case.image)), true);
assert.equal(existsSync(join(root, manifest.rare_special_item_icon.image)), true);
assert.equal(existsSync(join(root, 'SOURCES.md')), true);

let gammaChecked = 0;
for (let i = 0; i < 4000; i += 1) {
  const drop = rollDrop(cat, { forceTier: 'rare_special' });
  assert.equal(drop.color, '#e4ae39');
  assert.equal(drop.item.rarity_color.toLowerCase(), '#eb4b4b');
  assert.ok(drop.floatValue >= drop.item.float_min && drop.floatValue <= drop.item.float_max);
  if (drop.phase) {
    gammaChecked += 1;
    assert.equal(drop.item.name_en.includes('Gamma Doppler'), true);
    assert.ok(PHASES.some((phase) => phase.id === drop.phase.id));
    if (drop.phase.en === 'Emerald') assert.equal(drop.image.includes('emerald'), true);
    if (drop.phase.en === 'Phase 2') assert.equal(drop.image.includes('phase_2'), true);
  } else {
    assert.equal(drop.image, drop.item.image);
    assert.equal(drop.item.name_en.includes('Gamma Doppler'), false);
  }
}
assert.ok(gammaChecked > 400, `gamma samples ${gammaChecked}`);

const winner = rollDrop(cat, { forceTier: 'covert' });
const reel = buildReel(cat, winner, 24, 11);
assert.equal(reel[11], winner);
for (const drop of reel) {
  assert.equal(drop.color, uiColor(drop.item));
  if (drop.tier === 'rare_special') assert.equal(drop.color, '#e4ae39');
}

const ak = guns.find((item) => item.name_en === 'AK-47 | Nightwish');
assert.equal(displayName({ item: ak, tier: 'covert', stattrak: false, phase: null }).zh, 'AK-47 | 夜愿');
assert.equal(displayName({ item: ak, tier: 'covert', stattrak: true, phase: null }).zh, 'StatTrak™ AK-47 | 夜愿');
assert.equal(displayName({ item: ak, tier: 'covert', stattrak: true, phase: null }).en, 'StatTrak™ AK-47 | Nightwish');
const bowie = knives.find((item) => item.name_en === '★ Bowie Knife | Gamma Doppler');
const phase = { zh: '相位 2', en: 'Phase 2' };
assert.equal(
  displayName({ item: bowie, tier: 'rare_special', stattrak: true, phase }).en,
  '★ StatTrak™ Bowie Knife | Gamma Doppler (Phase 2)',
);
assert.equal(
  displayName({ item: bowie, tier: 'rare_special', stattrak: true, phase }).zh,
  '鲍伊猎刀（★ StatTrak™） | 伽玛多普勒（相位 2）',
);
assert.equal(displayName({ item: bowie, tier: 'rare_special', stattrak: false, phase: null }).zh, '鲍伊猎刀（★） | 伽玛多普勒');

assert.equal(parsePrice('', 17), 17);
assert.equal(parsePrice('0', 17), 0);
assert.equal(parsePrice('0.00', 17), 0);
assert.equal(parsePrice('abc', 9), 9);
assert.equal(parsePrice(' 5.5 ', 0), 5.5);
assert.equal(parsePrice('-1', 3), 3);
assert.equal(FILLER_BASIS, 9974);

const goldWinner = rollDrop(cat, { forceTier: 'gold' });
const goldReel = buildReel(cat, goldWinner, 48, 30);
assert.equal(goldReel[30], goldWinner);
assert.equal(goldReel.filter((drop) => drop.tier === 'rare_special').length, 1);
const blueWinner = rollDrop(cat, { forceTier: 'milspec' });
const blueReel = buildReel(cat, blueWinner, 48, 30);
assert.equal(blueReel.filter((drop) => drop.tier === 'rare_special').length, 0);

function assertRate(name, got, expected, n) {
  const sd = Math.sqrt(expected * (1 - expected) / n);
  const diff = Math.abs(got - expected);
  assert.ok(diff < 6 * sd, `${name}: got ${got} expected ${expected} diff ${diff} sd ${sd}`);
}

const fillerN = 100_000;
const fillerCounts = Object.fromEntries(TIERS.map((tier) => [tier.id, 0]));
for (let i = 0; i < fillerN; i += 1) fillerCounts[rollFiller(cat).tier] += 1;
assert.equal(fillerCounts.rare_special, 0);
for (const tier of TIERS) {
  if (tier.id === 'rare_special') continue;
  assertRate(`filler ${tier.id}`, fillerCounts[tier.id] / fillerN, tier.weight / FILLER_BASIS, fillerN);
}

const N = 1_000_000;
const tierCounts = Object.fromEntries(TIERS.map((tier) => [tier.id, 0]));
const itemCounts = {};
for (const item of manifest.items) itemCounts[item.id] = 0;
let stattrak = 0;
let goldStattrak = 0;
const started = Date.now();
for (let i = 0; i < N; i += 1) {
  const drop = rollDrop(cat);
  tierCounts[drop.tier] += 1;
  itemCounts[drop.item.id] += 1;
  if (drop.stattrak) stattrak += 1;
  if (drop.tier === 'rare_special' && drop.stattrak) goldStattrak += 1;
  assert.equal(drop.color, uiColor(drop.item));
}
console.log('monte carlo ms', Date.now() - started, tierCounts);

for (const tier of TIERS) {
  assertRate(tier.id, tierCounts[tier.id] / N, tier.weight / TIER_BASIS, N);
  const pool = cat.byTier[tier.id];
  const seen = tierCounts[tier.id];
  for (const item of pool) {
    assertRate(`${tier.id}:${item.name_en}`, itemCounts[item.id] / seen, 1 / pool.length, seen);
  }
}
assertRate('stattrak', stattrak / N, 0.1, N);
assertRate('stattrak|gold', goldStattrak / tierCounts.rare_special, 0.1, tierCounts.rare_special);

const phaseN = 400_000;
const phaseCounts = Object.fromEntries(PHASES.map((phase) => [phase.id, 0]));
for (let i = 0; i < phaseN; i += 1) phaseCounts[rollPhase().id] += 1;
for (const phase of PHASES) {
  assertRate(phase.id, phaseCounts[phase.id] / phaseN, phase.weight / PHASE_BASIS, phaseN);
}
console.log('phase counts', phaseCounts);

assert.equal(SPIN_MS, 5900);
assert.equal(UNLOCK_MS, 1300);
assert.equal(WINNER_AT, 37);
assert.equal(REEL_LEN, 48);
assert.ok(WINNER_AT - START_AT >= 36 && WINNER_AT - START_AT <= 38);
assert.equal(ease(0), 0);
assert.equal(ease(1), 1);
let prev = -1;
for (let i = 0; i <= 100; i += 1) {
  const value = ease(i / 100);
  assert.ok(value >= prev && value <= 1, `ease overshoot at ${i}`);
  prev = value;
}
const initialSlope = ease(0.02) / 0.02;
assert.ok(initialSlope > 1.5, `starts fast, slope ${initialSlope}`);
const finalSlope = (1 - ease(0.98)) / 0.02;
assert.ok(finalSlope < 0.15, `stops, slope ${finalSlope}`);
const cubic = (x) => 1 - (1 - x) ** 3;
assert.ok(ease(0.85) < cubic(0.85), 'ease-out cubic finishes too early and then crawls');

assert.deepEqual(TIERS.map((tier) => tier.weight), [26, 64, 320, 1598, 7992]);
for (const rate of [1, 5, 25, 50]) {
  const breakdown = funBreakdown(rate);
  const weightSumFun = Object.values(breakdown.weights).reduce((sum, weight) => sum + weight, 0);
  assert.equal(weightSumFun, FUN_BASIS, `fun weights at ${rate}`);
  const shown = displayPercents(breakdown);
  const shownSum = Object.values(shown).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(shownSum - 100) < 1e-9, `shown percents ${rate} = ${shownSum}`);
  const scale = (100 - rate) / 95;
  assert.ok(Math.abs(breakdown.percents.rare_special - rate) < 1e-9);
  assert.ok(Math.abs(breakdown.percents.covert - 10 * scale) < 1e-9);
  assert.ok(Math.abs(breakdown.percents.classified - 20 * scale) < 1e-9);
  assert.ok(Math.abs(breakdown.percents.restricted - 30 * scale) < 1e-9);
  assert.ok(Math.abs(breakdown.percents.milspec - 35 * scale) < 1e-9);
}
assert.deepEqual(TIERS.map((tier) => tier.weight), [26, 64, 320, 1598, 7992]);
assert.equal(snapGoldRate(undefined), 5);
assert.equal(snapGoldRate(0.2), 1);
assert.equal(snapGoldRate(80), 50);
assert.equal(snapGoldRate(12.24), 12);
assert.equal(snapGoldRate(12.25), 12.5);

const funN = 200_000;
const funCounts = Object.fromEntries(TIERS.map((tier) => [tier.id, 0]));
const funAt = funBreakdown(25);
for (let i = 0; i < funN; i += 1) funCounts[rollDrop(cat, { fun: true, goldPercent: 25 }).tier] += 1;
for (const tier of TIERS) {
  assertRate(`fun ${tier.id}`, funCounts[tier.id] / funN, funAt.weights[tier.id] / FUN_BASIS, funN);
}
let funGoldFillers = 0;
for (let i = 0; i < 20_000; i += 1) {
  if (rollFiller(cat, { fun: true, goldPercent: 50 }).tier === 'rare_special') funGoldFillers += 1;
}
assert.equal(funGoldFillers, 0);
const funWinner = rollDrop(cat, { fun: true, goldPercent: 50, forceTier: 'milspec' });
const funReel = buildReel(cat, funWinner, 48, 30, { fun: true, goldPercent: 50 });
assert.equal(funReel.filter((drop) => drop.tier === 'rare_special').length, 0);
assert.equal(funWinner.tier, 'milspec');

const pricedRow = (value, tier = 'milspec') => ({
  itemId: 'skin',
  tier,
  color: '#fff',
  zh: '测试',
  wear: '崭新出厂',
  floatText: '0.0100',
  cost: 22.5,
  value,
});
let realLedger = blankLedger();
for (let i = 0; i < 201; i += 1) realLedger = recordDrop(realLedger, pricedRow(1));
assert.equal(realLedger.history.length, 200);
assert.equal(realLedger.opens, 201);
assert.equal(realLedger.recovered, 201);
assert.equal(recoveredOf(realLedger), 201);
const funLedger = recordDrop(blankLedger(), pricedRow(9, 'rare_special'));
assert.equal(funLedger.history[0].profit, 9 - 22.5);
assert.equal(funLedger.goldCount, 1);
const manualPrices = { skin: 100 };
const ledgers = {
  fun: true,
  goldRate: 12.5,
  key: 17,
  casePrice: 5.5,
  prices: manualPrices,
  real: realLedger,
  funLedger,
};
const resetFun = resetCurrent(ledgers);
assert.equal(resetFun.funLedger.opens, 0);
assert.equal(resetFun.funLedger.recovered, 0);
assert.equal(resetFun.real, realLedger);
assert.equal(resetFun.prices, manualPrices);
assert.equal(resetFun.goldRate, 12.5);
assert.equal(resetFun.key, 17);
assert.equal(resetFun.casePrice, 5.5);
assert.equal(resetFun.fun, true);
const resetReal = resetCurrent({ ...ledgers, fun: false });
assert.equal(resetReal.real.opens, 0);
assert.equal(resetReal.real.recovered, 0);
assert.equal(resetReal.funLedger, funLedger);
assert.equal(resetReal.prices, manualPrices);
assert.equal(resetReal.goldRate, 12.5);

const migrated = splitLedgers({ opens: 4, spent: 90, recovered: 3, history: [], goldCount: 2 });
assert.equal(migrated.real.opens, 4);
assert.equal(migrated.real.spent, 90);
assert.equal(migrated.real.recovered, 3);
assert.equal(migrated.real.goldCount, 2);
assert.equal(migrated.funLedger.opens, 0);
assert.equal(migrated.fun, false);
assert.equal(migrated.goldRate, 5);
const nested = splitLedgers({
  opens: 9,
  real: { opens: 2, spent: 1, history: [] },
  funLedger: { opens: 3, spent: 1, history: [] },
  fun: true,
  goldRate: 7.2,
});
assert.equal(nested.real.opens, 2);
assert.equal(nested.funLedger.opens, 3);
assert.equal(nested.fun, true);
assert.equal(nested.goldRate, 7);

const bounds = [
  [0, 'FN', 'fn'],
  [0.069999, 'FN', 'fn'],
  [0.07, 'MW', 'mw'],
  [0.149999, 'MW', 'mw'],
  [0.15, 'FT', 'ft'],
  [0.379999, 'FT', 'ft'],
  [0.38, 'WW', 'ww'],
  [0.449999, 'WW', 'ww'],
  [0.45, 'BS', 'bs'],
  [1, 'BS', 'bs'],
];
for (const [floatValue, code, id] of bounds) {
  assert.equal(wearCodeOf(floatValue), code, String(floatValue));
  assert.equal(wearOf(floatValue).id, id, String(floatValue));
}

assert.equal(settleOpen(30, OPEN_COST).profit, 30 - OPEN_COST);
assert.equal(settleOpen(OPEN_COST, OPEN_COST).profit, 0);
assert.equal(settleOpen(1, OPEN_COST).profit, 1 - OPEN_COST);
assert.equal(settleOpen(null, OPEN_COST).profit, null);
assert.equal(settleOpen(null, OPEN_COST).unknown, true);
assert.equal(OPEN_COST, 5.5 + 17);

const known = {
  itemId: 'skin-known',
  tier: 'milspec',
  color: '#4b69ff',
  zh: '已知',
  wear: '崭新出厂',
  stattrak: true,
  phase: '相位 2',
  floatText: '0.0100',
  cost: OPEN_COST,
  value: 30,
};
const unknown = {
  itemId: 'skin-unknown',
  tier: 'covert',
  color: '#eb4b4b',
  zh: '未知',
  wear: '久经沙场',
  stattrak: false,
  phase: null,
  floatText: '0.2000',
  cost: OPEN_COST,
  value: null,
};
let mixed = recordDrop(blankLedger(), known);
mixed = recordDrop(mixed, unknown);
assert.equal(mixed.opens, 2);
assert.equal(mixed.spent, OPEN_COST * 2);
assert.equal(mixed.recovered, 30);
assert.equal(mixed.unknownCount, 1);
assert.equal(returnRate(mixed.recovered, mixed.spent), 30 / (OPEN_COST * 2));
assert.equal(netOf(mixed), 30 - OPEN_COST * 2);
assert.equal(returnRate(0, 0), null);
assert.equal(mixed.history[0].value, null);
assert.equal(mixed.history[0].profit, null);
assert.equal(mixed.history[0].stattrak, false);
assert.equal(mixed.history[0].phase, null);
assert.equal(mixed.history[1].profit, 30 - OPEN_COST);
assert.equal(mixed.history[1].stattrak, true);
assert.equal(mixed.history[1].phase, '相位 2');
assert.equal(mixed.history[1].wear, '崭新出厂');

const funUnknown = recordDrop(blankLedger(), unknown);
const isolated = resetCurrent({
  fun: true,
  goldRate: 5,
  key: 17,
  casePrice: 5.5,
  prices: manualPrices,
  real: mixed,
  funLedger: funUnknown,
});
assert.equal(isolated.funLedger.opens, 0);
assert.equal(isolated.funLedger.unknownCount, 0);
assert.equal(isolated.funLedger.spent, 0);
assert.equal(isolated.real.recovered, 30);
assert.equal(isolated.real.unknownCount, 1);
assert.equal(isolated.real.spent, OPEN_COST * 2);
assert.equal(isolated.key, 17);
assert.equal(isolated.casePrice, 5.5);
assert.equal(isolated.goldRate, 5);

const savedPrices = JSON.parse(readFileSync(join(root, 'prices.json'), 'utf8'));
const freshPrices = emptyPriceBook(manifest);
assert.deepEqual(savedPrices, freshPrices);
assert.equal(savedPrices.source, PRICE_SOURCE);
assert.equal(savedPrices.date, null);
assert.equal(Object.keys(savedPrices.items).length, 47);
assert.equal(guns.length, 17);
assert.equal(knives.length, 30);
for (const item of manifest.items) {
  const row = savedPrices.items[item.id];
  assert.deepEqual(Object.keys(row), WEAR_CODES, item.name_en);
  const doppler = item.name_en.includes('Gamma Doppler');
  for (const wear of WEAR_CODES) {
    for (const st of ['false', 'true']) {
      const leaf = row[wear][st];
      if (doppler) {
        assert.deepEqual(Object.keys(leaf), PHASE_CODES, `${item.name_en} ${wear}`);
        for (const phase of PHASE_CODES) assert.equal(leaf[phase], null);
      } else {
        assert.equal(leaf, null, `${item.name_en} ${wear} ${st}`);
      }
    }
  }
  assert.equal(lookupPrice(savedPrices, item.id, 'fn', false, doppler ? { en: 'Phase 1' } : null), null);
}
const sample = emptyPriceBook(manifest);
const gun = guns[0];
sample.items[gun.id].FN.false = 3.27;
sample.items[gun.id].BS.true = null;
assert.equal(lookupPrice(sample, gun.id, 'fn', false, null), 3.27);
assert.equal(lookupPrice(sample, gun.id, wearOf(0.01).id, false, null), 3.27);
assert.equal(lookupPrice(sample, gun.id, 'bs', true, null), null);
const doppler = knives.find((item) => item.name_en.includes('Gamma Doppler'));
sample.items[doppler.id].MW.true.P4 = 1200;
sample.items[doppler.id].MW.true.Emerald = null;
assert.equal(lookupPrice(sample, doppler.id, 'mw', true, { en: 'Phase 4' }), 1200);
assert.equal(lookupPrice(sample, doppler.id, 'mw', true, { en: 'Emerald' }), null);
assert.equal(lookupPrice(sample, doppler.id, wearCodeOf(0.07).toLowerCase(), true, { en: 'Phase 4' }), 1200);

console.log('case checks passed');
