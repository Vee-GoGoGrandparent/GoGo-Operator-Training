// Turning operator numbers into something a trainer can act on.
//
// Two rules run through all of this:
//
//   1. NO BLACK BOX. Every flag carries a sentence saying why it fired, in words
//      a team lead can read out loud. "Risk score 0.73" helps nobody and cannot be
//      argued with. "Reg ratio fell from 19% to 6% over the last three weeks" can.
//
//   2. NO VERDICTS. We surface what happened. The trainer decides what it means.
//      Nothing here concludes that a person is bad.

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

export const median = (nums) => {
  const xs = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
};

export const pctStr = (r) => (r === null || r === undefined ? '' : `${(r * 100).toFixed(1)}%`);

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
 * Look at one operator's recent weeks and say — in sentences — what is worth the
 * trainer's attention.
 *
 * `recent` is the last 4 weeks, `prior` the 8 before that. Peer comparison is
 * against operators who started taking calls in the same month, because a
 * three-week-old operator and a three-year-old one are not the same job.
 *
 * Returns { level, flags[] } where level is 'Escalate' | 'Watch' | 'OK' | 'No data'.
 */
export function assess({ recent, prior, peerMedianRatio, weeksActive, isSuspended }) {
  const flags = [];

  const rRatio = ratio(recent.hardRegs, recent.regCalls);
  const pRatio = ratio(prior.hardRegs, prior.regCalls);

  if (isSuspended) {
    flags.push({ level: 'Escalate', text: 'Currently suspended in the system.' });
  }

  // Silence is the loudest signal there is: they were working, and now they are not.
  if (prior.regCalls > 0 && recent.regCalls === 0) {
    flags.push({
      level: 'Escalate',
      text: `No registration calls at all in the last 4 weeks, after ${prior.regCalls} in the 8 weeks before. Find out whether they are still working.`,
    });
  } else if (prior.regCalls >= 40 && recent.regCalls > 0) {
    // Compare like for like: 4 weeks against a 4-week-equivalent slice of the prior 8.
    const priorPerWeek = prior.regCalls / 8;
    const recentPerWeek = recent.regCalls / 4;
    const drop = 1 - recentPerWeek / priorPerWeek;
    if (drop >= 0.4) {
      flags.push({
        level: 'Watch',
        text: `Call volume down ${Math.round(drop * 100)}% — averaging ${recentPerWeek.toFixed(0)} registration calls a week, was ${priorPerWeek.toFixed(0)}.`,
      });
    }
  }

  // A falling ratio only means something on enough calls to be real.
  if (rRatio !== null && pRatio !== null && recent.regCalls >= 25 && prior.regCalls >= 40) {
    const rel = 1 - rRatio / pRatio;
    if (rel >= 0.3) {
      flags.push({
        level: 'Escalate',
        text: `Reg ratio fell from ${pctStr(pRatio)} to ${pctStr(rRatio)} — down ${Math.round(rel * 100)}% against their own earlier work.`,
      });
    }
  }

  // Behind the people who started when they did.
  if (rRatio !== null && peerMedianRatio && recent.regCalls >= 25) {
    if (rRatio < peerMedianRatio * 0.6) {
      flags.push({
        level: 'Escalate',
        text: `At ${pctStr(rRatio)} against a peer median of ${pctStr(peerMedianRatio)} for operators who started the same month.`,
      });
    } else if (rRatio < peerMedianRatio * 0.8) {
      flags.push({
        level: 'Watch',
        text: `At ${pctStr(rRatio)}, below the ${pctStr(peerMedianRatio)} peer median for their start month.`,
      });
    }
  }

  // Had long enough to ramp and still under the number management set.
  if (rRatio !== null && weeksActive >= 8 && recent.regCalls >= 25 && rRatio < TARGET_HR_RATIO) {
    flags.push({
      level: 'Watch',
      text: `${weeksActive} weeks in and still at ${pctStr(rRatio)}, under the ${pctStr(TARGET_HR_RATIO)} target.`,
    });
  }

  // Worth saying out loud — a trainer should know who to hold up as an example.
  if (!flags.length && rRatio !== null && peerMedianRatio && rRatio > peerMedianRatio * 1.25 && recent.regCalls >= 25) {
    flags.push({
      level: 'Strong',
      text: `At ${pctStr(rRatio)} against a ${pctStr(peerMedianRatio)} peer median — worth studying what they do.`,
    });
  }

  let level = 'OK';
  if (rRatio === null && recent.regCalls === 0 && prior.regCalls === 0) level = 'No data';
  if (flags.some((f) => f.level === 'Watch')) level = 'Watch';
  if (flags.some((f) => f.level === 'Escalate')) level = 'Escalate';
  if (flags.length === 1 && flags[0].level === 'Strong') level = 'Strong';

  return { level, flags, recentRatio: rRatio, priorRatio: pRatio };
}
