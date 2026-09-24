// OPS_TASK=regcalls
//
// Marcia (via Vee, 2026-09-24): the team filters short calls — "the 1 or 2 min calls they
// filter those out so they don't affect" — so operators may really be rated higher than our
// sheet shows.
//
// What we already know, and why this probe exists anyway:
//   - Management's own weekly operator report sums the SAME four columns we do
//     (rideRegCalls + gourmetRegCalls + groceryRegCalls + noMembershipCalls from
//     operatorPerformances) with no call-length filter — only a date.
//   - On 2026-09-11 our reg calls matched their star document for all 71 class operators in
//     the week 8/23-8/29, hard regs too.
// So either the filter happens UPSTREAM (when those daily rows are written, in which case it
// is already in both their numbers and ours), or it lives on some other screen. This probe
// settles it from the data instead of arguing about it:
//
//   1. Do the per-call rows add up to the daily totals we use? If yes, nothing is filtered
//      upstream and every call is counted, however short.
//   2. How long are reg calls? Under 1 minute, 1-2 minutes, longer, or unknown.
//   3. What would each operator's reg ratio become if short calls were dropped? Hard regs
//      are attributed to the call they happened on, so the numerator moves too.
//
// Read-only, date-bounded, LIMITed. NO CUSTOMER DETAILS: operatorPerformanceCalls carries
// callerName and callerPhoneNumber and this probe never selects them
// ([[feedback_no_customer_details_anywhere]]).

import { connect, tryQ } from '../src/db.js';
import { writeTab, formatHeader, BUILD_SHEET_ID } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate, lastTwoCompleteWeeks } from '../src/time.js';
import { TRAINED_SLACK_IDS } from '../data/trained-roster.js';

const TAB = '18 Reg Calls — Short Call Filter';

