// June 2026 class — transcribed from "June 2026 Class.pdf" (shared 2026-09-10).
//
// ⚠️ TWO NAMES, ONE CLASS.
// The trainers call this the JUNE class, because it started June 22. Upper
// management's scorecard calls it JULY, because it ended July 10 — their row reads
// "July (June 22nd-July 10th)". Same class. The label below is "June" (what Oscar and
// Vee call it), and the scorecard tab says so in its Notes cell, so nobody comparing
// the two sheets thinks a class is missing.
//
// Ran June 22 – July 10, 2026. Two groups:
//   Class 1 — Oscar & Paula      (26 hires)
//   Class 2 — Aina & Christene   (25 hires)
//
// ⚠️ PROVENANCE: read out of a PDF by hand, same as the August class. Good enough to
// prove the join and to look for patterns, NOT a sustainable source. The real fix is
// read access to the live class workbook.
//
// Weighting the team uses: Knowledge 30% · Call Handling 25% · System Navigation
// 20% · Punctuality & Participation 10% · Engagement 10% · Technical Readiness 5%.

export const CLASS_META = {
  cohort: 'jun-2026',
  label: 'June',
  managementLabel: 'July', // what their scorecard calls this same class
  classStart: '2026-06-22',
  classEnd: '2026-07-10', // the 30/60/90 clock runs from here
  weeks: 3,
  quizPassMark: 0.8,
};

/**
 * Exactly what management's scorecard shows for this class. Transcribed, never
 * recomputed — so a disagreement with our own figures shows up instead of hiding.
 */
// TWO THINGS OUR NUMBERS DO NOT AGREE WITH, both worth Oscar's eye:
//
// 1. HEAD COUNT IS OFF BY ONE. The workbook lists 51 distinct people — 26 in Class 1,
//    25 in Class 2, no duplicate names and no duplicate Slack IDs. Management's
//    scorecard says 50 hires and 46 completed. We get 51 and 47. Their 92.00% is
//    exactly 46/50, so their denominator really is 50. One person is on the workbook
//    and not on the scorecard, and only they can say who.
//
// 2. THE QUIZ FORMULA IS NOT THE SAME AS AUGUST'S. August's published 82.19%
//    reproduces exactly as the average across ALL hires, zeros included. June's
//    published 89% does NOT: all-hires gives 84.53%. It matches the average across
//    the people who actually sat the quiz — 89.82% over 48, or 89.88% over the 47
//    completers. So the two classes appear to have been graded different ways, which
//    moves the number by about five points. That is a big enough swing to ask about
//    before either figure is presented.
export const PUBLISHED = {
  newHires: 50,
  completedTraining: 46,
  pctCompletedTraining: '92.00%',
  traineeSatisfaction: '4.87 (97%)',
  quizSuccessRate: '89%',
  churn30: '3 (6.52%)', // the only window closed at time of transcription
  churn60: null,        // due 2026-09-10
  churn90: null,        // due 2026-10-10
  regRate90: null,      // due 2026-10-10
  starModel90: null,    // due 2026-10-10
};

