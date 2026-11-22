import * as K from '../js/kpi.js';
import { parseCsv, parseFuelio, parseFuelioDate } from '../js/fuelio.js';
import { toCsv, makeBackup, readBackup } from '../js/backup.js';
import * as G from '../js/geo.js';

const out = document.getElementById('out');
let pass = 0, fail = 0;
function ok(cond, name, detail = '') {
  cond ? pass++ : fail++;
  out.insertAdjacentHTML('beforeend', `<span class="${cond ? 'pass' : 'fail'}">${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + detail}</span>\n`);
}
const near = (a, b, tol, name) => ok(a != null && Math.abs(a - b) <= tol, name, `got ${a}, expected ${b}`);

const S = (datetime, odometerKm, energyKwh, chargerType, pricePerKwh, extra = {}) => ({
  id: datetime + odometerKm, datetime, odometerKm, energyKwh, chargerType, pricePerKwh,
  totalCostAud: chargerType === 'Free' ? 0 : Math.round(energyKwh * pricePerKwh * 100) / 100,
  energyEstimated: false, socStart: null, socEnd: null, ...extra,
});

// ---- Hand-made dataset ----
const data = [
  S('2026-01-05T10:00', 1000, 40, 'AC', 0.40),             // first: no distance covered
  S('2026-01-20T10:00', 1300, 45, 'DC', 0.70),             // 300 km
  S('2026-02-03T10:00', 1500, 30, 'Free', 0),              // 200 km
  S('2026-02-25T10:00', 1700, 30, 'AC', 0.40, { socStart: 20, socEnd: 53, durationMin: 300 }), // 200 km
];
const seg = K.withSegments(data);
const sum = K.summarize(seg);
near(sum.kwh, 145, 1e-9, 'total kWh');
near(sum.cost, 16 + 31.5 + 0 + 12, 1e-9, 'total cost');
near(sum.distKm, 700, 1e-9, 'distance excludes first session');
near(sum.kwhPer100, (45 + 30 + 30) / 700 * 100, 1e-9, 'kWh/100 km');
near(sum.costPer100, (31.5 + 12) / 700 * 100, 1e-9, '$/100 km');
near(sum.avgPrice, 59.5 / 115, 1e-9, 'average paid $/kWh excludes free');
near(sum.freeKwh, 30, 1e-9, 'free kWh');
ok(sum.byType.DC.n === 1 && sum.byType.AC.n === 2, 'count by type');

const months = K.groupByMonth(seg);
ok(months.length === 2 && months[0].key === '2026-01' && months[1].key === '2026-02', 'monthly grouping');
near(months[1].kwhPer100, 60 / 400 * 100, 1e-9, 'February consumption');
const gap = K.groupByMonth(K.withSegments([S('2026-01-01T00:00', 1, 1, 'AC', 1), S('2026-04-01T00:00', 2, 1, 'AC', 1)]));
ok(gap.length === 4 && gap[1].sessions === 0, 'empty months are filled');

// Order by odometer, not date
const swapped = K.withSegments([S('2026-01-01T10:01', 1000, 10, 'AC', 1), S('2026-01-01T10:00', 1200, 20, 'AC', 1)]);
ok(swapped[1].odometerKm === 1200 && swapped[1].distKm === 200, 'segments ordered by odometer');

// Period ranges
const today = new Date(2026, 10, 22);
ok(JSON.stringify(K.periodRange('month', today)) === '{"from":"2026-11-01","to":"2026-11-22"}', 'period: this month');
ok(K.periodRange('12m', today).from === '2025-11-23', 'period: last 12 months');
ok(K.periodRange('all', today) === null, 'period: all');

// Type guess
ok(K.guessType(0.55, 0.55) === 'DC' && K.guessType(0.54, 0.55) === 'AC' && K.guessType(0, 0.55) === 'Free', 'AC/DC guess with cutoff');

// Free-charge estimate
near(K.estimateKwh(20, 80, 82, 0.9), 0.6 * 82 / 0.9, 1e-9, 'estimate with default efficiency');
ok(K.estimateKwh(80, 20, 82, 0.9) === null, 'no estimate when SoC end ≤ start');
let eff = K.learnedEfficiency(data, 82, 0.9);
ok(!eff.learned && eff.value === 0.9 && eff.n === 1, 'default efficiency until 3 samples');
const learnedData = [
  S('2026-03-01T10:00', 1, 30, 'AC', 0.4, { socStart: 10, socEnd: 42 }),   // 26.24/30 = 0.8747
  S('2026-03-02T10:00', 2, 30, 'AC', 0.4, { socStart: 10, socEnd: 43 }),   // 27.06/30 = 0.902
  S('2026-03-03T10:00', 3, 30, 'DC', 0.7, { socStart: 10, socEnd: 44 }),   // 27.88/30 = 0.9293
  S('2026-03-04T10:00', 4, 30, 'AC', 0.4, { socStart: 10, socEnd: 90 }),   // 2.19 implausible, ignored
  S('2026-03-05T10:00', 5, 30, 'Free', 0, { socStart: 10, socEnd: 40, energyEstimated: true }), // estimated, ignored
];
eff = K.learnedEfficiency(learnedData, 82, 0.9);
ok(eff.learned && eff.n === 3, 'learned efficiency uses 3 valid samples');
near(eff.value, 33 / 100 * 82 / 30, 1e-9, 'learned efficiency is the median');

// Habits and projection
const hab = K.habits(seg);
near(hab.avgKwh, 145 / 4, 1e-9, 'average kWh per charge');
near(hab.avgKmBetween, 700 / 3, 1e-9, 'average km between charges');
near(hab.powerKw.AC, 30 / 5, 1e-9, 'average AC power');
const proj = K.projection(seg, new Date(2026, 2, 6));
ok(proj && proj.scaled, 'projection scales up a short history');

