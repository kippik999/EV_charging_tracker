const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const money0 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

export const fmtMoney = (x, whole = false) => (x == null || isNaN(x) ? '–' : (whole ? money0 : money).format(x));
export const fmtNum = (x, digits = 0) =>
  x == null || isNaN(x) ? '–' : x.toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (x, digits = 0) => (x == null || isNaN(x) ? '–' : fmtNum(x * 100, digits) + '%');
export const fmtPrice = x => (x == null || isNaN(x) ? '–' : '$' + x.toFixed(Math.round(x * 1000) % 10 ? 3 : 2) + '/kWh');

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = key => `${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
export const monthShort = key => MONTHS[+key.slice(5, 7) - 1];

export function fmtDateTime(dt) {
  const d = new Date(dt);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Reads a number from an input; accepts a comma as decimal separator. Empty -> null.
export function readNum(input) {
  const v = input.value.trim().replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return isNaN(n) ? NaN : n;
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
