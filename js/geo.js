// GPS position helpers (pure functions are unit-tested).

export const hasCoords = s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && !(s.lat === 0 && s.lon === 0);

// Great-circle distance in metres.
export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The location name of the closest earlier charge within maxM metres, or null.
export function nearestLocationName(sessions, pos, maxM = 150) {
  let best = null;
  for (const s of sessions) {
    if (!s.location || !hasCoords(s)) continue;
    const d = distanceM(pos, s);
    if (d <= maxM && (!best || d < best.d)) best = { d, name: s.location };
  }
  return best?.name ?? null;
}

// Groups charges with coordinates into places: a charge joins the first place within maxM metres.
export function groupPlaces(sessions, maxM = 100) {
  const places = [];
  for (const s of sessions) {
    if (!hasCoords(s)) continue;
    let p = places.find(p => distanceM(p, s) <= maxM);
    if (!p) { p = { lat: s.lat, lon: s.lon, n: 0, kwh: 0, cost: 0, names: {} }; places.push(p); }
    p.n++; p.kwh += s.energyKwh || 0; p.cost += s.totalCostAud || 0;
    if (s.location) p.names[s.location] = (p.names[s.location] || 0) + 1;
  }
  for (const p of places) {
    p.name = Object.entries(p.names).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    delete p.names;
  }
  return places.sort((a, b) => b.n - a.n);
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser has no GPS access.')); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
      err => reject(new Error(
        err.code === 1 ? 'Location permission is off. Allow it in Chrome → Site settings → Location.'
          : err.code === 3 ? 'No GPS fix yet.' : 'Location unavailable.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  });
}
