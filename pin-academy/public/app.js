// GoGo Pin Academy front end. Plain JS. All user text goes in with textContent, never innerHTML.
const $view = document.getElementById('view');
const $tabs = document.getElementById('tabs');
const $who = document.getElementById('who');

let ME = null, CONFIG = {}, mapsReady = null;
const CATEGORIES = ['Hospital', 'Medical office', 'Airport', 'Restaurant or shop', 'Apartment complex', 'Senior living', 'Gated community', 'Shopping center', 'Other'];
// One colour per type of place, so the practice page reads at a glance.
const catColour = (cat) => `--c: var(--c${(Math.max(0, CATEGORIES.indexOf(cat)) % 6) + 1})`;
const STOP_NAME = { pickup: 'Start Address (pickup)', dropoff: 'End Address (drop-off)' };
const PIN_COLOUR = { pickup: ['#2e9b4f', '#1d6b35'], dropoff: ['#d6336c', '#9c1f4c'] };
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
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
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

// The dashboard's address search box (Google's own suggestions). Calls onPick({ lat, lng, name, address }).
async function placeSearch(host, onPick) {
  if (!(await loadMaps())) return;
  const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
  const ac = new PlaceAutocompleteElement({ includedRegionCodes: ['us'] });
  ac.style.width = '100%';
  host.append(ac);
  const picked = async (place) => {
    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
    onPick({ ...ll(place.location), name: place.displayName || '', address: place.formattedAddress || '' });
  };
  ac.addEventListener('gmp-select', (e) => picked(e.placePrediction.toPlace()));
  ac.addEventListener('gmp-placeselect', (e) => picked(e.place)); // older event name, same thing
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
  const map = new Map(mapDiv, { center: start, zoom: 19, mapId: CONFIG.mapId, mapTypeId: 'hybrid', streetView: pano,
    gestureHandling: 'greedy', mapTypeControl: false, clickableIcons: false, tilt: 0 });
  const original = new AdvancedMarkerElement({ map, position: start, content: new PinElement({ background: '#9a9aa8', borderColor: '#6e6e7c', glyphColor: '#fff', scale: 0.85 }).element, title: 'Original', zIndex: 1 });
  const marker = new AdvancedMarkerElement({ map, position: start, gmpDraggable: draggable, content: new PinElement({ background: col, borderColor: edge, glyphColor: '#fff' }).element, title: kind, zIndex: 3 });
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
const ADMIN_TABS = [['a-scenarios', 'Scenarios'], ['a-tests', 'Build tests'], ['a-results', 'Results'], ['a-people', 'People & classes']];

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
  if (!ME) return drawLogin(me);
  if (!ME.classId && ME.role !== 'admin') return drawClassPicker();
  render(location.hash.slice(1) || (ME.role === 'admin' ? 'a-scenarios' : 'practice'));
}

