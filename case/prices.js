// BUFF lowest-listing prices for the Dreams & Nightmares case.
// Knives in the manifest start with "★ ". The price table does not. Match on a normalized name.

export const PRICE_SOURCE = '参考价：BUFF 在售最低价（csgotrader 数据，2026-10-24）';
export const OPEN_COST = 22.5;

export const WEARS = ['fn', 'mw', 'ft', 'ww', 'bs'];
export const WEAR_BANDS = {
  fn: [0, 0.07],
  mw: [0.07, 0.15],
  ft: [0.15, 0.38],
  ww: [0.38, 0.45],
  bs: [0.45, 1],
};

const WEAR_CODE = { FN: 'fn', MW: 'mw', FT: 'ft', WW: 'ww', BS: 'bs' };
const PHASE_FROM = { P1: 'Phase 1', P2: 'Phase 2', P3: 'Phase 3', P4: 'Phase 4', Emerald: 'Emerald' };
export const PHASE_NAMES = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Emerald'];
const PHASE_PROB = { 'Phase 1': 0.2375, 'Phase 2': 0.2375, 'Phase 3': 0.2375, 'Phase 4': 0.2375, Emerald: 0.05 };
const TIER_WEIGHT = { rare_special: 26, covert: 64, classified: 320, restricted: 1598, milspec: 7992 };

export function normalizeName(name) {
  return String(name ?? '')
    .trim()
    .replace(/^\u2605\s*/, '')
    .trim()
    .replace(/[ \t]+/g, ' ');
}

export function cellKey(wear, stattrak, phase) {
  const name = phase && typeof phase === 'object' ? (phase.en || '') : (phase || '');
  return `${wear}|${stattrak ? 1 : 0}|${name}`;
}

export function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = lines[0].split(',').map((cell) => cell.trim());
  const idx = Object.fromEntries(header.map((name, index) => [name, index]));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(',');
    const priceText = (cols[idx.buff_cny] ?? '').trim();
    const price = priceText === '' ? null : Number(priceText);
    rows.push({
      name: cols[idx.name],
      wear: (cols[idx.wear] ?? '').trim(),
      stattrak: (cols[idx.stattrak] ?? '').trim() === '1',
      phase: (cols[idx.phase] ?? '').trim(),
      raw: Number.isFinite(price) ? price : null,
    });
  }
  return rows;
}

function parseKey(key) {
  const [wear, st, ...rest] = key.split('|');
  return { wear, stattrak: st === '1', phase: rest.join('|') };
}

export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// Raw rows only. Throws if a CSV name does not match a manifest item, or an item has no rows.
export function mapRows(manifest, rows) {
  const byName = new Map();
  for (const item of manifest.items) {
    const key = normalizeName(item.name_en);
    if (byName.has(key)) throw new Error(`duplicate manifest name ${key}`);
    byName.set(key, item);
  }
  const items = {};
  for (const item of manifest.items) items[item.id] = {};
  const unmapped = [];
  for (const row of rows) {
    const item = byName.get(normalizeName(row.name));
    if (!item) {
      unmapped.push(row.name);
      continue;
    }
    const wear = WEAR_CODE[row.wear];
    if (!wear) throw new Error(`unknown wear ${row.wear} on ${row.name}`);
    if (row.phase && !PHASE_FROM[row.phase]) throw new Error(`unknown phase ${row.phase} on ${row.name}`);
    const phase = row.phase ? PHASE_FROM[row.phase] : '';
    items[item.id][cellKey(wear, row.stattrak, phase)] = {
      raw: row.raw,
      value: row.raw,
      estimated: false,
    };
  }
  if (unmapped.length) {
    throw new Error(`unmapped CSV names: ${[...new Set(unmapped)].join(' | ')}`);
  }
  for (const item of manifest.items) {
    if (!Object.keys(items[item.id]).length) throw new Error(`no price rows for ${item.name_en}`);
  }
  return { source: PRICE_SOURCE, items };
}

function rawOf(cells, wear, stattrak, phase) {
  const cell = cells[cellKey(wear, stattrak, phase)];
  if (!cell || cell.raw == null || !Number.isFinite(cell.raw)) return null;
  return cell.raw;
}

// Next-worse wear first, then next-better, walking outward. Raw prices only.
function adjacentRaw(cells, wear, stattrak, phase) {
  const index = WEARS.indexOf(wear);
  for (let dist = 1; dist < WEARS.length; dist += 1) {
    const worse = index + dist;
    const better = index - dist;
    if (worse < WEARS.length) {
      const value = rawOf(cells, WEARS[worse], stattrak, phase);
      if (value != null) return value;
    }
    if (better >= 0) {
      const value = rawOf(cells, WEARS[better], stattrak, phase);
      if (value != null) return value;
    }
  }
  return null;
}

function ratioList(cells) {
  const ratios = [];
  for (const [key, cell] of Object.entries(cells)) {
    if (!parseKey(key).stattrak || cell.raw == null) continue;
    const { wear, phase } = parseKey(key);
    const base = rawOf(cells, wear, false, phase);
    if (base != null && base > 0) ratios.push(cell.raw / base);
  }
  return ratios;
}

