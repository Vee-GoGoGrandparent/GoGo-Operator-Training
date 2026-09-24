// OPS_TASK=trials
//
// Vee, 2026-09-24: "the seven day trial — they don't count that person as a registered
// customer until those seven days are up."
//
// If the database counts a signup on the day of the call, our newest week runs ahead of
// management's. If it only counts once the trial sticks, we are already aligned. The
// earlier 71/71 match cannot tell us which: it compared weeks that were already a fortnight
// old, by which time any 7-day lag has washed out.
//
// Three questions:
//   1. Are trials counted separately from hard regs, and how big are they?
//   2. Do OLD weeks grow? Build Notes tab 17 froze management's figures on 2026-09-11 for
//      the weeks 8/23-8/29 and 8/30-9/5. This prints today's database totals for exactly
//      those weeks, per operator, so the two can be compared. Higher now = registrations
//      are being added to dates that have already passed.
//   3. What does a trial look like in the customer tables — how long until it converts?
//      Columns are discovered first, because guessing at a schema is how you get a wrong
//      answer that looks right.
//
// Read-only, date-bounded, LIMITed. NO CUSTOMER DETAILS: nothing here selects a name, phone
// number or address — only counts and day gaps ([[feedback_no_customer_details_anywhere]]).

import { connect, tryQ } from '../src/db.js';
import { writeTab, readTab, formatHeader, BUILD_SHEET_ID } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate } from '../src/time.js';
import { TRAINED_SLACK_IDS } from '../data/trained-roster.js';

