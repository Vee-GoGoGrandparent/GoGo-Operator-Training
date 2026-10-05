// Turns a LIVE class workbook into a class data file — no more hand-typing from a PDF.
//
//   node scripts/pull-class-sheet.js            # show what it found, write nothing
//   node scripts/pull-class-sheet.js --write    # write data/class-sep-2026.js
//
// June and August were transcribed out of PDFs by hand, which is why their files carry a
// warning that nothing updates itself. The September workbook is a Google Sheet the bot can
// read (Vee shared it 2026-10-05), so this reads it instead. Re-run it whenever the class's
// scores change and commit the result.
//
// What it reads, all from the one workbook:
//   "New hires Per Class"  roster: name + Slack ID, split into Class 1 and Class 2
//   "New Hires"            who left: Active / Resigned / Terminated, with the reason
//   "SLI Class 1" / "SLI 2"  the scores: knowledge, call handling, system navigation,
//                          participation+punctuality, technical readiness, weighted total
//   "Attendance Class 1/2"  lates, absences, early logouts off the daily grid
//
// Names are matched between tabs on FIRST and LAST name, because the same person is written
// three different ways in one workbook ("Divine Grace Amiler" / "Divine Grace Amiler - Delivery").
// Anything that fails to match is printed loudly rather than quietly dropped.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOnlyClient } from '../src/sheets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRITE = process.argv.includes('--write');

const SOURCE = {
  sheetId: '1_pFFp5pWGCeYLvDiRXwIb5bV0h6d6W1G-QcdUhrEq90',
  title: 'September 2026 Class',
  out: path.join(HERE, '..', 'data', 'class-sep-2026.js'),
  constName: 'SEP_2026',
  meta: {
    cohort: 'sep-2026',
    label: 'September',
    classStart: '2026-09-14',
    classEnd: '2026-10-02', // graduation — Vee confirmed 2026-10-05; the 30/60/90 clock runs from here
    weeks: 3,
    quizPassMark: 0.8,
  },
  rooms: [
    { group: 1, roster: 'Class 1', sli: 'SLI Class 1', attendance: 'Attendance Class 1' },
    { group: 2, roster: 'Class 2', sli: 'SLI 2', attendance: 'Attendance Class 2' },
  ],
};

