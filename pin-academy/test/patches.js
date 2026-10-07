// The one-time Menchie's patch must ADD what is missing and never undo an admin's edits.
// Also: "Add the examples" must never overwrite an existing (possibly edited) example.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-patches-'));
process.env.DATA_DIR = dir;
const { db, one, run } = await import('../src/db.js');
const { cleanScenario } = await import('../src/grading.js');
const { EXAMPLE_SCENARIOS } = await import('../src/examples.js');

let passed = 0;
const check = (name) => { passed++; console.log(`  ✓ ${name}`); };
try {
  // An admin-edited Menchie's: one line removed, one line reworded, one new line, no home, pickup only.
  const ex = structuredClone(EXAMPLE_SCENARIOS[0]);
  const d = ex.data;
  delete d.account.home; d.stops = d.stops.filter((x) => x.kind === 'pickup'); delete d.ride;
  d.account.saved = [{ label: 'Doctor', address: 'Admin saved place', lat: 47.5, lng: -122.2 }]; delete d.savedFix; // #3 lost, admin's own place kept
  d.questions = d.questions.filter((q) => !['Ask if they go there often', 'Mention the saved location', 'Ask if there is anything else', 'Close the call'].includes(q.q));
  d.questions = d.questions.filter((q) => !['Provide estimate', 'Provide driver info', 'Ask them to spell the street'].includes(q.q));
  d.questions[0].say = 'ADMIN WORDING';
  d.questions.push({ q: 'Admin extra line', say: 'Something Vee added', a: 'Sure.', needed: false });
  run('INSERT INTO scenarios (title, category, data) VALUES (?, ?, ?)', ex.title, ex.category, JSON.stringify(cleanScenario(d)));

  const { runPatches } = await import('../src/patches.js');
  runPatches();
  const after = JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', ex.title).data);
  assert.equal(after.questions[0].say, 'ADMIN WORDING', 'admin wording was undone');
  assert.ok(after.questions.some((q) => q.q === 'Admin extra line'), 'admin line was removed');
  assert.ok(!after.questions.some((q) => q.q === 'Ask them to spell the street'), 'a line the admin removed came back');
  assert.ok(after.questions.some((q) => q.q === 'Provide estimate') && after.questions.some((q) => q.q === 'Provide driver info'));
  assert.equal(after.account.home.lat, 47.44892956); assert.equal(after.account.home.lng, -122.1726835);
  assert.ok(after.stops.some((x) => x.kind === 'dropoff' && x.answer.lat === 47.44892956));
  assert.equal(after.ride.customerName, 'Marge Simpson');
  check('patch adds home, drop-off, ride and the two lines; admin wording, extra line and removal all kept');
  assert.equal(after.account.saved[0].lat, 47.44598587, 'saved #3 with the wrong pin not restored');
  assert.equal(after.account.saved[1].label, 'Doctor', "admin's own saved place lost or moved out");
  assert.deepEqual(after.savedFix, { slot: 3, action: 'update', stop: 'pickup' });
  const oi = after.questions.findIndex((q) => q.q === 'Ask if they go there often');
  assert.ok(oi >= 0 && after.questions[oi + 1].q === 'Ask for notes for the driver', 'go-often line missing or misplaced');
  check('saved #3 (wrong pin) restored as the slot to fix; admin saved place kept; "go there often" line back');
  assert.ok(after.questions.filter((q) => /anything else/i.test(q.say)).length === 1, 'anything-else line missing or doubled');
  assert.ok(after.questions.some((q) => q.q === 'Close the call' && q.needed));
  const sv = after.questions.findIndex((q) => q.q === 'Mention the saved location');
  assert.ok(sv > 0 && /read the address back/i.test(after.questions[sv - 1].q), 'saved-location line missing or misplaced');
  check('closing lines added once (must-ask); "location saved" line right after the read-back');

  // Running again changes nothing, and does not add the lines twice.
  run('UPDATE scenarios SET data = ? WHERE title = ?', JSON.stringify({ ...after, why: 'ADMIN WHY' }), ex.title);
  runPatches();
  const again = JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', ex.title).data);
  assert.equal(again.why, 'ADMIN WHY', 'patch ran a second time');
  assert.equal(again.questions.filter((q) => q.q === 'Provide estimate').length, 1);
  check('patch runs only once');

  // "Add the examples" must leave an existing example alone (test through the server route).
  process.env.DEV_LOGIN = '1';
  const { server } = await import('../server.js');
  await new Promise((r) => server.listen(0, r));
  const B = `http://localhost:${server.address().port}`;
  let ck = '';
  const call = async (p, body) => { const r = await fetch(B + p, { redirect: 'manual', method: body ? 'POST' : 'GET', headers: { cookie: ck, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) ck = c.split(';')[0]; return r.json().catch(() => ({})); };
  await call('/auth/dev?as=UA&role=admin');
  const r = await call('/api/admin/scenarios/examples', {});
  assert.equal(r.added, 0);
  assert.equal(JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', ex.title).data).why, 'ADMIN WHY', 'examples button overwrote an edit');
  check('"Add the examples" never overwrites an existing scenario');
  server.close();
  console.log(`\nAll ${passed} patch checks passed.`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  try { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