function drawLogin(me) {
  drawShell();
  const box = h('div', { class: 'card login' },
    h('img', { src: '/pin.svg', width: 56, height: 56, alt: '' }),
    h('h1', {}, 'GoGo Pin Academy'),
    h('p', { class: 'lead' }, 'Practise real calls: find the right place, put the pin on the right door, and write a note the driver can use.'),
    h('div', { class: 'chips' }, h('span', {}, 'Street View'), h('span', {}, 'Satellite'), h('span', {}, 'Pin tests'), h('span', {}, 'Your progress')),
    me.slackReady
      ? h('a', { class: 'slackbtn', href: '/auth/slack' }, slackLogo(), 'Sign in with Slack')
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
  mount(h('div', { class: 'card login' }, h('h1', {}, `Welcome, ${ME.name}`), h('p', { class: 'lead' }, 'Which class are you in? You only do this once.'),
    classes.length ? sel : h('p', { class: 'tag warn' }, 'No class is open yet. Ask your trainer.'),
    h('p'), h('button', { class: 'btn', onclick: safe(async () => {
      if (!sel.value) return toast('Pick your class first.', true);
      ME = (await api('/api/me/class', { classId: Number(sel.value) })).user; go('practice');
    }) }, 'Continue')));
}

const VIEWS = {};
async function render(id) {
  // #s-12 opens practice scenario 12 directly, so a trainer can send one call as a link.
  const direct = /^s-(\d+)$/.exec(id || '');
  if (direct) {
    drawShell('practice');
    const list = await api('/api/practice');
    const i = list.findIndex((x) => x.id === Number(direct[1]));
    if (i >= 0) return practiceOne(list, i);
    toast('That scenario is not in practice.', true); id = 'practice';
  }
  if (!VIEWS[id] || (id.startsWith('a-') && ME.role !== 'admin')) id = ME.role === 'admin' ? 'a-scenarios' : 'practice';
  drawShell(id);
  try { await VIEWS[id](); } catch (e) { mount(h('div', { class: 'card' }, h('p', {}, e.message))); }
}

// ── one scenario, as a trainee sees it (practice and tests) ───────────
// Returns { el, getSubmission(), showResult(result) }.
function scenarioForm(s) {
  const t0 = Date.now();
  const asked = new Set();
  const transcript = h('div', { class: 'transcript' }, h('div', { class: 'line caller' }, h('b', {}, 'Caller: '), s.caller));
  const qButtons = s.questions.map((q, i) => h('button', { class: 'qbtn', onclick: () => {
    if (asked.has(i)) return;
    asked.add(i); qButtons[i].classList.add('on');
    transcript.append(h('div', { class: 'line you' }, h('b', {}, 'You: '), q.q), h('div', { class: 'line caller' }, h('b', {}, 'Caller: '), q.a));
  } }, q.q));

  const stops = s.stops.map((stop) => {
    const st = { pin: null, entrance: null, picked: '', pm: null };
    const specific = h('input', { type: 'text', placeholder: 'e.g. front door facing the parking lot' });
    const venue = h('select', { onchange: () => {
      const i = venue.value === '' ? null : Number(venue.value);
      st.entrance = i;
      if (i != null) { const e = stop.entrances[i]; specific.value = e.name; st.pm && st.pm.setPin({ lat: e.lat, lng: e.lng }); }
    } }, h('option', { value: '' }, 'Original Address'), stop.entrances.map((e, i) => h('option', { value: i }, `${i + 1}. ${e.name}`)));
    const picked = h('div', { class: 'small muted' }, 'Nothing searched yet.');
    const searchHost = h('div', { class: 'search' });
    const mapHost = h('div');
    const card = h('div', { class: `card stop ${stop.kind}` },
      h('h2', {}, STOP_NAME[stop.kind] || stop.kind),
      h('label', {}, 'Street Address1* (search the way you would on the dashboard)'), searchHost, picked,
      stop.entrances.length ? h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Venue Entrance or Side'), venue), h('div', {}, h('label', {}, 'Specific Entrance or Side'), specific))
        : h('div', {}, h('label', {}, 'Specific Entrance or Side'), specific),
      h('p'), mapHost);
    st.specific = specific;
    placeSearch(searchHost, (p) => {
      picked.textContent = `Picked: ${p.name}${p.address ? ' · ' + p.address : ''}`;
      st.picked = p.name;
      if (st.pm) { st.pm.setOriginal(p); st.pm.setPin(p); }
    });
    pinMap(mapHost, { start: stop.start, kind: stop.kind, entrances: stop.entrances, onMove: (p) => (st.pin = p),
      onEntrance: (i) => { venue.value = String(i); st.entrance = i; specific.value = stop.entrances[i].name; } })
      .then((pm) => { st.pm = pm; if (pm) st.pin = pm.getPin(); });
    return { stop, st, card };
  });

  const note = h('textarea', { placeholder: 'Anything else the driver needs to know? Write it for an Uber or Lyft driver: where exactly the customer is, how to find them, how to reach them.' });
  const result = h('div');
  const el = h('div', {},
    h('div', { class: 'card call' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, '📞 The call'), h('span', { class: 'tag' }, s.category)),
      transcript,
      s.questions.length ? [h('label', {}, 'Ask the caller (pick the questions you would ask)'), h('div', { class: 'qbtns' }, qButtons)] : null),
    stops.map((x) => x.card),
    h('div', { class: 'card' }, h('h2', {}, 'Driver Message Preview'), note),
    result);
  return {
    el,
    getSubmission: () => ({
      pins: stops.map((x) => x.st.pin), entrances: stops.map((x) => x.st.entrance), asked: [...asked],
      note: note.value, specific: stops.map((x) => x.st.specific.value), seconds: Math.round((Date.now() - t0) / 1000),
    }),
    showResult(r) {
      stops.forEach((x, i) => { const g = r.stops[i]; if (x.st.pm) { x.st.pm.lock(); x.st.pm.showAnswer(g.answer, x.st.pin); } });
      note.disabled = true;
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
        h('td', {}, r.missingQuestions.length ? `You didn't ask: ${r.missingQuestions.join(' · ')}` : 'You asked what you needed to.')),
      h('tr', {}, h('td', {}, ok(r.note.ok)), h('td', {}, h('b', {}, 'Driver note')),
        h('td', {}, r.note.ok ? 'Clear and useful for the driver.' : r.note.problems.join(' ')))),
    r.modelNote ? [h('h3', {}, 'A good note looks like this'), h('p', { class: 'model' }, r.modelNote)] : null,
    r.why ? [h('h3', {}, 'Why'), h('p', {}, r.why)] : null);
}

