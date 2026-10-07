// Grading for a scenario: the pin(s), the questions asked, and the note for the driver.
// Everything is decided here on the server, never in the browser.
import { metersBetween, validLatLng } from './scoring.js';
import { isStandardKey, renderCall } from './standard-lines.js';

const EMOJI = /\p{Extended_Pictographic}/u;
const MIN_NOTE_WORDS = 8;

// The driver sees both the Driver Message Preview and the What Are You Wearing Today? box, so the must-mention
// words can be in either. The note itself still has to be a real sentence.
export function checkNote(text, mustMention = [], wearing = '') {
  const t = String(text || '').trim();
  const w = String(wearing || '').trim();
  const words = t ? t.split(/\s+/).length : 0;
  const lower = `${t} ${w}`.toLowerCase();
  const missing = mustMention.filter((k) => k && !lower.includes(k.toLowerCase()));
  const problems = [];
  if (words < MIN_NOTE_WORDS) problems.push('Too short to help a driver. Write it as a full sentence.');
  if (EMOJI.test(t) || EMOJI.test(w)) problems.push('No emojis. Drivers work for the ride company, so write it plainly.');
  if (missing.length) problems.push(`Missing: ${missing.join(', ')}.`);
  return { text: t, wearing: w, missing, problems, ok: problems.length === 0 };
}

// In practice, a call can offer 2-3 driver notes to pick from (one right) instead of writing one. Tests always type.
function pickedNote(options, choice) {
  const o = Number.isInteger(choice) ? options[choice] : null;
  if (!o) return { text: '', wearing: '', missing: [], problems: ['Pick the note that tells the driver what they need.'], ok: false, picked: true };
  return { text: o.text, wearing: '', missing: [], ok: !!o.right, picked: true,
    problems: o.right ? [] : ['That note leaves out something the driver needs. Compare it with the good note below.'] };
}

// s = scenario data, sub = what the trainee sent, passMeters = how close counts as right.
// practice = true when graded from practice (note choices apply there only).
export function gradeScenario(s, sub, passMeters, { practice = false } = {}) {
  const pins = Array.isArray(sub?.pins) ? sub.pins : [];
  const entrances = Array.isArray(sub?.entrances) ? sub.entrances : [];
  const stops = s.stops.map((stop, i) => {
    const p = pins[i];
    const has = p && validLatLng(Number(p.lat), Number(p.lng));
    const distance = has ? metersBetween({ lat: Number(p.lat), lng: Number(p.lng) }, stop.answer) : null;
    const correctEntrance = Number.isInteger(stop.correctEntrance) ? stop.correctEntrance : null;
    const chose = Number.isInteger(entrances[i]) ? entrances[i] : null;
    const entranceOk = correctEntrance == null || chose === correctEntrance || (distance != null && distance <= passMeters);
    return {
      kind: stop.kind, label: stop.label,
      distance: distance == null ? null : Math.round(distance * 10) / 10,
      passed: distance != null && distance <= passMeters && entranceOk,
      answer: stop.answer,
      entrance: correctEntrance == null ? null : { chose: chose == null ? null : stop.entrances[chose]?.name || null, correct: stop.entrances[correctEntrance]?.name || null },
    };
  });
  // A call with steps is graded on the steps; "Must ask" is only used by calls without steps.
  const steps = gradeSteps(s, sub);
  const asked = new Set((Array.isArray(sub?.asked) ? sub.asked : []).map(Number));
  const missingQuestions = steps ? steps.filter((x) => !x.ok).map((x) => x.text)
    : s.questions.map((q, i) => ({ ...q, i })).filter((q) => q.needed && !asked.has(q.i)).map((q) => q.q);
  const noteOptions = s.note?.options || [];
  const note = practice && noteOptions.length ? pickedNote(noteOptions, sub?.noteChoice) : checkNote(sub?.note, s.note?.mustMention || [], sub?.wearing);
  const saved = gradeSavedFix(s, sub, passMeters);
  const ordered = s.mustOrder === false ? null : { ok: !!sub?.ordered };
  return {
    stops, stepMode: !!steps, missingQuestions, note, saved, ordered, modelNote: s.note?.model || '', why: s.why || '',
    passed: stops.every((x) => x.passed) && missingQuestions.length === 0 && note.ok && (!saved || saved.ok) && (!ordered || ordered.ok),
  };
}

