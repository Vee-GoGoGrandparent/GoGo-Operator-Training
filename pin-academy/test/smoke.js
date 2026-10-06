// End-to-end check on a throwaway database: a trainer builds a test, a trainee practises and takes it.
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
const check = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

function client() {
  let cookie = '';
  return async function call(p, body, { raw } = {}) {
    const res = await fetch(BASE + p, { redirect: 'manual', headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) { const [kv] = c.split(';'); const [k] = kv.split('='); cookie = [...cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')), kv].join('; '); }
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
}

try {
  const trainer = client(), trainee = client(), other = client();
  await trainer('/auth/dev?as=UTRAINER&name=Oscar&role=admin', null, { raw: true });
  await trainee('/auth/dev?as=UTRAINEE1&name=Ana%20Trainee', null, { raw: true });
  await other('/auth/dev?as=UTRAINEE2&name=Ben%20Other', null, { raw: true });

  assert.equal((await trainer('/api/me')).data.user.role, 'admin');
  assert.equal((await trainee('/api/me')).data.user.role, 'trainee');
  check('dev sign-in gives the right roles', () => {});

  // must fail: trainee on trainer pages; nobody signed in
  assert.equal((await trainee('/api/admin/addresses')).status, 403);
  assert.equal((await client()('/api/practice')).status, 401);
  check('trainee blocked from trainer pages, signed-out blocked from everything', () => {});

  const oct = (await trainer('/api/admin/classes', { name: 'October 2026' })).data.id;
  const nov = (await trainer('/api/admin/classes', { name: 'November 2026' })).data.id;
  assert.equal((await trainer('/api/admin/classes', { name: 'October 2026' })).status, 409);
  check('classes created, duplicate name refused', () => {});

  // Google drops the pin ~40 m from the right door; answer set by the trainer.
  const hosp = { label: 'Test Hospital', address: '1 Main St, Springfield, IL', category: 'Hospital', why: 'Discharge door on Elm St.',
    start: { lat: 39.80000, lng: -89.65000 }, answer: { lat: 39.80036, lng: -89.65000 } };
  const a1 = (await trainer('/api/admin/addresses', hosp)).data.id;
  const a2 = (await trainer('/api/admin/addresses', { ...hosp, label: 'Test Airport', practice: false, start: { lat: 39.84, lng: -89.68 }, answer: { lat: 39.8402, lng: -89.68 } })).data.id;
  assert.equal((await trainer('/api/admin/addresses', { ...hosp, answer: { lat: 999, lng: 0 } })).status, 400);
  check('addresses saved, bad coordinates refused', () => {});

  // must fail: trainee cannot see answers in the practice list
  await trainee('/api/me/class', { classId: oct });
  await other('/api/me/class', { classId: nov });
  assert.equal((await trainee('/api/me/class', { classId: nov })).status, 409);
  const plist = (await trainee('/api/practice')).data;
  assert.equal(plist.length, 1, 'tests-only address must not be in practice');
  assert.ok(!JSON.stringify(plist).includes('answer') && !JSON.stringify(plist).includes('why'), 'practice list leaks the answer');
  check('practice list hides answers and tests-only addresses; class can only be picked once', () => {});

  const pr = (await trainee('/api/practice/answer', { addressId: a1, lat: 39.80036, lng: -89.65003, seconds: 12 })).data;
  assert.ok(pr.distance > 1 && pr.distance < 4, `distance ${pr.distance}`);
  assert.equal(pr.points, 100);
  assert.equal(pr.googleWasOffBy, 40);
  assert.equal((await trainee('/api/practice/answer', { addressId: a2, lat: 1, lng: 1 })).status, 404);
  check('practice scores on the server (≈2.6 m → 100 pts; Google 40 m off); tests-only address refused', () => {});

  const t = (await trainer('/api/admin/tests', { name: 'Week 1 pin test', classId: oct, addressIds: [a1, a2], passMeters: 15, passCount: 2, timeLimitMin: 20 })).data.id;
  assert.equal((await trainee('/api/tests')).data.length, 0, 'draft test must be invisible');
  await trainer(`/api/admin/tests/${t}/status`, { status: 'open' });
  assert.equal((await trainee('/api/tests')).data.length, 1);
  assert.equal((await other('/api/tests')).data.length, 0, 'other class must not see it');
  assert.equal((await other(`/api/tests/${t}/start`, {})).status, 404);
  check('draft tests hidden; open test only visible to its own class', () => {});

  const st = (await trainee(`/api/tests/${t}/start`, {})).data;
  assert.equal(st.questions.length, 2);
  assert.ok(!JSON.stringify(st).includes('answer_lat') && !JSON.stringify(st).match(/"answer"/), 'test start leaks answers');
  const ans = (await trainee(`/api/tests/${t}/answer`, { addressId: a1, lat: 39.80036, lng: -89.65 })).data;
  assert.deepEqual(ans, { saved: true }, 'answer response must not reveal distance');
  // a2 left on Google's pin (20+ m off) → should fail that one
  await trainee(`/api/tests/${t}/answer`, { addressId: a2, lat: 39.84, lng: -89.68 });
  assert.equal((await trainer(`/api/admin/tests/${t}/status`, { status: 'draft' })).status, 409);
  check('test hides answers while running; started test cannot go back to draft', () => {});

  const res = (await trainee(`/api/tests/${t}/submit`, {})).data.result;
  assert.equal(res.correct, 1); assert.equal(res.passed, false);
  assert.equal(res.rows.find((r) => r.addressId === a2).moved, false);
  assert.equal((await trainee(`/api/tests/${t}/answer`, { addressId: a2, lat: 39.8402, lng: -89.68 })).status, 409);
  check('hand-in scores 1 of 2 (not passed), flags the unmoved pin, and locks answers', () => {});

  const rr = (await trainer(`/api/admin/results/${t}`)).data;
  assert.equal(rr.rows.length, 1); assert.equal(rr.rows[0].passed, false);
  assert.equal(rr.perAddress.find((x) => x.label === 'Test Airport').passed, 0);
  const csv = await (await trainer(`/api/admin/results/${t}.csv`, null, { raw: true })).text();
  assert.ok(csv.startsWith('"Name","Slack ID"') && csv.includes('Ana Trainee'));
  assert.equal((await trainee(`/api/admin/results/${t}`)).status, 403);
  check('trainer results + CSV correct; trainee cannot read results', () => {});

  // deadline: a test whose time ran out is handed in automatically
  const t2 = (await trainer('/api/admin/tests', { name: 'Timed', classId: nov, addressIds: [a1], passCount: 1, timeLimitMin: 1 })).data.id;
  await trainer(`/api/admin/tests/${t2}/status`, { status: 'open' });
  await other(`/api/tests/${t2}/start`, {});
  const { db } = await import('../src/db.js');
  db.prepare(`UPDATE attempts SET deadline = datetime('now', '-5 minutes') WHERE test_id = ?`).run(t2);
  assert.equal((await other(`/api/tests/${t2}/answer`, { addressId: a1, lat: 39.80036, lng: -89.65 })).status, 409);
  assert.equal((await other('/api/tests')).data.find((x) => x.id === t2).state, 'done');
  check('time limit enforced by the server, late test auto-handed-in', () => {});

  // the page itself is served
  const html = await (await fetch(BASE + '/')).text();
  assert.ok(html.includes('GoGo Pin Academy'));
  check('page loads', () => {});

  console.log(`\nAll ${passed} checks passed.`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  server.close();
  try { (await import('../src/db.js')).db.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
