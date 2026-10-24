// Drop table and RNG for the Dreams & Nightmares case.
// Tier weights are the Valve-published odds (second-hand source): 0.26 / 0.64 / 3.20 / 15.98 / 79.92.
// Gamma Doppler phases are a community estimate: Phase 1–4 at 23.75% each, Emerald at 5%.

export const GOLD = '#e4ae39';

export const TIERS = [
  { id: 'rare_special', zh: '稀有特殊物品', en: 'Rare Special', weight: 26 },
  { id: 'covert', zh: '隐秘', en: 'Covert', weight: 64 },
  { id: 'classified', zh: '保密', en: 'Classified', weight: 320 },
  { id: 'restricted', zh: '受限', en: 'Restricted', weight: 1598 },
  { id: 'milspec', zh: '军规级', en: 'Mil-Spec', weight: 7992 },
];

export const TIER_BASIS = 10000;

// Fun-mode defaults, in percent. Non-gold tiers scale by (100 - gold) / 95.
export const FUN_DEFAULTS = {
  rare_special: 5,
  covert: 10,
  classified: 20,
  restricted: 30,
  milspec: 35,
};
export const FUN_BASIS = 19000;

export function snapGoldRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return FUN_DEFAULTS.rare_special;
  const snapped = Math.round(n * 2) / 2;
  if (snapped < 1) return 1;
  if (snapped > 50) return 50;
  return snapped;
}

// Integer weights. gold is in 0.5% steps, and the five weights always sum to FUN_BASIS.
export function funBreakdown(goldPercent = FUN_DEFAULTS.rare_special) {
  const rate = snapGoldRate(goldPercent);
  const halves = Math.round(rate * 2);
  const rest = 200 - halves;
  const weights = {
    rare_special: halves * 95,
    covert: FUN_DEFAULTS.covert * rest,
    classified: FUN_DEFAULTS.classified * rest,
    restricted: FUN_DEFAULTS.restricted * rest,
    milspec: FUN_DEFAULTS.milspec * rest,
  };
  const percents = {};
  for (const id of Object.keys(weights)) percents[id] = (weights[id] / FUN_BASIS) * 100;
  return { rate, weights, basis: FUN_BASIS, percents };
}

export function displayPercents(breakdown) {
  const order = ['rare_special', 'covert', 'classified', 'restricted', 'milspec'];
  const shown = {};
  let used = 0;
  for (const id of order) {
    if (id === 'milspec') {
      shown[id] = Math.round((100 - used) * 100) / 100;
    } else {
      shown[id] = Math.round(breakdown.percents[id] * 100) / 100;
      used += shown[id];
    }
  }
  return shown;
}

export const PHASES = [
  { id: 'p1', en: 'Phase 1', zh: '相位 1', weight: 2375 },
  { id: 'p2', en: 'Phase 2', zh: '相位 2', weight: 2375 },
  { id: 'p3', en: 'Phase 3', zh: '相位 3', weight: 2375 },
  { id: 'p4', en: 'Phase 4', zh: '相位 4', weight: 2375 },
  { id: 'emerald', en: 'Emerald', zh: '绿宝石', weight: 500 },
];

export const PHASE_BASIS = 10000;
export const STATTRAK_WEIGHT = 1000;

const FORCE = {
  gold: 'rare_special',
  rare_special: 'rare_special',
  covert: 'covert',
  red: 'covert',
  classified: 'classified',
  pink: 'classified',
  restricted: 'restricted',
  purple: 'restricted',
  milspec: 'milspec',
  blue: 'milspec',
};

const pool = new Uint32Array(4096);
let poolAt = pool.length;

function nextUint() {
  if (poolAt >= pool.length) {
    crypto.getRandomValues(pool);
    poolAt = 0;
  }
  return pool[poolAt++];
}

