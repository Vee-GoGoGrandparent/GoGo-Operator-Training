// OPS_TASK=starcompare
//
// Can we calculate the star model ourselves and get management's numbers? Vee,
// 2026-09-11: "let's do both for TODAY just so we can see if there's any difference and
// THEN calculate it ourselves. But only after making sure ours matches theirs. But we
// first need to understand why, if it doesn't."
//
// Management's document (New Star Model.pdf) has one detailed week per operator. Which
// week is not certain: the only date footnote, "[1] Date Range: 8/23-8/29", sits on HR
// Ratios alone, and the last week heading reads 8/30-9/5. So this pulls OUR raw numbers
// for class operators for BOTH weeks, and the comparison decides which one theirs is —
// and whether HR ratio runs a week behind the rest.
//
// Weeks run Sunday to Saturday, as theirs do.
//
// Raw ingredients only, no scoring: reg calls by kind, hard/soft/trial regs, non-member
// calls and what came of them (Activation), rides and scheduled rides (the ride success
// parts), and time in each operatorActivities status (OTL). QA, tardies and tech issues
// have no confirmed source yet — see OPS_TASK=starsources.
//
// Read-only, date-bounded. Writes BUILD NOTES only: gathering, not a trainer tab.

import { connect, tryQ } from '../src/db.js';
import { writeTab, formatHeader, BUILD_SHEET_ID } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate } from '../src/time.js';
import { TRAINED, TRAINED_SLACK_IDS } from '../data/trained-roster.js';

const TAB = '15 Star Model — Our Numbers';
const WEEKS = [
  { label: '8/23-8/29', from: '2026-08-23', to: '2026-08-29' },
  { label: '8/30-9/5', from: '2026-08-30', to: '2026-09-05' },
];

async function main() {
  const { conn } = await connect();
  const problems = [];
  const get = async (label, sql, params, timeout = 60_000) => {
    const r = await tryQ(conn, sql, params, timeout);
    if (r.error) { problems.push(`${label}: ${r.error.slice(0, 300)}`); return []; }
    return r.rows;
  };

  const ops = await get('operators', 'SELECT id, slackId FROM operators WHERE slackId IN (?)', [TRAINED_SLACK_IDS]);
  const ids = ops.map((o) => o.id);
  const slackOf = Object.fromEntries(ops.map((o) => [o.id, o.slackId]));
  const nameOf = Object.fromEntries(TRAINED.map((t) => [t.slackId, t.name]));
  const out = [[
    'Week', 'Operator (class workbook)', 'Slack ID',
    'rideRegCalls', 'gourmetRegCalls', 'groceryRegCalls', 'noMembershipCalls', 'hardRegs', 'softRegs', 'trialRegs',
    'opc noMembershipCalls', 'opc noMembershipHardRegs', 'opc noMembershipTrialRegs',
    'rides', 'ridesCompleted', 'scheduledRides', 'scheduledRidesCompleted',
    'operatorActivities hours by status',
  ]];

  for (const w of WEEKS) {
    const perf = await get(`operatorPerformances ${w.label}`,
      `SELECT operatorId, SUM(rideRegCalls) AS ride, SUM(gourmetRegCalls) AS gourmet, SUM(groceryRegCalls) AS grocery,
              SUM(noMembershipCalls) AS nm, SUM(hardRegs) AS hard, SUM(softRegs) AS soft, SUM(trialRegs) AS trial
         FROM operatorPerformances
        WHERE operatorId IN (?) AND aggregationDate BETWEEN ? AND ?
        GROUP BY operatorId`, [ids, w.from, w.to]);
    const opc = await get(`operatorPerformanceCalls ${w.label}`,
      `SELECT operatorId, SUM(noMembershipCalls) AS nm, SUM(noMembershipHardRegs) AS nmHard, SUM(noMembershipTrialRegs) AS nmTrial
         FROM operatorPerformanceCalls
        WHERE operatorId IN (?) AND callTimeStart >= ? AND callTimeStart < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY operatorId`, [ids, w.from, w.to]);
    const rides = await get(`ridePerformances ${w.label}`,
      `SELECT operatorId, SUM(rides) AS rides, SUM(ridesCompleted) AS done,
              SUM(scheduledRides) AS sched, SUM(scheduledRidesCompleted) AS schedDone
         FROM ridePerformances
        WHERE operatorId IN (?) AND aggregationDate BETWEEN ? AND ?
        GROUP BY operatorId`, [ids, w.from, w.to]);
    const acts = await get(`operatorActivities ${w.label}`,
      `SELECT operatorId, startCode, ROUND(SUM(TIMESTAMPDIFF(SECOND, startTime, endTime)) / 3600, 2) AS hours
         FROM operatorActivities
        WHERE operatorId IN (?) AND startTime >= ? AND startTime < DATE_ADD(?, INTERVAL 1 DAY) AND endTime IS NOT NULL
        GROUP BY operatorId, startCode`, [ids, w.from, w.to], 90_000);

    const by = (rows) => Object.fromEntries(rows.map((r) => [r.operatorId, r]));
    const P = by(perf);
    const C = by(opc);
    const R = by(rides);
    const A = {};
    for (const a of acts) (A[a.operatorId] ??= []).push(`${a.startCode}=${a.hours}`);

    for (const id of ids) {
      const p = P[id] ?? {};
      const c = C[id] ?? {};
      const r = R[id] ?? {};
      out.push([
        w.label, nameOf[slackOf[id]] ?? '', slackOf[id],
        p.ride ?? '', p.gourmet ?? '', p.grocery ?? '', p.nm ?? '', p.hard ?? '', p.soft ?? '', p.trial ?? '',
        c.nm ?? '', c.nmHard ?? '', c.nmTrial ?? '',
        r.rides ?? '', r.done ?? '', r.sched ?? '', r.schedDone ?? '',
        (A[id] ?? []).join('; '),
      ].map((v) => (v instanceof Date ? fmtDbDate(v) : v)));
    }
  }
  await conn.end();

  const info = await writeTab(TAB, [
    ...out.slice(0, 1),
    [`Run ${nowET()}. Raw ingredients for the star model, class operators only, two Sunday–Saturday weeks. Compared against management's document offline.${problems.length ? ` PROBLEMS: ${problems.join(' | ')}` : ''}`],
    ...out.slice(1),
  ], BUILD_SHEET_ID);
  if (info.created) await formatHeader(TAB, { bandRows: true }).catch(() => {});
  console.log(`[starcompare] wrote ${out.length - 1} rows to "${TAB}"${problems.length ? ` with ${problems.length} problem(s)` : ''}`);
  await notify(`Star model comparison numbers written to "${TAB}" on Build Notes.`);
}

main().catch(async (err) => {
  console.error('[starcompare] failed:', err);
  try {
    await writeTab(TAB, [['Status', '❌ FAILED'], ['Error', err.message], ['Run at', nowET()]], BUILD_SHEET_ID);
  } catch (e) {
    console.error('[starcompare] could not write the failure either:', e.message);
  }
  await notify(`❌ Star model comparison failed: ${err.message}`);
  process.exit(1);
});
