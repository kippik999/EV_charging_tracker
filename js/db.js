// IndexedDB storage: one store for charge sessions, one key-value store for settings.
const DB_NAME = 'ev-tracker';
const DB_VERSION = 1;

export const DEFAULT_SETTINGS = {
  vehicleName: 'EV3',
  batteryKwh: 82,
  defaultEfficiency: 0.9,   // battery kWh gained / kWh billed, used until learned from data
  dcCutoff: 0.55,           // $/kWh at or above which an imported charge is guessed as DC
  petrolPrice: 2.0,         // $/L, for the "savings vs petrol" comparison
  petrolL100: 7.0,          // L/100 km of the petrol car you compare against
  gridCo2: null,            // kg CO2 per kWh, optional
  lastType: 'AC',
  lastPrice: { AC: null, DC: null },
};

let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const getSessions = () => tx('sessions', 'readonly', s => s.getAll());
export const putSession = session => tx('sessions', 'readwrite', s => { s.put(session); });
export const putSessions = list => tx('sessions', 'readwrite', s => { list.forEach(x => s.put(x)); });
export const deleteSession = id => tx('sessions', 'readwrite', s => { s.delete(id); });
export const clearSessions = () => tx('sessions', 'readwrite', s => { s.clear(); });

export async function getSettings() {
  const saved = await tx('kv', 'readonly', s => s.get('settings'));
  return { ...DEFAULT_SETTINGS, ...(saved || {}), lastPrice: { ...DEFAULT_SETTINGS.lastPrice, ...(saved?.lastPrice || {}) } };
}
export const saveSettings = settings => tx('kv', 'readwrite', s => { s.put(settings, 'settings'); });
