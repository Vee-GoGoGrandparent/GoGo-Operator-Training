// GoGo Pin Academy front end. Plain JS. All user text goes in with textContent, never innerHTML.
const $view = document.getElementById('view');
const $tabs = document.getElementById('tabs');
const $who = document.getElementById('who');

let ME = null, CONFIG = {}, mapsReady = null;
const CATEGORIES = ['Hospital', 'Medical office', 'Airport', 'Restaurant or shop', 'Apartment complex', 'Senior living', 'Gated community', 'Shopping center', 'Other'];
// One colour per type of place, so the practice page reads at a glance.
const catColour = (cat) => `--c: var(--c${(Math.max(0, CATEGORIES.indexOf(cat)) % 6) + 1})`;
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
async function pinMap(host, { start, kind = 'pickup', draggable = true, onMove, entrances = [], onEntrance } = {}) {
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
  marker.addListener('dragend', moved);
  map.addListener('click', (e) => { if (!draggable) return; marker.position = e.latLng; moved(); });

  function setEntrances(list) {
    entranceMarkers.forEach((x) => (x.map = null));
    entranceMarkers = list.map((e, i) => {
      const mk = new AdvancedMarkerElement({ map, position: { lat: e.lat, lng: e.lng }, title: e.name, zIndex: 2,
        content: new PinElement({ background: '#3d9df5', borderColor: '#1f6fb8', glyph: String(i + 1), glyphColor: '#fff', scale: 0.95 }).element });
      mk.addListener('click', () => { if (!draggable) return; marker.position = { lat: e.lat, lng: e.lng }; moved(); onEntrance && onEntrance(i); });
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
  $tabs.append(...TRAINEE_TABS.map(tab));
  if (ME.role === 'admin') $tabs.append(h('span', { class: 'sep' }), ...ADMIN_TABS.map(tab));
  $who.append(h('span', {}, ME.name, ME.className ? ` · ${ME.className}` : '', ME.role === 'admin' ? ' · Admin' : ''),
    h('button', { onclick: safe(async () => { await api('/auth/logout', {}); location.href = '/'; }) }, 'Sign out'));
}

function go(id) { history.replaceState(null, '', `#${id}`); render(id); }

async function boot() {
  const me = await api('/api/me');
  ME = me.user; CONFIG = me;
  const err = new URLSearchParams(location.search).get('error');
  if (err) { history.replaceState(null, '', '/'); toast(err, true); }
  const hash = location.hash.slice(1) || recall() || '';
  if (!ME) { if (hash) remember(hash); return drawLogin(me); }
  // A class link (#t-12) puts someone with no class into that class, then opens it.
  if (/^t-\d+$/.test(hash)) return render(hash);
  if (!ME.classId && ME.role !== 'admin') return drawClassPicker();
  render(hash || (ME.role === 'admin' ? 'a-scenarios' : 'practice'));
}

function drawLogin(me) {
  drawShell();
  const box = h('div', { class: 'card login' },
    h('img', { src: '/pin.svg', width: 56, height: 56, alt: '' }),
    h('h1', {}, 'GoGo Pin Academy'),
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
async function render(id) {
  try {
    // #s-12 opens practice scenario 12 directly, so a trainer can send one call as a link.
    const direct = /^s-(\d+)$/.exec(id || '');
    if (direct) {
      drawShell('practice');
      const list = await api('/api/practice');
      const i = list.findIndex((x) => x.id === Number(direct[1]));
      if (i >= 0) return practiceOne(list, i);
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
    if (!VIEWS[id] || (id.startsWith('a-') && ME.role !== 'admin')) id = ME.role === 'admin' ? 'a-scenarios' : 'practice';
    drawShell(id);
    await VIEWS[id]();
  } catch (e) { mount(h('div', { class: 'card' }, h('p', {}, e.message), h('button', { class: 'btn ghost', onclick: () => go('practice') }, 'Go to Practice'))); }
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

function scenarioForm(s, { submitLabel = 'End call & check my answer', onSubmit } = {}) {
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
  const qButtons = s.questions.map((q, i) => h('button', { class: 'qbtn', onclick: () => {
    if (asked.has(i)) return;
    asked.add(i); qButtons[i].classList.add('on');
    transcript.append(h('div', { class: 'line you' }, h('b', {}, 'You: '), q.say || q.q), h('div', { class: 'line caller' }, h('b', {}, 'Caller: '), q.a));
    transcript.scrollTop = transcript.scrollHeight;
  } }, q.q));
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
      b.pm = await pinMap(mapHost, { start, kind, entrances, onMove: (p) => { b.pin = p; showLL(p); maybeOffer(p); },
        onEntrance: (i) => { venue.value = String(i); b.entrance = i; specific.value = entrances[i].name; } });
      if (b.pm) { b.pin = b.pm.getPin(); showLL(b.pin); }
      return b.pm;
    };
    const fill = async (p) => {
      if (p.street != null) street.value = p.street || p.name || '';
      city.value = p.city || ''; state.value = p.state || ''; zip.value = p.zip || ''; locName.value = p.name || '';
      placeId.textContent = p.placeId || '';
      const pm = await ensureMap(p);
      if (pm) { pm.setOriginal(p); pm.setPin(p); }
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
    // Moving the pin of a place that came from a saved location: offer to save it (once per pick), like Vee described.
    function maybeOffer(p) {
      if (b.fromSlot == null || b.offered || !b.fromPlace) return;
      const far = Math.abs(p.lat - b.fromPlace.lat) + Math.abs(p.lng - b.fromPlace.lng) > 0.00004; // about 4 m
      if (!far) return;
      b.offered = true;
      setTimeout(() => saveLocation(b.fromSlot), 300);
    }
    const typedLL = async () => { const p = { lat: Number(lat.value), lng: Number(lng.value) };
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) { const pm = await ensureMap(p); pm && pm.setPin(p); } };
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
    addressSearch(street, (p) => { b.fromSlot = null; redrawSlots.forEach((f) => f()); fill(p); });
    if (stop) ensureMap(stop.start);
    return b;
  }
  const blocks = { pickup: addressBlock('pickup'), dropoff: addressBlock('dropoff') };

  const wearing = h('input', { type: 'text', placeholder: 'Describe clothing' });
  const announce = h('select', {}, ['Call me', 'Text me'].map((x) => h('option', {}, x)));
  const note = h('textarea', { placeholder: 'Anything else the driver needs to know?' });
  const checkbox = (label, extra = {}) => h('label', { class: 'ro-check' }, h('input', { type: 'checkbox', ...extra }), label);
  const submitBtn = h('button', { class: 'btn orange end-call', type: 'button' }, submitLabel);
  // Get Estimate shows the dashboard's estimate; Order Ride books it and shows the driver to read to the customer.
  const ride = s.ride || {};
  let ordered = false;
  const detail = (label, ...val) => h('tr', {}, h('th', {}, label), h('td', {}, ...val));
  function getEstimate() {
    const missing = s.stops.filter((x) => !blocks[x.kind].pin).map((x) => (x.kind === 'dropoff' ? 'End Address' : 'Start Address'));
    if (missing.length) return toast(`Fill in the ${missing.join(' and ')} first.`);
    modal(null, h('table', { class: 'estimate' },
      detail('Ride Type:', h('span', { class: 'red' }, `${ride.rideType} For ${ride.customerName}`)),
      detail('ETA:', ride.eta),
      detail('Ride Details:', h('div', {}, ride.trip), h('div', {}, `Surge Factor: ${ride.surge}`), h('div', {}, `Cost Per Mile: ${ride.perMile}`),
        h('div', {}, `Cost Per Minute: ${ride.perMinute}`), h('div', {}, `Base Fare: ${ride.baseFare}`), h('div', {}, `Minimum Fare: ${ride.minFare}`)),
      detail('GoGo Cost', ride.cost), detail('Caller GoGo Credits:', ride.credits), detail('Caller Expiring Credits:', ride.expiring),
      detail('User Has Auto Tipping On:', ride.autoTip), detail('Caller Partner Subsidies:', ''), detail('Partner Info for Operator:', '')),
      [['Order Ride', 'purple', (close) => {
        close(); ordered = true;
        const dr = ride.driver || {};
        modal('Ride ordered', h('table', { class: 'estimate' }, detail('Driver:', dr.name), detail('Car:', dr.car), detail('Plate (last 4):', dr.plate), detail('Arriving in:', dr.eta)),
          [['OK', 'yellow', (c2) => c2()]]);
      }], ['Cancel', 'yellow', (close) => close()]]);
  }
  const getSubmission = () => ({
    pins: s.stops.map((x) => blocks[x.kind].pin), entrances: s.stops.map((x) => blocks[x.kind].entrance), asked: [...asked],
    note: note.value, wearing: wearing.value, announce: announce.value, savedChanges, ordered,
    specific: s.stops.map((x) => blocks[x.kind].specific.value), locationName: s.stops.map((x) => blocks[x.kind].locName.value),
    seconds: Math.round((Date.now() - t0) / 1000),
  });
  submitBtn.onclick = safe(async () => { submitBtn.disabled = true; try { await onSubmit(getSubmission()); } finally { submitBtn.disabled = false; } });

  const form = h('div', { class: 'ro-card' },
    h('div', { class: 'ro-card-title' }, 'Order rides on behalf of a registered user'),
    row('Phone Number*', h('input', { type: 'text', value: '(+1) account on file', disabled: true })),
    row('Preferred Contact Number', h('select', {}, h('option', {}, 'Account Phone Number'), h('option', {}, 'New Phone Number'))),
    row('Service Type', h('select', {}, h('option', {}, 'Transportation'))),
    row('Type of Car*', h('select', {}, h('option', {}, 'Car (Auto selects a vendor based on ETA or by user preference)'))),
    blocks.pickup.el,
    h('button', { class: 'pill purple small', type: 'button', onclick: notInPractice('Add Stop') }, 'Add Stop +'),
    blocks.dropoff.el,
    row('What Are You Wearing Today?', wearing),
    row('How Should the Driver Announce Their Arrival?*', announce),
    h('div', { class: 'ro-center' }, h('button', { class: 'pill purple', type: 'button', onclick: notInPractice('Accessibility options') }, 'Edit Accessibility Options')),
    h('div', { class: 'ro-indent' }, checkbox('The rider has groceries.'), checkbox('The rider has luggage.')),
    h('div', { class: 'ro-preview' }, h('div', { class: 'ro-preview-title' }, '▼ Driver Message Preview'), note),
    h('div', { class: 'ro-indent' }, checkbox('Have RSS monitor this ride')),
    row('Ride Type', h('div', {}, checkbox('Emergency Ride'), checkbox('Expand Driver Search'), checkbox('Expand Vehicle Search'))),
    row('Auto Retry Getting a', h('select', { disabled: true }, h('option', {}, 'Select one'))),
    h('div', { class: 'ro-indent' }, checkbox('Do not apply expiring credits to this ride')),
    h('div', { class: 'ro-btns ro-center' },
      h('button', { class: 'pill purple', type: 'button', onclick: getEstimate }, 'Get Estimate'),
      h('button', { class: 'pill yellow', type: 'button', onclick: () => { blocks.pickup.el.querySelector('.pill.yellow').click(); blocks.dropoff.el.querySelector('.pill.yellow').click(); wearing.value = ''; note.value = ''; } }, 'Reset'),
      h('button', { class: 'pill cyan', type: 'button', onclick: () => toast('This is the Order a Ride Now tab: use Get Estimate, then Order Ride.') }, 'Schedule This Ride')));

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
            s.questions.length ? [h('div', { class: 'ro-call-label' }, 'What do you say next? Pick in the order you would on the call'), h('div', { class: 'qbtns' }, qButtons)] : null,
            h('div', { class: 'ro-call-end' }, submitBtn)),
          result))));
  return {
    el, getSubmission,
    showResult(r) {
      s.stops.forEach((x, i) => { const blk = blocks[x.kind], g = r.stops[i]; if (blk.pm) { blk.pm.lock(); blk.pm.showAnswer(g.answer, blk.pin); } });
      note.disabled = true; wearing.disabled = true; submitBtn.disabled = true;
      result.replaceChildren(resultCard(r));
      result.scrollIntoView({ behavior: 'smooth' });
    },
  };
}

