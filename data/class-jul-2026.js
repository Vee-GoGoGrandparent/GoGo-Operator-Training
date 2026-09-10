// July 2026 class — the figures upper management published, and nothing else.
//
// ⚠️ THERE IS NO ROSTER FOR THIS CLASS YET.
//
// What we have is the scorecard row from the screenshot management gave the trainers:
// class-level totals only. No names, no Slack IDs, no quiz breakdown. That means:
//
//   - July shows on the scorecard, because those numbers are published facts.
//   - July operators are NOT tracked in the database, because we cannot say who they
//     are. Nothing per-person can be computed for them.
//
// The fix is Oscar sending the July class workbook, the same shape as the August one.
// Until then this file exists so the scorecard is complete rather than pretending the
// class did not happen.

export const CLASS_META = {
  cohort: 'jul-2026',
  label: 'July',
  classStart: '2026-06-22',
  classEnd: '2026-07-10', // the 30/60/90 clock runs from here
  weeks: 3,
  quizPassMark: 0.8,
  rosterMissing: true,
};

/**
 * Exactly what their sheet shows, transcribed. Not recomputed, not adjusted.
 *
 * These are kept separate from anything we calculate so the two can be compared
 * rather than confused. Where we can compute a figure ourselves we show both, and a
 * disagreement means our formula is wrong and we want to know before he presents it.
 */
export const PUBLISHED = {
  newHires: 50,
  completedTraining: 46,
  pctCompletedTraining: '92.00%',
  traineeSatisfaction: '4.87 (97%)',
  quizSuccessRate: '89%',
  churn30: '3 (6.52%)', // the only churn window that has closed
  churn60: null,        // due 2026-09-10
  churn90: null,        // due 2026-10-10
  regRate90: null,      // due 2026-10-10
  starModel90: null,    // due 2026-10-10
};

/** No trainee rows. Deliberately empty, not missing. */
export const JUL_2026 = [];