// The call in steps: each step shows a few lines, one or two of them right. sub.steps[n] = every line picked at step n,
// in order. Practice lets them pick again after a wrong one (still a miss); a test plays the wrong line and moves on.
// A step is right only if every pick at it was a right line.
export function isRightPick(s, step, pick) {
  return !!s.steps?.[step]?.right.includes(pick);
}
function gradeSteps(s, sub) {
  if (!s.steps?.length) return null;
  const picks = Array.isArray(sub?.steps) ? sub.steps : [];
  const line = (i) => `"${s.questions[i]?.q || '?'}"`;
  return s.steps.map((st, n) => {
    const p = (Array.isArray(picks[n]) ? picks[n] : []).map(Number).filter(Number.isInteger);
    const should = st.right.map(line).join(' or ');
    const wrong = p.filter((i) => !st.right.includes(i));
    if (!p.length) return { ok: false, text: `Step ${n + 1}: not reached (should be ${should})` };
    if (wrong.length) return { ok: false, text: `Step ${n + 1}: picked ${wrong.map(line).join(', then ')} (should be ${should})` };
    return { ok: true, text: `Step ${n + 1}: ${line(p[0])}` };
  });
}

// Steps point at lines by their place in the list. When lines are dropped, point them at the new places,
// keep only real choices (max 6), and drop a step that has no right line left.
export function cleanSteps(steps, newIndex) {
  return (Array.isArray(steps) ? steps : []).slice(0, 30).map((st) => {
    const map = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((i) => newIndex.has(i)).map((i) => newIndex.get(i)))];
    const choices = map(st?.choices).slice(0, 6);
    return { choices, right: map(st?.right).filter((i) => choices.includes(i)).slice(0, 3) };
  }).filter((st) => st.right.length);
}

// When a scenario has a saved location that was stored wrong (slot 3, 4 or 5): did they fix it the right way?
// 'update' = save the corrected pin over that slot (the customer goes there often); 'delete' = remove it.
function gradeSavedFix(s, sub, passMeters) {
  const fix = s.savedFix;
  if (!fix) return null;
  const changes = (Array.isArray(sub?.savedChanges) ? sub.savedChanges : []).filter((c) => c && String(c.slot) === String(fix.slot));
  const last = changes[changes.length - 1];
  const stop = s.stops.find((x) => x.kind === fix.stop) || s.stops[0];
  const want = fix.action === 'delete' ? `Delete Custom Location #${fix.slot}` : `Save the corrected pin over Custom Location #${fix.slot}`;
  if (!last) return { ok: false, want, did: 'Left it as it was (the saved pin is still wrong)' };
  if (fix.action === 'delete') return { ok: last.action === 'delete', want, did: last.action === 'delete' ? 'Deleted it' : 'Saved over it instead of deleting it' };
  if (last.action !== 'save') return { ok: false, want, did: 'Deleted it, but the customer goes there often' };
  const d = validLatLng(Number(last.lat), Number(last.lng)) ? metersBetween({ lat: Number(last.lat), lng: Number(last.lng) }, stop.answer) : null;
  return { ok: d != null && d <= passMeters, want, did: d == null ? 'Saved without a pin' : `Saved it, ${Math.round(d)} m from the right spot` };
}

// Where the map opens if a stop has no saved start: rounded to ~100 m so it never sits on the answer.
const nearby = (p) => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });

// What a trainee may see before answering: no right pins, no "needed" flags, no model note.
export function publicScenario(row) {
  const s = renderCall(JSON.parse(row.data)); // standard lines filled in with the current wording
  return {
    id: row.id, title: row.title, category: row.category,
    caller: s.caller, account: s.account || { home: null, saved: [] }, ride: cleanRide(s.ride),
    stops: s.stops.map((x) => ({ kind: x.kind, label: x.label, addressGiven: x.addressGiven, start: x.start || nearby(x.answer), entrances: x.entrances.map((e) => ({ name: e.name, lat: e.lat, lng: e.lng })) })),
    questions: s.questions.map((q) => ({ q: q.q, say: q.say || '', a: q.a })),
    // Only which lines show at each step, mixed up, so the right one is not always in the same place.
    steps: (s.steps || []).map((st) => ({ choices: shuffle(st.choices) })),
    // Driver note choices for practice: the text only, mixed up; which one is right stays on the server.
    noteOptions: shuffle((s.note?.options || []).map((o, i) => ({ i, text: o.text }))),
  };
}
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// What Get Estimate / Order Ride show. Defaults are Vee's example (made-up customer: Marge Simpson).
const RIDE_DEFAULTS = { customerName: 'Marge Simpson', rideType: 'UberX', eta: '1-5 min(s)', trip: 'A 5 minute(s) trip over 1 for $8 ~ $10',
  surge: '1', perMile: '$ 1.98', perMinute: '$ 0.84', baseFare: '', minFare: '5.99', cost: '$8 ~ $10', credits: '$67.32', expiring: 'No', autoTip: 'No',
  driver: { name: 'Lidong', car: 'Black Toyota Sienna', plate: '0734', eta: '2 minutes' } };