function resultCard(r) {
  const ok = (b) => h('span', { class: `tag ${b ? 'pass' : 'fail'}` }, b ? '✓' : '✗');
  return h('div', { class: `card result ${r.passed ? 'good' : 'bad'}` },
    h('div', { class: 'row' }, h('div', { class: 'big' }, r.passed ? 'Got it' : 'Not quite'), h('span', { class: `tag ${r.passed ? 'pass' : 'fail'}` }, r.passed ? 'Passed' : 'Try again')),
    h('table', {},
      r.stops.map((s) => h('tr', {}, h('td', {}, ok(s.passed)), h('td', {}, h('b', {}, s.kind === 'dropoff' ? 'Drop-off pin' : 'Pickup pin')),
        h('td', {}, s.distance == null ? 'No pin placed' : `${m(s.distance)} from the right spot`,
          s.entrance && s.entrance.correct ? h('div', { class: 'small muted' }, `Right entrance: ${s.entrance.correct}${s.entrance.chose ? ` · you picked: ${s.entrance.chose}` : ''}`) : null))),
      h('tr', {}, h('td', {}, ok(!r.missingQuestions.length)), h('td', {}, h('b', {}, 'Questions')),
        h('td', {}, r.missingQuestions.length ? `You didn't: ${r.missingQuestions.join(' · ')}` : 'You asked what you needed to.')),
      h('tr', {}, h('td', {}, ok(r.note.ok)), h('td', {}, h('b', {}, 'Driver note')),
        h('td', {}, r.note.ok ? 'Clear and useful for the driver.' : r.note.problems.join(' '))),
      r.ordered ? h('tr', {}, h('td', {}, ok(r.ordered.ok)), h('td', {}, h('b', {}, 'Ride ordered')),
        h('td', {}, r.ordered.ok ? 'You got the estimate and ordered the ride.' : 'The ride was never ordered. Use Get Estimate, then Order Ride.')) : null,
      r.saved ? h('tr', {}, h('td', {}, ok(r.saved.ok)), h('td', {}, h('b', {}, 'Saved location')),
        h('td', {}, r.saved.ok ? r.saved.did : `${r.saved.did}. Should be: ${r.saved.want}.`)) : null),
    r.modelNote ? [h('h3', {}, 'A good note looks like this'), h('p', { class: 'model' }, r.modelNote)] : null,
    r.why ? [h('h3', {}, 'Why'), h('p', {}, r.why)] : null);
}

