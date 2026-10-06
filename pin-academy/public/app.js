// GoGo Pin Academy front end. Plain JS. All user text goes in with textContent, never innerHTML.
const $view = document.getElementById('view');
const $tabs = document.getElementById('tabs');
const $who = document.getElementById('who');

let ME = null, CONFIG = {}, mapsReady = null;
const CATEGORIES = ['Hospital', 'Medical office', 'Airport', 'Apartment complex', 'Senior living', 'Gated community', 'Shopping center', 'Other'];

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

// The map + Street View pair used everywhere. Street View always looks at the pin.
async function pinMap(host, { start, draggable = true, onMove } = {}) {
  if (!(await loadMaps())) {
    host.append(h('div', { class: 'pm nomap' }, 'The map is not connected yet. It switches on once the Google Maps key is added in Railway.'));
    return null;
  }
  const [{ Map }, { AdvancedMarkerElement, PinElement }, { StreetViewPanorama, StreetViewService }, { Polyline }] = await Promise.all(
    ['maps', 'marker', 'streetView', 'maps'].map((l) => google.maps.importLibrary(l)));

  const mapDiv = h('div', { class: 'pm-map' }), panoDiv = h('div', { class: 'pm-pano' });
  const sv = h('span', { class: 'tag' }, 'Street View: –');
  const labels = h('input', { type: 'checkbox', checked: true, disabled: true });
  const segMap = h('button', { class: 'on' }, 'Map'), segSat = h('button', {}, 'Satellite');
  host.append(h('div', { class: 'pm' },
    h('div', { class: 'pm-bar' }, h('div', { class: 'seg' }, segMap, segSat), h('label', { class: 'check', style: 'margin:0' }, labels, 'Labels'),
      h('span', { class: 'grow' }), sv),
    h('div', { class: 'pm-grid' }, mapDiv, panoDiv)));

  const pano = new StreetViewPanorama(panoDiv, { addressControl: false, fullscreenControl: true, motionTracking: false, visible: true });
  const map = new Map(mapDiv, { center: start, zoom: 19, mapId: CONFIG.mapId, mapTypeId: 'roadmap', streetView: pano,
    gestureHandling: 'greedy', mapTypeControl: false, clickableIcons: false, tilt: 0 });
  const pin = new PinElement({ background: '#f28c28', borderColor: '#b35f0e', glyphColor: '#fff' });
  const marker = new AdvancedMarkerElement({ map, position: start, gmpDraggable: draggable, content: pin.element, title: 'Pickup pin' });
  const svService = new StreetViewService();
  let extras = [];

  const setType = () => map.setMapTypeId(segSat.classList.contains('on') ? (labels.checked ? 'hybrid' : 'satellite') : 'roadmap');
  segMap.onclick = () => { segMap.classList.add('on'); segSat.classList.remove('on'); labels.disabled = true; setType(); };
  segSat.onclick = () => { segSat.classList.add('on'); segMap.classList.remove('on'); labels.disabled = false; setType(); };
  labels.onchange = setType;

  function lookAt(pos) {
    svService.getPanorama({ location: pos, radius: 60 }, (data, status) => {
      if (status !== 'OK') { sv.textContent = 'Street View: none nearby'; sv.className = 'tag warn'; return; }
      pano.setPosition(data.location.latLng);
      pano.setPov({ heading: google.maps.geometry ? google.maps.geometry.spherical.computeHeading(data.location.latLng, pos) : headingTo(ll(data.location.latLng), pos), pitch: 0 });
      sv.textContent = 'Street View: facing the pin'; sv.className = 'tag pass';
    });
  }
  const moved = () => { const p = ll(marker.position); lookAt(p); onMove && onMove(p); };
  marker.addListener('dragend', moved);
  map.addListener('click', (e) => { if (!draggable) return; marker.position = e.latLng; moved(); });
  lookAt(start);

  return {
    map,
    getPin: () => ll(marker.position),
    setPin(p, center = true) { marker.position = p; if (center) map.setCenter(p); lookAt(p); onMove && onMove(p); },
    lock() { marker.gmpDraggable = false; draggable = false; },
    showAnswer(answer, mine) {
      const ok = new PinElement({ background: '#1e8a4c', borderColor: '#0f5a30', glyph: '✓', glyphColor: '#fff' });
      extras.push(new AdvancedMarkerElement({ map, position: answer, content: ok.element, title: 'Correct spot', zIndex: 5 }));
      extras.push(new Polyline({ map, path: [mine, answer], strokeColor: '#c0392b', strokeOpacity: .9, strokeWeight: 3 }));
      const b = new google.maps.LatLngBounds(); b.extend(mine); b.extend(answer);
      map.fitBounds(b, 80); if (map.getZoom() > 20) map.setZoom(20);
      lookAt(answer);
    },
    clearExtras() { extras.forEach((x) => (x.map = null, x.setMap && x.setMap(null))); extras = []; },
  };
}
function headingTo(a, b) {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

// ── shell: sign-in, tabs ─────────────────────────────────────────────
const TRAINEE_TABS = [['practice', 'Practice'], ['tests', 'Tests'], ['progress', 'My progress']];
const ADMIN_TABS = [['a-addresses', 'Addresses'], ['a-tests', 'Build tests'], ['a-results', 'Results'], ['a-people', 'People & classes']];

function drawShell(active) {
  $tabs.replaceChildren();
  $who.replaceChildren();
  if (!ME) return;
  const tab = ([id, name]) => h('button', { class: id === active ? 'on' : '', onclick: () => go(id) }, name);
  $tabs.append(...TRAINEE_TABS.map(tab));
  if (ME.role === 'admin') $tabs.append(h('span', { class: 'sep' }), ...ADMIN_TABS.map(tab));
  $who.append(h('span', {}, ME.name, ME.className ? ` · ${ME.className}` : '', ME.role === 'admin' ? ' · Trainer' : ''),
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
  render(location.hash.slice(1) || (ME.role === 'admin' ? 'a-addresses' : 'practice'));
}

function drawLogin(me) {
  drawShell();
  const box = h('div', { class: 'card login' },
    h('img', { src: '/pin.svg', width: 56, height: 56, alt: '' }),
    h('h1', {}, 'GoGo Pin Academy'),
    h('p', { class: 'lead' }, 'Practise putting the pickup pin in the right spot, then take your class pin test.'),
    me.slackReady
      ? h('a', { class: 'slackbtn', href: '/auth/slack' }, slackLogo(), 'Sign in with Slack')
      : h('p', { class: 'tag warn' }, 'Slack sign-in is not switched on yet.'));
  if (me.devLogin) {
    const id = h('input', { type: 'text', placeholder: 'Slack ID', value: 'UDEVTRAINEE' });
    const nm = h('input', { type: 'text', placeholder: 'Name', value: 'Test Trainee' });
    const ad = h('input', { type: 'checkbox' });
    box.append(h('hr'), h('p', { class: 'small muted' }, 'Local testing only (hidden on the live site)'), id, nm,
      h('label', { class: 'check' }, ad, 'Trainer'),
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
  if (!VIEWS[id] || (id.startsWith('a-') && ME.role !== 'admin')) id = 'practice';
  drawShell(id);
  try { await VIEWS[id](); } catch (e) { mount(h('div', { class: 'card' }, h('p', {}, e.message))); }
}

// ── practice ─────────────────────────────────────────────────────────
VIEWS.practice = async () => {
  const list = await api('/api/practice');
  const groups = {};
  list.forEach((a) => (groups[a.category] ||= []).push(a));
  mount(h('h1', {}, 'Practice'),
    h('p', { class: 'lead' }, 'Pick a place. The pin starts where Google drops it, just like on the dashboard. Move it to where the driver should actually stop, then lock it in. You will see the right spot and why.'),
    !list.length ? h('div', { class: 'card muted' }, 'No practice addresses yet. Your trainer adds them.') : null,
    Object.entries(groups).map(([cat, items]) => [h('h3', {}, cat),
      h('div', { class: 'tiles' }, items.map((a, i) => h('button', { class: 'tile', onclick: () => practiceOne(items, i) },
        h('span', { class: 'tag' }, a.category), h('b', {}, a.label), h('span', { class: 'small muted' }, a.address))))]));
};

async function practiceOne(items, i) {
  const a = items[i];
  const t0 = Date.now();
  const mapHost = h('div');
  const out = h('div');
  const lockBtn = h('button', { class: 'btn orange' }, 'Lock in my pin');
  mount(h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => go('practice') }, '← All addresses'), h('span', { class: 'grow' }),
      h('span', { class: 'small muted' }, `${i + 1} of ${items.length} in ${a.category}`)),
    h('div', { class: 'card' }, h('div', { class: 'small muted' }, 'The customer says:'), h('div', { class: 'question' }, a.label), h('div', { class: 'muted' }, a.address)),
    mapHost, h('p'), h('div', { class: 'row' }, lockBtn, h('span', { class: 'small muted' }, 'Drag the pin, or click the map. Street View on the right always looks at the pin.')), out);
  const pm = await pinMap(mapHost, { start: a.start });
  if (!pm) return lockBtn.disabled = true;
  lockBtn.onclick = safe(async () => {
    lockBtn.disabled = true;
    const mine = pm.getPin();
    const r = await api('/api/practice/answer', { addressId: a.id, ...mine, seconds: Math.round((Date.now() - t0) / 1000) });
    pm.lock(); pm.showAnswer(r.answer, mine);
    const good = r.distance <= 15;
    out.replaceChildren(h('div', { class: `card result ${good ? 'good' : 'bad'}` },
      h('div', { class: 'row' }, h('div', { class: 'big' }, m(r.distance)), h('span', { class: `tag ${good ? 'pass' : 'fail'}` }, r.tier),
        h('span', { class: 'muted' }, `${r.points} points`)),
      h('p', { class: 'muted' }, `Google's pin was ${r.googleWasOffBy} m from the right spot. The green ✓ is where the driver should stop.`),
      r.why ? [h('h3', {}, 'Why there'), h('p', {}, r.why)] : null,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => practiceOne(items, i) }, 'Try again'),
        i + 1 < items.length ? h('button', { class: 'btn', onclick: () => practiceOne(items, i + 1) }, 'Next address →') : null)));
    out.scrollIntoView({ behavior: 'smooth' });
  });
}