// ── practice ─────────────────────────────────────────────────────────
VIEWS.practice = async () => {
  const list = await api('/api/practice');
  const groups = {};
  list.forEach((s) => (groups[s.category] ||= []).push(s));
  mount(h('h1', {}, 'Practice'),
    h('p', { class: 'lead' }, 'Each one is a short call. Read what the caller says, ask what you need to, search the place the way you would on the dashboard, put the pin on the right spot, and write the driver note. Then see how you did and why.'),
    !list.length ? h('div', { class: 'card muted' }, 'No practice scenarios yet. Your trainer adds them.') : null,
    Object.entries(groups).map(([cat, items]) => [h('h3', {}, cat),
      h('div', { class: 'tiles' }, items.map((s, i) => h('button', { class: 'tile', style: catColour(cat), onclick: () => practiceOne(items, i) },
        h('span', { class: 'tag' }, s.category), h('b', {}, s.title), h('span', { class: 'small muted' }, s.stops.map((x) => x.kind === 'dropoff' ? 'drop-off' : 'pickup').join(' + ')))))]));
};

function practiceOne(items, i) {
  const s = items[i];
  const form = scenarioForm(s);
  const btn = h('button', { class: 'btn orange' }, 'Check my answer');
  const next = h('div', { class: 'row' });
  mount(h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => go('practice') }, '← All scenarios'), h('span', { class: 'grow' }),
      h('span', { class: 'small muted' }, `${i + 1} of ${items.length} in ${s.category}`)),
    h('h1', {}, s.title), form.el, h('div', { class: 'row' }, btn), h('p'), next);
  btn.onclick = safe(async () => {
    btn.disabled = true;
    const r = await api(`/api/practice/${s.id}`, form.getSubmission());
    form.showResult(r);
    next.replaceChildren(h('button', { class: 'btn ghost', onclick: () => practiceOne(items, i) }, 'Try again'),
      i + 1 < items.length ? h('button', { class: 'btn', onclick: () => practiceOne(items, i + 1) }, 'Next scenario →') : null);
  });
}

