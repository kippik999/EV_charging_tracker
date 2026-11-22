// Fuelio CSV backup parser. The file has sections ("## Vehicle", "## Log", ...), each a header row + data rows.
import { guessType } from './kpi.js';

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function splitSections(rows) {
  const sections = {};
  let current = null;
  for (const r of rows) {
    if (r.length === 1 && r[0].startsWith('## ')) { current = { header: null, rows: [] }; sections[r[0].slice(3).trim()] = current; continue; }
    if (!current || (r.length === 1 && r[0] === '')) continue;
    if (!current.header) current.header = r;
    else current.rows.push(Object.fromEntries(current.header.map((h, i) => [h, r[i] ?? ''])));
  }
  return sections;
}

const num = v => (v == null || String(v).trim() === '' ? null : parseFloat(String(v).replace(',', '.')));
const round2 = x => Math.round(x * 100) / 100;

// Accepts "yyyy-MM-dd HH:mm", "yyyy-MM-dd", "dd.MM.yyyy HH:mm", "dd/MM/yyyy HH:mm".
export function parseFuelioDate(s) {
  s = (s || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}`;
  return null;
}

export function parseFuelio(text, { dcCutoff = 0.55 } = {}) {
  const sections = splitSections(parseCsv(text));
  const log = sections['Log'];
  if (!log || !log.header) throw new Error('No "## Log" section found. Is this a Fuelio CSV backup?');

  const h = log.header;
  const col = {
    date: h.find(x => /^data$|^date$/i.test(x)) ?? h[0],
    odo: h.find(x => /^odo/i.test(x)),
    kwh: h.find(x => /^kwh$/i.test(x)) ?? h.find(x => /^fuel/i.test(x)),
    total: h.find(x => /^price/i.test(x)),
    unit: h.find(x => /^volumeprice$/i.test(x)),
    full: h.find(x => /^full$/i.test(x)),
    city: h.find(x => /^city/i.test(x)),
    notes: h.find(x => /^notes/i.test(x)),
    guid: h.find(x => /^guid$/i.test(x)),
    lat: h.find(x => /^latitude/i.test(x)),
    lon: h.find(x => /^longitude/i.test(x)),
  };
  if (!col.odo || !col.kwh) throw new Error('The Log section has no odometer or kWh column.');

  const v = sections['Vehicle']?.rows[0];
  const vehicle = v ? { name: v.Name || null, capacityKwh: num(v.Tank1Capacity) || null } : null;

  const sessions = [], skipped = [], costMismatches = [];
  for (const r of log.rows) {
    const datetime = parseFuelioDate(r[col.date]);
    const odo = num(r[col.odo]);
    const kwh = num(r[col.kwh]);
    if (!datetime || odo == null || kwh == null) { skipped.push(r); continue; }
    const total = col.total ? num(r[col.total]) : null;
    let unit = col.unit ? num(r[col.unit]) : null;
    if (!(unit > 0) && total > 0 && kwh > 0) unit = total / kwh;
    unit = unit || 0;
    const cost = total != null ? total : round2(kwh * unit);
    if (total != null && unit > 0 && Math.abs(total - kwh * unit) > 0.05) costMismatches.push({ datetime, total, computed: round2(kwh * unit) });
    const guid = col.guid ? r[col.guid] : '';
    const lat = col.lat ? num(r[col.lat]) : null, lon = col.lon ? num(r[col.lon]) : null;
    const located = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0); // Fuelio writes 0,0 for "none"
    sessions.push({
      id: 'fuelio-' + (guid || `${datetime}-${odo}`),
      datetime,
      odometerKm: odo,
      energyKwh: kwh,
      energyEstimated: false,
      chargerType: cost === 0 ? 'Free' : guessType(unit, dcCutoff),
      pricePerKwh: cost === 0 ? 0 : unit,
      totalCostAud: cost,
      socStart: null,
      socEnd: null,
      location: col.city ? r[col.city].trim() : '',
      lat: located ? lat : null,
      lon: located ? lon : null,
      gpsAccuracyM: null,
      durationMin: null,
      notes: col.notes ? r[col.notes].trim() : '',
      full: col.full ? r[col.full] === '1' : null,
      importId: guid || null,
      source: 'fuelio',
    });
  }
  return { vehicle, sessions, skipped, costMismatches };
}