// ── tests (trainee) ──────────────────────────────────────────────────
VIEWS.tests = async () => {
  const tests = await api('/api/tests');
  mount(h('h1', {}, 'Pin tests'), h('p', { class: 'lead' }, 'Your trainer opens a test for your class. You get one go, with a time limit. No hints until you hand it in.'),
    !tests.length ? h('div', { class: 'card muted' }, ME.classId ? 'No test is open for your class right now.' : 'You are not in a class yet.') : null,
    tests.map((t) => h('div', { class: 'card row' },
      h('div', { class: 'grow' }, h('b', {}, t.name), h('div', { class: 'small muted' },
        `${t.questions} addresses · ${t.timeLimitMin} min · pass = ${t.passCount} of ${t.questions} within ${t.passMeters} m`)),
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
  let idx = d.questions.findIndex((q) => !answered.has(q.id)); if (idx < 0) idx = 0;
  let qStart = Date.now(), pm = null, finished = false;

  const timer = h('span', { class: 'timer' });
  const dots = h('div', { class: 'dots' });
  const qBox = h('div', { class: 'card' });
  const mapHost = h('div');
  const saveBtn = h('button', { class: 'btn orange' }, 'Save pin & next');
  const handIn = h('button', { class: 'btn ghost' }, 'Hand in test');
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, d.name), h('span', { class: 'muted small' }, 'Time left'), timer),
    h('p', { class: 'muted small' }, `Pass = ${d.passCount} of ${d.questions.length} within ${d.passMeters} m. You can go back and change a pin until you hand in.`),
    dots, h('p'), qBox, mapHost, h('p'), h('div', { class: 'row' }, saveBtn, h('span', { class: 'grow' }), handIn));

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

  async function show(i) {
    idx = i; qStart = Date.now();
    const q = d.questions[i];
    dots.replaceChildren(...d.questions.map((x, j) => h('button', { class: `${answered.has(x.id) ? 'done' : ''} ${j === i ? 'on' : ''}`, onclick: () => show(j), title: x.label }, j + 1)));
    qBox.replaceChildren(h('div', { class: 'small muted' }, `Address ${i + 1} of ${d.questions.length}`), h('div', { class: 'question' }, q.label), h('div', { class: 'muted' }, q.address));
    mapHost.replaceChildren();
    pm = await pinMap(mapHost, { start: q.start });
    saveBtn.disabled = !pm;
  }

  saveBtn.onclick = safe(async () => {
    const q = d.questions[idx];
    await api(`/api/tests/${id}/answer`, { addressId: q.id, ...pm.getPin(), seconds: Math.round((Date.now() - qStart) / 1000) });
    answered.add(q.id); toast('Pin saved');
    const next = d.questions.findIndex((x, j) => j > idx && !answered.has(x.id));
    const any = d.questions.findIndex((x) => !answered.has(x.id));
    if (next >= 0) show(next); else if (any >= 0) show(any); else { show(idx); toast('All pins saved. Hand in when you are ready.'); }
  });
  handIn.onclick = () => {
    const missing = d.questions.length - answered.size;
    if (confirm(missing ? `${missing} address(es) have no saved pin and will count as wrong. Hand in anyway?` : 'Hand in your test? You cannot change pins after this.')) finish(false);
  };
  show(idx);
}

