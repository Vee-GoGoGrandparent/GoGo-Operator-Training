// End-to-end check on a throwaway database: admins build scenarios and a test, trainees practise and take it.
// Every "must fail" case is checked too, so a broken guard shows up as a failure here.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-academy-'));
process.env.DATA_DIR = dir;
process.env.DEV_LOGIN = '1';
delete process.env.RAILWAY_ENVIRONMENT;
const { server } = await import('../server.js');
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

let passed = 0;
const check = (name) => { passed++; console.log(`  ✓ ${name}`); };

function client() {
  let cookie = '';
  return async function call(p, body, { raw } = {}) {
    const res = await fetch(BASE + p, { redirect: 'manual', headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const [k] = kv.split('='); cookie = [...cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')), kv].join('; '); }
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

// Vee's Menchie's case: the address alone vs. the business picked by name.
const ADDRESS_ONLY = { lat: 47.4460548, lng: -122.1517119 };
const MENCHIES = { lat: 47.4460118, lng: -122.1522953 };
const GOOD_NOTE = "Customer is waiting inside Menchie's Frozen Yogurt. She is wearing a blue top and black jeans, please call her if you can't find her.";

try {
  const admin = client(), ana = client(), ben = client();
  await admin('/auth/dev?as=UADMIN&name=Oscar&role=admin', null, { raw: true });
  await ana('/auth/dev?as=UANA&name=Ana%20Trainee', null, { raw: true });
  await ben('/auth/dev?as=UBEN&name=Ben%20Other', null, { raw: true });
  assert.equal((await admin('/api/me')).data.user.role, 'admin');
  assert.equal((await ana('/api/me')).data.user.role, 'trainee');
  assert.equal((await ana('/api/admin/scenarios')).status, 403);
  assert.equal((await client()('/api/practice')).status, 401);
  check('roles right; trainees blocked from admin pages; signed-out blocked');

  const oct = (await admin('/api/admin/classes', { name: 'October 2026' })).data.id;
  const nov = (await admin('/api/admin/classes', { name: 'November 2026' })).data.id;
  await ana('/api/me/class', { classId: oct });
  await ben('/api/me/class', { classId: nov });
  assert.equal((await ana('/api/me/class', { classId: nov })).status, 409);
  check('classes made; a trainee can pick their class only once');

  assert.equal((await admin('/api/admin/scenarios/examples', {})).data.added, 1);
  assert.equal((await admin('/api/admin/scenarios/examples', {})).data.added, 0);
  const list = (await admin('/api/admin/scenarios')).data;
  const men = list.find((s) => s.title.startsWith("Menchie's"));
  assert.ok(men, 'example missing');
  check('example scenario added once, not twice');

  const pub = (await ana('/api/practice')).data;
  const json = JSON.stringify(pub);
  for (const secret of ['answer', 'needed', 'model', 'mustMention', 'why', String(MENCHIES.lng)]) assert.ok(!json.includes(secret), `practice list leaks ${secret}`);
  assert.deepEqual(pub[0].stops[0].start, ADDRESS_ONLY, 'map should open where the address alone puts it');
  assert.ok(pub[0].questions[0].say.includes('pull up your account') && pub[0].questions.some((q) => q.q === 'Read the address back'), 'operator lines missing');
  check('practice list hides the right pin, must-ask flags, model note and why');

  // Address only, no questions, emoji fragment note: everything wrong.
  const bad = (await ana(`/api/practice/${men.id}`, { pins: [ADDRESS_ONLY], asked: [], note: "🚪 Menchie's ☎️ Call Sheryl upon arrival" })).data;
  assert.equal(bad.passed, false);
  assert.ok(bad.stops[0].distance > 35 && bad.stops[0].distance < 50, `distance ${bad.stops[0].distance}`);
  assert.equal(bad.missingQuestions.length, 4);
  assert.ok(bad.note.problems.some((p) => p.includes('emoji')) && bad.note.problems.some((p) => p.includes('short')) && bad.note.missing.includes('blue'));
  check(`address-only pin is ${bad.stops[0].distance} m off; missed questions and the emoji note all caught`);

  const good = (await ana(`/api/practice/${men.id}`, { pins: [MENCHIES], asked: [0, 1, 3, 8], note: GOOD_NOTE })).data;
  assert.equal(good.passed, true, JSON.stringify(good));
  assert.ok(good.modelNote && good.why);
  check('right business pin + right questions + clear note passes, then shows the model note and why');

  // Two-stop scenario with entrances, made in the admin builder.
  assert.equal((await admin('/api/admin/scenarios', { title: 'Broken', category: 'Hospital', data: { stops: [{ kind: 'pickup', label: 'X' }] } })).status, 400);
  const hosp = (await admin('/api/admin/scenarios', { title: 'Hospital to home', category: 'Hospital', data: {
    caller: 'I am being discharged from Mercy Hospital, take me home.',
    stops: [
      { kind: 'pickup', label: 'Mercy Hospital', addressGiven: '1 Main St', start: { lat: 39.8, lng: -89.65 }, answer: { lat: 39.8004, lng: -89.65 },
        entrances: [{ name: 'ER', lat: 39.8008, lng: -89.65 }, { name: 'Discharge door, Elm St', lat: 39.8004, lng: -89.65 }], correctEntrance: 1 },
      { kind: 'dropoff', label: 'Home', addressGiven: '5 Oak Ave', start: { lat: 39.81, lng: -89.66 }, answer: { lat: 39.81, lng: -89.66 } },
    ],
    questions: [{ q: 'Which entrance will you be at?', a: 'The discharge door on Elm Street.', needed: true }],
    note: { mustMention: ['discharge', 'Elm'], model: 'Customer will be at the discharge door on Elm Street.' } } })).data.id;
  assert.ok(hosp);
  check('admin builder saves a two-stop scenario with entrances; a stop with no pin is refused');

  const t = (await admin('/api/admin/tests', { name: 'Week 1', classId: oct, scenarioIds: [men.id, hosp], passMeters: 15, passCount: 2, timeLimitMin: 30 })).data.id;
  assert.equal((await ana('/api/tests')).data.length, 0, 'draft visible');
  await admin(`/api/admin/tests/${t}/status`, { status: 'open' });
  assert.equal((await ana('/api/tests')).data.length, 1);
  assert.equal((await ben('/api/tests')).data.length, 0);
  assert.equal((await ben(`/api/tests/${t}/start`, {})).status, 404);
  check('draft tests hidden; an open test only shows to its own class');

  const st = (await ana(`/api/tests/${t}/start`, {})).data;
  assert.equal(st.scenarios.length, 2);
  assert.ok(!JSON.stringify(st).includes('"answer":') && !JSON.stringify(st).includes('needed') && !JSON.stringify(st).includes(String(MENCHIES.lng)), 'test start leaks answers');
  const saved = (await ana(`/api/tests/${t}/answer`, { scenarioId: men.id, pins: [MENCHIES], asked: [0, 1, 3, 8], note: GOOD_NOTE })).data;
  assert.deepEqual(saved, { saved: true }, 'answer must not reveal the result during a test');
  // Hospital: right pickup door but the ER entrance picked from the list, no question asked, good drop-off.
  await ana(`/api/tests/${t}/answer`, { scenarioId: hosp, pins: [{ lat: 39.8008, lng: -89.65 }, { lat: 39.81, lng: -89.66 }], entrances: [0, null], asked: [],
    note: 'Customer will be waiting at the discharge door on Elm Street, please call when you arrive.' });
  assert.equal((await admin(`/api/admin/tests/${t}/status`, { status: 'draft' })).status, 409);
  check('during a test nothing is revealed; a started test cannot go back to draft');

  const res = (await ana(`/api/tests/${t}/submit`, {})).data.result;
  assert.equal(res.correct, 1); assert.equal(res.passed, false);
  const h = res.rows.find((r) => r.scenarioId === hosp).result;
  assert.equal(h.stops[0].passed, false); assert.equal(h.stops[1].passed, true);
  assert.equal(h.stops[0].entrance.correct, 'Discharge door, Elm St'); assert.equal(h.stops[0].entrance.chose, 'ER');
  assert.equal((await ana(`/api/tests/${t}/answer`, { scenarioId: hosp, pins: [] })).status, 409);
  check('hand-in: 1 of 2 right (wrong entrance caught, drop-off right), answers locked after');

  const rr = (await admin(`/api/admin/results/${t}`)).data;
  assert.equal(rr.rows[0].passed, false);
  assert.equal(rr.perScenario.find((s) => s.title === 'Hospital to home').pinWrong, 1);
  assert.ok(rr.rows[0].scenarios.find((s) => s.title === 'Hospital to home').note.includes('Elm'), 'admins should see the note text');
  const csv = await (await admin(`/api/admin/results/${t}.csv`, null, { raw: true })).text();
  assert.ok(csv.startsWith('"Name","Slack ID"') && csv.includes('Ana Trainee') && csv.includes('"Fail"'));
  assert.equal((await ana(`/api/admin/results/${t}`)).status, 403);
  check('admin results show what went wrong and the note text; CSV works; trainees cannot see results');

  // A stop saved with no start never opens the map on the answer.
  const nostart = (await admin('/api/admin/scenarios', { title: 'No start', category: 'Other', data: { caller: 'x', stops: [{ kind: 'pickup', label: 'Y', answer: { lat: 40.123456, lng: -75.654321 } }], questions: [], note: {} } })).data.id;
  const ns = (await ana('/api/practice')).data.find((s) => s.id === nostart);
  assert.notDeepEqual(ns.stops[0].start, { lat: 40.123456, lng: -75.654321 });
  check('a scenario without a saved start does not open on the answer');

  const t2 = (await admin('/api/admin/tests', { name: 'Timed', classId: nov, scenarioIds: [men.id], passCount: 1, timeLimitMin: 1 })).data.id;
  await admin(`/api/admin/tests/${t2}/status`, { status: 'open' });
  await ben(`/api/tests/${t2}/start`, {});
  const { db } = await import('../src/db.js');
  db.prepare(`UPDATE attempts SET deadline = datetime('now', '-5 minutes') WHERE test_id = ?`).run(t2);
  assert.equal((await ben(`/api/tests/${t2}/answer`, { scenarioId: men.id, pins: [MENCHIES] })).status, 409);
  assert.equal((await ben('/api/tests')).data.find((x) => x.id === t2).state, 'done');
  check('time limit enforced by the server; late test handed in automatically');

  // The clothing box counts toward the driver note: clothing there, note without it, still passes.
  const split = (await ana(`/api/practice/${men.id}`, { pins: [MENCHIES], asked: [0, 1, 3, 8], wearing: 'Blue top, black jeans',
    note: "Customer is waiting inside Menchie's Frozen Yogurt, please call her if you cannot find her right away." })).data;
  assert.equal(split.passed, true, JSON.stringify(split.note));
  check('clothing in the What Are You Wearing Today? box counts toward the driver note');

  // Class links: a practice set for a class; someone with no class joins it from the link; another class is refused.
  const dec = (await admin('/api/admin/classes', { name: 'December 2026' })).data.id;
  const hidden = (await admin('/api/admin/scenarios', { title: 'Set only', category: 'Other', practice: false,
    data: { caller: 'Hi, I need a ride.', stops: [{ kind: 'pickup', label: 'Z', start: { lat: 40.1, lng: -75.1 }, answer: { lat: 40.1001, lng: -75.1 } }], questions: [], note: {} } })).data.id;
  const set = (await admin('/api/admin/tests', { mode: 'practice', name: 'December practice', classId: dec, scenarioIds: [hidden] })).data.id;
  const cara = client();
  await cara('/auth/dev?as=UCARA&name=Cara%20New', null, { raw: true });
  assert.equal((await cara(`/api/tests/${set}/join`, {})).status, 404, 'draft link should not work');
  await admin(`/api/admin/tests/${set}/status`, { status: 'open' });
  assert.equal((await cara(`/api/practice/${hidden}`, { pins: [] })).status, 404, 'set-only scenario open before joining');
  const j = (await cara(`/api/tests/${set}/join`, {})).data;
  assert.equal(j.mode, 'practice'); assert.equal(j.user.className, 'December 2026');
  assert.equal((await ana(`/api/tests/${set}/join`, {})).status, 409, 'someone in another class must be refused');
  const listed = (await cara(`/api/tests/${set}/set`)).data;
  assert.equal(listed.scenarios.length, 1); assert.ok(!JSON.stringify(listed).includes('"answer":'));
  assert.equal((await cara(`/api/practice/${hidden}`, { pins: [{ lat: 40.1001, lng: -75.1 }], note: 'x' })).status, 200);
  assert.equal((await cara(`/api/tests/${set}/start`, {})).status, 409, 'a practice set is not a timed test');
  assert.equal((await cara('/api/practice')).data.some((x) => x.id === hidden), false, 'set-only scenario leaked into general practice');
  const ppl = (await admin('/api/admin/people')).data.find((p) => p.slack_id === 'UCARA');
  assert.equal(ppl.practice_tries, 1); assert.equal(ppl.class_name, 'December 2026');
  check('class link: draft refused, joins the class, other class refused, practice set works, People shows progress');

  // Classes: rename; delete only while empty.
  assert.equal((await admin('/api/admin/classes', { id: dec, name: 'Dec 2026' })).status, 200);
  assert.equal((await admin('/api/admin/classes', { id: dec, name: 'October 2026' })).status, 409, 'duplicate name allowed');
  assert.equal((await admin(`/api/admin/classes/${dec}/delete`, {})).status, 409, 'class with people deleted');
  const empty = (await admin('/api/admin/classes', { name: 'Typo clas' })).data.id;
  assert.equal((await admin(`/api/admin/classes/${empty}/delete`, {})).status, 200);
  assert.ok(!(await admin('/api/admin/classes')).data.some((c) => c.id === empty));
  assert.equal((await ana(`/api/admin/classes/${empty}/delete`, {})).status, 403);
  check('classes rename (no duplicates); only an empty class can be deleted; trainees cannot delete');

  assert.ok((await (await fetch(BASE + '/')).text()).includes('GoGo Pin Academy'));
  check('page loads');
  console.log(`\nAll ${passed} checks passed.`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  server.close();
  try { (await import('../src/db.js')).db.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
