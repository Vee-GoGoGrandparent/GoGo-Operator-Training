// Grading for a scenario: the pin(s), the questions asked, and the note for the driver.
// Everything is decided here on the server, never in the browser.
import { metersBetween, validLatLng } from './scoring.js';

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

// s = scenario data, sub = what the trainee sent, passMeters = how close counts as right.
export function gradeScenario(s, sub, passMeters) {
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
  const asked = new Set((Array.isArray(sub?.asked) ? sub.asked : []).map(Number));
  const missingQuestions = s.questions.map((q, i) => ({ ...q, i })).filter((q) => q.needed && !asked.has(q.i)).map((q) => q.q);
  const note = checkNote(sub?.note, s.note?.mustMention || [], sub?.wearing);
  return {
    stops, missingQuestions, note, modelNote: s.note?.model || '', why: s.why || '',
    passed: stops.every((x) => x.passed) && missingQuestions.length === 0 && note.ok,
  };
}

// Where the map opens if a stop has no saved start: rounded to ~100 m so it never sits on the answer.
const nearby = (p) => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });

// What a trainee may see before answering: no right pins, no "needed" flags, no model note.
export function publicScenario(row) {
  const s = JSON.parse(row.data);
  return {
    id: row.id, title: row.title, category: row.category,
    caller: s.caller, account: s.account || { home: null, saved: [] },
    stops: s.stops.map((x) => ({ kind: x.kind, label: x.label, addressGiven: x.addressGiven, start: x.start || nearby(x.answer), entrances: x.entrances.map((e) => ({ name: e.name, lat: e.lat, lng: e.lng })) })),
    questions: s.questions.map((q) => ({ q: q.q, say: q.say || '', a: q.a })),
  };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ll = (p) => (p && validLatLng(Number(p.lat), Number(p.lng)) ? { lat: Number(p.lat), lng: Number(p.lng) } : null);
// A place saved on the pretend customer's account (home, or a saved location that may or may not be right).
const savedPlace = (p) => (p && ll(p) ? { label: str(p.label, 60) || 'Saved', address: str(p.address, 200), ...ll(p) } : null);

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
  return {
    caller: str(b.caller, 600), why: str(b.why, 1500),
    account: { home: savedPlace(b.account?.home), saved: (Array.isArray(b.account?.saved) ? b.account.saved : []).map(savedPlace).filter(Boolean).slice(0, 3) },
    stops,
    questions: (Array.isArray(b.questions) ? b.questions : []).slice(0, 16)
      .map((q) => ({ q: str(q.q, 160), say: str(q.say, 400), a: str(q.a, 300), needed: !!q.needed })).filter((q) => q.q),
    note: { mustMention: (Array.isArray(b.note?.mustMention) ? b.note.mustMention : []).map((k) => str(k, 40)).filter(Boolean).slice(0, 8), model: str(b.note?.model, 600) },
  };
}
