// "Draft the call with Claude" (Vee, 2026-10-07; model Claude Opus 5.5, her pick). Claude reads what happened (already
// cleaned of customer details in the trainer's browser) and the call built from the standard lines, and writes only
// what is special: the caller's first line, moments like an anniversary, the Why, the good driver note and its choices.
// It never sets a pin. Its answer is checked before anyone sees it, and nothing is saved until the trainer saves.
import Anthropic from '@anthropic-ai/sdk';
import { cleanTranscript } from '../public/clean.js';
import { cleanScenario } from './grading.js';

const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4, output: 20 }; // $ per million tokens, Claude Opus 5.5 (Anthropic price list, 2026-09-25)
export const draftReady = () => !!process.env.ANTHROPIC_API_KEY;

const SYSTEM = `You help GoGo Grandparent trainers turn a real call problem into a practice call for new call-center operators.
GoGo Grandparent books rides for older adults by phone. Operators type the pickup and drop-off into a dashboard and must put the
map pin exactly where the driver should stop.

You are given: the pin skill being taught, what happened on the real call (customer details already removed), and a practice call
already built from GoGo's standard lines (in order). Write ONLY what is special about this call:
- caller: the caller's first line. Natural, short, like a real older caller. If they name a place, use the place name given.
- extraLines: moments the standard lines miss, e.g. the caller mentions an anniversary or birthday (the operator must
  congratulate them right then), a walker or wheelchair, a hard-to-find entrance. Each extra line has a short button label, what
  the operator says, the caller's answer, the button of the step it comes right AFTER, and two buttons of existing lines that sound
  right but are not next. At most 4. Leave empty when nothing special happened.
- answerChanges: when a special moment comes up inside an existing line's answer (e.g. the caller mentions the anniversary when
  the operator asks the name of the place), give that line's button and the new answer.
- why: 2-5 plain sentences trainees read after they answer: what went wrong on the real call and exactly how to get it right.
- noteModel: a good note for the driver (drivers work for the ride company, not GoGo): full sentences, where the customer is, how
  to find them, anything the driver needs (walker, wheelchair). No emojis.
- noteOptions: three notes: the good one (right: true) and two that sound fine but miss something real (no place name, no walker,
  emoji fragments). mustMention: 1-3 single words the typed note must contain.

Rules: never use a real person's name (the customer's made-up name is given). Never write a phone number, email, date of birth or
card number (GoGo's own number 855-464-6872 is fine). Never name Uber or Lyft; say "the driver". GoGo never calls customers back:
never offer a callback; the customer can call GoGo. Warm and respectful, never talk down to the caller. Plain words.`;

const S = { type: 'string' };
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['caller', 'why', 'noteModel', 'noteOptions', 'mustMention', 'extraLines', 'answerChanges'],
  properties: {
    caller: S, why: S, noteModel: S,
    noteOptions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'right'], properties: { text: S, right: { type: 'boolean' } } } },
    mustMention: { type: 'array', items: S },
    extraLines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['button', 'say', 'answer', 'afterButton', 'wrongButtons'],
      properties: { button: S, say: S, answer: S, afterButton: S, wrongButtons: { type: 'array', items: S } } } },
    answerChanges: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['button', 'answer'], properties: { button: S, answer: S } } },
  },
};

