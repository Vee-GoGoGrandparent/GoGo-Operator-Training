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
  // The live call from before steps: no steps, no "confirm the name" line.
  delete d.steps; d.questions = d.questions.filter((q) => q.q !== "Confirm the customer's name");
  // ...and from before Vee's new order: no 'save as preferred' / 'confirm the home address' lines, no note choices, old answers.
  d.questions = d.questions.filter((q) => !['Save it as their preferred location', 'Confirm the home address', 'Confirm the best contact number'].includes(q.q));
  delete d.note.options;
  d.questions.find((q) => q.q === 'Ask where they are going').a = 'Home. Can we set up the pickup first?';
  d.questions[0].say = 'ADMIN WORDING';
  d.questions.push({ q: 'Admin extra line', say: 'Something Vee added', a: 'Sure.', needed: false });
  run('INSERT INTO scenarios (title, category, data) VALUES (?, ?, ?)', ex.title, ex.category, JSON.stringify(cleanScenario(d)));

  // Scenarios saved before pin skills, with the old "Type of place".
  for (const [title, category] of [['Old mall', 'Shopping center'], ['Old clinic', 'Medical office'], ['Old odd', 'Other'], ['Old new', 'Airports']]) {
    run('INSERT INTO scenarios (title, category, data) VALUES (?, ?, ?)', title, category, JSON.stringify(cleanScenario(d)));
  }
  const { runPatches } = await import('../src/patches.js');
  runPatches();
  const after = JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', ex.title).data);
  assert.equal(after.questions.find((q) => q.q === 'Ask them to repeat the address').say, 'ADMIN WORDING', 'admin wording was undone');
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
  assert.equal(after.questions[0].q, "Confirm the customer's name", 'confirm-name line not added first');
  assert.equal(after.questions.filter((q) => q.q === "Confirm the customer's name").length, 1);
  const name = (i) => after.questions[i].q;
  assert.equal(after.steps.length, 17);
  assert.equal(name(after.steps[1].right[0]), 'Confirm the best contact number', 'contact number not confirmed right after the name');
  assert.equal(after.questions.filter((q) => /best contact number/i.test(q.q)).length, 1);
  assert.deepEqual(after.steps.map((st) => name(st.right[0])).slice(0, 6), ["Confirm the customer's name", 'Confirm the best contact number', 'Ask them to repeat the address', 'Read the address back', 'Mention the saved location', 'Ask for the name of the business']);
  assert.ok(!after.steps.some((st) => st.choices.some((i) => name(i) === 'Ask them to spell the street')), 'a line the admin removed shows as a choice');
  assert.ok(after.steps.every((st) => st.choices.every((i) => i >= 0 && i < after.questions.length)));
  check('steps added in order, pointing at the right lines; "confirm the name" first; removed lines never offered');

  // Vee's new Menchie's order: her version backed up first; her own lines kept; answers, two new lines and note choices in.
  const bk = one('SELECT * FROM scenario_backups WHERE title = ?', ex.title);
  assert.ok(bk, 'no backup taken before replacing the steps');
  assert.ok(!JSON.parse(bk.data).questions.some((q) => q.q === 'Save it as their preferred location'), 'backup should hold the version from before the new order');
  const ans = (label) => after.questions.find((q) => q.q === label)?.a;
  assert.deepEqual([ans('Mention the saved location'), ans('Ask if they go there often'), ans('Ask where they are going')],
    ['Oh yes, I was just dropped off here earlier.', 'Yes, I go every Sunday.', 'Home.']);
  assert.ok(after.questions.some((q) => q.q === 'Save it as their preferred location') && after.questions.some((q) => q.q === 'Confirm the home address'));
  assert.ok(after.questions.some((q) => q.q === 'Admin extra line'), "the admin's own line was dropped");
  assert.equal(after.note.options.length, 3); assert.equal(after.note.options.filter((o) => o.right).length, 1);
  check("Menchie's new order: backup taken first; admin's own line kept; new answers, the two new lines and note choices in");
  const cat = (t) => one('SELECT category, version FROM scenarios WHERE title = ?', t);
  assert.deepEqual([cat('Old mall').category, cat('Old clinic').category, cat('Old odd').category, cat('Old new').category],
    ['Multiple entrances', 'Hospitals and clinics', 'Other', 'Airports']);
  assert.ok(cat('Old mall').version > cat('Old new').version, 'a moved scenario must get a new version, so an editor opened before cannot save the old type back');
  check('old "Type of place" values moved to their pin skill; already-a-skill left alone; moved ones get a new version');

  // Running again changes nothing, and does not add the lines twice.
  run('UPDATE scenarios SET data = ? WHERE title = ?', JSON.stringify({ ...after, why: 'ADMIN WHY' }), ex.title);
  runPatches();
  const again = JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', ex.title).data);
  assert.equal(again.why, 'ADMIN WHY', 'patch ran a second time');
  assert.equal(again.questions.filter((q) => q.q === 'Provide estimate').length, 1);
  check('patch runs only once');

  // If an admin already set the steps, the steps patch leaves them alone (even if it somehow runs again).
  const own = [{ choices: [0, 1], right: [1] }];
  run('UPDATE scenarios SET data = ? WHERE title = ?', JSON.stringify({ ...again, steps: own }), ex.title);
  run(`DELETE FROM patches WHERE name = 'menchies-call-steps-2026-10-07'`);
  runPatches();
  assert.deepEqual(JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', ex.title).data).steps, own, "admin's steps were replaced");
  check("an admin's own steps are never replaced");

  const torCount = () => one('SELECT COUNT(*) n FROM scenarios WHERE title = ?', 'Anniversary dinner on Houston Street').n;
  assert.equal(torCount(), 1, 'Torikaya not added on a site that has the examples');
  run(`DELETE FROM patches WHERE name = 'add-torikaya-2026-10-07'`); runPatches();
  assert.equal(torCount(), 1, 'Torikaya added twice');
  const td = JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', 'Anniversary dinner on Houston Street').data);
  assert.equal(td.steps.length, 13); assert.equal(td.account.home.lat, 35.0170514); assert.equal(td.ride.driver.name, 'Yoandris');
  check('Torikaya added once to a site that already has the examples, with its steps, home and driver');

  // The live Torikaya (first version) gets the new flow; an edited one is left alone.
  const v1 = fs.readFileSync(new URL('../src/snapshots/torikaya-v1.json', import.meta.url), 'utf8');
  assert.equal(JSON.parse(v1).steps.length, 10, 'snapshot is not the first version');
  const tor = (sql) => one('SELECT data, version FROM scenarios WHERE title = ?', 'Anniversary dinner on Houston Street');
  run('UPDATE scenarios SET data = ? WHERE title = ?', v1, 'Anniversary dinner on Houston Street');
  const before = tor().version;
  run(`DELETE FROM patches WHERE name = 'torikaya-flow-v2-2026-10-07'`); runPatches();
  const up = JSON.parse(tor().data);
  assert.equal(up.steps.length, 13); assert.ok(up.note.mustMention.includes('walker')); assert.ok(tor().version > before, 'version not bumped');
  const edited = JSON.parse(v1); edited.why = 'VEE EDITED IT';
  run('UPDATE scenarios SET data = ? WHERE title = ?', JSON.stringify(edited), 'Anniversary dinner on Houston Street');
  run(`DELETE FROM patches WHERE name = 'torikaya-flow-v2-2026-10-07'`); runPatches();
  assert.equal(JSON.parse(tor().data).why, 'VEE EDITED IT', 'an edited Torikaya was overwritten');
  check('live Torikaya (first version) gets the new flow; an edited one is left exactly as it is');
  // The fixture's driver line was removed by the "admin", then re-added by the first patch in its ORIGINAL wording.
  const drv = JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', ex.title).data).questions.find((q) => q.q === 'Provide driver info');
  assert.ok(drv.say.includes('call back immediately so we can look into the status of your ride'), 'original driver line not reworded');
  const mine = JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', ex.title).data);
  mine.questions.find((q) => q.q === 'Provide driver info').say = 'ADMIN DRIVER LINE';
  run('UPDATE scenarios SET data = ? WHERE title = ?', JSON.stringify(mine), ex.title);
  run(`DELETE FROM patches WHERE name = 'menchies-driver-line-2026-10-07'`); runPatches();
  assert.equal(JSON.parse(one('SELECT data FROM scenarios WHERE title = ?', ex.title).data).questions.find((q) => q.q === 'Provide driver info').say, 'ADMIN DRIVER LINE', 'admin driver line overwritten');
  check('driver line reworded to the standard "call back immediately" wording only while it is the original; an admin edit is kept');

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
