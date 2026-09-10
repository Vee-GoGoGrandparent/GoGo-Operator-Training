// WHO THIS PROJECT IS ABOUT.
//
// Vee, 2026-09-10: "make sure that we're only adding the operators that were in
// training. We don't need every single operator. And this is across this entire
// sheet… we do not work with all the other departments. We're only working with the
// training department."
//
// So this file is the guest list, and every tab is filtered through it. Before this,
// the tracker pulled all ~615 active operators and the trainer had to find his own
// people in the crowd.
//
// The database has no idea who went through training — there is no cohort column on
// `operators`. The only record of a class is the workbook the trainers keep, which is
// where the files below come from. That makes this the single source of truth for
// scope, and adding next month's class is one import and one line.
//
// Not "every operator who has ever been trained" — only the classes we have data for.
// Right now that is August 2026. September's class will land here the same way.

import { AUG_2026, CLASS_META as AUG_META } from './class-aug-2026.js';
import { JUL_2026, CLASS_META as JUL_META, PUBLISHED as JUL_PUBLISHED } from './class-jul-2026.js';

/**
 * Every class, oldest first. Add new classes here and every tab picks them up.
 *
 * `published` is what management's own scorecard says. `trainees` is the roster we
 * hold. A class can have one without the other: July has published figures but no
 * roster, so it appears on the scorecard and nowhere else. That asymmetry is the
 * honest state of things, not a bug to paper over.
 */
export const CLASSES = [
  { meta: JUL_META, trainees: JUL_2026, published: JUL_PUBLISHED },
  { meta: AUG_META, trainees: AUG_2026, published: null },
];

/** Classes we can only report, not compute — no roster, so nobody to look up. */
export const CLASSES_WITHOUT_ROSTER = CLASSES.filter((c) => !c.trainees.length);

/**
 * Every trainee across every class, carrying their cohort and graduation date.
 *
 * Graduation matters because the whole scorecard is measured from it — 30/60/90 day
 * churn, 30/60/90 day registrations. Two classes graduate on different days, so the
 * date has to travel with the person, not be a single constant.
 */
export const TRAINED = CLASSES.flatMap(({ meta, trainees }) =>
  trainees.map((t) => ({ ...t, cohort: meta.cohort, gradDate: meta.classEnd })),
);

/** The Slack IDs to filter the database down to. */
export const TRAINED_SLACK_IDS = TRAINED.map((t) => t.slackId).filter(Boolean);

/** Lookup by Slack ID, for joining database rows back to the class workbook. */
export const TRAINEE_BY_SLACK = Object.fromEntries(
  TRAINED.filter((t) => t.slackId).map((t) => [t.slackId, t]),
);

/**
 * The earliest graduation we track, minus a buffer — how far back the performance
 * query has to reach.
 *
 * It cannot be a fixed number of days. The 90-day window on the August class closes
 * in November, and a hardcoded "last 98 days" would quietly stop covering the start
 * of that window as time passed, silently under-reporting block one.
 */
export function earliestGradDate() {
  // Only classes we actually track people from. A class with no roster contributes
  // nobody to look up, so reaching further back for it would pull months of rows
  // for operators we cannot identify.
  const withRoster = CLASSES.filter((c) => c.trainees.length);
  return (withRoster.length ? withRoster : CLASSES).map((c) => c.meta.classEnd).sort()[0];
}

/**
 * The 30 / 60 / 90 day milestone dates, as management actually computes them.
 *
 * They are CALENDAR MONTHS from the last day of class, not 30-day steps. This is not
 * a guess — all five dates on their own scorecard match month arithmetic and none of
 * them match day arithmetic:
 *
 *   July ends 2026-07-10  ->  they publish Sep 10 (60d) and Oct 10 (90d)
 *                             +60/+90 days would be Sep 8 and Oct 8
 *   Aug  ends 2026-08-21  ->  they publish Sep 21, Oct 21, Nov 21
 *                             +30/+60/+90 days would be Sep 20, Oct 20, Nov 19
 *
 * Using days would have put every due date 1-2 days early and quietly disagreed with
 * the sheet his management reads.
 */
export function milestoneDate(classEnd, months) {
  const [y, m, d] = classEnd.split('-').map(Number);
  const total = m - 1 + months;
  const yy = y + Math.floor(total / 12);
  const mm = (total % 12) + 1;
  const p = (n) => String(n).padStart(2, '0');
  return `${yy}-${p(mm)}-${p(d)}`;
}

/** People with no Slack ID cannot be joined to anything. Worth surfacing, not hiding. */
export const TRAINED_WITHOUT_SLACK = TRAINED.filter((t) => !t.slackId).map((t) => t.name);
