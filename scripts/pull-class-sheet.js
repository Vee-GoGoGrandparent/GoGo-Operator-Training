// Turns a LIVE class workbook into a class data file — no more hand-typing from a PDF.
//
//   node scripts/pull-class-sheet.js                        # September: show what it found, write nothing
//   node scripts/pull-class-sheet.js --write                # write data/class-sep-2026.js
//   node scripts/pull-class-sheet.js --class may [--write]  # the May 2026 workbook (added 2026-10-05)
//
// The workbooks are not laid out identically. May has no "New hires Per Class" tab, so its
// roster comes from the SLI tabs (one per room) and its Slack IDs from the time-keeping tabs;
// May's Class 1 attendance grid is keyed by preferred first name rather than full name; and
// May still scores Engagement separately (30/25/20/10/10/5). Each workbook's quirks live in
// its entry in SOURCES below, so the reading code stays the same.
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

const SOURCES = {
  sep: {
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
    // Roster + Slack IDs from "New hires Per Class", one section per room.
    rosterFrom: 'perClassTab',
    newHires: { status: 4, reason: 5, leftOn: 6 },
    engagementSeparate: false,
    rooms: [
      { group: 1, roster: 'Class 1', sli: 'SLI Class 1', attendance: 'Attendance Class 1', attendanceNameCol: 2 },
      { group: 2, roster: 'Class 2', sli: 'SLI 2', attendance: 'Attendance Class 2', attendanceNameCol: 2 },
    ],
    header: `This is the first class we did not have to transcribe. June and August came out of PDFs by
// hand; this one is pulled from the sheet the orientation team actually keeps, so re-running
// the script picks up whatever they have changed.
//
// Scores come from the "SLI" tab, which weights Knowledge 30% · Call Handling 25% · System
// Navigation 20% · Participation & Punctuality 15% · Technical Readiness 10%. That sheet folds
// engagement into participation, and has no SLI /300 score, so those two fields are null here
// rather than invented. Lates, absences and early logouts are counted off the attendance grid.`,
  },
  may: {
    sheetId: '1iYwLsHQycz3mlIUoAMTQn3JyIzimSVBay-ffX0urJfM',
    title: 'May 2026 Class',
    out: path.join(HERE, '..', 'data', 'class-may-2026.js'),
    constName: 'MAY_2026',
    meta: {
      cohort: 'may-2026',
      label: 'May',
      classStart: '2026-05-18', // first column of the attendance grid
      classEnd: '2026-06-05', // graduation post in #gogogratitude, 2026-06-05 (both rooms)
      weeks: 3,
      quizPassMark: 0.8,
    },
    // No per-class roster tab: the SLI tabs ARE the roster (one per room), and Slack IDs
    // come from the time-keeping and live-call tabs, matched on first + last name.
    rosterFrom: 'sliTabs',
    slackIdTabs: ['TK Class 1', 'TK Class 2', 'TK Draft Class 1', 'TK Draft', 'Live Calls Class 1'],
    newHires: { status: 4, reason: 5, leftOn: null },
    engagementSeparate: true,
    rooms: [
      // Class 1's attendance grid lists PREFERRED first names only ("Edcel Paul"), in column B.
      { group: 1, sli: 'SLI Class 1', attendance: 'Attendance Class 1', attendanceNameCol: 1 },
      { group: 2, sli: 'SLI 2', attendance: 'Attendance Class 2', attendanceNameCol: 2 },
    ],
    header: `Added 2026-10-05 (Vee: "Yes, add May to the tracker"). May graduated 2026-06-05, so its three
// tracked months are already over: it shows on the Scorecard and on Training vs Performance with
// final numbers, and not on the per-person tabs that drop a class after 3 months.
//
// Scores come from the "SLI" tabs, which in May still weighted Knowledge 30% · Call Handling 25%
// · System Navigation 20% · Punctuality & Participation 10% · Engagement 10% · Technical
// Readiness 5%. There is no SLI /300 score, so that field is null. Lates, absences and early
// logouts are counted off the attendance grid. Two people on the "New Hires" tab have no SLI row
// (they never reached scoring) and are not listed; nobody on this file was left out silently.`,
  },
};
const which = (() => { const i = process.argv.indexOf('--class'); return i > 0 ? process.argv[i + 1] : 'sep'; })();
const SOURCE = SOURCES[which];
if (!SOURCE) throw new Error(`Unknown --class "${which}". Known: ${Object.keys(SOURCES).join(', ')}`);

// Their workbook, not ours: a client that cannot write, by scope.
const api = readOnlyClient();