const fmt = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fmtDbDate(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

async function main() {
  const { conn } = await connect();
  const out = [['Question', 'Answer']];
  const ask = async (label, sql, params = [], timeout = 60_000) => {
    const r = await tryQ(conn, sql, params, timeout);
    if (r.error) {
      out.push([label, `ERROR: ${r.error.slice(0, 400)}`]);
      console.log(`${label}\n  ERROR: ${r.error.slice(0, 200)}`);
      return null;
    }
    const text = r.rows.map((row) => Object.entries(row).map(([k, v]) => `${k}=${fmt(v)}`).join('  ')).join('\n');
    out.push([label, text || '(no rows)']);
    console.log(`${label}\n  ${(text || '(no rows)').slice(0, 300)}`);
    return r.rows;
  };

  const idRes = await tryQ(conn, 'SELECT id FROM operators WHERE slackId IN (?)', [TRAINED_SLACK_IDS]);
  const ids = (idRes.rows ?? []).map((r) => r.id);
  const { from, to, mid } = lastTwoCompleteWeeks();
  out.push(['Scope', `${ids.length} class operators, the two complete weeks ${from} to ${to} (Sunday to Saturday, the way the star model counts). Reg calls = ride + gourmet + grocery + non-member, the same four columns management's own weekly report sums. Call length comes from callLogs.timeStart to timeEnd.`]);

  // ---------------------------------------------------------------- 1
  out.push(['— 1. Do the per-call rows add up to the daily totals we use? —', '']);
  await ask('Daily totals (operatorPerformances — what the tracker and management both use) vs per-call rows (operatorPerformanceCalls)',
    `SELECT 'operatorPerformances (daily, what we use)' AS source,
            SUM(rideRegCalls + gourmetRegCalls + groceryRegCalls + noMembershipCalls) AS reg_calls,
            SUM(hardRegs) AS hard_regs
       FROM operatorPerformances
      WHERE operatorId IN (?) AND aggregationDate >= ? AND aggregationDate < ?
      UNION ALL
     SELECT 'operatorPerformanceCalls (one row per call)' AS source,
            SUM(rideRegCalls + gourmetRegCalls + groceryRegCalls + noMembershipCalls) AS reg_calls,
            SUM(hardRegs) AS hard_regs
       FROM operatorPerformanceCalls
      WHERE operatorId IN (?) AND date >= ? AND date < ?`,
    [ids, from, to, ids, from, to]);

  // ---------------------------------------------------------------- 2
  out.push(['— 2. How long are reg calls? —', '']);
  await ask('Reg calls by length, all class operators, both weeks',
    `SELECT COUNT(*) AS reg_calls,
            SUM(dur IS NULL) AS no_length_recorded,
            SUM(dur < 60) AS under_1_min,
            SUM(dur >= 60 AND dur < 120) AS between_1_and_2_min,
            SUM(dur >= 120 AND dur < 300) AS between_2_and_5_min,
            SUM(dur >= 300) AS over_5_min,
            ROUND(AVG(dur), 1) AS average_seconds,
            SUM(hardRegs) AS hard_regs,
            SUM(CASE WHEN dur < 60 THEN hardRegs END) AS hard_regs_on_calls_under_1_min,
            SUM(CASE WHEN dur >= 60 AND dur < 120 THEN hardRegs END) AS hard_regs_on_calls_1_to_2_min
       FROM (SELECT pc.hardRegs, TIMESTAMPDIFF(SECOND, cl.timeStart, cl.timeEnd) AS dur
               FROM operatorPerformanceCalls pc
               LEFT JOIN callLogs cl ON cl.id = pc.callLogId
              WHERE pc.operatorId IN (?) AND pc.date >= ? AND pc.date < ?
                AND (pc.rideRegCalls + pc.gourmetRegCalls + pc.groceryRegCalls + pc.noMembershipCalls) > 0) x`,
    [ids, from, to], 90_000);

  // ---------------------------------------------------------------- 3
  out.push(['— 3. What would each operator\'s ratio become if short calls were dropped? —', '']);
  await ask('Per operator: reg ratio as we show it, without calls under 1 minute, and without calls under 2 minutes',
    `SELECT o.firstName, o.lastName,
            COUNT(*) AS reg_calls,
            SUM(x.hardRegs) AS hard_regs,
            ROUND(SUM(x.hardRegs) * 100 / NULLIF(COUNT(*), 0), 2) AS ratio_now,
            ROUND(SUM(CASE WHEN x.dur >= 60 OR x.dur IS NULL THEN x.hardRegs END) * 100
                  / NULLIF(SUM(x.dur >= 60 OR x.dur IS NULL), 0), 2) AS ratio_without_under_1_min,
            ROUND(SUM(CASE WHEN x.dur >= 120 OR x.dur IS NULL THEN x.hardRegs END) * 100
                  / NULLIF(SUM(x.dur >= 120 OR x.dur IS NULL), 0), 2) AS ratio_without_under_2_min,
            SUM(x.dur < 60) AS calls_under_1_min,
            SUM(x.dur >= 60 AND x.dur < 120) AS calls_1_to_2_min
       FROM (SELECT pc.operatorId, pc.hardRegs, TIMESTAMPDIFF(SECOND, cl.timeStart, cl.timeEnd) AS dur
               FROM operatorPerformanceCalls pc
               LEFT JOIN callLogs cl ON cl.id = pc.callLogId
              WHERE pc.operatorId IN (?) AND pc.date >= ? AND pc.date < ?
                AND (pc.rideRegCalls + pc.gourmetRegCalls + pc.groceryRegCalls + pc.noMembershipCalls) > 0) x
       JOIN operators o ON o.id = x.operatorId
      GROUP BY x.operatorId, o.firstName, o.lastName
      ORDER BY reg_calls DESC LIMIT 100`,
    [ids, from, to], 90_000);

  await ask('The same three ratios for the class as a whole, week by week',
    `SELECT CASE WHEN x.d < ? THEN CONCAT(?, ' week') ELSE CONCAT(?, ' week') END AS week_,
            COUNT(*) AS reg_calls, SUM(x.hardRegs) AS hard_regs,
            ROUND(SUM(x.hardRegs) * 100 / NULLIF(COUNT(*), 0), 2) AS ratio_now,
            ROUND(SUM(CASE WHEN x.dur >= 60 OR x.dur IS NULL THEN x.hardRegs END) * 100
                  / NULLIF(SUM(x.dur >= 60 OR x.dur IS NULL), 0), 2) AS ratio_without_under_1_min,
            ROUND(SUM(CASE WHEN x.dur >= 120 OR x.dur IS NULL THEN x.hardRegs END) * 100
                  / NULLIF(SUM(x.dur >= 120 OR x.dur IS NULL), 0), 2) AS ratio_without_under_2_min
       FROM (SELECT pc.date AS d, pc.hardRegs, TIMESTAMPDIFF(SECOND, cl.timeStart, cl.timeEnd) AS dur
               FROM operatorPerformanceCalls pc
               LEFT JOIN callLogs cl ON cl.id = pc.callLogId
              WHERE pc.operatorId IN (?) AND pc.date >= ? AND pc.date < ?
                AND (pc.rideRegCalls + pc.gourmetRegCalls + pc.groceryRegCalls + pc.noMembershipCalls) > 0) x
      GROUP BY week_ ORDER BY week_`,
    [mid, from, mid, ids, from, to], 90_000);

  // Anything else in the per-call table that already looks like a filter?
  out.push(['— 4. Is anything already excluded upstream? —', '']);
  await ask('operatorPerformanceCalls — reg calls, test calls and calls with no length, per week',
    `SELECT pc.date AS day_, COUNT(*) AS rows_,
            SUM((pc.rideRegCalls + pc.gourmetRegCalls + pc.groceryRegCalls + pc.noMembershipCalls) > 0) AS reg_call_rows,
            SUM(pc.testCalls > 0) AS test_call_rows,
            SUM(cl.id IS NULL) AS rows_with_no_matching_call_log
       FROM operatorPerformanceCalls pc
       LEFT JOIN callLogs cl ON cl.id = pc.callLogId
      WHERE pc.operatorId IN (?) AND pc.date >= ? AND pc.date < ?
      GROUP BY pc.date ORDER BY pc.date DESC LIMIT 20`,
    [ids, from, to], 90_000);

  await conn.end();

  const info = await writeTab(TAB, [
    ['Are short calls counted in the reg ratio?'],
    [`Run ${nowET()}. Read-only. Marcia says 1-2 minute calls are filtered out so they do not affect the rating; this checks whether that filtering is already in the numbers we use. No customer details are read.`],
    [''],
    ...out,
  ], BUILD_SHEET_ID);
  if (info.created) await formatHeader(TAB, { bandRows: true, spreadsheetId: BUILD_SHEET_ID }).catch(() => {});
  console.log(`[regcalls] wrote "${TAB}" to Build Notes`);
  await notify(`Short-call check finished — see "${TAB}" on Build Notes.`);
}

// A probe that writes nothing when it fails looks the same as one that never ran.
main().catch(async (err) => {
  console.error('[regcalls] failed:', err);
  try {
    await writeTab(TAB, [
      ['Are short calls counted in the reg ratio?'],
      ['Status', '❌ FAILED — the probe started but could not finish'],
      ['Error', err.message],
      ['Run at', nowET()],
    ], BUILD_SHEET_ID);
  } catch (e) {
    console.error('[regcalls] could not write the failure:', e.message);
  }
  await notify(`❌ Short-call check failed: ${err.message}`);
  process.exit(1);
});
