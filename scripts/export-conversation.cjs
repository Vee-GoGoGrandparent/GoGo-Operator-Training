'use strict';

/**
 * export-conversation.cjs
 *
 * Backs up a Claude Code session transcript (jsonl) to `entire conversation.md` in the
 * project root. Copied from GoGo-Social Engagement Responder's export-conversation.js
 * (UUID dedup + tool-output cap), as .cjs because this project is an ES module.
 *
 * Usage (always pass --session: the sessions folder is shared by every project, so
 * "the newest file" can be another project's chat):
 *   node scripts/export-conversation.cjs --append --session <id>
 *
 *   --append     Add only messages not exported before (UUID-deduped via
 *                scripts/.export-state.json). Creates the file on the first run.
 *   --session    Session ID (the jsonl file name without .jsonl).
 *
 * NO CUSTOMER DETAILS (Vee, 2026-09-11). Reading #op_report puts customer names, phone
 * numbers and called-from numbers into the chat. The backup keeps everything else word
 * for word and removes those, with the same phone rule the op-report archive uses. The
 * scrubber tests itself before writing anything and the run stops if the test fails.
 * The backup is in .gitignore: it stays on this computer.
 *
 * Vee's rule: when she says "Done for the day", run this with --append. Never overwrite.
 */

const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = 'C:\\Users\\K_jah\\.claude\\projects\\C--Users-K-jah-Documents-AI';
const DEST = path.join(__dirname, '..', 'entire conversation.md');
const STATE_FILE = path.join(__dirname, '.export-state.json');
const TITLE = 'GoGo Operator Training Tracker — Full Conversation Transcript';

// Cap for tool-call inputs and tool results (per block). Conversation prose is never capped.
const MAX_TOOL_CHARS = 6000;

const args = process.argv.slice(2);
const APPEND = args.includes('--append');
const sessionIdx = args.indexOf('--session');
const SESSION = sessionIdx > -1 ? args[sessionIdx + 1] : null;
if (!SESSION) {
  console.error('Pass --session <id>. The sessions folder is shared by every project.');
  process.exit(1);
}