function showTestResult(r) {
  const reviewHost = h('div');
  mount(h('button', { class: 'btn ghost small', onclick: () => go('tests') }, '← Tests'), h('p'),
    h('div', { class: `card result ${r.passed ? 'good' : 'bad'}` }, h('h1', {}, r.testName),
      h('div', { class: 'row' }, h('div', { class: 'big' }, `${r.correct} / ${r.total}`), h('span', { class: `tag ${r.passed ? 'pass' : 'fail'}` }, r.passed ? 'Passed' : 'Not passed yet'),
        h('span', { class: 'muted' }, `Needed ${r.passCount} within ${r.passMeters} m`))),
    h('div', { class: 'card' }, h('h2', {}, 'Each address'), h('p', { class: 'small muted' }, 'Click a row to see your pin and the right spot on the map.'),
      h('table', {}, h('tr', {}, h('th', {}, 'Address'), h('th', {}, 'Your pin was'), h('th', {}, ''), h('th', {}, 'Why')),
        r.rows.map((x) => h('tr', { style: 'cursor:pointer', onclick: () => review(x) }, h('td', {}, h('b', {}, x.label), h('div', { class: 'small muted' }, x.address)),
          h('td', {}, x.distance == null ? 'No pin' : `${m(x.distance)} off`, x.pin && !x.moved ? h('div', { class: 'small muted' }, 'Pin not moved') : null),
          h('td', {}, h('span', { class: `tag ${x.passed ? 'pass' : 'fail'}` }, x.passed ? '✓' : '✗')), h('td', { class: 'small' }, x.why || ''))))),
    reviewHost);
  async function review(x) {
    reviewHost.replaceChildren(h('h3', {}, x.label));
    const pm = await pinMap(reviewHost, { start: x.pin || x.answer, draggable: false });
    if (pm && x.pin) pm.showAnswer(x.answer, x.pin);
    reviewHost.scrollIntoView({ behavior: 'smooth' });
  }
}

