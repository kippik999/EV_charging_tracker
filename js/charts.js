// Small dependency-free SVG charts. Tap a bar or point to see its values in the caption.
import { esc } from './util.js';

const W = 360, H = 190, PAD = { l: 40, r: 8, t: 10, b: 24 };

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function axes(max, fmtAxis) {
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    const y = PAD.t + (H - PAD.t - PAD.b) * (1 - i / 4);
    g += `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/>`;
    g += `<text class="axis" x="${PAD.l - 4}" y="${y + 3}" text-anchor="end">${esc(fmtAxis(v))}</text>`;
  }
  return g;
}

function xLabels(labels, x) {
  const step = Math.ceil(labels.length / 12);
  return labels.map((l, i) => (i % step ? '' : `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`)).join('');
}

function wire(el, caption, describe) {
  const cap = el.querySelector('.chart-caption');
  cap.textContent = caption;
  el.querySelectorAll('[data-i]').forEach(node =>
    node.addEventListener('click', () => {
      el.querySelectorAll('.sel').forEach(n => n.classList.remove('sel'));
      el.querySelectorAll(`[data-i="${node.dataset.i}"]`).forEach(n => n.classList.add('sel'));
      cap.textContent = describe(+node.dataset.i);
    }));
}

// series: [{name, cls, values[]}], stacked
export function barChart(el, { labels, series, fmtAxis, fmtValue, caption, fullLabels = labels }) {
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const slot = plotW / Math.max(n, 1);
  const bw = Math.max(2, slot * 0.7);
  const x = i => PAD.l + slot * i + slot / 2;
  let bars = '';
  labels.forEach((_, i) => {
    let y0 = PAD.t + plotH;
    for (const s of series) {
      const v = s.values[i] || 0;
      if (v <= 0) continue;
      const h = (v / max) * plotH;
      y0 -= h;
      bars += `<rect class="${s.cls}" data-i="${i}" x="${x(i) - bw / 2}" y="${y0}" width="${bw}" height="${h}"/>`;
    }
    bars += `<rect class="hit" data-i="${i}" x="${x(i) - slot / 2}" y="${PAD.t}" width="${slot}" height="${plotH}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${axes(max, fmtAxis)}${bars}${xLabels(labels, x)}</svg>
    <div class="legend">${series.length > 1 ? series.map(s => `<span><i class="${s.cls}"></i>${esc(s.name)}</span>`).join('') : ''}</div>
    <div class="chart-caption"></div>`;
  wire(el, caption, i => `${fullLabels[i]}: ` + (series.length > 1
    ? series.map(s => `${s.name} ${fmtValue(s.values[i] || 0)}`).join(' · ') + ` · total ${fmtValue(totals[i])}`
    : fmtValue(totals[i])));
}

export function lineChart(el, { labels, values, fmtAxis, fmtValue, caption, fullLabels = labels, cls = 'line-a', describe }) {
  const vals = values.filter(v => v != null);
  const max = niceMax(Math.max(0, ...vals) * 1.1);
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const slot = plotW / Math.max(labels.length, 1);
  const x = i => PAD.l + slot * i + slot / 2;
  const y = v => PAD.t + plotH * (1 - v / max);
  let path = '', pen = false, dots = '';
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${x(i)},${y(v)} `;
    pen = true;
    dots += `<circle class="${cls}" data-i="${i}" cx="${x(i)}" cy="${y(v)}" r="3.5"/>`;
    dots += `<rect class="hit" data-i="${i}" x="${x(i) - slot / 2}" y="${PAD.t}" width="${slot}" height="${plotH}"/>`;
  });
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${axes(max, fmtAxis)}
    ${avg != null ? `<line class="avg" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(avg)}" y2="${y(avg)}"/>` : ''}
    <path class="${cls} stroke" d="${path}"/>${dots}${xLabels(labels, x)}</svg>
    <div class="chart-caption"></div>`;
  wire(el, caption, describe || (i => `${fullLabels[i]}: ${values[i] == null ? 'no data' : fmtValue(values[i])}`));
}