// ── practice ─────────────────────────────────────────────────────────
VIEWS.practice = async () => {
  const [list, tests] = await Promise.all([api('/api/practice'), api('/api/tests')]);
  const sets = tests.filter((t) => t.mode === 'practice' && t.status === 'open');
  const groups = {};
  list.forEach((s) => (groups[s.category] ||= []).push(s));
  mount(h('h1', {}, 'Practice'),
    h('p', { class: 'lead' }, 'Each one is a short call on a copy of Ride Ordering. Ask what you need to, search the place, put the pin on the right spot, fill in what the driver needs, then Schedule This Ride to see how you did.'),
    sets.length ? [h('h3', {}, 'Practice sets for your class'), h('div', { class: 'tiles' }, sets.map((t) => h('button', { class: 'tile', onclick: () => go(`t-${t.id}`) },
      h('span', { class: 'tag' }, 'Practice set'), h('b', {}, t.name), h('span', { class: 'small muted' }, `${t.questions} calls`))))] : null,
    !list.length && !sets.length ? h('div', { class: 'card muted' }, 'No practice yet. Your trainer adds it.') : null,
    Object.entries(groups).map(([cat, items]) => [h('h3', {}, cat),
      h('div', { class: 'tiles' }, items.map((s, i) => h('button', { class: 'tile', style: catColour(cat), onclick: () => practiceOne(items, i) },
        h('span', { class: 'tag' }, s.category), h('b', {}, s.title), h('span', { class: 'small muted' }, s.stops.map((x) => x.kind === 'dropoff' ? 'drop-off' : 'pickup').join(' + ')))))]));
};

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
  const form = scenarioForm(s, { onSubmit: async (sub) => {
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
  const list = await api('/api/admin/scenarios');
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Scenarios'),
      h('button', { class: 'btn ghost', onclick: safe(async () => { const r = await api('/api/admin/scenarios/examples', {}); toast(r.added ? `Added ${r.added} example(s)` : 'Examples are up to date'); go('a-scenarios'); }) }, 'Add the examples'),
      h('button', { class: 'btn orange', onclick: () => editScenario() }, '+ New scenario')),
    h('p', { class: 'lead' }, 'A scenario is a short pretend call: what the caller says, the place(s), the right pin and entrance, what the operator can say, and what the driver note must say. Use public places only, and made-up customer details.'),
    h('div', { class: 'card' }, !list.length ? h('p', { class: 'muted' }, 'No scenarios yet. Start with the examples, or make your own from real cases.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Scenario'), h('th', {}, 'Type'), h('th', {}, 'Stops'), h('th', {}, 'Tries'), h('th', {}, 'Got right'), h('th', {}, '')),
        list.map((s) => h('tr', {}, h('td', {}, h('b', {}, s.title), !s.practice ? h('div', {}, h('span', { class: 'tag' }, 'not in general practice')) : null),
          h('td', {}, s.category), h('td', {}, s.data.stops.map((x) => x.kind === 'dropoff' ? 'drop-off' : 'pickup').join(' + ')),
          h('td', {}, s.tries), h('td', {}, s.tries ? `${Math.round(100 * s.passes / s.tries)}%` : '–'),
          h('td', {}, s.practice ? h('button', { class: 'btn ghost small', title: 'Copy a link that opens this call', onclick: safe(async () => { await navigator.clipboard.writeText(`${location.origin}/#s-${s.id}`); toast('Link copied'); }) }, 'Copy link') : null, ' ',
            h('button', { class: 'btn ghost small', onclick: () => editScenario(s) }, 'Edit'), ' ',
            h('button', { class: 'btn ghost small', onclick: safe(async () => { if (!confirm(`Archive "${s.title}"? Past results keep it.`)) return; await api(`/api/admin/scenarios/${s.id}/archive`, {}); go('a-scenarios'); }) }, 'Archive')))))));
};

