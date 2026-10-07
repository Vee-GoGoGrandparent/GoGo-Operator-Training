// Takes customer details out of a pasted call transcript, in the trainer's own browser, before anything is saved or
// sent anywhere (Vee, 2026-10-07). Must go: phone numbers, emails, dates of birth, card numbers, street addresses.
// Names: best effort (the trainer reviews the result and can blank anything missed). Plain patterns, no AI.
// Returns { text, parts }: parts = [{ text }] for kept text and [{ text: '[PHONE]', was: '…', kind }] for removed bits.

const NUM_WORD = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)';
const STREET = '(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|parkway|pkwy|highway|hwy|circle|cir|terrace|ter|trail|trl|loop|pike|square|sq|crescent|alley|row)';
const DIR = '(?:north|south|east|west|northeast|northwest|southeast|southwest|n|s|e|w|ne|nw|se|sw)';
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// Words after "my name is" / "this is" that are not a name.
const NOT_NAME = new Set(['a', 'an', 'the', 'and', 'from', 'with', 'calling', 'here', 'um', 'uh', 'just', 'so', 'i', 'im', "i'm", 'me', 'my', 'is',
  'gogo', 'go', 'yes', 'yeah', 'no', 'ok', 'okay', 'hi', 'hello', 'your', 'you', 'for', 'about', 'regarding', 'actually', 'still', 'it', 'that', 'this',
  'how', 'what', 'why', 'when', 'where', 'can', 'could', 'need', 'want', 'trying', 'going', 'not', 'sure', 'great', 'fine', 'good', 'right', 'correct',
  'speaking', 'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', "ma'am", 'maam', 'customer', 'operator', 'driver', 'her', 'his', 'their', 'our', 'we', 'they']);

const RULES = [
  ['EMAIL', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi],
  ['EMAIL', /\b[\w.+-]+\s+at\s+[\w-]+\s+dot\s+(?:com|net|org|edu|gov|us)\b/gi],
  ['CARD', /\b(?:\d[ -]?){13,19}\b/g],
  ['PHONE', /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g],
  ['PHONE', /\b(?:\d[\s-]){6,}\d\b/g], // digits read one by one: "5 5 5 1 2 3 4"
  ['PHONE', new RegExp(`\\b${NUM_WORD}(?:[\\s,-]+${NUM_WORD}){6,}\\b`, 'gi')], // "eight five five four six four ..."
  ['DATE', /\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)?\d{2}\b/g],
  ['DATE', new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:of\\s+)?(?:19|20)\\d{2}\\b`, 'gi')],
  ['DATE', new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?,?\\s+(?:19|20)\\d{2}\\b`, 'gi')],
  ['ADDRESS', new RegExp(`\\b\\d{1,6}\\s+(?:${DIR}\\.?\\s+)?(?:[a-z0-9][\\w'.-]*\\s+){0,4}?${STREET}\\b\\.?(?:\\s*,?\\s*(?:apt|apartment|unit|suite|ste|#)\\.?\\s*[\\w-]+)?`, 'gi')],
  ['ADDRESS', /\b(?:apt|apartment|unit|suite)\.?\s*#?\s*\d+[a-z]?\b/gi],
  ['ZIP', /\b\d{5}(?:-\d{4})?\b/g],
];

// Names: the 1-2 words right after a lead-in. Strong lead-ins ("my name is", "speaking with", "Mr."/"Mrs.") take any
// word that is not a common word. Weak ones ("this is", "my wife is") only take a capitalised word, so "this is
// fine" and "my wife uses a walker" stay. Every other place the found name appears is removed too.
const STRONG = /\b(my name is|my name's|name is|am i speaking with|speaking with|mr\.?|mrs\.?|ms\.?|miss|dr\.?)\s+([a-z][a-z'-]+)(?:\s+([a-z][a-z'-]+))?/gi;
const WEAK = /\b(this is|my (?:wife|husband|daughter|son|mother|mom|father|dad|sister|brother|friend|grandson|granddaughter|caregiver)(?:'s name is| is| named))\s+([A-Za-z][a-z'-]+)(?:\s+([A-Za-z][a-z'-]+))?/g;

function findNames(text) {
  const names = new Set();
  const take = (words, needCap) => {
    for (const w of words) {
      if (!w || w.length < 2 || NOT_NAME.has(w.toLowerCase()) || (needCap && !/^[A-Z]/.test(w))) break;
      names.add(w);
    }
  };
  for (const m of text.matchAll(STRONG)) take([m[2], m[3]], false);
  for (const m of text.matchAll(WEAK)) take([m[2], m[3]], true);
  return [...names];
}

export function cleanTranscript(input, extraNames = []) {
  let text = String(input || '');
  const removed = []; // [start, end, kind]
  const mark = (re, kind) => { for (const m of text.matchAll(re)) removed.push([m.index, m.index + m[0].length, kind]); };
  for (const [kind, re] of RULES) mark(re, kind);
  const names = [...findNames(text), ...extraNames.filter(Boolean)];
  for (const n of names) mark(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), 'NAME');
  // Keep the first match where removals overlap, in text order.
  removed.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const parts = [];
  let at = 0;
  for (const [s, e, kind] of removed) {
    if (s < at) continue;
    if (s > at) parts.push({ text: text.slice(at, s) });
    parts.push({ text: `[${kind}]`, was: text.slice(s, e), kind });
    at = e;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return { text: parts.map((p) => p.text).join(''), parts, names };
}