// ── tests (trainee) ──────────────────────────────────────────────────
VIEWS.tests = async () => {
  const tests = await api('/api/tests');
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
  let form = null, finished = false;
  const timer = h('span', { class: 'timer' });
  const dots = h('div', { class: 'dots' });
  const body = h('div');
  const saveBtn = h('button', { class: 'btn orange' }, 'Save & next');
  const handIn = h('button', { class: 'btn ghost' }, 'Hand in test');
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, d.name), h('span', { class: 'muted small' }, 'Time left'), timer),
    h('p', { class: 'muted small' }, `Pass = ${d.passCount} of ${d.scenarios.length} calls right. You can go back and change an answer until you hand in.`),
    dots, h('p'), body, h('div', { class: 'row' }, saveBtn, h('span', { class: 'grow' }), handIn));

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
    form = scenarioForm(s);
    body.replaceChildren(h('h2', {}, `Call ${i + 1} of ${d.scenarios.length}: ${s.title}`), form.el);
    window.scrollTo(0, 0);
  }
  saveBtn.onclick = safe(async () => {
    const s = d.scenarios[idx];
    await api(`/api/tests/${id}/answer`, { scenarioId: s.id, ...form.getSubmission() });
    answered.add(s.id); toast('Saved');
    const next = d.scenarios.findIndex((x, j) => j > idx && !answered.has(x.id));
    const any = d.scenarios.findIndex((x) => !answered.has(x.id));
    if (next >= 0) show(next); else if (any >= 0) show(any); else toast('All calls saved. Hand in when you are ready.');
  });
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
      h('button', { class: 'btn ghost', onclick: safe(async () => { const r = await api('/api/admin/scenarios/examples', {}); toast(r.added ? `Added ${r.added} example(s)` : 'Examples are already here'); go('a-scenarios'); }) }, 'Add the example scenarios'),
      h('button', { class: 'btn orange', onclick: () => editScenario() }, '+ New scenario')),
    h('p', { class: 'lead' }, 'A scenario is a short pretend call: what the caller says, the place(s), the right pin and entrance, the questions worth asking, and what the driver note must say. Use public places only, and made-up customer details.'),
    h('div', { class: 'card' }, !list.length ? h('p', { class: 'muted' }, 'No scenarios yet. Start with the examples, or make your own from real cases.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Scenario'), h('th', {}, 'Type'), h('th', {}, 'Stops'), h('th', {}, 'Tries'), h('th', {}, 'Got right'), h('th', {}, '')),
        list.map((s) => h('tr', {}, h('td', {}, h('b', {}, s.title), !s.practice ? h('div', {}, h('span', { class: 'tag' }, 'tests only')) : null),
          h('td', {}, s.category), h('td', {}, s.data.stops.map((x) => x.kind === 'dropoff' ? 'drop-off' : 'pickup').join(' + ')),
          h('td', {}, s.tries), h('td', {}, s.tries ? `${Math.round(100 * s.passes / s.tries)}%` : '–'),
          h('td', {}, s.practice ? h('button', { class: 'btn ghost small', title: 'Copy a link that opens this call', onclick: safe(async () => { await navigator.clipboard.writeText(`${location.origin}/#s-${s.id}`); toast('Link copied'); }) }, 'Copy link') : null, ' ',
            h('button', { class: 'btn ghost small', onclick: () => editScenario(s) }, 'Edit'), ' ',
            h('button', { class: 'btn ghost small', onclick: safe(async () => { if (!confirm(`Archive "${s.title}"? Past results keep it.`)) return; await api(`/api/admin/scenarios/${s.id}/archive`, {}); go('a-scenarios'); }) }, 'Archive')))))));
};