// Facts the orientation team told us that their workbook does not record, per class. Keyed by
// Slack ID, so a spelling change in their sheet cannot quietly detach a note from its person.
// These are merged into the generated file, which is why re-running the script does not lose them.
const FROM_THE_TEAM_BY_CLASS = {
  sep: {
    // Oscar, 2026-10-05: "Aug class and he stepped out. Was rehired on Sept but he never showed
    // up — so it is the same guy." Their SLI tab still scores him 100 for participation, which
    // leaves a training total of 15 rather than 0, so the Scorecard would otherwise count him as
    // someone who started and then left. Vee's call: fix this person, leave the rule alone.
    U0BLTPD912R: {
      neverStarted: true,
      note: 'Was in the August class and stepped out; rehired for September but never showed up (Oscar, 2026-10-05). Counted as never started despite the participation score on their SLI tab.',
    },
  },
};
const FROM_THE_TEAM = FROM_THE_TEAM_BY_CLASS[which] ?? {};
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
const roster = [];
const isSlackId = (s) => /^U[A-Z0-9]{7,}$/i.test(clean(s));
if (SOURCE.rosterFrom === 'perClassTab') {
  const rosterRows = await get('New hires Per Class', 'A1:H200');
  let room = null;
  for (const r of rosterRows) {
    const a = clean(r[0]);
    const asRoom = SOURCE.rooms.find((x) => x.roster.toLowerCase() === a.toLowerCase());
    if (asRoom) { room = asRoom; continue; }
    if (!room || !a || !isSlackId(r[1])) continue;
    roster.push({ name: stripDept(a), department: deptOf(a), slackId: clean(r[1]), group: room.group, room });
  }
} else {
  // Slack IDs from every tab that pairs a name with one. Two different IDs for one name would
  // be a real conflict, so it stops rather than picking one.
  const idOf = new Map();
  for (const tab of SOURCE.slackIdTabs) {
    const rows = await get(tab, 'A1:Z400');
    const head = (rows[0] ?? []).map(clean);
    const nameCol = head.indexOf('Name') >= 0 ? head.indexOf('Name') : 0;
    const idCol = head.indexOf('Slack ID');
    if (idCol < 0) continue;
    for (const r of rows.slice(1)) {
      if (!isSlackId(r[idCol]) || !clean(r[nameCol])) continue;
      const k = nameKey(r[nameCol]);
      const id = clean(r[idCol]);
      if (idOf.has(k) && idOf.get(k) !== id) throw new Error(`Two Slack IDs for "${clean(r[nameCol])}": ${idOf.get(k)} and ${id}`);
      idOf.set(k, id);
    }
  }
  for (const room_ of SOURCE.rooms) {
    for (const r of (await get(room_.sli, 'A2:A80'))) {
      const a = clean(r[0]);
      if (!a) continue;
      roster.push({ name: stripDept(a), department: deptOf(a), slackId: idOf.get(nameKey(a)) ?? '', group: room_.group, room: room_ });
    }
  }
  // People the "New Hires" tab marks as having left, who never got an SLI row. Leaving them off
  // would shrink the class; giving them scores would invent data. So they are listed with zero
  // scores, the room their attendance row is in, and a note that says exactly that.
  const onRoster = new Set(roster.map((p) => nameKey(p.name)));
  for (const r of (await get('New Hires', 'A2:G200'))) {
    const a = clean(r[0]);
    const status = clean(r[SOURCE.newHires.status]).toLowerCase();
    if (!a || !status || status === 'active' || onRoster.has(nameKey(a))) continue;
    let room_ = null;
    for (const rm of SOURCE.rooms) {
      const rows = await get(rm.attendance, 'A3:AZ80');
      if (rows.some((x) => nameKey(x[rm.attendanceNameCol]) === nameKey(a))) { room_ = rm; break; }
    }
    if (!room_) { console.log(`⚠️  ${a} left (${status}) but is in no attendance grid either — not listed`); continue; }
    roster.push({ name: stripDept(a), department: deptOf(a), slackId: idOf.get(nameKey(a)) ?? '', group: room_.group, room: room_, unscored: true });
    console.log(`note: ${a} left (${status}) before being scored — listed with zero scores`);
  }
  const noId = roster.filter((p) => !p.slackId).map((p) => p.name);
  if (noId.length) console.log(`⚠️  no Slack ID found for ${noId.length}: ${noId.join(', ')}`);
}
console.log(`roster: ${roster.length} people (${SOURCE.rooms.map((x) => `Class ${x.group}: ${roster.filter((p) => p.group === x.group).length}`).join(', ')})`);

