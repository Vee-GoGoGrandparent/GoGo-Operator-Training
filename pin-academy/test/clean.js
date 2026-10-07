// The transcript cleaner: every customer detail Vee listed must come out; ordinary call words must stay.
// All "customer" details below are made up.
import assert from 'node:assert/strict';
import { cleanTranscript } from '../public/clean.js';

let passed = 0;
const check = (name) => { passed++; console.log(`  ✓ ${name}`); };
const gone = (input, secret, extra) => { const r = cleanTranscript(input, extra); assert.ok(!r.text.toLowerCase().includes(secret.toLowerCase()), `NOT removed: "${secret}" in -> ${r.text}`); return r; };
const kept = (input, words) => { const r = cleanTranscript(input); for (const w of words) assert.ok(r.text.includes(w), `wrongly removed "${w}" -> ${r.text}`); return r; };

try {
  // Phone numbers, every way they show up in a transcript.
  for (const [line, secret] of [
    ['My number is 555-201-3344.', '201-3344'], ['Call me at (555) 201 3344 please', '201 3344'], ['It is 5552013344.', '5552013344'],
    ['+1 555.201.3344 is my cell', '201.3344'], ['the number is 5 5 5 2 0 1 3 3 4 4', '2 0 1 3'],
    ['it is five five five two oh one three three four four', 'two oh one three'],
  ]) gone(line, secret);
  check('phone numbers removed: dashes, brackets, dots, run together, digit by digit, spoken as words');

  gone('My email is jane.doe+gogo@example.com thanks', 'jane.doe');
  gone("it's jane doe at gmail dot com", 'gmail dot com');
  check('emails removed, written and spoken');

  for (const [line, secret] of [['My date of birth is 03/14/1948', '03/14/1948'], ['born 3-14-48', '3-14-48'], ['March 14th, 1948', '1948'], ['the 14th of March 1948', '1948']]) gone(line, secret);
  check('dates of birth removed: numbers and words');

  gone('card 4111 1111 1111 1111 exp', '4111 1111');
  check('card numbers removed');

  for (const [line, secret] of [
    ["I'm at 14060 Southeast Petrovitsky Road", 'Petrovitsky'], ['pick me up at 7301 E Brainerd Rd.', 'Brainerd'],
    ['it is 22 Oak Street apartment 4B', 'Oak Street'], ['apartment 4B', '4B'], ['go to 1120 Houston Street, Chattanooga 37402', '37402'],
    ['the house at 5 N Main St', 'Main St'],
  ]) gone(line, secret);
  check('street addresses, apartment numbers and zip codes removed');

  const n = gone('Hi, my name is Dorothy Gale. Yes, this is Dorothy. Dorothy needs a ride.', 'Dorothy');
  assert.ok(!n.text.includes('Gale'), n.text);
  gone('Am I speaking with Walter Whitaker?', 'Whitaker');
  gone('my wife is Diane and Diane uses a walker', 'Diane');
  gone('this is mrs. henderson calling', 'henderson');
  gone('then Pemberton said hi', 'Pemberton', ['Pemberton']); // a name the trainer adds by hand
  check('names removed after "my name is", "this is", "speaking with", "Mrs.", "my wife is", everywhere they appear');

  // Things a call needs that must survive.
  kept("It's Torikaya. We're going there for our anniversary tonight! My wife uses a walker.", ['Torikaya', 'anniversary', 'walker', 'My wife uses']);
  kept('The trip is $23 to $25 and the driver will be there in 10 minutes, plate AWYY, last 4 digits 0734.', ['$23', '$25', '10 minutes', 'AWYY', '0734']);
  kept("Yes, this is fine. This is the right place. I'm at Menchie's. Oh this is really nice, this is wonderful news.", ['this is fine', 'This is the right place', "Menchie's", 'this is really nice', 'this is wonderful news']);
  kept('Step 3: read the address back. Ride at 3:30 pm on the 5th.', ['Step 3', '3:30 pm', 'the 5th']);
  check('kept: place names, the anniversary, the walker, prices, times, plates, "this is fine"');

  const r = cleanTranscript('Hi my name is Dorothy Gale, 555-201-3344');
  assert.ok(r.parts.some((p) => p.kind === 'NAME' && p.was === 'Dorothy') && r.parts.some((p) => p.kind === 'PHONE'));
  check('each removal is marked (kind + what it was), so the trainer can see exactly what came out');
  console.log(`\nAll ${passed} cleaner checks passed.`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
}