function editScenario(existing) {
  const d = existing ? structuredClone(existing.data) : {
    caller: 'Hi, I need a ride.', why: '', account: { home: null, saved: [] },
    stops: [{ kind: 'pickup', label: '', addressGiven: '', answer: null, start: null, entrances: [], correctEntrance: null }],
    questions: SUGGESTED_QUESTIONS.map((q) => ({ q, say: '', a: '', needed: false })), note: { mustMention: [], model: '' },
  };
  d.account = d.account || { home: null, saved: [] };
  const title = h('input', { type: 'text', value: existing?.title || '', placeholder: "e.g. Menchie's on Petrovitsky Road" });
  const cat = h('select', {}, CATEGORIES.map((c) => h('option', { value: c, selected: c === (existing?.category || 'Restaurant or shop') }, c)));
  const practice = h('input', { type: 'checkbox', checked: existing ? existing.practice : true });
  const caller = h('textarea', { value: d.caller, placeholder: 'What the caller says first, e.g. "Hi, I need a ride."' });
  const why = h('textarea', { value: d.why, placeholder: 'Shown after they answer: what goes wrong if you only use the address, and how to get it right.' });
  const stopsHost = h('div'), qHost = h('div'), acctHost = h('div');
  const must = h('input', { type: 'text', value: d.note.mustMention.join(', '), placeholder: 'e.g. Menchie, blue, jeans' });
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
      const qq = h('input', { type: 'text', value: q.q, placeholder: 'Button, e.g. Read the address back', oninput: () => (q.q = qq.value) });
      const say = h('input', { type: 'text', value: q.say || '', placeholder: 'What you say (optional), e.g. Okay, that is 14060...', oninput: () => (q.say = say.value) });
      const aa = h('input', { type: 'text', value: q.a, placeholder: 'What the caller answers', oninput: () => (q.a = aa.value) });
      const need = h('input', { type: 'checkbox', checked: q.needed, onchange: () => (q.needed = need.checked) });
      return h('div', { class: 'qrow' }, qq, say, aa, h('label', { class: 'check', style: 'margin:0' }, need, 'Must ask'),
        h('button', { class: 'btn ghost small', onclick: () => { d.questions.splice(i, 1); drawQuestions(); } }, '✕'));
    }), h('button', { class: 'btn ghost small', onclick: () => { d.questions.push({ q: '', say: '', a: '', needed: false }); drawQuestions(); } }, '+ Add a line'));
  }

  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-scenarios') }, '← Scenarios'),
    h('h1', {}, existing ? 'Edit scenario' : 'New scenario'),
    h('div', { class: 'card' }, h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Scenario name (trainees see it, so do not give the answer away)'), title), h('div', {}, h('label', {}, 'Type of place'), cat)),
      h('label', {}, 'What the caller says first'), caller,
      h('label', { class: 'check' }, practice, 'Show in general practice (untick to use it only in practice sets and tests)')),
    stopsHost,
    h('div', { class: 'card' }, h('h2', {}, 'The customer’s account'), acctHost),
    h('div', { class: 'card' }, h('h2', {}, 'What the operator can say'), h('p', { class: 'small muted' }, 'Each line: a short button, the full line they say, and the caller’s answer. Include read-backs and a weak option or two. Tick "Must ask" for the ones needed to get it right. Lines with no answer are dropped.'), qHost),
    h('div', { class: 'card' }, h('h2', {}, 'Driver note'),
      h('label', {}, 'The note must mention (comma separated). The What Are You Wearing Today? box counts too.'), must,
      h('label', {}, 'A good note (shown after they answer)'), model,
      h('label', {}, 'Why (shown after they answer)'), why),
    h('button', { class: 'btn', onclick: safe(async () => {
      const data = { ...d, caller: caller.value, why: why.value, questions: d.questions.filter((q) => q.q && q.a),
        note: { mustMention: must.value.split(',').map((x) => x.trim()).filter(Boolean), model: model.value } };
      if (data.stops.some((s) => !s.answer)) return toast('Search each stop and place its pin first.', true);
      await api('/api/admin/scenarios', { id: existing?.id, version: existing?.version, title: title.value, category: cat.value, practice: practice.checked, data });
      toast('Saved'); go('a-scenarios');
    }) }, 'Save scenario'));
  drawStops(); drawAccount(); drawQuestions();
}

