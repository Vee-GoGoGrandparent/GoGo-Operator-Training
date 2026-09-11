// OPS_TASK=tracker
//
// Builds the team-facing tracker: who is registering, who is falling behind, who
// needs a team lead to step in. Writes to OPS_TRACKER_SHEET_ID — the clean sheet —
// and nowhere else.
//
// What the trainer asked for, in his words: "focus on the hard regs, and who's not
// registering, who could be churn, who could get fired… we're gonna have access to
// be like, hey team leads, you better do your job."
//
// So: numbers say WHO, the trainer decides WHAT to do, team leads do it.
//
// Deliberately NOT here: any quality score. The AI grading is unreviewed and the
// trainer says it is often wrong. Grading is not his job and it is not ours.

import { connect, q, tryQ } from '../src/db.js';
import { writeTab, formatHeader, priorityColors, formatBanners, formatScorecard, moveTab, TRACKER_SHEET_ID, BRAND } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate } from '../src/time.js';
import { regCallsOf, ratio, median, pctStr, pct100, weekKey, assess, TARGET_HR_RATIO } from '../src/analysis.js';
import { AUG_2026, CLASS_META } from '../data/class-aug-2026.js';
import {
  CLASSES, CLASSES_WITHOUT_ROSTER, TRAINED_SLACK_IDS,
  TRAINED_WITHOUT_SLACK, TRAINEE_BY_SLACK, earliestGradDate, milestoneDate,
} from '../data/trained-roster.js';

const WEEKS = 12; // 4 recent + 8 prior — the escalate/watch comparison
const RECENT_WEEKS = 4;

// The scorecard is graded at 30, 60 and 90 days, so the tracker reports on the same
// clock. 98 days is pulled rather than 90 because the 12-week comparison above needs
// 84 and the 90-day window needs 90 — one query has to cover both.
// The scorecard is graded in 30-day blocks measured FROM GRADUATION, so the tracker
// reports on the same clock.
//
// These are DISCRETE blocks, not running totals. Vee: "reg calls thirty days is the
// first thirty days. Then reg calls sixty days is the following thirty days. It's
// still only counting thirty days, not sixty days in total."
//
// DAY ZERO IS THEIR FIRST REAL CALL, PER PERSON — not graduation, and definitely not
// the practice calls taken during training. Vee: "no training calls should be counted
// in this total… it's counted from the moment they actually start taking calls."
// People come off a class at different speeds — some are on the schedule the next
// day, some wait two or three — so this clock starts per operator, not per class.
//
// A block that has not started yet is left blank rather than shown as 0 — a zero
// reads as "they registered nothing", which is a very different thing from "that
// month has not happened yet".
const BLOCKS = [
  { label: '30d', from: 0, to: 29 },
  { label: '60d', from: 30, to: 59 },
  { label: '90d', from: 60, to: 89 },
];

// We follow an operator for 90 days after their first real call and then stop. Vee:
// "we're only keeping track for ninety days. After ninety days, we stop keeping track
// of those operators." The class-level tabs still compute — a class's scorecard is
// its permanent record — but nobody stays on the per-person tabs forever.
const TRACK_DAYS = 90;


const name = (o) => `${(o.firstName || '').trim()} ${(o.lastName || '').trim()}`.replace(/\s+/g, ' ').trim();