function editScenario(existing) {
  const d = existing ? structuredClone(existing.data) : {
    caller: '', why: '', stops: [{ kind: 'pickup', label: '', addressGiven: '', answer: null, start: null, entrances: [], correctEntrance: null }],
    questions: SUGGESTED_QUESTIONS.map((q) => ({ q, a: '', needed: false })), note: { mustMention: [], model: '' },
  };
  const title = h('input', { type: 'text', value: existing?.title || '', placeholder: "e.g. Menchie's on Petrovitsky Road" });
  const cat = h('select', {}, CATEGORIES.map((c) => h('option', { value: c, selected: c === (existing?.category || 'Restaurant or shop') }, c)));
  const practice = h('input', { type: 'checkbox', checked: existing ? existing.practice : true });
  const caller = h('textarea', { value: d.caller, placeholder: 'What the caller says, e.g. "Can you pick me up at 14060 Southeast Petrovitsky Road? I\'m at Menchie\'s."' });
  const why = h('textarea', { value: d.why, placeholder: 'Shown after they answer: what goes wrong if you only use the address, and how to get it right.' });
  const stopsHost = h('div');
  const qHost = h('div');
  const must = h('input', { type: 'text', value: d.note.mustMention.join(', '), placeholder: "e.g. Menchie, blue, jeans" });
  const model = h('textarea', { value: d.note.model, placeholder: "e.g. Customer is waiting at Menchie's Frozen Yogurt. Please call her if you can't find her. She is wearing a blue top and black jeans." });

  function drawStops() {
    stopsHost.replaceChildren(...d.stops.map((stop, si) => stopEditor(stop, si)),
      d.stops.length < 2 ? h('button', { class: 'btn ghost', onclick: () => { d.stops.push({ kind: d.stops[0].kind === 'pickup' ? 'dropoff' : 'pickup', label: '', addressGiven: '', answer: null, start: null, entrances: [], correctEntrance: null }); drawStops(); } },
        `+ Add a ${d.stops[0].kind === 'pickup' ? 'drop-off' : 'pickup'}`) : null);
  }
  function stopEditor(stop, si) {
    const kind = h('select', { onchange: () => { stop.kind = kind.value; } }, ['pickup', 'dropoff'].map((k) => h('option', { value: k, selected: k === stop.kind }, k === 'pickup' ? 'Pickup' : 'Drop-off')));
    const label = h('input', { type: 'text', value: stop.label, placeholder: 'Name of the place, e.g. Menchie\'s Frozen Yogurt', oninput: () => (stop.label = label.value) });
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
  function drawQuestions() {
    qHost.replaceChildren(...d.questions.map((q, i) => {
      const qq = h('input', { type: 'text', value: q.q, placeholder: 'Question the trainee could ask', oninput: () => (q.q = qq.value) });
      const aa = h('input', { type: 'text', value: q.a, placeholder: 'What the caller answers', oninput: () => (q.a = aa.value) });
      const need = h('input', { type: 'checkbox', checked: q.needed, onchange: () => (q.needed = need.checked) });
      return h('div', { class: 'qrow' }, qq, aa, h('label', { class: 'check', style: 'margin:0' }, need, 'Must ask'),
        h('button', { class: 'btn ghost small', onclick: () => { d.questions.splice(i, 1); drawQuestions(); } }, '✕'));
    }), h('button', { class: 'btn ghost small', onclick: () => { d.questions.push({ q: '', a: '', needed: false }); drawQuestions(); } }, '+ Add a question'));
  }

  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-scenarios') }, '← Scenarios'),
    h('h1', {}, existing ? 'Edit scenario' : 'New scenario'),
    h('div', { class: 'card' }, h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Scenario name (trainees see it, so do not give the answer away)'), title), h('div', {}, h('label', {}, 'Type of place'), cat)),
      h('label', {}, 'What the caller says'), caller,
      h('label', { class: 'check' }, practice, 'Use in practice (untick to keep it for tests only)')),
    stopsHost,
    h('div', { class: 'card' }, h('h2', {}, 'Questions'), h('p', { class: 'small muted' }, 'Trainees pick which ones to ask. Tick "Must ask" for the ones they need to get it right. Leave an answer blank to remove a question.'), qHost),
    h('div', { class: 'card' }, h('h2', {}, 'Driver note'),
      h('label', {}, 'The note must mention (comma separated, any order)'), must,
      h('label', {}, 'A good note (shown after they answer)'), model,
      h('label', {}, 'Why (shown after they answer)'), why),
    h('button', { class: 'btn', onclick: safe(async () => {
      const data = { ...d, caller: caller.value, why: why.value, questions: d.questions.filter((q) => q.q && q.a),
        note: { mustMention: must.value.split(',').map((x) => x.trim()).filter(Boolean), model: model.value } };
      if (data.stops.some((s) => !s.answer)) return toast('Search each stop and place its pin first.', true);
      await api('/api/admin/scenarios', { id: existing?.id, title: title.value, category: cat.value, practice: practice.checked, data });
      toast('Saved'); go('a-scenarios');
    }) }, 'Save scenario'));
  drawStops(); drawQuestions();
}