// ── customer details ────────────────────────────────────────────────────────
// A labelled value from the op-report form: "Customer Name: Jane Doe". The value ends at
// a line break (real or written as \n inside saved JSON), a quote, a pipe or a "<".
const LABELLED = /(Customer Name|Customer Phone Number|Number The Customer Called From|Called From)(\*{0,2}[ \t]*:\*{0,2}[ \t]*)([^\\\r\n"|<]+)/g;
// A phone number only when it STANDS ALONE (same rule as the op-report archive): not inside
// a Slack link, an ID or coordinates.
const GUARD = String.raw`(?<![\w\/.:#])(?<!ID )(?<!ID: )`;
const PLUS1 = new RegExp(`${GUARD}\\+1[\\s.-]?\\d{10}(?![\\w-])`, 'g');
const TEN = new RegExp(`${GUARD}(?:\\+?1[\\s.-]?)?(?:\\(\\d{3}\\)\\s?|\\d{3}[\\s.-]?)\\d{3}[\\s.-]?\\d{4}(?![\\w-])`, 'g');

// CALL TEXT from the database probes: transcripts, word lists, AI call summaries, QA
// responses. A customer's name, address or birthday can be anywhere in it, so the whole
// value goes, not just what a pattern recognises (found 2026-09-11: two transcripts with
// names, an address, a phone number and a birthday). A summary runs over several lines;
// its following lines go too, up to the next line that starts a new "name=" value, a
// section, a "label <tab> value" row, a code fence or a message header (40 lines at most).
const CALL_TEXT = /\b(transcript|words_|summary_|first_utterance|raw|sample)=/;
const MULTI_LINE = /^(summary_|sample)=$/;
const NEXT_RECORD = /^(\s*\d+\t)?\s*(\w+=|— |## \[|```|.* \t )/;
function removeCallText(text) {
  const kept = [];
  let following = 0;
  for (const line of text.split('\n')) {
    const m = line.match(CALL_TEXT);
    if (m) {
      kept.push(`${line.slice(0, m.index + m[0].length)}[call text removed]`);
      following = MULTI_LINE.test(m[0]) ? 40 : 0;
      continue;
    }
    if (following > 0 && !NEXT_RECORD.test(line)) { following -= 1; continue; }
    following = 0;
    kept.push(line);
  }
  return kept.join('\n');
}

function scrub(text) {
  if (!text) return text;
  return removeCallText(text)
    .replace(LABELLED, (m, label, sep, value) => (value.trim() && value.trim() !== '[removed]' ? `${label}${sep}[removed]` : m))
    .replace(/Customer [A-Z][a-z]+ [A-Z][a-z]+\s+(?=\+1\d{10})/g, 'Customer ')
    .replace(PLUS1, '[phone removed]')
    .replace(TEN, '[phone removed]');
}

function selfTest() {
  const mustChange = [
    ['Customer Name: Jane Doe\\nCustomer Phone Number: +15555550123', 'Jane', '5550123'],
    ['Customer Name: Ana O\'Neil\nnext', 'Neil', null],
    ['Number The Customer Called From: +15555550123\\\\nNext', '5550123', null],
    ['*Customer Name:* Jane Doe\n', 'Jane', null],
    ['Customer Jane Doe +15555550123 calling', 'Jane', '5550123'],
    ['(Son-7075551234)', '7075551234', null],
    ['call (707) 555-1234 back', '555-1234', null],
    ['at 1-707-555-1234', '555-1234', null],
    ['transcript=Hi, my name is Pat Quill and I live at 12 Oak Lane  createdAt=2026-08-21', 'Oak Lane', 'Quill'],
    ['    69\tword timings \t words_=[{"word":"quill","punctuated_word":"Quill,"}]', 'Quill', null],
    ['callLogId=1  summary_=STEP 1: INITIAL TRIAGE\n\nEvidence: "this is Pat Quill"\nName Recognition: [Met] "12 Oak Lane"\ncallLogId=2  agentId=x', 'Quill', 'Oak Lane'],
    ['    17\tcallSummary \t callLogId=1  summary_=STEP 1\n    18\t\n    19\tEvidence: "Pat Quill"\n    27\tcallLogId=2  summary_=STEP 1', 'Quill', null],
  ];
  const mustKeep = [
    '<https://x.slack.com/archives/C3XUQB7EX/p1785188371832239>',
    'Unique ID 1234567890 - 1234567890123456789',
    'coordinates 40.7128123456, -74.0060123456',
    'CallLog 55628370', 'Ride: 343960135',
    "['_custName', 'Customer Name'], ['_custPhone', 'Customer Phone Number']",
    'Customer Name    52',
    'createdAt=2026-08-21  transcript_chars=5085  says_card_number=1',
    'CHAR_LENGTH(cs.summary) AS summary_chars, LEFT(x, 3) AS transcript',
  ];
  // What follows a removed summary must survive: the next record is not call text.
  const after = scrub('callLogId=1  summary_=STEP 1\n\nEvidence: "Pat Quill"\ncallLogId=2  agentId=keep-me\nplain prose line');
  if (!after.includes('agentId=keep-me') || !after.includes('plain prose line')) {
    console.error('SELF-TEST FAILED, removed text after a call summary that was not call text');
    process.exit(1);
  }
  for (const [t, gone1, gone2] of mustChange) {
    const out = scrub(t);
    if (out.includes(gone1) || (gone2 && out.includes(gone2))) {
      console.error('SELF-TEST FAILED, a customer detail would be kept:', t.replace(/[A-Za-z]/g, 'x').replace(/\d/g, '9'));
      process.exit(1);
    }
  }
  for (const t of mustKeep) {
    if (scrub(t) !== t) {
      console.error('SELF-TEST FAILED, would change text that is not a customer detail:', t, '->', scrub(t));
      process.exit(1);
    }
  }
  console.log(`Scrub self-test passed (${mustChange.length} customer details removed, ${mustKeep.length} IDs/links kept)`);
}

function todayET() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' ET';
}

function loadState() {
  try {
    return new Set(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).exportedUuids || []);
  } catch {
    return new Set();
  }
}

function saveState(uuidSet) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ exportedUuids: Array.from(uuidSet), updated: new Date().toISOString() }), 'utf8');
}