// ── admins: practice sets & tests ────────────────────────────────────
const linkFor = (t) => `${location.origin}/#t-${t.id}`;
const copyLink = (t) => safe(async () => { await navigator.clipboard.writeText(linkFor(t)); toast('Link copied. Send it to the class.'); });

VIEWS['a-tests'] = async () => {
  const [tests, classes] = await Promise.all([api('/api/admin/tests'), api('/api/admin/classes')]);
  const setStatus = (t, status) => safe(async () => { await api(`/api/admin/tests/${t.id}/status`, { status }); go('a-tests'); });
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Practice & tests'),
      h('button', { class: 'btn ghost', onclick: () => editTest(null, classes, 'practice') }, '+ New practice set'),
      h('button', { class: 'btn orange', onclick: () => editTest(null, classes, 'test') }, '+ New test')),
    h('p', { class: 'lead' }, 'Each practice set or test is for one class and has its own link. Send the link: anyone who opens it joins that class, and People & classes shows who did what. A practice set can be done any number of times; a test is timed, one go.'),
    h('div', { class: 'card' }, !tests.length ? h('p', { class: 'muted' }, 'Nothing yet.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Kind'), h('th', {}, 'Class'), h('th', {}, 'Done by'), h('th', {}, 'Status'), h('th', {}, '')),
        tests.map((t) => h('tr', {}, h('td', {}, h('b', {}, t.name), h('div', { class: 'small muted' }, t.mode === 'practice' ? `${t.questions} calls` : `${t.pass_count} of ${t.questions} right · ${t.pass_meters} m · ${t.time_limit_min} min`)),
          h('td', {}, h('span', { class: 'tag' }, t.mode === 'practice' ? 'Practice set' : 'Test')), h('td', {}, t.class_name || '–'),
          h('td', {}, t.mode === 'practice' ? `${t.practised} practised` : `${t.handed_in} handed in`),
          h('td', {}, h('span', { class: `tag ${t.status === 'open' ? 'pass' : ''}` }, t.status)),
          h('td', {}, t.status !== 'draft' ? h('button', { class: 'btn ghost small', onclick: copyLink(t) }, 'Copy link') : null, ' ',
            t.status === 'draft' ? [h('button', { class: 'btn ghost small', onclick: () => editTest(t, classes, t.mode) }, 'Edit'), ' ', h('button', { class: 'btn small', onclick: setStatus(t, 'open') }, 'Open')]
            : t.status === 'open' ? h('button', { class: 'btn ghost small', onclick: setStatus(t, 'closed') }, 'Close')
            : h('button', { class: 'btn ghost small', onclick: setStatus(t, 'open') }, 'Re-open')))))));
};

