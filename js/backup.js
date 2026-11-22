// JSON backup/restore and CSV export.
export const BACKUP_FORMAT = 'ev-tracker-backup';

export function makeBackup(sessions, settings) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), settings, sessions }, null, 1);
}

export function readBackup(text) {
  const data = JSON.parse(text);
  if (data.format !== BACKUP_FORMAT || !Array.isArray(data.sessions)) throw new Error('This is not an EV Tracker backup file.');
  for (const s of data.sessions) {
    if (!s.id || !s.datetime || typeof s.odometerKm !== 'number' || typeof s.energyKwh !== 'number') {
      throw new Error('The backup contains an invalid charge entry.');
    }
  }
  return data;
}

const CSV_COLS = ['datetime', 'odometerKm', 'energyKwh', 'energyEstimated', 'chargerType', 'pricePerKwh', 'totalCostAud',
  'socStart', 'socEnd', 'location', 'durationMin', 'notes', 'source'];

export function toCsv(sessions) {
  const q = v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [...sessions].sort((a, b) => a.datetime.localeCompare(b.datetime));
  return [CSV_COLS.join(','), ...rows.map(s => CSV_COLS.map(c => q(s[c])).join(','))].join('\r\n');
}

// Uses the Android share sheet when it accepts the file, otherwise a normal download.
export async function shareOrDownload(content, filename, type) {
  const blob = new Blob([content], { type });
  const file = new File([blob], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const readFile = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsText(file);
});
