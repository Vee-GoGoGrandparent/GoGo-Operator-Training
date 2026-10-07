// GoGo's standard call lines (Vee, 2026-10-07): the lines every call has, written ONCE. Calls made with the
// "New call" screen point at them by key (question.std), so changing the wording here, or on the Standard lines
// page, changes every one of those calls. {placeholders} are filled from each call (see callVars).
// A line an admin rewords inside one call stops pointing here and becomes that call's own line.
import { db, all, run } from './db.js';

export const STANDARD_LINES = [
  { key: 'confirm_name', q: "Confirm the customer's name", say: 'Perfect, I was able to pull up your account. Am I speaking with {customer}?', a: 'Yes, this is {first}.' },
  { key: 'contact', q: 'Confirm the best contact number', say: 'And is this still the best contact number for you, {phone}?', a: "Yes, that's the best number." },
  { key: 'confirm_home_pickup', q: 'Confirm the pickup is home', say: 'Will we be picking you up from your home at {home}?', a: 'Yes, from home.' },
  { key: 'ask_pickup', q: 'Ask them to repeat the address', say: 'Can you repeat the address for me?', a: '{pickupGiven}' },
  { key: 'read_back_pickup', q: 'Read the address back', say: "Okay, that's {pickupGiven}. Is that correct?", a: "Yes, that's right." },
  { key: 'place_pickup', q: 'Ask for the name of the place', say: 'Perfect, I was able to add the address to our system. Can you tell me the name of the place you are at?', a: "It's {pickupPlace}." },
  { key: 'ask_where', q: 'Ask where they are going', say: 'And where will we be taking you today?', a: '{dropoffAnswer}' },
  { key: 'confirm_home_dropoff', q: 'Confirm the home address', say: 'Will we be taking you home to {home}?', a: "Yes, that's right." },
  { key: 'read_back_dropoff', q: 'Read the drop-off address back', say: "Okay, that's {dropoffGiven}. Is that correct?", a: "Yes, that's right." },
  { key: 'place_dropoff', q: 'Ask for the name of the place they are going', say: 'Perfect, I was able to add the address to our system. Can you tell me again the name of the place you are heading to?', a: "It's {dropoffPlace}." },
  { key: 'map', q: 'Tell them you are checking the map', say: 'Give me just a moment while I look at the map. I want to make sure the driver goes to the right spot.', a: 'Sure, take your time.' },
  { key: 'wearing', q: 'Ask what they are wearing', say: "Would you mind telling me what you're wearing, so the driver can spot you easier?", a: '{wearing}' },
  { key: 'notes', q: 'Ask for notes for the driver', say: 'Do you have any notes for the driver?', a: '{notesAnswer}' },
  { key: 'estimate', q: 'Provide estimate', say: 'Okay, looks like this trip is going to cost you between {cost}. Is it ok if I go ahead and order this ride for you now?', a: 'Yes, please, go ahead and order it.' },
  { key: 'driver', q: 'Provide driver info', say: "We were able to find you a driver. Looks like {driver}, in a {car}, license plate {plate}, should be arriving in about {eta}. If you don't see the driver within that time, please give us a call back immediately so we can look into the status of your ride.", a: 'Perfect, thank you.' },
  { key: 'anything_else', q: 'Ask if there is anything else', say: 'Is there anything else I can help you with today?', a: "No, that's all. Thank you!" },
  { key: 'close', q: 'Close the call', say: 'Perfect! Thank you so much for calling GoGo, and we hope you have a beautiful and wonderful day.', a: 'You too, bye!' },
  // Lines that sound right but are not what comes next (the wrong picks).
  { key: 'send_driver', q: 'Send the driver to the address', say: "Okay, I'll send the driver to that address.", a: 'Okay, thank you.' },
  { key: 'spell_street', q: 'Ask them to spell the street', say: 'Can you spell the street name for me?', a: 'Sure, let me spell it for you.' },
];
const KEYS = new Set(STANDARD_LINES.map((l) => l.key));
export const isStandardKey = (k) => KEYS.has(k);

