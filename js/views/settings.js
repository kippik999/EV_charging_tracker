// Settings, Fuelio import, backup / restore, CSV export.
import * as db from '../db.js';
import { guessType, suspiciousPairs } from '../kpi.js';
import { parseFuelio } from '../fuelio.js';
import { makeBackup, readBackup, toCsv, shareOrDownload, readFile } from '../backup.js';
import { esc, fmtMoney, fmtNum, fmtDateTime, readNum, toast } from '../util.js';

const FIELDS = [
  ['vehicleName', 'Vehicle name', 'text'],
  ['batteryKwh', 'Battery capacity (kWh)', 'num', 'Used to estimate free charges from SoC.'],
  ['defaultEfficiency', 'Default charging efficiency (%)', 'pct', 'Used until the app has learned yours from 3+ paid charges with SoC.'],
  ['dcCutoff', 'DC price cutoff ($/kWh)', 'num', 'Imported charges at or above this price are guessed as DC, below as AC.'],
  ['petrolPrice', 'Petrol price ($/L)', 'num', 'For the "saved vs petrol" comparison.'],
  ['petrolL100', 'Petrol car consumption (L/100 km)', 'num'],
  ['gridCo2', 'Grid CO₂ (kg/kWh, optional)', 'num', 'Leave empty to hide the CO₂ estimate.'],
];

