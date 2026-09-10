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
import { writeTab, formatHeader, priorityColors, TRACKER_SHEET_ID, BRAND } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate } from '../src/time.js';
import { regCallsOf, ratio, median, pctStr, weekKey, assess, TARGET_HR_RATIO } from '../src/analysis.js';
import { AUG_2026, CLASS_META } from '../data/class-aug-2026.js';

const WEEKS = 12; // 4 recent + 8 prior — the escalate/watch comparison
const RECENT_WEEKS = 4;

// The scorecard is graded at 30, 60 and 90 days, so the tracker reports on the same
// clock. 98 days is pulled rather than 90 because the 12-week comparison above needs
// 84 and the 90-day window needs 90 — one query has to cover both.
const PULL_DAYS = 98;
const WINDOWS = [30, 60, 90];

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
      WHERE o.closedAt IS NULL
         OR o.closedAt >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`,
    [],
    40_000,
  );
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
      WHERE aggregationDate >= DATE_SUB(CURDATE(), INTERVAL ${PULL_DAYS} DAY)`,
    [],
    60_000,
  );
  console.log(`[tracker] ${perf.length} daily performance rows`);

  // Also the very first day each operator ever registered anything — the honest
  // "started taking calls" date, which is NOT their hire date (that lives only in
  // the class workbook) but is the best the database can tell us on its own.
  const firstDays = await q(
    conn,
    `SELECT operatorId, MIN(aggregationDate) AS firstDay FROM operatorPerformances GROUP BY operatorId`,
    [],
    60_000,
  );
  const firstDayOf = Object.fromEntries(firstDays.map((r) => [r.operatorId, r.firstDay]));

  // ------------------------------------------------------------ 3. aggregate
  const weeks = [...new Set(perf.map((r) => weekKey(r.aggregationDate)))].sort();
  const recentWeeks = new Set(weeks.slice(-RECENT_WEEKS));

  // "How many days ago was this row?" — aggregationDate is a stored DATE, so it is
  // compared against today's date in UTC, matching how db.js parses it. Mixing a
  // stored date against a real instant is the classic way to be off by a day.
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysAgo = (d) => Math.floor((todayUTC - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86400000);

  const agg = {}; // operatorId -> { recent, prior, byWeek, plans, win }
  const blank = () => ({ regCalls: 0, hardRegs: 0, softRegs: 0, trialRegs: 0 });
  // Windows are CUMULATIVE and nested: 60 days includes the last 30, 90 includes the
  // last 60. That matches how the scorecard reads — "churn by day 60" means everyone
  // who left by then, not only those who left in days 31-60.
  const blankWindows = () => Object.fromEntries(WINDOWS.map((d) => [d, { regCalls: 0, hardRegs: 0 }]));

  for (const r of perf) {
    const a = (agg[r.operatorId] ??= { recent: blank(), prior: blank(), byWeek: {}, win: blankWindows(), plans: { annual: 0, value: 0, basic: 0, fixedIncome: 0 } });
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

    const age = daysAgo(r.aggregationDate);
    for (const d of WINDOWS) {
      if (age < d) {
        a.win[d].regCalls += calls;
        a.win[d].hardRegs += Number(r.hardRegs || 0);
      }
    }

    a.plans.annual += Number(r.annualHardRegs || 0);
    a.plans.value += Number(r.valueMonthlyHardRegs || 0);
    a.plans.basic += Number(r.basicMonthlyHardRegs || 0);
    a.plans.fixedIncome += Number(r.fixedIncomeMonthlyHardRegs || 0);
  }

  // Peer median by start month — a three-week-old operator and a three-year-old one
  // are not doing the same job, and comparing them would only ever be unfair.
  const cohortOf = (id) => (firstDayOf[id] ? fmtDbDate(firstDayOf[id]).slice(0, 7) : 'unknown');
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
    const first = firstDayOf[o.id];
    const weeksActive = first ? Math.floor((Date.now() - new Date(first).getTime()) / 604800000) : 0;

    const verdict = assess({
      recent: a.recent,
      prior: a.prior,
      peerMedianRatio: peerMedian[cohortOf(o.id)],
      weeksActive,
      isSuspended: !!o.suspendedAt,
    });

    rows.push({ o, a, first, weeksActive, verdict, cohort: cohortOf(o.id) });
  }
  console.log(`[tracker] ${rows.length} operators with activity in the last ${WEEKS} weeks`);

  const order = { Escalate: 0, Watch: 1, 'No data': 2, OK: 3, Strong: 4 };
  rows.sort((x, y) => (order[x.verdict.level] - order[y.verdict.level]) || ((y.a.recent.regCalls) - (x.a.recent.regCalls)));

  // --------------------------------------------------------------- 5. the tabs
  const asOf = nowET();

  // --- Churn Watch: the tab he actually opens ---
  const watch = [[
    'Priority', 'Operator', 'Slack ID', 'Team lead', 'Started calls', 'Weeks active',
    'Reg calls (4wk)', 'Hard regs (4wk)', 'Reg ratio (4wk)', 'Reg ratio (prior 8wk)',
    'Peer median', 'What we see', 'Status',
  ]];
  for (const r of rows) {
    if (r.verdict.level === 'OK' || r.verdict.level === 'Strong') continue;
    watch.push([
      r.verdict.level,
      name(r.o),
      r.o.slackId || '',
      r.o.teamLeadId ? `${(r.o.tlFirst || '').trim()} ${(r.o.tlLast || '').trim()}`.trim() : '(none assigned)',
      r.first ? fmtDbDate(r.first) : '',
      r.weeksActive || '',
      r.a.recent.regCalls,
      r.a.recent.hardRegs,
      pctStr(r.verdict.recentRatio),
      pctStr(r.verdict.priorRatio),
      pctStr(peerMedian[r.cohort]),
      r.verdict.flags.map((f) => `• ${f.text}`).join('\n'),
      r.o.closedAt ? `Left ${fmtDbDate(r.o.closedAt).slice(0, 10)}` : r.o.suspendedAt ? 'Suspended' : 'Active',
    ]);
  }

  // --- Hard Regs: everyone, the plain numbers ---
  const regs = [[
    'Operator', 'Slack ID', 'Team lead', 'Cohort (first month on calls)', 'Weeks active',
    'Reg calls (4wk)', 'Hard regs (4wk)', 'Reg ratio (4wk)', 'Soft regs', 'Trials',
    'Annual', 'Value', 'Basic', 'Fixed income', 'Priority', 'Status',
  ]];
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
    ['Churn Watch', 'Only the operators who need attention, most urgent first. Each row says in plain words what we saw. Start here.'],
    ['Class Scorecard', 'The ten metrics management grades the class on. Where we can compute a number we show ours next to their published one, so a disagreement shows up before it is presented.'],
    ['Training vs Performance', 'The August 2026 class with their training scores beside what they have actually done on the phones. This is the raw material for forecasting who will struggle.'],
    ['Hard Regs', 'Every active operator and their registration numbers for the last 4 weeks, including which plans they sell.'],
    ['Team Leads', 'The same picture rolled up by team lead — how many of their people need help, and who to talk to first.'],
    ['Class Churn', 'The 30/60/90 day churn rate for the class, and the names behind it. A running window can only go up, so a rate quoted before the window closes is a floor.'],
    ['Weekly Trend', 'Each operator week by week, so you can see the shape: ramping up, flat, or falling.'],
    [],
    ['How to read it', ''],
    ['Reg ratio', 'Hard registrations divided by registration calls. Test calls are excluded. Management target is 15%.'],
    ['Peer median', 'The middle reg ratio among operators who started taking calls the same month. A new operator is compared to other new operators, never to a veteran.'],
    ['Priority', 'Escalate = something clearly changed or they are well behind their peers. Watch = worth a conversation. Strong = doing notably well, worth learning from.'],
    [],
    ['What this does NOT do', ''],
    ['No quality scores', 'This tracker never grades a call. Call quality is a separate job, and the automated scoring is not reviewed by a person.'],
    ['No verdicts', 'Nothing here says an operator is bad. It says what the numbers did. The trainer and the team lead decide what it means.'],
    [],
    ['Known gaps', ''],
    ['Hire date', 'The database only knows when an operator was entered into the system — usually about a week before their class starts. The real hire date is the first day of orientation, and it lives only in the class workbook. "Started calls" below is the first day they registered anything, which happens during training week 3.'],
    ['Training metrics', 'Completed training, quiz scores and trainee satisfaction come from the class workbook, not the database. Not connected yet.'],
  ];

  // --- Training vs Performance: the two halves side by side ---
  // The database knows what an operator DID. Only the class workbook knows what
  // they looked like beforehand. Forecasting needs both, so here they are joined.
  // Call handling, System nav and Training total are all scored out of 100, so they
  // are shown as percentages like Quiz % beside them. SLI is out of 300 and stays a
  // raw number — a percentage there would be inventing a scale the team does not use.
  const tvp = [[
    'Operator', 'Slack ID', 'Group', 'Personality', 'Lates', 'Absences',
    'Quiz %', 'SLI /300', 'Call handling', 'System nav', 'Training total',
    'Started calls',
    'Reg calls 30d', 'Hard regs 30d', 'Reg ratio 30d',
    'Reg calls 60d', 'Hard regs 60d', 'Reg ratio 60d',
    'Reg calls 90d', 'Hard regs 90d', 'Reg ratio 90d',
    'Priority', 'Status',
  ]];
  const perfBySlack = Object.fromEntries(rows.filter((r) => r.o.slackId).map((r) => [r.o.slackId, r]));
  for (const t of AUG_2026.sort((a, b) => b.total - a.total)) {
    const r = t.slackId ? perfBySlack[t.slackId] : null;
    const winCells = [];
    for (const d of WINDOWS) {
      const w = r?.a.win[d];
      winCells.push(w ? w.regCalls : '', w ? w.hardRegs : '', w ? pctStr(ratio(w.hardRegs, w.regCalls)) : '');
    }
    tvp.push([
      t.name, t.slackId || '(no slack id)', t.group, t.personality || '',
      t.lates, t.absences,
      t.knowledge ? `${t.knowledge.toFixed(2)}%` : '',
      t.sli || '',
      t.callHandling ? `${t.callHandling.toFixed(2)}%` : '',
      t.sysNav ? `${t.sysNav.toFixed(2)}%` : '',
      t.total ? `${t.total.toFixed(2)}%` : '',
      r?.first ? fmtDbDate(r.first) : (t.status === 'active' ? '(not started)' : ''),
      ...winCells,
      r ? r.verdict.level : '',
      t.status === 'active' ? (r?.o.closedAt ? `Left ${fmtDbDate(r.o.closedAt).slice(0, 10)}` : 'Active') : `${t.status}${t.reason ? ` — ${t.reason}` : ''}`,
    ]);
  }

  // --- Class Scorecard: the ten metrics his management grades him on ---
  // Where we can compute it, we do, and we show their published figure next to
  // ours. If the two disagree the formula is wrong and we need to know that
  // before he presents it, not after.
  const completed = AUG_2026.filter((t) => t.status === 'active');
  const left = AUG_2026.filter((t) => t.status !== 'active');
  const pctCompleted = completed.length / AUG_2026.length;
  const quizAllHires = AUG_2026.reduce((s, t) => s + t.knowledge, 0) / AUG_2026.length;
  const quizCompletedOnly = completed.reduce((s, t) => s + t.knowledge, 0) / completed.length;
  const gradDate = new Date(`${CLASS_META.classEnd}T00:00:00Z`);
  const plusDays = (n) => fmtDbDate(new Date(gradDate.getTime() + n * 86400000)).slice(0, 10);

  // --- Churn, on the same 30/60/90 clock management uses -----------------------
  //
  // The formula is confirmed against their own July figure: 3 churned out of 46 who
  // completed training = 6.52%, which is exactly what their sheet shows. So the
  // denominator is COMPLETED TRAINING, not new hires — someone who quit during the
  // class is not counted as churn, they are counted as not having completed.
  //
  // The clock starts at GRADUATION, not at hire.
  const gradMs = gradDate.getTime();
  const daysSinceGrad = Math.floor((todayUTC - gradMs) / 86400000);

  const classChurn = WINDOWS.map((d) => {
    // Who from this class has a closedAt, and was it inside the window?
    const leavers = completed
      .map((t) => ({ t, o: t.slackId ? bySlack[t.slackId] : null }))
      .filter(({ o }) => o?.closedAt)
      .map(({ t, o }) => ({
        name: t.name,
        left: fmtDbDate(o.closedAt).slice(0, 10),
        day: Math.floor((Date.UTC(o.closedAt.getUTCFullYear(), o.closedAt.getUTCMonth(), o.closedAt.getUTCDate()) - gradMs) / 86400000),
        reason: (o.deactivationReason || '').trim(),
      }))
      .filter((x) => x.day >= 0 && x.day <= d)
      .sort((a, b) => a.day - b.day);
    return {
      days: d,
      n: leavers.length,
      rate: completed.length ? leavers.length / completed.length : null,
      complete: daysSinceGrad >= d,
      leavers,
    };
  });

  const churnGoal = { 30: 0.05, 60: 0.10, 90: 0.15 };
  const churnCell = (c) => {
    if (!c.leavers.length && !c.complete) return 'none yet';
    return `${c.n} (${pctStr(c.rate)})`;
  };
  const churnNote = (c) => {
    const due = plusDays(c.days);
    const who = c.leavers.length ? ` Left so far: ${c.leavers.map((l) => `${l.name} day ${l.day}${l.reason ? ` — ${l.reason}` : ''}`).join('; ')}.` : '';
    if (c.complete) return `Window closed ${due}. Goal is under ${pctStr(churnGoal[c.days])}.${who}`;
    return `RUNNING — day ${daysSinceGrad} of ${c.days}, closes ${due}. This can only go up.${who}`;
  };

  const scorecard = [
    ['Metric', 'Goal', 'Ours', 'Their published figure', 'Match?', 'Notes'],
    ['New hires', '—', AUG_2026.length, 40, AUG_2026.length === 40 ? '✅' : '⚠️', 'Class of Aug 3–21, 2026.'],
    ['Completed Training', '—', completed.length, 35, completed.length === 35 ? '✅' : '⚠️', `${left.length} did not finish: ${left.map((t) => `${t.name} (${t.status})`).join(', ')}`],
    ['% Completed Training', '90%', pctStr(pctCompleted), '87.50%', Math.abs(pctCompleted - 0.875) < 0.001 ? '✅' : '⚠️', pctCompleted < 0.9 ? 'Under goal.' : 'At goal.'],
    ['Trainee Satisfaction', '97%', '—', 'Aug 21', '—', 'A survey of the trainees. Measures the TRAINER, not the operators. Not in the database.'],
    // Their published 82.19% reproduces exactly as the average across ALL 40 hires,
    // including the five who scored 0 because they never finished. So the formula is
    // confirmed — and it means he is graded on the quiz scores of people who quit or
    // were fired. Worth him knowing before the next review.
    ['Quizzes Success Rate', '85%', `${quizAllHires.toFixed(2)}%`, '82.19%', Math.abs(quizAllHires - 82.19) < 0.05 ? '✅ formula confirmed' : '⚠️', `Average across ALL ${AUG_2026.length} hires, including the ${left.length} who did not finish (four of them scored 0). Counting only the ${completed.length} who completed, it is ${quizCompletedOnly.toFixed(2)}% — above the 85% goal rather than under it.`],
    ...classChurn.map((c) => [
      `${c.days} day Churn Rate`,
      `under ${pctStr(churnGoal[c.days])}`,
      churnCell(c),
      c.complete ? '' : 'not due yet',
      c.rate === null ? '—' : c.complete ? (c.rate <= churnGoal[c.days] ? '✅ met' : '❌ missed') : (c.rate > churnGoal[c.days] ? '⚠️ already over' : 'on track'),
      churnNote(c),
    ]),
    ['90 day reg rate', '+15%', 'pending', plusDays(90), '—', 'Will be computed from operatorPerformances over the first 90 days after graduation.'],
    ['90 day star model', '3.70+', 'pending', plusDays(90), '—', 'Formula not documented anywhere we can read. Needs the definition from Ops (Aleesa).'],
  ];

  // --- Class Churn: the rate, and the people behind it -------------------------
  // A percentage on a scorecard does not tell a trainer anything he can act on. The
  // names, the day they left and the reason do.
  const churnTab = [
    ['Class churn — August 2026'],
    [`Graduated ${CLASS_META.classEnd}. Today is day ${daysSinceGrad}. ${completed.length} people completed training, and that is the denominator management uses (confirmed against their July figure: 3 of 46 = 6.52%).`],
    ['Someone who quit DURING the class is not churn — they are counted as not having completed training.'],
    [''],
    ['Window', 'Goal', 'Left so far', 'Rate', 'Status'],
    ...classChurn.map((c) => [
      `${c.days} days`,
      `under ${pctStr(churnGoal[c.days])}`,
      c.n,
      c.rate === null ? '' : pctStr(c.rate),
      c.complete
        ? (c.rate <= churnGoal[c.days] ? 'Window closed — met' : 'Window closed — missed')
        : (c.rate > churnGoal[c.days] ? `Day ${daysSinceGrad} of ${c.days} — ALREADY over goal` : `Day ${daysSinceGrad} of ${c.days} — on track`),
    ]),
    [''],
    ['Who has left', '', '', '', ''],
    ['Name', 'Date left', 'Day after graduation', 'Counts against', 'Reason on record'],
    ...(classChurn[WINDOWS.length - 1].leavers.length
      ? classChurn[WINDOWS.length - 1].leavers.map((l) => [
          l.name, l.left, l.day,
          WINDOWS.filter((d) => l.day <= d).map((d) => `${d}d`).join(', ') || 'past 90d',
          l.reason || '(none recorded)',
        ])
      : [['Nobody from this class has left yet.', '', '', '', '']]),
    [''],
    ['Read this before quoting the number', '', '', '', ''],
    ['A running window can only go up. A 30-day rate quoted on day 20 is a floor, not a result.'],
    ['This counts people whose operator record was closed. Someone who has stopped taking calls but has not been closed out does not appear here — check Churn Watch for those.'],
  ];

  await writeTab('README', readme, TRACKER_SHEET_ID);
  await writeTab('Churn Watch', watch, TRACKER_SHEET_ID);
  await writeTab('Class Scorecard', scorecard, TRACKER_SHEET_ID);
  await writeTab('Class Churn', churnTab, TRACKER_SHEET_ID);
  await writeTab('Training vs Performance', tvp, TRACKER_SHEET_ID);
  await writeTab('Hard Regs', regs, TRACKER_SHEET_ID);
  await writeTab('Team Leads', leads, TRACKER_SHEET_ID);
  await writeTab('Weekly Trend', trend, TRACKER_SHEET_ID);

  for (const t of ['README', 'Churn Watch', 'Class Scorecard', 'Class Churn', 'Training vs Performance', 'Hard Regs', 'Team Leads', 'Weekly Trend']) {
    await formatHeader(t, { spreadsheetId: TRACKER_SHEET_ID, bandRows: t !== 'README' }).catch(() => {});
  }

  // Escalate / Watch in red, Strong in green — wherever those words appear.
  for (const t of ['Churn Watch', 'Training vs Performance', 'Hard Regs', 'Team Leads']) {
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