export function randomBelow(n) {
  if (n <= 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  let x;
  do {
    x = nextUint();
  } while (x >= limit);
  return x % n;
}

export function randomUnit() {
  return nextUint() / 4294967296;
}

function pickWeighted(entries, basis) {
  let r = randomBelow(basis);
  for (const entry of entries) {
    if (r < entry.weight) return entry;
    r -= entry.weight;
  }
  return entries[entries.length - 1];
}

// Knives are Covert (#eb4b4b) on the item itself. In the case UI they are the gold slot.
export function uiColor(item) {
  if (item && item.tier === 'rare_special') return GOLD;
  return item ? item.rarity_color : GOLD;
}

export function wearOf(floatValue) {
  if (floatValue < 0.07) return { id: 'fn', zh: '崭新出厂', en: 'Factory New' };
  if (floatValue < 0.15) return { id: 'mw', zh: '略有磨损', en: 'Minimal Wear' };
  if (floatValue < 0.38) return { id: 'ft', zh: '久经沙场', en: 'Field-Tested' };
  if (floatValue < 0.45) return { id: 'ww', zh: '破损不堪', en: 'Well-Worn' };
  return { id: 'bs', zh: '战痕累累', en: 'Battle-Scarred' };
}

export function prepare(manifest) {
  const byTier = {};
  for (const tier of TIERS) byTier[tier.id] = [];
  for (const item of manifest.items) {
    if (!byTier[item.tier]) byTier[item.tier] = [];
    byTier[item.tier].push(item);
  }
  const phases = new Map();
  for (const variant of manifest.gamma_doppler_phase_variants || []) {
    let group = phases.get(variant.variant_of);
    if (!group) {
      group = new Map();
      phases.set(variant.variant_of, group);
    }
    group.set(variant.phase, variant);
  }
  return { manifest, byTier, phases };
}

export function rollPhase() {
  return pickWeighted(PHASES, PHASE_BASIS);
}

const FILLER_TIERS = TIERS.filter((tier) => tier.id !== 'rare_special');
export const FILLER_BASIS = FILLER_TIERS.reduce((sum, tier) => sum + tier.weight, 0);

export function parsePrice(raw, fallback) {
  const text = String(raw ?? '').trim();
  if (text === '') return fallback;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

// Fillers never roll the gold slot. A gold card appears only when it is the winner.
function tierTable(opts = {}) {
  if (!opts.fun) return { entries: TIERS, basis: TIER_BASIS };
  const breakdown = funBreakdown(opts.goldPercent);
  return {
    entries: TIERS.map((tier) => ({ ...tier, weight: breakdown.weights[tier.id] })),
    basis: breakdown.basis,
  };
}

export function rollFiller(cat, opts = {}) {
  const table = tierTable(opts);
  const entries = table.entries.filter((tier) => tier.id !== 'rare_special');
  const basis = entries.reduce((sum, tier) => sum + tier.weight, 0);
  const tier = pickWeighted(entries, basis);
  return rollDrop(cat, { forceTier: tier.id });
}

export function rollDrop(cat, opts = {}) {
  const table = tierTable(opts);
  const forcedId = opts.forceTier ? (FORCE[opts.forceTier] || opts.forceTier) : null;
  const tier = (forcedId && table.entries.find((entry) => entry.id === forcedId)) || pickWeighted(table.entries, table.basis);
  const list = cat.byTier[tier.id];
  const item = list[randomBelow(list.length)];
  const stattrak = randomBelow(TIER_BASIS) < STATTRAK_WEIGHT;
  const span = item.float_max - item.float_min;
  const floatValue = span > 0 ? item.float_min + randomUnit() * span : item.float_min;
  let phase = null;
  let image = item.image;
  const variants = cat.phases.get(item.name_en);
  if (variants) {
    phase = rollPhase();
    const variant = variants.get(phase.en);
    if (variant) image = variant.image;
  }
  return {
    item,
    tier: tier.id,
    tierZh: tier.zh,
    tierEn: tier.en,
    stattrak,
    floatValue,
    wear: wearOf(floatValue),
    phase,
    image,
    color: uiColor(item),
  };
}

export function displayName(drop) {
  const zhPhase = drop.phase ? `（${drop.phase.zh}）` : '';
  const enPhase = drop.phase ? ` (${drop.phase.en})` : '';
  let zh = drop.item.name_zh;
  let en = drop.item.name_en;
  if (drop.stattrak) {
    if (drop.tier === 'rare_special') {
      zh = zh.includes('（★）') ? zh.replace('（★）', '（★ StatTrak™）') : `StatTrak™ ${zh}`;
      en = en.startsWith('★ ') ? `★ StatTrak™ ${en.slice(2)}` : `StatTrak™ ${en}`;
    } else {
      zh = `StatTrak™ ${zh}`;
      en = `StatTrak™ ${en}`;
    }
  }
  return { zh: `${zh}${zhPhase}`, en: `${en}${enPhase}` };
}

export function buildReel(cat, winner, length = 64, winnerAt = 54, opts = {}) {
  const reel = new Array(length);
  for (let i = 0; i < length; i += 1) {
    reel[i] = i === winnerAt ? winner : rollFiller(cat, opts);
  }
  return reel;
}

export function tierPercent(tierId, table) {
  if (table && table.percents) return table.percents[tierId];
  const tier = TIERS.find((entry) => entry.id === tierId);
  return (tier.weight / TIER_BASIS) * 100;
}

export function eachPercent(tierId, count, table) {
  return tierPercent(tierId, table) / count;
}