export async function render(root) {
  const [settings, sessions] = await Promise.all([db.getSettings(), db.getSessions()]);
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const imported = sessions.filter(s => s.source === 'fuelio' && !s.typeConfirmed && s.chargerType !== 'Free');

  root.innerHTML = `
  <section class="card form"><h1>Settings</h1>
    ${FIELDS.map(([k, label, kind, hint]) => {
      const v = settings[k] == null ? '' : kind === 'pct' ? Math.round(settings[k] * 100) : settings[k];
      return `<label>${label}<input data-k="${k}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${esc(v)}"></label>${hint ? `<p class="hint">${hint}</p>` : ''}`;
    }).join('')}
    <button class="primary" id="save">Save settings</button>
    ${imported.length ? `<button id="reguess">Re-apply DC cutoff to ${imported.length} imported charges</button>
      <p class="hint">Charges you have edited yourself are left alone.</p>` : ''}
  </section>

  <section class="card"><h2>Import from Fuelio</h2>
    <p class="hint">In Fuelio: Settings → Backup → Export CSV, then pick the file here. Charges already imported are skipped.</p>
    <input type="file" id="fuelio-file" accept=".csv,text/csv,text/comma-separated-values">
    <div id="preview"></div>
  </section>

  <section class="card"><h2>Backup</h2>
    <p class="hint">Your data lives only on this phone. Export a backup now and then (for example to Google Drive).</p>
    <button id="export-json">Export backup (JSON)</button>
    <button id="export-csv">Export charges (CSV)</button>
    <label class="file-button">Restore backup…<input type="file" id="restore-file" accept=".json,application/json" hidden></label>
    <p class="hint">${sessions.length} charges stored · storage ${persisted ? 'protected from automatic clean-up' : persisted === false ? 'not yet protected (install the app to protect it)' : 'status unknown'}.</p>
    <button id="wipe" class="danger">Delete all charges</button>
  </section>
  <p class="hint center">EV Tracker · data stays on your device</p>`;

  const $ = id => root.querySelector('#' + id);

  $('save').addEventListener('click', async () => {
    for (const input of root.querySelectorAll('[data-k]')) {
      const { k, kind } = input.dataset;
      if (kind === 'text') { settings[k] = input.value.trim() || 'My EV'; continue; }
      const n = readNum(input);
      if (Number.isNaN(n) || (n == null && k !== 'gridCo2') || (n != null && n < 0)) { toast(`Check "${input.parentElement.firstChild.textContent.trim()}"`); return; }
      settings[k] = kind === 'pct' ? n / 100 : n;
    }
    if (!(settings.batteryKwh > 0)) { toast('Battery capacity must be above 0'); return; }
    if (!(settings.defaultEfficiency > 0.5 && settings.defaultEfficiency <= 1)) { toast('Efficiency must be between 50 and 100%'); return; }
    await db.saveSettings(settings);
    toast('Settings saved');
    render(root);
  });

  $('reguess')?.addEventListener('click', async () => {
    const changed = imported.map(s => ({ ...s, chargerType: guessType(s.pricePerKwh, settings.dcCutoff) }));
    await db.putSessions(changed);
    toast(`Updated ${changed.length} charges with the $${settings.dcCutoff}/kWh cutoff`);
    render(root);
  });

  // ---- Fuelio import -----
  $('fuelio-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await readFile(file);
    showPreview(text);
  });

  function showPreview(text) {
    const box = $('preview');
    let parsed;
    try { parsed = parseFuelio(text, { dcCutoff: settings.dcCutoff }); }
    catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    const existing = new Set(sessions.map(s => s.id));
    const fresh = parsed.sessions.filter(s => !existing.has(s.id));
    const dupes = parsed.sessions.length - fresh.length;

    const draw = cutoff => {
      fresh.forEach(s => { if (s.chargerType !== 'Free') s.chargerType = guessType(s.pricePerKwh, cutoff); });
      const count = t => fresh.filter(s => s.chargerType === t).length;
      const odo = fresh.map(s => s.odometerKm);
      const dates = fresh.map(s => s.datetime).sort();
      const pairs = suspiciousPairs(parsed.sessions);
      const v = parsed.vehicle;
      box.innerHTML = `
        <div class="preview">
          <p><strong>${fresh.length}</strong> new charges${dupes ? `, ${dupes} already imported (skipped)` : ''}${parsed.skipped.length ? `, ${parsed.skipped.length} unreadable rows skipped` : ''}.</p>
          ${fresh.length ? `
          <p>${dates[0].slice(0, 10)} → ${dates.at(-1).slice(0, 10)} · ${fmtNum(Math.min(...odo))} → ${fmtNum(Math.max(...odo))} km<br>
            ${fmtNum(fresh.reduce((a, s) => a + s.energyKwh, 0), 1)} kWh · ${fmtMoney(fresh.reduce((a, s) => a + s.totalCostAud, 0))}</p>
          <label>DC cutoff for this import ($/kWh)<input id="cutoff" inputmode="decimal" value="${cutoff}"></label>
          <p><span class="badge AC">AC</span> ${count('AC')} &nbsp; <span class="badge DC">DC</span> ${count('DC')} &nbsp; <span class="badge Free">Free</span> ${count('Free')}</p>` : ''}
          ${parsed.costMismatches.length ? `<p class="warn">${parsed.costMismatches.length} rows where total ≠ kWh × price. The total from Fuelio is kept.</p>` : ''}
          ${pairs.length ? `<details><summary class="warn">${pairs.length} pairs of charges with odd timestamps</summary><ul class="small">
            ${pairs.map(p => `<li>${esc(fmtDateTime(p.a.datetime))} → ${esc(fmtDateTime(p.b.datetime))}: ${esc(p.reason)}</li>`).join('')}</ul>
            <p class="hint">KPIs order charges by odometer, so these don't skew the results. You can fix the times later in History (marked ⚠).</p></details>` : ''}
          ${v?.name && v.name !== settings.vehicleName ? `<label class="check"><input type="checkbox" id="use-name" checked> Rename vehicle to "${esc(v.name)}"</label>` : ''}
          ${fresh.length ? `<button class="primary" id="do-import">Import ${fresh.length} charges</button>` : ''}
        </div>`;
      box.querySelector('#cutoff')?.addEventListener('change', e => {
        const c = readNum(e.target);
        if (c > 0) draw(c); else toast('Enter a price above 0');
      });
      box.querySelector('#do-import')?.addEventListener('click', async () => {
        await db.putSessions(fresh);
        if (box.querySelector('#use-name')?.checked) { settings.vehicleName = v.name; await db.saveSettings(settings); }
        toast(`Imported ${fresh.length} charges`);
        location.hash = '#/dashboard';
      });
    };
    draw(settings.dcCutoff);
  }

  // ---- Backup -----
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('export-json').addEventListener('click', () =>
    shareOrDownload(makeBackup(sessions, settings), `ev-tracker-backup-${stamp()}.json`, 'application/json'));
  $('export-csv').addEventListener('click', () =>
    shareOrDownload(toCsv(sessions), `ev-tracker-charges-${stamp()}.csv`, 'text/csv'));

  $('restore-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    let data;
    try { data = readBackup(await readFile(file)); }
    catch (err) { toast(err.message); return; }
    if (!confirm(`Restore ${data.sessions.length} charges from ${data.exportedAt?.slice(0, 10) || 'backup'}?\nThis replaces all charges and settings on this phone.`)) return;
    await db.clearSessions();
    await db.putSessions(data.sessions);
    if (data.settings) await db.saveSettings({ ...db.DEFAULT_SETTINGS, ...data.settings });
    toast('Backup restored');
    location.hash = '#/dashboard';
  });

  $('wipe').addEventListener('click', async () => {
    if (!confirm(`Delete all ${sessions.length} charges? Export a backup first if you might need them.`)) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;
    await db.clearSessions();
    toast('All charges deleted');
    render(root);
  });
}
