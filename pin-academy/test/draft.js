// "Draft the call with Claude": what Claude sends back is checked and merged into the call, with no real API call
// (a made-up answer stands in for Claude). Also: with no key, the button says so instead of failing silently.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-draft-'));
process.env.DATA_DIR = dir;
process.env.DEV_LOGIN = '1';
delete process.env.ANTHROPIC_API_KEY;
const { buildCall } = await import('../src/build-call.js');
const { applyDraft, draftProblems } = await import('../src/draft.js');

let passed = 0;
const check = (name) => { passed++; console.log(`  ✓ ${name}`); };
try {
  const base = buildCall({ title: 'Draft test', category: 'Place or business name', customerName: 'Rick Sanchez',
    home: { address: '1 Test Avenue, Townsville, TN 37000', lat: 35.01, lng: -85.16 }, pickup: { home: true },
    dropoff: { place: { label: 'Torikaya', addressGiven: '1120 Houston Street', start: { lat: 35.0427, lng: -85.3060933 }, answer: { lat: 35.0424, lng: -85.3068 } } },
    ride: { low: 23, high: 25 } }).data;
  const name = (d, i) => d.questions[i].q;
  const GOOD = {
    caller: 'Hi, this is Rick. My wife and I need a ride from home to Torikaya on Houston Street.',
    why: 'The operator typed only the address. Ask for the name of the place and pick it from the list.',
    noteModel: 'Two passengers. The female rider uses a walker, please assist her. Please drop them off at Torikaya.',
    noteOptions: [{ text: 'Two passengers. The female rider uses a walker, please assist her.', right: true }, { text: 'Drop off at Torikaya.', right: false }, { text: '🚶 walker', right: false }],
    mustMention: ['Torikaya', 'walker'],
    answerChanges: [{ button: 'Ask for the name of the place they are going', answer: "It's Torikaya. We're going there for our anniversary tonight!" }],
    extraLines: [{ button: 'Congratulate them on their anniversary', say: 'Oh, happy anniversary! How long have you been married?', answer: 'Forty years today.',
      afterButton: 'Ask for the name of the place they are going', wrongButtons: ['Tell them you are checking the map', 'Provide estimate'] }],
  };
  const d = applyDraft(base, GOOD);
  const order = d.steps.map((st) => name(d, st.right[0]));
  const ci = order.indexOf('Congratulate them on their anniversary');
  assert.equal(order[ci - 1], 'Ask for the name of the place they are going', order.join(' > '));
  assert.ok(d.steps[ci].choices.map((i) => name(d, i)).includes('Tell them you are checking the map'));
  const seen = new Set();
  for (const st of d.steps) { assert.ok(st.choices.every((i) => d.questions[i] && !seen.has(i)), 'a choice points nowhere or was already right'); st.right.forEach((i) => seen.add(i)); }
  const place = d.questions.find((q) => q.q === 'Ask for the name of the place they are going');
  assert.ok(place.a.includes('anniversary') && !place.std, 'a reworded standard line must become the call\'s own');
  assert.deepEqual(d.note.mustMention, ['Torikaya', 'walker']); assert.equal(d.note.options.filter((o) => o.right).length, 1);
  assert.equal(d.caller, GOOD.caller); assert.equal(d.stops[1].answer.lat, base.stops[1].answer.lat, 'the draft must never move a pin');
  check('Claude\'s special moment goes right after the step it follows; answers, why, note and note choices merged; pins untouched');

  for (const [bad, why] of [
    [{ ...GOOD, why: 'Call her at 555-201-3344.' }, 'phone'], [{ ...GOOD, noteModel: 'Email jane@example.com' }, 'email'],
    [{ ...GOOD, caller: 'I need an Uber to Torikaya.' }, 'ride company'], [{ ...GOOD, why: "Tell her we'll call you back later." }, 'callback'],
    [{ ...GOOD, extraLines: [{ ...GOOD.extraLines[0], answer: 'I was born 03/14/1948.' }] }, 'date'],
  ]) assert.throws(() => applyDraft(base, bad), (e) => e.status === 422, `not refused: ${why}`);
  assert.deepEqual(draftProblems(['Please give us a call back at 855-464-6872.']), [], "GoGo's own number and 'give us a call back' are fine");
  check('a draft with a phone number, email, date, Uber/Lyft or a callback offer is refused; GoGo\'s own number is fine');

  const odd = applyDraft(base, { ...GOOD, extraLines: [{ ...GOOD.extraLines[0], afterButton: 'No such button' }, { ...GOOD.extraLines[0], button: 'Provide estimate' }] });
  assert.equal(odd.steps.length, base.steps.length, 'a line after a missing step, or one copying an existing button, must be dropped');
  check('extra lines that point at a missing step or copy an existing button are dropped, never half-added');

  // Through the server, with no key set: the status says so and the button explains instead of failing silently.
  const { server } = await import('../server.js');
  await new Promise((r) => server.listen(0, r));
  const B = `http://localhost:${server.address().port}`;
  let ck = '';
  const call = async (p, body) => { const r = await fetch(B + p, { redirect: 'manual', method: body ? 'POST' : 'GET', headers: { cookie: ck, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) ck = c.split(';')[0]; return { status: r.status, data: await r.json().catch(() => ({})) }; };
  await call('/auth/dev?as=UADM&role=admin');
  assert.deepEqual((await call('/api/admin/draft/status')).data, { ready: false });
  const r = await call('/api/admin/scenarios/draft', { data: base, title: 'x', category: 'Place or business name' });
  assert.equal(r.status, 503); assert.ok(r.data.error.includes('not set'));
  const prev = await call('/api/admin/scenarios/build-preview', { title: 'P', category: 'Airports', customerName: 'Rick Sanchez', home: { address: 'A', lat: 1, lng: 1 }, pickup: { home: true },
    dropoff: { place: { label: 'X', addressGiven: '1 Y St', answer: { lat: 2, lng: 2 } } }, ride: { low: 1, high: 2 } });
  assert.equal(prev.status, 200); assert.ok(prev.data.data.steps.length > 5);
  assert.equal(JSON.parse(JSON.stringify((await call('/api/admin/scenarios')).data)).length, 0, 'a preview must not save anything');
  server.close();
  check('no key: status says not ready and Draft explains it; a preview builds a call without saving it');
  console.log(`\nAll ${passed} draft checks passed.`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  try { (await import('../src/db.js')).db.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