// ── my progress ──────────────────────────────────────────────────────
VIEWS.progress = async () => {
  const p = await api('/api/my/history');
  mount(h('h1', {}, 'My progress'),
    h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Practice pins'), h('div', { class: 'big' }, p.practice.pins)),
      h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Within 15 m'), h('div', { class: 'big' }, p.practice.pins ? `${Math.round(100 * p.practice.within15 / p.practice.pins)}%` : '–'))),
    h('div', { class: 'card' }, h('h2', {}, 'Recent practice'), !p.recent.length ? h('p', { class: 'muted' }, 'Nothing yet.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Address'), h('th', {}, 'Off by'), h('th', {}, 'Points'), h('th', {}, 'When')),
        p.recent.map((r) => h('tr', {}, h('td', {}, r.label), h('td', {}, m(r.distance)), h('td', {}, r.points), h('td', { class: 'small muted' }, when(r.at)))))));
};

// ── trainer: addresses ───────────────────────────────────────────────
VIEWS['a-addresses'] = async () => {
  const list = await api('/api/admin/addresses');
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Addresses'), h('button', { class: 'btn orange', onclick: () => editAddress() }, '+ Add an address')),
    h('p', { class: 'lead' }, 'Hard places with the right pin set by a trainer. Use public places only (hospitals, airports, complexes), never a customer’s home address.'),
    h('div', { class: 'card' }, !list.length ? h('p', { class: 'muted' }, 'No addresses yet. Add the hard ones trainees get wrong on calls.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Place'), h('th', {}, 'Type'), h('th', {}, "Google's pin off by"), h('th', {}, 'Tries'), h('th', {}, 'Average miss'), h('th', {}, '')),
        list.map((a) => h('tr', {}, h('td', {}, h('b', {}, a.label), h('div', { class: 'small muted' }, a.address), !a.practice ? h('span', { class: 'tag' }, 'tests only') : null),
          h('td', {}, a.category),
          h('td', {}, `${a.google_off_by} m `, a.google_off_by < 15 ? h('span', { class: 'tag warn', title: "Google already gets this one right, so it doesn't test much" }, 'easy') : null),
          h('td', {}, a.tries), h('td', {}, m(a.avg_miss)),
          h('td', {}, h('button', { class: 'btn ghost small', onclick: () => editAddress(a) }, 'Edit'), ' ',
            h('button', { class: 'btn ghost small', onclick: safe(async () => { if (!confirm(`Archive "${a.label}"? Past results keep it.`)) return; await api(`/api/admin/addresses/${a.id}/archive`, {}); go('a-addresses'); }) }, 'Archive')))))));
};

