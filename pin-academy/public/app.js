// GoGo Academy front end. Plain JS. All user text goes in with textContent, never innerHTML.
import { cleanTranscript } from './clean.js';
const $view = document.getElementById('view');
const $tabs = document.getElementById('tabs');
const $who = document.getElementById('who');

let ME = null, CONFIG = {}, mapsReady = null;
// Pin skills: every call is grouped by the situation it teaches. The list (with a tip for each) comes from the server.
const SKILLS = () => (CONFIG.pinSkills || []).map((k) => k.name).filter((k) => k !== 'Other'); // Vee: no "Other" to pick
const skillAt = (name) => { const i = SKILLS().indexOf(name); return i < 0 ? 999 : i; };
const bySkill = (a, b) => skillAt(a.category) - skillAt(b.category) || a.title.localeCompare(b.title);
// One colour per pin skill, so the practice page reads at a glance.
const catColour = (cat) => `--c: var(--c${(Math.max(0, SKILLS().indexOf(cat)) % 6) + 1})`;
const STOP_NAME = { pickup: 'Start Address (pickup)', dropoff: 'End Address (drop-off)' };
// Same colours as the dashboard: pickup lime green, drop-off pink.
const PIN_COLOUR = { pickup: ['#8cc63e', '#55801e'], dropoff: ['#e8336d', '#a3164a'] };
const SUGGESTED_QUESTIONS = [
  'Which business or building are you at?', 'Which entrance or side of the building will you be at?',
  'What are you wearing, so the driver can spot you?', 'Have you had any trouble being picked up there before?',
];

// ── tiny helpers ─────────────────────────────────────────────────────
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const mount = (...kids) => { $view.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); window.scrollTo(0, 0); };

function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3200);
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401) return location.reload(); throw new Error(data.error || 'Something went wrong.'); }
  return data;
}
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const m = (n) => (n == null ? '–' : `${Math.round(n * 10) / 10} m`);
const when = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

// ── Google Maps ──────────────────────────────────────────────────────
function loadMaps() {
  if (mapsReady) return mapsReady;
  if (!CONFIG.mapsKey) return (mapsReady = Promise.resolve(false));
  mapsReady = new Promise((resolve) => {
    window.__gmReady = () => resolve(true);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CONFIG.mapsKey)}&v=weekly&loading=async&callback=__gmReady`;
    s.async = true; s.onerror = () => resolve(false);
    document.head.append(s);
    window.gm_authFailure = () => toast('Google Maps rejected the key. Check the key settings.', true);
  });
  return mapsReady;
}
const ll = (p) => (p ? { lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng } : null);
const noMap = () => h('div', { class: 'pm nomap' }, 'The map is not connected yet. It switches on once the Google Maps key is added in Railway.');

// Turns a plain text box into the dashboard's address box: Google's suggestions drop down underneath as you type
// (an address, or a business name like "Men..."). Calls onPick({ lat, lng, name, address, street, city, state, zip, placeId }).
async function addressSearch(input, onPick) {
  const wrap = h('div', { class: 'ac-wrap' });
  input.replaceWith(wrap); wrap.append(input);
  if (!(await loadMaps())) { input.placeholder = 'Search is off until the map is connected'; return; }
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary('places');
  let token = new AutocompleteSessionToken(), timer = null, seq = 0;
  const list = h('div', { class: 'ac-list' });
  wrap.append(list);
  const close = () => list.replaceChildren();
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) return close();
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: q, sessionToken: token, includedRegionCodes: ['us'] });
        if (mine !== seq) return;
        list.replaceChildren(...suggestions.filter((s) => s.placePrediction).map((s) => {
          const p = s.placePrediction;
          return h('div', { class: 'ac-item', onmousedown: (e) => { e.preventDefault(); pick(p); } },
            h('span', { class: 'ac-pin' }), h('b', {}, p.mainText?.text || p.text.text), ' ', h('span', { class: 'muted' }, p.secondaryText?.text || ''));
        }), suggestions.length ? h('div', { class: 'ac-foot' }, 'powered by Google') : null);
      } catch { close(); }
    }, 220);
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  async function pick(prediction) {
    close();
    const place = prediction.toPlace();
    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'addressComponents', 'id'] });
    token = new AutocompleteSessionToken();
    const part = (type, short) => { const c = (place.addressComponents || []).find((x) => x.types.includes(type)); return c ? (short ? c.shortText : c.longText) : ''; };
    const street = [part('street_number'), part('route')].filter(Boolean).join(' ');
    input.value = street || place.displayName || '';
    onPick({ ...ll(place.location), name: place.displayName || '', address: place.formattedAddress || '', street,
      city: part('locality') || part('sublocality') || part('postal_town'), state: part('administrative_area_level_1', true), zip: part('postal_code'), placeId: place.id || '' });
  }
}
// Admin pages use the same search, in a fresh box.
async function placeSearch(host, onPick) {
  const input = h('input', { type: 'text', placeholder: 'Type an address or a business name' });
  host.append(input);
  addressSearch(input, onPick);
}

// Laid out like the GoGo dashboard's Location Map: Street View on top, satellite map below, legend underneath.
// Grey = where Google put it ("Original"), green/pink = the pin you move, blue numbered = entrances.
async function pinMap(host, { start, kind = 'pickup', draggable = true, onMove, onUserMove, entrances = [], onEntrance } = {}) {
  if (!(await loadMaps())) { host.append(noMap()); return null; }
  const [{ Map, Polyline }, { AdvancedMarkerElement, PinElement }, { StreetViewPanorama, StreetViewService }] = await Promise.all(
    ['maps', 'marker', 'streetView'].map((l) => google.maps.importLibrary(l)));
  const mapDiv = h('div', { class: 'pm-map' }), panoDiv = h('div', { class: 'pm-pano' });
  const sv = h('span', { class: 'tag' }, 'Street View: –');
  const labels = h('input', { type: 'checkbox', checked: true });
  const segMap = h('button', {}, 'Map'), segSat = h('button', { class: 'on' }, 'Satellite');
  const dot = (c) => h('span', { class: 'dot', style: `background:${c}` });
  const [col, edge] = PIN_COLOUR[kind] || PIN_COLOUR.pickup;
  host.append(h('div', { class: 'pm' },
    h('div', { class: 'pm-bar' }, 'Location Map', h('span', { class: 'grow' }), sv),
    panoDiv, mapDiv,
    h('div', { class: 'pm-legend' }, h('span', {}, kind === 'dropoff' ? 'Drop-off:' : 'Pickup:', dot(col)), h('span', {}, 'Original:', dot('#9a9aa8')),
      h('span', {}, 'Entrances:', dot('#3d9df5')),
      h('span', { class: 'grow' }), h('div', { class: 'seg' }, segMap, segSat), h('label', { class: 'check', style: 'margin:0' }, labels, 'Labels'))));

  const pano = new StreetViewPanorama(panoDiv, { addressControl: false, fullscreenControl: true, motionTracking: false, visible: true });
  // The bottom map keeps its own little yellow man, like the dashboard: drop him on the map to walk around there.
  // Wherever you walk at the bottom, the top view follows.
  const map = new Map(mapDiv, { center: start, zoom: 19, mapId: CONFIG.mapId, mapTypeId: 'hybrid',
    gestureHandling: 'greedy', mapTypeControl: false, clickableIcons: false, tilt: 0, streetViewControl: true });
  const bottomSv = map.getStreetView();
  bottomSv.addListener('position_changed', () => { if (bottomSv.getVisible() && bottomSv.getPosition()) pano.setPosition(bottomSv.getPosition()); });
  bottomSv.addListener('pov_changed', () => { if (bottomSv.getVisible()) pano.setPov(bottomSv.getPov()); });
  const original = new AdvancedMarkerElement({ map, position: start, content: new PinElement({ background: '#9a9aa8', borderColor: '#6e6e7c', glyphColor: '#fff', scale: 0.85 }).element, title: 'Original', zIndex: 1 });
  const marker = new AdvancedMarkerElement({ map, position: start, gmpDraggable: draggable, content: new PinElement({ background: col, borderColor: edge, glyphColor: '#fff', scale: 1.35 }).element, title: kind, zIndex: 3 });
  const svService = new StreetViewService();
  let extras = [], entranceMarkers = [];

  const setType = () => map.setMapTypeId(segSat.classList.contains('on') ? (labels.checked ? 'hybrid' : 'satellite') : 'roadmap');
  segMap.onclick = () => { segMap.classList.add('on'); segSat.classList.remove('on'); labels.disabled = true; setType(); };
  segSat.onclick = () => { segSat.classList.add('on'); segMap.classList.remove('on'); labels.disabled = false; setType(); };
  labels.onchange = setType;

  function lookAt(pos) {
    svService.getPanorama({ location: pos, radius: 60 }, (data, status) => {
      if (status !== 'OK') { sv.textContent = 'Street View: none nearby'; sv.className = 'tag warn'; return; }
      pano.setPosition(data.location.latLng);
      pano.setPov({ heading: headingTo(ll(data.location.latLng), pos), pitch: 0 });
      sv.textContent = 'Street View: facing the pin'; sv.className = 'tag pass';
    });
  }
  const moved = () => { const p = ll(marker.position); lookAt(p); onMove && onMove(p); };
  const userMoved = () => { moved(); onUserMove && onUserMove(ll(marker.position)); };
  marker.addListener('dragend', userMoved);
  map.addListener('click', (e) => { if (!draggable) return; marker.position = e.latLng; userMoved(); });

  function setEntrances(list) {
    entranceMarkers.forEach((x) => (x.map = null));
    entranceMarkers = list.map((e, i) => {
      const mk = new AdvancedMarkerElement({ map, position: { lat: e.lat, lng: e.lng }, title: e.name, zIndex: 2,
        content: new PinElement({ background: '#3d9df5', borderColor: '#1f6fb8', glyph: String(i + 1), glyphColor: '#fff', scale: 0.95 }).element });
      mk.addListener('click', () => { if (!draggable) return; marker.position = { lat: e.lat, lng: e.lng }; userMoved(); onEntrance && onEntrance(i); });
      return mk;
    });
  }
  setEntrances(entrances);
  lookAt(start);

  return {
    map, setEntrances,
    getPin: () => ll(marker.position),
    setPin(p, center = true) { marker.position = p; if (center) map.setCenter(p); lookAt(p); onMove && onMove(p); },
    setOriginal(p) { original.position = p; },
    lock() { marker.gmpDraggable = false; draggable = false; },
    showAnswer(answer, mine) {
      const ok = new PinElement({ background: '#1e8a4c', borderColor: '#0f5a30', glyph: '✓', glyphColor: '#fff' });
      extras.push(new AdvancedMarkerElement({ map, position: answer, content: ok.element, title: 'Right spot', zIndex: 5 }));
      if (mine) extras.push(new Polyline({ map, path: [mine, answer], strokeColor: '#d64545', strokeOpacity: .9, strokeWeight: 3 }));
      const b = new google.maps.LatLngBounds(); b.extend(answer); if (mine) b.extend(mine);
      map.fitBounds(b, 80); if (map.getZoom() > 20) map.setZoom(20);
      lookAt(answer);
    },
  };
}
function headingTo(a, b) {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

// ── shell: sign-in, tabs ─────────────────────────────────────────────
const TRAINEE_TABS = [['practice', 'Practice'], ['tests', 'Tests'], ['progress', 'My progress']];
const ADMIN_TABS = [['a-scenarios', 'Scenarios'], ['a-tests', 'Practice & tests'], ['a-results', 'Results'], ['a-people', 'People & classes']];
const AFTER_KEY = 'pa_after_login';
const remember = (hash) => { try { localStorage.setItem(AFTER_KEY, hash); } catch {} };
const recall = () => { try { const v = localStorage.getItem(AFTER_KEY); localStorage.removeItem(AFTER_KEY); return v; } catch { return null; } };

function drawShell(active) {
  $tabs.replaceChildren();
  $who.replaceChildren();
  if (!ME) return;
  const tab = ([id, name]) => h('button', { class: id === active ? 'on' : '', onclick: () => go(id) }, name);
  // Operators see their tabs; admins see theirs, and can switch to the trainee view to see what operators see.
  const asTrainee = ME.role === 'admin' && VIEW_AS === 'trainee';
  if (ME.role !== 'admin' || asTrainee) $tabs.append(...TRAINEE_TABS.map(tab));
  else $tabs.append(...ADMIN_TABS.map(([id, name]) => (id === 'a-people' ? peopleMenu(active) : tab([id, name]))));
  if (ME.role === 'admin') {
    const sw = (v, label) => h('button', { class: `view-btn ${VIEW_AS === v ? 'on' : ''}`, onclick: () => { VIEW_AS = v; try { sessionStorage.setItem('pa_view', v); } catch {} go(v === 'trainee' ? 'home' : 'a-scenarios'); } }, label);
    $who.append(h('span', { class: 'view-switch' }, sw('admin', 'Admin view'), sw('trainee', 'Trainee view')));
  }
  $who.append(h('span', {}, ME.name, ME.className ? ` · ${ME.className}` : '', ME.role === 'admin' ? ' · Admin' : ''),
    h('button', { onclick: safe(async () => { await api('/auth/logout', {}); location.href = '/'; }) }, 'Sign out'));
}

function go(id) { history.replaceState(null, '', `#${id}`); render(id); }

async function boot() {
  // The logo opens the GoGo Academy home page.
  const brand = document.querySelector('.brand'); if (brand) { brand.style.cursor = 'pointer'; brand.onclick = () => ME && go('home'); }
  const me = await api('/api/me');
  ME = me.user; CONFIG = me;
  const err = new URLSearchParams(location.search).get('error');
  if (err) { history.replaceState(null, '', '/'); toast(err, true); }
  const hash = location.hash.slice(1) || recall() || '';
  if (!ME) { if (hash) remember(hash); return drawLogin(me); }
  // A class link (/class/october-2026 → #class-october-2026, or an older #t-12) puts someone with no class into that class.
  if (/^(t-\d+|join-(practice|test)-[a-z0-9-]+)$/.test(hash)) return render(hash);
  if (!ME.classId && ME.role !== 'admin') return drawClassPicker();
  render(hash || 'home');
}

function drawLogin(me) {
  drawShell();
  const box = h('div', { class: 'card login' },
    h('img', { src: '/brand/pin-heart.png', height: 64, alt: '' }),
    h('h1', {}, 'GoGo Academy'),
    h('p', { class: 'lead' }, 'Practise real calls on a copy of Ride Ordering: find the right place, put the pin on the right spot, and write a note the driver can use.'),
    h('div', { class: 'chips' }, h('span', {}, 'Street View'), h('span', {}, 'Satellite'), h('span', {}, 'Pin tests'), h('span', {}, 'Your progress')),
    me.slackReady
      ? h('a', { class: 'slackbtn', href: '/auth/slack', onclick: () => location.hash && remember(location.hash.slice(1)) }, slackLogo(), 'Sign in with Slack')
      : h('p', { class: 'tag warn' }, 'Slack sign-in is not switched on yet.'));
  if (me.devLogin) {
    const id = h('input', { type: 'text', placeholder: 'Slack ID', value: 'UDEVTRAINEE' });
    const nm = h('input', { type: 'text', placeholder: 'Name', value: 'Test Trainee' });
    const ad = h('input', { type: 'checkbox' });
    box.append(h('hr'), h('p', { class: 'small muted' }, 'Local testing only (hidden on the live site)'), id, nm,
      h('label', { class: 'check' }, ad, 'Admin'),
      h('button', { class: 'btn ghost', onclick: () => (location.href = `/auth/dev?as=${encodeURIComponent(id.value)}&name=${encodeURIComponent(nm.value)}${ad.checked ? '&role=admin' : ''}`) }, 'Test sign-in'));
  }
  mount(box);
}
function slackLogo() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '22'); s.setAttribute('height', '22');
  [['#E01E5A', 'M5 15a2 2 0 1 1-2-2h2v2zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5z'], ['#36C5F0', 'M8 5a2 2 0 1 1 2-2v2H8zm0 1a2 2 0 1 1 0 4H3a2 2 0 1 1 0-4h5z'],
    ['#2EB67D', 'M19 9a2 2 0 1 1 2 2h-2V9zm-1 0a2 2 0 1 1-4 0V4a2 2 0 1 1 4 0v5z'], ['#ECB22E', 'M15 19a2 2 0 1 1-2 2v-2h2zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5z']]
    .forEach(([c, d]) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('fill', c); p.setAttribute('d', d); s.append(p); });
  return s;
}

