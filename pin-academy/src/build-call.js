// Builds a whole call from the short "New call" screen (Vee, 2026-10-07): the trainer gives only what is unique
// (the place and its right pin, the customer, what happened); the call flow, the steps and the wrong picks come from
// GoGo's standard lines, in the order Vee runs a call. Everything it makes can still be changed in the Advanced editor.
import { renderCall, standardLines } from './standard-lines.js';
import { cleanScenario } from './grading.js';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' ? v : Number(v));
const ll = (p) => (p && Number.isFinite(num(p.lat)) && Number.isFinite(num(p.lng)) ? { lat: num(p.lat), lng: num(p.lng) } : null);
const bad = (msg) => { const e = new Error(msg); e.status = 400; throw e; };

// The call flow: [the right line, two lines that sound right but are not next]. Vee's order.
function flowFor({ pickupHome, dropoffHome }) {
  const f = [['confirm_name', ['ask_pickup', 'send_driver']], ['contact', ['ask_pickup', 'send_driver']]];
  if (pickupHome) f.push(['confirm_home_pickup', ['ask_pickup', 'wearing']]);
  else f.push(['ask_pickup', ['spell_street', 'send_driver']], ['read_back_pickup', ['spell_street', 'send_driver']],
    ['place_pickup', ['spell_street', 'notes']], ['map', ['send_driver', 'estimate']]);
  f.push(['ask_where', ['estimate', 'send_driver']]);
  if (dropoffHome) f.push(['confirm_home_dropoff', ['wearing', 'estimate']]);
  else {
    f.push(['read_back_dropoff', ['spell_street', 'send_driver']], ['place_dropoff', ['spell_street', 'estimate']]);
    if (pickupHome) f.push(['map', ['send_driver', 'notes']]);
  }
  if (!pickupHome) f.push(['wearing', ['notes', 'estimate']]); // the driver has to spot them somewhere that is not home
  f.push(['notes', ['estimate', 'send_driver']], ['estimate', ['driver', 'anything_else']], ['driver', ['anything_else', 'close']],
    ['anything_else', ['close', 'send_driver']], ['close', ['send_driver', 'spell_street']]);
  return f;
}
const FILL = ['send_driver', 'spell_street', 'wearing', 'notes', 'estimate'];

function placeStop(kind, p) {
  if (!p) bad(`Fill in the ${kind === 'pickup' ? 'pickup' : 'drop-off'}.`);
  const answer = ll(p.answer);
  const label = str(p.label, 120), addressGiven = str(p.addressGiven, 200);
  if (!label || !addressGiven || !answer) bad(`The ${kind === 'pickup' ? 'pickup' : 'drop-off'} needs the place name, the address the caller gives, and the right pin.`);
  return { kind, label, addressGiven, start: ll(p.start) || answer, answer, entrances: [] };
}

export function buildCall(b) {
  const title = str(b.title, 120);
  if (!title) bad('Give the call a name.');
  const customerName = str(b.customerName, 80);
  if (customerName.split(/\s+/).length < 2) bad("Give the customer a made-up first and last name.");
  const pickupHome = b.pickup?.home === true, dropoffHome = b.dropoff?.home === true;
  if (pickupHome && dropoffHome) bad('The pickup and the drop-off cannot both be home.');
  const homeLL = ll(b.home);
  const home = homeLL ? { label: 'Home', address: str(b.home.address, 200), ...homeLL } : null;
  if ((pickupHome || dropoffHome) && (!home || !home.address)) bad('Search the home address on the account first.');
  const homeStop = (kind) => ({ kind, label: 'Home', addressGiven: home.address, start: { lat: home.lat, lng: home.lng }, answer: { lat: home.lat, lng: home.lng }, entrances: [] });
  const stops = [pickupHome ? homeStop('pickup') : placeStop('pickup', b.pickup?.place), dropoffHome ? homeStop('dropoff') : placeStop('dropoff', b.dropoff?.place)];
  const [pu, dof] = stops;

  const low = num(b.ride?.low), high = num(b.ride?.high);
  if (!(low > 0) || !(high >= low)) bad('Fill in the estimate (low and high).');
  const cost = `$${low} ~ $${high}`;
  const d = b.ride?.driver || {};
  const driver = { name: str(d.name, 40) || 'Lidong', car: str(d.car, 60) || 'Black Toyota Sienna', plate: str(d.plate, 12) || '0734', eta: str(d.eta, 30) || '5 minutes' };
  const ride = { customerName, rideType: 'UberX', eta: str(b.ride?.etaRange, 30) || '5-10 min(s)', trip: `A trip for ${cost}`, surge: '1',
    perMile: '', perMinute: '', baseFare: '', minFare: '', cost, driver };

  const wearing = str(b.wearing, 160), notesAnswer = str(b.notesAnswer, 200);
  const vars = { wearing, notesAnswer, dropoffAnswer: dropoffHome ? 'Home.' : `It's ${dof.addressGiven}.` };
  const where = pickupHome ? `from home to ${dof.label}` : dropoffHome ? `from ${pu.label} back home` : `from ${pu.label} to ${dof.label}`;
  const caller = str(b.caller, 600) || (pickupHome ? `Hi, I need a ride ${where}.` : `Hi, I'd like to be picked up at ${pu.addressGiven}.`);

  // The lines this call uses (every right line and every wrong pick), then the steps pointing at them.
  const flow = flowFor({ pickupHome, dropoffHome });
  const keys = [...new Set(flow.flatMap(([r, w]) => [r, ...w]).concat(FILL))];
  const idx = Object.fromEntries(keys.map((k, i) => [k, i]));
  const rightSoFar = new Set();
  const steps = flow.map(([r, w]) => {
    const wrong = [...w, ...FILL].filter((k, i, a) => a.indexOf(k) === i && k !== r && !rightSoFar.has(k)).slice(0, 2);
    rightSoFar.add(r);
    return { choices: [idx[r], ...wrong.map((k) => idx[k])], right: [idx[r]] };
  });
  const questions = keys.map((k) => ({ std: k, q: k, say: '', a: '', needed: true }));

  const place = !pickupHome ? pu : dof;
  const model = str(b.note?.model, 600) || (!pickupHome
    ? `Customer is waiting at ${pu.label}. Please call them if you can't find them.${wearing ? ` They are wearing ${wearing.replace(/\.$/, '').toLowerCase()}.` : ''}`
    : `Please drop the customer off at ${dof.label}, ${dof.addressGiven}.`);
  const mustMention = Array.isArray(b.note?.mustMention) && b.note.mustMention.length ? b.note.mustMention : [place.label.split(/[\s']/)[0]];

  const data = renderCall({
    caller, why: str(b.why, 1500), story: str(b.story, 4000), account: { home, saved: [] }, stops, ride, vars, questions, steps,
    note: { mustMention, model, options: [] },
  }, standardLines());
  return { title, category: str(b.category, 40), data: cleanScenario(data) };
}
