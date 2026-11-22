// Dashboard: KPIs for the selected period, monthly charts, yearly table.
import * as db from '../db.js';
import * as K from '../kpi.js';
import { barChart, lineChart } from '../charts.js';
import { esc, fmtMoney, fmtNum, fmtPct, fmtPrice, monthLabel, monthShort } from '../util.js';

const PERIODS = [['month', 'This month'], ['year', 'This year'], ['12m', '12 months'], ['all', 'All']];
let period = sessionStorage.getItem('period') || '12m';
let metric = 'cost';

const tile = (label, value, sub = '') => `<div class="tile"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
const line = (label, value) => `<div class="kv"><span>${label}</span><strong>${value}</strong></div>`;

export async function render(root) {
  const [sessions, settings] = await Promise.all([db.getSessions(), db.getSettings()]);
  if (!sessions.length) {
    root.innerHTML = `<div class="card empty"><h1>${esc(settings.vehicleName)}</h1><p>No charges yet.</p>
      <a class="button primary" href="#/add">Add a charge</a><a class="button" href="#/settings">Import from Fuelio</a></div>`;
    return;
  }

  const all = K.withSegments(sessions);
  const range = K.periodRange(period);
  const segs = all.filter(s => K.inRange(s, range));
  const sum = K.summarize(segs);
  const petrol = K.petrolComparison(sum, settings);
  const hab = K.habits(segs);
  const proj = K.projection(all);
  const eff = K.learnedEfficiency(sessions, settings.batteryKwh, settings.defaultEfficiency);
  // Charts always show at least the last 12 months, so "This month" still has context.
  const chartSegs = period === 'month' ? all.filter(s => K.inRange(s, K.periodRange('12m'))) : segs;
  const months = K.groupByMonth(chartSegs);
  const years = K.groupByYear(all);
  const locs = K.groupByLocation(segs).slice(0, 6);
  const freeSaved = sum.avgPrice != null ? sum.freeKwh * sum.avgPrice : null;

  const mix = K.TYPES.map(t => {
    const b = sum.byType[t];
    return `<div class="mix-row"><span class="badge ${t}">${t}</span>
      <div class="mix-bars">
        <div class="bar"><i class="${t}" style="width:${sum.kwh ? (b.kwh / sum.kwh) * 100 : 0}%"></i></div>
        <small>${b.n} charges · ${fmtNum(b.kwh)} kWh (${fmtPct(sum.kwh ? b.kwh / sum.kwh : 0)}) · ${fmtMoney(b.cost)} (${fmtPct(sum.cost ? b.cost / sum.cost : 0)})${t !== 'Free' && b.kwh ? ' · ' + fmtPrice(b.cost / b.kwh) : ''}</small>
      </div></div>`;
  }).join('');

  root.innerHTML = `
  <h1 class="title">${esc(settings.vehicleName)}</h1>
  <div class="chips">${PERIODS.map(([k, l]) => `<button data-p="${k}" class="${k === period ? 'on' : ''}">${l}</button>`).join('')}</div>
  ${segs.length ? '' : '<p class="empty">No charges in this period.</p>'}
  <div class="tiles">
    ${tile('Total cost', fmtMoney(sum.cost))}
    ${tile('Energy', fmtNum(sum.kwh) + ' kWh', sum.estKwh ? `${fmtPct(sum.estKwh / sum.kwh)} estimated` : '')}
    ${tile('Distance', fmtNum(sum.distKm) + ' km')}
    ${tile('Consumption', sum.kwhPer100 == null ? '–' : fmtNum(sum.kwhPer100, 1) + ' <small>kWh/100km</small>')}
    ${tile('Cost per 100 km', fmtMoney(sum.costPer100))}
    ${tile('Avg price paid', fmtPrice(sum.avgPrice), 'excl. free')}
    ${tile('Charges', fmtNum(sum.sessions))}
    ${petrol ? tile('Saved vs petrol', fmtMoney(petrol.saving, true), `petrol: ${fmtMoney(petrol.petrolCost, true)}`) : ''}
  </div>

  <section class="card">
    <div class="card-head"><h2>Per month</h2>
      <div class="seg small">${[['cost', '$'], ['kwh', 'kWh'], ['price', '$/kWh'], ['dist', 'km']].map(([k, l]) => `<button data-m="${k}" class="${k === metric ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div id="chart-month" class="chart"></div>
  </section>

  <section class="card"><h2>Consumption per month</h2><div id="chart-cons" class="chart"></div></section>

  <section class="card"><h2>Charging mix</h2>${mix}
    ${locs.length ? `<h3>By network / location</h3>${locs.map(l => line(esc(l.key), `${fmtMoney(l.cost)} · ${fmtNum(l.kwh)} kWh`)).join('')}` : ''}
  </section>

  <section class="card"><h2>Insights</h2>
    ${line('Free energy', `${fmtNum(sum.freeKwh)} kWh` + (freeSaved != null ? ` ≈ ${fmtMoney(freeSaved)} saved` : ''))}
    ${petrol ? line('Same km in a petrol car', `${fmtMoney(petrol.petrolCost)} (${settings.petrolL100} L/100km at ${fmtMoney(settings.petrolPrice)}/L)`) : ''}
    ${line('Charging efficiency', eff.learned ? `${fmtPct(eff.value)} (${fmtPct(1 - eff.value)} losses, from ${eff.n} charges with SoC)` : `${fmtPct(eff.value)} default · enter SoC on ${K.MIN_EFFICIENCY_SAMPLES - eff.n} more paid charges to learn yours`)}
    ${line('Average per charge', `${fmtNum(hab.avgKwh, 1)} kWh · ${fmtMoney(sum.sessions ? sum.cost / sum.sessions : null)}`)}
    ${line('Between charges', `${fmtNum(hab.avgKmBetween)} km · ${fmtNum(hab.avgDaysBetween, 1)} days`)}
    ${hab.powerKw.AC || hab.powerKw.DC ? line('Average charging power', ['AC', 'DC'].filter(t => hab.powerKw[t]).map(t => `${t} ${fmtNum(hab.powerKw[t], 1)} kW`).join(' · ')) : ''}
    ${proj ? line('Yearly projection', `${fmtMoney(proj.cost, true)} · ${fmtNum(proj.distKm)} km · ${fmtNum(proj.kwh)} kWh${proj.scaled ? ' (scaled from less than a year)' : ''}`) : ''}
    ${settings.gridCo2 > 0 ? line('CO₂ from charging', `${fmtNum(sum.kwh * settings.gridCo2)} kg`) : ''}
  </section>

  <section class="card"><h2>Per year</h2>
    <table class="years"><thead><tr><th>Year</th><th>km</th><th>kWh</th><th>Cost</th><th>$/kWh</th><th>kWh/100</th><th>$/100</th></tr></thead>
    <tbody>${years.map(y => `<tr><td>${y.key}</td><td>${fmtNum(y.distKm)}</td><td>${fmtNum(y.kwh)}</td><td>${fmtMoney(y.cost, true)}</td>
      <td>${y.avgPrice == null ? '–' : '$' + y.avgPrice.toFixed(2)}</td><td>${fmtNum(y.kwhPer100, 1)}</td><td>${fmtMoney(y.costPer100)}</td></tr>`).join('')}</tbody></table>
  </section>`;

  const labels = months.map(m => monthShort(m.key));
  const full = months.map(m => monthLabel(m.key));
  function drawMonth() {
    const el = root.querySelector('#chart-month');
    const cfg = {
      cost: { pick: (m, t) => m.byType[t].cost, fmtAxis: v => '$' + fmtNum(v), fmtValue: v => fmtMoney(v) },
      kwh: { pick: (m, t) => m.byType[t].kwh, fmtAxis: v => fmtNum(v), fmtValue: v => fmtNum(v, 1) + ' kWh' },
    }[metric];
    if (metric === 'price') {
      const typePrice = (m, t) => (m.byType[t].kwh > 0 ? m.byType[t].cost / m.byType[t].kwh : null);
      lineChart(el, {
        labels, fullLabels: full, values: months.map(m => m.avgPrice),
        fmtAxis: v => '$' + v.toFixed(2), fmtValue: fmtPrice,
        caption: 'Average price paid per kWh, free charges excluded. Dashed line = average of the months.',
        describe: i => {
          const m = months[i];
          if (m.avgPrice == null) return `${full[i]}: no paid charges`;
          const parts = ['AC', 'DC'].filter(t => typePrice(m, t) != null).map(t => `${t} ${fmtPrice(typePrice(m, t))}`);
          return `${full[i]}: ${fmtPrice(m.avgPrice)} average${parts.length > 1 ? ' · ' + parts.join(' · ') : ''}`;
        },
      });
      return;
    }
    if (metric === 'dist') {
      barChart(el, { labels, fullLabels: full, series: [{ name: 'km', cls: 'km', values: months.map(m => m.distKm) }],
        fmtAxis: v => fmtNum(v), fmtValue: v => fmtNum(v) + ' km', caption: 'Distance driven per month. Tap a bar for details.' });
      return;
    }
    barChart(el, {
      labels, fullLabels: full,
      series: K.TYPES.map(t => ({ name: t, cls: t, values: months.map(m => cfg.pick(m, t)) })),
      fmtAxis: cfg.fmtAxis, fmtValue: cfg.fmtValue, caption: 'Tap a bar for details.',
    });
  }
  drawMonth();
  lineChart(root.querySelector('#chart-cons'), {
    labels, fullLabels: full, values: months.map(m => (m.distKm >= 50 ? m.kwhPer100 : null)),
    fmtAxis: v => fmtNum(v), fmtValue: v => fmtNum(v, 1) + ' kWh/100km',
    caption: 'kWh/100 km. Dashed line = average. Months under 50 km are skipped.',
  });

  root.querySelectorAll('.chips button').forEach(b => b.addEventListener('click', () => {
    period = b.dataset.p; sessionStorage.setItem('period', period); render(root);
  }));
  root.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
    metric = b.dataset.m;
    root.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b));
    drawMonth();
  }));
}
