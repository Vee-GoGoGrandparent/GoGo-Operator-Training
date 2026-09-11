// Turning operator numbers into something a trainer can act on.
//
// Two rules run through all of this:
//
//   1. NO BLACK BOX. Every flag is something a team lead can read off the sheet and
//      check for themselves. Priority is now nothing more than the reg ratio against
//      three numbers Vee set, so anyone can see why a person is where they are.
//
//   2. NO VERDICTS. We surface what happened. The trainer decides what it means.
//      Nothing here concludes that a person is bad.

import { milestoneDate } from '../data/trained-roster.js';

/** The goal his management set for 90-day reg rate. */
export const TARGET_HR_RATIO = 0.15;

/**
 * Registration calls, excluding test calls.
 *
 * `testCalls` runs at roughly 45k a month against 53k real ride reg calls — nearly
 * half. Leaving them in would roughly halve everyone's ratio and make the whole
 * tracker disagree with the dashboard the trainer already trusts.
 */
export function regCallsOf(row) {
  return (
    Number(row.rideRegCalls || 0) +
    Number(row.gourmetRegCalls || 0) +
    Number(row.groceryRegCalls || 0) +
    Number(row.noMembershipCalls || 0)
  );
}

export const ratio = (hardRegs, regCalls) => (regCalls > 0 ? hardRegs / regCalls : null);

/**
 * Percentages, without trailing zeros nobody needs.
 *
 * Vee's rule, and it is the right one: 95 should read "95%", not "95.00%". The
 * decimals only earn their place when they carry information — 94.22% keeps both,
 * 93.10% becomes 93.1%. Rounding happens first, then the padding is stripped, so
 * nothing is silently truncated.
 */
const trimZeros = (n, dp) => String(Number(Number(n).toFixed(dp)));

/**
 * For ratios in the 0-1 range, e.g. hard regs / reg calls.
 *
 * One decimal by default, which is all a reg ratio needs. Churn passes 2, because
 * management publishes 6.52% and our number has to land on theirs exactly — 6.5%
 * would look like a disagreement with his own scorecard.
 */
export const pctStr = (r, dp = 1) => (r === null || r === undefined ? '' : `${trimZeros(r * 100, dp)}%`);

/** For scores already on a 0-100 scale, e.g. quiz, call handling, training total. */
export const pct100 = (n) =>
  n === null || n === undefined || n === '' ? '' : `${trimZeros(n, 2)}%`;

/** ISO week key, so weeks sort correctly across a year boundary. */
export function weekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * PRIORITY — Vee, 2026-09-11. This replaces the old peer-median / volume-drop logic
 * entirely. Her words: "Watch is anyone under 15% and Escalate is anyone 11% or
 * under", Strong is "19% and above", and nothing else raises an alarm.
 *
 * The same three numbers drive the red and green on every Reg ratio column (see
 * ruleColors in sheets.js), so the word in Priority and the colour on the number can
 * never disagree.
 */
export const PRIORITY = { escalateAtOrBelow: 11, watchBelow: 15, strongAtOrAbove: 19 };

/**
 * A ratio as the sheet SHOWS it: a percentage to one decimal.
 *
 * Thresholds are applied to this, not to the raw fraction. Otherwise 10.96 regs out of
 * 100 would display "11%" and still read as Escalate-or-not depending on digits nobody
 * can see.
 */
export const shownPct = (r) => (r === null || r === undefined ? null : Number((r * 100).toFixed(1)));

/**
 * WHICH RATIO DECIDES PRIORITY — and the order people are listed in. Vee, 2026-09-11.
 *
 *   - Month 1: month 1.
 *   - Month 2: month 1 still rules for the first WEEK. "Zero percent, obviously... they've
 *     only taken two and three calls. It's only day one. So it's unfair." From day 8 on,
 *     month 2 rules — once it has calls; until then month 1 stays.
 *   - Month 3 on, and after the 3 months are over: "Reg ratio all 3 months" (all hard
 *     regs ÷ all reg calls), the same number that column shows.
 *
 * Months are calendar months from graduation (milestoneDate). `block` holds each
 * month's { regCalls, hardRegs }. Returns a 0–1 ratio, or null when there is nothing
 * to judge yet (still in training, or no calls).
 *
 * The version before this used the current month as soon as it had any calls, so on
 * 2026-09-11 the June class's third month — one day old, 2 or 3 calls, 0% — showed
 * Escalate beside months of 25%.
 */
export const MONTH_TWO_WAIT_DAYS = 7;

const addDaysISO = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function priorityRatioFor({ gradDate, todayISO, block }) {
  if (todayISO < gradDate) return null;
  const monthOne = ratio(block[1].hardRegs, block[1].regCalls);
  if (todayISO >= milestoneDate(gradDate, 2)) {
    const calls = [1, 2, 3].reduce((s, m) => s + block[m].regCalls, 0);
    const hard = [1, 2, 3].reduce((s, m) => s + block[m].hardRegs, 0);
    return ratio(hard, calls);
  }
  const monthTwoStart = milestoneDate(gradDate, 1);
  if (todayISO >= monthTwoStart) {
    const monthTwoRules = todayISO >= addDaysISO(monthTwoStart, MONTH_TWO_WAIT_DAYS) && block[2].regCalls > 0;
    return monthTwoRules ? ratio(block[2].hardRegs, block[2].regCalls) : monthOne;
  }
  return monthOne;
}

/**
 * Priority from ONE ratio (priorityRatioFor above). No minimum number of calls: Vee
 * chose that knowingly. No ratio at all means there is nothing to judge: "No data".
 */
export function priorityOf(r) {
  const p = shownPct(r);
  if (p === null) return 'No data';
  if (p <= PRIORITY.escalateAtOrBelow) return 'Escalate';
  if (p < PRIORITY.watchBelow) return 'Watch';
  if (p >= PRIORITY.strongAtOrAbove) return 'Strong';
  return 'OK';
}