function cap(text) {
  if (text == null) return text;
  if (text.length <= MAX_TOOL_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_CHARS)}\n[… truncated ${text.length - MAX_TOOL_CHARS} chars — full content was in the live session …]`;
}

function stripEmbeddedSessionTemplates(text) {
  if (!text) return text;
  const pattern = /═{40,}\r?\n# NEW SESSION — [^\r\n]+\r?\nSession ID: [^\r\n]+\r?\nMessages in this session: \d+\r?\n═{40,}/g;
  return text.replace(pattern, '[session header template — removed for readability]');
}

function textOf(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (typeof block === 'string') return block;
      if (block.type === 'text') return block.text || '';
      if (block.type === 'tool_use') {
        return `\n\n**🛠 Tool call: \`${block.name}\`**\n\n\`\`\`json\n${cap(JSON.stringify(block.input || {}, null, 2))}\n\`\`\`\n`;
      }
      if (block.type === 'tool_result') {
        const result = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c) => c.text || JSON.stringify(c)).join('\n')
            : JSON.stringify(block.content);
        return `\n\n**🔧 Tool result:**\n\n\`\`\`\n${cap(result)}\n\`\`\`\n`;
      }
      if (block.type === 'thinking') {
        return `\n\n*[internal reasoning]*\n> ${(block.thinking || '').split('\n').join('\n> ')}\n`;
      }
      if (block.type === 'image') return '[image]';
      return cap(JSON.stringify(block));
    }).join('\n');
  }
  return JSON.stringify(content);
}

function parseSession(jsonlPath) {
  const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);
  const messages = [];
  let counter = 0;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === 'summary' || entry.type === 'system') continue;
    const msg = entry.message;
    if (!msg) continue;
    // Scrubbed after capping, on the text actually saved. A cap that cuts a phone number in
    // half can leave its first digits, never the whole number.
    const content = scrub(stripEmbeddedSessionTemplates(textOf(msg.content))).trim();
    if (!content) continue;
    counter++;
    messages.push({ counter, role: (msg.role || entry.type || 'unknown').toUpperCase(), content, uuid: entry.uuid || `no-uuid-${counter}` });
  }
  return messages;
}

function formatMessages(messages) {
  return messages.map((m, i) => `## [${i + 1}] ${m.role}\n\n${m.content}\n\n---\n`).join('\n');
}

function main() {
  selfTest();
  const src = path.join(SESSIONS_DIR, `${SESSION}.jsonl`);
  if (!fs.existsSync(src)) throw new Error(`Session file not found: ${src}`);
  console.log(`Source: ${src}`);

  const all = parseSession(src);
  console.log(`Parsed ${all.length} messages from session`);

  if (fs.existsSync(DEST)) {
    if (!APPEND) {
      console.error(`${DEST} already exists. Never overwrite it: run again with --append.`);
      process.exit(1);
    }
    const seen = loadState();
    const fresh = all.filter((m) => !seen.has(m.uuid));
    console.log(`${fresh.length} new; ${all.length - fresh.length} already saved`);
    if (!fresh.length) {
      console.log('Nothing new to append. File unchanged.');
      return;
    }
    const header = [
      '',
      '═══════════════════════════════════════════════════════════════════════',
      `# NEW SESSION — ${todayET()}`,
      `Session ID: ${SESSION}`,
      `Messages in this session: ${fresh.length}`,
      '═══════════════════════════════════════════════════════════════════════',
      '',
    ].join('\n');
    fs.appendFileSync(DEST, `${header}\n${formatMessages(fresh)}`, 'utf8');
    for (const m of fresh) seen.add(m.uuid);
    saveState(seen);
    console.log(`Appended ${fresh.length} messages. File is now ${(fs.statSync(DEST).size / 1024).toFixed(0)} KB`);
  } else {
    const head = [
      `# ${TITLE}`,
      '',
      `First export: ${todayET()}`,
      `Initial session: ${SESSION}`,
      `Total messages: ${all.length}`,
      '',
      '> Customer names, phone numbers and called-from numbers are removed from this backup.',
      '> When Vee says "Done for the day", run `node scripts/export-conversation.cjs --append --session <id>`. Never overwrite this file.',
      '',
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(DEST, head + formatMessages(all), 'utf8');
    saveState(new Set(all.map((m) => m.uuid)));
    console.log(`Wrote ${all.length} messages. File is ${(fs.statSync(DEST).size / 1024).toFixed(0)} KB`);
  }
}

main();
