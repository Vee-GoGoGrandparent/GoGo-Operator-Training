// OPS_TASK=tracker
//
// Builds the team-facing tracker: who is registering, who is falling behind, who
// needs a team lead to step in. Writes to the yearly tracker sheets — one per year,
// each showing only its own year's classes (see yearsToWrite) — plus working detail
// on Build Notes, and nowhere else.
//
// What the trainer asked for, in his words: "focus on the hard regs, and who's not
// registering, who could be churn, who could get fired… we're gonna have access to
// be like, hey team leads, you better do your job."
//
// So: numbers say WHO, the trainer decides WHAT to do, team leads do it.
//
// Deliberately NOT here: any quality score. The AI grading is unreviewed and the
// trainer says it is often wrong. Grading is not his job and it is not ours.

import fs from 'node:fs';
import { connect, q, tryQ } from '../src/db.js';
import { logRun } from '../src/run-log.js';
import {
  sheets, writeTab, formatHeader, restyleRows, ruleColors, extendBanding, widenColumns,
  TRACKER_SHEET_ID, TRACKER_SHEETS, trackerSheetFor, easternYear, BUILD_SHEET_ID, BRAND,
} from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate } from '../src/time.js';
import { regCallsOf, ratio, pctStr, pct100, weekKey, priorityOf, TARGET_HR_RATIO } from '../src/analysis.js';
import { loadArchive, isReportAbout } from '../src/op-reports.js';
import {
  CLASSES, TRAINED_SLACK_IDS, TRAINED_WITHOUT_SLACK, TRAINEE_BY_SLACK, earliestGradDate, milestoneDate,
  yearsToWrite,
} from '../data/trained-roster.js';

const RECENT_WEEKS = 4; // the "(4wk)" columns on Team Leads

// REGISTRATIONS COUNT IN CALENDAR MONTHS FROM GRADUATION — Vee, 2026-09-11.
//
// "Count everybody from the twenty first… twenty first is their graduation date…
// from the twenty first of August to the twenty first of September. That's the
// thirty days." Graduation day itself is the first working day (her pick), so:
//
//   August class, graduated Aug 21:  month 1 = Aug 21–Sep 20
//                                    month 2 = Sep 21–Oct 20
//                                    month 3 = Oct 21–Nov 20
//
// This REPLACES the old per-person clock that started at each operator's own first
// call. Anything before graduation is a training call and never counts anywhere.
//
// Months are DISCRETE, not running totals: "reg calls sixty days is the following
// thirty days". A month that has not started yet is blank, never 0 — a zero reads as
// "they registered nothing", a very different thing from "that month has not happened".
const BLOCKS = [
  { label: '30d', month: 1 },
  { label: '60d', month: 2 },
  { label: '90d', month: 3 },
];

// After month 3 a class is done being tracked. Vee: "after ninety days, we're not
// keeping track of anything of any of those… we can drop those people and keep up
// with the current and new people." It leaves Hard Regs, Weekly Trend and Team Leads.
// Training vs Performance and the Scorecard KEEP it, with its final numbers — her
// call on 2026-09-11 — because those are the class's record.

const name = (o) => `${(o.firstName || '').trim()} ${(o.lastName || '').trim()}`.replace(/\s+/g, ' ').trim();
const teamLeadOf = (o) => `${(o.tlFirst || '').trim()} ${(o.tlLast || '').trim()}`.trim();

// ------------------------------------------------------------------- row kinds
//
// Every row written is labelled with what KIND of row it is, and the rows already on
// the tab are sorted into the same kinds. restyleRows (src/sheets.js) then gives each
// row the look Vee gave that kind. That is what stops a banner colour, a merge or a
// hand-coloured number from staying on a row position after the people move.

/** Kinds of the rows already on a per-person tab, read from their text. */
function flatKinds(values) {
  let inGone = false;
  return values.map((r, i) => {
    const a = String(r?.[0] ?? '').trim();
    const empty = !(r ?? []).some((c) => String(c ?? '').trim());
    if (i === 0) return 'header';
    if (/^Last updated/i.test(a)) return 'stamp';
    if (a === 'NO LONGER AT GOGO') { inGone = true; return 'goneBanner'; }
    if (/^[A-Z]+ \d{4} CLASS$/.test(a)) { inGone = false; return 'classBanner'; }
    if (empty) { inGone = false; return 'blank'; }
    return inGone ? 'gone' : 'active';
  });
}

const SECTION_TITLES = ['Where our figures and theirs disagree', 'Still open'];

