// List of all charges, newest first, grouped by month.
import * as db from '../db.js';
import { suspiciousPairs } from '../kpi.js';
import { esc, fmtDateTime, fmtMoney, fmtNum, fmtPrice, monthLabel } from '../util.js';

let query = '';

export async function render(root) {
  const sessions = await db.getSessions();
  if (!sessions.length) {
    root.innerHTML = `<div class="card empty"><p>No charges yet.</p><a class="button primary" href="#/add">Add your first charge</a>
      <a class="button" href="#/settings">Import from Fuelio</a></div>`;
    return;
  }
  const flagged = new Set(suspiciousPairs(sessions).flatMap(p => [p.a.id, p.b.id]));

  root.innerHTML = `<input class="search" type="search" placeholder="Search date, type, location, notes" value="${esc(query)}">
    <div id="list"></div>`;
  const list = root.querySelector('#list');

  function draw() {
    const q = query.toLowerCase();
    const rows = sessions
      .filter(s => !q || [s.datetime, s.chargerType, s.location, s.notes, String(s.odometerKm)].some(x => (x || '').toLowerCase().includes(q)))
      .sort((a, b) => b.datetime.localeCompare(a.datetime) || b.odometerKm - a.odometerKm);
    if (!rows.length) { list.innerHTML = '<p class="empty">No matching charges.</p>'; return; }
    let html = '', month = null;
    for (const s of rows) {
      const m = s.datetime.slice(0, 7);
      if (m !== month) {
        month = m;
        const inMonth = rows.filter(r => r.datetime.startsWith(m));
        const cost = inMonth.reduce((a, r) => a + r.totalCostAud, 0);
        const kwh = inMonth.reduce((a, r) => a + r.energyKwh, 0);
        html += `<h2 class="month">${monthLabel(m)}<span>${fmtNum(kwh)} kWh · ${fmtMoney(cost)}</span></h2>`;
      }
      html += `<a class="entry" href="#/edit/${encodeURIComponent(s.id)}">
        <div>
          <div class="when">${esc(fmtDateTime(s.datetime))} <span class="badge ${s.chargerType}">${s.chargerType}</span>
            ${flagged.has(s.id) ? '<span class="flag" title="Date/time looks inconsistent with the odometer">⚠</span>' : ''}</div>
          <div class="sub">${fmtNum(s.odometerKm)} km${s.location ? ' · ' + esc(s.location) : ''}${s.socStart != null && s.socEnd != null ? ` · ${s.socStart}→${s.socEnd}%` : ''}</div>
        </div>
        <div class="right">
          <strong>${fmtMoney(s.totalCostAud)}</strong>
          <div class="sub">${s.energyEstimated ? '≈ ' : ''}${fmtNum(s.energyKwh, 1)} kWh${s.chargerType !== 'Free' ? ' · ' + fmtPrice(s.pricePerKwh) : ''}</div>
        </div></a>`;
    }
    list.innerHTML = html;
  }

  root.querySelector('.search').addEventListener('input', e => { query = e.target.value; draw(); });
  draw();
}
