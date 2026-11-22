// In-memory stand-in for js/db.js, used by tests/ui.html (headless browsers here can't open IndexedDB).
// Preloaded with the Fuelio export from ../../Input.
import { parseFuelio } from '../js/fuelio.js';

export const DEFAULT_SETTINGS = {
  vehicleName: 'EV3', batteryKwh: 82, defaultEfficiency: 0.9, dcCutoff: 0.55, petrolPrice: 2.0, petrolL100: 7.0,
  gridCo2: null, lastType: 'AC', lastPrice: { AC: 0.45, DC: 0.79 },
};
const store = new Map();
let settings = structuredClone(DEFAULT_SETTINGS);
try {
  const res = await fetch(new URL('../../Input/EV3-1-2026-11-21_21-13.csv', import.meta.url));
  if (res.ok) parseFuelio(await res.text()).sessions.forEach(s => store.set(s.id, s));
} catch { /* start empty */ }
// ui.html?geo=1 gives the imported charges made-up positions around Sydney, to preview the heatmap.
if (new URLSearchParams(location.search).has('geo')) {
  const spots = [[-33.7969, 151.1810, 'Home'], [-33.7969, 151.1810, 'Home'], [-33.7969, 151.1810, 'Home'], [-33.8615, 151.2090, 'Work'],
    [-33.8615, 151.2090, 'Work'], [-33.8180, 151.0030, 'Parramatta DC'], [-33.9470, 151.1460, 'Airport DC'], [-34.4250, 150.8930, 'Wollongong']];
  [...store.values()].forEach((s, i) => {
    const [lat, lon, name] = spots[i % spots.length];
    Object.assign(s, { lat: lat + (i % 3) * 0.0002, lon, location: s.location || name });
  });
  // Fake GPS fix ~30 m from "Home".
  Object.defineProperty(navigator, 'geolocation', { value: {
    getCurrentPosition: ok => setTimeout(() => ok({ coords: { latitude: -33.7971, longitude: 151.1812, accuracy: 8 } }), 300),
  } });
}

const clone = x => structuredClone(x);
export const newId = () => 'mem-' + Math.random().toString(36).slice(2);
export const getSessions = async () => [...store.values()].map(clone);
export const putSession = async s => { store.set(s.id, clone(s)); };
export const putSessions = async list => list.forEach(s => store.set(s.id, clone(s)));
export const deleteSession = async id => { store.delete(id); };
export const clearSessions = async () => store.clear();
export const getSettings = async () => clone(settings);
export const saveSettings = async s => { settings = clone(s); };