async function editAddress(a) {
  let start = a ? { lat: a.start_lat, lng: a.start_lng } : null;
  const label = h('input', { type: 'text', value: a?.label || '', placeholder: 'e.g. Mercy Hospital, main entrance' });
  const address = h('input', { type: 'text', value: a?.address || '', readOnly: true, placeholder: 'Filled in when you search' });
  const cat = h('select', {}, CATEGORIES.map((c) => h('option', { value: c, selected: c === (a?.category || 'Hospital') }, c)));
  const why = h('textarea', { value: a?.why || '', placeholder: 'Where exactly the driver should stop and why. e.g. "Pick-up is at the Patient Discharge door on Elm St, not the ER entrance Google picks."' });
  const practice = h('input', { type: 'checkbox', checked: a ? !!a.practice : true });
  const off = h('span', { class: 'tag' }, '–');
  const searchHost = h('div');
  const mapHost = h('div');
  let pm = null;

  const showOff = (p) => {
    if (!start || !p) return;
    const d = Math.round(metersApprox(start, p));
    off.textContent = `Google's pin is ${d} m from your pin`; off.className = `tag ${d < 15 ? 'warn' : 'pass'}`;
  };

  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-addresses') }, '← Addresses'),
    h('h1', {}, a ? 'Edit address' : 'Add an address'),
    h('p', { class: 'lead' }, '1. Search the place. The pin drops where Google puts it. 2. Drag the pin to where the driver should really stop. 3. Say why.'),
    h('div', { class: 'card' }, h('label', {}, 'Search'), searchHost,
      h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Name trainees see'), label), h('div', {}, h('label', {}, 'Type of place'), cat)),
      h('label', {}, 'Address'), address),
    mapHost, h('p'), h('div', { class: 'row' }, off, h('span', { class: 'small muted' }, 'Under 15 m means Google already gets it right, so it is an easy one.')),
    h('div', { class: 'card' }, h('label', {}, 'Why this is the right spot (shown after they answer)'), why,
      h('label', { class: 'check' }, practice, 'Use in practice (untick to keep it for tests only)'), h('p'),
      h('button', { class: 'btn', onclick: safe(async () => {
        if (!start || !pm) return toast('Search the address first.', true);
        await api('/api/admin/addresses', { id: a?.id, label: label.value, address: address.value, category: cat.value, why: why.value,
          practice: practice.checked, start, answer: pm.getPin() });
        toast('Saved'); go('a-addresses');
      }) }, 'Save address')));

  if (!(await loadMaps())) return mapHost.append(h('div', { class: 'pm nomap' }, 'The map is not connected yet, so addresses cannot be pinned. It switches on once the Google Maps key is added in Railway.'));
  const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
  const ac = new PlaceAutocompleteElement({ includedRegionCodes: ['us'] });
  ac.style.width = '100%';
  searchHost.append(ac);
  const picked = async (place) => {
    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
    start = ll(place.location);
    address.value = place.formattedAddress || '';
    if (!label.value) label.value = place.displayName || '';
    if (!pm) pm = await pinMap(mapHost, { start, onMove: showOff });
    pm.setPin(start); showOff(start);
  };
  ac.addEventListener('gmp-select', (e) => picked(e.placePrediction.toPlace()));
  ac.addEventListener('gmp-placeselect', (e) => picked(e.place)); // older event name, same thing
  if (a) { pm = await pinMap(mapHost, { start, onMove: showOff }); pm.setPin({ lat: a.answer_lat, lng: a.answer_lng }, false); showOff(pm.getPin()); }
}
function metersApprox(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * R;
}