// Their workbook, not ours: a client that cannot write, by scope.
const api = readOnlyClient();
const get = async (tab, range) => {
  const r = await api.spreadsheets.values.get({ spreadsheetId: SOURCE.sheetId, range: `'${tab}'!${range}` });
  return r.data.values ?? [];
};
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Half this workbook writes a person as "Divine Grace Amiler - Delivery", and the other tabs
// write them plain. Left alone, "Delivery" reads as the surname and nothing matches. So the
// department comes off the name and is kept as its own field.
const DEPT = /\s*-\s*(delivery|deliveries|gourmet|grocery|home ?services?|rides?)\s*$/i;
const deptOf = (s) => (clean(s).match(DEPT)?.[1] ?? '').replace(/^\w/, (c) => c.toUpperCase()) || null;
// For MATCHING, any trailing " - something" comes off: the tabs variously append the
// department, "TL", or just a stray dash. The space either side is what keeps it safe —
// a real double-barrelled surname like "Macalbi-Mula" has no spaces and survives.
// A space on EITHER side of the dash is enough ("Flores - TL", "Ragasa- Delivery"), which
// still leaves a real hyphenated surname like "Macalbi-Mula" untouched.
const stripDept = (s) => clean(s).replace(/(\s+-\s*|\s*-\s+)[\w .]*$/, '').trim();
const tokens = (s) => stripDept(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter((w) => w && w !== 'jr' && w !== 'sr');
const nameKey = (s) => { const t = tokens(s); return t.length >= 2 ? `${t[0]}|${t.at(-1)}` : (t[0] ?? ''); };
const pct = (v) => {
  const n = Number(String(v ?? '').replace('%', '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

// ---- roster: one section per room, names and Slack IDs
const rosterRows = await get('New hires Per Class', 'A1:H200');
const roster = [];
let room = null;
for (const r of rosterRows) {
  const a = clean(r[0]);
  const asRoom = SOURCE.rooms.find((x) => x.roster.toLowerCase() === a.toLowerCase());
  if (asRoom) { room = asRoom; continue; }
  if (!room || !a || !/^U[A-Z0-9]{7,}$/i.test(clean(r[1]))) continue;
  roster.push({ name: stripDept(a), department: deptOf(a), slackId: clean(r[1]), group: room.group, room });
}
console.log(`roster: ${roster.length} people (${SOURCE.rooms.map((x) => `${x.roster}: ${roster.filter((p) => p.group === x.group).length}`).join(', ')})`);

// ---- who left, and why
const leavers = new Map();
for (const r of (await get('New Hires', 'A1:G200')).slice(1)) {
  const name = clean(r[0]);
  const status = clean(r[4]).toLowerCase();
  if (!name || !status || status === 'active') continue;
  leavers.set(nameKey(name), { status, reason: clean(r[5]), leftOn: clean(r[6]) });
}
console.log(`${leavers.size} people marked resigned or terminated`);

// ---- scores
const scores = new Map();
for (const room_ of SOURCE.rooms) {
  const rows = await get(room_.sli, 'A1:N80');
  const head = (rows[0] ?? []).map(clean);
  const at = (label) => head.findIndex((h) => h.toLowerCase().startsWith(label.toLowerCase()));
  const cols = {
    knowledge: at('Knowledge Score'),
    callHandling: at('Call Handling Score'),
    sysNav: at('System Navigation Sc'),
    punctuality: at('Participation, Punct'),
    techReadiness: at('Technical Readiness'),
    total: head.findIndex((h) => /^total/i.test(h)),
  };
  const missing = Object.entries(cols).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) throw new Error(`${room_.sli}: cannot find the ${missing.join(', ')} column(s). Header: ${head.join(' | ')}`);
  for (const r of rows.slice(1)) {
    const name = clean(r[0]);
    if (!name) continue;
    scores.set(nameKey(name), {
      knowledge: pct(r[cols.knowledge]),
      callHandling: pct(r[cols.callHandling]),
      sysNav: pct(r[cols.sysNav]),
      punctuality: pct(r[cols.punctuality]),
      techReadiness: pct(r[cols.techReadiness]),
      total: pct(r[cols.total]),
    });
  }
}
console.log(`${scores.size} people have scores`);

// ---- attendance: the grid says Present / Absent / Late / Early Logout, with outage notes
// in their own columns (those say "Minor Internet Connectivity" and the like, so counting
// exact words cannot pick them up by accident).
const attendance = new Map();
for (const room_ of SOURCE.rooms) {
  for (const r of (await get(room_.attendance, 'A3:AZ80'))) {
    const name = clean(r[2]);
    if (!name) continue;
    const cells = r.slice(3).map(clean);
    attendance.set(nameKey(name), {
      absences: cells.filter((c) => /^absent$/i.test(c)).length,
      lates: cells.filter((c) => /^late$/i.test(c)).length,
      earlyLogouts: cells.filter((c) => /^early logout$/i.test(c)).length,
    });
  }
}
console.log(`${attendance.size} people have an attendance row`);

// ---- put it together, and say out loud what did not line up
const unmatched = { scores: [], attendance: [] };
const people = roster.map((p) => {
  const k = nameKey(p.name);
  const s = scores.get(k);
  const a = attendance.get(k);
  const gone = leavers.get(k);
  if (!s) unmatched.scores.push(p.name);
  if (!a) unmatched.attendance.push(p.name);
  return {
    slackId: p.slackId,
    name: p.name,
    group: p.group,
    ...(p.department ? { department: p.department } : {}),
    knowledge: s?.knowledge ?? 0,
    sli: null, // this workbook has no SLI /300 score; June and August did
    callHandling: s?.callHandling ?? 0,
    sysNav: s?.sysNav ?? 0,
    punctuality: s?.punctuality ?? 0,
    engagement: null, // their sheet folds engagement into the participation/punctuality score
    techReadiness: s?.techReadiness ?? 0,
    total: s?.total ?? 0,
    lates: a?.lates ?? 0,
    absences: a?.absences ?? 0,
    earlyLogouts: a?.earlyLogouts ?? 0,
    status: gone ? gone.status : 'active',
    ...(gone?.reason ? { reason: gone.reason } : {}),
    ...(gone?.leftOn ? { leftTraining: gone.leftOn } : {}),
  };
});
for (const [what, list] of Object.entries(unmatched)) {
  if (list.length) console.log(`⚠️  no ${what} row matched for ${list.length}: ${list.join(', ')}`);
}
const left = people.filter((p) => p.status !== 'active');
console.log(`${people.length} people · ${left.length} left during training (${left.map((p) => `${p.name} ${p.status}`).join(', ')})`);
console.log(`lates ${people.reduce((s, p) => s + p.lates, 0)} · absences ${people.reduce((s, p) => s + p.absences, 0)} · early logouts ${people.reduce((s, p) => s + p.earlyLogouts, 0)}`);

if (!WRITE) {
  console.log('\nDRY RUN — pass --write to save the file. First two people:');
  for (const p of people.slice(0, 2)) console.log('  ' + JSON.stringify(p));
  process.exit(0);
}

const line = (p) => `  ${JSON.stringify(p).replace(/"([a-zA-Z]+)":/g, '$1: ').replace(/^\{/, '{ ').replace(/\}$/, ' }')},`;
const file = `// ${SOURCE.meta.label} 2026 class — read from the LIVE class workbook "${SOURCE.title}"
// by scripts/pull-class-sheet.js. Do not hand-edit: re-run the script instead.
//
// This is the first class we did not have to transcribe. June and August came out of PDFs by
// hand; this one is pulled from the sheet the orientation team actually keeps, so re-running
// the script picks up whatever they have changed.
//
// Scores come from the "SLI" tab, which weights Knowledge 30% · Call Handling 25% · System
// Navigation 20% · Participation & Punctuality 15% · Technical Readiness 10%. That sheet folds
// engagement into participation, and has no SLI /300 score, so those two fields are null here
// rather than invented. Lates, absences and early logouts are counted off the attendance grid.
//
// Generated ${new Date().toISOString().slice(0, 10)}.

export const CLASS_META = ${JSON.stringify(SOURCE.meta, null, 2).replace(/"([a-zA-Z]+)":/g, '$1:').replace(/"/g, "'")};

export const ${SOURCE.constName} = [
${SOURCE.rooms.map((room_) => `  // ---------------- Class ${room_.group} ----------------\n${people.filter((p) => p.group === room_.group).map(line).join('\n')}`).join('\n\n')}
];
`;
fs.writeFileSync(SOURCE.out, file, 'utf8');
console.log(`\nwrote ${SOURCE.out} — ${people.length} people`);
