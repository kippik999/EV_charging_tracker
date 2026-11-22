// Add / edit a charge.
import * as db from '../db.js';
import { sortByOdo, learnedEfficiency, estimateKwh } from '../kpi.js';
import { getPosition, hasCoords, nearestLocationName } from '../geo.js';
import { esc, fmtMoney, fmtNum, fmtPct, nowLocal, readNum, toast } from '../util.js';

export async function render(root, { arg }) {
  const [sessions, settings] = await Promise.all([db.getSessions(), db.getSettings()]);
  const editing = arg ? sessions.find(s => s.id === arg) : null;
  if (arg && !editing) { root.innerHTML = '<p class="empty">This charge no longer exists.</p>'; return; }

  const others = sessions.filter(s => s.id !== editing?.id);
  const last = sortByOdo(others).at(-1);
  const eff = learnedEfficiency(others, settings.batteryKwh, settings.defaultEfficiency);
  const locations = [...new Set(sessions.map(s => s.location).filter(Boolean))].sort();
  let type = editing?.chargerType ?? settings.lastType ?? 'AC';
  let priceTouched = !!editing;

  const val = v => (v == null ? '' : esc(v));
  root.innerHTML = `
  <form class="card form" novalidate>
    <h1>${editing ? 'Edit charge' : 'Add charge'}</h1>
    <div class="seg" role="radiogroup" aria-label="Charger type">
      ${['AC', 'DC', 'Free'].map(t => `<button type="button" data-type="${t}" class="${t === type ? 'on' : ''}">${t}</button>`).join('')}
    </div>

    <label>Odometer (km)
      <input id="odo" inputmode="decimal" autocomplete="off" value="${val(editing?.odometerKm)}"
        placeholder="${last ? 'last: ' + fmtNum(last.odometerKm) : ''}">
    </label>
    <label><span id="kwh-label">Energy charged (kWh)</span>
      <input id="kwh" inputmode="decimal" autocomplete="off"
        value="${editing && !editing.energyEstimated ? val(editing.energyKwh) : ''}">
    </label>
    <label id="price-row">Unit price ($/kWh)
      <input id="price" inputmode="decimal" autocomplete="off"
        value="${val(editing ? editing.pricePerKwh : settings.lastPrice[type])}">
    </label>

    <div class="total"><span>Total cost</span><strong id="total">$0.00</strong></div>
    <p id="estimate" class="hint" hidden></p>

    <div class="row2">
      <label>SoC start %<input id="soc0" inputmode="numeric" value="${val(editing?.socStart)}" placeholder="optional"></label>
      <label>SoC end %<input id="soc1" inputmode="numeric" value="${val(editing?.socEnd)}" placeholder="optional"></label>
    </div>

    <label>Date &amp; time<input id="dt" type="datetime-local" value="${esc(editing?.datetime ?? nowLocal())}"></label>
    <div id="geo" class="geo" hidden><span id="geo-text"></span><button type="button" id="geo-btn" class="link"></button></div>

    <details ${editing && (editing.location || editing.durationMin || editing.notes) ? 'open' : ''}>
      <summary>More</summary>
      <label>Network / location<input id="loc" list="locs" value="${val(editing?.location)}" autocomplete="off"></label>
      <datalist id="locs">${locations.map(l => `<option value="${esc(l)}">`).join('')}</datalist>
      <label>Duration (min)<input id="dur" inputmode="numeric" value="${val(editing?.durationMin)}"></label>
      <label>Notes<textarea id="notes" rows="2">${val(editing?.notes)}</textarea></label>
    </details>

    <ul id="warnings" class="warnings"></ul>
    <button class="primary" type="submit">${editing ? 'Save changes' : 'Save charge'}</button>
    ${editing ? '<button type="button" id="delete" class="danger">Delete this charge</button>' : ''}
  </form>`;

  const $ = id => root.querySelector('#' + id);
  const f = { odo: $('odo'), kwh: $('kwh'), price: $('price'), soc0: $('soc0'), soc1: $('soc1') };

  function compute() {
    const odo = readNum(f.odo), kwhIn = readNum(f.kwh), price = readNum(f.price);
    const soc0 = readNum(f.soc0), soc1 = readNum(f.soc1);
    const est = estimateKwh(soc0, soc1, settings.batteryKwh, eff.value);
    const free = type === 'Free';
    const useEstimate = free && kwhIn == null && est != null;
    const kwh = useEstimate ? est : kwhIn;
    const cost = free ? 0 : (kwh > 0 && price >= 0 ? kwh * price : null);
    return { odo, kwhIn, kwh, price, soc0, soc1, est, free, useEstimate, cost };
  }

  function update() {
    const c = compute();
    root.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.type === type));
    $('price-row').hidden = c.free;
    $('kwh-label').textContent = c.free ? 'Energy charged (kWh, optional)' : 'Energy charged (kWh)';
    f.kwh.placeholder = c.free ? 'leave empty to estimate from SoC' : '';
    $('total').textContent = c.cost == null ? '–' : fmtMoney(Math.round(c.cost * 100) / 100);

    const effText = `${fmtPct(eff.value)} charging efficiency, ${eff.learned ? `learned from ${eff.n} charges` : 'default'}`;
    const est = $('estimate');
    if (c.free && c.kwhIn == null) {
      est.hidden = false;
      est.textContent = c.est != null
        ? `≈ ${fmtNum(c.est, 1)} kWh, estimated from SoC (${settings.batteryKwh} kWh battery, ${effText})`
        : 'Enter SoC start and end to estimate the energy.';
    } else if (!c.free && c.kwhIn > 0 && c.soc0 != null && c.soc1 > c.soc0) {
      const gained = ((c.soc1 - c.soc0) / 100) * settings.batteryKwh;
      est.hidden = false;
      est.textContent = `Battery gained ≈ ${fmtNum(gained, 1)} kWh · efficiency ${fmtPct(gained / c.kwhIn)}`;
    } else est.hidden = true;

    const w = [];
    if (!editing && last && c.odo != null && c.odo < last.odometerKm) w.push(`Odometer is lower than the last charge (${fmtNum(last.odometerKm)} km).`);
    if (!editing && last && c.odo != null && c.odo - last.odometerKm > 2000) w.push(`That is ${fmtNum(c.odo - last.odometerKm)} km since the last charge.`);
    if (c.soc0 != null && c.soc1 != null && c.soc1 <= c.soc0) w.push('SoC end should be higher than SoC start.');
    if ([c.soc0, c.soc1].some(x => x != null && (x < 0 || x > 100))) w.push('SoC must be between 0 and 100.');
    if (c.kwh > settings.batteryKwh * 1.3) w.push(`More than 1.3× the battery size (${settings.batteryKwh} kWh).`);
    if (!c.free && c.price > 2) w.push('Unit price is over $2/kWh. Is that right?');
    $('warnings').innerHTML = w.map(x => `<li>${esc(x)}</li>`).join('');
  }

  root.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    type = b.dataset.type;
    if (!priceTouched && type !== 'Free') f.price.value = settings.lastPrice[type] ?? '';
    update();
  }));
  f.price.addEventListener('input', () => { priceTouched = true; });

  // GPS position: fetched automatically for a new charge; kept as-is when editing unless changed.
  let pos = editing && hasCoords(editing) ? { lat: editing.lat, lon: editing.lon, accuracyM: editing.gpsAccuracyM ?? null } : null;
  let geoState = pos ? 'set' : 'none', geoMsg = '', matched = null, geoReq = 0;
  function drawGeo() {
    const box = $('geo');
    box.hidden = !navigator.geolocation && !pos;
    const acc = pos?.accuracyM != null ? ` (±${fmtNum(pos.accuracyM)} m)` : '';
    $('geo-text').textContent = {
      pending: '📍 Getting GPS position…',
      set: `📍 Position saved with this charge${acc}${matched ? ` · matched “${matched}”` : ''}`,
      none: '📍 No position',
      error: '📍 ' + geoMsg,
    }[geoState];
    $('geo-btn').textContent = { pending: 'Skip', set: 'Remove', none: 'Use current position', error: 'Try again' }[geoState];
    box.classList.toggle('warn', geoState === 'error');
  }
  async function locate() {
    const req = ++geoReq;
    geoState = 'pending'; drawGeo();
    try {
      const p = await getPosition();
      if (req !== geoReq) return;
      pos = p; geoState = 'set';
      const name = $('loc').value.trim() ? null : nearestLocationName(others, p);
      if (name) { $('loc').value = name; matched = name; }
    } catch (e) {
      if (req !== geoReq) return;
      geoState = 'error'; geoMsg = e.message;
    }
    drawGeo();
  }
  $('geo-btn').addEventListener('click', () => {
    if (geoState === 'pending' || geoState === 'set') { geoReq++; pos = null; matched = null; geoState = 'none'; drawGeo(); }
    else locate();
  });
  drawGeo();
  if (!editing && navigator.geolocation) locate();
  root.querySelector('form').addEventListener('input', update);

  root.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const c = compute();
    const errors = [];
    if (!(c.odo >= 0)) errors.push('Enter the odometer.');
    if (!$('dt').value) errors.push('Enter the date and time.');
    if (c.free) { if (!(c.kwh > 0)) errors.push('Enter the kWh, or SoC start and end so it can be estimated.'); }
    else {
      if (!(c.kwhIn > 0)) errors.push('Enter the energy charged.');
      if (!(c.price >= 0)) errors.push('Enter the unit price.');
    }
    if ([c.soc0, c.soc1].some(x => Number.isNaN(x))) errors.push('SoC must be a number.');
    if (errors.length) { toast(errors[0]); return; }

    const dur = readNum($('dur'));
    const session = {
      ...(editing || {}),
      id: editing?.id ?? db.newId(),
      datetime: $('dt').value,
      odometerKm: c.odo,
      energyKwh: Math.round(c.kwh * 1000) / 1000,
      energyEstimated: c.useEstimate,
      chargerType: type,
      pricePerKwh: c.free ? 0 : c.price,
      totalCostAud: c.free ? 0 : Math.round(c.cost * 100) / 100,
      socStart: c.soc0,
      socEnd: c.soc1,
      location: $('loc').value.trim(),
      lat: pos?.lat ?? null,
      lon: pos?.lon ?? null,
      gpsAccuracyM: pos?.accuracyM ?? null,
      durationMin: dur > 0 ? dur : null,
      notes: $('notes').value.trim(),
      source: editing?.source ?? 'manual',
      typeConfirmed: true,
    };
    await db.putSession(session);
    settings.lastType = type;
    if (!c.free) settings.lastPrice[type] = c.price;
    await db.saveSettings(settings);
    toast(editing ? 'Changes saved' : `Charge saved · ${fmtMoney(session.totalCostAud)}`);
    location.hash = '#/history';
  });

  $('delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this charge?')) return;
    await db.deleteSession(editing.id);
    toast('Charge deleted');
    location.hash = '#/history';
  });

  update();
}