// ── trainer: tests ───────────────────────────────────────────────────
VIEWS['a-tests'] = async () => {
  const [tests, classes] = await Promise.all([api('/api/admin/tests'), api('/api/admin/classes')]);
  const setStatus = (t, status) => safe(async () => { await api(`/api/admin/tests/${t.id}/status`, { status }); go('a-tests'); });
  mount(h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Build tests'), h('button', { class: 'btn orange', onclick: () => editTest(null, classes) }, '+ New test')),
    h('p', { class: 'lead' }, 'A test is a set of addresses for one class. Trainees only see it once you open it.'),
    h('div', { class: 'card' }, !tests.length ? h('p', { class: 'muted' }, 'No tests yet.') :
      h('table', {}, h('tr', {}, h('th', {}, 'Test'), h('th', {}, 'Class'), h('th', {}, 'Rule'), h('th', {}, 'Handed in'), h('th', {}, 'Status'), h('th', {}, '')),
        tests.map((t) => h('tr', {}, h('td', {}, h('b', {}, t.name)), h('td', {}, t.class_name || '–'),
          h('td', { class: 'small' }, `${t.pass_count} of ${t.questions} within ${t.pass_meters} m · ${t.time_limit_min} min`), h('td', {}, t.handed_in),
          h('td', {}, h('span', { class: `tag ${t.status === 'open' ? 'pass' : ''}` }, t.status)),
          h('td', {}, t.status === 'draft' ? [h('button', { class: 'btn ghost small', onclick: () => editTest(t, classes) }, 'Edit'), ' ', h('button', { class: 'btn small', onclick: setStatus(t, 'open') }, 'Open')]
            : t.status === 'open' ? h('button', { class: 'btn ghost small', onclick: setStatus(t, 'closed') }, 'Close')
            : h('button', { class: 'btn ghost small', onclick: setStatus(t, 'open') }, 'Re-open')))))));
};