// Fill blanks: adjacent wear, then StatTrak ratio, then Doppler phase median.
export function fillEstimates(manifest, doc) {
  const items = {};
  for (const [id, cells] of Object.entries(doc.items)) {
    items[id] = {};
    for (const [key, cell] of Object.entries(cells)) items[id][key] = { ...cell };
  }

  for (const cells of Object.values(items)) {
    for (const [key, cell] of Object.entries(cells)) {
      if (cell.raw != null) continue;
      const { wear, stattrak, phase } = parseKey(key);
      const guess = adjacentRaw(cells, wear, stattrak, phase);
      if (guess == null) continue;
      cell.value = guess;
      cell.estimated = true;
      cell.method = 'wear';
    }
  }

  const own = new Map();
  const knifeRatios = [];
  const gunRatios = [];
  for (const item of manifest.items) {
    const ratios = ratioList(items[item.id]);
    own.set(item.id, median(ratios));
    const bucket = item.tier === 'rare_special' ? knifeRatios : gunRatios;
    bucket.push(...ratios);
  }
  const knifeMedian = median(knifeRatios);
  const gunMedian = median(gunRatios);

  for (const item of manifest.items) {
    const ratio = own.get(item.id) ?? (item.tier === 'rare_special' ? knifeMedian : gunMedian);
    if (ratio == null) continue;
    const cells = items[item.id];
    for (const [key, cell] of Object.entries(cells)) {
      if (cell.value != null) continue;
      const { wear, stattrak, phase } = parseKey(key);
      if (!stattrak) continue;
      const base = cells[cellKey(wear, false, phase)];
      if (!base || base.value == null) continue;
      cell.value = base.value * ratio;
      cell.estimated = true;
      cell.method = 'stattrak';
    }
  }

  for (const item of manifest.items) {
    const cells = items[item.id];
    const before = {};
    for (const [key, cell] of Object.entries(cells)) before[key] = cell.value;
    for (const [key, cell] of Object.entries(cells)) {
      if (cell.value != null) continue;
      const { wear, stattrak, phase } = parseKey(key);
      if (!phase) continue;
      const same = [];
      for (const other of PHASE_NAMES) {
        if (other === phase) continue;
        const value = before[cellKey(wear, stattrak, other)];
        if (value != null) same.push(value);
      }
      let guess = median(same);
      if (guess == null) {
        const any = [];
        for (const other of PHASE_NAMES) {
          if (other === phase) continue;
          for (const st of [false, true]) {
            const value = before[cellKey(wear, st, other)];
            if (value != null) any.push(value);
          }
        }
        guess = median(any);
      }
      if (guess == null) continue;
      cell.value = guess;
      cell.estimated = true;
      cell.method = 'phase';
    }
  }

  for (const cells of Object.values(items)) {
    for (const cell of Object.values(cells)) {
      if (cell.estimated && cell.value != null) cell.value = Math.round(cell.value * 100) / 100;
    }
  }
  return { source: doc.source || PRICE_SOURCE, items };
}

export function buildPrices(manifest, csvText) {
  return fillEstimates(manifest, mapRows(manifest, parseCsv(csvText)));
}

export function lookupQuote(doc, itemId, wear, stattrak, phase) {
  const cells = doc && doc.items ? doc.items[itemId] : null;
  if (!cells) return null;
  const cell = cells[cellKey(wear, stattrak, phase)];
  if (!cell || cell.value == null || !Number.isFinite(cell.value)) return null;
  return cell;
}

export function wearShare(min, max, wear) {
  const span = max - min;
  if (!(span > 0)) return 0;
  const [start, end] = WEAR_BANDS[wear];
  const lo = Math.max(min, start);
  const hi = Math.min(max, end);
  if (!(hi > lo)) return 0;
  return (hi - lo) / span;
}

// Per-item conditional price, then the real tier weight. excludeNulls uses raw cells only.
export function expectedOpenValue(manifest, doc, { useEstimates = false } = {}) {
  const counts = {};
  for (const item of manifest.items) counts[item.tier] = (counts[item.tier] || 0) + 1;
  let ev = 0;
  let knives = 0;
  let pricedMass = 0;
  let pricedValue = 0;
  let knifeMass = 0;
  let knifeValue = 0;
  for (const item of manifest.items) {
    const pItem = (TIER_WEIGHT[item.tier] / 10000) / counts[item.tier];
    const phases = item.name_en.includes('Gamma Doppler')
      ? PHASE_NAMES.map((name) => ({ name, p: PHASE_PROB[name] }))
      : [{ name: '', p: 1 }];
    let mass = 0;
    let weighted = 0;
    for (const wear of WEARS) {
      const pw = wearShare(item.float_min, item.float_max, wear);
      if (pw <= 0) continue;
      for (const stattrak of [false, true]) {
        const ps = stattrak ? 0.1 : 0.9;
        for (const phase of phases) {
          const cell = doc.items[item.id][cellKey(wear, stattrak, phase.name)];
          const price = cell ? (useEstimates ? cell.value : cell.raw) : null;
          const slice = pw * ps * phase.p;
          const outcome = pItem * slice;
          if (price == null || !Number.isFinite(price)) continue;
          mass += slice;
          weighted += slice * price;
          pricedMass += outcome;
          pricedValue += outcome * price;
          if (item.tier === 'rare_special') {
            knifeMass += outcome;
            knifeValue += outcome * price;
          }
        }
      }
    }
    if (!(mass > 0)) continue;
    const contrib = pItem * (weighted / mass);
    ev += contrib;
    if (item.tier === 'rare_special') knives += contrib;
  }
  return {
    ev,
    knives,
    rate: ev / OPEN_COST,
    globalEv: pricedMass > 0 ? pricedValue / pricedMass : 0,
    globalKnives: pricedMass > 0 ? knifeValue / pricedMass : 0,
    knifeMass,
    pricedMass,
  };
}