// ---- who left, and why
const leavers = new Map();
for (const r of (await get('New Hires', 'A1:G200')).slice(1)) {
  const name = clean(r[0]);
  const c = SOURCE.newHires;
  const status = clean(r[c.status]).toLowerCase();
  if (!name || !status || status === 'active') continue;
  leavers.set(nameKey(name), { status, reason: clean(r[c.reason]), leftOn: c.leftOn === null ? '' : clean(r[c.leftOn]) });
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
    // September calls it "Participation, Punctuality…", May "Punctuality & Participation…".
    // The first matching column is the raw score; the one after it is the weighted share.
    punctuality: at('Participation, Punct') >= 0 ? at('Participation, Punct') : at('Punctuality & Partic'),
    techReadiness: at('Technical Readiness'),
    total: head.findIndex((h) => /^total/i.test(h)),
    ...(SOURCE.engagementSeparate ? { engagement: at('Engagement Score') } : {}),
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
      ...(SOURCE.engagementSeparate ? { engagement: pct(r[cols.engagement]) } : {}),
    });
  }
}
console.log(`${scores.size} people have scores`);

// ---- attendance: the grid says Present / Absent / Late / Early Logout, with outage notes
// in their own columns (those say "Minor Internet Connectivity" and the like, so counting
// exact words cannot pick them up by accident).
const attendance = new Map();
const attendanceByRoom = new Map(); // group -> [{ tokens, counts }] for the first-name fallback
for (const room_ of SOURCE.rooms) {
  const col = room_.attendanceNameCol;
  const list = [];
  for (const r of (await get(room_.attendance, 'A3:AZ80'))) {
    const name = clean(r[col]);
    if (!name) continue;
    const cells = r.slice(col + 1).map(clean);
    const counts = {
      absences: cells.filter((c) => /^absent$/i.test(c)).length,
      lates: cells.filter((c) => /^late$/i.test(c)).length,
      earlyLogouts: cells.filter((c) => /^early logout$/i.test(c)).length,
    };
    attendance.set(nameKey(name), counts);
    list.push({ tokens: tokens(name), counts });
  }
  attendanceByRoom.set(room_.group, list);
}
// May's Class 1 grid has preferred FIRST names only ("Edcel Paul" for "Edcel Paul Fantonial
// Gamonido"). Fall back to: the grid name's words are the first words of the full name, within
// the same room, and exactly one grid row fits. Anything ambiguous stays unmatched and is printed.
const attendanceFor = (p) => {
  const exact = attendance.get(nameKey(p.name));
  if (exact) return exact;
  const full = tokens(p.name);
  const fits = (attendanceByRoom.get(p.group) ?? []).filter((a) => a.tokens.length && a.tokens.every((t, i) => full[i] === t));
  return fits.length === 1 ? fits[0].counts : undefined;
};
console.log(`${attendance.size} people have an attendance row`);

// ---- put it together, and say out loud what did not line up
const unmatched = { scores: [], attendance: [] };
const people = roster.map((p) => {
  const k = nameKey(p.name);
  const s = scores.get(k);
  const a = attendanceFor(p);
  const gone = leavers.get(k);
  if (!s && !p.unscored) unmatched.scores.push(p.name);
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
    // September folds engagement into the participation/punctuality score; May scores it apart.
    engagement: SOURCE.engagementSeparate ? (s?.engagement ?? 0) : null,
    techReadiness: s?.techReadiness ?? 0,
    total: s?.total ?? 0,
    lates: a?.lates ?? 0,
    absences: a?.absences ?? 0,
    earlyLogouts: a?.earlyLogouts ?? 0,
    status: gone ? gone.status : 'active',
    ...(gone?.reason ? { reason: gone.reason } : {}),
    ...(gone?.leftOn ? { leftTraining: gone.leftOn } : {}),
    ...(p.unscored ? { note: 'Marked as having left on the workbook\'s "New Hires" tab but has no SLI scores, so every score is 0 and the Scorecard counts them as never started. Ask the orientation team whether they started training.' } : {}),
    ...(FROM_THE_TEAM[p.slackId] ?? {}),
  };
});
// A note keyed to a Slack ID nobody in this class has would do nothing at all, quietly.
const strayNotes = Object.keys(FROM_THE_TEAM).filter((id) => !people.some((p) => p.slackId === id));
if (strayNotes.length) console.log(`⚠️  note written for a Slack ID that is not in this class: ${strayNotes.join(', ')}`);
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
// ${SOURCE.header}
//
// Generated ${new Date().toISOString().slice(0, 10)}.

export const CLASS_META = ${JSON.stringify(SOURCE.meta, null, 2).replace(/"([a-zA-Z]+)":/g, '$1:').replace(/"/g, "'")};

export const ${SOURCE.constName} = [
${SOURCE.rooms.map((room_) => `  // ---------------- Class ${room_.group} ----------------\n${people.filter((p) => p.group === room_.group).map(line).join('\n')}`).join('\n\n')}
];
`;
fs.writeFileSync(SOURCE.out, file, 'utf8');
console.log(`\nwrote ${SOURCE.out} — ${people.length} people`);