async function drawClassPicker() {
  drawShell();
  const classes = await api('/api/classes');
  const sel = h('select', {}, h('option', { value: '' }, 'Choose your class…'), classes.map((c) => h('option', { value: c.id }, c.name)));
  mount(h('div', { class: 'card login' }, h('h1', {}, `Welcome, ${ME.name}`),
    h('p', { class: 'lead' }, 'Your trainer usually sends you a link that puts you in your class. No link? Pick your class here. You only do this once.'),
    classes.length ? sel : h('p', { class: 'tag warn' }, 'No class is open yet. Ask your trainer.'),
    h('p'), h('button', { class: 'btn', onclick: safe(async () => {
      if (!sel.value) return toast('Pick your class first.', true);
      ME = (await api('/api/me/class', { classId: Number(sel.value) })).user; go('practice');
    }) }, 'Continue')));
}

const VIEWS = {};
let VIEW_AS = (() => { try { return sessionStorage.getItem('pa_view') || 'admin'; } catch { return 'admin'; } })();

// "People & classes": hover for Admins, Classes ▸ (+ Add a class, then each class) and Archive ▸ (Vee, 2026-10-07).
function peopleMenu(active) {
  const list = h('div', { class: 'menu-list' }, h('div', { class: 'small muted pad-s' }, 'Loading…'));
  let loaded = false;
  const load = async () => {
    if (loaded) return; loaded = true;
    const classes = await api('/api/admin/classes');
    const live = classes.filter((c) => !c.archived), old = classes.filter((c) => c.archived);
    const item = (label, to) => h('button', { class: 'menu-item', onclick: () => go(to) }, label);
    const sub = (label, kids) => h('div', { class: 'menu-sub' }, h('button', { class: 'menu-item' }, label), h('div', { class: 'menu-list sub' }, kids));
    list.replaceChildren(item('Admins', 'a-admins'),
      sub('Classes ▸', [item('+ Add a class', 'a-class-new'), live.length ? h('div', { class: 'menu-sep' }) : null, ...live.map((c) => item(c.name, `a-class-${c.id}`))]),
      sub(`Archive (${old.length}) ▸`, old.length ? old.map((c) => item(c.name, `a-class-${c.id}`)) : [h('div', { class: 'small muted pad-s' }, 'Nothing archived yet.')]));
  };
  const wrap = h('div', { class: 'menu', onmouseenter: () => load().catch(() => {}) },
    h('button', { class: active === 'a-people' || active?.startsWith?.('a-class') || active === 'a-admins' ? 'on' : '', onclick: () => go('a-admins') }, 'People & classes ▾'), list);
  return wrap;
}

// Add a class (from People & classes ▸ Classes ▸ + Add a class).
VIEWS['a-class-new'] = async () => {
  const nm = h('input', { type: 'text', placeholder: 'e.g. December 2026' });
  mount(h('h1', {}, 'Add a class'), h('p', { class: 'lead' }, 'It gets a practice link and a test link, both ending with its name.'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, nm),
      h('button', { class: 'btn', onclick: safe(async () => { const r = await api('/api/admin/classes', { name: nm.value }); toast('Class added'); go(`a-class-${r.id}`); }) }, 'Add class'))));
};
// The old all-in-one page now opens Admins (Vee: one class at a time, from the menu).
VIEWS['a-people'] = async () => go('a-admins');

// Admins only.
VIEWS['a-admins'] = async () => {
  const people = (await api('/api/admin/people')).filter((p) => p.role === 'admin');
  mount(h('h1', {}, 'Admins'), h('p', { class: 'lead' }, 'You, Oscar and anyone given admin access. Your own practice is never counted in a class.'),
    h('div', { class: 'card' }, peopleTable(people, { showClass: false })));
};

// Name, Slack ID, practice, tests and every sign-in (Vee, 2026-10-07). Practice can be done many times; a test once.
function peopleTable(list, { classes = [], showClass = true } = {}) {
  return h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Slack ID'), h('th', {}, 'Practice calls'), h('th', {}, 'Calls got right'),
    h('th', {}, 'Tests handed in'), showClass ? h('th', {}, 'Class') : null, h('th', {}, 'Role'), h('th', {}, 'Sign-ins')),
    list.map((p) => {
      const c = h('select', { onchange: safe(async () => { await api('/api/admin/people', { slackId: p.slack_id, classId: c.value ? Number(c.value) : null }); toast('Class updated'); }) },
        h('option', { value: '' }, '–'), classes.filter((k) => !k.archived || k.id === p.class_id).map((k) => h('option', { value: k.id, selected: k.id === p.class_id }, k.name)));
      const r = h('select', { onchange: safe(async () => { await api('/api/admin/people', { slackId: p.slack_id, role: r.value }); toast('Role updated'); }) },
        ['trainee', 'admin'].map((x) => h('option', { value: x, selected: x === p.role }, x === 'admin' ? 'Admin' : 'Trainee')));
      const times = h('div', { class: 'small muted' });
      const signins = h('details', { ontoggle: async (e) => { if (!e.target.open || times.childElementCount) return;
        const at = await api(`/api/admin/people/${p.slack_id}/logins`); times.replaceChildren(...at.map((t) => h('div', {}, when(t)))); } },
        h('summary', {}, `${p.logins} · last ${when(p.last_login)}`), times);
      // Every practice try, opened on demand: when, which call, pin and call flow.
      const triesBox = h('div', { class: 'small' });
      const tries = !p.practice_tries ? '0' : h('details', { ontoggle: async (e) => { if (!e.target.open || triesBox.childElementCount) return;
        const list = await api(`/api/admin/people/${p.slack_id}/practice`);
        const mark = (v) => (v == null ? '–' : v ? '✓' : '✗');
        triesBox.replaceChildren(...list.map((t) => h('div', { class: t.passed ? '' : 'muted' }, `${when(t.at)} · ${t.title} · Pin ${mark(t.pin)} · Call flow ${mark(t.callFlow)}`))); } },
        h('summary', {}, `${p.practice_tries}`), triesBox);
      return h('tr', {}, h('td', {}, p.name), h('td', {}, h('code', { class: 'small' }, p.slack_id)), h('td', {}, tries), h('td', {}, p.practice_right),
        h('td', {}, p.tests_done), showClass ? h('td', {}, c) : null, h('td', {}, r), h('td', {}, signins));
    }));
}

// One class: its two links, its trainees, and its controls (rename, close, archive after 6 months, delete).
async function classAdminPage(id) {
  const [classes, people, tests] = await Promise.all([api('/api/admin/classes'), api('/api/admin/people'), api('/api/admin/tests')]);
  const c = classes.find((k) => k.id === id);
  if (!c) return mount(h('div', { class: 'card' }, 'That class no longer exists.'));
  const mine = people.filter((p) => p.class_id === id && p.role !== 'admin');
  const nm = h('input', { type: 'text', value: c.name });
  const linkRow = (mode) => h('div', { class: 'row', style: 'margin-top:6px' }, h('b', { style: 'min-width:80px' }, mode === 'test' ? 'Test' : 'Practice'),
    h('code', { class: 'small grow' }, classLink(c.slug, mode)), h('button', { class: 'btn ghost small', onclick: copyClassLink(c.slug, mode) }, `Copy ${mode} link`));
  const open = tests.filter((t) => t.class_id === id && t.status === 'open');
  mount(h('h1', {}, c.name, c.archived ? h('span', { class: 'tag', style: 'margin-left:10px' }, 'archived') : null),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, nm),
        h('button', { class: 'btn ghost small', onclick: safe(async () => { await api('/api/admin/classes', { id, name: nm.value }); toast('Renamed'); classAdminPage(id); }) }, 'Rename'),
        h('span', { class: `tag ${c.active ? 'pass' : ''}` }, c.active ? 'open' : 'closed'),
        h('button', { class: 'btn ghost small', onclick: safe(async () => { await api('/api/admin/classes', { id, active: !c.active }); classAdminPage(id); }) }, c.active ? 'Close' : 'Re-open'),
        c.archived ? h('button', { class: 'btn ghost small', onclick: safe(async () => { await api('/api/admin/classes', { id, archived: false }); toast('Back from the archive'); classAdminPage(id); }) }, 'Bring back')
          : h('button', { class: 'btn ghost small', disabled: !c.canArchive, title: c.canArchive ? '' : 'A class can be archived once it is 6 months old', onclick: safe(async () => {
            if (!confirm(`Archive ${c.name}? Its links stop working; everything is kept and it moves to the Archive menu.`)) return;
            await api('/api/admin/classes', { id, archived: true }); toast('Archived'); go('a-admins'); }) }, 'Archive'),
        h('button', { class: 'btn ghost small danger', onclick: safe(async () => {
          const own = tests.filter((t) => t.class_id === id);
          if (!confirm(`Delete the class "${c.name}"?${own.length ? `

This also deletes its ${own.length} practice set(s)/test(s): ${own.map((t) => t.name).join(', ')}.` : ''}`)) return;
          await api(`/api/admin/classes/${id}/delete`, {}); toast('Deleted'); go('a-admins'); }) }, 'Delete')),
      linkRow('practice'), linkRow('test'),
      h('div', { class: 'small muted', style: 'margin-top:6px' }, open.length ? `Open now: ${open.map((t) => `${t.name} (${t.mode})`).join(', ')}` : 'Nothing is open on these links yet. Make practice or a test on Practice & tests, then press Open.')),
    h('h2', {}, `Trainees (${mine.length})`),
    h('div', { class: 'card' }, mine.length ? peopleTable(mine, { classes }) : h('p', { class: 'muted' }, 'No one yet. Send the practice link.')));
}

// The GoGo Academy home page: one tile per academy. Pin Academy is open; the others are on the way (Vee, 2026-10-07).
const ACADEMIES = [
  { name: 'Pin Academy', about: 'Put the pin on the right spot and run the call the GoGo way: practice calls, then a test.', open: true },
  { name: 'Need Love Academy', about: 'Need Love tickets the right way: the right category, no duplicates.', open: false },
];
VIEWS.home = async () => {
  mount(h('h1', {}, `Welcome${ME?.name ? `, ${ME.name.split(' ')[0]}` : ''}`),
    h('p', { class: 'lead' }, 'Pick where you want to go.'),
    h('div', { class: 'tiles academies' }, ACADEMIES.map((a) => h('button', { class: `tile academy ${a.open ? '' : 'soon'}`, disabled: !a.open,
      onclick: () => go(ME.role === 'admin' ? 'a-scenarios' : 'practice') },
      h('img', { src: '/brand/pin-heart.png', height: 40, alt: '' }), h('b', {}, a.name), h('span', { class: 'small muted' }, a.about),
      a.open ? null : h('span', { class: 'tag' }, 'Coming soon')))));
};
async function render(id) {
  try {
    // #s-12 opens practice scenario 12 directly, so a trainer can send one call as a link.
    const direct = /^s-(\d+)$/.exec(id || '');
    if (direct) {
      drawShell('practice');
      const list = await api('/api/practice');
      const i = list.findIndex((x) => x.id === Number(direct[1]));
      if (i >= 0) return practiceOne(list, i, ME.role === 'admin' ? 'a-scenarios' : 'practice');
      toast('That scenario is not in practice.', true); id = 'practice';
    }
    // #t-12 is a class link: a practice set or a test. Opening it joins the class (if you have none).
    const link = /^t-(\d+)$/.exec(id || '');
    if (link) {
      const j = await api(`/api/tests/${link[1]}/join`, {});
      ME = j.user;
      drawShell(j.mode === 'practice' ? 'practice' : 'tests');
      return j.mode === 'practice' ? practiceSet(j.id) : takeTest(j.id);
    }
    const join = /^join-(practice|test)-([a-z0-9-]+)$/.exec(id || '');
    if (join) return classPage(join[2], join[1]);
    if (/^class-[a-z0-9-]+$/.test(id || '')) id = 'home'; // the bare class link is internal: nothing to show
    const cpage = /^a-class-(\d+)$/.exec(id || '');
    if (cpage && ME.role === 'admin') { drawShell('a-people'); return classAdminPage(Number(cpage[1])); }
    if (!VIEWS[id] || (id.startsWith('a-') && ME.role !== 'admin')) id = 'home';
    drawShell(id);
    await VIEWS[id]();
  } catch (e) { mount(h('div', { class: 'card' }, h('p', {}, e.message), h('button', { class: 'btn ghost', onclick: () => go('practice') }, 'Go to Practice'))); }
}

