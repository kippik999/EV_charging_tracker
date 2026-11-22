// Heatmap of charging places on an OpenStreetMap background (Leaflet + Leaflet.heat, loaded on first use).
import { esc, fmtMoney, fmtNum } from './util.js';

const vendor = f => new URL('./vendor/' + f, import.meta.url).href;
let loading, current;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

function loadLeaflet() {
  if (!loading) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = vendor('leaflet.css');
    document.head.append(css);
    loading = loadScript(vendor('leaflet.js')).then(() => loadScript(vendor('leaflet-heat.js')))
      .catch(e => { loading = null; throw e; });
  }
  return loading;
}

// places: output of geo.groupPlaces(). Intensity follows the number of charges at each place.
export async function heatMap(el, places) {
  await loadLeaflet();
  const L = window.L;
  current?.remove();
  if (!el.isConnected) return;
  const map = L.map(el, { scrollWheelZoom: false });
  current = map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const maxN = Math.max(...places.map(p => p.n));
  L.heatLayer(places.map(p => [p.lat, p.lon, p.n]), {
    // maxZoom 0 = don't fade the heat when zoomed out (the plugin's default dims it 2× per zoom level).
    max: maxN, radius: 26, blur: 18, minOpacity: 0.55, maxZoom: 0,
    gradient: { 0.2: '#2563eb', 0.45: '#22c55e', 0.7: '#facc15', 1: '#dc2626' },
  }).addTo(map);

  // Tappable dots for the details, shown once zoomed in far enough to tell places apart.
  const dots = L.layerGroup(places.map(p => L.circleMarker([p.lat, p.lon], {
    radius: 7, weight: 2, color: '#fff', fillColor: '#0f766e', fillOpacity: 0.9,
  }).bindPopup(`<strong>${esc(p.name || 'Unnamed place')}</strong><br>${p.n} charge${p.n > 1 ? 's' : ''} · ${fmtNum(p.kwh)} kWh · ${fmtMoney(p.cost)}`)));
  const toggleDots = () => (map.getZoom() >= 12 ? dots.addTo(map) : dots.remove());
  map.on('zoomend', toggleDots);

  const bounds = L.latLngBounds(places.map(p => [p.lat, p.lon]));
  map.fitBounds(bounds.pad(0.15), { maxZoom: 14 });
  toggleDots();
}