function cleanRide(r = {}) {
  const out = {};
  for (const [k, v] of Object.entries(RIDE_DEFAULTS)) if (k !== 'driver') out[k] = typeof r[k] === 'string' ? r[k].trim().slice(0, 120) : v;
  out.driver = {};
  for (const [k, v] of Object.entries(RIDE_DEFAULTS.driver)) out.driver[k] = typeof r.driver?.[k] === 'string' ? r.driver[k].trim().slice(0, 80) : v;
  return out;
}
const ll = (p) => (p && validLatLng(Number(p.lat), Number(p.lng)) ? { lat: Number(p.lat), lng: Number(p.lng) } : null);
// A place saved on the pretend customer's account (home, or a saved location that may or may not be right).
const savedPlace = (p) => (p && ll(p) ? { label: str(p.label, 60) || 'Saved', address: str(p.address, 200), ...ll(p) } : null);

// Driver note choices: 2-4 notes, at least one right. Anything less is not a choice, so it is dropped.
function cleanNoteOptions(a) {
  const o = (Array.isArray(a) ? a : []).slice(0, 4).map((x) => ({ text: str(x?.text, 400), right: !!x?.right })).filter((x) => x.text);
  return o.length >= 2 && o.some((x) => x.right) ? o : [];
}

// Clean up what an admin sends before it is stored.
export function cleanScenario(b) {
  const stops = (Array.isArray(b.stops) ? b.stops : []).slice(0, 2).map((x) => {
    const entrances = (Array.isArray(x.entrances) ? x.entrances : []).slice(0, 8)
      .map((e) => ({ name: str(e.name, 80), ...ll(e) })).filter((e) => e.name && e.lat != null);
    const ce = Number(x.correctEntrance);
    return {
      kind: x.kind === 'dropoff' ? 'dropoff' : 'pickup', label: str(x.label, 120), addressGiven: str(x.addressGiven, 200),
      answer: ll(x.answer), start: ll(x.start), entrances,
      correctEntrance: Number.isInteger(ce) && ce >= 0 && ce < entrances.length ? ce : null,
    };
  });
  if (!stops.length || stops.some((x) => !x.answer || !x.label)) throw new Error('Every stop needs a name and a right pin.');
  if (stops.filter((x) => x.kind === 'pickup').length > 1 || stops.filter((x) => x.kind === 'dropoff').length > 1) throw new Error('One pickup and one drop-off at most.');
  stops.sort((a, b) => (a.kind === 'pickup' ? 0 : 1) - (b.kind === 'pickup' ? 0 : 1)); // pickup first, like the form
  const lines = (Array.isArray(b.questions) ? b.questions : []).slice(0, 30)
    .map((q, i) => ({ q: str(q?.q, 160), say: str(q?.say, 400), a: str(q?.a, 300), needed: !!q?.needed,
      ...(isStandardKey(q?.std) ? { std: q.std } : {}), i })).filter((q) => q.q);
  const newIndex = new Map(lines.map((q, n) => [q.i, n]));
  return {
    caller: str(b.caller, 600), why: str(b.why, 1500),
    // Made with the New call screen: the call's own details for its standard lines, and what happened (cleaned, no
    // customer details). Kept only when there is something in them, so older calls stay exactly as they were.
    ...(b.vars ? { vars: { wearing: str(b.vars.wearing, 160), notesAnswer: str(b.vars.notesAnswer, 200), dropoffAnswer: str(b.vars.dropoffAnswer, 200) } } : {}),
    ...(str(b.story, 4000) ? { story: str(b.story, 4000) } : {}),
    ride: cleanRide(b.ride), mustOrder: b.mustOrder !== false,
    savedFix: [3, 4, 5].includes(Number(b.savedFix?.slot)) ? { slot: Number(b.savedFix.slot), action: b.savedFix.action === 'delete' ? 'delete' : 'update', stop: b.savedFix.stop === 'dropoff' ? 'dropoff' : 'pickup' } : null,
    account: { home: savedPlace(b.account?.home), saved: (Array.isArray(b.account?.saved) ? b.account.saved : []).map(savedPlace).filter(Boolean).slice(0, 3) },
    stops,
    questions: lines.map(({ i, ...q }) => q),
    steps: cleanSteps(b.steps, newIndex),
    note: { mustMention: (Array.isArray(b.note?.mustMention) ? b.note.mustMention : []).map((k) => str(k, 40)).filter(Boolean).slice(0, 8), model: str(b.note?.model, 600),
      options: cleanNoteOptions(b.note?.options) },
  };
}