// A simple drawing of the driver's car, coloured from the description ("Black Toyota Sienna" -> black minivan).
function carPicture(desc = '') {
  const colours = { black: '#1f1f24', white: '#f2f2f2', silver: '#b9bcc4', grey: '#7c7f87', gray: '#7c7f87', red: '#c62828', blue: '#1f4fa8', green: '#2e7d32' };
  const word = Object.keys(colours).find((c) => desc.toLowerCase().includes(c)) || 'grey';
  const body = colours[word];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect x="0" y="0" width="240" height="120" rx="10" fill="#eef1f6"/>
    <path d="M22 78 L30 48 Q34 36 48 34 L150 32 Q168 32 182 44 L206 62 Q218 64 220 76 L220 88 L22 88 Z" fill="${body}" stroke="#333" stroke-width="2"/>
    <path d="M52 40 L98 38 L98 60 L42 60 Z M106 38 L146 37 Q160 37 172 48 L182 60 L106 60 Z" fill="#9fc3e0" stroke="#333" stroke-width="1.5"/>
    <circle cx="62" cy="90" r="15" fill="#222"/><circle cx="62" cy="90" r="6" fill="#aaa"/><circle cx="180" cy="90" r="15" fill="#222"/><circle cx="180" cy="90" r="6" fill="#aaa"/>
    <rect x="208" y="70" width="10" height="6" rx="2" fill="#ffd54f"/></svg>`;
  return h('img', { class: 'car-pic', alt: desc || 'Driver car', src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) });
}

// A dashboard-style pop-up. buttons: [[label, className, onClick]]; returns close().
function modal(title, body, buttons) {
  const back = h('div', { class: 'modal-back' });
  const close = () => back.remove();
  back.append(h('div', { class: 'modal' }, title ? h('div', { class: 'modal-title' }, title, h('button', { class: 'modal-x', type: 'button', onclick: close }, '×')) : null,
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-btns' }, buttons.map(([label, cls, fn]) => h('button', { class: `pill ${cls}`, type: 'button', onclick: () => fn(close) }, label)))));
  document.body.append(back);
  return close;
}

// ── the practice copy of Ride Ordering ───────────────────────────────
// Looks like the dashboard's Ride Ordering page so the moves carry over: the address block, the map, the boxes.
// The call runs in the right-hand panel. Returns { el, getSubmission(), showResult(result) }.
const SIDEBAR = [['Dashboard Overview'], ['Live Calls'], ['Rides', ['Ride Ordering', 'Ride History', 'Scheduled Rides', 'Will Call Rides', 'Live Rides', 'Ride Monitoring', 'Receipts', 'SMS']],
  ['Ride Safety & Support'], ['Client Checks'], ['Payments & Credits']];
const notInPractice = (what) => () => toast(`${what} is not part of this practice.`);

function scenarioForm(s, { submitLabel = 'End call & check my answer', onSubmit, checkStep = null, practice = false } = {}) {
  const t0 = Date.now();
  const asked = new Set();
  const first = (ME?.name || '').split(' ')[0] || 'your name';
  const account = s.account || { home: null, saved: [] };
  // The account as the trainee changes it: Home and Custom Locations #3-#5 (index 0-2). Every save/delete is recorded.
  const acct = { home: account.home ? { ...account.home } : null, saved: [0, 1, 2].map((i) => (account.saved[i] ? { ...account.saved[i] } : null)) };
  const savedChanges = [];
  const redrawSlots = [];
  const slotLabel = (sp) => `${sp.label}${sp.address ? ' - ' + sp.address : ''}`;

  // the call (right-hand panel)
  const transcript = h('div', { class: 'transcript' },
    h('div', { class: 'line you' }, h('b', {}, 'You: '), `Thank you for calling GoGo, my name is ${first}. How may I help you?`),
    h('div', { class: 'line caller' }, h('b', {}, 'Caller: '), s.caller),
    h('div', { class: 'line you' }, h('b', {}, 'You: '), "Perfect, I'll be more than happy to help. Give me just a moment while I pull up your account."));
  const sayLine = (q) => {
    transcript.append(h('div', { class: 'line you' }, h('b', {}, 'You: '), q.say || q.q), h('div', { class: 'line caller' }, h('b', {}, 'Caller: '), q.a));
    transcript.scrollTop = transcript.scrollHeight;
  };
  const qButtons = s.questions.map((q, i) => h('button', { class: 'qbtn', onclick: () => {
    if (asked.has(i)) return;
    asked.add(i); qButtons[i].classList.add('on');
    sayLine(q);
  } }, q.q));

  // The call in steps: a few lines at a time. In practice a wrong pick says "Not quite" and they pick again (still a
  // miss on the result). In a test there is no checkStep: whatever they pick is said, and the call moves on.
  const steps = s.steps || [];
  const picks = steps.map(() => []);
  const said = new Set();
  let at = 0, busy = false, hint = '';
  const stepHost = h('div');
  function drawStep() {
    if (at >= steps.length) {
      return stepHost.replaceChildren(h('div', { class: 'ro-call-label' }, `That's the end of the call. Check the pins and the driver note, then click "${submitLabel}".`));
    }
    const tried = picks[at];
    // A line already said earlier in the call (a test's wrong pick) stays greyed out; if nothing new is left, move on.
    if (steps[at].choices.every((i) => said.has(i) || tried.includes(i))) { at++; return drawStep(); }
    stepHost.replaceChildren(h('div', { class: 'ro-call-label' }, `Step ${at + 1} of ${steps.length}: what do you say next?`),
      h('div', { class: 'qbtns' }, steps[at].choices.map((i) => h('button', {
        class: `qbtn ${tried.includes(i) ? 'wrong' : said.has(i) ? 'said' : ''}`, type: 'button', disabled: tried.includes(i) || said.has(i),
        title: said.has(i) ? 'Already said' : '', onclick: () => pickLine(i) }, s.questions[i].q))),
      ...(hint ? [h('div', { class: 'step-hint' }, hint)] : []));
  }
  const pickLine = safe(async (i) => {
    if (busy) return;
    busy = true;
    try {
      const right = checkStep ? await checkStep(at, i) : true;
      picks[at].push(i);
      if (!right) { hint = 'Not quite, that is not what comes next. Try again. (This counts as a miss.)'; return drawStep(); }
      hint = '';
      sayLine(s.questions[i]);
      said.add(i);
      at++;
      drawStep();
    } finally { busy = false; }
  });
  if (steps.length) drawStep();
  const result = h('div');

  // the address blocks
  const copyBtn = (get) => h('button', { class: 'copy', type: 'button', title: 'Copy', onclick: () => { navigator.clipboard?.writeText(get()); toast('Copied'); } }, '⧉');
  const row = (label, ...field) => h('div', { class: 'df-row' }, h('label', {}, label), h('div', { class: 'df-field' }, ...field));
  function addressBlock(kind) {
    const stop = s.stops.find((x) => x.kind === kind) || null; // null = not graded in this scenario, still usable
    const b = { kind, stop, pin: null, entrance: null, pm: null };
    const [col] = PIN_COLOUR[kind];
    const street = h('input', { type: 'text', placeholder: 'Enter an address or location name' });
    const apt = h('input', { type: 'text', placeholder: 'Apt number', class: 'short' });
    const city = h('input', { type: 'text' });
    const state = h('input', { type: 'text', class: 'short' });
    const zip = h('input', { type: 'text', class: 'short' });
    const lat = h('input', { type: 'text', class: 'short', placeholder: 'Latitude' });
    const lng = h('input', { type: 'text', class: 'short', placeholder: 'Longitude' });
    const locName = h('input', { type: 'text' });
    const placeId = h('span', { class: 'small muted' });
    const specific = h('input', { type: 'text' });
    const entrances = stop ? stop.entrances : [];
    const venue = h('select', { onchange: () => {
      const i = venue.value === '' ? null : Number(venue.value);
      b.entrance = i;
      if (i != null) { const e = entrances[i]; specific.value = e.name; b.pm && b.pm.setPin({ lat: e.lat, lng: e.lng }); }
    } }, h('option', { value: '' }, 'Original Address'), entrances.map((e, i) => h('option', { value: i }, `${i + 1}. ${e.name}`)));
    const mapHost = h('div', { class: 'ro-map' });
    const showLL = (p) => { if (p) { lat.value = p.lat.toFixed(7); lng.value = p.lng.toFixed(7); } };
    const ensureMap = async (start) => {
      if (b.pm || b.mapLoading) return b.pm;
      b.mapLoading = true;
      b.pm = await pinMap(mapHost, { start, kind, entrances, onMove: (p) => { b.pin = p; showLL(p); }, onUserMove: (p) => maybeOffer(p),
        onEntrance: (i) => { venue.value = String(i); b.entrance = i; specific.value = entrances[i].name; } });
      if (b.pm) { b.pin = b.pm.getPin(); showLL(b.pin); }
      return b.pm;
    };
    const fill = async (p) => {
      if (p.street != null) street.value = p.street || p.name || '';
      city.value = p.city || ''; state.value = p.state || ''; zip.value = p.zip || ''; locName.value = p.name || '';
      placeId.textContent = p.placeId || '';
      const pm = await ensureMap(p);
      if (pm) { pm.setOriginal(p); pm.setPin(p); } else b.pin = { lat: p.lat, lng: p.lng };
      showLL(p);
    };
    // Saved places on the pretend account: Home (⌂) and the saved list. They fill the box like the dashboard does.
    const useSaved = (sp) => fill({ ...sp, name: sp.label, street: sp.address.split(',')[0], city: (sp.address.split(',')[1] || '').trim(),
      state: ((sp.address.split(',')[2] || '').trim().split(' ')[0]) || '', zip: ((sp.address.split(',')[2] || '').trim().split(' ')[1]) || '' });
    const savedSel = h('select', { disabled: true, title: 'Saved locations are listed below' }, h('option', { value: '' }, 'None Selected'));
    const homeBtn = h('button', { class: 'round', type: 'button', title: 'Home address on the account', onclick: () => {
      if (!acct.home) return toast('No home address saved on this account.');
      b.fromSlot = 'home'; b.fromPlace = { ...acct.home }; drawSlots(); useSaved({ ...acct.home, label: acct.home.label || 'Home' });
    } }, '⌂');
    const lastBtn = h('button', { class: 'round', type: 'button', title: 'Last location', onclick: notInPractice('Last location') }, 'L');
    const slotsHost = h('div');
    function drawSlots() {
      homeBtn.classList.toggle('has-home', !!acct.home);
      slotsHost.replaceChildren(...[0, 1, 2].map((i) => { const sp = acct.saved[i];
        return h('button', { class: `slot ${b.fromSlot === i + 3 ? 'chosen' : ''}`, type: 'button', title: sp ? slotLabel(sp) : '',
          onclick: () => { if (!sp) return; b.fromSlot = i + 3; b.fromPlace = { ...sp }; b.offered = false; redrawSlots.forEach((f) => f()); useSaved(sp); } },
          `${i + 3}: ${sp ? slotLabel(sp) : 'None'}`); }));
    }
    redrawSlots.push(drawSlots);
    const slots = slotsHost;
    // Save Location: the dashboard's "Save Location Type" pop-up, plus Delete for a place the customer won't use again.
    function saveLocation(pre) {
      if (!b.pin) return toast('Put the pin on the map first.');
      let choice = pre ?? null;
      const opt = (val, label) => h('label', { class: 'ro-check' }, h('input', { type: 'radio', name: 'saveType', checked: choice === val, onchange: () => (choice = val) }), label);
      const record = (slot, action, place) => {
        savedChanges.push({ slot, action, ...(place ? { lat: place.lat, lng: place.lng, label: place.label } : {}) });
        if (slot === 'home') acct.home = action === 'delete' ? null : place; else acct.saved[slot - 3] = action === 'delete' ? null : place;
        redrawSlots.forEach((f) => f());
      };
      modal('Save Location Type', h('div', { class: 'grid2' }, opt('home', 'Home'), opt(3, 'Custom Location #3'), opt(4, 'Custom Location #4'), opt(5, 'Custom Location #5')), [
        ['Delete', 'grey', (close) => {
          if (choice == null) return toast('Pick which saved location to delete.');
          const has = choice === 'home' ? acct.home : acct.saved[choice - 3];
          if (!has) return toast('Nothing is saved there.');
          modal(null, h('div', { class: 'modal-q' }, '?', h('div', {}, `Delete ${choice === 'home' ? 'Home' : 'Custom Location #' + choice}?`)),
            [['Delete', 'purple', (c2) => { record(choice, 'delete'); c2(); close(); toast('Deleted'); }], ['No', 'yellow', (c2) => c2()]]);
        }],
        ['Save Location', 'grey', (close) => {
          if (choice == null) return toast('Pick where to save it.');
          const place = { label: locName.value || street.value || 'Saved', address: [street.value, city.value, [state.value, zip.value].filter(Boolean).join(' ')].filter(Boolean).join(', '), ...b.pin };
          const taken = choice === 'home' ? acct.home : acct.saved[choice - 3];
          const doIt = () => { record(choice, 'save', place); close(); toast('Location saved'); };
          if (!taken) return doIt();
          modal(null, h('div', { class: 'modal-q' }, '?', h('div', {}, `Overwrite ${choice === 'home' ? 'Home' : 'Custom Location #' + choice}?`)),
            [['Overwrite', 'purple', (c2) => { c2(); doIt(); }], ['No', 'yellow', (c2) => c2()]]);
        }],
        ['Cancel', 'yellow', (close) => close()],
      ]);
    }
    // When a person adjusts the pin of a place the account already has saved (picked from the slots, or searched
    // and it lands within about 150 m of a saved place), the save pop-up comes up, like on the dashboard. Once per address.
    const metres = (a, c) => Math.hypot((a.lat - c.lat) * 111320, (a.lng - c.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));
    function maybeOffer(p) {
      if (b.offered) return;
      let slot = b.fromSlot;
      if (slot == null) {
        const near = [['home', acct.home], ...acct.saved.map((sp, i) => [i + 3, sp])].filter(([, sp]) => sp && metres(p, sp) < 150)
          .sort((x, y) => metres(p, x[1]) - metres(p, y[1]))[0];
        if (!near) return;
        slot = near[0];
      }
      const from = slot === 'home' ? acct.home : acct.saved[slot - 3];
      if (from && metres(p, from) < 3) return; // pin still on the saved spot: nothing changed
      b.offered = true;
      setTimeout(() => saveLocation(slot), 250);
    }
    const typedLL = async () => { const p = { lat: Number(lat.value), lng: Number(lng.value) };
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) { const pm = await ensureMap(p); if (pm) pm.setPin(p); else b.pin = p; maybeOffer(p); } };
    lat.addEventListener('change', typedLL); lng.addEventListener('change', typedLL);
    const clear = () => { [street, apt, city, state, zip, lat, lng, locName, specific].forEach((x) => (x.value = '')); placeId.textContent = ''; venue.value = ''; b.entrance = null; };
    b.el = h('div', { class: 'ro-block' },
      h('div', { class: 'ro-block-title' }, kind === 'dropoff' ? 'End Address*' : 'Start Address*'),
      h('div', { class: 'df-saved' }, h('span', { class: 'df-pin', style: `--pc:${col}` }),
        h('div', {}, h('div', { class: 'row' }, homeBtn, lastBtn, h('div', { class: 'grow' }, savedSel)), slots)),
      row('Street Address1*', street, copyBtn(() => street.value)),
      row('Apt #', apt),
      row('City*', city),
      h('div', { class: 'df-row' }, h('label', {}, 'State*'), h('div', { class: 'df-field' }, state, h('label', { class: 'inline' }, 'Zip*'), zip)),
      h('div', { class: 'df-row' }, h('label', {}, 'Lat*'), h('div', { class: 'df-field' }, lat, h('label', { class: 'inline' }, 'Lng*'), lng, copyBtn(() => `${lat.value}, ${lng.value}`))),
      row('Location Name*', locName),
      row('Google Place ID', placeId),
      row('Venue Entrance or Side', venue),
      row('Specific Entrance or Side', specific),
      h('details', { class: 'ro-mapbox', open: true }, h('summary', {}, 'Location Map'), mapHost),
      h('div', { class: 'ro-btns' },
        h('button', { class: 'pill purple', type: 'button', onclick: notInPractice('Intersection Form') }, 'Intersection Form'),
        h('button', { class: 'pill grey', type: 'button', onclick: () => saveLocation() }, 'Save Location'),
        h('button', { class: 'pill purple', type: 'button', onclick: notInPractice('Switch') }, 'Switch ⇅'),
        h('button', { class: 'pill yellow', type: 'button', onclick: clear }, 'Reset')));
    Object.assign(b, { specific, locName });
    drawSlots();
    addressSearch(street, (p) => { b.fromSlot = null; b.offered = false; redrawSlots.forEach((f) => f()); fill(p); });
    if (stop) ensureMap(stop.start);
    return b;
  }
  const blocks = { pickup: addressBlock('pickup'), dropoff: addressBlock('dropoff') };

  const wearing = h('input', { type: 'text', placeholder: 'Describe clothing' });
  const announce = h('select', {}, ['Call me', 'Text me'].map((x) => h('option', {}, x)));
  const note = h('textarea', { placeholder: 'Anything else the driver needs to know?' });
  // Practice only: when the call has note choices, they pick the note instead of writing it (tests always write it).
  let noteChoice = null;
  const noteOpts = practice && s.noteOptions?.length ? s.noteOptions : null;
  const radioName = `noteopt-${Math.random().toString(36).slice(2)}`;
  const noteBox = !noteOpts ? note : h('div', { class: 'note-opts' }, h('div', { class: 'small muted' }, 'Pick the note you would send the driver:'),
    noteOpts.map((o) => h('label', { class: 'note-opt' }, h('input', { type: 'radio', name: radioName, onchange: () => { noteChoice = o.i; } }), h('span', {}, o.text))));
  const checkbox = (label, extra = {}) => h('label', { class: 'ro-check' }, h('input', { type: 'checkbox', ...extra }), label);
  const submitBtn = h('button', { class: 'btn orange end-call', type: 'button' }, submitLabel);
  // Like the dashboard: Get Estimate unfolds the estimate under the buttons, which turn into Order Ride / Cancel.
  // Order Ride waits for a driver, then the same space shows the driver (with a picture of the car) to read out.
  const ride = s.ride || {};
  let ordered = false;
  const detail = (label, ...val) => h('tr', {}, h('th', {}, label), h('td', {}, ...val));
  const estimateBox = h('div', { class: 'ro-estimate' });
  const mainBtns = h('div', { class: 'ro-btns ro-center' });
  function showMainButtons() {
    mainBtns.replaceChildren(
      h('button', { class: 'pill purple', type: 'button', onclick: getEstimate }, 'Get Estimate'),
      h('button', { class: 'pill yellow', type: 'button', onclick: () => { blocks.pickup.el.querySelector('.ro-btns .pill.yellow').click(); blocks.dropoff.el.querySelector('.ro-btns .pill.yellow').click(); wearing.value = ''; note.value = ''; } }, 'Reset'),
      h('button', { class: 'pill cyan', type: 'button', onclick: () => toast('This is the Order a Ride Now tab: use Get Estimate, then Order Ride.') }, 'Schedule This Ride'));
  }
  function getEstimate() {
    const missing = s.stops.filter((x) => !blocks[x.kind].pin).map((x) => (x.kind === 'dropoff' ? 'End Address' : 'Start Address'));
    if (missing.length) return toast(`Fill in the ${missing.join(' and ')} first.`);
    estimateBox.replaceChildren(h('table', { class: 'estimate' },
      detail('Ride Type:', h('span', { class: 'red' }, `${ride.rideType} For ${ride.customerName}`)),
      detail('ETA:', ride.eta),
      detail('Ride Details:', h('div', {}, ride.trip), h('div', {}, `Surge Factor: ${ride.surge}`), h('div', {}, `Cost Per Mile: ${ride.perMile}`),
        h('div', {}, `Cost Per Minute: ${ride.perMinute}`), h('div', {}, `Base Fare: ${ride.baseFare}`), h('div', {}, `Minimum Fare: ${ride.minFare}`)),
      detail('GoGo Cost', ride.cost), detail('Caller GoGo Credits:', ride.credits), detail('Caller Expiring Credits:', ride.expiring),
      detail('User Has Auto Tipping On:', ride.autoTip), detail('Caller Partner Subsidies:', ''), detail('Partner Info for Operator:', '')));
    mainBtns.replaceChildren(
      h('button', { class: 'pill purple', type: 'button', onclick: orderRide }, 'Order Ride'),
      h('button', { class: 'pill yellow', type: 'button', onclick: () => { estimateBox.replaceChildren(); showMainButtons(); } }, 'Cancel'));
    estimateBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function orderRide() {
    ordered = true;
    mainBtns.replaceChildren();
    estimateBox.replaceChildren(h('div', { class: 'ro-finding' }, h('span', { class: 'spin' }), 'Finding a driver…'));
    setTimeout(() => {
      const dr = ride.driver || {};
      estimateBox.replaceChildren(h('div', { class: 'ro-driver' }, carPicture(dr.car),
        h('table', { class: 'estimate' }, detail('Ride Type:', h('span', { class: 'red' }, `${ride.rideType} For ${ride.customerName}`)),
          detail('Driver:', dr.name), detail('Vehicle:', dr.car), detail('License Plate:', `Last 4 digits ${dr.plate}`), detail('Arriving In:', dr.eta))));
    }, 4000);
  }
  const getSubmission = () => ({
    pins: s.stops.map((x) => blocks[x.kind].pin), entrances: s.stops.map((x) => blocks[x.kind].entrance), asked: [...asked], steps: picks,
    note: note.value, noteChoice, wearing: wearing.value, announce: announce.value, savedChanges, ordered,
    specific: s.stops.map((x) => blocks[x.kind].specific.value), locationName: s.stops.map((x) => blocks[x.kind].locName.value),
    seconds: Math.round((Date.now() - t0) / 1000),
  });
  submitBtn.onclick = safe(async () => { submitBtn.disabled = true; try { await onSubmit(getSubmission()); } finally { submitBtn.disabled = false; } });

  const form = h('div', { class: 'ro-card' },
    h('div', { class: 'ro-card-title' }, 'Order rides on behalf of a registered user'),
    // GoGo's toll-free number stands in for the customer's phone (Vee, 2026-10-07): it is only a practice copy.
    row('Phone Number*', h('div', {}, h('div', { class: 'ro-phone' }, h('span', { class: 'ro-phone-cc' }, '📞 (+1)'), h('input', { type: 'text', value: '(855) 464-6872', disabled: true })),
      h('div', { class: 'ro-hint' }, "Leave empty if you're getting a quote"))),
    row('Preferred Contact Number*', h('select', {}, h('option', {}, 'Cell Phone - +18554646872'), h('option', {}, 'New Phone Number'))),
    row('Service Type', h('select', {}, h('option', {}, 'Transportation'))),
    row('Type of Car*', h('select', {}, h('option', {}, 'Car (Auto selects a vendor based on ETA or by user preference)'))),
    blocks.pickup.el,
    h('button', { class: 'pill purple small', type: 'button', onclick: notInPractice('Add Stop') }, 'Add Stop +'),
    blocks.dropoff.el,
    row('What Are You Wearing Today?', wearing),
    row('How Should the Driver Announce Their Arrival?*', announce),
    h('div', { class: 'ro-center' }, h('button', { class: 'pill purple', type: 'button', onclick: notInPractice('Accessibility options') }, 'Edit Accessibility Options')),
    h('div', { class: 'ro-indent' }, checkbox('The rider has groceries.'), checkbox('The rider has luggage.')),
    h('div', { class: 'ro-preview' }, h('div', { class: 'ro-preview-title' }, '▼ Driver Message Preview'), noteBox),
    h('div', { class: 'ro-indent' }, checkbox('Have RSS monitor this ride')),
    row('Ride Type', h('div', {}, checkbox('Emergency Ride'), checkbox('Expand Driver Search'), checkbox('Expand Vehicle Search'))),
    row('Auto Retry Getting a', h('select', { disabled: true }, h('option', {}, 'Select one'))),
    h('div', { class: 'ro-indent' }, checkbox('Do not apply expiring credits to this ride')),
    estimateBox, mainBtns); // like the dashboard: the estimate first, Order Ride / Cancel under it
  showMainButtons();

  const side = h('nav', { class: 'ro-side' }, h('div', { class: 'ro-logo' }, 'GOGOGRANDPARENT'),
    h('input', { type: 'text', placeholder: 'Form Search', disabled: true }),
    SIDEBAR.map(([name, kids]) => [h('div', { class: 'ro-nav' }, name), kids ? kids.map((k) => h('div', { class: `ro-sub ${k === 'Ride Ordering' ? 'on' : ''}` }, k)) : null]));
  const el = h('div', { class: 'ro' }, side,
    h('div', { class: 'ro-main' },
      h('div', { class: 'ro-crumb' }, '‹ Ride Ordering ♥', h('span', { class: 'ro-practice' }, 'Practice copy: no real ride is booked')),
      h('div', { class: 'ro-cols' },
        h('div', { class: 'ro-left' }, h('h1', { class: 'ro-title' }, 'Multi-Vendor Ride Ordering'),
          h('div', { class: 'ro-tabs' }, h('span', { class: 'on' }, 'Order a Ride Now'), h('span', {}, 'Schedule a Ride in the Future')), form),
        h('aside', { class: 'ro-right' },
          h('div', { class: 'ro-call' }, h('div', { class: 'ro-call-title' }, '📞 The call', h('span', { class: 'tag' }, s.category)), transcript,
            steps.length ? stepHost
              : s.questions.length ? [h('div', { class: 'ro-call-label' }, 'What do you say next? Pick in the order you would on the call'), h('div', { class: 'qbtns' }, qButtons)] : null,
            h('div', { class: 'ro-call-end' }, submitBtn)),
          result))));
  return {
    el, getSubmission,
    showResult(r) {
      s.stops.forEach((x, i) => { const blk = blocks[x.kind], g = r.stops[i]; if (blk.pm) { blk.pm.lock(); blk.pm.showAnswer(g.answer, blk.pin); } });
      note.disabled = true; wearing.disabled = true; submitBtn.disabled = true;
      if (noteOpts) noteBox.querySelectorAll('input').forEach((x) => { x.disabled = true; });
      result.replaceChildren(resultCard(r));
      result.scrollIntoView({ behavior: 'smooth' });
    },
  };
}