async function editTest(t, classes) {
  const addrs = await api('/api/admin/addresses');
  const chosen = new Set(t?.addressIds || []);
  const name = h('input', { type: 'text', value: t?.name || '', placeholder: 'e.g. Week 1 pin test' });
  const cls = h('select', {}, h('option', { value: '' }, 'Choose…'), classes.filter((c) => c.active).map((c) => h('option', { value: c.id, selected: c.id === t?.class_id }, c.name)));
  const meters = h('input', { type: 'number', min: 1, max: 200, value: t?.pass_meters ?? 15 });
  const count = h('input', { type: 'number', min: 1, value: t?.pass_count ?? 8 });
  const mins = h('input', { type: 'number', min: 1, max: 240, value: t?.time_limit_min ?? 20 });
  const n = h('span', { class: 'tag' });
  const upd = () => (n.textContent = `${chosen.size} chosen`);
  upd();
  mount(h('button', { class: 'btn ghost small', onclick: () => go('a-tests') }, '← Tests'), h('h1', {}, t ? 'Edit test' : 'New test'),
    h('div', { class: 'card' }, h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Test name'), name), h('div', {}, h('label', {}, 'Class'), cls)),
      h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'A pin counts as right within (metres)'), meters),
        h('div', {}, h('label', {}, 'To pass, right pins needed'), count)),
      h('label', {}, 'Time limit (minutes)'), mins),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Addresses'), n),
      !addrs.length ? h('p', { class: 'muted' }, 'Add addresses first.') :
      addrs.map((a) => { const cb = h('input', { type: 'checkbox', checked: chosen.has(a.id), onchange: () => { cb.checked ? chosen.add(a.id) : chosen.delete(a.id); upd(); } });
        return h('label', { class: 'check' }, cb, `${a.label} `, h('span', { class: 'small muted' }, `· ${a.category} · Google off by ${a.google_off_by} m`)); })),
    h('button', { class: 'btn', onclick: safe(async () => {
      await api('/api/admin/tests', { id: t?.id, name: name.value, classId: Number(cls.value), addressIds: [...chosen],
        passMeters: Number(meters.value), passCount: Number(count.value), timeLimitMin: Number(mins.value) });
      toast('Saved as a draft. Open it when the class is ready.'); go('a-tests');
    }) }, 'Save test'));
}