async function main() {
  if (!TRACKER_SHEET_ID) {
    throw new Error('OPS_TRACKER_SHEET_ID is not set. The team-facing sheet has nowhere to go.');
  }
  const { conn } = await connect();

  // ---------------------------------------------------------------- 1. roster
  // Everyone still active, plus anyone closed in the last 6 months — churn is the
  // point, so the people who left have to stay visible.
  const operators = await q(
    conn,
    `SELECT o.id, o.slackId, o.firstName, o.lastName, o.createdAt, o.closedAt,
            o.deactivationReason, o.isRehireEligible, o.suspendedAt, o.defaultType,
            o.teamLeadId,
            tl.firstName AS tlFirst, tl.lastName AS tlLast
       FROM operators o
       LEFT JOIN operators tl ON tl.id = o.teamLeadId
      WHERE o.slackId IN (?)`,
    [TRAINED_SLACK_IDS],
    40_000,
  );
  // Everyone here went through a class we hold data for. Operators from other
  // departments are deliberately not pulled at all — not fetched and then hidden,
  // never fetched. Closed accounts stay in: churn is the point.
  console.log(`[tracker] ${TRAINED_SLACK_IDS.length} trained operators on the roster, ${operators.length} matched in the database`);
  if (TRAINED_WITHOUT_SLACK.length) {
    console.log(`[tracker] no Slack ID, cannot be joined: ${TRAINED_WITHOUT_SLACK.join(', ')}`);
  }

  const byId = Object.fromEntries(operators.map((o) => [o.id, o]));
  // Keyed off the FULL roster, not off the people with performance rows. Someone who
  // left before ever registering anything has no performance rows at all — and they
  // are exactly the churn we most need to count.
  const bySlack = Object.fromEntries(operators.filter((o) => o.slackId).map((o) => [o.slackId, o]));
  console.log(`[tracker] ${operators.length} operators in scope`);

  // ------------------------------------------------------- 2. weekly numbers
  const perf = await q(
    conn,
    `SELECT operatorId, aggregationDate,
            rideRegCalls, gourmetRegCalls, groceryRegCalls, noMembershipCalls,
            hardRegs, softRegs, trialRegs,
            annualHardRegs, valueMonthlyHardRegs, basicMonthlyHardRegs, fixedIncomeMonthlyHardRegs
       FROM operatorPerformances
      WHERE aggregationDate >= DATE_SUB(?, INTERVAL 14 DAY)
        AND operatorId IN (?)`,
    [earliestGradDate(), operators.map((o) => o.id)],
    60_000,
  );
  console.log(`[tracker] ${perf.length} daily performance rows for our operators`);

  // There used to be a second query here for MIN(aggregationDate) across all history.
  // It is gone: that answer includes practice calls taken during training, and those
  // are exactly what must not count. "Started calls" is now the first day of real
  // work, derived from the post-training rows below.

  // ------------------------------------------------------------ 3. aggregate
  // aggregationDate is a stored DATE, so it is compared against today's date in UTC,
  // matching how db.js parses it. Mixing a stored date against a real instant is the
  // classic way to end up a day out.
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const dayNum = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  // CHURN uses the class clock: day 0 is the last day of class. Confirmed against
  // their own published dates — the July class ended July 10 and its 60-day mark is
  // listed as September 10; August ends the 21st and its 30-day mark as September 21.
  const gradMs = Date.parse(`${earliestGradDate()}T00:00:00Z`);
  const dayAfterGrad = (d) => Math.floor((dayNum(d) - gradMs) / 86400000);

  // REGISTRATIONS use a different clock, on purpose: day 0 is the operator's own
  // first real call. Anything on or before their class end date is a training call
  // and is dropped outright — not counted anywhere, because the business does not
  // count it either.
  const classEndMsOf = (o) => {
    const t = o.slackId ? TRAINEE_BY_SLACK[o.slackId] : null;
    return t ? Date.parse(`${t.gradDate}T00:00:00Z`) : gradMs;
  };
  const classEndByOpId = Object.fromEntries(operators.map((o) => [o.id, classEndMsOf(o)]));

  // Post-training rows only, then each operator's first working day is the earliest
  // of what is left. Two passes, because the anchor has to be known before any row
  // can be placed in a block.
  // An unknown operator is DROPPED, not kept.
  //
  // This used to read `end === undefined || ...`, which let through every row whose
  // operator we could not place. Combined with a query that pulled the whole table,
  // that put strangers' weeks into the Weekly Trend header — which is exactly why
  // W32 and W33 showed up as empty columns before anyone from this class had taken
  // a single call. Defaulting to "keep" is the wrong default when the question is
  // "is this one of ours".
  const working = perf.filter((r) => {
    const end = classEndByOpId[r.operatorId];
    if (end === undefined) return false;
    return dayNum(r.aggregationDate) > end;
  });
  const startMsOf = {};
  for (const r of working) {
    const d = dayNum(r.aggregationDate);
    if (startMsOf[r.operatorId] === undefined || d < startMsOf[r.operatorId]) startMsOf[r.operatorId] = d;
  }
  const daysWorkedOf = (id) =>
    startMsOf[id] === undefined ? null : Math.floor((todayUTC - startMsOf[id]) / 86400000);

  console.log(`[tracker] ${perf.length - working.length} training-period rows excluded, ${working.length} kept`);

  // Weeks come from the rows that survived, so the trend starts the week the first
  // person actually took a real call — never earlier.
  const weeks = [...new Set(working.map((r) => weekKey(r.aggregationDate)))].sort();
  console.log(`[tracker] weekly trend spans ${weeks[0] ?? '(none)'} to ${weeks[weeks.length - 1] ?? '(none)'}`);
  const recentWeeks = new Set(weeks.slice(-RECENT_WEEKS));

  const agg = {}; // operatorId -> { recent, prior, byWeek, plans, block }
  const blank = () => ({ regCalls: 0, hardRegs: 0, softRegs: 0, trialRegs: 0 });
  const blankBlocks = () => Object.fromEntries(BLOCKS.map((b) => [b.label, { regCalls: 0, hardRegs: 0 }]));

  for (const r of working) {
    const a = (agg[r.operatorId] ??= { recent: blank(), prior: blank(), byWeek: {}, block: blankBlocks(), plans: { annual: 0, value: 0, basic: 0, fixedIncome: 0 } });
    const calls = regCallsOf(r);
    const wk = weekKey(r.aggregationDate);
    const bucket = recentWeeks.has(wk) ? a.recent : a.prior;

    bucket.regCalls += calls;
    bucket.hardRegs += Number(r.hardRegs || 0);
    bucket.softRegs += Number(r.softRegs || 0);
    bucket.trialRegs += Number(r.trialRegs || 0);

    const w = (a.byWeek[wk] ??= { regCalls: 0, hardRegs: 0 });
    w.regCalls += calls;
    w.hardRegs += Number(r.hardRegs || 0);

    // Which 30-day block of THIS operator's own first 90 days does the day fall in?
    // Training rows never reach here — they were filtered out above. Day 90 onward
    // falls in no block, which is the point: we stop tracking.
    const start = startMsOf[r.operatorId];
    if (start !== undefined) {
      const since = Math.floor((dayNum(r.aggregationDate) - start) / 86400000);
      const b = BLOCKS.find((x) => since >= x.from && since <= x.to);
      if (b) {
        a.block[b.label].regCalls += calls;
        a.block[b.label].hardRegs += Number(r.hardRegs || 0);
      }
    }

    a.plans.annual += Number(r.annualHardRegs || 0);
    a.plans.value += Number(r.valueMonthlyHardRegs || 0);
    a.plans.basic += Number(r.basicMonthlyHardRegs || 0);
    a.plans.fixedIncome += Number(r.fixedIncomeMonthlyHardRegs || 0);
  }

  // Peer median by start month — a three-week-old operator and a three-year-old one
  // are not doing the same job, and comparing them would only ever be unfair.
  // Cohort is the CLASS someone was in, straight off the roster. It used to be
  // inferred from the month of their first call, which was a guess and would have
  // split one class across two months. Now that every operator here came from a
  // known class, comparing class against class is a group-by rather than a project.
  const cohortOf = (id) => {
    const o = byId[id];
    const t = o?.slackId ? TRAINEE_BY_SLACK[o.slackId] : null;
    return t?.cohort || 'unknown';
  };
  const cohortRatios = {};
  for (const [id, a] of Object.entries(agg)) {
    if (!byId[id] || a.recent.regCalls < 25) continue;
    (cohortRatios[cohortOf(id)] ??= []).push(ratio(a.recent.hardRegs, a.recent.regCalls));
  }
  const peerMedian = Object.fromEntries(Object.entries(cohortRatios).map(([k, v]) => [k, median(v)]));

  // -------------------------------------------------------------- 4. per-op rows
  const rows = [];
  for (const o of operators) {
    const a = agg[o.id];
    if (!a) continue; // no activity in the window at all
    const first = startMsOf[o.id] === undefined ? null : new Date(startMsOf[o.id]);
    const daysWorked = daysWorkedOf(o.id);
    // Past 90 days on the phones, an operator drops off the per-person tabs.
    if (daysWorked !== null && daysWorked > TRACK_DAYS) continue;
    const weeksActive = first ? Math.floor((Date.now() - new Date(first).getTime()) / 604800000) : 0;

    const verdict = assess({
      recent: a.recent,
      prior: a.prior,
      peerMedianRatio: peerMedian[cohortOf(o.id)],
      weeksActive,
      isSuspended: !!o.suspendedAt,
    });

    rows.push({ o, a, first, daysWorked, weeksActive, verdict, cohort: cohortOf(o.id) });
  }
  console.log(`[tracker] ${rows.length} operators with activity in the last ${WEEKS} weeks`);

  // Anyone who has left drops below everyone still here, on every per-operator tab,
  // with the most recent departure at the top of that bottom group. Someone gone
  // three months is not what a trainer needs to see first; someone gone last week is.
  const order = { Escalate: 0, Watch: 1, 'No data': 2, OK: 3, Strong: 4 };
  const closedKey = (r) => (r.o.closedAt ? fmtDbDate(r.o.closedAt).slice(0, 10) : null);
  rows.sort((x, y) => {
    const cx = closedKey(x);
    const cy = closedKey(y);
    if (!cx !== !cy) return cx ? 1 : -1;          // still here first
    if (cx && cy && cx !== cy) return cy.localeCompare(cx); // most recent departure first
    return (order[x.verdict.level] - order[y.verdict.level])
        || (y.a.recent.regCalls - x.a.recent.regCalls);
  });

  // --------------------------------------------------------------- 5. the tabs
  const asOf = nowET();
  // build-tracker runs as its own process, so it reads the schedule from the
  // environment rather than from the server that spawned it.
  const onASchedule = Boolean(String(process.env.OPS_DAILY ?? '').trim());
  const stamp = `Last updated ${asOf}${onASchedule ? ' · refreshes daily' : ''}`;

  // The "Churn Watch" tab was removed. Vee: "I don't think we need this churn watch
  // tab. It's unnecessary... it's just repeating the same thing."
  //
  // She was right. Once the Scorecard covered every class and Training vs
  // Performance carried Priority per person, the tab was a third copy of both. The
  // one thing only it had — the reason someone was let go — moved onto the Status
  // cell in Training vs Performance, where the person actually is.

  /** Everyone from one class who is confirmed gone, most recent first. */
  const leaversOf = (cls) => cls.trainees
    .filter((t) => t.status === 'active')
    .map((t) => ({ t, o: t.slackId ? bySlack[t.slackId] : null }))
    .filter(({ o }) => o && o.closedAt)
    .map(({ t, o }) => ({
      name: t.name,
      left: fmtDbDate(o.closedAt).slice(0, 10),
      reason: (o.deactivationReason || '').trim(),
    }))
    .sort((a, b) => b.left.localeCompare(a.left));

  const todayISO = fmtDbDate(new Date(todayUTC)).slice(0, 10);

  /** The same "when was this refreshed" line every tab gets, sized to that tab. */
  const stampRow = (width) => [stamp, ...Array(Math.max(0, width - 1)).fill('')];

  // --- Hard Regs: everyone, the plain numbers ---
  const regs = [[
    'Operator', 'Slack ID', 'Team lead', 'Class', 'Weeks active',
    'Reg calls (4wk)', 'Hard regs (4wk)', 'Reg ratio (4wk)', 'Soft regs', 'Trials',
    'Annual', 'Value', 'Basic', 'Fixed income', 'Priority', 'Status',
  ]];
  regs.push(stampRow(regs[0].length));
  for (const r of rows) {
    regs.push([
      name(r.o), r.o.slackId || '',
      `${(r.o.tlFirst || '').trim()} ${(r.o.tlLast || '').trim()}`.trim(),
      r.cohort, r.weeksActive || '',
      r.a.recent.regCalls, r.a.recent.hardRegs, pctStr(r.verdict.recentRatio),
      r.a.recent.softRegs, r.a.recent.trialRegs,
      r.a.plans.annual, r.a.plans.value, r.a.plans.basic, r.a.plans.fixedIncome,
      r.verdict.level,
      r.o.closedAt ? `Left ${fmtDbDate(r.o.closedAt).slice(0, 10)}` : r.o.suspendedAt ? 'Suspended' : 'Active',
    ]);
  }

  // --- Team Leads: the accountability view ---
  const byTl = {};
  for (const r of rows) {
    const key = r.o.teamLeadId || '(none)';
    const t = (byTl[key] ??= {
      name: r.o.teamLeadId ? `${(r.o.tlFirst || '').trim()} ${(r.o.tlLast || '').trim()}`.trim() : '(no team lead assigned)',
      ops: 0, escalate: 0, watch: 0, strong: 0, regCalls: 0, hardRegs: 0, names: [],
    });
    t.ops += 1;
    t.regCalls += r.a.recent.regCalls;
    t.hardRegs += r.a.recent.hardRegs;
    if (r.verdict.level === 'Escalate') { t.escalate += 1; t.names.push(name(r.o)); }
    if (r.verdict.level === 'Watch') t.watch += 1;
    if (r.verdict.level === 'Strong') t.strong += 1;
  }
  const leads = [['Team lead', 'Operators', 'Escalate', 'Watch', 'Strong', 'Reg calls (4wk)', 'Hard regs (4wk)', 'Team reg ratio', 'vs target', 'Who to talk to first']];
  leads.push(stampRow(leads[0].length));
  for (const t of Object.values(byTl).sort((a, b) => b.escalate - a.escalate || b.ops - a.ops)) {
    const rr = ratio(t.hardRegs, t.regCalls);
    leads.push([
      t.name, t.ops, t.escalate, t.watch, t.strong, t.regCalls, t.hardRegs, pctStr(rr),
      rr === null ? '' : rr >= TARGET_HR_RATIO ? '✅ at or above' : `⚠️ ${pctStr(TARGET_HR_RATIO - rr)} under`,
      t.names.slice(0, 6).join(', '),
    ]);
  }

  // --- Weekly Trend: the shape of the ramp, week by week ---
  const trend = [['Operator', 'Slack ID', 'Team lead', ...weeks]];
  trend.push(stampRow(trend[0].length));
  for (const r of rows) {
    trend.push([
      name(r.o), r.o.slackId || '',
      `${(r.o.tlFirst || '').trim()} ${(r.o.tlLast || '').trim()}`.trim(),
      ...weeks.map((w) => {
        const wk = r.a.byWeek[w];
        if (!wk || wk.regCalls === 0) return '';
        return pctStr(ratio(wk.hardRegs, wk.regCalls));
      }),
    ]);
  }

  // --- README ---
  const counts = rows.reduce((m, r) => ({ ...m, [r.verdict.level]: (m[r.verdict.level] || 0) + 1 }), {});
  const readme = [
    ['GoGo Operator Training & Performance Tracker'],
    [],
    ['Last updated', asOf],
    ['Operators with activity in the last 12 weeks', rows.length],
    ['Escalate', counts.Escalate || 0],
    ['Watch', counts.Watch || 0],
    ['OK', counts.OK || 0],
    ['Strong', counts.Strong || 0],
    [],
    ['Tab', 'What it is'],
    ['Scorecard', 'The sheet upper management sends, rebuilt with our own numbers — same columns, same order, same date format, so it can sit beside theirs in a meeting with nothing to translate. Newest class on top. Anywhere our figure disagrees with theirs is listed underneath rather than cluttering the table.'],
    ['Training vs Performance', 'The August 2026 class with their training scores beside what they have actually done on the phones. This is the raw material for forecasting who will struggle.'],
    ['Hard Regs', 'Every operator from a tracked class and their registration numbers for the last 4 weeks, including which plans they sell.'],
    ['Team Leads', 'The same picture rolled up by team lead — how many of their people need help, and who to talk to first.'],
    ['Weekly Trend', 'Each operator week by week, so you can see the shape: ramping up, flat, or falling.'],
    [],
    ['How to read it', ''],
    ['Who is in here', 'ONLY operators who went through a class we hold training data for — right now the August 2026 class. Operators from other departments are not pulled at all. Adding the next class is one file.'],
    ['Reg ratio', 'Hard registrations divided by registration calls. Test calls are excluded. Management target is 15%.'],
    ['30d / 60d / 90d', 'Separate 30-day blocks counted forward from the day that person first took a real call, not running totals. 60d means their days 30-59, not their first 60 days. A block that has not started yet is left blank rather than shown as zero.'],
    ['Training calls', 'Not counted anywhere. Practice calls taken during class are dropped before any number on this sheet is worked out, because the business does not count them either.'],
    ['Two different clocks', 'Registrations are measured from the day that person first took a real call, because people join the schedule at different speeds after class. Churn is measured from the last day of class, because that is how management dates it.'],
    ['We stop at 90 days', 'An operator drops off the per-person tabs 90 days after their first real call. The class tabs keep their numbers — a class scorecard is a permanent record.'],
    ['Order of the rows', 'Training vs Performance is split into class sections, newest class at the top. Inside a class: people still here first with the strongest training score at the top, then a NO LONGER AT GOGO banner and that class’s own departures, most recent first. Each class keeps its own leavers — September’s never sit under August’s heading.'],
    ['Section headings', 'Generated on every run, not typed in. A heading added by hand would be wiped, because writing a tab clears its values first.'],
    ['Status', 'For anyone who has gone, this carries the date AND the reason on record together, e.g. "Left 2026-09-02 — Call Avoidance". Where no reason was recorded, only the date shows.'],
    ['Priority', 'Left blank once someone has gone. A priority next to a departure is noise.'],
    ['Layout', 'Column widths, wrapping and column order are yours. The rebuild refreshes numbers and will not move your columns or resize them.'],
    ['Peer median', 'The middle reg ratio among operators who started taking calls the same month. A new operator is compared to other new operators, never to a veteran.'],
    ['Priority', 'Escalate = something clearly changed or they are well behind their peers. Watch = worth a conversation. Strong = doing notably well, worth learning from.'],
    [],
    ['What this does NOT do', ''],
    ['No quality scores', 'This tracker never grades a call. Call quality is a separate job, and the automated scoring is not reviewed by a person.'],
    ['No verdicts', 'Nothing here says an operator is bad. It says what the numbers did. The trainer and the team lead decide what it means.'],
    [],
    ['Known gaps', ''],
    ['Hire date', 'The database only knows when an operator was entered into the system — usually about a week before their class starts. The real hire date is the first day of orientation, and it lives only in the class workbook.'],
    ['Started calls', 'The first day they took a REAL call, meaning after their class ended. Practice calls during training are excluded. Some people are on the schedule the next day, some wait two or three, which is why the 30/60/90 blocks run on each person own clock.'],
    ['Training metrics', 'Completed training, quiz scores and trainee satisfaction come from the class workbook, not the database. Not connected yet.'],

  ];

  // --- Training vs Performance: the two halves side by side ---
  // The database knows what an operator DID. Only the class workbook knows what
  // they looked like beforehand. Forecasting needs both, so here they are joined.
  // Call handling, System nav and Training total are all scored out of 100, so they
  // are shown as percentages like Quiz % beside them. SLI is out of 300 and stays a
  // raw number — a percentage there would be inventing a scale the team does not use.
  const tvp = [[
    'Operator', 'Slack ID', 'Group', 'Lates', 'Absences',
    'Quiz %', 'SLI /300', 'Call handling', 'System nav', 'Training total',
    'Started calls', 'Days on phones',
    ...BLOCKS.flatMap((b) => [`Reg calls ${b.label}`, `Hard regs ${b.label}`, `Reg ratio ${b.label}`]),
    'Priority', 'Status',
  ]];
  const WIDTH = tvp[0].length;
  const banner = (text) => [text, ...Array(WIDTH - 1).fill('')];

  // WHEN WAS THIS LAST REFRESHED — one row, not a column.
  //
  // Vee asked for a "last updated" where "Days lasted" used to be. As a column it
  // would print the same instant on all forty rows, because the whole tab is
  // rewritten in one go. So it goes once, directly under the header, where it is
  // impossible to miss and cannot be mistaken for per-person data.
  //
  // It matters because a run can fail quietly. Without a stamp, last month's numbers
  // and this morning's look identical.
  tvp.push(banner(stamp));

  const perfBySlack = Object.fromEntries(rows.filter((r) => r.o.slackId).map((r) => [r.o.slackId, r]));
  // Separate from `rows`, which stops at 90 days. Someone past the window still needs
  // a row saying why they have no numbers, rather than blank cells that look broken.
  const daysWorkedBySlack = Object.fromEntries(
    operators.filter((o) => o.slackId).map((o) => [o.slackId, daysWorkedOf(o.id)]),
  );
  const agedOut = (t) => {
    const d = t.slackId ? daysWorkedBySlack[t.slackId] : null;
    return d != null && d > TRACK_DAYS;
  };

  /** The date someone left, or null if they are still here. */
  const leftOn = (t) => {
    const o = t.slackId ? bySlack[t.slackId] : null;
    if (o && o.closedAt) return fmtDbDate(o.closedAt).slice(0, 10);
    return t.status !== 'active' ? 'during training' : null;
  };

  const rowFor = (t) => {
    const r = t.slackId ? perfBySlack[t.slackId] : null;
    // A block that has not started yet stays blank. Vee: "I left 60 and 90 blank, we
    // don't need anything there until it's the time." Whether it has started is THIS
    // operator's question — people join the schedule at different speeds after class.
    const cells = [];
    for (const b of BLOCKS) {
      const started = r && r.daysWorked != null && r.daysWorked >= b.from;
      const w = started ? r.a.block[b.label] : null;
      cells.push(w ? w.regCalls : '', w ? w.hardRegs : '', w ? pctStr(ratio(w.hardRegs, w.regCalls)) : '');
    }
    const o = t.slackId ? bySlack[t.slackId] : null;
    const left = leftOn(t);
    return [
      t.name, t.slackId || '(no slack id)', t.group,
      t.lates, t.absences,
      pct100(t.knowledge),
      t.sli || '',
      pct100(t.callHandling),
      pct100(t.sysNav),
      pct100(t.total),
      r && r.first ? fmtDbDate(r.first).slice(0, 10) : (t.status === 'active' ? '(not started)' : ''),
      r && r.daysWorked != null ? r.daysWorked : '',
      ...cells,
      // Priority is about people we are still coaching. Once someone is gone it is
      // noise, and "OK" next to a departure reads badly.
      left ? '' : (r ? r.verdict.level : ''),
      t.status !== 'active'
        ? `${t.status}${t.reason ? ` — ${t.reason}` : ''}`
        // Date and reason together, in one cell. Vee liked seeing "Call Avoidance"
        // and "attendance" on the old Churn Watch, and that tab is gone — so the
        // reason moves onto the person it belongs to instead of being lost.
        : o && o.closedAt
          ? `Left ${fmtDbDate(o.closedAt).slice(0, 10)}${(o.deactivationReason || '').trim() ? ` — ${(o.deactivationReason || '').trim()}` : ''}`
          : agedOut(t)
            ? `Past ${TRACK_DAYS} days — no longer tracked`
            : 'Active',
    ];
  };

  // --- One section per class, newest class on top ------------------------------
  //
  // Vee: "when a new class starts, that new class should be at the top, and then the
  // older class should move at the bottom. And then have a heading that separates
  // them… each class will have its own little thing."
  //
  // So every class gets its own banner, its own people, and its OWN leavers list.
  // September's departures must never sit under August's heading.
  //
  // The banners are generated, not typed in. A heading added by hand would be wiped
  // by the next rebuild, because writing a tab clears its values first.
  const bannerRows = [];
  const classesNewestFirst = [...CLASSES].reverse();

  for (const cls of classesNewestFirst) {
    if (!cls.trainees.length) continue; // no roster, so nobody to list

    const year = cls.meta.classEnd.slice(0, 4);
    const label = `${cls.meta.label || cls.meta.cohort} ${year} CLASS`.toUpperCase();
    bannerRows.push(tvp.length);
    tvp.push(banner(label));

    const members = cls.trainees.map((t) => ({ t, left: leftOn(t) }));

    // Still here: strongest training score first.
    members
      .filter((m) => !m.left)
      .sort((a, b) => b.t.total - a.t.total)
      .forEach((m) => tvp.push(rowFor(m.t)));

    // Gone: most recent departure first, then the people who never finished the class.
    const gone = members.filter((m) => m.left);
    if (gone.length) {
      bannerRows.push(tvp.length);
      tvp.push(banner('NO LONGER AT GOGO'));
      gone
        .sort((a, b) => {
          const ad = a.left === 'during training';
          const bd = b.left === 'during training';
          if (ad !== bd) return ad ? 1 : -1;            // left during training goes last
          if (ad && bd) return b.t.total - a.t.total;   // among those, best score first
          return b.left.localeCompare(a.left);          // otherwise most recent first
        })
        .forEach((m) => tvp.push(rowFor(m.t)));
    }

    tvp.push(banner('')); // a blank line between classes
  }
  if (tvp[tvp.length - 1] && tvp[tvp.length - 1][0] === '') tvp.pop();

  // --- Scorecard: management's own sheet, in management's own shape ------------
  //
  // Vee: "why don't we have the layout the same way as the screenshot... they have
  // July at the top, August at the bottom. Ours will be different — August at the
  // top, and as new months come they'll be at the top instead of the bottom."
  //
  // So this is their sheet, column for column: one goal row across the top, then per
  // class a title, a header row and a single row of figures. Newest class first,
  // which is the one difference from theirs and a deliberate one — the class he is
  // being asked about is the one he just ran.
  //
  // Their date format is kept too ("September 21st", not 2026-09-21). A window that
  // has closed shows the figure; one still running shows the date it closes, exactly
  // as theirs does.
  const CHURN_MONTHS = [1, 2, 3];
  const churnGoal = { 1: 0.05, 2: 0.10, 3: 0.15 };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const ordinal = (d) => {
    if (d > 3 && d < 21) return `${d}th`;
    return `${d}${{ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th'}`;
  };
  /** "2026-09-21" -> "September 21st", matching how their sheet writes dates. */
  const longDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m - 1]} ${ordinal(d)}`;
  };

  const SCORECARD_HEADERS = [
    'New hires', 'Completed Training', '% Completed Training',
    'Trainee Satisfaction Scores', 'Quizzes Sucess Rate',
    '30 day Churn Rate', '60 day Chun Rate', '90 day Churn Rate',
    '90 day reg rate', '90 day star model',
  ];

  const scorecard = [
    // The goal row. First two columns carry no goal on their sheet either.
    ['', '', 'Goal: 90%', 'Goal: 97%', 'Goal: 85%',
     'Goal: Less than 5%', 'Goal: Less than 10%', 'Goal: Less than 15%',
     'Goal: +15%', 'Goal: 3.70+'],
  ];
  // Row kinds are tracked separately because this tab is not one table: a goal row,
  // then a block per class, then notes. Each gets its own colour, all three read back
  // off the sheet after Vee styled it by hand.
  const classRows = [];
  const headerRows = [];
  const sectionRows = [];
  const checks = []; // where our figure disagrees with theirs — shown below, not inline

  for (const cls of [...CLASSES].reverse()) {
    const meta = cls.meta;
    const pub = cls.published;
    const roster = cls.trainees;
    const year = meta.classEnd.slice(0, 4);
    const label = `${meta.label} ${year}`;
    const span = `${longDate(meta.classStart)} - ${longDate(meta.classEnd)}`;
    // If management labels the same class differently, say so on the row itself
    // rather than letting two sheets quietly disagree about which class this is.
    const alias = meta.managementLabel && meta.managementLabel !== meta.label
      ? `   (their sheet calls this row "${meta.managementLabel}")`
      : '';

    classRows.push(scorecard.length);
    scorecard.push([`${label} (${span})${alias}`, ...Array(SCORECARD_HEADERS.length - 1).fill('')]);
    headerRows.push(scorecard.length);
    scorecard.push([...SCORECARD_HEADERS]);

    const publishedChurn = (months) => [null, pub && pub.churn30, pub && pub.churn60, pub && pub.churn90][months];

    const churnCell = (months) => {
      const due = milestoneDate(meta.classEnd, months);
      if (todayISO < due) return longDate(due); // still running — their sheet shows the date
      if (!roster.length) return publishedChurn(months) || longDate(due);

      const gone = leaversOf(cls).filter((l) => l.left <= due);
      const done = roster.filter((t) => t.status === 'active');
      const ours = `${gone.length} (${pctStr(done.length ? gone.length / done.length : null, 2)})`;

      // A closed window is the one place our figure and theirs can silently contradict
      // each other in front of management. We show ours and say so underneath, rather
      // than quietly printing a different number from the sheet they already have.
      const theirs = publishedChurn(months);
      if (theirs && theirs !== ours) {
        checks.push([`${label} ${months * 30} day churn: we compute ${ours} from operator records closed on or before ${due}; their sheet published ${theirs}. If ours reads 0, the people who left were probably never closed out in the system — worth checking before anyone quotes either number.`]);
      }
      return ours;
    };

    if (!roster.length) {
      // Published figures only. Nothing here is ours, and the checks section says so.
      scorecard.push([
        (pub && pub.newHires) || '', (pub && pub.completedTraining) || '',
        (pub && pub.pctCompletedTraining) || '', (pub && pub.traineeSatisfaction) || '',
        (pub && pub.quizSuccessRate) || '',
        churnCell(1), churnCell(2), churnCell(3),
        longDate(milestoneDate(meta.classEnd, 3)), longDate(milestoneDate(meta.classEnd, 3)),
      ]);
      checks.push([`${label}: published figures only. No roster for this class, so nothing in that row is ours or checked. Ask Oscar for the class workbook.`]);
      scorecard.push(Array(SCORECARD_HEADERS.length).fill(''));
      continue;
    }

    const done = roster.filter((t) => t.status === 'active');
    const quizAll = roster.reduce((a, t) => a + t.knowledge, 0) / roster.length;

    // 90 DAY REG RATE — answered by Vee on 2026-09-10: "the whole 90 days".
    //
    // So it is the class's registration ratio across everyone's first 90 days on the
    // phones, not the improvement from month one to month three. Goal is 15%, the same
    // number every operator is measured against individually.
    //
    // The three blocks added together ARE the first 90 days, which is why they are
    // discrete and not cumulative. Blocks that have not started contribute nothing, so
    // before the window closes this is a real running figure rather than a guess.
    let regCalls90 = 0;
    let hardRegs90 = 0;
    for (const t of roster) {
      const r = t.slackId ? perfBySlack[t.slackId] : null;
      if (!r) continue;
      for (const b of BLOCKS) {
        regCalls90 += r.a.block[b.label].regCalls;
        hardRegs90 += r.a.block[b.label].hardRegs;
      }
    }
    const regRate90 = regCalls90 > 0 ? hardRegs90 / regCalls90 : null;
    const regDue = milestoneDate(meta.classEnd, 3);
    const regCell = regRate90 === null
      ? longDate(regDue)
      : todayISO >= regDue
        ? pctStr(regRate90)
        : `${pctStr(regRate90)} so far, closes ${longDate(regDue)}`;
    const sat = roster.filter((t) => t.knowledge > 0);
    const quizSat = sat.length ? sat.reduce((a, t) => a + t.knowledge, 0) / sat.length : null;

    scorecard.push([
      roster.length,
      done.length,
      pctStr(done.length / roster.length, 2),
      (pub && pub.traineeSatisfaction) || 'not in the database',
      pct100(quizAll),
      churnCell(1), churnCell(2), churnCell(3),
      regCell,
      longDate(milestoneDate(meta.classEnd, 3)),
    ]);
    scorecard.push(Array(SCORECARD_HEADERS.length).fill(''));

    // --- the checks, kept out of the table so the table stays their shape ---
    const differs = (ours, theirs) => theirs != null && String(ours) !== String(theirs);
    if (differs(roster.length, pub && pub.newHires)) {
      checks.push([`${label} head count: the class workbook lists ${roster.length} people (no duplicate names, no duplicate Slack IDs); their scorecard says ${pub.newHires}. Their % Completed is exactly ${pub.completedTraining}/${pub.newHires}, so ${pub.newHires} really is their denominator. One person is on the workbook and not on their sheet.`]);
    }
    if (differs(pct100(quizAll), pub && pub.quizSuccessRate)) {
      checks.push([`${label} quiz rate: they publish ${pub.quizSuccessRate}. Averaged across ALL ${roster.length} hires, zeros included, we get ${pct100(quizAll)}. Averaged across only the ${sat.length} who actually sat the quiz we get ${pct100(quizSat)}, which is what theirs matches. August was published the FIRST way. The two classes look to have been graded differently, and it moves the number by about five points.`]);
    }
    if (!(pub && pub.traineeSatisfaction)) {
      checks.push([`${label} trainee satisfaction: comes from a survey of the trainees and lives outside the database. It measures the TRAINER, not the operators. Has to be typed in.`]);
    }
  }
  if (scorecard[scorecard.length - 1].every((c) => c === '')) scorecard.pop();

  scorecard.push(Array(SCORECARD_HEADERS.length).fill(''));
  sectionRows.push(scorecard.length);
  scorecard.push(['Where our figures and theirs disagree', ...Array(SCORECARD_HEADERS.length - 1).fill('')]);
  if (!checks.length) checks.push(['Everything reconciles.']);
  for (const c of checks) scorecard.push([c[0], ...Array(SCORECARD_HEADERS.length - 1).fill('')]);

  scorecard.push(Array(SCORECARD_HEADERS.length).fill(''));
  sectionRows.push(scorecard.length);
  scorecard.push(['Still open', ...Array(SCORECARD_HEADERS.length - 1).fill('')]);
  scorecard.push(['90 day star model: the 3.70 target. Not found in the operator tables so far, and the formula is not written down anywhere we can read. OPS_TASK=star searches the whole database; the definition has to come from Ops.']);

  // Two tabs were removed along the way: "Class Churn" and then "Churn Watch". Both
  // said things the Scorecard and Training vs Performance already say. What each
  // one uniquely held was moved rather than dropped — the churn rate per milestone
  // into the Scorecard, the reason someone was let go onto their own Status cell.

  await writeTab('README', readme, TRACKER_SHEET_ID);
  await writeTab('Scorecard', scorecard, TRACKER_SHEET_ID);
  await writeTab('Training vs Performance', tvp, TRACKER_SHEET_ID, keepTop);
  await writeTab('Hard Regs', regs, TRACKER_SHEET_ID, keepTop);
  await writeTab('Team Leads', leads, TRACKER_SHEET_ID, keepTop);
  await writeTab('Weekly Trend', trend, TRACKER_SHEET_ID, keepTop);

  for (const t of ['README', 'Training vs Performance', 'Hard Regs', 'Team Leads', 'Weekly Trend']) {
    await formatHeader(t, { spreadsheetId: TRACKER_SHEET_ID, bandRows: t !== 'README' }).catch(() => {});
  }

  // Escalate / Watch in red, Strong in green — wherever those words appear.
  await formatBanners('Training vs Performance', bannerRows, { spreadsheetId: TRACKER_SHEET_ID })
    .catch((e) => console.error('[tracker] class banners:', e.message));
  await formatScorecard('Scorecard', {
    goalRow: 0, classRows, headerRows, sectionRows, spreadsheetId: TRACKER_SHEET_ID,
  }).catch((e) => console.error('[tracker] scorecard colours:', e.message));

  // Scorecard first. It is the tab anyone else opens this sheet to look at.
  await moveTab('Scorecard', 0, { spreadsheetId: TRACKER_SHEET_ID })
    .catch((e) => console.error('[tracker] tab order:', e.message));

  for (const t of ['Training vs Performance', 'Hard Regs', 'Team Leads']) {
    await priorityColors(t, { spreadsheetId: TRACKER_SHEET_ID }).catch((e) => console.error(`[tracker] colours on ${t}:`, e.message));
  }

  // While we are connected and it is working, answer the question the flaky link
  // probe keeps failing to answer: can we still READ the transcript tables?
  //
  // The link probe dies at the front door on a bad IP, so it never gets far enough
  // to tell us whether the tables themselves are still readable. This job connects
  // reliably, so it piggybacks the check — one cheap row from each table — and
  // records the answer where we can see it. Costs nothing, and it separates "the
  // IP is flaky" from "our access was taken away", which are very different
  // problems with very different fixes.
  const accessCheck = [['Table', 'Can we still read it?', 'Checked at']];
  for (const t of ['deepgramCalls', 'callLogs', 'callSummary', 'qualityAssurances', 'operatorActivities']) {
    const probe = await tryQ(conn, `SELECT 1 FROM \`${t}\` LIMIT 1`, [], 10_000);
    accessCheck.push([
      t,
      probe.error ? `❌ NO — ${probe.error.slice(0, 160)}` : '✅ yes',
      asOf,
    ]);
  }
  await writeTab('08 Access Check', accessCheck).catch((e) => console.error('[access check] could not write:', e.message));
  await formatHeader('08 Access Check').catch(() => {});

  await conn.end();

  const msg = `📋 Operator tracker updated — ${counts.Escalate || 0} to escalate, ${counts.Watch || 0} to watch, across ${rows.length} active operators.`;
  await notify(msg);
  console.log(msg);
}

main().catch(async (err) => {
  console.error('TRACKER BUILD FAILED:', err.message);
  try {
    if (TRACKER_SHEET_ID) {
      await writeTab('README', [['Status', '❌ FAILED'], ['Error', err.message], ['Run at', nowET()]], TRACKER_SHEET_ID);
    }
  } catch (e) {
    console.error('could not write the failure:', e.message);
  }
  await notify(`❌ Operator tracker build failed: ${err.message}`);
  process.exit(1);
});