// What each placeholder means, for the Standard lines page.
export const PLACEHOLDERS = {
  customer: "the customer's made-up full name", first: 'their first name', phone: "GoGo's toll-free number (stands in for theirs)",
  home: 'the home address on the account', pickupGiven: 'the pickup address the caller gives', pickupPlace: 'the pickup place name',
  dropoffGiven: 'the drop-off address the caller gives', dropoffPlace: 'the drop-off place name', dropoffAnswer: 'where they say they are going',
  wearing: 'what they say they are wearing', notesAnswer: 'their answer about driver notes', cost: 'the estimate, e.g. $8-$10',
  driver: "the driver's name", car: 'the car', plate: 'the license plate', eta: 'how soon the driver arrives',
};

db.exec(`CREATE TABLE IF NOT EXISTS standard_lines (key TEXT PRIMARY KEY, q TEXT NOT NULL, say TEXT NOT NULL, a TEXT NOT NULL,
  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);

// The current wording: the defaults above, with any admin changes on top.
export function standardLines() {
  const saved = Object.fromEntries(all('SELECT key, q, say, a FROM standard_lines').map((r) => [r.key, r]));
  return STANDARD_LINES.map((l) => (saved[l.key] ? { ...l, q: saved[l.key].q, say: saved[l.key].say, a: saved[l.key].a } : { ...l }));
}
export function saveStandardLine(key, { q, say, a }, by) {
  if (!KEYS.has(key)) throw new Error('Unknown standard line.');
  run(`INSERT INTO standard_lines (key, q, say, a, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET q = excluded.q, say = excluded.say, a = excluded.a, updated_by = excluded.updated_by, updated_at = datetime('now')`, key, q, say, a, by);
}

const spoken = (addr = '') => addr.replace(/\bSE\b/g, 'Southeast').replace(/\bSW\b/g, 'Southwest').replace(/\bNE\b/g, 'Northeast').replace(/\bNW\b/g, 'Northwest');
// "$23 ~ $25" -> "$23-$25"
const costWords = (c = '') => c.replace(/\s*~\s*/g, '-');

// The values a call fills its standard lines with.
export function callVars(s) {
  const ride = s.ride || {}, dr = ride.driver || {}, v = s.vars || {};
  const pickup = s.stops?.find((x) => x.kind === 'pickup'), dropoff = s.stops?.find((x) => x.kind === 'dropoff');
  const customer = ride.customerName || 'the customer';
  return {
    customer, first: customer.split(' ')[0], phone: '855-464-6872',
    home: spoken(s.account?.home?.address || ''),
    pickupGiven: spoken(pickup?.addressGiven || ''), pickupPlace: pickup?.label || '',
    dropoffGiven: spoken(dropoff?.addressGiven || ''), dropoffPlace: dropoff?.label || '',
    dropoffAnswer: v.dropoffAnswer || (dropoff?.label === 'Home' ? 'Home.' : `It's ${dropoff?.label || 'the address'}.`),
    wearing: v.wearing || 'A blue top and black pants.', notesAnswer: v.notesAnswer || "No, that's all.",
    cost: costWords(ride.cost || ''), driver: dr.name || '', car: dr.car ? dr.car.charAt(0).toLowerCase() + dr.car.slice(1) : '',
    plate: dr.plate || '', eta: dr.eta || '',
  };
}
const fill = (t, vars) => t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// Fill in every line that points at a standard line. Lines a call wrote itself stay as they are.
export function renderCall(s, lines = standardLines()) {
  if (!s.questions?.some((q) => q.std)) return s;
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
  const vars = callVars(s);
  return { ...s, questions: s.questions.map((q) => (q.std && byKey[q.std]
    ? { ...q, q: byKey[q.std].q, say: fill(byKey[q.std].say, vars), a: fill(byKey[q.std].a, vars) } : q)) };
}
