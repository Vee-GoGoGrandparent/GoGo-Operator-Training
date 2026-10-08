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
const HOME = { lat: 47.44892956, lng: -122.1726835 };
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

  assert.equal((await admin('/api/admin/scenarios/examples', {})).data.added, 2);
  assert.equal((await admin('/api/admin/scenarios/examples', {})).data.added, 0);
  const list = (await admin('/api/admin/scenarios')).data;
  const men = list.find((s) => s.title.startsWith("Menchie's"));
  assert.ok(men, 'example missing');
  check('example scenario added once, not twice');
  // The Menchie's call comes in steps: the right line at each step.
  assert.equal(men.data.steps.length, 17);
  assert.equal(men.data.questions[men.data.steps[1].right[0]].q, 'Confirm the best contact number');
  assert.equal(men.data.questions[men.data.steps[0].right[0]].q, "Confirm the customer's name");
  const RIGHT = men.data.steps.map((st) => [st.right[0]]);
  const M_NOTE = men.data.note.options.findIndex((o) => o.right), M_EMOJI = men.data.note.options.findIndex((o) => /🚪/u.test(o.text));
  assert.ok(M_NOTE >= 0 && M_EMOJI >= 0 && men.data.note.options.length === 3, 'Menchie note choices missing');
  // Pin skills replace "Type of place": the list is sent to the page; an old type or unknown value is stored as a skill.
  const skills = (await ana('/api/me')).data.pinSkills;
  assert.equal(skills.length, 9); assert.equal(skills[0].name, 'Place or business name'); assert.ok(skills[1].tip.includes('End Location'));
  assert.equal(men.category, 'Place or business name');
  const sk = async (category) => { const id = (await admin('/api/admin/scenarios', { title: `Skill ${category}`, category, practice: false,
    data: { caller: 'x', stops: [{ kind: 'pickup', label: 'P', start: { lat: 40.3, lng: -75.3 }, answer: { lat: 40.3001, lng: -75.3 } }], questions: [], note: {} } })).data.id;
    return (await admin('/api/admin/scenarios')).data.find((x) => x.id === id).category; };
  assert.deepEqual([await sk('Airports'), await sk('Hospital'), await sk('Shopping center'), await sk('Made up')], ['Airports', 'Hospitals and clinics', 'Multiple entrances', 'Other']);
  check('pin skills sent to the page; Menchie\'s is "Place or business name"; old types and unknown values saved as a pin skill');

  const pub = (await ana('/api/practice')).data;
  const pubM = pub.find((s) => s.title.startsWith("Menchie's"));
  const json = JSON.stringify(pub);
  for (const secret of ['answer', 'needed', 'model', 'mustMention', 'why', '"right"', String(MENCHIES.lng)]) assert.ok(!json.includes(secret), `practice list leaks ${secret}`);
  assert.equal(pubM.steps.length, 17); assert.equal(pubM.steps[0].choices.length, 3);
  assert.deepEqual(pubM.stops[0].start, ADDRESS_ONLY, 'map should open where the address alone puts it');
  assert.ok(pubM.questions[0].say.includes('pull up your account') && pubM.questions.some((q) => q.q === 'Read the address back'), 'operator lines missing');
  check('practice list hides the right pin, must-ask flags, model note and why');

  // Address only, no questions, emoji fragment note: everything wrong.
  const bad = (await ana(`/api/practice/${men.id}`, { pins: [ADDRESS_ONLY], asked: [], noteChoice: M_EMOJI })).data;
  assert.equal(bad.passed, false);
  assert.ok(bad.stops[0].distance > 35 && bad.stops[0].distance < 50, `distance ${bad.stops[0].distance}`);
  assert.equal(bad.missingQuestions.length, 16, 'with no picks, one of the two business-name branches is skipped');
  assert.ok(bad.stepMode && bad.missingQuestions[0].startsWith('Step 1: not reached'));
  assert.equal(bad.ordered.ok, false);
  assert.equal(bad.saved.ok, false);
  assert.ok(!bad.note.ok && bad.note.problems[0].includes('leaves out'), 'picking the emoji note must fail');
  // Typed notes (tests): emoji, too short and missing words are all caught; the clothing box counts toward the note.
  const { checkNote } = await import('../src/grading.js');
  const typed = checkNote("🚪 Menchie's ☎️ Call Sheryl upon arrival", ['Menchie', 'blue', 'jeans']);
  assert.ok(typed.problems.some((p) => p.includes('emoji')) && typed.problems.some((p) => p.includes('short')) && typed.missing.includes('blue'));
  assert.equal(checkNote("Customer is waiting inside Menchie's Frozen Yogurt, please call her if you cannot find her right away.", ['Menchie', 'blue', 'jeans'], 'Blue top, black jeans').ok, true);
  check(`address-only pin is ${bad.stops[0].distance} m off; missed questions and the emoji note all caught`);

  const good = (await ana(`/api/practice/${men.id}`, { pins: [MENCHIES, HOME], ordered: true, steps: RIGHT, savedChanges: [{ slot: 3, action: 'save', ...MENCHIES }], noteChoice: M_NOTE })).data;
  assert.equal(good.passed, true, JSON.stringify(good));
  assert.ok(good.modelNote && good.why);
  check('right business pin + right questions + clear note passes, then shows the model note and why');

  // Branches (Vee, 2026-10-08): step 3 = repeat the address OR mention the saved location; the next steps follow the pick.
  const fullB = { pins: [MENCHIES, HOME], ordered: true, savedChanges: [{ slot: 3, action: 'save', ...MENCHIES }], noteChoice: M_NOTE };
  const mq = (i) => men.data.questions[i].q;
  const s3 = men.data.steps.findIndex((st) => st.right.length === 2 && st.right.map(mq).includes('Mention the saved location'));
  const joinStep = men.data.steps.findIndex((st) => st.say);
  assert.ok(s3 === 2 && joinStep > s3, `branch step ${s3}, join ${joinStep}`);
  assert.deepEqual(men.data.steps[joinStep].right.map(mq).sort(), ['Ask if they go there often', 'Tell them you are checking the map']);
  assert.ok(pubM.steps[joinStep].say.includes('go to often') && !JSON.stringify(pubM.steps).includes('"right"'), 'trainees get the shared words, never the answers');
  const repeatIdx = men.data.questions.findIndex((q) => q.q === 'Ask them to repeat the address');
  const mentionIdx = men.data.questions.findIndex((q) => q.q === 'Mention the saved location');
  const pathB = men.data.steps.map((st, n) => (n === s3 ? [mentionIdx] : st.right.includes(repeatIdx) && n !== s3 ? [] : [st.right[0]]));
  const goB = (await ana(`/api/practice/${men.id}`, { ...fullB, steps: pathB })).data;
  assert.equal(goB.passed, true, JSON.stringify(goB.missingQuestions));
  const goA = (await ana(`/api/practice/${men.id}`, { ...fullB, steps: RIGHT })).data;
  assert.equal(goA.passed, true, JSON.stringify(goA.missingQuestions));
  // Path B with the "since it's saved" business question skipped is a miss; in path A the saved version is never asked.
  const bizSaved = men.data.steps.findIndex((st) => st.when?.notSaid === repeatIdx);
  const skipB = (await ana(`/api/practice/${men.id}`, { ...fullB, steps: pathB.map((p, n) => (n === bizSaved ? [] : p)) })).data;
  assert.ok(!skipB.passed && skipB.missingQuestions.some((t) => t.startsWith(`Step ${bizSaved + 1}: not reached`)), JSON.stringify(skipB.missingQuestions));
  assert.ok(!goA.missingQuestions.length, 'path A must not be asked the saved-version question');
  // The join: either of its two right answers is right.
  const other = men.data.steps[joinStep].right.find((i) => i !== RIGHT[joinStep][0]);
  const goJ = (await ana(`/api/practice/${men.id}`, { ...fullB, steps: RIGHT.map((p, n) => (n === joinStep ? [other] : p)) })).data;
  assert.equal(goJ.passed, true);
  check('branches: both paths after step 3 pass, each skips the other path steps; skipping a step on your path is a miss; the join takes either answer, with one shared wording');

  // Steps in practice: the server says right or wrong for one pick, and never for a scenario they can't practise.
  const st0 = men.data.steps[0];
  const wrong0 = st0.choices.find((i) => !st0.right.includes(i));
  assert.equal((await ana(`/api/practice/${men.id}/step`, { step: 0, pick: st0.right[0] })).data.right, true);
  assert.equal((await ana(`/api/practice/${men.id}/step`, { step: 0, pick: wrong0 })).data.right, false);
  assert.equal((await ana(`/api/practice/${men.id}/step`, { step: 99, pick: 0 })).data.right, false);
  // A wrong pick then the right one (practice) is still a miss; a wrong pick with no retry (test) fails too.
  const full = { pins: [MENCHIES, HOME], ordered: true, savedChanges: [{ slot: 3, action: 'save', ...MENCHIES }], noteChoice: M_NOTE };
  const retried = (await ana(`/api/practice/${men.id}`, { ...full, steps: [[wrong0, st0.right[0]], ...RIGHT.slice(1)] })).data;
  assert.equal(retried.passed, false);
  assert.deepEqual(retried.missingQuestions.length, 1); assert.ok(retried.missingQuestions[0].startsWith('Step 1: picked'), retried.missingQuestions[0]);
  const onePick = (await ana(`/api/practice/${men.id}`, { ...full, steps: [[wrong0], ...RIGHT.slice(1)] })).data;
  assert.equal(onePick.passed, false);
  const short = (await ana(`/api/practice/${men.id}`, { ...full, steps: RIGHT.slice(0, 11) })).data;
  assert.ok(!short.passed && short.missingQuestions[0].startsWith('Step 12: not reached'));
  check('steps: right/wrong check per pick; a retried step is still a miss; a wrong pick or a step never reached fails');

  // Saving drops lines with no text; steps must follow the lines to their new places.
  const moved = (await admin('/api/admin/scenarios', { title: 'Steps move', category: 'Other', practice: false, data: { caller: 'x',
    stops: [{ kind: 'pickup', label: 'Q', start: { lat: 40.2, lng: -75.2 }, answer: { lat: 40.2001, lng: -75.2 } }],
    questions: [{ q: 'A', a: 'a' }, { q: '', a: '' }, { q: 'B', a: 'b' }, { q: 'C', a: 'c' }],
    steps: [{ choices: [0, 2, 3], right: [2, 3] }, { choices: [0, 1], right: [1] }], note: {} } })).data.id;
  const mv = (await admin('/api/admin/scenarios')).data.find((x) => x.id === moved).data;
  assert.deepEqual(mv.steps, [{ choices: [0, 1, 2], right: [1, 2] }], JSON.stringify(mv.steps));
  check('steps follow their lines when blank lines are dropped; a step whose right line is gone is dropped; two right answers kept');

  // Torikaya (Vee's anniversary call): home pickup from the saved Home, drop-off must be Torikaya, and skipping the
  // congratulations fails the call even with every pin right.
  const tor = (await admin('/api/admin/scenarios')).data.find((x) => x.title === 'Anniversary dinner on Houston Street');
  assert.ok(tor, 'Torikaya example missing'); assert.equal(tor.category, 'Place or business name');
  const T_HOME = { lat: 35.0170514, lng: -85.1643452 }, T_ADDR = { lat: 35.0427, lng: -85.3060933 }, T_RIGHT = { lat: 35.04246931201211, lng: -85.30682293621099 };
  const tq = (i) => tor.data.questions[i].q;
  assert.equal(tor.data.steps.length, 13);
  assert.equal(tq(tor.data.steps[1].right[0]), 'Confirm the best contact number');
  const last = tor.data.steps.length - 1;
  const cs = tor.data.steps.findIndex((st) => tq(st.right[0]) === 'Congratulate them on their anniversary');
  assert.equal(tq(tor.data.steps[cs - 1].right[0]), 'Ask for the name of the place', 'the congratulations must come right after the anniversary is mentioned');
  assert.equal(tq(tor.data.steps[cs + 1].right[0]), 'Celebrate with them while you check the map');
  assert.ok(tor.data.steps[cs + 1].choices.some((i) => tq(i) === 'Tell them you are checking the map'), 'the plain map line should be the trap there');
  assert.ok(tor.data.steps.some((st) => tq(st.right[0]) === 'Ask for notes for the driver'), 'driver notes must be asked');
  assert.ok(!tor.data.caller.includes('anniversary'), 'the opening line should not mention the anniversary');
  assert.deepEqual(tor.data.steps[last].right.map(tq), ['Close with an anniversary wish']);
  const T_OK = tor.data.steps.map((st) => [st.right[0]]);
  const tNote = 'Two passengers. The female rider uses a walker, please assist her. Please drop them off at Torikaya on Houston Street.';
  const T_NOTE = tor.data.note.options.findIndex((o) => o.right), T_NOWALKER = tor.data.note.options.findIndex((o) => !o.right && !/walker/i.test(o.text));
  const noWalker = (await ana(`/api/practice/${tor.id}`, { pins: [T_HOME, T_RIGHT], ordered: true, steps: T_OK, noteChoice: T_NOWALKER })).data;
  assert.ok(!noWalker.passed && !noWalker.note.ok, 'picking the note without the walker must fail');
  assert.ok(!(await import('../src/grading.js')).checkNote('Please drop the customer and his wife off at Torikaya on Houston Street.', tor.data.note.mustMention).ok, 'a typed note without the walker must fail');
  const tGood = (await ana(`/api/practice/${tor.id}`, { pins: [T_HOME, T_RIGHT], ordered: true, steps: T_OK, noteChoice: T_NOTE })).data;
  assert.equal(tGood.passed, true, JSON.stringify(tGood));
  const tPlain = (await ana(`/api/practice/${tor.id}`, { pins: [T_HOME, T_RIGHT], ordered: true, noteChoice: T_NOTE,
    steps: [...T_OK.slice(0, last), [tor.data.steps[last].choices.find((i) => tq(i) === 'Close the call')]] })).data;
  assert.equal(tPlain.passed, false, 'a plain close must be wrong on this call');
  const cold = tor.data.steps[cs].choices.find((i) => tq(i) === 'Tell them you are checking the map');
  const tCold = (await ana(`/api/practice/${tor.id}`, { pins: [T_HOME, T_RIGHT], ordered: true, noteChoice: T_NOTE, steps: [...T_OK.slice(0, cs), [cold], ...T_OK.slice(cs + 1)] })).data;
  assert.equal(tCold.passed, false); assert.ok(tCold.missingQuestions[0].startsWith(`Step ${cs + 1}: picked "Tell them you are checking the map"`), tCold.missingQuestions[0]);
  assert.ok(tor.data.questions.find((q) => q.q === 'Provide driver info').say.includes('call back immediately so we can look into the status of your ride'));
  const tAddr = (await ana(`/api/practice/${tor.id}`, { pins: [T_HOME, T_ADDR], ordered: true, steps: T_OK, noteChoice: T_NOTE })).data;
  assert.equal(tAddr.passed, false); assert.ok(tAddr.stops[1].distance > 65 && tAddr.stops[1].distance < 80, `distance ${tAddr.stops[1].distance}`);
  check(`Torikaya: right pins + steps pass; a plain close fails; skipping the congratulations fails; address-only drop-off is ${tAddr.stops[1].distance} m off and fails`);

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

  const ed = (await admin('/api/admin/scenarios')).data.find((x) => x.id === hosp);
  const body = { id: hosp, title: 'Hospital to home', category: 'Hospital', data: ed.data };
  assert.equal((await admin('/api/admin/scenarios', { ...body, version: ed.version })).status, 200);
  assert.equal((await admin('/api/admin/scenarios', { ...body, version: ed.version })).status, 409, 'a stale page overwrote a newer save');
  assert.equal((await admin('/api/admin/scenarios', { ...body, version: ed.version + 1 })).status, 200);
  check('saving from an out-of-date page is refused; an up-to-date save works');

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
  const saved = (await ana(`/api/tests/${t}/answer`, { scenarioId: men.id, pins: [MENCHIES, HOME], ordered: true, steps: RIGHT, savedChanges: [{ slot: 3, action: 'save', ...MENCHIES }], note: GOOD_NOTE })).data;
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

  // Saved location #3 was stored with the wrong pin: it must be fixed (saved over), not left alone or deleted.
  assert.ok(!JSON.stringify(pub).includes('savedFix'), 'trainees must not see which saved slot is wrong');
  assert.ok(pubM.account.saved[0].label.includes('Petrovitsky'), 'saved #3 should be on the account');
  const base = { pins: [MENCHIES, HOME], ordered: true, steps: RIGHT, noteChoice: M_NOTE };
  const leftIt = (await ana(`/api/practice/${men.id}`, base)).data;
  assert.equal(leftIt.passed, false); assert.ok(leftIt.saved.did.includes('Left it'));
  const deleted = (await ana(`/api/practice/${men.id}`, { ...base, savedChanges: [{ slot: 3, action: 'delete' }] })).data;
  assert.equal(deleted.passed, false); assert.ok(deleted.saved.did.includes('goes there often'));
  const savedWrong = (await ana(`/api/practice/${men.id}`, { ...base, savedChanges: [{ slot: 3, action: 'save', lat: 47.44598587, lng: -122.15203913 }] })).data;
  assert.equal(savedWrong.passed, false, 'saving the old wrong pin again must not pass');
  check('saved location #3: left wrong, deleted, or re-saved with the wrong pin all fail; trap slot is hidden');
  // Two grades (Vee): the pin and the call flow are graded apart; overall passes only when both do.
  assert.deepEqual([good.pin.ok, good.callFlow.ok, good.passed], [true, true, true]);
  assert.deepEqual([leftIt.pin.ok, leftIt.callFlow.ok, leftIt.passed], [false, true, false], 'saved location left wrong is a PIN miss');
  const flowMiss = (await ana(`/api/practice/${men.id}`, { ...base, savedChanges: [{ slot: 3, action: 'save', ...MENCHIES }], steps: RIGHT.slice(0, 5) })).data;
  assert.deepEqual([flowMiss.pin.ok, flowMiss.callFlow.ok, flowMiss.passed], [true, false, false], 'missed steps are a CALL FLOW miss');
  const pinMiss = (await ana(`/api/practice/${men.id}`, { ...base, pins: [ADDRESS_ONLY, HOME], savedChanges: [{ slot: 3, action: 'save', ...MENCHIES }] })).data;
  assert.deepEqual([pinMiss.pin.ok, pinMiss.callFlow.ok, pinMiss.passed], [false, true, false], 'a wrong pin is a PIN miss');
  check('graded in two parts: pin (pins + saved location) and call flow (steps, note, ordering); overall needs both');

  // The clothing box counts toward the driver note: clothing there, note without it, still passes.
  const typedInPractice = (await ana(`/api/practice/${men.id}`, { ...base, savedChanges: [{ slot: 3, action: 'save', ...MENCHIES }], noteChoice: null, note: GOOD_NOTE })).data;
  assert.equal(typedInPractice.passed, false, 'practice with note choices must be graded on the pick, not typed text');
  const testGrade = (await import('../src/grading.js')).gradeScenario(men.data, { ...base, savedChanges: [{ slot: 3, action: 'save', ...MENCHIES }], noteChoice: M_NOTE, note: '' }, 15);
  assert.equal(testGrade.note.ok, false, 'a test must grade the typed note even when choices exist');
  check('practice grades the picked note; a test always grades the typed note (choices never apply there)');

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
  assert.equal((await cara(`/api/practice/${hidden}/step`, { step: 0, pick: 0 })).status, 404, 'step check open before joining');
  const j = (await cara(`/api/tests/${set}/join`, {})).data;
  assert.equal(j.mode, 'practice'); assert.equal(j.user.className, 'December 2026');
  assert.equal((await ana(`/api/tests/${set}/join`, {})).status, 409, 'someone in another class must be refused');
  const listed = (await cara(`/api/tests/${set}/set`)).data;
  assert.equal(listed.scenarios.length, 1); assert.ok(!JSON.stringify(listed).includes('"answer":'));
  assert.equal((await cara(`/api/practice/${hidden}`, { pins: [{ lat: 40.1001, lng: -75.1 }], note: 'x' })).status, 200);
  assert.equal((await cara(`/api/tests/${set}/start`, {})).status, 409, 'a practice set is not a timed test');
  assert.equal((await cara('/api/practice')).data.some((x) => x.id === hidden), false, 'set-only scenario leaked into general practice');
  assert.equal((await admin('/api/practice')).data.some((x) => x.id === hidden), true, 'admins should be able to try every call');
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

  const before = (await admin('/api/admin/scenarios')).data.find((x) => x.id === men.id).tries;
  await admin(`/api/practice/${men.id}`, { pins: [MENCHIES], note: 'x' });
  assert.equal((await admin('/api/admin/scenarios')).data.find((x) => x.id === men.id).tries, before, 'an admin try counted in the scenario stats');
  assert.equal((await admin('/api/admin/people')).data.find((p) => p.slack_id === 'UADMIN').practice_tries, 1, 'admin should still see their own tries');
  check("admins' own practice is visible to them but never counted in a scenario's stats");

  // One link per class, ending with its name; it redirects into the page.
  const jan = (await admin('/api/admin/classes', { name: 'January 2027' })).data.id;
  assert.equal((await admin('/api/admin/classes')).data.find((c) => c.id === jan).slug, 'january-2027');
  assert.equal((await admin('/api/admin/classes', { name: 'january-2027!' })).status, 409, 'two classes sharing one link');
  // Two links per class (practice / test); the bare class link is internal and shows nothing.
  for (const mode of ['practice', 'test']) {
    const redir = await fetch(BASE + `/class/january-2027/${mode}`, { redirect: 'manual' });
    assert.equal(redir.status, 302); assert.equal(redir.headers.get('location'), `/#join-${mode}-january-2027`);
  }
  assert.equal((await fetch(BASE + '/class/january-2027', { redirect: 'manual' })).status, 404, 'the bare class link should show nothing');
  // One form: Menchie's for practice, the set-only scenario for the test.
  const g = await admin('/api/admin/tests/group', { name: 'January pins', classId: jan, practiceIds: [men.id], testIds: [hidden], passMeters: 15, passCount: 1, timeLimitMin: 20 });
  assert.equal(g.status, 200);
  const both = (await admin('/api/admin/tests')).data.filter((t) => t.grp === g.data.groupId);
  assert.deepEqual(both.map((t) => [t.mode, t.status, t.classSlug]), [['practice', 'draft', 'january-2027'], ['test', 'draft', 'january-2027']]);
  const fay = client();
  await fay('/auth/dev?as=UFAY&name=Fay%20New', null, { raw: true });
  let cp = (await fay('/api/class/january-2027/join', {})).data;
  assert.equal(cp.user.className, 'January 2027'); assert.equal(cp.practice.length + cp.tests.length, 0, 'drafts showed on the class link');
  for (const t of both) await admin(`/api/admin/tests/${t.id}/status`, { status: 'open' });
  cp = (await fay('/api/class/january-2027/join', {})).data;
  assert.deepEqual([cp.practice.map((s) => s.id), cp.tests.length], [[men.id], 1]);
  assert.ok(!JSON.stringify(cp).includes('"answer":'), 'class page leaked an answer');
  assert.equal((await ana('/api/class/january-2027/join', {})).status, 409, 'someone in another class joined');
  assert.equal((await fay('/api/class/no-such-class/join', {})).status, 404);
  check('class link ends with the class name; one form makes practice + test; drafts hidden; other class refused');

  const testRow = both.find((t) => t.mode === 'test');
  await fay(`/api/tests/${testRow.id}/start`, {});
  assert.equal((await admin('/api/admin/tests/group', { groupId: g.data.groupId, name: 'January pins', classId: jan, practiceIds: [men.id], testIds: [men.id + 999] })).status, 400);
  assert.equal((await admin('/api/admin/tests/group', { groupId: g.data.groupId, name: 'January pins', classId: jan, practiceIds: [], testIds: [men.id] })).status, 409, 'started test calls changed');
  assert.equal((await admin('/api/admin/tests/group', { groupId: g.data.groupId, name: 'January pins v2', classId: jan, practiceIds: [], testIds: [hidden], timeLimitMin: 25 })).status, 200);
  const after = (await admin('/api/admin/tests')).data.filter((t) => t.grp === g.data.groupId);
  assert.deepEqual(after.map((t) => [t.mode, t.name, t.time_limit_min]), [['test', 'January pins v2', 25]], 'emptied practice not removed, or test not renamed');
  check('edit: a started test keeps its calls (name and time can change); emptying practice removes it');

  assert.equal((await admin(`/api/admin/tests/${testRow.id}/delete`, {})).status, 200);
  assert.ok(!(await admin('/api/admin/tests')).data.some((t) => t.id === testRow.id), 'deleted test still listed');
  assert.equal((await fay(`/api/tests/${testRow.id}/start`, {})).status, 404, 'deleted test still opens');
  assert.equal((await fay('/api/class/january-2027/join', {})).data.tests.length, 0);
  assert.equal((await ana(`/api/admin/tests/${testRow.id}/delete`, {})).status, 403);
  const feb = (await admin('/api/admin/classes', { name: 'Feb typo' })).data.id;
  await admin('/api/admin/tests/group', { name: 'Feb', classId: feb, practiceIds: [men.id], testIds: [] });
  assert.equal((await admin(`/api/admin/classes/${feb}/delete`, {})).status, 200, 'class with only a practice set could not be deleted');
  assert.ok(!(await admin('/api/admin/tests')).data.some((t) => t.class_id === feb), "deleted class's practice still listed");
  assert.equal((await admin(`/api/admin/classes/${jan}/delete`, {})).status, 409, 'class with a trainee deleted');
  check('delete a test (gone from list and link); a class with no trainees deletes with its practice/tests; with trainees it is refused');

  // The short "New call" screen: the server builds the whole call from what is unique. All details made up.
  const NEW_CALL = { title: 'Built: dinner downtown', category: 'Place or business name', customerName: 'Leslie Knope',
    home: { address: '1 Test Avenue, Townsville, TN 37000', lat: 35.01, lng: -85.16 }, pickup: { home: true },
    dropoff: { place: { label: 'Test Bistro', addressGiven: '200 Main Street, Townsville', start: { lat: 35.04, lng: -85.3 }, answer: { lat: 35.0402, lng: -85.3003 } } },
    ride: { low: 12, high: 15, driver: { name: 'Sam', car: 'Blue Honda Civic', plate: 'ABCD', eta: '7 minutes' } }, why: 'The operator typed only the address.' };
  assert.equal((await ana('/api/admin/scenarios/build', NEW_CALL)).status, 403, 'a trainee built a call');
  assert.equal((await admin('/api/admin/scenarios/build', { ...NEW_CALL, home: null })).status, 400, 'home pickup with no home address');
  assert.equal((await admin('/api/admin/scenarios/build', { ...NEW_CALL, dropoff: { home: true } })).status, 400, 'both stops home');
  const built = (await admin('/api/admin/scenarios/build', NEW_CALL)).data.id;
  const bc = (await admin('/api/admin/scenarios')).data.find((x) => x.id === built);
  const bq = (i) => bc.data.questions[i];
  const rightSoFar = new Set();
  for (const [n, st] of bc.data.steps.entries()) {
    assert.ok(st.right.length === 1 || (st.right.length === 2 && st.say), `step ${n + 1}: one right answer, or a pair with one wording`);
    assert.ok(st.choices.length >= 2 && st.choices.length <= 3, `step ${n + 1} choices`);
    assert.ok(st.choices.every((i) => bq(i)), `step ${n + 1} points at a missing line`);
    assert.ok(!st.choices.some((i) => rightSoFar.has(i)), `step ${n + 1} offers a line that was already right`);
    st.right.forEach((i) => rightSoFar.add(i));
  }
  const order = bc.data.steps.map((st) => bq(st.right[0]).q);
  assert.deepEqual(order.slice(0, 3), ["Confirm the customer's name", 'Confirm the best contact number', 'Confirm the pickup is home']);
  assert.ok(order.includes('Ask for notes for the driver') && order.at(-1) === 'Close the call');
  const line = (q) => bc.data.questions.find((x) => x.q === q);
  assert.ok(line("Confirm the customer's name").say.includes('Leslie Knope') && line('Confirm the best contact number').say.includes('855-464-6872'));
  assert.ok(line('Provide estimate').say.includes('$12-$15'));
  assert.ok(/Sam, in a blue Honda Civic, license plate ABCD, should be arriving in about 7 minutes.*call back immediately/.test(line('Provide driver info').say), line('Provide driver info').say);
  const bOk = bc.data.steps.map((st) => [st.right[0]]);
  const bRun = (await ana(`/api/practice/${built}`, { pins: [{ lat: 35.01, lng: -85.16 }, { lat: 35.0402, lng: -85.3003 }], ordered: true, steps: bOk,
    note: 'Please drop the customer off at Test Bistro on Main Street. Thank you so much.' })).data;
  assert.equal(bRun.passed, true, JSON.stringify(bRun));
  // Vee's pairs (10/08): two lines that belong together = one step, two right answers, ONE wording said for both.
  const pairOf = (q) => bc.data.steps.find((st) => st.right.map((i) => bq(i).q).includes(q));
  const drv = pairOf('Provide driver info');
  assert.deepEqual(drv.right.map((i) => bq(i).q), ['Provide driver info', 'Ask if there is anything else']);
  assert.ok(drv.say.includes('call back immediately') && drv.say.endsWith('Is there anything else I can help you with today?'), drv.say);
  assert.deepEqual(pairOf('Read the drop-off address back').right.map((i) => bq(i).q), ['Read the drop-off address back', 'Ask for the name of the place they are going']);
  assert.deepEqual(pairOf('Confirm the pickup is home').right.map((i) => bq(i).q), ['Confirm the pickup is home', 'Ask them to repeat the address']);
  check('New call: builds a passable call in Vee’s pairs (two right answers, one wording), flow in order, wrong picks never already right, details filled in');

  // The other two trip shapes: a place to home, and a place to another place.
  const PLACE_A = { label: 'Test Clinic', addressGiven: '9 Elm Street, Townsville', start: { lat: 35.1, lng: -85.2 }, answer: { lat: 35.1002, lng: -85.2001 } };
  for (const [shape, pickup, dropoff] of [['place to home', { place: PLACE_A }, { home: true }], ['place to place', { place: PLACE_A }, NEW_CALL.dropoff]]) {
    const id = (await admin('/api/admin/scenarios/build', { ...NEW_CALL, title: `Built: ${shape}`, pickup, dropoff, wearing: 'A red coat.' })).data.id;
    const c = (await admin('/api/admin/scenarios')).data.find((x) => x.id === id).data;
    const seen = new Set();
    for (const st of c.steps) { assert.ok(!st.choices.some((i) => seen.has(i)), `${shape}: a wrong pick was already right`); st.right.forEach((i) => seen.add(i)); }
    const names = c.steps.flatMap((st) => st.right.map((i) => c.questions[i].q));
    assert.ok(names.includes('Ask what they are wearing') && names.includes('Ask for the name of the place'), `${shape}: ${names.join(' > ')}`);
    assert.equal(names.includes('Confirm the home address'), shape === 'place to home');
  }
  check('New call works for every trip shape: home to a place, a place to home, a place to another place (clothing asked when pickup is not home)');

  // A new caller: their home was saved at registration with the wrong pin. They must fix it and save it over Home.
  const HOME_RIGHT = { lat: 35.01, lng: -85.16 }, HOME_WRONG = { lat: 35.0109, lng: -85.1605 };
  const nc = (await admin('/api/admin/scenarios/build', { ...NEW_CALL, title: 'Built: new caller', pickup: { home: true, wrong: HOME_WRONG } })).data.id;
  const ncd = (await admin('/api/admin/scenarios')).data.find((x) => x.id === nc).data;
  assert.deepEqual([ncd.account.home.lat, ncd.stops[0].start.lat, ncd.stops[0].answer.lat], [HOME_WRONG.lat, HOME_WRONG.lat, HOME_RIGHT.lat]);
  assert.deepEqual(ncd.savedFix, { slot: 'home', action: 'update', stop: 'pickup' });
  const ncNames = ncd.steps.map((st) => ncd.questions[st.right[0]].q);
  assert.deepEqual(ncNames.slice(2, 5), ['Confirm the pickup is home', 'Tell them you are checking the map', 'Fix and save the home pin']);
  const ncRun = (cs) => ana(`/api/practice/${nc}`, { pins: [HOME_RIGHT, { lat: 35.0402, lng: -85.3003 }], ordered: true, steps: ncd.steps.map((st) => [st.right[0]]),
    note: 'Please drop the customer off at Test Bistro on Main Street. Thank you so much.', savedChanges: cs });
  const ncLeft = (await ncRun([])).data, ncFixed = (await ncRun([{ slot: 'home', action: 'save', ...HOME_RIGHT }])).data;
  assert.equal(ncLeft.passed, false); assert.ok(ncLeft.saved.want.includes('over Home'), ncLeft.saved.want);
  assert.equal(ncFixed.passed, true, JSON.stringify(ncFixed.saved));
  check("new caller: home saved at registration with the wrong pin; the call confirms home, checks the map, fixes and saves it; leaving it fails");

  // A place saved on the account with the wrong pin: go there often = save the fix over #3, otherwise remove it.
  for (const often of [true, false]) {
    const sp = (await admin('/api/admin/scenarios/build', { ...NEW_CALL, title: `Built: saved place ${often}`, pickup: { home: true },
      dropoff: { place: { ...NEW_CALL.dropoff.place, saved: true, often } } })).data.id;
    const spd = (await admin('/api/admin/scenarios')).data.find((x) => x.id === sp).data;
    assert.equal(spd.account.saved[0].lat, NEW_CALL.dropoff.place.start.lat, 'the saved place should hold the wrong pin');
    assert.deepEqual(spd.savedFix, { slot: 3, action: often ? 'update' : 'delete', stop: 'dropoff' });
    const names = spd.steps.flatMap((st) => st.right.map((i) => spd.questions[i].q));
    const i = names.indexOf('Mention the saved location');
    assert.ok(i > 0 && names[i - 1] === 'Ask for the name of the place they are going' && names[i - 2] === 'Read the drop-off address back', names.join(' > '));
    assert.ok(names.includes('Ask if they go there often') && names.includes(often ? 'Save it as their preferred location' : 'Remove the wrong saved location'));
    assert.ok(spd.questions.find((q) => q.q === 'Ask if they go there often').say.includes('Test Bistro'));
  }
  check('saved place with the wrong pin: mention it after the read-back, ask if they go often, then save it over #3 (often) or remove it (not often)');

  // One wording for every New call: changing a standard line changes those calls, not hand-made ones like Menchie's.
  assert.equal((await ana('/api/admin/standard-lines')).status, 403);
  const lines = (await admin('/api/admin/standard-lines')).data;
  assert.ok(lines.lines.some((l) => l.key === 'driver') && lines.placeholders.driver);
  const newDriver = "NEW WORDING: {driver} in a {car}, plate {plate}, about {eta}. If you don't see the driver, call us back immediately.";
  assert.equal((await admin('/api/admin/standard-lines', { key: 'driver', q: 'Provide driver info', say: newDriver, a: 'Thanks.' })).status, 200);
  assert.equal((await admin('/api/admin/standard-lines', { key: 'nope', q: 'x', say: 'x', a: 'x' })).status, 400);
  const after2 = (await admin('/api/admin/scenarios')).data;
  assert.ok(after2.find((x) => x.id === built).data.questions.find((q) => q.q === 'Provide driver info').say.startsWith('NEW WORDING: Sam in a blue Honda Civic'));
  assert.ok(!after2.find((x) => x.id === men.id).data.questions.find((q) => q.q === 'Provide driver info').say.includes('NEW WORDING'), "Menchie's own line changed");
  const pubBuilt = (await ana('/api/practice')).data.find((x) => x.id === built);
  assert.ok(pubBuilt.questions.some((q) => q.say.startsWith('NEW WORDING')), 'trainees still see the old wording');
  check('changing a standard line changes every New call (trainees see it too), never a hand-made call; trainees cannot see or change the lines');

  // Tests: a different order for each person (stable for that person); practice: the same order for everyone.
  const shufClass = (await admin('/api/admin/classes', { name: 'Shuffle class' })).data.id;
  const four = (await admin('/api/admin/scenarios')).data.slice(0, 4).map((x) => x.id);
  assert.equal(four.length, 4);
  const sg = (await admin('/api/admin/tests/group', { name: 'Shuffle', classId: shufClass, practiceIds: [], testIds: four, passCount: 1, timeLimitMin: 30 })).data.groupId;
  const sp = (await admin('/api/admin/tests/group', { name: 'Shuffle practice', classId: shufClass, practiceIds: four, testIds: [] })).data.groupId;
  const shufTests = (await admin('/api/admin/tests')).data.filter((x) => x.grp === sg || x.grp === sp);
  for (const x of shufTests) await admin(`/api/admin/tests/${x.id}/status`, { status: 'open' });
  const tId = shufTests.find((x) => x.mode === 'test').id, pId = shufTests.find((x) => x.mode === 'practice').id;
  const orders = [], practiceOrders = [];
  for (let k = 0; k < 8; k++) {
    const who = client();
    await who(`/auth/dev?as=USHUF${k}&name=Shuffle%20${k}`, null, { raw: true });
    await who('/api/me/class', { classId: shufClass });
    const o = (await who(`/api/tests/${tId}/start`, {})).data.scenarios.map((x) => x.id);
    assert.deepEqual([...o].sort(), [...four].sort(), 'a test lost or gained a call');
    assert.deepEqual((await who(`/api/tests/${tId}/start`, {})).data.scenarios.map((x) => x.id), o, 'the order changed on reload');
    orders.push(o.join(','));
    practiceOrders.push((await who(`/api/tests/${pId}/set`)).data.scenarios.map((x) => x.id).join(','));
  }
  assert.ok(new Set(orders).size >= 3, `only ${new Set(orders).size} different test orders for 8 people`);
  assert.equal(new Set(practiceOrders).size, 1, 'practice should be the same order for everyone');
  check(`test calls come in a different order per person (${new Set(orders).size} orders for 8 people, same on reload); practice is the same for everyone`);

  // Archive: only a class 6 months old can be archived; an archived class's link stops working.
  const young = (await admin('/api/admin/classes', { name: 'Young class' })).data.id;
  assert.equal((await admin('/api/admin/classes', { id: young, archived: true })).status, 409, 'a new class was archived');
  db.prepare(`UPDATE classes SET created_at = datetime('now', '-7 months') WHERE id = ?`).run(young);
  assert.equal((await admin('/api/admin/classes')).data.find((c) => c.id === young).canArchive, true);
  assert.equal((await admin('/api/admin/classes', { id: young, archived: true })).status, 200);
  assert.equal((await admin('/api/admin/classes')).data.find((c) => c.id === young).archived, true);
  const late = client(); await late('/auth/dev?as=ULATE&name=Late%20Joiner', null, { raw: true });
  assert.equal((await late('/api/class/young-class/join', {})).status, 404, 'an archived class link still works');
  assert.equal((await admin('/api/admin/classes', { id: young, archived: false })).status, 200);
  check('a class can be archived once it is 6 months old (not before); an archived class link stops working; it can be brought back');

  // Every sign-in is kept and listed per person.
  for (let k = 0; k < 2; k++) await ana('/auth/dev?as=UANA&name=Ana%20Trainee', null, { raw: true });
  const anaRow = (await admin('/api/admin/people')).data.find((p) => p.slack_id === 'UANA');
  const anaLogins = (await admin('/api/admin/people/UANA/logins')).data;
  assert.equal(anaRow.logins, anaLogins.length); assert.ok(anaLogins.length >= 3, `only ${anaLogins.length} sign-ins kept`);
  assert.equal((await ana('/api/admin/people/UANA/logins')).status, 403);
  check(`every sign-in is kept (${anaLogins.length} for one trainee) and only admins can see the list`);
  const anaTries = (await admin('/api/admin/people/UANA/practice')).data;
  assert.equal(anaTries.length, (await admin('/api/admin/people')).data.find((p) => p.slack_id === 'UANA').practice_tries, 'not every practice try is listed');
  assert.ok(anaTries.some((t) => t.passed) && anaTries.some((t) => !t.passed) && anaTries.every((t) => t.at && t.title));
  assert.ok(anaTries.some((t) => t.pin === false && t.callFlow === true), 'pin and call flow should be listed per try');
  assert.equal((await ana('/api/admin/people/UANA/practice')).status, 403);
  check(`every practice try is listed per trainee (${anaTries.length}): when, which call, pin and call flow; admins only`);

  assert.ok((await (await fetch(BASE + '/')).text()).includes('GoGo Academy'));
  check('page loads');
  console.log(`\nAll ${passed} checks passed.`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  server.close();
  try { (await import('../src/db.js')).db.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
