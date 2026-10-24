import { snapGoldRate } from './roll.js';

export function blankLedger() {
  return {
    opens: 0,
    spent: 0,
    recovered: 0,
    firstGoldAt: null,
    goldCount: 0,
    counts: {},
    history: [],
  };
}

export function normalizeLedger(raw) {
  const blank = blankLedger();
  if (!raw || typeof raw !== 'object') return blank;
  const history = Array.isArray(raw.history) ? raw.history : [];
  const counts = raw.counts && typeof raw.counts === 'object' && !Array.isArray(raw.counts) ? { ...raw.counts } : {};
  let goldCount = Number(raw.goldCount);
  if (!Number.isFinite(goldCount) || goldCount < 0) {
    goldCount = history.filter((row) => row.tier === 'rare_special').length;
  }
  const opens = Number(raw.opens);
  const spent = Number(raw.spent);
  const recovered = Number(raw.recovered);
  return {
    opens: Number.isFinite(opens) && opens >= 0 ? opens : 0,
    spent: Number.isFinite(spent) && spent >= 0 ? spent : 0,
    recovered: Number.isFinite(recovered) && recovered >= 0 ? recovered : 0,
    firstGoldAt: raw.firstGoldAt == null ? null : Number(raw.firstGoldAt),
    goldCount,
    counts,
    history,
  };
}

// Old saves kept one ledger on the root. New saves keep real and fun apart.
export function splitLedgers(saved) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const hasReal = source.real && typeof source.real === 'object';
  return {
    fun: source.fun === true,
    goldRate: snapGoldRate(source.goldRate),
    real: normalizeLedger(hasReal ? source.real : source),
    funLedger: normalizeLedger(source.funLedger),
  };
}

export function recordDrop(ledger, row) {
  const next = normalizeLedger(ledger);
  next.counts = { ...next.counts };
  next.history = next.history.slice();
  next.opens += 1;
  next.spent += row.cost;
  if (row.tier === 'rare_special') {
    next.goldCount += 1;
    if (next.firstGoldAt == null) next.firstGoldAt = next.opens;
  }
  if (row.itemId) next.counts[row.itemId] = (next.counts[row.itemId] || 0) + 1;
  const value = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
  next.recovered += value == null ? 0 : value;
  next.history.unshift({
    itemId: row.itemId,
    color: row.color,
    tier: row.tier,
    zh: row.zh,
    wear: row.wear,
    floatText: row.floatText,
    value,
    estimated: row.estimated === true,
  });
  if (next.history.length > 200) next.history.length = 200;
  return next;
}

export function resetCurrent(state) {
  if (state.fun) return { ...state, funLedger: blankLedger() };
  return { ...state, real: blankLedger() };
}

export function recoveredOf(ledger) {
  const n = Number(ledger && ledger.recovered);
  return Number.isFinite(n) ? n : 0;
}