// Petrol comparison
const pc = K.petrolComparison(sum, { petrolPrice: 2, petrolL100: 7 });
near(pc.petrolCost, 700 * 0.07 * 2, 1e-9, 'petrol cost for same distance');
near(pc.saving, 98 - 43.5, 1e-9, 'saving vs petrol');

// Suspicious timestamps
ok(K.suspiciousPairs([S('2026-01-01T10:00', 100, 1, 'AC', 1), S('2026-01-01T10:05', 300, 1, 'AC', 1)]).length === 1, 'flags 200 km in 5 min');

// ---- CSV / backup ----
ok(JSON.stringify(parseCsv('"a","b,c",,"d""e"\r\n1,2\n')) === JSON.stringify([['a', 'b,c', '', 'd"e'], ['1', '2']]), 'CSV parser: quotes, commas, empty fields');
ok(parseFuelioDate('2026-11-19 20:30') === '2026-11-19T20:30' && parseFuelioDate('19.11.2026') === '2026-11-19T00:00', 'Fuelio date formats');
const csv = toCsv([{ ...data[0], notes: 'hello, "world"' }]);
ok(csv.split('\r\n').length === 2 && csv.includes('"hello, ""world"""'), 'CSV export escapes notes');
ok(readBackup(makeBackup(data, { batteryKwh: 82 })).sessions.length === 4, 'backup round-trip');
let threw = false; try { readBackup('{"x":1}'); } catch { threw = true; }
ok(threw, 'rejects a non-backup JSON');

// ---- GPS ----
const P = (lat, lon, extra = {}) => ({ lat, lon, energyKwh: 10, totalCostAud: 5, ...extra });
near(G.distanceM({ lat: -33.8688, lon: 151.2093 }, { lat: -37.8136, lon: 144.9631 }), 713400, 2000, 'distance Sydney → Melbourne ≈ 713 km');
ok(!G.hasCoords(P(0, 0)) && !G.hasCoords(P(null, null)) && G.hasCoords(P(-33.9, 151.2)), 'hasCoords ignores 0,0 and empty');
const named = [P(-33.8700, 151.2000, { location: 'Evie Mall' }), P(-33.9000, 151.2000, { location: 'Home' })];
ok(G.nearestLocationName(named, { lat: -33.8705, lon: 151.2003 }) === 'Evie Mall', 'nearest named charge within 150 m');
ok(G.nearestLocationName(named, { lat: -33.8800, lon: 151.2000 }) === null, 'no name when nothing within 150 m');
const places = G.groupPlaces([P(-33.87, 151.2, { location: 'A' }), P(-33.8702, 151.2001, { location: 'A' }), P(-33.8701, 151.2, { location: 'B' }), P(-33.95, 151.1), P(0, 0)]);
ok(places.length === 2 && places[0].n === 3 && places[0].name === 'A' && places[0].kwh === 30 && places[1].name === null, 'groups charges into places', JSON.stringify(places));
ok(toCsv([{ ...data[0], lat: -33.87, lon: 151.2 }]).includes('-33.87,151.2'), 'CSV export includes lat/lon');

// ---- Real Fuelio export (only when served from the workspace with the Input folder) ----
try {
  const res = await fetch('../../Input/EV3-1-2026-11-21_21-13.csv');
  if (!res.ok) throw new Error('not found');
  const f = parseFuelio(await res.text(), { dcCutoff: 0.55 });
  ok(f.sessions.length === 55, 'Fuelio: 55 charges', f.sessions.length);
  ok(f.vehicle.name === 'EV3' && f.vehicle.capacityKwh === 82, 'Fuelio: vehicle EV3, 82 kWh');
  const fs = K.summarize(K.withSegments(f.sessions));
  near(fs.kwh, 2159.737, 1e-6, 'Fuelio: total kWh');
  near(fs.cost, 1039.36, 1e-6, 'Fuelio: total cost');
  near(fs.distKm, 14032, 1e-9, 'Fuelio: distance 1,750 → 15,782 km');
  near(fs.kwhPer100, 15.1966, 1e-3, 'Fuelio: 15.20 kWh/100 km');
  near(fs.costPer100, 7.3291, 1e-3, 'Fuelio: $7.33/100 km');
  ok(fs.byType.AC.n === 31 && fs.byType.DC.n === 20 && fs.byType.Free.n === 4, 'Fuelio: 31 AC / 20 DC / 4 Free at $0.55', JSON.stringify(fs.byType));
  ok(f.costMismatches.length === 0, 'Fuelio: totals match kWh × price');
  ok(K.suspiciousPairs(f.sessions).length === 5, 'Fuelio: 5 odd timestamp pairs', K.suspiciousPairs(f.sessions).length);
  ok(new Set(f.sessions.map(s => s.id)).size === 55, 'Fuelio: unique ids for duplicate detection');
  ok(f.sessions.every(s => s.lat === null && s.lon === null), 'Fuelio: 0,0 coordinates read as no position');
  const withGps = parseFuelio(`"## Log"\n"Data","Odo (km)","kWh","Price (optional)","latitude (optional)","longitude (optional)"\n"2026-01-01 10:00","100","20","9","-33.87","151.2"\n`);
  ok(withGps.sessions[0].lat === -33.87 && withGps.sessions[0].lon === 151.2, 'Fuelio: imports real coordinates');
} catch (e) {
  out.insertAdjacentHTML('beforeend', `(Fuelio file test skipped: ${e.message})\n`);
}

document.getElementById('summary').innerHTML = `<strong class="${fail ? 'fail' : 'pass'}">${pass} passed, ${fail} failed</strong>`;
document.title = `${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`;