// ── admins: tests ────────────────────────────────────────────────────
VIEWS['a-tests'] = async () => {
  const [tests, classes] = await Promise.all([api('/api/admin/tests'), api('/api/admin/classes')]);
  const setStatus = (t, status) => safe(async () => { await api(`/api/admin/tests/${t.id}/status`, { status }); go('a-tests'); });
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Build tests'), h('button', { class: 'btn orange', onclick: () => editTest(null, classes) }, '+ New test')),
    h('p', { class: 'lead' }, 'A test is a set of scenarios for one class. Trainees only see it once you open it.'),
    h('div', { class: 'card' }, !tests.length ? h('p', { class: 'muted' }, 'No tests yet.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Test'), h('th', {}, 'Class'), h('th', {}, 'Rule'), h('th', {}, 'Handed in'), h('th', {}, 'Status'), h('th', {}, '')),
        tests.map((t) => h('tr', {}, h('td', {}, h('b', {}, t.name)), h('td', {}, t.class_name || '–'),
          h('td', { class: 'small' }, `${t.pass_count} of ${t.questions} right · pins within ${t.pass_meters} m · ${t.time_limit_min} min`), h('td', {}, t.handed_in),
          h('td', {}, h('span', { class: `tag ${t.status === 'open' ? 'pass' : ''}` }, t.status)),
          h('td', {}, t.status === 'draft' ? [h('button', { class: 'btn ghost small', onclick: () => editTest(t, classes) }, 'Edit'), ' ', h('button', { class: 'btn small', onclick: setStatus(t, 'open') }, 'Open')]
            : t.status === 'open' ? h('button', { class: 'btn ghost small', onclick: setStatus(t, 'closed') }, 'Close')
            : h('button', { class: 'btn ghost small', onclick: setStatus(t, 'open') }, 'Re-open')))))));
};

async function editTest(t, classes) {
  const list = await api('/api/admin/scenarios');
  const chosen = new Set(t?.scenarioIds || []);
  const name = h('input', { type: 'text', value: t?.name || '', placeholder: 'e.g. Week 1 pin test' });
  const cls = h('select', {}, h('option', { value: '' }, 'Choose…'), classes.filter((c) => c.active).map((c) => h('option', { value: c.id, selected: c.id === t?.class_id }, c.name)));
  const meters = h('input', { type: 'number', min: 1, max: 200, value: t?.pass_meters ?? 15 });
  const count = h('input', { type: 'number', min: 1, value: t?.pass_count ?? 4 });
  const mins = h('input', { type: 'number', min: 1, max: 240, value: t?.time_limit_min ?? 30 });
  const n = h('span', { class: 'tag' });
  const upd = () => (n.textContent = `${chosen.size} chosen`);
  upd();
  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-tests') }, '← Tests'), h('h1', {}, t ? 'Edit test' : 'New test'),
    h('div', { class: 'card' }, h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Test name'), name), h('div', {}, h('label', {}, 'Class'), cls)),
      h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'A pin counts as right within (metres)'), meters),
        h('div', {}, h('label', {}, 'To pass, calls right needed'), count)),
      h('label', {}, 'Time limit (minutes)'), mins),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Scenarios'), n),
      !list.length ? h('p', { class: 'muted' }, 'Add scenarios first.') :
      list.map((s) => { const cb = h('input', { type: 'checkbox', checked: chosen.has(s.id), onchange: () => { cb.checked ? chosen.add(s.id) : chosen.delete(s.id); upd(); } });
        return h('label', { class: 'check' }, cb, `${s.title} `, h('span', { class: 'small muted' }, `· ${s.category}`)); })),
    h('button', { class: 'btn', onclick: safe(async () => {
      await api('/api/admin/tests', { id: t?.id, name: name.value, classId: Number(cls.value), scenarioIds: [...chosen],
        passMeters: Number(meters.value), passCount: Number(count.value), timeLimitMin: Number(mins.value) });
      toast('Saved as a draft. Open it when the class is ready.'); go('a-tests');
    }) }, 'Save test'));
}

