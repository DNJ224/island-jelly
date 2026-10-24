// Reference prices for one open. A null leaf means 未查到.
// Keyed by item id, wear (FN/MW/FT/WW/BS), stattrak, and for Gamma Doppler also phase (P1–P4, Emerald).

export const PRICE_SOURCE = 'BUFF 在售最低价（csgotrader）';
export const OPEN_COST = 22.5;
export const WEAR_CODES = ['FN', 'MW', 'FT', 'WW', 'BS'];
export const PHASE_CODES = ['P1', 'P2', 'P3', 'P4', 'Emerald'];

const WEAR_CODE = {
  fn: 'FN',
  mw: 'MW',
  ft: 'FT',
  ww: 'WW',
  bs: 'BS',
  FN: 'FN',
  MW: 'MW',
  FT: 'FT',
  WW: 'WW',
  BS: 'BS',
};

const PHASE_CODE = {
  'Phase 1': 'P1',
  'Phase 2': 'P2',
  'Phase 3': 'P3',
  'Phase 4': 'P4',
  Emerald: 'Emerald',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
};

// Standard CS2 cutoffs: FN [0, 0.07), MW [0.07, 0.15), FT [0.15, 0.38), WW [0.38, 0.45), BS [0.45, 1].
export function wearCodeOf(floatValue) {
  if (floatValue < 0.07) return 'FN';
  if (floatValue < 0.15) return 'MW';
  if (floatValue < 0.38) return 'FT';
  if (floatValue < 0.45) return 'WW';
  return 'BS';
}

function phaseCodeOf(phase) {
  if (!phase) return null;
  if (typeof phase === 'string') return PHASE_CODE[phase] || null;
  return PHASE_CODE[phase.en] || PHASE_CODE[phase.id] || null;
}

function finitePrice(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function emptyPriceBook(manifest, source = PRICE_SOURCE, date = null) {
  const items = {};
  for (const item of manifest.items) {
    const doppler = item.name_en.includes('Gamma Doppler');
    const wears = {};
    for (const wear of WEAR_CODES) {
      const leaf = () => (doppler
        ? { P1: null, P2: null, P3: null, P4: null, Emerald: null }
        : null);
      wears[wear] = { false: leaf(), true: leaf() };
    }
    items[item.id] = wears;
  }
  return { source, date, items };
}

export function lookupPrice(doc, itemId, wear, stattrak, phase) {
  const item = doc && doc.items ? doc.items[itemId] : null;
  if (!item) return null;
  const code = WEAR_CODE[wear];
  const byWear = code ? item[code] : null;
  if (!byWear || typeof byWear !== 'object') return null;
  const slot = byWear[stattrak ? 'true' : 'false'];
  if (slot == null || typeof slot !== 'object') return finitePrice(slot);
  const phaseCode = phaseCodeOf(phase);
  if (!phaseCode) return null;
  return finitePrice(slot[phaseCode]);
}
