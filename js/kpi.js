// Pure KPI functions. No DOM, no storage: everything is computed from the session list.
//
// Consumption method: sessions are ordered by odometer. Each session's energy is assumed to
// replace what was used since the previous session, so session i "covers" the distance
// odo[i] - odo[i-1]. The very first session covers no known distance and is left out of
// kWh/100 km and $/100 km (but still counts in totals).

export const TYPES = ['AC', 'DC', 'Free'];

export function sortByOdo(sessions) {
  return [...sessions].sort((a, b) => a.odometerKm - b.odometerKm || a.datetime.localeCompare(b.datetime));
}

export function withSegments(sessions) {
  const s = sortByOdo(sessions);
  return s.map((x, i) => ({
    ...x,
    isFirst: i === 0,
    distKm: i === 0 ? 0 : Math.max(0, x.odometerKm - s[i - 1].odometerKm),
  }));
}

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseLocal = dt => new Date(dt.length === 10 ? dt + 'T00:00' : dt);

// Returns {from, to} as YYYY-MM-DD strings (inclusive), or null for "all".
export function periodRange(key, today = new Date()) {
  const to = ymd(today);
  if (key === 'month') return { from: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`, to };
  if (key === 'year') return { from: `${today.getFullYear()}-01-01`, to };
  if (key === '12m') {
    const f = new Date(today); f.setFullYear(f.getFullYear() - 1); f.setDate(f.getDate() + 1);
    return { from: ymd(f), to };
  }
  return null;
}

export function inRange(s, range) {
  if (!range) return true;
  const d = s.datetime.slice(0, 10);
  return d >= range.from && d <= range.to;
}

function emptyType() { return { n: 0, kwh: 0, cost: 0 }; }

export function summarize(segs) {
  const r = {
    sessions: segs.length, kwh: 0, cost: 0, distKm: 0, consKwh: 0, consCost: 0,
    paidKwh: 0, paidCost: 0, freeKwh: 0, estKwh: 0,
    byType: { AC: emptyType(), DC: emptyType(), Free: emptyType() },
  };
  for (const s of segs) {
    r.kwh += s.energyKwh;
    r.cost += s.totalCostAud;
    const t = r.byType[s.chargerType] || (r.byType[s.chargerType] = emptyType());
    t.n++; t.kwh += s.energyKwh; t.cost += s.totalCostAud;
    if (s.chargerType === 'Free') r.freeKwh += s.energyKwh;
    else { r.paidKwh += s.energyKwh; r.paidCost += s.totalCostAud; }
    if (s.energyEstimated) r.estKwh += s.energyKwh;
    if (!s.isFirst) { r.distKm += s.distKm; r.consKwh += s.energyKwh; r.consCost += s.totalCostAud; }
  }
  r.kwhPer100 = r.distKm > 0 ? (r.consKwh / r.distKm) * 100 : null;
  r.costPer100 = r.distKm > 0 ? (r.consCost / r.distKm) * 100 : null;
  r.avgPrice = r.paidKwh > 0 ? r.paidCost / r.paidKwh : null;
  return r;
}

// Group by "YYYY-MM" (or "YYYY"), filling empty months/years in between so charts have no gaps.
export function groupByMonth(segs) {
  if (!segs.length) return [];
  const keys = segs.map(s => s.datetime.slice(0, 7)).sort();
  const out = [];
  let [y, m] = keys[0].split('-').map(Number);
  const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    const key = `${y}-${pad(m)}`;
    out.push({ key, ...summarize(segs.filter(s => s.datetime.startsWith(key))) });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function groupByYear(segs) {
  if (!segs.length) return [];
  const years = segs.map(s => +s.datetime.slice(0, 4));
  const out = [];
  for (let y = Math.min(...years); y <= Math.max(...years); y++) {
    out.push({ key: String(y), ...summarize(segs.filter(s => s.datetime.startsWith(String(y)))) });
  }
  return out;
}

export function groupByLocation(segs) {
  const map = new Map();
  for (const s of segs) {
    const k = (s.location || '').trim();
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map].map(([key, list]) => ({ key, ...summarize(list) })).sort((a, b) => b.cost - a.cost);
}

export function guessType(pricePerKwh, cutoff) {
  if (!(pricePerKwh > 0)) return 'Free';
  return pricePerKwh >= cutoff ? 'DC' : 'AC';
}

// ---- Free-charge energy estimate ------------------------------------------------------

export function efficiencySamples(sessions, batteryKwh) {
  const out = [];
  for (const s of sessions) {
    if (s.energyEstimated || !(s.energyKwh > 0)) continue;
    if (s.socStart == null || s.socEnd == null || !(s.socEnd > s.socStart)) continue;
    const e = ((s.socEnd - s.socStart) / 100) * batteryKwh / s.energyKwh;
    if (e >= 0.5 && e <= 1.1) out.push(e); // ignore implausible entries (typos)
  }
  return out;
}

export function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export const MIN_EFFICIENCY_SAMPLES = 3;

export function learnedEfficiency(sessions, batteryKwh, defaultEfficiency) {
  const samples = efficiencySamples(sessions, batteryKwh);
  const learned = samples.length >= MIN_EFFICIENCY_SAMPLES;
  return { value: learned ? median(samples) : defaultEfficiency, n: samples.length, learned };
}

export function estimateKwh(socStart, socEnd, batteryKwh, efficiency) {
  if (socStart == null || socEnd == null || !(socEnd > socStart) || !(efficiency > 0)) return null;
  return ((socEnd - socStart) / 100) * batteryKwh / efficiency;
}

// ---- Other KPIs -----------------------------------------------------------------------

export function habits(segs) {
  const n = segs.length;
  const byDate = [...segs].sort((a, b) => a.datetime.localeCompare(b.datetime));
  const covered = segs.filter(s => !s.isFirst);
  const power = {};
  for (const t of ['AC', 'DC']) {
    const list = segs.filter(s => s.chargerType === t && s.durationMin > 0 && !s.energyEstimated);
    const hours = list.reduce((a, s) => a + s.durationMin / 60, 0);
    power[t] = hours > 0 ? list.reduce((a, s) => a + s.energyKwh, 0) / hours : null;
  }
  return {
    avgKwh: n ? segs.reduce((a, s) => a + s.energyKwh, 0) / n : null,
    avgKmBetween: covered.length ? covered.reduce((a, s) => a + s.distKm, 0) / covered.length : null,
    avgDaysBetween: n >= 2 ? (parseLocal(byDate[n - 1].datetime) - parseLocal(byDate[0].datetime)) / 86400000 / (n - 1) : null,
    powerKw: power,
  };
}

// Annual cost and distance at the rate of the last 12 months (scaled up if history is shorter).
export function projection(allSegs, today = new Date()) {
  if (!allSegs.length) return null;
  const firstDate = allSegs.reduce((m, s) => (s.datetime < m ? s.datetime : m), allSegs[0].datetime);
  const daysOfData = (today - parseLocal(firstDate)) / 86400000;
  const span = Math.min(365, daysOfData);
  if (span < 30) return null;
  const range = periodRange('12m', today);
  const recent = summarize(allSegs.filter(s => inRange(s, range)));
  const k = 365 / span;
  return { cost: recent.cost * k, distKm: recent.distKm * k, kwh: recent.kwh * k, scaled: span < 365 };
}

export function petrolComparison(summary, settings) {
  if (!summary.distKm || !(settings.petrolPrice > 0) || !(settings.petrolL100 > 0)) return null;
  const petrolCost = (summary.distKm * settings.petrolL100 / 100) * settings.petrolPrice;
  return { petrolCost, saving: petrolCost - summary.consCost };
}

// Pairs of consecutive sessions (by odometer) whose timestamps look wrong.
export function suspiciousPairs(sessions) {
  const s = sortByOdo(sessions);
  const out = [];
  for (let i = 1; i < s.length; i++) {
    const min = (parseLocal(s[i].datetime) - parseLocal(s[i - 1].datetime)) / 60000;
    const km = s[i].odometerKm - s[i - 1].odometerKm;
    if (min < 0) out.push({ a: s[i - 1], b: s[i], km, min, reason: 'date goes backwards while the odometer goes up' });
    else if (min < 60 && km >= 20) out.push({ a: s[i - 1], b: s[i], km, min, reason: `${Math.round(km)} km driven in ${Math.round(min)} min` });
  }
  return out;
}