const TAB = '19 Trials — When Does A Signup Count?';
// The two weeks management's figures were frozen for on 2026-09-11 (Build Notes tab 17).
const FROZEN = [['8/23-8/29', '2026-08-23', '2026-08-30'], ['8/30-9/5', '2026-08-30', '2026-09-06']];

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
  const columnsOf = (table) => ask(`${table} — every column`,
    `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION LIMIT 80`, [table]);

  const idRes = await tryQ(conn, 'SELECT id FROM operators WHERE slackId IN (?)', [TRAINED_SLACK_IDS]);
  const ids = (idRes.rows ?? []).map((r) => r.id);
  out.push(['Scope', `${ids.length} class operators. "Hard reg" and "trial reg" are separate columns in operatorPerformances; this asks what each one means in time.`]);

  // ------------------------------------------------------------------ 1
  out.push(['— 1. Are trials counted separately from hard regs? —', '']);
  await ask('Per week, our class operators: reg calls, hard regs, trial regs, and hard regs by plan',
    `SELECT DATE_FORMAT(aggregationDate, '%x-W%v') AS week_,
            MIN(aggregationDate) AS starts_,
            SUM(rideRegCalls + gourmetRegCalls + groceryRegCalls + noMembershipCalls) AS reg_calls,
            SUM(hardRegs) AS hard_regs,
            SUM(trialRegs) AS trial_regs,
            SUM(rideTrialRegs) AS ride_trial_regs,
            SUM(noMembershipTrialRegs) AS nonmember_trial_regs,
            SUM(annualHardRegs) AS annual,
            SUM(valueMonthlyHardRegs) AS value_monthly,
            SUM(basicMonthlyHardRegs) AS basic_monthly,
            SUM(fixedIncomeMonthlyHardRegs) AS fixed_income_monthly
       FROM operatorPerformances
      WHERE operatorId IN (?) AND aggregationDate >= DATE_SUB(CURDATE(), INTERVAL 9 WEEK)
      GROUP BY week_ ORDER BY starts_ DESC LIMIT 12`,
    [ids], 60_000);

  await ask('Do hard regs and trial regs ever land on the SAME call? (per-call table, last 6 weeks)',
    `SELECT SUM(hardRegs > 0 AND trialRegs > 0) AS both_on_one_call,
            SUM(hardRegs > 0 AND trialRegs = 0) AS hard_reg_only,
            SUM(hardRegs = 0 AND trialRegs > 0) AS trial_only,
            COUNT(*) AS calls_with_either
       FROM operatorPerformanceCalls
      WHERE operatorId IN (?) AND date >= DATE_SUB(CURDATE(), INTERVAL 6 WEEK)
        AND (hardRegs > 0 OR trialRegs > 0)`,
    [ids], 60_000);

  // ------------------------------------------------------------------ 2
  out.push(['— 2. Have the frozen weeks GROWN since 2026-09-11? —', '']);
  out.push(['How to read this', 'Build Notes tab 17 holds management\'s figures for these weeks, frozen on 2026-09-11. If today\'s database totals below are HIGHER, then registrations are being added to dates that have already passed — which is what a 7-day trial rule would do.']);
  for (const [label, from, to] of FROZEN) {
    await ask(`Today's database totals for ${label}, per operator`,
      `SELECT o.firstName, o.lastName,
              SUM(p.rideRegCalls + p.gourmetRegCalls + p.groceryRegCalls + p.noMembershipCalls) AS reg_calls,
              SUM(p.hardRegs) AS hard_regs,
              SUM(p.trialRegs) AS trial_regs
         FROM operatorPerformances p JOIN operators o ON o.id = p.operatorId
        WHERE p.operatorId IN (?) AND p.aggregationDate >= ? AND p.aggregationDate < ?
        GROUP BY p.operatorId, o.firstName, o.lastName
        ORDER BY o.lastName LIMIT 100`,
      [ids, from, to], 60_000);
  }

  // ------------------------------------------------------------------ 2b
  // The question that actually decides whether our newest week can be trusted: when a
  // registration is recorded, is it written onto the date of the CALL or the date it was
  // confirmed? Every row carries the call's date and when it was last touched, so a lag
  // shows up as a gap between the two. A bump at 7 days = registrations being back-dated
  // once the trial closes, which means a fresh week starts low and climbs.
  out.push(['— 2b. Are registrations written back onto the day of the call? —', '']);
  await ask('Per-call rows: how many days after the call was the row last touched?',
    `SELECT DATEDIFF(DATE(pc.updatedAt), pc.date) AS days_after_the_call,
            COUNT(*) AS rows_, SUM(pc.hardRegs) AS hard_regs, SUM(pc.trialRegs) AS trial_regs
       FROM operatorPerformanceCalls pc
      WHERE pc.operatorId IN (?) AND pc.date >= DATE_SUB(CURDATE(), INTERVAL 5 WEEK)
      GROUP BY days_after_the_call ORDER BY days_after_the_call LIMIT 25`,
    [ids], 60_000);
  await ask('Daily rows (the table the tracker reads): how many days after the day was the row last touched?',
    `SELECT DATEDIFF(DATE(updatedAt), aggregationDate) AS days_after_the_day,
            COUNT(*) AS rows_, SUM(hardRegs) AS hard_regs, SUM(trialRegs) AS trial_regs
       FROM operatorPerformances
      WHERE operatorId IN (?) AND aggregationDate >= DATE_SUB(CURDATE(), INTERVAL 5 WEEK)
      GROUP BY days_after_the_day ORDER BY days_after_the_day LIMIT 25`,
    [ids], 60_000);

  // ------------------------------------------------------------------ 3
  out.push(['— 3. What does a trial look like in the customer tables? —', '']);
  await columnsOf('callerPlans');
  await columnsOf('callerPlanChanges');
  // Best effort: if these column names are wrong the error tells us, and the column lists
  // above tell us what to use next time. Counts only — no customer is identified here.
  await ask('How long between a plan starting and its first change? (all callers, last 8 weeks, counts only)',
    `SELECT DATEDIFF(c.createdAt, p.createdAt) AS days_from_start_to_change, COUNT(*) AS n
       FROM callerPlanChanges c JOIN callerPlans p ON p.id = c.callerPlanId
      WHERE c.createdAt >= DATE_SUB(CURDATE(), INTERVAL 8 WEEK)
      GROUP BY days_from_start_to_change
      ORDER BY days_from_start_to_change LIMIT 30`,
    [], 60_000);

  await conn.end();

  const info = await writeTab(TAB, [
    ['When does a signup count as a registration?'],
    [`Run ${nowET()}. Read-only. Vee, 2026-09-24: management does not count a 7-day trial as a registered customer until the seven days are up. This asks whether our numbers already work that way. No customer details are read.`],
    [''],
    ...out,
  ], BUILD_SHEET_ID);
  if (info.created) await formatHeader(TAB, { bandRows: true, spreadsheetId: BUILD_SHEET_ID }).catch(() => {});
  console.log(`[trials] wrote "${TAB}" to Build Notes`);
  await notify(`Trial-counting check finished — see "${TAB}" on Build Notes.`);
}

// A failure must NOT overwrite good results. On 2026-09-11 a failed probe wrote a 2-column
// error record over a wide table on Build Notes and cleared the rest, destroying a snapshot
// we later wanted. So: only write the failure when there is nothing to lose. Every failure
// is recorded in the Run Log and on Slack regardless.
main().catch(async (err) => {
  console.error('[trials] failed:', err);
  try {
    const existing = await readTab(TAB, { spreadsheetId: BUILD_SHEET_ID }).catch(() => []);
    const hasResults = existing.length > 4;
    if (hasResults) {
      console.error(`[trials] leaving the previous results on "${TAB}" alone; the failure is in the Run Log`);
    } else {
      await writeTab(TAB, [
        ['When does a signup count as a registration?'],
        ['Status', '❌ FAILED — the probe started but could not finish'],
        ['Error', err.message],
        ['Run at', nowET()],
      ], BUILD_SHEET_ID);
    }
  } catch (e) {
    console.error('[trials] could not record the failure:', e.message);
  }
  await notify(`❌ Trial-counting check failed: ${err.message}`);
  process.exit(1);
});
