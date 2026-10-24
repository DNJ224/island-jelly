import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOLD,
  PHASE_BASIS,
  PHASES,
  STATTRAK_WEIGHT,
  TIER_BASIS,
  TIERS,
  FILLER_BASIS,
  buildReel,
  displayName,
  parsePrice,
  prepare,
  rollDrop,
  rollFiller,
  rollPhase,
  uiColor,
  wearOf,
} from '../case/roll.js';

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
console.log('case checks passed');
