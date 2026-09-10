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

/** Every class we hold training data for. Add new classes here. */
export const CLASSES = [{ meta: AUG_META, trainees: AUG_2026 }];

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
  return CLASSES.map((c) => c.meta.classEnd).sort()[0];
}

/** People with no Slack ID cannot be joined to anything. Worth surfacing, not hiding. */
export const TRAINED_WITHOUT_SLACK = TRAINED.filter((t) => !t.slackId).map((t) => t.name);