function resultCard(r) {
  const ok = (b) => h('span', { class: `tag ${b ? 'pass' : 'fail'}` }, b ? '✓' : '✗');
  const part = (label, okv) => h('tr', { class: 'part-head' }, h('td', { colspan: 3 }, h('span', { class: `tag ${okv ? 'pass' : 'fail'}` }, okv ? '✓ Passed' : '✗ Not yet'), ' ', h('b', {}, label)));
  const callOk = r.callFlow ? r.callFlow.ok : r.passed, pinOk = r.pin ? r.pin.ok : r.passed;
  return h('div', { class: `card result ${r.passed ? 'good' : 'bad'}` },
    h('div', { class: 'row' }, h('div', { class: 'big' }, r.passed ? 'Got it' : 'Not quite'), h('span', { class: `tag ${r.passed ? 'pass' : 'fail'}` }, r.passed ? 'Passed overall' : 'Try again')),
    h('div', { class: 'parts' }, h('span', { class: `tag ${pinOk ? 'pass' : 'fail'}` }, `Pin: ${pinOk ? 'passed' : 'not yet'}`),
      h('span', { class: `tag ${callOk ? 'pass' : 'fail'}` }, `Call flow: ${callOk ? 'passed' : 'not yet'}`)),
    h('table', {},
      part('The pin', pinOk),
      r.stops.map((s) => h('tr', {}, h('td', {}, ok(s.passed)), h('td', {}, h('b', {}, s.kind === 'dropoff' ? 'Drop-off pin' : 'Pickup pin')),
        h('td', {}, s.distance == null ? 'No pin placed' : `${m(s.distance)} from the right spot`,
          s.entrance && s.entrance.correct ? h('div', { class: 'small muted' }, `Right entrance: ${s.entrance.correct}${s.entrance.chose ? ` · you picked: ${s.entrance.chose}` : ''}`) : null))),
      r.saved ? h('tr', {}, h('td', {}, ok(r.saved.ok)), h('td', {}, h('b', {}, 'Saved location')),
        h('td', {}, r.saved.ok ? r.saved.did : `${r.saved.did}. Should be: ${r.saved.want}.`)) : null,
      part('The call flow', callOk),
      r.stepMode
        ? h('tr', {}, h('td', {}, ok(!r.missingQuestions.length)), h('td', {}, h('b', {}, 'The call')),
          h('td', {}, r.missingQuestions.length ? r.missingQuestions.map((x) => h('div', {}, x)) : 'Every step in the right order.'))
        : h('tr', {}, h('td', {}, ok(!r.missingQuestions.length)), h('td', {}, h('b', {}, 'Questions')),
          h('td', {}, r.missingQuestions.length ? `You didn't: ${r.missingQuestions.join(' · ')}` : 'You asked what you needed to.')),
      h('tr', {}, h('td', {}, ok(r.note.ok)), h('td', {}, h('b', {}, 'Driver note')),
        h('td', {}, r.note.ok ? 'Clear and useful for the driver.' : r.note.problems.join(' '))),
      r.ordered ? h('tr', {}, h('td', {}, ok(r.ordered.ok)), h('td', {}, h('b', {}, 'Ride ordered')),
        h('td', {}, r.ordered.ok ? 'You got the estimate and ordered the ride.' : 'The ride was never ordered. Use Get Estimate, then Order Ride.')) : null),
    r.modelNote ? [h('h3', {}, 'A good note looks like this'), h('p', { class: 'model' }, r.modelNote)] : null,
    r.why ? [h('h3', {}, 'Why'), h('p', {}, r.why)] : null);
}

// ── practice ─────────────────────────────────────────────────────────
VIEWS.practice = async () => {
  const [list, tests] = await Promise.all([api('/api/practice'), api('/api/tests')]);
  const sets = tests.filter((t) => t.mode === 'practice' && t.status === 'open');
  const groups = {};
  [...list].sort(bySkill).forEach((s) => (groups[s.category] ||= []).push(s));
  const tip = (name) => CONFIG.pinSkills?.find((k) => k.name === name)?.tip || '';
  mount(h('h1', {}, 'Practice'),
    h('p', { class: 'lead' }, 'Each one is a short call on a copy of Ride Ordering. Ask what you need to, search the place, put the pin on the right spot, fill in what the driver needs, then Schedule This Ride to see how you did.'),
    sets.length ? [h('h3', {}, 'Practice sets for your class'), h('div', { class: 'tiles' }, sets.map((t) => h('button', { class: 'tile', onclick: () => go(`t-${t.id}`) },
      h('span', { class: 'tag' }, 'Practice set'), h('b', {}, t.name), h('span', { class: 'small muted' }, `${t.questions} calls`))))] : null,
    !list.length && !sets.length ? h('div', { class: 'card muted' }, 'No practice yet. Your trainer adds it.') : null,
    Object.entries(groups).map(([cat, items]) => [h('h3', {}, cat), tip(cat) ? h('p', { class: 'small muted skill-tip' }, tip(cat)) : null,
      h('div', { class: 'tiles' }, items.map((s, i) => h('button', { class: 'tile', style: catColour(cat), onclick: () => practiceOne(items, i) },
        h('span', { class: 'tag' }, s.category), h('b', {}, s.title), h('span', { class: 'small muted' }, s.stops.map((x) => x.kind === 'dropoff' ? 'drop-off' : 'pickup').join(' + ')))))]));
};

// A class has a practice link and a test link (Vee, 2026-10-07): each shows only its own part.
async function classPage(slug, mode) {
  const d = await api(`/api/class/${slug}/join`, {});
  ME = d.user;
  drawShell(mode === 'test' ? 'tests' : 'practice');
  const back = `join-${mode}-${slug}`;
  const practicePart = [h('h2', {}, 'Practice'),
    !d.practice.length ? h('div', { class: 'card muted' }, 'No practice is open for this class yet.')
      : h('div', { class: 'tiles' }, d.practice.map((s, i) => h('button', { class: 'tile', style: catColour(s.category), onclick: () => practiceOne(d.practice, i, back) },
        h('span', { class: 'tag' }, s.category), h('b', {}, s.title),
        h('span', { class: `small ${s.gotRight ? '' : 'muted'}` }, s.gotRight ? '✓ Got it right' : s.tries ? `${s.tries} tries so far` : 'Not tried yet'))))];
  const testPart = [h('h2', {}, 'Tests'),
    !d.tests.length ? h('div', { class: 'card muted' }, 'No test is open for this class right now.') : null,
    d.tests.map((t) => h('div', { class: 'card row' },
      h('div', { class: 'grow' }, h('b', {}, t.name), h('div', { class: 'small muted' },
        `${t.questions} calls · ${t.timeLimitMin} min · pass = ${t.passCount} of ${t.questions} right (pins within ${t.passMeters} m, right questions, clear note)`)),
      h('span', { class: `tag ${t.state === 'done' ? 'pass' : ''}` }, t.state),
      t.state === 'done' ? h('button', { class: 'btn ghost', onclick: () => takeTest(t.id) }, 'See results')
        : t.status === 'open' ? h('button', { class: 'btn orange', onclick: () => takeTest(t.id) }, t.state === 'in progress' ? 'Continue' : 'Start test')
        : h('span', { class: 'muted small' }, 'Closed')))];
  mount(h('h1', {}, d.class.name),
    h('p', { class: 'lead' }, mode === 'test' ? 'Your test. It is timed, and you get one go.' : 'Your practice. Do the calls as many times as you like.'),
    mode === 'test' ? testPart : practicePart);
}