// ── trainer: results ─────────────────────────────────────────────────
VIEWS['a-results'] = async () => {
  const tests = (await api('/api/admin/tests')).filter((t) => t.status !== 'draft');
  const host = h('div');
  const sel = h('select', { onchange: () => show(Number(sel.value)) }, tests.map((t) => h('option', { value: t.id }, `${t.name} · ${t.class_name || ''}`)));
  mount(h('h1', {}, 'Results'), !tests.length ? h('div', { class: 'card muted' }, 'Results appear here once a test is opened.') : [h('div', { class: 'row' }, h('div', { class: 'grow' }, sel)), h('p'), host]);
  async function show(id) {
    const r = await api(`/api/admin/results/${id}`);
    const done = r.rows.filter((x) => x.state === 'done');
    host.replaceChildren(
      h('div', { class: 'grid2' },
        h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Handed in'), h('div', { class: 'big' }, `${done.length} / ${r.rows.length}`)),
        h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Passed'), h('div', { class: 'big' }, done.length ? `${done.filter((x) => x.passed).length} / ${done.length}` : '–'))),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Trainees'), h('a', { class: 'btn ghost small', href: `/api/admin/results/${id}.csv` }, 'Download CSV')),
        h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Right pins'), h('th', {}, 'Result'), h('th', {}, 'Missed')),
          r.rows.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, x.correct == null ? '–' : `${x.correct} / ${x.total}`),
            h('td', {}, x.state !== 'done' ? h('span', { class: 'tag' }, x.state) : h('span', { class: `tag ${x.passed ? 'pass' : 'fail'}` }, x.passed ? 'Passed' : 'Not passed')),
            h('td', { class: 'small' }, (x.misses || []).filter((y) => !y.passed).map((y) => `${y.label} (${y.distance == null ? 'no pin' : m(y.distance)}${y.distance != null && !y.moved ? ', not moved' : ''})`).join(' · ')))))),
      h('div', { class: 'card' }, h('h2', {}, 'Which addresses the class gets wrong'), h('p', { class: 'small muted' }, 'Low pass rates point at what to re-teach.'),
        h('table', {}, h('tr', {}, h('th', {}, 'Address'), h('th', {}, 'Got it right'), h('th', {}, 'Typical miss')),
          r.perAddress.map((a) => h('tr', {}, h('td', {}, a.label), h('td', {}, a.answered ? `${a.passed} of ${a.answered}` : '–'), h('td', {}, a.medianMiss == null ? '–' : `${a.medianMiss} m`))))));
  }
  if (tests.length) show(tests[0].id);
};

// ── trainer: people & classes ────────────────────────────────────────
VIEWS['a-people'] = async () => {
  const [classes, people] = await Promise.all([api('/api/admin/classes'), api('/api/admin/people')]);
  const newName = h('input', { type: 'text', placeholder: 'e.g. October 2026' });
  mount(h('h1', {}, 'People & classes'),
    h('div', { class: 'card' }, h('h2', {}, 'Classes'), h('p', { class: 'small muted' }, 'Trainees pick their class the first time they sign in. Only open classes are offered.'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, newName), h('button', { class: 'btn', onclick: safe(async () => { await api('/api/admin/classes', { name: newName.value }); go('a-people'); }) }, 'Add class')),
      h('table', {}, classes.map((c) => h('tr', {}, h('td', {}, h('b', {}, c.name)), h('td', {}, `${c.people} people`),
        h('td', {}, h('span', { class: `tag ${c.active ? 'pass' : ''}` }, c.active ? 'open' : 'closed')),
        h('td', {}, h('button', { class: 'btn ghost small', onclick: safe(async () => { await api('/api/admin/classes', { id: c.id, active: !c.active }); go('a-people'); }) }, c.active ? 'Close' : 'Re-open')))))),
    h('div', { class: 'card' }, h('h2', {}, 'People'), h('p', { class: 'small muted' }, 'Everyone who has signed in with Slack. Fix someone’s class or make a trainer here.'),
      h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Slack ID'), h('th', {}, 'Class'), h('th', {}, 'Role'), h('th', {}, 'Last sign-in')),
        people.map((p) => {
          const c = h('select', { onchange: safe(async () => { await api('/api/admin/people', { slackId: p.slack_id, classId: c.value ? Number(c.value) : null }); toast('Class updated'); }) },
            h('option', { value: '' }, '–'), classes.map((k) => h('option', { value: k.id, selected: k.id === p.class_id }, k.name)));
          const r = h('select', { onchange: safe(async () => { await api('/api/admin/people', { slackId: p.slack_id, role: r.value }); toast('Role updated'); }) },
            ['trainee', 'admin'].map((x) => h('option', { value: x, selected: x === p.role }, x === 'admin' ? 'Trainer' : 'Trainee')));
          return h('tr', {}, h('td', {}, p.name), h('td', { class: 'small muted' }, p.slack_id), h('td', {}, c), h('td', {}, r), h('td', { class: 'small muted' }, when(p.last_login)));
        }))));
};

boot().catch((e) => mount(h('div', { class: 'card' }, e.message)));