/** Kinds of the rows already on the Scorecard. */
function scorecardKinds(values) {
  let prev = '';
  let inWho = false;
  return values.map((r, i) => {
    const a = String(r?.[0] ?? '').trim();
    const empty = !(r ?? []).some((c) => String(c ?? '').trim());
    let k;
    if (i === 0) k = 'goal';
    else if (empty) { inWho = false; k = 'blank'; }
    else if (a === 'New hires') k = 'colHeader';
    else if (prev === 'colHeader') k = 'figures';
    else if (a === 'Who left') { inWho = true; k = 'whoLeftHeader'; }
    else if (inWho) k = 'whoLeftRow';
    else if (SECTION_TITLES.includes(a)) k = 'section';
    else if (/^\S+ \d{4} \(/.test(a)) k = 'classTitle';
    else k = 'note';
    prev = k;
    return k;
  });
}

// First-time looks, for a kind a tab has never had. Rows Vee has already styled always
// win over these. Every value was read back off her sheet on 2026-09-11.
const WHITE_BOLD = { bold: true, foregroundColor: BRAND.white };
const BOX = { top: { style: 'SOLID' }, bottom: { style: 'SOLID' }, left: { style: 'SOLID' }, right: { style: 'SOLID' } };
const FLAT_DEFAULTS = {
  header: { textFormat: { ...WHITE_BOLD, fontSize: 10 }, backgroundColor: BRAND.indigo, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' },
  stamp: { textFormat: { italic: true }, verticalAlignment: 'MIDDLE' },
  classBanner: { textFormat: WHITE_BOLD, backgroundColor: BRAND.cornflower, verticalAlignment: 'MIDDLE' },
};
const FLAT_FALLBACK = { gone: 'active', goneBanner: 'classBanner', blank: 'active' };

const SCORECARD_DEFAULTS = {
  goal: { textFormat: WHITE_BOLD, backgroundColor: BRAND.indigo, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' },
  classTitle: { textFormat: WHITE_BOLD, backgroundColor: BRAND.cornflower, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', borders: BOX },
  colHeader: { textFormat: { bold: true, foregroundColor: BRAND.black }, backgroundColor: BRAND.lavender, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', borders: BOX },
  figures: { horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP', borders: BOX },
  section: { textFormat: { bold: true, foregroundColor: BRAND.black }, verticalAlignment: 'MIDDLE', wrapStrategy: 'OVERFLOW_CELL' },
  note: { wrapStrategy: 'WRAP' },
};
const SCORECARD_FALLBACK = { whoLeftHeader: 'colHeader', whoLeftRow: 'figures' };
// The who-left list is new, so its merges are ours: name across A:C, date D:E, window F:J.
const WHO_LEFT_MERGES = [[0, 3], [3, 5], [5, 10]];
const SCORECARD_MERGES = { classTitle: [[0, 10]], note: [[0, 10]], whoLeftHeader: WHO_LEFT_MERGES, whoLeftRow: WHO_LEFT_MERGES };

// Vee: the "Last updated" line is ITALIC, not bold — on every tab that has one.
const italicStamp = (f) => ({ ...f, textFormat: { ...(f.textFormat || {}), italic: true, bold: false } });

// --------------------------------------------------------------------- the data

/**
 * The two database pulls — or, for a LOCAL TEST ONLY, the same shape from a file.
 *
 * The test exists so layout changes can be proved on a copy of the team sheet before
 * they touch the real one. Made-up numbers must never reach the real tracker, so the
 * file route refuses to run on Railway and refuses any sheet not titled "TEST COPY".
 */
async function loadData() {
  const fixture = process.env.OPS_FIXTURE;
  if (fixture) {
    if (Object.keys(process.env).some((k) => k.startsWith('RAILWAY_'))) {
      throw new Error('OPS_FIXTURE is for local tests only and must never be set on Railway.');
    }
    const { data } = await sheets().spreadsheets.get({ spreadsheetId: TRACKER_SHEET_ID, fields: 'properties.title' });
    if (!/^TEST COPY/.test(data.properties.title)) {
      throw new Error(`OPS_FIXTURE refused: "${data.properties.title}" is not a TEST COPY sheet. Made-up numbers never go on the real tracker.`);
    }
    const f = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    const d = (v) => (v ? new Date(v) : null);
    return {
      conn: null,
      operators: f.operators.map((o) => ({ ...o, createdAt: d(o.createdAt), closedAt: d(o.closedAt), suspendedAt: d(o.suspendedAt) })),
      perf: f.perf.map((r) => ({ ...r, aggregationDate: new Date(r.aggregationDate) })),
    };
  }

  const { conn } = await connect();
  // Everyone here went through a class we hold data for. Operators from other
  // departments are deliberately not pulled at all — not fetched and then hidden,
  // never fetched. Closed accounts stay in: churn is the point.
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
  return { conn, operators, perf };
}

async function main() {
  if (!TRACKER_SHEET_ID) {
    throw new Error('OPS_TRACKER_SHEET_ID is not set. The team-facing sheet has nowhere to go.');
  }
  const { conn, operators, perf } = await loadData();

  console.log(`[tracker] ${TRAINED_SLACK_IDS.length} trained operators on the roster, ${operators.length} matched in the database`);
  if (TRAINED_WITHOUT_SLACK.length) {
    console.log(`[tracker] no Slack ID, cannot be joined: ${TRAINED_WITHOUT_SLACK.join(', ')}`);
  }
  console.log(`[tracker] ${perf.length} daily performance rows for our operators`);

  const byId = Object.fromEntries(operators.map((o) => [o.id, o]));
  // Keyed off the FULL roster, not off the people with performance rows. Someone who
  // left before ever registering anything has no performance rows at all — and they
  // are exactly the churn we most need to count.
  const bySlack = Object.fromEntries(operators.filter((o) => o.slackId).map((o) => [o.slackId, o]));
  const traineeOfOp = (o) => (o?.slackId ? TRAINEE_BY_SLACK[o.slackId] : null);

  // aggregationDate is a stored DATE, so it is read back with UTC getters (fmtDbDate)
  // and compared as a plain YYYY-MM-DD. Mixing a stored date against a real instant is
  // the classic way to end up a day out.
  const now = new Date();
  const todayISO = fmtDbDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))).slice(0, 10);
  const isoOf = (d) => fmtDbDate(d).slice(0, 10);
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

  /** Month of the class a day falls in: 0 = still training, 1–3 = the months, null = after month 3. */
  const monthOf = (gradDate, day) => {
    if (day < gradDate) return 0;
    const b = BLOCKS.find((x) => day < milestoneDate(gradDate, x.month));
    return b ? b.month : null;
  };
  const classOver = (gradDate) => todayISO >= milestoneDate(gradDate, 3);

  // ------------------------------------------------------------ aggregate
  // Training calls are dropped outright — not counted anywhere, because the business
  // does not count them either. An operator we cannot place in a class is dropped too:
  // defaulting to "keep" is the wrong default when the question is "is this one of ours".
  const working = perf.filter((r) => {
    const t = traineeOfOp(byId[r.operatorId]);
    return t && monthOf(t.gradDate, isoOf(r.aggregationDate)) !== 0;
  });
  console.log(`[tracker] ${perf.length - working.length} training-period rows excluded, ${working.length} kept`);

  const allWeeks = [...new Set(working.map((r) => weekKey(r.aggregationDate)))].sort();
  const recentWeeks = new Set(allWeeks.slice(-RECENT_WEEKS));

  const agg = {}; // operatorId -> { recent, byWeek, block, plans, first }
  for (const r of working) {
    const t = traineeOfOp(byId[r.operatorId]);
    const day = isoOf(r.aggregationDate);
    const a = (agg[r.operatorId] ??= {
      recent: { regCalls: 0, hardRegs: 0, softRegs: 0, trialRegs: 0 },
      byWeek: {},
      block: { 1: { regCalls: 0, hardRegs: 0 }, 2: { regCalls: 0, hardRegs: 0 }, 3: { regCalls: 0, hardRegs: 0 } },
      plans: { annual: 0, value: 0, basic: 0, fixedIncome: 0 },
      // Since graduation, like the plan columns — Hard Regs dropped its 4-week columns.
      sinceGrad: { softRegs: 0, trialRegs: 0 },
      first: null,
    });
    a.sinceGrad.softRegs += Number(r.softRegs || 0);
    a.sinceGrad.trialRegs += Number(r.trialRegs || 0);
    if (!a.first || day < a.first) a.first = day;

    const calls = regCallsOf(r);
    const hard = Number(r.hardRegs || 0);
    const wk = weekKey(r.aggregationDate);
    if (recentWeeks.has(wk)) {
      a.recent.regCalls += calls;
      a.recent.hardRegs += hard;
      a.recent.softRegs += Number(r.softRegs || 0);
      a.recent.trialRegs += Number(r.trialRegs || 0);
    }
    const w = (a.byWeek[wk] ??= { regCalls: 0, hardRegs: 0 });
    w.regCalls += calls;
    w.hardRegs += hard;

    const m = monthOf(t.gradDate, day);
    if (m) {
      a.block[m].regCalls += calls;
      a.block[m].hardRegs += hard;
    }

    a.plans.annual += Number(r.annualHardRegs || 0);
    a.plans.value += Number(r.valueMonthlyHardRegs || 0);
    a.plans.basic += Number(r.basicMonthlyHardRegs || 0);
    a.plans.fixedIncome += Number(r.fixedIncomeMonthlyHardRegs || 0);
  }

  // -------------------------------------------------------------- per-op rows
  // THE RATIO THAT DECIDES PRIORITY — and the order people are listed in (Vee, 2026-09-11):
  //
  //   - The month of the class they are in right now.
  //   - "When a new month starts, things depend on the previous month's performance,
  //     not the new month. Once the new month has stats, it depends on the new month."
  //     So an empty current month falls back to the month before.
  //   - Once the 3 months are over: all 3 months combined (all hard regs ÷ all reg
  //     calls). She asked to copy management's rule; their star model document only
  //     has weekly figures, so there was no 3-month rule to copy.
  //
  // This replaces a version that used the current month even on its first day. The June
  // class had one day of month 3, so people at 18.9% over four weeks showed "Escalate"
  // on the strength of a handful of calls — while the sheet printed the four-week number
  // beside it. The colour and the number came from two different windows.
  const priorityRatioOf = (a, t) => {
    if (classOver(t.gradDate)) {
      const calls = BLOCKS.reduce((s, b) => s + a.block[b.month].regCalls, 0);
      const hard = BLOCKS.reduce((s, b) => s + a.block[b.month].hardRegs, 0);
      return ratio(hard, calls);
    }
    const m = monthOf(t.gradDate, todayISO);
    if (!m) return null;
    if (a.block[m].regCalls > 0) return ratio(a.block[m].hardRegs, a.block[m].regCalls);
    if (m > 1) return ratio(a.block[m - 1].hardRegs, a.block[m - 1].regCalls);
    return null;
  };

  const rows = [];
  for (const o of operators) {
    const a = agg[o.id];
    const t = traineeOfOp(o);
    if (!a || !t) continue; // no real calls yet
    const daysWorked = daysBetween(a.first, todayISO);
    const priorityRatio = priorityRatioOf(a, t);
    rows.push({
      o, a, t,
      cohort: t.cohort,
      daysWorked,
      weeksActive: Math.floor(daysWorked / 7),
      over: classOver(t.gradDate),
      priorityRatio,
      level: priorityOf(priorityRatio),
    });
  }

  // ORDER: lowest ratio first, the people with no ratio yet after them, and anyone who
  // has left at the very bottom — most recent departure first, because someone gone last
  // week matters more than someone gone three months. Vee: "from lowest score to
  // highest, except those people who have left."
  const closedKey = (r) => (r.o.closedAt ? isoOf(r.o.closedAt) : null);
  rows.sort((x, y) => {
    const cx = closedKey(x);
    const cy = closedKey(y);
    if (!cx !== !cy) return cx ? 1 : -1;
    if (cx && cy && cx !== cy) return cy.localeCompare(cx);
    const px = x.priorityRatio;
    const py = y.priorityRatio;
    if ((px === null) !== (py === null)) return px === null ? 1 : -1;
    return (px ?? 0) - (py ?? 0);
  });
  const tracked = rows.filter((r) => !r.over);
  console.log(`[tracker] ${rows.length} operators with real calls, ${tracked.length} in a class still inside its 3 months`);

  // --------------------------------------------------------------- the tabs
  const asOf = nowET();
  // build-tracker runs as its own process, so it reads the schedule from the
  // environment rather than from the server that spawned it.
  const onASchedule = Boolean(String(process.env.OPS_DAILY ?? '').trim());
  const stamp = `Last updated ${asOf}${onASchedule ? ' · refreshes daily' : ''}`;
  const stampRow = (width) => [stamp, ...Array(Math.max(0, width - 1)).fill('')];

  const trackedAll = tracked;

  /**
   * Build and write ONE year's tracker sheet, with only that year's classes on it.
   * Vee, 2026-09-11: one tracker sheet per year, and a class finishes on its own year's
   * sheet. Which years a run writes is decided by yearsToWrite (data/trained-roster.js).
   *
   * CLASSES, TRACKER_SHEET_ID and tracked deliberately shadow the file-wide names here,
   * so every tab below is built from this year's classes and written to this year's
   * sheet without each line having to know about years.
   */
  const buildYear = async (year, yearClasses, yearSheetId) => {
    const CLASSES = yearClasses;
    const TRACKER_SHEET_ID = yearSheetId;
    const yearCohorts = new Set(CLASSES.map((c) => c.meta.cohort));
    const tracked = trackedAll.filter((r) => yearCohorts.has(r.cohort));

    const classesNewestFirst = [...CLASSES].reverse().filter((c) => c.trainees.length);
    const classBanner = (cls) => `${cls.meta.label || cls.meta.cohort} ${cls.meta.classEnd.slice(0, 4)} CLASS`.toUpperCase();

    /**
     * A per-person tab split by class, newest class on top — the layout Vee built by
     * hand on Hard Regs on 2026-09-11: header, "Last updated", then for each class still
     * inside its 3 months a banner and that class's people, leavers at the bottom of
     * their own class. No blank row between classes, no "NO LONGER AT GOGO" banner.
     */
    const splitByClass = (header, rowOf) => {
      const values = [header, stampRow(header.length)];
      const kinds = ['header', 'stamp'];
      for (const cls of classesNewestFirst) {
        if (classOver(cls.meta.classEnd)) continue;
        const members = tracked.filter((r) => r.cohort === cls.meta.cohort);
        if (!members.length) continue;
        values.push([classBanner(cls), ...Array(header.length - 1).fill('')]);
        kinds.push('classBanner');
        for (const r of members) {
          values.push(rowOf(r));
          kinds.push(r.o.closedAt ? 'gone' : 'active');
        }
      }
      return { values, kinds };
    };

    /** Everyone from one class who completed training and has since been closed, most recent first. */
    const leaversOf = (cls) => cls.trainees
      .filter((t) => t.status === 'active')
      .map((t) => ({ t, o: t.slackId ? bySlack[t.slackId] : null }))
      .filter(({ o }) => o && o.closedAt)
      .map(({ t, o }) => ({ name: t.name, left: isoOf(o.closedAt), reason: (o.deactivationReason || '').trim() }))
      .sort((a, b) => b.left.localeCompare(a.left));

    /**
     * The 30 / 60 / 90 day cells for one operator, the same numbers Training vs
     * Performance shows: a month that has not started is blank, never 0.
     */
    const monthCells = (r, gradDate) => {
      const cells = [];
      let calls3 = 0;
      let hard3 = 0;
      for (const b of BLOCKS) {
        const started = todayISO >= milestoneDate(gradDate, b.month - 1);
        const w = started && r ? r.a.block[b.month] : null;
        if (w) { calls3 += w.regCalls; hard3 += w.hardRegs; }
        cells.push(w ? w.regCalls : '', w ? w.hardRegs : '', w ? pctStr(ratio(w.hardRegs, w.regCalls)) : '');
      }
      return { cells, all3: calls3 > 0 ? pctStr(ratio(hard3, calls3)) : '' };
    };
    const MONTH_HEADERS = BLOCKS.flatMap((b) => [`Reg calls ${b.label}`, `Hard regs ${b.label}`, `Reg ratio ${b.label}`]);

    // --- Hard Regs: the plain numbers, one section per class ---
    // 30 / 60 / 90 day columns replaced the 4-week ones (Vee, 2026-09-11), so the ratio
    // Priority is judged on is actually on the row. Soft regs and Trials count since
    // graduation, like the plan columns beside them.
    const regs = splitByClass([
      'Operator', 'Slack ID', 'Team lead', 'Class', 'Weeks active',
      ...MONTH_HEADERS, 'Reg ratio all 3 months', 'Soft regs', 'Trials',
      'Annual', 'Value', 'Basic', 'Fixed income', 'Priority', 'Status',
    ], (r) => {
      const m = monthCells(r, r.t.gradDate);
      return [
        name(r.o), r.o.slackId || '', teamLeadOf(r.o), r.cohort, r.weeksActive || '',
        ...m.cells, m.all3,
        r.a.sinceGrad.softRegs, r.a.sinceGrad.trialRegs,
        r.a.plans.annual, r.a.plans.value, r.a.plans.basic, r.a.plans.fixedIncome,
        r.level,
        r.o.closedAt ? `Left ${isoOf(r.o.closedAt)}` : r.o.suspendedAt ? 'Suspended' : 'Active',
      ];
    });

    // --- Weekly Trend: the shape of the ramp, week by week, one section per class ---
    // Only weeks in which somebody from a still-tracked class took a real call.
    const weeks = [...new Set(tracked.flatMap((r) => Object.keys(r.a.byWeek)))].sort();
    const trend = splitByClass(['Operator', 'Slack ID', 'Team lead', ...weeks], (r) => [
      name(r.o), r.o.slackId || '', teamLeadOf(r.o),
      ...weeks.map((w) => {
        const wk = r.a.byWeek[w];
        if (!wk || wk.regCalls === 0) return '';
        return pctStr(ratio(wk.hardRegs, wk.regCalls));
      }),
    ]);

    // --- Team Leads: the accountability view ---
    const byTl = {};
    for (const r of tracked) {
      const key = r.o.teamLeadId || '(none)';
      const t = (byTl[key] ??= {
        name: r.o.teamLeadId ? teamLeadOf(r.o) : '(no team lead assigned)',
        ops: 0, escalate: 0, watch: 0, strong: 0, regCalls: 0, hardRegs: 0, names: [],
      });
      t.ops += 1;
      t.regCalls += r.a.recent.regCalls;
      t.hardRegs += r.a.recent.hardRegs;
      if (r.level === 'Escalate') { t.escalate += 1; t.names.push(name(r.o)); }
      if (r.level === 'Watch') t.watch += 1;
      if (r.level === 'Strong') t.strong += 1;
    }
    const leadsHeader = ['Team lead', 'Operators', 'Escalate', 'Watch', 'Strong', 'Reg calls (4wk)', 'Hard regs (4wk)', 'Team reg ratio', 'vs target', 'Who to talk to first'];
    const leads = { values: [leadsHeader, stampRow(leadsHeader.length)], kinds: ['header', 'stamp'] };
    for (const t of Object.values(byTl).sort((a, b) => b.escalate - a.escalate || b.ops - a.ops)) {
      const rr = ratio(t.hardRegs, t.regCalls);
      leads.values.push([
        t.name, t.ops, t.escalate, t.watch, t.strong, t.regCalls, t.hardRegs, pctStr(rr),
        rr === null ? '' : rr >= TARGET_HR_RATIO ? '✅ at or above' : `⚠️ ${pctStr(TARGET_HR_RATIO - rr)} under`,
        t.names.slice(0, 6).join(', '),
      ]);
      leads.kinds.push('active');
    }

    // --- Training vs Performance: the two halves side by side ---
    // The database knows what an operator DID. Only the class workbook knows what they
    // looked like beforehand. Forecasting needs both, so here they are joined.
    // Call handling, System nav and Training total are all scored out of 100, so they
    // are shown as percentages like Quiz % beside them. SLI is out of 300 and stays a
    // raw number — a percentage there would be inventing a scale the team does not use.

    // OP REPORTS per person (Vee, 2026-09-11): reports AND observations together — "notify
    // if any op reports have been filed on a particular op". Counted from graduation. The
    // archive only holds what has been pulled from #op_report, so the header carries its
    // dates; the part in brackets is ignored when matching her column order, so the
    // column stays where she puts it as the dates move.
    const reports = loadArchive();
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const shortDate = (iso) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
    const opReportsHeader = reports.length
      ? `Op reports (${shortDate(reports[0].date)} to ${shortDate(reports[reports.length - 1].date)})`
      : 'Op reports';
    const opReportsFor = (t) => reports.filter((r) => r.date >= t.gradDate && isReportAbout(t.name, r.contractor));

    const tvpHeader = [
      'Operator', 'Slack ID', 'Group', 'Lates', 'Absences',
      'Quiz %', 'SLI /300', 'Call handling', 'System nav', 'Training total',
      'Started calls', 'Days on phones',
      ...BLOCKS.flatMap((b) => [`Reg calls ${b.label}`, `Hard regs ${b.label}`, `Reg ratio ${b.label}`]),
      'Priority', 'Status',
      // Vee: "a reg ratio for all the three months, not just the thirty days on that
      // third month". New columns land on the right; she can move them and they stay.
      'Reg ratio all 3 months', opReportsHeader,
    ];
    const WIDTH = tvpHeader.length;
    const banner = (text) => [text, ...Array(WIDTH - 1).fill('')];
    const tvp = { values: [tvpHeader, banner(stamp)], kinds: ['header', 'stamp'] };

    const perfBySlack = Object.fromEntries(rows.filter((r) => r.o.slackId).map((r) => [r.o.slackId, r]));

    /** The date someone left, or null if they are still here. */
    const leftOn = (t) => {
      const o = t.slackId ? bySlack[t.slackId] : null;
      if (o && o.closedAt) return isoOf(o.closedAt);
      return t.status !== 'active' ? 'during training' : null;
    };

    const rowFor = (t) => {
      const r = t.slackId ? perfBySlack[t.slackId] : null;
      // The same month cells as Hard Regs, from the same function, so the two tabs can
      // never show different numbers for one person.
      const { cells, all3 } = monthCells(r, t.gradDate);
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
        r && r.a.first ? r.a.first : (t.status === 'active' ? '(not started)' : ''),
        r && r.daysWorked != null ? r.daysWorked : '',
        ...cells,
        // Priority is about people we are still coaching. Once someone is gone it is
        // noise, and "OK" next to a departure reads badly.
        left ? '' : (r ? r.level : ''),
        t.status !== 'active'
          ? `${t.status}${t.reason ? ` — ${t.reason}` : ''}`
          : o && o.closedAt
            ? `Left ${isoOf(o.closedAt)}${(o.deactivationReason || '').trim() ? ` — ${(o.deactivationReason || '').trim()}` : ''}`
            : classOver(t.gradDate)
              ? 'Past 90 days — no longer tracked'
              : 'Active',
        all3,
        t.status === 'active' ? opReportsFor(t).length : '',
      ];
    };

    // One section per class, newest class on top, each with its OWN leavers list —
    // September's departures must never sit under August's heading.
    // A class workbook row does not carry its graduation date — the class does.
    const withClass = (cls) => cls.trainees.map((t) => ({ ...t, cohort: cls.meta.cohort, gradDate: cls.meta.classEnd }));

    for (const cls of classesNewestFirst) {
      tvp.values.push(banner(classBanner(cls)));
      tvp.kinds.push('classBanner');

      const members = withClass(cls).map((t) => ({ t, left: leftOn(t) }));
      // Still here: LOWEST ratio first (Vee, 2026-09-11) — "that way we know who are the
      // people we need to talk to" at the start of the month. Same ratio as Priority and
      // the same order as Hard Regs. Anyone with no ratio yet goes after them. This
      // replaces "best training total first".
      const ratioOf = (t) => (t.slackId ? perfBySlack[t.slackId]?.priorityRatio ?? null : null);
      members
        .filter((m) => !m.left)
        .sort((a, b) => {
          const x = ratioOf(a.t);
          const y = ratioOf(b.t);
          if ((x === null) !== (y === null)) return x === null ? 1 : -1;
          return (x ?? 0) - (y ?? 0);
        })
        .forEach((m) => { tvp.values.push(rowFor(m.t)); tvp.kinds.push('active'); });

      // Gone: most recent departure first, then the people who never finished the class.
      const gone = members.filter((m) => m.left);
      if (gone.length) {
        tvp.values.push(banner('NO LONGER AT GOGO'));
        tvp.kinds.push('goneBanner');
        gone
          .sort((a, b) => {
            const ad = a.left === 'during training';
            const bd = b.left === 'during training';
            if (ad !== bd) return ad ? 1 : -1;
            if (ad && bd) return b.t.total - a.t.total;
            return b.left.localeCompare(a.left);
          })
          .forEach((m) => { tvp.values.push(rowFor(m.t)); tvp.kinds.push('gone'); });
      }

      tvp.values.push(banner(''));
      tvp.kinds.push('blank');
    }
    if (tvp.kinds[tvp.kinds.length - 1] === 'blank') { tvp.values.pop(); tvp.kinds.pop(); }

    // --- Scorecard: management's own sheet, in management's own shape ------------
    //
    // Their sheet, column for column: one goal row across the top, then per class a
    // title, a header row and a single row of figures. Newest class first — the one
    // deliberate difference from theirs. Under each class, WHO left and WHEN (Vee,
    // 2026-09-11), so the churn number can be checked against real people.
    //
    // Their date format is kept too ("September 21st", not 2026-09-21). A window that
    // has closed shows the figure; one still running shows the date it closes.
    const CHURN_MONTHS = [1, 2, 3];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    const ordinal = (d) => {
      if (d > 3 && d < 21) return `${d}th`;
      return `${d}${{ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th'}`;
    };
    /** "2026-09-21" -> "September 21st", matching how their sheet writes dates. */
    const longDate = (iso) => {
      const [, m, d] = iso.split('-').map(Number);
      return `${MONTHS[m - 1]} ${ordinal(d)}`;
    };

    const SCORECARD_HEADERS = [
      'New hires', 'Completed Training', '% Completed Training',
      'Trainee Satisfaction Scores', 'Quizzes Sucess Rate',
      '30 day Churn Rate', '60 day Chun Rate', '90 day Churn Rate',
      '90 day reg rate', '90 day star model',
    ];
    const SW = SCORECARD_HEADERS.length;
    const sc = { values: [], kinds: [] };
    const addSc = (kind, cells) => { sc.values.push([...cells, ...Array(Math.max(0, SW - cells.length)).fill('')]); sc.kinds.push(kind); };

    addSc('goal', ['', '', 'Goal: 90%', 'Goal: 97%', 'Goal: 85%',
      'Goal: Less than 5%', 'Goal: Less than 10%', 'Goal: Less than 15%',
      'Goal: +15%', 'Goal: 3.70+']);
    const checks = []; // where our figure disagrees with theirs — shown below, not inline

    // CHURN COUNTS FROM THE FIRST DAY OF TRAINING — Vee, 2026-09-11, and it reproduces
    // management's June figure exactly. Someone who STARTED training and then left
    // counts: "Jessa Mae Odac, training total 26.07%, and Jovin Laud, 10%… so that's how
    // you determine." A 0% training total means they never started, so they do not
    // count (Fernando Pazzetti, Daniel Mendoza; and in August, by her ruling, Ezra Pagtan
    // and Laurence Sindol). June: Jessa + Jovin + Oliver Castaneda (closed Jul 22) = 3.
    //
    // The windows still CLOSE at graduation + 1, 2 and 3 calendar months, because those
    // are the due dates their sheet prints (July class: Sep 10, Oct 10).
    //
    // CUMULATIVE, unlike the registration months: the 60 day figure includes the 30 day
    // people. Denominator is who COMPLETED training — 3 of their 46 is 6.52%, exactly
    // what they publish.
    const startedTraining = (t) => Number(t.total) > 0;

    for (const cls of [...CLASSES].reverse()) {
      const meta = cls.meta;
      const pub = cls.published;
      const roster = cls.trainees;
      const label = `${meta.label} ${meta.classEnd.slice(0, 4)}`;
      const span = `${longDate(meta.classStart)} - ${longDate(meta.classEnd)}`;
      // If management labels the same class differently, say so on the row itself
      // rather than letting two sheets quietly disagree about which class this is.
      const alias = meta.managementLabel && meta.managementLabel !== meta.label
        ? `   (their sheet calls this row "${meta.managementLabel}")`
        : '';

      addSc('classTitle', [`${label} (${span})${alias}`]);
      addSc('colHeader', SCORECARD_HEADERS);

      const publishedChurn = (months) => [null, pub && pub.churn30, pub && pub.churn60, pub && pub.churn90][months];
      const done = roster.filter((t) => t.status === 'active');
      const countedInTraining = roster.filter((t) => t.status !== 'active' && startedTraining(t));
      const gone = leaversOf(cls);

      const churnCell = (months) => {
        const due = milestoneDate(meta.classEnd, months);
        if (todayISO < due) return longDate(due); // still running — their sheet shows the date
        if (!roster.length) return publishedChurn(months) || longDate(due);
        const n = countedInTraining.length + gone.filter((l) => l.left <= due).length;
        const ours = `${n} (${pctStr(done.length ? n / done.length : null, 2)})`;
        const theirs = publishedChurn(months);
        if (theirs && theirs !== ours) {
          checks.push(parseInt(theirs, 10) === n
            ? `${label} ${months * 30} day churn: the same ${n} people as their sheet. Theirs reads ${theirs} and ours ${ours} only because the class workbook has ${done.length} people who completed training and their sheet has ${pub.completedTraining}.`
            : `${label} ${months * 30} day churn: we count ${ours}, their sheet published ${theirs}. Who we counted, and when they left, is listed under the class above.`);
        }
        return ours;
      };

      if (!roster.length) {
        // Published figures only. Nothing here is ours, and the checks section says so.
        addSc('figures', [
          (pub && pub.newHires) || '', (pub && pub.completedTraining) || '',
          (pub && pub.pctCompletedTraining) || '', (pub && pub.traineeSatisfaction) || '',
          (pub && pub.quizSuccessRate) || '',
          churnCell(1), churnCell(2), churnCell(3),
          longDate(milestoneDate(meta.classEnd, 3)), longDate(milestoneDate(meta.classEnd, 3)),
        ]);
        checks.push(`${label}: published figures only. No roster for this class, so nothing in that row is ours or checked. Ask Oscar for the class workbook.`);
        addSc('blank', []);
        continue;
      }

      const quizAll = roster.reduce((a, t) => a + t.knowledge, 0) / roster.length;

      // 90 DAY REG RATE — "the whole 90 days" (Vee, 2026-09-10): the class's registration
      // ratio across its three months, goal 15%. Months that have not started add
      // nothing, so before the window closes this is a real running figure.
      let regCalls90 = 0;
      let hardRegs90 = 0;
      for (const t of roster) {
        const r = t.slackId ? perfBySlack[t.slackId] : null;
        if (!r) continue;
        for (const b of BLOCKS) {
          regCalls90 += r.a.block[b.month].regCalls;
          hardRegs90 += r.a.block[b.month].hardRegs;
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

      addSc('figures', [
        roster.length,
        done.length,
        pctStr(done.length / roster.length, 2),
        (pub && pub.traineeSatisfaction) || 'not in the database',
        pct100(quizAll),
        churnCell(1), churnCell(2), churnCell(3),
        regCell,
        longDate(milestoneDate(meta.classEnd, 3)),
      ]);

      // WHO LEFT, AND WHICH CHURN WINDOW THEY LAND IN.
      const windowOf = (day) => {
        const m = CHURN_MONTHS.find((k) => day <= milestoneDate(meta.classEnd, k));
        return m ? `${m * 30} day churn` : 'After 90 days, not counted';
      };
      const whoLeft = [
        ...roster.filter((t) => t.status !== 'active').map((t) => ({
          name: t.name,
          when: 'During training',
          counts: startedTraining(t) ? '30 day churn' : 'Not counted, never started training',
          sort: startedTraining(t) ? '0' : '3',
        })),
        ...gone.map((l) => ({ name: l.name, when: longDate(l.left), counts: windowOf(l.left), sort: `1${l.left}` })),
      ].sort((a, b) => a.sort.localeCompare(b.sort));
      if (whoLeft.length) {
        addSc('whoLeftHeader', ['Who left', '', '', 'Left', '', 'Counts toward']);
        for (const w of whoLeft) addSc('whoLeftRow', [w.name, '', '', w.when, '', w.counts]);
      }
      addSc('blank', []);

      // --- the checks, kept out of the table so the table stays their shape ---
      const differs = (ours, theirs) => theirs != null && String(ours) !== String(theirs);
      if (differs(roster.length, pub && pub.newHires)) {
        checks.push(`${label} head count: the class workbook lists ${roster.length} people (no duplicate names, no duplicate Slack IDs); their scorecard says ${pub.newHires}. Their % Completed is exactly ${pub.completedTraining}/${pub.newHires}, so ${pub.newHires} really is their denominator. One person is on the workbook and not on their sheet.`);
      }
      if (differs(pct100(quizAll), pub && pub.quizSuccessRate)) {
        checks.push(`${label} quiz rate: they publish ${pub.quizSuccessRate}. Averaged across ALL ${roster.length} hires, zeros included, we get ${pct100(quizAll)}. Averaged across only the ${sat.length} who actually sat the quiz we get ${pct100(quizSat)}, which is what theirs matches. August was published the FIRST way. The two classes look to have been graded differently, and it moves the number by about five points.`);
      }
      if (!(pub && pub.traineeSatisfaction)) {
        checks.push(`${label} trainee satisfaction: comes from a survey of the trainees and lives outside the database. It measures the TRAINER, not the operators. Has to be typed in.`);
      }
    }
    if (sc.kinds[sc.kinds.length - 1] === 'blank') { sc.values.pop(); sc.kinds.pop(); }

    addSc('blank', []);
    addSc('section', ['Where our figures and theirs disagree']);
    if (!checks.length) checks.push('Everything reconciles.');
    for (const c of checks) addSc('note', [c]);

    addSc('blank', []);
    addSc('section', ['Still open']);
    addSc('note', ['90 day star model: Ops gave the weighting on 2026-09-11 (9 parts, 5 points a week, each part all or nothing that week; the 90 day figure is the average week, goal 3.70). Not calculated yet. HR ratio and op reports are already tracked; where the other 7 parts live in the database still has to be found.']);

    // ------------------------------------------------------------------ write
    /**
     * Write one tab, then give every row its kind's look, stretch the banding over any
     * new rows or columns, and put the colour rules on.
     *
     * keepColumnOrderFromRow: these tabs get rearranged by hand, so the rebuild writes
     * columns in whatever order the tab already has rather than forcing its own.
     */
    const publish = async (title, { values, kinds }, {
      classify = flatKinds, defaults = FLAT_DEFAULTS, fallback = FLAT_FALLBACK, merges = {},
      writeOpts = { keepColumnOrderFromRow: 0 }, banding = true, colours = false,
    } = {}) => {
      // unmergeFirst: merges come apart BEFORE the values go in — Google throws away
      // anything written into the hidden part of a merged cell. restyleRows puts the
      // right merges back on the right rows, copying from the merges seen before the run.
      const info = await writeTab(title, values, TRACKER_SHEET_ID, { readOld: true, unmergeFirst: true, ...writeOpts });
      if (info.created && banding) await formatHeader(title, { spreadsheetId: TRACKER_SHEET_ID, bandRows: true });
      await restyleRows(title, {
        spreadsheetId: TRACKER_SHEET_ID,
        oldKinds: info.created ? [] : classify(info.oldValues),
        oldMerges: info.merges,
        newKinds: kinds,
        width: info.width,
        newColsFrom: !info.created && info.prevWidth > 0 && info.width > info.prevWidth ? info.prevWidth : null,
        defaults, fallback, mergesByKind: merges,
        adjust: { stamp: italicStamp },
        // A blank new-year sheet has no rows to copy a look from; last year's sheet does.
        templateFrom: TRACKER_SHEETS[year - 1] ? { spreadsheetId: TRACKER_SHEETS[year - 1], classify } : null,
      });
      if (banding) await extendBanding(title, { spreadsheetId: TRACKER_SHEET_ID, rows: values.length, cols: info.width });
      if (colours) await ruleColors(title, { spreadsheetId: TRACKER_SHEET_ID, ratioHeader: /^reg ratio/i, header: info.header });
    };

    await publish('Scorecard', sc, {
      classify: scorecardKinds, defaults: SCORECARD_DEFAULTS, fallback: SCORECARD_FALLBACK,
      merges: SCORECARD_MERGES, writeOpts: {}, banding: false,
    });
    await publish('Training vs Performance', tvp, { colours: true });
    // One-time, and a no-op after that: turn the three 4-week columns into the 30 / 60 / 90
    // day columns IN PLACE, so every column after them keeps Vee's width and look.
    await widenColumns('Hard Regs', {
      spreadsheetId: TRACKER_SHEET_ID,
      from: ['Reg calls (4wk)', 'Hard regs (4wk)', 'Reg ratio (4wk)'],
      to: [...MONTH_HEADERS, 'Reg ratio all 3 months'],
    });
    await publish('Hard Regs', regs, { colours: true });
    await publish('Team Leads', leads, { colours: true });
    await publish('Weekly Trend', trend, { writeOpts: { keepColumnOrderFromRow: 0, freeOrder: /^\d{4}-W\d{2}$/ } });
  };

  // --- Which yearly sheet(s) this run writes --------------------------------------
  // Usually just this year's. In January–March it can also be last year's, while a class
  // that graduated late last year finishes its 3 months there.
  const currentYear = easternYear();
  const yearsWritten = yearsToWrite(CLASSES, todayISO, currentYear);
  for (const year of yearsWritten) {
    const yearSheetId = trackerSheetFor(year);
    if (process.env.OPS_FIXTURE) {
      const { data } = await sheets().spreadsheets.get({ spreadsheetId: yearSheetId, fields: 'properties.title' });
      if (!/^TEST COPY/.test(data.properties.title)) {
        throw new Error(`OPS_FIXTURE refused: the ${year} sheet "${data.properties.title}" is not a TEST COPY. Made-up numbers never go on a real tracker.`);
      }
    }
    await buildYear(year, CLASSES.filter((c) => Number(c.meta.classStart.slice(0, 4)) === year), yearSheetId);
    console.log(`[tracker] wrote the ${year} tracker sheet`);
  }
  if (!yearsWritten.length) console.log(`[tracker] no yearly sheet has a class to show on ${todayISO} — nothing written`);

  // The tab order is Vee's — Run Log first, Scorecard second. Nothing here moves tabs.

  // --- Build Notes: every op report matched to a class operator, all years -------
  // Everything gathered goes to Build Notes; the team sheet only gets the count.
  const reportsAll = loadArchive();
  const matched = [];
  for (const cls of [...CLASSES].reverse().filter((c) => c.trainees.length)) {
    for (const t of cls.trainees.map((x) => ({ ...x, cohort: cls.meta.cohort, gradDate: cls.meta.classEnd }))) {
      for (const r of reportsAll) if (isReportAbout(t.name, r.contractor)) matched.push({ cls, t, r });
    }
  }
  const perReport = new Map();
  for (const m of matched) perReport.set(m.r.ts, (perReport.get(m.r.ts) || 0) + 1);
  const doubles = [...perReport.values()].filter((n) => n > 1).length;
  const detail = [
    ['Class', 'Operator (class workbook)', 'Name on the report', 'Date', 'Type', 'CallLog ID', 'Reporter', 'Team lead on the report', 'Counted on the tracker?'],
    [`Last updated ${asOf}. ${matched.length} reports matched to ${new Set(matched.map((m) => m.t.name)).size} class operators on first AND last name. Reports matching two people: ${doubles}. The tracker column counts reports and observations together, from graduation.`],
    ...matched.map(({ cls, t, r }) => [
      `${cls.meta.label} ${cls.meta.classEnd.slice(0, 4)}`, t.name, r.contractor, r.date, r.type, r.callLogId || '', r.reporter || '', r.lead || '',
      t.status !== 'active' ? 'no, left during training' : r.date < t.gradDate ? 'no, before graduation' : 'yes',
    ]),
  ];
  const detailInfo = await writeTab('13 Op Reports — Class Operators', detail, BUILD_SHEET_ID, { keepColumnOrderFromRow: 0 });
  if (detailInfo.created) await formatHeader('13 Op Reports — Class Operators', { bandRows: true, spreadsheetId: BUILD_SHEET_ID }).catch(() => {});

  // While we are connected and it is working, answer the question the flaky link
  // probe keeps failing to answer: can we still READ the transcript tables? It
  // separates "the IP is flaky" from "our access was taken away".
  if (conn) {
    const accessCheck = [['Table', 'Can we still read it?', 'Checked at']];
    for (const t of ['deepgramCalls', 'callLogs', 'callSummary', 'qualityAssurances', 'operatorActivities']) {
      const probe = await tryQ(conn, `SELECT 1 FROM \`${t}\` LIMIT 1`, [], 10_000);
      accessCheck.push([t, probe.error ? `❌ NO — ${probe.error.slice(0, 160)}` : '✅ yes', asOf]);
    }
    // Every yearly tracker sheet set in Railway: can the bot open it, and is it the sheet
    // it claims to be? A typo in OPS_TRACKER_SHEET_ID_2027 shows up here the next day, not
    // on the first run of January.
    for (const [year, sid] of Object.entries(TRACKER_SHEETS)) {
      const title = await sheets().spreadsheets.get({ spreadsheetId: sid, fields: 'properties.title' })
        .then((res) => res.data.properties.title)
        .catch((e) => ({ error: e.message }));
      accessCheck.push([
        `Tracker sheet ${year}`,
        typeof title === 'string'
          ? `✅ opens: "${title}"${Number(year) === 2026 || title.includes(`(${year})`) ? '' : ` — ⚠️ the title does not say (${year})`}`
          : `❌ cannot open — ${String(title.error).slice(0, 160)}`,
        asOf,
      ]);
    }
    await writeTab('08 Access Check', accessCheck).catch((e) => console.error('[access check] could not write:', e.message));
    await conn.end();
  }

  const counts = tracked.reduce((m, r) => ({ ...m, [r.level]: (m[r.level] || 0) + 1 }), {});
  const msg = `📋 Operator tracker updated — ${counts.Escalate || 0} to escalate, ${counts.Watch || 0} to watch, across ${tracked.length} operators.`;
  await notify(msg);
  console.log(msg);

  // LOGGED LAST, on purpose: the run log should only claim success once there is
  // nothing left that can fail.
  await logRun({
    status: '✅ OK',
    detail: `${tracked.length} operators. Sheet${yearsWritten.length === 1 ? '' : 's'} written: ${yearsWritten.join(', ') || 'none'}.${conn ? ' This address reached the database, so it is on the allowlist.' : ' LOCAL TEST with made-up numbers.'}`,
  });
}

main().catch(async (err) => {
  console.error('TRACKER BUILD FAILED:', err.message);
  // The Run Log carries the failure — always on Build Notes, and on the team sheet's
  // "Run Log" tab when this is the real Railway job.
  await logRun({ status: '❌ FAILED', detail: err.message }).catch(() => {});
  await notify(`❌ Operator tracker build failed: ${err.message}`);
  process.exit(1);
});