async function editTest(t, classes, mode) {
  const list = await api('/api/admin/scenarios');
  const chosen = new Set(t?.scenarioIds || []);
  const isTest = mode !== 'practice';
  const name = h('input', { type: 'text', value: t?.name || '', placeholder: isTest ? 'e.g. October 2026 pin test' : 'e.g. October 2026 pin practice' });
  const cls = h('select', {}, h('option', { value: '' }, 'Choose…'), classes.filter((c) => c.active).map((c) => h('option', { value: c.id, selected: c.id === t?.class_id }, c.name)));
  const meters = h('input', { type: 'number', min: 1, max: 200, value: t?.pass_meters ?? 15 });
  const count = h('input', { type: 'number', min: 1, value: t?.pass_count ?? 4 });
  const mins = h('input', { type: 'number', min: 1, max: 240, value: t?.time_limit_min ?? 30 });
  const n = h('span', { class: 'tag' });
  const upd = () => (n.textContent = `${chosen.size} chosen`);
  upd();
  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-tests') }, '← Practice & tests'), h('h1', {}, `${t ? 'Edit' : 'New'} ${isTest ? 'test' : 'practice set'}`),
    h('div', { class: 'card' }, h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Name'), name), h('div', {}, h('label', {}, 'Class'), cls)),
      isTest ? [h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'A pin counts as right within (metres)'), meters),
        h('div', {}, h('label', {}, 'To pass, calls right needed'), count)), h('label', {}, 'Time limit (minutes)'), mins] : null),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Scenarios'), n),
      !list.length ? h('p', { class: 'muted' }, 'Add scenarios first.') :
      list.map((s) => { const cb = h('input', { type: 'checkbox', checked: chosen.has(s.id), onchange: () => { cb.checked ? chosen.add(s.id) : chosen.delete(s.id); upd(); } });
        return h('label', { class: 'check' }, cb, `${s.title} `, h('span', { class: 'small muted' }, `· ${s.category}`)); })),
    h('button', { class: 'btn', onclick: safe(async () => {
      await api('/api/admin/tests', { id: t?.id, mode, name: name.value, classId: Number(cls.value), scenarioIds: [...chosen],
        passMeters: Number(meters.value), passCount: Number(count.value), timeLimitMin: Number(mins.value) });
      toast('Saved as a draft. Open it to get its link.'); go('a-tests');
    }) }, 'Save'));
}

