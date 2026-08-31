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

import { connect, q } from '../src/db.js';
import { writeTab, formatHeader, TRACKER_SHEET_ID, BRAND } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate } from '../src/time.js';
import { regCallsOf, ratio, median, pctStr, weekKey, assess, TARGET_HR_RATIO } from '../src/analysis.js';

const WEEKS = 12; // 4 recent + 8 prior
const RECENT_WEEKS = 4;

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
  console.log(`[tracker] ${operators.length} operators in scope`);

  // ------------------------------------------------------- 2. weekly numbers
  const perf = await q(
    conn,
    `SELECT operatorId, aggregationDate,
            rideRegCalls, gourmetRegCalls, groceryRegCalls, noMembershipCalls,
            hardRegs, softRegs, trialRegs,
            annualHardRegs, valueMonthlyHardRegs, basicMonthlyHardRegs, fixedIncomeMonthlyHardRegs
       FROM operatorPerformances
      WHERE aggregationDate >= DATE_SUB(CURDATE(), INTERVAL ${WEEKS} WEEK)`,
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

  const agg = {}; // operatorId -> { recent, prior, byWeek, plans }
  const blank = () => ({ regCalls: 0, hardRegs: 0, softRegs: 0, trialRegs: 0 });

  for (const r of perf) {
    const a = (agg[r.operatorId] ??= { recent: blank(), prior: blank(), byWeek: {}, plans: { annual: 0, value: 0, basic: 0, fixedIncome: 0 } });
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
    ['Hard Regs', 'Every active operator and their registration numbers for the last 4 weeks, including which plans they sell.'],
    ['Team Leads', 'The same picture rolled up by team lead — how many of their people need help, and who to talk to first.'],
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

  await writeTab('README', readme, TRACKER_SHEET_ID);
  await writeTab('Churn Watch', watch, TRACKER_SHEET_ID);
  await writeTab('Hard Regs', regs, TRACKER_SHEET_ID);
  await writeTab('Team Leads', leads, TRACKER_SHEET_ID);
  await writeTab('Weekly Trend', trend, TRACKER_SHEET_ID);

  for (const t of ['README', 'Churn Watch', 'Hard Regs', 'Team Leads', 'Weekly Trend']) {
    await formatHeader(t, { spreadsheetId: TRACKER_SHEET_ID, bandRows: t !== 'README' }).catch(() => {});
  }

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