async function practiceSet(id) {
  const set = await api(`/api/tests/${id}/set`);
  mount(h('h1', {}, set.name), h('p', { class: 'lead' }, 'A practice set from your trainer. Do them in any order, as many times as you like.'),
    h('div', { class: 'tiles' }, set.scenarios.map((s, i) => h('button', { class: 'tile', style: catColour(s.category), onclick: () => practiceOne(set.scenarios, i, `t-${id}`) },
      h('span', { class: 'tag' }, s.category), h('b', {}, s.title),
      h('span', { class: `small ${s.gotRight ? '' : 'muted'}` }, s.gotRight ? '✓ Got it right' : s.tries ? `${s.tries} tries so far` : 'Not tried yet')))));
}

function practiceOne(items, i, backTo = 'practice') {
  const s = items[i];
  const next = h('div', { class: 'row' });
  const form = scenarioForm(s, { practice: true, checkStep: async (step, pick) => (await api(`/api/practice/${s.id}/step`, { step, pick })).right, onSubmit: async (sub) => {
    const r = await api(`/api/practice/${s.id}`, sub);
    form.showResult(r);
    next.replaceChildren(h('button', { class: 'btn ghost', onclick: () => practiceOne(items, i, backTo) }, 'Try again'),
      i + 1 < items.length ? h('button', { class: 'btn', onclick: () => practiceOne(items, i + 1, backTo) }, 'Next call →') : null);
  } });
  mount(h('div', { class: 'row ro-top' }, h('button', { class: 'btn ghost small', onclick: () => go(backTo) }, '← Back'), h('span', { class: 'grow' }),
      h('b', {}, s.title), h('span', { class: 'small muted' }, ` · ${i + 1} of ${items.length}`)),
    h('p'), form.el, h('p'), next);
}

// ── tests (trainee) ──────────────────────────────────────────────────
VIEWS.tests = async () => {
  const tests = (await api('/api/tests')).filter((t) => t.mode !== 'practice');
  mount(h('h1', {}, 'Pin tests'), h('p', { class: 'lead' }, 'Your trainer opens a test for your class. You get one go, with a time limit. No hints until you hand it in.'),
    !tests.length ? h('div', { class: 'card muted' }, ME.classId ? 'No test is open for your class right now.' : 'You are not in a class yet.') : null,
    tests.map((t) => h('div', { class: 'card row' },
      h('div', { class: 'grow' }, h('b', {}, t.name), h('div', { class: 'small muted' },
        `${t.questions} calls · ${t.timeLimitMin} min · pass = ${t.passCount} of ${t.questions} right (pins within ${t.passMeters} m, right questions, clear note)`)),
      h('span', { class: `tag ${t.state === 'done' ? 'pass' : ''}` }, t.state),
      t.state === 'done' ? h('button', { class: 'btn ghost', onclick: () => takeTest(t.id) }, 'See results')
        : t.status === 'open' ? h('button', { class: 'btn orange', onclick: () => takeTest(t.id) }, t.state === 'in progress' ? 'Continue' : 'Start test')
        : h('span', { class: 'muted small' }, 'Closed'))));
};

async function takeTest(id) {
  const d = await api(`/api/tests/${id}/start`, {});
  if (d.done) return showTestResult(d.result);
  const answered = new Set(d.answered);
  const offset = d.serverNow - Date.now();
  let idx = d.scenarios.findIndex((q) => !answered.has(q.id)); if (idx < 0) idx = 0;
  let finished = false;
  const timer = h('span', { class: 'timer' });
  const dots = h('div', { class: 'dots' });
  const body = h('div');
  const handIn = h('button', { class: 'btn ghost' }, 'Hand in test');
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, d.name), h('span', { class: 'muted small' }, 'Time left'), timer),
    h('p', { class: 'muted small' }, `Pass = ${d.passCount} of ${d.scenarios.length} calls right. "Save & next" keeps your answer; you can come back and change it until you hand in.`),
    h('div', { class: 'row' }, dots, h('span', { class: 'grow' }), handIn), h('p'), body);
  const tick = setInterval(() => {
    const left = Math.max(0, d.deadline - (Date.now() + offset));
    timer.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    timer.className = 'timer' + (left < 60000 ? ' low' : '');
    if (left <= 0) finish(true);
  }, 500);
  const finish = safe(async (auto) => {
    if (finished) return; finished = true; clearInterval(tick);
    const r = await api(`/api/tests/${id}/submit`, {});
    if (auto) toast('Time is up. Your test was handed in.');
    showTestResult(r.result);
  });
  function show(i) {
    idx = i;
    const s = d.scenarios[i];
    dots.replaceChildren(...d.scenarios.map((x, j) => h('button', { class: `${answered.has(x.id) ? 'done' : ''} ${j === i ? 'on' : ''}`, onclick: () => show(j), title: x.title }, j + 1)));
    const form = scenarioForm(s, { submitLabel: 'Save & next', onSubmit: async (sub) => {
      await api(`/api/tests/${id}/answer`, { scenarioId: s.id, ...sub });
      answered.add(s.id); toast('Saved');
      const nxt = d.scenarios.findIndex((x, j) => j > idx && !answered.has(x.id));
      const any = d.scenarios.findIndex((x) => !answered.has(x.id));
      if (nxt >= 0) show(nxt); else if (any >= 0) show(any); else toast('All calls saved. Hand in when you are ready.');
    } });
    body.replaceChildren(h('h2', {}, `Call ${i + 1} of ${d.scenarios.length}: ${s.title}`), form.el);
    window.scrollTo(0, 0);
  }
  handIn.onclick = () => {
    const missing = d.scenarios.length - answered.size;
    if (confirm(missing ? `${missing} call(s) are not saved and will count as wrong. Hand in anyway?` : 'Hand in your test? You cannot change answers after this.')) finish(false);
  };
  show(idx);
}

function showTestResult(r) {
  mount(h('button', { class: 'btn ghost small', onclick: () => go('tests') }, '← Tests'), h('p'),
    h('div', { class: `card result ${r.passed ? 'good' : 'bad'}` }, h('h1', {}, r.testName),
      h('div', { class: 'row' }, h('div', { class: 'big' }, `${r.correct} / ${r.total}`), h('span', { class: `tag ${r.passed ? 'pass' : 'fail'}` }, r.passed ? 'Passed' : 'Not passed yet'),
        h('span', { class: 'muted' }, `Needed ${r.passCount} calls right`))),
    r.rows.map((x) => [h('h2', {}, x.title), x.answered ? resultCard(x.result) : h('div', { class: 'card muted' }, 'No answer saved for this call.')]));
}

// ── my progress ──────────────────────────────────────────────────────
VIEWS.progress = async () => {
  const p = await api('/api/my/history');
  mount(h('h1', {}, 'My progress'),
    h('div', { class: 'grid2' }, h('div', { class: 'card stat s1' }, h('div', { class: 'small' }, 'Practice calls'), h('div', { class: 'big' }, p.tries)),
      h('div', { class: 'card stat s2' }, h('div', { class: 'small' }, 'Got right'), h('div', { class: 'big' }, p.tries ? `${Math.round(100 * p.passed / p.tries)}%` : '–'))),
    h('div', { class: 'card' }, h('h2', {}, 'Recent practice'), !p.recent.length ? h('p', { class: 'muted' }, 'Nothing yet.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Scenario'), h('th', {}, 'Result'), h('th', {}, 'To work on'), h('th', {}, 'When')),
        p.recent.map((r) => h('tr', {}, h('td', {}, r.title), h('td', {}, h('span', { class: `tag ${r.passed ? 'pass' : 'fail'}` }, r.passed ? 'Right' : 'Not yet')),
          h('td', { class: 'small' }, r.misses.join(', ') || '–'), h('td', { class: 'small muted' }, when(r.at)))))));
};

// ── admins: scenarios ────────────────────────────────────────────────
VIEWS['a-scenarios'] = async () => {
  const list = (await api('/api/admin/scenarios')).sort(bySkill);
  // Each pin skill needs 3 calls for a class: 2 to practise and 1 for the test.
  const count = (k) => list.filter((s) => s.category === k).length;
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Scenarios'),
      h('button', { class: 'btn ghost', onclick: () => go('a-lines') }, 'Standard lines'),
      h('button', { class: 'btn orange', onclick: () => newCall() }, '+ New call')),
    h('p', { class: 'lead' }, 'A scenario is a short pretend call: what the caller says, the place(s), the right pin and entrance, what the operator can say, and what the driver note must say. Use public places only, and made-up customer details.'),
    h('div', { class: 'card' }, h('h2', {}, 'Pin skills'), h('p', { class: 'small muted' }, 'Each pin skill needs 3 calls: 2 to practise and 1 for the test.'),
      h('div', { class: 'skill-counts' }, SKILLS().filter((k) => k !== 'Other' || count(k)).map((k) => h('div', { class: `skill-count ${count(k) >= 3 ? 'ok' : ''}` },
        h('b', {}, k), h('span', {}, count(k) >= 3 ? `${count(k)} calls ✓` : `${count(k)} of 3 calls`))))),
    h('div', { class: 'card' }, !list.length ? h('p', { class: 'muted' }, 'No scenarios yet. Start with the examples, or make your own from real cases.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Scenario'), h('th', {}, 'Pin skill'), h('th', {}, 'Stops'), h('th', {}, 'Tries'), h('th', {}, 'Got right'), h('th', {}, '')),
        list.map((s) => h('tr', {}, h('td', {}, h('b', {}, s.title), !s.practice ? h('div', {}, h('span', { class: 'tag' }, 'not in general practice')) : null),
          h('td', {}, s.category), h('td', {}, s.data.stops.map((x) => x.kind === 'dropoff' ? 'drop-off' : 'pickup').join(' + ')),
          h('td', {}, s.tries), h('td', {}, s.tries ? `${Math.round(100 * s.passes / s.tries)}%` : '–'),
          h('td', {}, h('button', { class: 'btn small', title: 'Do this call the way a trainee sees it', onclick: () => go(`s-${s.id}`) }, 'Try it'), ' ',
            s.practice ? h('button', { class: 'btn ghost small', title: 'Copy a link that opens this call', onclick: safe(async () => { await navigator.clipboard.writeText(`${location.origin}/#s-${s.id}`); toast('Link copied'); }) }, 'Copy link') : null, ' ',
            h('button', { class: 'btn ghost small', onclick: () => editScenario(s) }, 'Edit'), ' ',
            h('button', { class: 'btn ghost small', onclick: safe(async () => { if (!confirm(`Archive "${s.title}"? Past results keep it.`)) return; await api(`/api/admin/scenarios/${s.id}/archive`, {}); go('a-scenarios'); }) }, 'Archive')))))));
};

// The pin skill, picked with a button that explains it (one at a time).
function skillPicker(initial) {
  let value = SKILLS().includes(initial) ? initial : SKILLS()[0];
  const el = h('div', { class: 'skill-pick' });
  const draw = () => el.replaceChildren(...(CONFIG.pinSkills || []).filter((k) => k.name !== 'Other').map((k) => h('button', {
    type: 'button', class: `skill-btn ${k.name === value ? 'on' : ''}`, onclick: () => { value = k.name; draw(); } }, h('b', {}, k.name), h('span', {}, k.tip))));
  draw();
  return { el, get value() { return value; } };
}
// A row of numbered steps across the top; click one to jump to it.
function stepper(names, show) {
  const el = h('div', { class: 'stepper' });
  const set = (n) => el.replaceChildren(...names.map((nm, i) => h('button', { type: 'button', class: `step-pill ${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}`, onclick: () => show(i + 1) }, h('span', {}, i + 1), nm)));
  return { el, set };
}