// ── admins: results ──────────────────────────────────────────────────
VIEWS['a-results'] = async () => {
  const tests = (await api('/api/admin/tests')).filter((t) => t.status !== 'draft' && t.mode !== 'practice');
  const host = h('div');
  const sel = h('select', { onchange: () => show(Number(sel.value)) }, tests.map((t) => h('option', { value: t.id }, `${t.name} · ${t.class_name || ''}`)));
  mount(h('h1', {}, 'Test results'), h('p', { class: 'lead' }, 'Practice progress is on People & classes.'),
    !tests.length ? h('div', { class: 'card muted' }, 'Results appear here once a test is opened.') : [sel, h('p'), host]);
  async function show(id) {
    const r = await api(`/api/admin/results/${id}`);
    const done = r.rows.filter((x) => x.state === 'done');
    const what = (s) => [...s.stops.filter((x) => !x.passed).map((x) => `${x.kind === 'dropoff' ? 'drop-off' : 'pickup'} pin ${x.distance == null ? 'missing' : m(x.distance) + ' off'}`),
      ...(s.missingQuestions.length ? [`didn't: ${s.missingQuestions.join(' / ')}`] : []), ...(s.noteProblems.length ? ['note: ' + s.noteProblems.join(' ')] : [])];
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
  if (tests.length) show(tests[0].id);
};

// ── admins: people & classes ─────────────────────────────────────────
VIEWS['a-people'] = async () => {
  const [classes, people, tests] = await Promise.all([api('/api/admin/classes'), api('/api/admin/people'), api('/api/admin/tests')]);
  const newName = h('input', { type: 'text', placeholder: 'e.g. October 2026' });
  const classCard = (c) => {
    const nm = h('input', { type: 'text', value: c.name });
    const links = tests.filter((t) => t.class_id === c.id && t.status !== 'draft');
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, nm),
        h('button', { class: 'btn ghost small', onclick: safe(async () => { await api('/api/admin/classes', { id: c.id, name: nm.value }); toast('Renamed'); go('a-people'); }) }, 'Rename'),
        h('span', { class: `tag ${c.active ? 'pass' : ''}` }, c.active ? 'open' : 'closed'),
        h('button', { class: 'btn ghost small', onclick: safe(async () => { await api('/api/admin/classes', { id: c.id, active: !c.active }); go('a-people'); }) }, c.active ? 'Close' : 'Re-open'),
        h('button', { class: 'btn ghost small', onclick: safe(async () => { if (!confirm(`Delete the class "${c.name}"?`)) return; await api(`/api/admin/classes/${c.id}/delete`, {}); toast('Deleted'); go('a-people'); }) }, 'Delete')),
      h('div', { class: 'small muted' }, `${c.people} people`),
      links.length ? h('div', { class: 'row', style: 'margin-top:8px' }, links.map((t) => h('button', { class: 'btn ghost small', onclick: copyLink(t) }, `Copy link: ${t.name} (${t.mode === 'practice' ? 'practice' : 'test'})`)))
        : h('div', { class: 'small muted' }, 'No practice set or test yet. Make one on Practice & tests to get a link.'));
  };
  const byClass = {};
  people.forEach((p) => (byClass[p.class_name || 'No class yet'] ||= []).push(p));
  mount(h('h1', {}, 'People & classes'),
    h('p', { class: 'lead' }, 'Make a class, then make a practice set and a test for it on Practice & tests. Each has a link: whoever opens it joins the class. A class can be deleted only while it is empty.'),
    h('div', { class: 'card' }, h('h2', {}, 'Add a class'), h('div', { class: 'row' }, h('div', { class: 'grow' }, newName),
      h('button', { class: 'btn', onclick: safe(async () => { await api('/api/admin/classes', { name: newName.value }); go('a-people'); }) }, 'Add class'))),
    classes.map(classCard),
    h('h2', {}, 'People'),
    Object.entries(byClass).map(([cname, list]) => h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, cname),
      h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Practice calls'), h('th', {}, 'Calls got right'), h('th', {}, 'Tests handed in'), h('th', {}, 'Class'), h('th', {}, 'Role'), h('th', {}, 'Last sign-in')),
        list.map((p) => {
          const c = h('select', { onchange: safe(async () => { await api('/api/admin/people', { slackId: p.slack_id, classId: c.value ? Number(c.value) : null }); toast('Class updated'); }) },
            h('option', { value: '' }, '–'), classes.map((k) => h('option', { value: k.id, selected: k.id === p.class_id }, k.name)));
          const r = h('select', { onchange: safe(async () => { await api('/api/admin/people', { slackId: p.slack_id, role: r.value }); toast('Role updated'); }) },
            ['trainee', 'admin'].map((x) => h('option', { value: x, selected: x === p.role }, x === 'admin' ? 'Admin' : 'Trainee')));
          return h('tr', {}, h('td', {}, p.name), h('td', {}, p.practice_tries), h('td', {}, p.practice_right), h('td', {}, p.tests_done),
            h('td', {}, c), h('td', {}, r), h('td', { class: 'small muted' }, when(p.last_login)));
        })))));
};

boot().catch((e) => mount(h('div', { class: 'card' }, e.message)));
