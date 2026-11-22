// Hash router + app start-up.
import * as dashboard from './views/dashboard.js';
import * as add from './views/add.js';
import * as history from './views/history.js';
import * as settings from './views/settings.js';
import { esc } from './util.js';

const routes = { dashboard, add, edit: add, history, settings };
const main = document.getElementById('main');

async function route() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const key = routes[name] ? name : 'dashboard';
  const tab = key === 'edit' ? 'history' : key;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  main.innerHTML = '';
  window.scrollTo(0, 0);
  try {
    await routes[key].render(main, { arg: rest.length ? decodeURIComponent(rest.join('/')) : null });
  } catch (err) {
    console.error(err);
    main.innerHTML = `<p class="error">Something went wrong: ${esc(err.message)}</p>`;
  }
}

window.addEventListener('hashchange', route);
route();

// Ask the browser not to evict our data (granted automatically for installed apps on Android).
navigator.storage?.persist?.();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // updateViaCache 'none': always check GitHub for a new sw.js, ignoring the browser's HTTP cache.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(err => console.warn('Service worker not registered', err));
  // When a new version takes over, reload once so it shows right away (not on the first install).
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
}