// The call editor, one step at a time (Vee, 2026-10-07): 1 what it teaches, 2 what happened, 3 places and pins,
// 4 the customer and the ride, 5 the call itself. New calls come here after the guided questions (startStep 5).
function editScenario(existing, { startStep = 1 } = {}) {
  const d = existing ? structuredClone(existing.data) : {
    caller: 'Hi, I need a ride.', why: '', account: { home: null, saved: [] },
    stops: [{ kind: 'pickup', label: '', addressGiven: '', answer: null, start: null, entrances: [], correctEntrance: null }],
    questions: SUGGESTED_QUESTIONS.map((q) => ({ q, say: '', a: '', needed: false })), note: { mustMention: [], model: '' },
  };
  d.account = d.account || { home: null, saved: [] };
  d.steps = d.steps || [];
  // Lines that come from the standard lines: remember their wording, so a line reworded here becomes this call's own.
  d.questions.forEach((q) => { if (q.std) q._was = `${q.q}\n${q.say}\n${q.a}`; });
  const title = h('input', { type: 'text', value: existing?.title || '', placeholder: "e.g. Menchie's on Petrovitsky Road" });
  const cat = skillPicker(existing?.category || 'Place or business name');
  const story = h('textarea', { value: d.story || '', placeholder: 'What happened on the real call (no customer details).' });
  d.ride = d.ride || {}; d.ride.driver = d.ride.driver || {};
  const rideIn = (obj, key, ph) => h('input', { type: 'text', value: obj[key] || '', placeholder: ph, oninput: (e) => { obj[key] = e.target.value; } });
  const practice = h('input', { type: 'checkbox', checked: existing ? existing.practice : true });
  const caller = h('textarea', { value: d.caller, placeholder: 'What the caller says first, e.g. "Hi, I need a ride."' });
  const why = h('textarea', { value: d.why, placeholder: 'Shown after they answer: what goes wrong if you only use the address, and how to get it right.' });
  const stopsHost = h('div'), qHost = h('div'), acctHost = h('div'), stepsHost = h('div');
  const must = h('input', { type: 'text', value: d.note.mustMention.join(', '), placeholder: 'e.g. Menchie, blue, jeans' });
  d.note.options = d.note.options || [];
  const optsHost = h('div');
  // Practice note choices: 2-3 notes, one marked right. Tests always make them write the note.
  function drawNoteOptions() {
    optsHost.replaceChildren(...d.note.options.map((o, i) => {
      const t = h('input', { type: 'text', value: o.text, placeholder: i === 0 ? 'e.g. Two passengers. The female rider uses a walker, please assist her.' : 'A note that sounds fine but misses something', oninput: () => (o.text = t.value) });
      const r = h('input', { type: 'radio', name: 'note-right', checked: o.right, onchange: () => { d.note.options.forEach((x, j) => (x.right = j === i)); } });
      return h('div', { class: 'row' }, h('div', { class: 'grow' }, t), h('label', { class: 'check', style: 'margin:0' }, r, 'Right one'),
        h('button', { class: 'btn ghost small', onclick: () => { d.note.options.splice(i, 1); drawNoteOptions(); } }, '✕'));
    }), d.note.options.length < 4 ? h('button', { class: 'btn ghost small', onclick: () => { d.note.options.push({ text: '', right: !d.note.options.length }); drawNoteOptions(); } }, '+ Add a note choice') : null);
  }
  const model = h('textarea', { value: d.note.model, placeholder: "e.g. Customer is waiting at Menchie's Frozen Yogurt. Please call her if you can't find her. She is wearing a blue top and black jeans." });

  function drawStops() {
    stopsHost.replaceChildren(...d.stops.map((stop, si) => stopEditor(stop, si)),
      d.stops.length < 2 ? h('button', { class: 'btn ghost', onclick: () => { d.stops.push({ kind: d.stops[0].kind === 'pickup' ? 'dropoff' : 'pickup', label: '', addressGiven: '', answer: null, start: null, entrances: [], correctEntrance: null }); drawStops(); } },
        `+ Add a ${d.stops[0].kind === 'pickup' ? 'drop-off' : 'pickup'}`) : null);
  }
  function stopEditor(stop, si) {
    const kind = h('select', { onchange: () => { stop.kind = kind.value; } }, ['pickup', 'dropoff'].map((k) => h('option', { value: k, selected: k === stop.kind }, k === 'pickup' ? 'Pickup' : 'Drop-off')));
    const label = h('input', { type: 'text', value: stop.label, placeholder: "Name of the place, e.g. Menchie's Frozen Yogurt", oninput: () => (stop.label = label.value) });
    const given = h('input', { type: 'text', value: stop.addressGiven, placeholder: 'The address the caller gives', oninput: () => (stop.addressGiven = given.value) });
    const searchHost = h('div', { class: 'search' }), mapHost = h('div'), entHost = h('div');
    let pm = null;
    const drawEntrances = () => {
      entHost.replaceChildren(h('label', {}, 'Entrances (blue numbered pins, like the dashboard suggestions)'),
        !stop.entrances.length ? h('p', { class: 'small muted' }, 'None. Add one if the place has more than one door or side.') :
        stop.entrances.map((e, i) => {
          const nm = h('input', { type: 'text', value: e.name, oninput: () => (e.name = nm.value) });
          const right = h('input', { type: 'radio', name: `right-${si}`, checked: stop.correctEntrance === i, onchange: () => (stop.correctEntrance = i) });
          return h('div', { class: 'row' }, h('b', {}, `${i + 1}.`), h('div', { class: 'grow' }, nm), h('label', { class: 'check', style: 'margin:0' }, right, 'Right one'),
            h('button', { class: 'btn ghost small', onclick: () => { stop.entrances.splice(i, 1); if (stop.correctEntrance === i) stop.correctEntrance = null; else if (stop.correctEntrance > i) stop.correctEntrance--; drawEntrances(); pm && pm.setEntrances(stop.entrances); } }, 'Remove'));
        }),
        h('button', { class: 'btn ghost small', onclick: () => {
          const p = pm && pm.getPin(); if (!p) return toast('Search the place first.', true);
          stop.entrances.push({ name: `Entrance ${stop.entrances.length + 1}`, ...p }); drawEntrances(); pm.setEntrances(stop.entrances);
        } }, '+ Add an entrance where the pin is now'));
    };
    const card = h('div', { class: `card stop ${stop.kind}` },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, `Stop ${si + 1}`), kind,
        si > 0 ? h('button', { class: 'btn ghost small', onclick: () => { d.stops.splice(si, 1); drawStops(); } }, 'Remove stop') : null),
      h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Place name'), label), h('div', {}, h('label', {}, 'Address the caller gives'), given)),
      h('label', {}, 'Search the place, then drag the pin to exactly where the driver should stop'), searchHost, mapHost, entHost);
    placeSearch(searchHost, async (p) => {
      stop.start = stop.start || { lat: p.lat, lng: p.lng };
      if (!stop.label) { stop.label = p.name; label.value = p.name; }
      if (!stop.addressGiven) { stop.addressGiven = p.address; given.value = p.address; }
      if (!pm) pm = await pinMap(mapHost, { start: p, kind: stop.kind, entrances: stop.entrances, onMove: (q) => (stop.answer = q) });
      pm && pm.setPin(p);
      stop.answer = { lat: p.lat, lng: p.lng };
    });
    if (stop.answer) pinMap(mapHost, { start: stop.start || stop.answer, kind: stop.kind, entrances: stop.entrances, onMove: (q) => (stop.answer = q) })
      .then((x) => { pm = x; if (pm) pm.setPin(stop.answer); });
    drawEntrances();
    return card;
  }
  // The pretend customer's account: a made-up home address and saved places (which may be wrong on purpose).
  function drawAccount() {
    const placeRow = (p, onClear) => h('div', { class: 'row' }, h('b', {}, p.label), h('span', { class: 'small muted grow' }, p.address), h('button', { class: 'btn ghost small', onclick: onClear }, 'Remove'));
    const homeSearch = h('div', { class: 'search' }), savedSearch = h('div', { class: 'search' });
    const savedLabel = h('input', { type: 'text', placeholder: 'Label, e.g. Doctor, Daughter, Old pickup spot' });
    acctHost.replaceChildren(
      h('label', {}, 'Home address on the account (the ⌂ button fills it in). Made up, never a real customer.'),
      d.account.home ? placeRow(d.account.home, () => { d.account.home = null; drawAccount(); }) : homeSearch,
      h('label', {}, 'Saved locations (up to 3). Add a wrong one on purpose to teach "don’t trust saved locations blindly".'),
      d.account.saved.map((p, i) => placeRow(p, () => { d.account.saved.splice(i, 1); drawAccount(); })),
      d.account.saved.length < 3 ? h('div', { class: 'grid2' }, savedLabel, savedSearch) : null,
      h('label', {}, 'Is one of the saved locations wrong on purpose? What should the operator do with it?'),
      h('div', { class: 'row' },
        h('select', { onchange: (e) => { const v = e.target.value; d.savedFix = v ? { ...(d.savedFix || { action: 'update', stop: 'pickup' }), slot: Number(v) } : null; drawAccount(); } },
          h('option', { value: '' }, 'None wrong'), [3, 4, 5].map((n) => h('option', { value: n, selected: d.savedFix?.slot === n }, `Custom Location #${n} is wrong`))),
        d.savedFix ? h('select', { onchange: (e) => (d.savedFix.action = e.target.value) },
          h('option', { value: 'update', selected: d.savedFix.action !== 'delete' }, 'Fix the pin and save over it (they go there often)'),
          h('option', { value: 'delete', selected: d.savedFix.action === 'delete' }, 'Delete it (they do not go there often)')) : null,
        d.savedFix ? h('select', { onchange: (e) => (d.savedFix.stop = e.target.value) },
          h('option', { value: 'pickup', selected: d.savedFix.stop !== 'dropoff' }, 'It is the pickup place'),
          h('option', { value: 'dropoff', selected: d.savedFix.stop === 'dropoff' }, 'It is the drop-off place')) : null));
    placeSearch(homeSearch, (p) => { d.account.home = { label: 'Home', address: p.address, lat: p.lat, lng: p.lng }; drawAccount(); });
    placeSearch(savedSearch, (p) => { d.account.saved.push({ label: savedLabel.value || p.name, address: p.address, lat: p.lat, lng: p.lng }); drawAccount(); });
  }
  function drawQuestions() {
    qHost.replaceChildren(...d.questions.map((q, i) => {
      const qq = h('input', { type: 'text', value: q.q, placeholder: 'Button, e.g. Read the address back', oninput: () => { q.q = qq.value; drawSteps(); } });
      const say = h('input', { type: 'text', value: q.say || '', placeholder: 'What you say (optional), e.g. Okay, that is 14060...', oninput: () => (q.say = say.value) });
      const aa = h('input', { type: 'text', value: q.a, placeholder: 'What the caller answers', oninput: () => (q.a = aa.value) });
      const need = h('input', { type: 'checkbox', checked: q.needed, onchange: () => (q.needed = need.checked) });
      return h('div', { class: 'qrow' }, qq, say, aa, h('label', { class: 'check', style: 'margin:0' }, need, 'Must ask'),
        h('button', { class: 'btn ghost small', onclick: () => { d.questions.splice(i, 1); d.steps = shiftSteps(d.steps, (x) => (x === i ? -1 : x > i ? x - 1 : x)); drawQuestions(); } }, '✕'));
    }), h('button', { class: 'btn ghost small', onclick: () => { d.questions.push({ q: '', say: '', a: '', needed: false }); drawQuestions(); } }, '+ Add a line'));
    drawSteps();
  }
  // Steps point at lines by their place in the list; when lines move, point them at the new places (-1 = gone).
  const shiftSteps = (steps, to) => steps.map((st) => ({ choices: st.choices.map(to).filter((x) => x >= 0), right: st.right.map(to).filter((x) => x >= 0) }));
  // The call in steps. Each line is a chip: click once = shown as a choice, twice = a right answer (green), three times = off.
  // Lines that were right at an earlier step don't come back later.
  function drawSteps() {
    stepsHost.replaceChildren(...d.steps.map((st, n) => {
      const earlier = new Set(d.steps.slice(0, n).flatMap((x) => x.right));
      const chips = d.questions.map((q, i) => [q, i]).filter(([q, i]) => q.q && !earlier.has(i)).map(([q, i]) => {
        const state = st.right.includes(i) ? 'right' : st.choices.includes(i) ? 'shown' : '';
        return h('button', { class: `stepchip ${state}`, type: 'button', title: 'Click: choice → right answer → off', onclick: () => {
          if (state === '') st.choices.push(i);
          else if (state === 'shown') st.right.push(i);
          else { st.right = st.right.filter((x) => x !== i); st.choices = st.choices.filter((x) => x !== i); }
          drawSteps();
        } }, state === 'right' ? `✓ ${q.q}` : q.q);
      });
      const move = (to) => { const [x] = d.steps.splice(n, 1); d.steps.splice(to, 0, x); drawSteps(); };
      return h('div', { class: 'step-edit' },
        h('div', { class: 'row' }, h('b', {}, `Step ${n + 1}`),
          h('span', { class: `small grow ${st.right.length ? 'muted' : 'warn'}` }, `${st.choices.length} shown · ${st.right.length} right${st.right.length ? '' : ' (pick at least one)'}`),
          n > 0 ? h('button', { class: 'btn ghost small', title: 'Move up', onclick: () => move(n - 1) }, '↑') : null,
          n < d.steps.length - 1 ? h('button', { class: 'btn ghost small', title: 'Move down', onclick: () => move(n + 1) }, '↓') : null,
          h('button', { class: 'btn ghost small', onclick: () => { d.steps.splice(n, 1); drawSteps(); } }, '✕')),
        h('div', { class: 'qbtns' }, chips));
    }), h('button', { class: 'btn ghost small', onclick: () => { d.steps.push({ choices: [], right: [] }); drawSteps(); } }, '+ Add a step'));
  }

  // Everything on the five steps, put together: used by Save and by "Draft the call with Claude".
  function collect() {
    const empty = d.steps.findIndex((st) => !st.right.length);
    if (empty >= 0) throw new Error(`Step ${empty + 1} has no right answer. Click a line twice to mark it right, or remove the step.`);
    // Lines with no answer are dropped, so point the steps at where the kept lines end up.
    const kept = d.questions.map((q, i) => [q, i]).filter(([q]) => q.q && q.a);
    const newAt = new Map(kept.map(([, i], n) => [i, n]));
    const own = (q) => { const { _was, ...rest } = q; if (rest.std && _was !== `${rest.q}\n${rest.say}\n${rest.a}`) delete rest.std; return rest; };
    const data = { ...d, caller: caller.value, why: why.value, story: story.value, questions: kept.map(([q]) => own(q)),
      steps: shiftSteps(d.steps, (x) => (newAt.has(x) ? newAt.get(x) : -1)),
      note: { mustMention: must.value.split(',').map((x) => x.trim()).filter(Boolean), model: model.value, options: d.note.options.filter((o) => o.text.trim()) } };
    if (data.note.options.length === 1) throw new Error('Give at least 2 note choices, or none.');
    if (data.note.options.length && !data.note.options.some((o) => o.right)) throw new Error('Mark which note choice is the right one.');
    if (data.steps.some((st) => !st.right.length)) throw new Error('A step’s right answer is a line with no caller answer. Fill in the answer first.');
    if (data.stops.some((x) => !x.answer)) throw new Error('Search each stop and place its pin first (step 3).');
    return data;
  }
  const saveBtn = h('button', { class: 'btn orange', onclick: safe(async () => {
    const data = collect();
    await api('/api/admin/scenarios', { id: existing?.id, version: existing?.version, title: title.value, category: cat.value, practice: practice.checked, data });
    toast('Saved'); go('a-scenarios');
  }) }, 'Save the call');
  // Claude writes only what is special (first line, moments like an anniversary, the Why, the note and its choices).
  const draftBtn = h('button', { class: 'btn', disabled: true, title: 'Checking the Anthropic key…', onclick: safe(async () => {
    draftBtn.disabled = true; draftBtn.textContent = 'Claude is drafting… (about a minute)';
    try {
      const r = await api('/api/admin/scenarios/draft', { data: collect(), title: title.value, category: cat.value, story: story.value });
      editScenario({ ...(existing || {}), title: title.value, category: cat.value, practice: practice.checked, data: r.data }, { startStep: 5 });
      toast(`Drafted. Check every line before you save. (This draft cost about ${r.cost.cents}¢.)`);
    } finally { draftBtn.disabled = false; draftBtn.textContent = 'Draft the call with Claude'; }
  }) }, 'Draft the call with Claude');
  api('/api/admin/draft/status').then((st) => { draftBtn.disabled = !st.ready; draftBtn.title = st.ready ? '' : 'Needs ANTHROPIC_API_KEY in Railway'; }).catch(() => {});

  const panels = [
    [h('div', { class: 'card' }, h('h2', {}, 'What this call teaches'),
      h('label', {}, 'Name of the call (trainees see it, so do not give the answer away)'), title,
      h('label', {}, 'Pick one'), cat.el,
      h('label', { class: 'check' }, practice, 'Show in general practice (untick to use it only in practice sets and tests)'))],
    [h('div', { class: 'card' }, h('h2', {}, 'What happened'),
      h('label', {}, 'What happened on the real call (cleaned, no customer details)'), story,
      h('label', {}, 'What the caller says first'), caller,
      h('label', {}, 'Why (trainees read this after they answer)'), why)],
    [stopsHost, h('div', { class: 'card' }, h('h2', {}, 'The customer’s account'), acctHost)],
    [h('div', { class: 'card' }, h('h2', {}, 'The customer and the ride'),
      h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Made-up customer name'), rideIn(d.ride, 'customerName', 'e.g. Rick Sanchez')),
        h('div', {}, h('label', {}, 'Estimate (GoGo Cost)'), rideIn(d.ride, 'cost', 'e.g. $23 ~ $25'))),
      h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Driver'), rideIn(d.ride.driver, 'name', 'e.g. Yoandris')),
        h('div', {}, h('label', {}, 'Car'), rideIn(d.ride.driver, 'car', 'e.g. Red Mazda CX-5'))),
      h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Plate'), rideIn(d.ride.driver, 'plate', 'e.g. AWYY')),
        h('div', {}, h('label', {}, 'Arriving in'), rideIn(d.ride.driver, 'eta', 'e.g. 10 minutes'))))],
    [h('div', { class: 'card draft-card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h2', {}, 'Let Claude finish it (optional)'),
        h('p', { class: 'small muted' }, 'Claude reads "What happened" and writes the caller\'s first line, special moments (an anniversary, a walker…), the Why and the driver note. It never moves a pin. Check everything before you save.')), draftBtn)),
      h('div', { class: 'card' }, h('h2', {}, 'What the operator can say'), h('p', { class: 'small muted' }, 'Each line: a short button, the full line they say, and the caller’s answer. Lines with no answer are dropped.'), qHost),
      h('div', { class: 'card' }, h('h2', {}, 'The call, step by step'),
        h('p', { class: 'small muted' }, 'Trainees see one step at a time. Click a line once to show it as a choice, twice to make it a right answer (green ✓), a third time to take it off. Three choices works best. A step can have two right answers. Practice: a wrong pick says "Not quite" and they try again (still a miss). Test: the call goes on and it is graded at the end.'),
        stepsHost),
      h('div', { class: 'card' }, h('h2', {}, 'Driver note'),
        h('label', {}, 'The note must mention (comma separated). The What Are You Wearing Today? box counts too.'), must,
        h('label', {}, 'A good note (shown after they answer)'), model,
        h('label', {}, 'Note choices for practice (optional). In practice they pick one; in a test they always write it. Give 2 or 3, and mark the right one.'), optsHost)],
  ].map((kids) => h('div', { class: 'step-panel' }, kids));
  const names = ['What it teaches', 'What happened', 'Places & pins', 'Customer & ride', 'The call'];
  let current = 1;
  const nav = h('div', { class: 'row step-nav' });
  const top = stepper(names, (n) => show(n));
  function show(n) {
    current = n; top.set(n);
    panels.forEach((pn, i) => { pn.style.display = i + 1 === n ? '' : 'none'; });
    nav.replaceChildren(n > 1 ? h('button', { class: 'btn ghost', onclick: () => show(n - 1) }, '← Back') : null, h('span', { class: 'grow' }),
      n < panels.length ? h('button', { class: 'btn', onclick: () => show(n + 1) }, 'Next →') : null, saveBtn);
    window.scrollTo(0, 0);
  }
  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-scenarios') }, '← Scenarios'),
    h('h1', {}, existing?.id ? `Edit: ${existing.title}` : 'New call'), top.el, panels, nav);
  show(startStep);
  drawStops(); drawAccount(); drawQuestions(); drawNoteOptions();
}


