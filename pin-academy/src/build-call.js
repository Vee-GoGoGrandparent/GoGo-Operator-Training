// Builds a whole call from the short "New call" screen (Vee, 2026-10-07): the trainer gives only what is unique
// (the place and its right pin, the customer, what happened); the call flow, the steps and the wrong picks come from
// GoGo's standard lines, in the order Vee runs a call. Everything it makes can still be changed in the Advanced editor.
import { renderCall, standardLines } from './standard-lines.js';
import { cleanScenario } from './grading.js';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' ? v : Number(v));
const ll = (p) => (p && Number.isFinite(num(p.lat)) && Number.isFinite(num(p.lng)) ? { lat: num(p.lat), lng: num(p.lng) } : null);
const bad = (msg) => { const e = new Error(msg); e.status = 400; throw e; };

// The call flow, Vee's way (2026-10-08): lines that belong together are ONE step with TWO right answers and ONE
// wording ("so we are still guiding them to the right wording, not just the right answer"). Each step:
// { right: [lines], wrong: [lines that sound right but are not next], say: [lines whose words make the shared wording],
//   a: [lines whose caller answers make the shared answer] }. Pairs copied from her Menchie's and Torikaya (10/08).
// fix = where a wrong pin is SAVED on the account: 'home' (a new caller's home, saved at registration) or 'place'
// (a saved location with the wrong pin; often = they go there often, so save the fix, else remove it).
const one = (k, wrong) => ({ right: [k], wrong });
const pair = (k1, k2, wrong, say = [k1, k2], a = [k1, k2]) => ({ right: [k1, k2], wrong, say, a });
function flowFor({ pickupHome, dropoffHome, fix, fixStop, often }) {
  const f = [one('confirm_name', ['ask_pickup', 'send_driver']), one('contact', ['ask_pickup', 'send_driver'])];
  const placeFix = (kind) => fix === 'place' && fixStop === kind;
  const homeFix = (kind) => fix === 'home' && fixStop === kind;
  let askedWhere = false;
  if (pickupHome) {
    f.push(pair('confirm_home_pickup', 'ask_pickup', ['wearing'], ['confirm_home_pickup'], ['confirm_home_pickup']));
    if (homeFix('pickup')) f.push(one('map', ['send_driver', 'estimate']), one('save_home', ['send_driver', 'estimate']));
  } else if (placeFix('pickup')) {
    f.push(pair('ask_pickup', 'mention_saved', ['spell_street']), one('read_back_pickup', ['spell_street', 'send_driver']),
      pair('place_pickup', 'map', ['send_driver'], ['place_pickup', 'map'], ['place_pickup']), one('go_often', ['notes', 'estimate']));
    if (often) { f.push(pair('save_place', 'ask_where', ['send_driver'], ['save_place', 'ask_where'], ['ask_where'])); askedWhere = true; }
    else f.push(one('delete_place', ['send_driver', 'save_place']));
  } else {
    f.push(one('ask_pickup', ['spell_street', 'send_driver']), pair('read_back_pickup', 'place_pickup', ['spell_street']), one('map', ['send_driver', 'estimate']));
  }
  if (!askedWhere) f.push(one('ask_where', ['estimate', 'send_driver']));
  if (dropoffHome) {
    f.push(one('confirm_home_dropoff', ['wearing', 'estimate']));
    if (homeFix('dropoff')) f.push(one('map', ['send_driver', 'estimate']), one('save_home', ['send_driver', 'estimate']));
  } else {
    f.push(pair('read_back_dropoff', 'place_dropoff', ['spell_street']));
    if (placeFix('dropoff')) f.push(one('mention_saved', ['send_driver', 'estimate']));
    if (pickupHome && !homeFix('pickup')) f.push(one('map', ['send_driver', 'notes']));
    if (placeFix('dropoff')) f.push(one('go_often', ['notes', 'estimate']), one(often ? 'save_place' : 'delete_place', ['send_driver', often ? 'delete_place' : 'save_place']));
  }
  // The driver has to spot them somewhere that is not home: notes and clothing together.
  f.push(pickupHome ? one('notes', ['estimate', 'send_driver']) : pair('notes', 'wearing', ['estimate']));
  f.push(one('estimate', ['driver', 'anything_else']), pair('driver', 'anything_else', ['close'], ['driver', 'anything_else'], ['anything_else']),
    one('close', ['send_driver', 'spell_street']));
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
  // A new caller's home was saved at registration; its pin may be wrong (Vee). Then the account holds the WRONG pin,
  // the map opens there, and the right answer is the home's real spot. The trainee must fix it and save it over Home.
  const homeWrong = ll(pickupHome ? b.pickup?.wrong : dropoffHome ? b.dropoff?.wrong : null);
  const homeStop = (kind) => ({ kind, label: 'Home', addressGiven: home.address, start: homeWrong || { lat: home.lat, lng: home.lng }, answer: { lat: home.lat, lng: home.lng }, entrances: [] });
  const stops = [pickupHome ? homeStop('pickup') : placeStop('pickup', b.pickup?.place), dropoffHome ? homeStop('dropoff') : placeStop('dropoff', b.dropoff?.place)];
  const [pu, dof] = stops;
  // A place saved on the account with the wrong pin (the pin where the address alone puts it, or the trainer's wrong pin).
  const savedStop = !pickupHome && b.pickup?.place?.saved ? 'pickup' : !dropoffHome && b.dropoff?.place?.saved ? 'dropoff' : null;
  const often = savedStop ? b[savedStop].place.often !== false : false;
  const fix = homeWrong ? 'home' : savedStop ? 'place' : null;
  const fixStop = homeWrong ? (pickupHome ? 'pickup' : 'dropoff') : savedStop;
  const account = { home: home ? { ...home, ...(homeWrong || {}) } : null, saved: [] };
  let savedFix = null;
  if (fix === 'home') savedFix = { slot: 'home', action: 'update', stop: fixStop };
  if (fix === 'place') {
    const st = stops.find((x) => x.kind === savedStop);
    account.saved.push({ label: st.label, address: st.addressGiven, lat: st.start.lat, lng: st.start.lng });
    savedFix = { slot: 3, action: often ? 'update' : 'delete', stop: savedStop };
  }

  const low = num(b.ride?.low), high = num(b.ride?.high);
  if (!(low > 0) || !(high >= low)) bad('Fill in the estimate (low and high).');
  const cost = `$${low} ~ $${high}`;
  const d = b.ride?.driver || {};
  const driver = { name: str(d.name, 40) || 'Lidong', car: str(d.car, 60) || 'Black Toyota Sienna', plate: str(d.plate, 12) || '0734', eta: str(d.eta, 30) || '5 minutes' };
  const ride = { customerName, rideType: 'UberX', eta: str(b.ride?.etaRange, 30) || '5-10 min(s)', trip: `A trip for ${cost}`, surge: '1',
    perMile: '', perMinute: '', baseFare: '', minFare: '', cost, driver };

  const wearing = str(b.wearing, 160), notesAnswer = str(b.notesAnswer, 200);
  const vars = { wearing, notesAnswer, dropoffAnswer: dropoffHome ? 'Home.' : `It's ${dof.addressGiven}.`,
    savedPlace: savedStop ? stops.find((x) => x.kind === savedStop).label : '', oftenAnswer: often ? 'Yes, I go there every week.' : 'No, not really. Just this once.' };
  const where = pickupHome ? `from home to ${dof.label}` : dropoffHome ? `from ${pu.label} back home` : `from ${pu.label} to ${dof.label}`;
  const caller = str(b.caller, 600) || (pickupHome ? `Hi, I need a ride ${where}.` : `Hi, I'd like to be picked up at ${pu.addressGiven}.`);

  // The lines this call uses (every right line and every wrong pick), then the steps pointing at them.
  const flow = flowFor({ pickupHome, dropoffHome, fix, fixStop, often });
  const keys = [...new Set(flow.flatMap((st) => [...st.right, ...st.wrong]).concat(FILL))];
  const idx = Object.fromEntries(keys.map((k, i) => [k, i]));
  const rightSoFar = new Set();
  const steps = flow.map((st) => {
    // One right line: two wrong picks. A pair: one wrong pick (three choices in all).
    const wrong = [...st.wrong, ...FILL].filter((k, i, a) => a.indexOf(k) === i && !st.right.includes(k) && !rightSoFar.has(k)).slice(0, 3 - st.right.length);
    st.right.forEach((k) => rightSoFar.add(k));
    return { choices: [...st.right.map((k) => idx[k]), ...wrong.map((k) => idx[k])], right: st.right.map((k) => idx[k]) };
  });
  const questions = keys.map((k) => ({ std: k, q: k, say: '', a: '', needed: true }));

  const place = !pickupHome ? pu : dof;
  const model = str(b.note?.model, 600) || (!pickupHome
    ? `Customer is waiting at ${pu.label}. Please call them if you can't find them.${wearing ? ` They are wearing ${wearing.replace(/\.$/, '').toLowerCase()}.` : ''}`
    : `Please drop the customer off at ${dof.label}, ${dof.addressGiven}.`);
  const mustMention = Array.isArray(b.note?.mustMention) && b.note.mustMention.length ? b.note.mustMention : [place.label.split(/[\s']/)[0]];

  const data = renderCall({
    caller, why: str(b.why, 1500), story: str(b.story, 4000), account, savedFix, newCaller: fix === 'home', stops, ride, vars, questions, steps,
    note: { mustMention, model, options: [] },
  }, standardLines());
  // A pair's shared wording: its lines' words said together, in order; the caller's answer likewise.
  const join = (ks, field) => [...new Set(ks.map((k) => data.questions[idx[k]][field].trim()).filter(Boolean))].join(' ');
  flow.forEach((st, n) => { if (st.say) { data.steps[n].say = join(st.say, 'say'); data.steps[n].a = join(st.a, 'a'); } });
  return { title, category: str(b.category, 40), data: cleanScenario(data) };
}