// knowledge = "Total Quiz Score" %, callHandling = the call-listening score,
// total = the weighted 100-point result. sli = Service Level Interaction out of 300.
//
// ATTENDANCE: Class 1's full June 22 – July 10 grid is in the PDF and lates/absences
// below are counted off it. Class 2's grid only shows the final week, so its lates
// and absences are `null` rather than a number that looks complete and is not.
export const JUN_2026 = [
  // ------------------ Class 1 — orientation leaders: Oscar & Paula ------------------
  { slackId: 'U0BCNJD795W', name: 'David Nathan Argones', group: 1, knowledge: 91, sli: 285, callHandling: 85, sysNav: 85, punctuality: 100, engagement: 100, techReadiness: 90, total: 90.05, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBMV1GJAX', name: 'Dominic Ray O. Japay', group: 1, knowledge: 88, sli: 295, callHandling: 80, sysNav: 84, punctuality: 100, engagement: 100, techReadiness: 100, total: 88.20, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBMV1SJUB', name: 'Ernesto Castro Mercado', group: 1, knowledge: 95, sli: 290, callHandling: 88, sysNav: 95, punctuality: 100, engagement: 100, techReadiness: 100, total: 94.50, lates: 0, absences: 0, status: 'active', note: 'Rehire' },
  { slackId: 'U0BBCRBNAHM', name: 'Francis Mejos', group: 1, knowledge: 91, sli: 295, callHandling: 78, sysNav: 88, punctuality: 100, engagement: 100, techReadiness: 100, total: 89.40, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBCRCERUP', name: 'Gerobel Lagat', group: 1, knowledge: 94, sli: 270, callHandling: 82, sysNav: 85, punctuality: 100, engagement: 100, techReadiness: 95, total: 90.45, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBQTQRKUM', name: 'Ian Jhon Gales', group: 1, knowledge: 89, sli: 300, callHandling: 81, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 100, total: 89.95, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBXUQ5JKW', name: 'Jad Cuizon', group: 1, knowledge: 92, sli: 300, callHandling: 80, sysNav: 90, punctuality: 92, engagement: 100, techReadiness: 95, total: 89.55, lates: 1, absences: 1, status: 'active' },
  { slackId: 'U0BBW5KDS65', name: 'Jairo Menocal', group: 1, knowledge: 75, sli: 240, callHandling: 80, sysNav: 84, punctuality: 94, engagement: 100, techReadiness: 100, total: 83.70, lates: 2, absences: 0, status: 'active' },
  { slackId: 'U0BBS7QGM9U', name: 'John Ferdinand Panizales', group: 1, knowledge: 86, sli: 295, callHandling: 80, sysNav: 89, punctuality: 100, engagement: 100, techReadiness: 100, total: 88.60, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBQTQEJ85', name: 'Kristoffer Rasay', group: 1, knowledge: 90, sli: 295, callHandling: 78, sysNav: 89, punctuality: 90, engagement: 100, techReadiness: 90, total: 87.80, lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BCNJ7AH96', name: 'Lolibeth Soria', group: 1, knowledge: 92, sli: 300, callHandling: 85, sysNav: 91, punctuality: 100, engagement: 100, techReadiness: 100, total: 92.05, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBCR8GKCP', name: 'Marco Antonio Mercado Rivas', group: 1, knowledge: 90, sli: 280, callHandling: 80, sysNav: 91, punctuality: 95, engagement: 100, techReadiness: 100, total: 89.70, lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BCNJD0R3J', name: 'Mark Anjolo Gomez', group: 1, knowledge: 92, sli: 295, callHandling: 80, sysNav: 92, punctuality: 100, engagement: 100, techReadiness: 100, total: 91.00, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBMV30T4K', name: 'Melody Sigue', group: 1, knowledge: 89, sli: 290, callHandling: 82, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 100, total: 90.20, lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BCNJBUNFJ', name: 'Norhana Abas', group: 1, knowledge: 94, sli: 300, callHandling: 82, sysNav: 94, punctuality: 94, engagement: 100, techReadiness: 100, total: 91.90, lates: 2, absences: 0, status: 'active' },
  { slackId: 'U07RK4MGAB0', name: 'Oliver Tadeo Castaneda Ortiz', group: 1, knowledge: 95, sli: 280, callHandling: 85, sysNav: 95, punctuality: 90, engagement: 100, techReadiness: 100, total: 92.75, lates: 2, absences: 2, status: 'active', note: 'Rehire' },
  { slackId: 'U0BBS7V6746', name: 'Princess Charmaine Cruz', group: 1, knowledge: 93, sli: 295, callHandling: 78, sysNav: 92, punctuality: 100, engagement: 100, techReadiness: 90, total: 90.30, lates: 0, absences: 1, status: 'active', note: 'Absence was notified ahead of time — she was sick.' },
  { slackId: 'U0BBW5J74CR', name: 'Raffy Ayado', group: 1, knowledge: 90, sli: 285, callHandling: 90, sysNav: 94, punctuality: 100, engagement: 100, techReadiness: 100, total: 93.30, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBQTMUN77', name: 'Rizza E. Abubacar', group: 1, knowledge: 94, sli: 295, callHandling: 80, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 100, total: 91.20, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBUA90H1Q', name: 'Rosemarie Llemit', group: 1, knowledge: 87, sli: 295, callHandling: 80, sysNav: 84, punctuality: 94, engagement: 100, techReadiness: 90, total: 86.80, lates: 2, absences: 0, status: 'active' },
  { slackId: 'U0BBCRD8JH5', name: 'Sheila May Benito', group: 1, knowledge: 96, sli: 300, callHandling: 85, sysNav: 95, punctuality: 100, engagement: 100, techReadiness: 100, total: 94.05, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBQTR0205', name: 'Stephanie Lean', group: 1, knowledge: 82, sli: 225, callHandling: 82, sysNav: 83, punctuality: 100, engagement: 100, techReadiness: 95, total: 86.45, lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBW5G589F', name: 'Vance Andry Bonjoc', group: 1, knowledge: 88, sli: 295, callHandling: 81, sysNav: 84, punctuality: 100, engagement: 100, techReadiness: 95, total: 88.20, lates: 0, absences: 1, status: 'active', note: 'Requested a half day that was approved, then kept changing the time — marked absent instead.' },

  // Class 1, did not finish. No Slack ID recorded for the two who resigned.
  { slackId: null, name: 'Jovin Laud', group: 1, knowledge: 0, sli: 0, callHandling: 0, sysNav: 0, punctuality: 100, engagement: 0, techReadiness: 0, total: 10.00, lates: 0, absences: 0, status: 'terminated', reason: 'Audio issues and no backup — not GoGo ready' },
  { slackId: null, name: 'Fernando Pazzetti', group: 1, knowledge: 0, sli: 0, callHandling: 0, sysNav: 0, punctuality: 0, engagement: 0, techReadiness: 0, total: 0, lates: null, absences: null, status: 'resigned', reason: 'Did not have availability', note: 'Bilingual' },
  { slackId: null, name: 'Daniel Mendoza', group: 1, knowledge: 0, sli: 0, callHandling: 0, sysNav: 0, punctuality: 0, engagement: 0, techReadiness: 0, total: 0, lates: null, absences: null, status: 'resigned', reason: 'Dad is sick', note: 'Bilingual' },

  // ---------------- Class 2 — orientation leaders: Aina & Christene ----------------
  { slackId: 'U0BCNK6QJAC', name: 'Adreanne Palma Gil', group: 2, knowledge: 86.44, sli: 250, callHandling: 98, sysNav: 94, punctuality: 100, engagement: 98, techReadiness: 98, total: 93.93, lates: null, absences: null, status: 'active' },
  { slackId: 'U07RNTAQZ0V', name: 'Alfred R. Joseco', group: 2, knowledge: 96.44, sli: 285, callHandling: 98, sysNav: 95, punctuality: 100, engagement: 100, techReadiness: 98, total: 97.33, lates: null, absences: null, status: 'active', note: 'Rehire' },
  { slackId: 'U0BBW8MGC7M', name: 'Angel Mae Sigue', group: 2, knowledge: 87.56, sli: 270, callHandling: 98, sysNav: 92, punctuality: 100, engagement: 100, techReadiness: 100, total: 94.17, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBW6BELRF', name: 'Babie Jane Nepa', group: 2, knowledge: 93.78, sli: 290, callHandling: 95, sysNav: 90, punctuality: 98, engagement: 95, techReadiness: 100, total: 94.18, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBUB0ETGS', name: 'Bernadette Franco', group: 2, knowledge: 91.56, sli: 290, callHandling: 89, sysNav: 94, punctuality: 90, engagement: 96, techReadiness: 100, total: 92.12, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBN0H85U3', name: 'Christen Honely B. Dadang', group: 2, knowledge: 87.33, sli: 270, callHandling: 84, sysNav: 85, punctuality: 95, engagement: 94, techReadiness: 97, total: 87.95, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBY006W3W', name: 'Denver Laurence Arche', group: 2, knowledge: 87.11, sli: 240, callHandling: 90, sysNav: 86, punctuality: 95, engagement: 92, techReadiness: 98, total: 89.43, lates: null, absences: null, status: 'active' },
  // Slack ID changed mid-class (was U0BBS8EH3JS); the later one is what the system uses now.
  { slackId: 'U0BERLREZ5Y', name: 'Francis Diasanta', group: 2, knowledge: 87.78, sli: 275, callHandling: 90, sysNav: 90, punctuality: 100, engagement: 99, techReadiness: 100, total: 91.73, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBCS827QF', name: 'Gian Carlo Miguel P. Soriano', group: 2, knowledge: 88.67, sli: 290, callHandling: 90, sysNav: 85, punctuality: 100, engagement: 92, techReadiness: 100, total: 90.30, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBW6GGPND', name: 'Gryndel Monggas', group: 2, knowledge: 94.44, sli: 250, callHandling: 95, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 100, total: 95.08, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBS8S2H9U', name: 'James Lloyd Vera', group: 2, knowledge: 89.56, sli: 285, callHandling: 88, sysNav: 86, punctuality: 100, engagement: 90, techReadiness: 100, total: 90.07, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BCNK5M64Q', name: 'Jeffrey Loterono', group: 2, knowledge: 85.11, sli: 270, callHandling: 87, sysNav: 88, punctuality: 96, engagement: 99, techReadiness: 100, total: 89.38, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBUB0QX9Q', name: 'Jessica Navarro', group: 2, knowledge: 92.22, sli: 245, callHandling: 95, sysNav: 92, punctuality: 100, engagement: 99, techReadiness: 100, total: 94.72, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBW6G5AJV', name: 'Jirah Vienne Saad', group: 2, knowledge: 84.00, sli: 245, callHandling: 89, sysNav: 92, punctuality: 90, engagement: 97, techReadiness: 96, total: 89.35, lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BBS8MC3L6', name: 'Karl Anthony Layson', group: 2, knowledge: 90.22, sli: 280, callHandling: 96, sysNav: 86, punctuality: 100, engagement: 100, techReadiness: 100, total: 93.27, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBCRZFMGF', name: 'Kenneth M. Cordero', group: 2, knowledge: 92.22, sli: 270, callHandling: 91, sysNav: 88, punctuality: 100, engagement: 100, techReadiness: 100, total: 93.02, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBS8QLFQW', name: 'Lucille Blanco', group: 2, knowledge: 91.11, sli: 260, callHandling: 90, sysNav: 85, punctuality: 100, engagement: 99, techReadiness: 100, total: 91.73, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBQUN1CNR', name: 'Mark Dennis Suaner', group: 2, knowledge: 82.89, sli: 230, callHandling: 90, sysNav: 85, punctuality: 100, engagement: 99, techReadiness: 95, total: 89.02, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BCNK6CQ9W', name: 'Merlindo jr. Cainoy Caculba', group: 2, knowledge: 88.67, sli: 255, callHandling: 92, sysNav: 93, punctuality: 100, engagement: 100, techReadiness: 100, total: 93.20, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBQUNB4PP', name: 'Riyadh Philip Perez', group: 2, knowledge: 90.89, sli: 290, callHandling: 95, sysNav: 94, punctuality: 97, engagement: 100, techReadiness: 98, total: 94.42, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBW6F54SV', name: 'Rocel Mae C. Villaluz', group: 2, knowledge: 94.00, sli: 280, callHandling: 95, sysNav: 94, punctuality: 100, engagement: 99, techReadiness: 98, total: 95.55, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBQUJ4ALD', name: 'Romel Loreto', group: 2, knowledge: 84.67, sli: 245, callHandling: 90, sysNav: 80, punctuality: 90, engagement: 100, techReadiness: 90, total: 87.40, lates: null, absences: null, status: 'active' },
  { slackId: 'U0BBS8LN5NJ', name: 'Rosana Bonaoy', group: 2, knowledge: 88.89, sli: 265, callHandling: 95, sysNav: 90, punctuality: 100, engagement: 95, techReadiness: 100, total: 92.92, lates: null, absences: null, status: 'active' },
  { slackId: 'U03J9PCJ4UD', name: 'Rotchie Mansigen', group: 2, knowledge: 95.78, sli: 290, callHandling: 98, sysNav: 95, punctuality: 100, engagement: 100, techReadiness: 98, total: 97.13, lates: null, absences: null, status: 'active', note: 'Rehire' },

  // Class 2, did not finish.
  { slackId: 'U0BBW6FRA9F', name: 'Jessa Mae Odac', group: 2, knowledge: 86.89, sli: 245, callHandling: 0, sysNav: 0, punctuality: 0, engagement: 0, techReadiness: 0, total: 26.07, lates: 0, absences: 2, status: 'resigned', reason: 'Headset problem' },
];