// ── admins: the short "New call" screen ───────────────────────────────
// The trainer gives only what is unique: the place and its right pin, the customer, what happened. The call flow,
// the steps and the wrong picks come from GoGo's standard lines (built on the server). Pasted transcripts are cleaned
// HERE, in this browser, before anything is saved or sent: the raw text never leaves the page.
const MADE_UP_NAMES = ['Marge Simpson', 'Rick Sanchez', 'Leslie Knope', 'Ron Swanson', 'Fred Flintstone', 'Wilma Flintstone', 'Lucille Bluth',
  'Hank Hill', 'Peggy Hill', 'Bob Belcher', 'Linda Belcher', 'Phil Dunphy', 'Clair Dunphy', 'Dwight Schrute', 'Pam Beesly'];

function newCall() {
  const field = (label, el, hint) => h('div', {}, h('label', {}, label), el, hint ? h('div', { class: 'small muted' }, hint) : null);
  // A yes/no (or this/that) choice as two buttons.
  const choice = (opts, initial, onPick) => {
    let value = initial;
    const el = h('div', { class: 'choice' });
    const draw = () => el.replaceChildren(...opts.map(([v, label]) => h('button', { type: 'button', class: `choice-btn ${v === value ? 'on' : ''}`, onclick: () => { value = v; draw(); onPick && onPick(v); } }, label)));
    draw();
    return { el, get value() { return value; } };
  };
  const parseLL = (v) => { const [x, y] = String(v).split(',').map((n) => Number(n.trim())); return Number.isFinite(x) && Number.isFinite(y) ? { lat: x, lng: y } : null; };
  // A pin: search (Google), paste "Lat, Lng" from the dashboard, or start from another pin; then drag it on the map.
  // The map shows as soon as there is a pin, so the trainer always sees where it is (Vee, 2026-10-07).
  function pinField(kind, label, hint, from) {
    const st = { ll: null, name: '', address: '' };
    const searchHost = h('div', { class: 'search' }), mapHost = h('div', { class: 'pin-map' });
    let pm = null; // null = not made yet; false = no map on this site (made once, never repeated)
    const showMap = async (ll) => {
      if (!ll) return;
      if (pm === null) pm = (await pinMap(mapHost, { start: ll, kind, onMove: (q) => { st.ll = q; input.value = `${q.lat}, ${q.lng}`; } })) || false;
      pm && pm.setPin(ll);
    };
    const input = h('input', { type: 'text', placeholder: 'Lat, Lng (paste from the dashboard, or search below)', onchange: () => { st.ll = parseLL(input.value); showMap(st.ll); } });
    placeSearch(searchHost, async (pl) => {
      st.ll = { lat: pl.lat, lng: pl.lng }; st.name = pl.name; st.address = pl.address; input.value = `${pl.lat}, ${pl.lng}`;
      await showMap(pl); onPicked && onPicked(pl);
    });
    const fromBtn = from ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => {
      if (!from.st.ll) return toast('Put the wrong pin first.', true);
      st.ll = { ...from.st.ll }; input.value = `${st.ll.lat}, ${st.ll.lng}`; showMap(st.ll);
    } }, 'Start from the wrong pin, then drag it to the right spot') : null;
    let onPicked = null;
    return { st, set onPick(fn) { onPicked = fn; }, el: h('div', { class: 'pin-field' }, h('label', {}, label), input, hint ? h('div', { class: 'small muted' }, hint) : null,
      h('div', { class: 'row' }, fromBtn), searchHost, h('div', { class: 'small muted' }, 'The map shows here once there is a pin. Drag the pin to adjust it.'), mapHost) };
  }

  // Step 1: what it teaches
  const title = h('input', { type: 'text', placeholder: 'e.g. Dinner at a restaurant downtown (trainees see it, so do not give the answer away)' });
  const cat = skillPicker('Place or business name');

  // Step 2: what happened, from a transcript (cleaned right here) or in the trainer's own words
  let cleaned = null;
  const story = h('textarea', { placeholder: 'e.g. The caller named the restaurant, the operator only typed the address, and the couple were almost dropped off at the wrong place.' });
  const paste = h('textarea', { placeholder: 'Paste the call transcript here, then press "Take out customer details".' });
  const extra = h('input', { type: 'text', placeholder: 'Any names to remove that it missed, separated by commas' });
  const review = h('div', { class: 'clean-review' });
  function drawReview() {
    review.replaceChildren(h('div', { class: 'small muted' }, 'Removed parts are highlighted. Click any other word to remove it too. Only this cleaned text is kept.'),
      h('div', { class: 'clean-text' }, cleaned.parts.flatMap((part) => part.kind
        ? [h('span', { class: 'clean-gone', title: 'Removed' }, part.text)]
        : part.text.split(/(\s+)/).map((w) => (/^\s+$/.test(w) || !w ? w : h('span', { class: 'clean-word', title: 'Click to remove', onclick: () => {
          const at = cleaned.parts.indexOf(part); const bits = part.text.split(/(\s+)/); let done = false; const before = [], after = [];
          for (const x of bits) { if (!done && x === w) { done = true; continue; } (done ? after : before).push(x); }
          cleaned.parts.splice(at, 1, { text: before.join('') }, { text: '[REMOVED]', kind: 'REMOVED' }, { text: after.join('') });
          drawReview();
        } }, w))))));
  }
  const cleanBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
    if (!paste.value.trim()) return toast('Paste the transcript first.', true);
    cleaned = cleanTranscript(paste.value, extra.value.split(',').map((x) => x.trim()));
    paste.value = ''; paste.style.display = 'none'; cleanBtn.style.display = 'none'; extra.style.display = 'none';
    drawReview();
  } }, 'Take out customer details');
  const describeBox = h('div', {}, h('p', { class: 'small muted' }, 'Write what happened in your own words: what the caller wanted, what the operator did, and what went wrong. No customer names, phone numbers or home addresses.'), story);
  const pasteBox = h('div', { style: 'display:none' }, h('p', { class: 'small muted' }, 'Paste the transcript of the real call where this happened. Phone numbers, emails, dates, addresses and names are taken out on this page before anything is kept or sent. Check the result: click any word it missed.'),
    paste, extra, h('div', { class: 'row' }, cleanBtn), review);
  const how = choice([['write', 'Write it yourself'], ['paste', 'Paste the call transcript']], 'write', (v) => { describeBox.style.display = v === 'write' ? '' : 'none'; pasteBox.style.display = v === 'paste' ? '' : 'none'; });
  const storyText = () => (how.value === 'paste' ? (cleaned ? cleaned.parts.map((x) => x.text).join('') : '') : story.value);
  const why = h('textarea', { placeholder: 'What went wrong on the real call, and how to get it right. Trainees read this after they answer.' });
  story.addEventListener('blur', () => { if (!why.value.trim()) why.value = story.value; });

  // Step 3: the address with the problem
  const homeAddr = h('input', { type: 'text', placeholder: 'Home address as it shows on the account' });
  const homeSearch = h('div', { class: 'search' });
  placeSearch(homeSearch, (pl) => { homeAddr.value = pl.address; });
  const homeRight = pinField('pickup', 'Where the home really is (the right pin)', 'The spot the driver should go to.');
  const homeWrong = pinField('pickup', 'Where the system has the home pin (the wrong one)', 'Saved when they registered.');
  const homeRightFrom = pinField('pickup', 'Where the home really is (the right pin)', 'The spot the driver should go to.', homeWrong);
  const placeName = h('input', { type: 'text', placeholder: 'e.g. Torikaya' });
  const placeGiven = h('input', { type: 'text', placeholder: 'e.g. 1120 Houston Street, Chattanooga, TN 37402' });
  const placeWrong = pinField('dropoff', 'Where the wrong pin is', 'Where the address alone puts it, or where the operator / the saved location had it.');
  const placeRight = pinField('dropoff', 'The right spot', 'Where the driver should stop. Search the place by name, then drag the pin a little in front of the entrance.', placeWrong);
  placeWrong.onPick = (pl) => { if (!placeGiven.value) placeGiven.value = pl.address; };
  placeRight.onPick = (pl) => { if (!placeName.value) placeName.value = pl.name; };
  // New caller: the wrong pin first, then the right one (which can start from the wrong one). Otherwise just the home pin.
  const newCaller = choice([['no', 'No'], ['yes', 'Yes, a new caller']], 'no', (v) => {
    homeWrong.el.style.display = homeRightFrom.el.style.display = v === 'yes' ? '' : 'none'; homeRight.el.style.display = v === 'yes' ? 'none' : ''; });
  homeWrong.el.style.display = 'none'; homeRightFrom.el.style.display = 'none';
  const savedWrong = choice([['no', 'No'], ['yes', 'Yes, saved with the wrong pin']], 'no', (v) => { oftenRow.style.display = v === 'yes' ? '' : 'none'; });
  const often = choice([['yes', 'Yes, often'], ['no', 'No, not often']], 'yes');
  const oftenRow = h('div', { style: 'display:none' }, field('Do they go there often? (often = fix it and save it; not often = remove it)', often.el));
  const homeBox = h('div', {}, field('Home address on the account', homeAddr, 'Search it below, or type it as it shows on the dashboard.'), homeSearch,
    field('Is this a new caller? Their home was saved when they registered, and the pin may be wrong.', newCaller.el), homeRight.el, homeWrong.el, homeRightFrom.el);
  const placeBox = h('div', { style: 'display:none' }, h('div', { class: 'grid2' }, field('Name of the place', placeName), field('The address the caller gives', placeGiven)),
    field('Was this place saved on their account with the wrong pin?', savedWrong.el), oftenRow, placeWrong.el, placeRight.el);
  const which = choice([['pickup', 'The pickup'], ['dropoff', 'The drop-off']], 'pickup');
  const isHome = choice([['home', 'Yes, their home'], ['place', 'No, a place or business']], 'home', (v) => { homeBox.style.display = v === 'home' ? '' : 'none'; placeBox.style.display = v === 'place' ? '' : 'none'; });

  // Step 4: the other address, the customer and the ride
  const customer = h('input', { type: 'text', value: MADE_UP_NAMES[Math.floor(Math.random() * MADE_UP_NAMES.length)] });
  const otherName = h('input', { type: 'text', placeholder: 'e.g. Menchie\u2019s Frozen Yogurt' });
  const otherGiven = h('input', { type: 'text', placeholder: 'The address the caller gives' });
  const otherPin = pinField('dropoff', 'The right spot', 'Search the place, or paste Lat, Lng.');
  otherPin.onPick = (pl) => { if (!otherName.value) otherName.value = pl.name; if (!otherGiven.value) otherGiven.value = pl.address; };
  const otherHomeAddr = h('input', { type: 'text', placeholder: 'Home address as it shows on the account' });
  const otherHomePin = pinField('dropoff', 'Where the home is', 'Search it, or paste Lat, Lng.');
  otherHomePin.onPick = (pl) => { if (!otherHomeAddr.value) otherHomeAddr.value = pl.address; };
  const otherPlaceBox = h('div', {}, h('div', { class: 'grid2' }, field('Name of the place', otherName), field('The address the caller gives', otherGiven)), otherPin.el);
  const otherHomeBox = h('div', { style: 'display:none' }, field('Home address on the account', otherHomeAddr), otherHomePin.el);
  const otherIs = choice([['place', 'A place or business'], ['home', 'Their home']], 'place', (v) => { otherPlaceBox.style.display = v === 'place' ? '' : 'none'; otherHomeBox.style.display = v === 'home' ? '' : 'none'; });
  const otherLabel = h('h2', {}, 'The other address');
  const wearing = h('input', { type: 'text', placeholder: 'e.g. A blue top and black jeans.' });
  const notesAnswer = h('input', { type: 'text', value: "No, that's all.", placeholder: 'e.g. Yes, my wife uses a walker.' });
  const low = h('input', { type: 'number', min: 1, value: 10 }), high = h('input', { type: 'number', min: 1, value: 12 });
  const drName = h('input', { type: 'text', value: 'Lidong' }), drCar = h('input', { type: 'text', value: 'Black Toyota Sienna' });
  const drPlate = h('input', { type: 'text', value: '0734' }), drEta = h('input', { type: 'text', value: '5 minutes' });
  const caller = h('input', { type: 'text', placeholder: 'Leave empty for a standard opening (Claude can write one in the next screen).' });

  const panels = [
    [h('div', { class: 'card' }, h('h2', {}, 'What does this call teach?'), field('Name of the call', title), h('label', {}, 'Pick one'), cat.el)],
    [h('div', { class: 'card' }, h('h2', {}, 'What happened?'), h('p', { class: 'small muted' }, 'Two ways to tell us: paste the transcript of the real call where the problem happened, or write the scenario yourself.'),
      how.el, describeBox, pasteBox, field('Why (trainees read this after they answer)', why))],
    [h('div', { class: 'card' }, h('h2', {}, 'The address with the problem'),
      h('p', { class: 'small muted' }, 'Every call has both a pickup and a drop-off. Here, tell us about the one that had the problem; the next step asks about the other one. Together they decide how the call goes.'),
      field('Which address had the problem?', which.el), field('Was that address the customer\u2019s home?', isHome.el), homeBox, placeBox)],
    [h('div', { class: 'card' }, otherLabel, field('The other address is', otherIs.el), otherPlaceBox, otherHomeBox),
      h('div', { class: 'card' }, h('h2', {}, 'The customer and the ride'),
        h('div', { class: 'grid2' }, field('Made-up customer name (never a real customer)', customer),
          h('div', {}, h('label', {}, '\u00a0'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => { customer.value = MADE_UP_NAMES[Math.floor(Math.random() * MADE_UP_NAMES.length)]; } }, 'Pick another made-up name'))),
        field('Their first line', caller), field('What they are wearing (asked when the pickup is not home)', wearing), field('Their answer when asked for driver notes', notesAnswer),
        h('div', { class: 'grid2' }, field('Estimate from ($)', low), field('to ($)', high)),
        h('div', { class: 'grid2' }, field('Driver', drName), field('Car', drCar)), h('div', { class: 'grid2' }, field('Plate', drPlate), field('Arriving in', drEta)))],
  ].map((kids) => h('div', { class: 'step-panel' }, kids));

  async function build() {
    const p = which.value, o = p === 'pickup' ? 'dropoff' : 'pickup';
    let home = null;
    const problem = {}, other = {};
    if (isHome.value === 'home') {
      const right = newCaller.value === 'yes' ? homeRightFrom.st.ll : homeRight.st.ll;
      if (!right) throw new Error('Step 3: put the right pin for the home.');
      home = { address: homeAddr.value, ...right };
      problem.home = true;
      if (newCaller.value === 'yes') { if (!homeWrong.st.ll) throw new Error('Step 3: put the wrong home pin (where the system has it).'); problem.wrong = homeWrong.st.ll; }
    } else {
      problem.place = { label: placeName.value, addressGiven: placeGiven.value, start: placeWrong.st.ll, answer: placeRight.st.ll, saved: savedWrong.value === 'yes', often: often.value === 'yes' };
    }
    if (otherIs.value === 'home') {
      if (home) throw new Error('Step 4: the other address cannot be home too.');
      if (!otherHomePin.st.ll) throw new Error('Step 4: put the pin for the home.');
      home = { address: otherHomeAddr.value, ...otherHomePin.st.ll }; other.home = true;
    } else other.place = { label: otherName.value, addressGiven: otherGiven.value, answer: otherPin.st.ll };
    return api('/api/admin/scenarios/build-preview', {
      title: title.value, category: cat.value, customerName: customer.value, story: storyText(), why: why.value, home,
      [p]: problem, [o]: other, wearing: wearing.value, notesAnswer: notesAnswer.value, caller: caller.value,
      ride: { low: Number(low.value), high: Number(high.value), driver: { name: drName.value, car: drCar.value, plate: drPlate.value, eta: drEta.value } },
    });
  }
  const names = ['What it teaches', 'What happened', 'The address with the problem', 'The other address & the ride'];
  const nav = h('div', { class: 'row step-nav' });
  const top = stepper(names, (n) => show(n));
  function show(n) {
    top.set(n);
    panels.forEach((pn, i) => { pn.style.display = i + 1 === n ? '' : 'none'; });
    otherLabel.textContent = which.value === 'pickup' ? 'The drop-off' : 'The pickup';
    nav.replaceChildren(n > 1 ? h('button', { class: 'btn ghost', onclick: () => show(n - 1) }, '\u2190 Back') : null, h('span', { class: 'grow' }),
      n < panels.length ? h('button', { class: 'btn', onclick: () => show(n + 1) }, 'Next \u2192')
        : h('button', { class: 'btn orange', onclick: safe(async () => {
          const r = await build();
          editScenario({ title: r.title, category: r.category, practice: true, data: r.data }, { startStep: 5 });
          toast('The call is built. Check it, let Claude finish it if you like, then save.');
        }) }, 'Build the call \u2192'));
    window.scrollTo(0, 0);
  }
  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-scenarios') }, '\u2190 Scenarios'), h('h1', {}, 'New call'),
    h('p', { class: 'lead' }, 'Answer a few questions. The rest of the call (greeting, name, contact number, read-backs, notes, estimate, driver, closing) is built from the Standard lines, in the right order, with wrong picks chosen for you.'),
    top.el, panels, nav);
  show(1);
}