// What Claude writes must not carry customer details, ride-company names, or a callback offer.
export function draftProblems(texts) {
  const problems = [];
  for (const t of texts) {
    const found = cleanTranscript(String(t || '').replace(/\b(?:1[\s.-]?)?\(?855\)?[\s.-]?464[\s.-]?6872\b/g, ''))
      .parts.filter((p) => ['PHONE', 'EMAIL', 'CARD', 'DATE'].includes(p.kind));
    if (found.length) problems.push(`It wrote a ${found[0].kind.toLowerCase()}.`);
    if (/\b(uber|lyft)\b/i.test(t)) problems.push('It named a ride company.');
    if (/\bwe(?:'ll| will| can)? (?:call you back|give you a call)\b/i.test(t)) problems.push('It offered a callback (GoGo does not call customers back).');
  }
  return [...new Set(problems)];
}

// Put Claude's answer into the call. Pure: easy to test without calling Claude.
export function applyDraft(data, out) {
  const d = structuredClone(data);
  const texts = [out.caller, out.why, out.noteModel, ...(out.noteOptions || []).map((o) => o.text),
    ...(out.extraLines || []).flatMap((x) => [x.button, x.say, x.answer]), ...(out.answerChanges || []).map((x) => x.answer)];
  const problems = draftProblems(texts);
  if (problems.length) { const e = new Error(`The draft was refused: ${problems.join(' ')} Try again.`); e.status = 422; throw e; }
  const at = (button) => d.questions.findIndex((q) => q.q.trim().toLowerCase() === String(button || '').trim().toLowerCase());
  if (out.caller?.trim()) d.caller = out.caller.trim();
  if (out.why?.trim()) d.why = out.why.trim();
  for (const c of out.answerChanges || []) { const i = at(c.button); if (i >= 0 && c.answer?.trim()) { d.questions[i].a = c.answer.trim(); delete d.questions[i].std; } }
  for (const x of (out.extraLines || []).slice(0, 4)) {
    if (!x.button?.trim() || !x.say?.trim() || !x.answer?.trim() || at(x.button) >= 0) continue;
    const after = d.steps.findIndex((st) => st.right.includes(at(x.afterButton)));
    if (after < 0) continue;
    d.questions.push({ q: x.button.trim(), say: x.say.trim(), a: x.answer.trim(), needed: true });
    const line = d.questions.length - 1;
    const earlier = new Set(d.steps.slice(0, after + 1).flatMap((st) => st.right));
    const wrong = [...(x.wrongButtons || []).map(at), ...d.steps.slice(after + 1).flatMap((st) => st.right)]
      .filter((i, k, a) => i >= 0 && i !== line && !earlier.has(i) && a.indexOf(i) === k).slice(0, 2);
    d.steps.splice(after + 1, 0, { choices: [line, ...wrong], right: [line] });
  }
  d.note = { ...(d.note || {}), model: out.noteModel?.trim() || d.note?.model || '',
    mustMention: (out.mustMention || []).map((w) => String(w).trim()).filter((w) => w && !/\s/.test(w)).slice(0, 3),
    options: (out.noteOptions || []).filter((o) => o.text?.trim()).slice(0, 4) };
  if (!d.note.mustMention.length) d.note.mustMention = data.note?.mustMention || [];
  return cleanScenario(d);
}

// Ask Claude. The call it gets has no pins and no customer details: only labels, lines and the cleaned story.
export async function draftCall({ data, title, category, story }) {
  if (!draftReady()) { const e = new Error('The Anthropic key is not set in Railway yet.'); e.status = 503; throw e; }
  const call = {
    pinSkill: category, title, whatHappened: story || data.story || '', customer: data.ride?.customerName || '',
    stops: data.stops.map((x) => ({ kind: x.kind, place: x.label, addressTheCallerGives: x.addressGiven })),
    callerFirstLine: data.caller,
    steps: data.steps.map((st, n) => ({ step: n + 1, button: data.questions[st.right[0]]?.q, operatorSays: data.questions[st.right[0]]?.say, callerAnswers: data.questions[st.right[0]]?.a })),
    allButtons: data.questions.map((q) => q.q),
  };
  const client = new Anthropic();
  const request = { model: MODEL, max_tokens: 16000, system: SYSTEM, output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Here is the practice call to finish, as JSON:\n${JSON.stringify(call)}` }] };
  let res;
  // Errors from Anthropic are turned into a plain message (a 401 from them must not look like "you are signed out").
  const plain = (err) => { const e = new Error(err instanceof Anthropic.AuthenticationError ? 'The Anthropic key in Railway was not accepted. Check ANTHROPIC_API_KEY.'
    : err instanceof Anthropic.RateLimitError ? 'Claude is busy right now. Try again in a minute.' : `Claude could not draft it (${err.status || 'no answer'}). Try again.`); e.status = 502; return e; };
  try {
    // Server-side fallback: if a safety check declines, the API retries on another model in the same call.
    res = await client.beta.messages.create({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw plain(err);
    try { res = await client.messages.create(request); } catch (err2) { throw plain(err2); } // the fallback option was refused: plain request
  }
  if (res.stop_reason === 'refusal') { const e = new Error('Claude declined to draft this call. Try describing it differently.'); e.status = 422; throw e; }
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { const e = new Error('The draft came back incomplete. Try again.'); e.status = 502; throw e; }
  const u = res.usage || {};
  const cents = ((u.input_tokens || 0) * PRICE.input + (u.output_tokens || 0) * PRICE.output) / 1e6 * 100;
  console.log(`[draft] ${title}: ${u.input_tokens} in, ${u.output_tokens} out, ~${cents.toFixed(1)} cents, model ${res.model}`);
  return { data: applyDraft(data, out), cost: { inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0, cents: Math.round(cents * 10) / 10 } };
}