// ── admins: results ──────────────────────────────────────────────────
VIEWS['a-results'] = async () => {
  const tests = (await api('/api/admin/tests')).filter((t) => t.status !== 'draft');
  const host = h('div');
  const sel = h('select', { onchange: () => show(Number(sel.value)) }, tests.map((t) => h('option', { value: t.id }, `${t.name} · ${t.class_name || ''}`)));
  mount(h('h1', {}, 'Results'), !tests.length ? h('div', { class: 'card muted' }, 'Results appear here once a test is opened.') : [sel, h('p'), host]);
  async function show(id) {
    const r = await api(`/api/admin/results/${id}`);
    const done = r.rows.filter((x) => x.state === 'done');
    const what = (s) => [...s.stops.filter((x) => !x.passed).map((x) => `${x.kind === 'dropoff' ? 'drop-off' : 'pickup'} pin ${x.distance == null ? 'missing' : m(x.distance) + ' off'}`),
      ...(s.missingQuestions.length ? [`didn't ask: ${s.missingQuestions.join(' / ')}`] : []), ...(s.noteProblems.length ? ['note: ' + s.noteProblems.join(' ')] : [])];
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
  const [classes, people] = await Promise.all([api('/api/admin/classes'), api('/api/admin/people')]);
  const newName = h('input', { type: 'text', placeholder: 'e.g. October 2026' });
  mount(h('h1', {}, 'People & classes'),
    h('div', { class: 'card' }, h('h2', {}, 'Classes'), h('p', { class: 'small muted' }, 'Trainees pick their class the first time they sign in. Only open classes are offered.'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, newName), h('button', { class: 'btn', onclick: safe(async () => { await api('/api/admin/classes', { name: newName.value }); go('a-people'); }) }, 'Add class')),
      h('table', {}, classes.map((c) => h('tr', {}, h('td', {}, h('b', {}, c.name)), h('td', {}, `${c.people} people`),
        h('td', {}, h('span', { class: `tag ${c.active ? 'pass' : ''}` }, c.active ? 'open' : 'closed')),
        h('td', {}, h('button', { class: 'btn ghost small', onclick: safe(async () => { await api('/api/admin/classes', { id: c.id, active: !c.active }); go('a-people'); }) }, c.active ? 'Close' : 'Re-open')))))),
    h('div', { class: 'card' }, h('h2', {}, 'People'), h('p', { class: 'small muted' }, 'Everyone who has signed in with Slack. Fix someone’s class or give someone admin access here.'),
      h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Slack ID'), h('th', {}, 'Class'), h('th', {}, 'Role'), h('th', {}, 'Last sign-in')),
        people.map((p) => {
          const c = h('select', { onchange: safe(async () => { await api('/api/admin/people', { slackId: p.slack_id, classId: c.value ? Number(c.value) : null }); toast('Class updated'); }) },
            h('option', { value: '' }, '–'), classes.map((k) => h('option', { value: k.id, selected: k.id === p.class_id }, k.name)));
          const r = h('select', { onchange: safe(async () => { await api('/api/admin/people', { slackId: p.slack_id, role: r.value }); toast('Role updated'); }) },
            ['trainee', 'admin'].map((x) => h('option', { value: x, selected: x === p.role }, x === 'admin' ? 'Admin' : 'Trainee')));
          return h('tr', {}, h('td', {}, p.name), h('td', { class: 'small muted' }, p.slack_id), h('td', {}, c), h('td', {}, r), h('td', { class: 'small muted' }, when(p.last_login)));
        }))));
};

boot().catch((e) => mount(h('div', { class: 'card' }, e.message)));