// ── admins: GoGo's standard lines ────────────────────────────────────
VIEWS['a-lines'] = async () => {
  const { lines, placeholders } = await api('/api/admin/standard-lines');
  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-scenarios') }, '← Scenarios'),
    h('h1', {}, 'Standard lines'),
    h('p', { class: 'lead' }, 'The lines every call has, written once. Change one here and every call made with "New call" says it the new way. Words in {curly brackets} are filled in from each call.'),
    h('div', { class: 'card small' }, h('b', {}, 'Fill-ins: '), Object.entries(placeholders).map(([k, v]) => h('span', { class: 'ph' }, h('code', {}, `{${k}}`), ` ${v}`))),
    lines.map((l) => {
      const q = h('input', { type: 'text', value: l.q }), say = h('textarea', { value: l.say }), a = h('input', { type: 'text', value: l.a });
      return h('div', { class: 'card' }, h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Button'), q), h('div', {}, h('label', {}, 'Caller answers'), a)),
        h('label', {}, 'What the operator says'), say,
        h('button', { class: 'btn small', onclick: safe(async () => { await api('/api/admin/standard-lines', { key: l.key, q: q.value, say: say.value, a: a.value }); toast('Saved. Every New call now uses it.'); }) }, 'Save'));
    }));
};

// ── admins: practice sets & tests ────────────────────────────────────
// Each class has ONE link, ending with its name: …/class/october-2026. It shows that class's open practice and tests.
const classLink = (slug, mode = 'practice') => `${location.origin}/class/${slug}/${mode}`;
const copyClassLink = (slug, mode = 'practice') => safe(async () => { await navigator.clipboard.writeText(classLink(slug, mode)); toast(`${mode === 'test' ? 'Test' : 'Practice'} link copied. Send it to the class.`); });

VIEWS['a-tests'] = async () => {
  const [tests, classes] = await Promise.all([api('/api/admin/tests'), api('/api/admin/classes')]);
  const setStatus = (t, status) => safe(async () => { await api(`/api/admin/tests/${t.id}/status`, { status }); go('a-tests'); });
  const del = (t) => safe(async () => {
    const kind = t.mode === 'practice' ? 'practice set' : 'test';
    const warn = t.mode === 'test' && t.started ? `\n\n${t.started} ${t.started === 1 ? 'person has' : 'people have'} started it. Their results will no longer show on Results.` : '';
    if (!confirm(`Delete the ${kind} "${t.name}" (${t.class_name || 'no class'})?${warn}`)) return;
    await api(`/api/admin/tests/${t.id}/delete`, {}); toast('Deleted'); go('a-tests');
  });
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Practice & tests'),
      h('button', { class: 'btn', onclick: () => editGroup(null, tests, classes, 'practice') }, '+ New practice'),
      h('button', { class: 'btn orange', onclick: () => editGroup(null, tests, classes, 'test') }, '+ New test')),
    h('p', { class: 'lead' }, 'Give a class its practice first; make the test when they are ready. Each class has one link that ends with its name: whoever opens it joins the class and sees its open practice and tests. Practice can be done any number of times; a test is timed, one go.'),
    h('div', { class: 'card' }, !tests.length ? h('p', { class: 'muted' }, 'Nothing yet.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Kind'), h('th', {}, 'Class'), h('th', {}, 'Done by'), h('th', {}, 'Status'), h('th', {}, '')),
        tests.map((t) => h('tr', {}, h('td', {}, h('b', {}, t.name), h('div', { class: 'small muted' }, t.mode === 'practice' ? `${t.questions} calls` : `${t.pass_count} of ${t.questions} right · ${t.pass_meters} m · ${t.time_limit_min} min`)),
          h('td', {}, h('span', { class: 'tag' }, t.mode === 'practice' ? 'Practice' : 'Test')),
          h('td', {}, t.class_name || '–', t.classSlug ? h('div', { class: 'small muted' }, `/class/${t.classSlug}/${t.mode}`) : null),
          h('td', {}, t.mode === 'practice' ? `${t.practised} practised` : `${t.handed_in} handed in`),
          h('td', {}, h('span', { class: `tag ${t.status === 'open' ? 'pass' : ''}` }, t.status === 'draft' ? 'draft (hidden)' : t.status)),
          h('td', { class: 'actions' },
            t.classSlug ? h('button', { class: 'btn ghost small', onclick: copyClassLink(t.classSlug, t.mode) }, t.mode === 'practice' ? 'Copy practice link' : 'Copy test link') : null,
            h('button', { class: 'btn ghost small', onclick: () => editGroup(t, tests, classes, t.mode) }, 'Edit'),
            t.status === 'open' ? h('button', { class: 'btn ghost small', onclick: setStatus(t, 'closed') }, 'Close')
              : h('button', { class: 'btn small', onclick: setStatus(t, 'open') }, 'Open'),
            h('button', { class: 'btn ghost small danger', onclick: del(t) }, 'Delete')))))));
};

// A practice set or a test, made on its own (Vee: practice first, the test some time later). Editing one never
// touches the other: an older pair made together keeps its other half exactly as it is.
async function editGroup(t, tests, classes, mode = 'test') {
  const list = await api('/api/admin/scenarios');
  const grp = t ? t.grp : null;
  const mine = grp ? tests.filter((x) => x.grp === grp) : [];
  const pr = mine.find((x) => x.mode === 'practice');
  const te = mine.find((x) => x.mode === 'test');
  const role = new Map((mode === 'practice' ? pr?.scenarioIds || [] : te?.scenarioIds || []).map((id) => [id, mode]));
  const otherIds = mode === 'practice' ? te?.scenarioIds || [] : pr?.scenarioIds || [];
  const locked = te && te.started > 0; // test calls can't change once someone started
  const base = mode === 'practice' ? pr : te;
  const name = h('input', { type: 'text', value: base?.name || '', placeholder: 'e.g. October 2026 pins' });
  const cls = h('select', {}, h('option', { value: '' }, 'Choose…'), classes.filter((c) => c.active || c.id === base?.class_id).map((c) => h('option', { value: c.id, selected: c.id === base?.class_id }, c.name)));
  const meters = h('input', { type: 'number', min: 1, max: 200, value: te?.pass_meters ?? 15 });
  const count = h('input', { type: 'number', min: 1, value: te?.pass_count ?? 4 });
  const mins = h('input', { type: 'number', min: 1, max: 240, value: te?.time_limit_min ?? 30 });
  const tally = h('span', { class: 'tag' });
  const upd = () => { tally.textContent = `${role.size} call${role.size === 1 ? '' : 's'}`; };
  upd();
  const linkNote = h('div', { class: 'small muted' });
  const showLink = () => { const c = classes.find((k) => k.id === Number(cls.value)); linkNote.textContent = c ? `${mode === 'practice' ? 'Practice' : 'Test'} link: ${classLink(c.slug, mode)}` : ''; };
  cls.onchange = showLink; showLink();
  const word = mode === 'practice' ? 'practice' : 'test';
  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-tests') }, '← Practice & tests'), h('h1', {}, t ? `Edit ${word}` : `New ${word}`),
    h('div', { class: 'card' }, h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Name'), name), h('div', {}, h('label', {}, 'Class'), cls, linkNote)),
      mode === 'test' ? [h('h3', {}, 'Test settings'),
        h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'A pin counts as right within (metres)'), meters),
          h('div', {}, h('label', {}, 'To pass, calls right needed'), count)), h('label', {}, 'Time limit (minutes)'), mins] : null),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Scenarios'), tally),
      locked && mode === 'test' ? h('p', { class: 'tag warn' }, `${te.started} ${te.started === 1 ? 'person has' : 'people have'} started the test, so its calls are locked.`) : null,
      !list.length ? h('p', { class: 'muted' }, 'Add scenarios first.') :
      h('table', {}, h('tr', {}, h('th', {}, `In this ${word}`), h('th', {}, 'Call'), h('th', {}, 'Pin skill')),
        [...list].sort(bySkill).map((s) => {
          const box = h('input', { type: 'checkbox', checked: role.has(s.id), disabled: locked && mode === 'test', onchange: () => { box.checked ? role.set(s.id, mode) : role.delete(s.id); upd(); } });
          return h('tr', {}, h('td', {}, box), h('td', {}, h('b', {}, s.title)), h('td', { class: 'small muted' }, s.category));
        }))),
    h('button', { class: 'btn', onclick: safe(async () => {
      const mine2 = list.map((s) => s.id).filter((id) => role.has(id));
      if (!mine2.length) return toast(`Tick at least one call for this ${word}.`, true);
      await api('/api/admin/tests/group', { groupId: grp, name: name.value, classId: Number(cls.value),
        practiceIds: mode === 'practice' ? mine2 : otherIds, testIds: mode === 'test' ? mine2 : otherIds,
        passMeters: Number(meters.value), passCount: Number(count.value), timeLimitMin: Number(mins.value) });
      toast(t ? 'Saved' : `Saved as a draft. Press Open when the class should see this ${word}.`); go('a-tests');
    }) }, 'Save'));
}

// ── admins: results ──────────────────────────────────────────────────
VIEWS['a-results'] = async () => {
  const tests = (await api('/api/admin/tests')).filter((t) => t.status !== 'draft' && t.mode !== 'practice');
  const host = h('div');
  // Pick the class first, then (if the class has more than one) the test.
  const classNames = [...new Map(tests.map((t) => [t.class_id, t.class_name || 'No class'])).entries()];
  const testSel = h('select', { onchange: () => show(Number(testSel.value)) });
  const classSel = h('select', { onchange: () => pickClass(Number(classSel.value)) }, classNames.map(([id, nm]) => h('option', { value: id }, nm)));
  function pickClass(classId) {
    const mine = tests.filter((t) => t.class_id === classId);
    testSel.replaceChildren(...mine.map((t) => h('option', { value: t.id }, t.name)));
    if (mine.length) show(mine[0].id);
  }
  mount(h('h1', {}, 'Test results'), h('p', { class: 'lead' }, 'Pick a class to see how its people did. Practice progress is on People & classes.'),
    !tests.length ? h('div', { class: 'card muted' }, 'Results appear here once a test is opened.')
      : [h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Class'), classSel), h('div', {}, h('label', {}, 'Test'), testSel)), h('p'), host]);
  async function show(id) {
    const r = await api(`/api/admin/results/${id}`);
    const done = r.rows.filter((x) => x.state === 'done');
    const what = (s) => [...s.stops.filter((x) => !x.passed).map((x) => `${x.kind === 'dropoff' ? 'drop-off' : 'pickup'} pin ${x.distance == null ? 'missing' : m(x.distance) + ' off'}`),
      ...(s.missingQuestions.length ? [/^Step \d/.test(s.missingQuestions[0]) ? s.missingQuestions.join(' / ') : `didn't: ${s.missingQuestions.join(' / ')}`] : []), ...(s.noteProblems.length ? ['note: ' + s.noteProblems.join(' ')] : [])];
    host.replaceChildren(
      h('div', { class: 'grid2' },
        h('div', { class: 'card stat s1' }, h('div', { class: 'small' }, 'Handed in'), h('div', { class: 'big' }, `${done.length} / ${r.rows.length}`)),
        h('div', { class: 'card stat s2' }, h('div', { class: 'small' }, 'Passed'), h('div', { class: 'big' }, done.length ? `${done.filter((x) => x.passed).length} / ${done.length}` : '–'))),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Trainees'), h('a', { class: 'btn ghost small', href: `/api/admin/results/${id}.csv` }, 'Download CSV')),
        h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Calls right'), h('th', {}, 'Result'), h('th', {}, 'What went wrong')),
          r.rows.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, x.correct == null ? '–' : `${x.correct} / ${x.total}`),
            h('td', {}, x.state !== 'done' ? h('span', { class: 'tag' }, x.state) : h('span', { class: `tag ${x.passed ? 'pass' : 'fail'}` }, x.passed ? 'Passed' : 'Not passed')),
            h('td', { class: 'small' }, (x.scenarios || []).filter((s) => s.answered && !s.passed).map((s) => h('details', {}, h('summary', {}, `${s.title}: ${what(s).join('; ')}`),
              h('div', { class: 'muted' }, 'Their note: ', s.note || '(empty)'))),
              (x.scenarios || []).filter((s) => !s.answered).map((s) => h('div', { class: 'muted' }, `${s.title}: no answer`))))))),
      h('div', { class: 'card' }, h('h2', {}, 'Which calls the class gets wrong'), h('p', { class: 'small muted' }, 'Where most people slip is what to re-teach.'),
        h('table', {}, h('tr', {}, h('th', {}, 'Scenario'), h('th', {}, 'Got it right'), h('th', {}, 'Pin wrong'), h('th', {}, 'Missed questions'), h('th', {}, 'Weak note')),
          r.perScenario.map((s) => h('tr', {}, h('td', {}, s.title), h('td', {}, s.answered ? `${s.passed} of ${s.answered}` : '–'),
            h('td', {}, s.pinWrong), h('td', {}, s.questionsMissed), h('td', {}, s.noteWrong))))));
  }
  if (tests.length) pickClass(classNames[0][0]);
};

// ── admins: people & classes ─────────────────────────────────────────
boot().catch((e) => mount(h('div', { class: 'card' }, e.message)));
