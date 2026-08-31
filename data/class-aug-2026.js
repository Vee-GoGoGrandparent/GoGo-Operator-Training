// August 2026 class — training-side data, transcribed from "August 2026 Class.pdf"
// (shared 2026-08-31). Class ran Aug 3–21, 2026. Two groups.
//
// ⚠️ PROVENANCE: this was read out of a PDF by hand. It is good enough to prove
// the join and to look for patterns, but it is NOT a sustainable source — next
// month's class will arrive as another PDF and none of this updates itself. The
// real fix is read access to the live class workbook. Until then, treat these
// numbers as needing a spot-check against the source sheet.
//
// WHY IT MATTERS: this is the training half of the picture. The database knows
// what an operator DID after graduating; only this knows what they looked like
// before. Forecasting who will struggle needs both.
//
// Weighting the team uses: Knowledge 30% · Call Handling 25% · System Navigation
// 20% · Punctuality & Participation 10% · Engagement 10% · Technical Readiness 5%.

export const CLASS_META = {
  cohort: 'aug-2026',
  classStart: '2026-08-03', // the HIRE DATE the team uses — first day of orientation
  classEnd: '2026-08-21',   // graduation; the 90-day clock starts after this
  weeks: 3,
  quizPassMark: 0.8,
};

// knowledge = "Total Quiz Score" %, callHandling = the call-listening score,
// total = the weighted 100-point result. sli = the Service Level Interaction
// score out of 300. lates/absences counted off the daily attendance grid.
export const AUG_2026 = [
  // ---------------- Group 1 (orientation leaders: Oscar & Christene) ----------------
  { slackId: 'U0BLV30S7C6', name: 'Berdannette Ranera', group: 1, knowledge: 90.00, sli: 275, callHandling: 94, sysNav: 89, punctuality: 100, engagement: 98, techReadiness: 100, total: 93.10, personality: 'Owl', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BBS8MLYA2', name: 'Daryl Molina', group: 1, knowledge: 89.11, sli: 285, callHandling: 90, sysNav: 90, punctuality: 100, engagement: 95, techReadiness: 100, total: 91.73, personality: 'Eagle', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLTP7UGG5', name: 'Dasheil Gonzaga', group: 1, knowledge: 89.56, sli: 295, callHandling: 86, sysNav: 95, punctuality: 100, engagement: 98, techReadiness: 100, total: 92.17, personality: 'Owl', lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BLXQWJMQA', name: 'Eleonor Andres', group: 1, knowledge: 85.33, sli: 255, callHandling: 93, sysNav: 90, punctuality: 100, engagement: 95, techReadiness: 100, total: 91.35, personality: 'Owl', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLQQR9QFM', name: 'Ezra Pagtan', group: 1, knowledge: 0, sli: 0, callHandling: 0, sysNav: 0, punctuality: 0, engagement: 0, techReadiness: 0, total: 0.00, personality: null, lates: 1, absences: 0, status: 'terminated', reason: '' },
  { slackId: 'U0BLQQMDK6F', name: 'Fely Mostajo', group: 1, knowledge: 81.56, sli: 255, callHandling: 86, sysNav: 83, punctuality: 100, engagement: 100, techReadiness: 100, total: 87.57, personality: 'Owl', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLV2R9UKY', name: 'Ghislaine Entera', group: 1, knowledge: 83.56, sli: 290, callHandling: 86, sysNav: 89, punctuality: 100, engagement: 95, techReadiness: 100, total: 88.87, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLX2FTK34', name: 'Jayson Acedo', group: 1, knowledge: 90.89, sli: 260, callHandling: 92, sysNav: 90, punctuality: 90, engagement: 95, techReadiness: 90, total: 91.27, personality: 'Dove', lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BCNJANAUQ', name: 'Jorgy Mendoza', group: 1, knowledge: 84.44, sli: 255, callHandling: 94, sysNav: 90, punctuality: 80, engagement: 98, techReadiness: 80, total: 88.63, personality: 'Owl', lates: 4, absences: 0, status: 'active', note: 'Rehired into this class; was in an earlier one, father had a heart attack.' },
  { slackId: 'U0BLFM25LLF', name: 'Jude Cabaljog', group: 1, knowledge: 92.44, sli: 295, callHandling: 84, sysNav: 90, punctuality: 100, engagement: 95, techReadiness: 100, total: 91.23, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLV2W73FY', name: 'Juffrey Canaña', group: 1, knowledge: 87.33, sli: 285, callHandling: 86, sysNav: 90, punctuality: 100, engagement: 98, techReadiness: 100, total: 90.50, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BMRCGSYEL', name: 'Karen Nicole Romero Ayala', group: 1, knowledge: 41.56, sli: 0, callHandling: 0, sysNav: 0, punctuality: 0, engagement: 0, techReadiness: 0, total: 12.47, personality: 'Peacock', lates: 1, absences: 5, status: 'terminated', reason: '' },
  { slackId: 'U0BLX2DKGHG', name: 'Karl Polinar', group: 1, knowledge: 86.67, sli: 245, callHandling: 88, sysNav: 87, punctuality: 90, engagement: 95, techReadiness: 90, total: 88.40, personality: 'Dove', lates: 1, absences: 1, status: 'active' },
  { slackId: 'U0BLV2XPBFY', name: 'Kelly Millama', group: 1, knowledge: 92.67, sli: 290, callHandling: 96, sysNav: 94, punctuality: 100, engagement: 98, techReadiness: 95, total: 95.15, personality: 'Dove', lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BLX2C6LAE', name: 'Lloyd Kelim', group: 1, knowledge: 86.22, sli: 265, callHandling: 88, sysNav: 90, punctuality: 100, engagement: 98, techReadiness: 90, total: 90.17, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BMRC6AM32', name: 'Mark Agpas', group: 1, knowledge: 94.22, sli: 285, callHandling: 95, sysNav: 97, punctuality: 100, engagement: 98, techReadiness: 100, total: 96.22, personality: 'Owl', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLZ0FJ0RX', name: 'Roderica Tambis', group: 1, knowledge: 84.89, sli: 270, callHandling: 85, sysNav: 94, punctuality: 100, engagement: 95, techReadiness: 90, total: 89.52, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLV30066S', name: 'Rodney Hermoso', group: 1, knowledge: 86.22, sli: 280, callHandling: 90, sysNav: 90, punctuality: 100, engagement: 98, techReadiness: 85, total: 90.42, personality: 'Owl', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLX2EFN2W', name: 'Sheryl Dela Vega', group: 1, knowledge: 66.89, sli: 0, callHandling: 0, sysNav: 0, punctuality: 0, engagement: 0, techReadiness: 0, total: 20.07, personality: 'Peacock', lates: 3, absences: 0, status: 'terminated', reason: 'Failed SLI, tech issues and tardy' },
  { slackId: 'U0BLFM09LCX', name: 'Shirley Sumega', group: 1, knowledge: 84.22, sli: 270, callHandling: 86, sysNav: 90, punctuality: 100, engagement: 94, techReadiness: 85, total: 88.42, personality: 'Dove', lates: 0, absences: 0, status: 'active' },

  // ---------------- Group 2 (orientation leaders: Aina & Ki) ----------------
  { slackId: 'U0BLX2LDRPC', name: 'Aldrin Guadalupe', group: 2, knowledge: 87.56, sli: 245, callHandling: 80, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 98, total: 89.17, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLX2MS602', name: 'Arianne Comique', group: 2, knowledge: 93.78, sli: 280, callHandling: 88, sysNav: 85, punctuality: 100, engagement: 100, techReadiness: 100, total: 92.13, personality: 'Owl', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLFM65BCP', name: 'Barbara Anito', group: 2, knowledge: 85.78, sli: 225, callHandling: 83, sysNav: 85, punctuality: 85, engagement: 98, techReadiness: 97, total: 86.63, personality: 'Dove', lates: 1, absences: 1, status: 'active' },
  { slackId: 'U0BLTPDNKJ9', name: 'Daniel Manalo', group: 2, knowledge: 90.22, sli: 260, callHandling: 80, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 100, total: 90.07, personality: 'Owl', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLFM1ST8X', name: 'Faye Marie Villegas', group: 2, knowledge: 76.44, sli: 0, callHandling: 0, sysNav: 0, punctuality: 0, engagement: 0, techReadiness: 0, total: 22.93, personality: 'Owl', lates: 0, absences: 0, status: 'terminated', reason: '2 NCNS' },
  { slackId: 'U0BLV2UG5RU', name: 'Grapes Seladores', group: 2, knowledge: 93.33, sli: 270, callHandling: 84, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 100, total: 92.00, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLZ0H1L6M', name: 'Janriel Cauba', group: 2, knowledge: 89.56, sli: 275, callHandling: 73, sysNav: 75, punctuality: 95, engagement: 100, techReadiness: 96, total: 84.42, personality: 'Peacock', lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BLFM0UU07', name: 'Jim Apusaga', group: 2, knowledge: 86.67, sli: 270, callHandling: 75, sysNav: 83, punctuality: 95, engagement: 100, techReadiness: 100, total: 85.85, personality: 'Dove', lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BLX2KTMPC', name: 'Jiro Sombilon', group: 2, knowledge: 87.11, sli: 235, callHandling: 80, sysNav: 75, punctuality: 95, engagement: 100, techReadiness: 94, total: 85.33, personality: 'Owl', lates: 1, absences: 0, status: 'active' },
  { slackId: 'U0BLQQVRSJF', name: 'John Cornelious Villamor', group: 2, knowledge: 88.22, sli: 265, callHandling: 92, sysNav: 80, punctuality: 100, engagement: 100, techReadiness: 97, total: 90.32, personality: 'Eagle', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLTPCBN3F', name: 'Krisha Isobelle Enderes', group: 2, knowledge: 92.89, sli: 285, callHandling: 87, sysNav: 85, punctuality: 100, engagement: 100, techReadiness: 98, total: 91.52, personality: 'Owl', lates: 0, absences: 0, status: 'active' },
  { slackId: null, name: 'Laurence Sindol', group: 2, knowledge: 0, sli: 0, callHandling: 0, sysNav: 0, punctuality: 0, engagement: 0, techReadiness: 0, total: 0.00, personality: 'Owl', lates: 0, absences: 0, status: 'resigned', reason: 'Family emergency, needs to tend to his dad' },
  { slackId: 'U0BLTP83SBF', name: 'Maricar Garcia', group: 2, knowledge: 82.44, sli: 260, callHandling: 80, sysNav: 75, punctuality: 100, engagement: 100, techReadiness: 100, total: 84.73, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLX2AK41Y', name: 'Queen Lopez', group: 2, knowledge: 91.33, sli: 290, callHandling: 95, sysNav: 90, punctuality: 90, engagement: 100, techReadiness: 100, total: 93.15, personality: 'Dove', lates: 0, absences: 1, status: 'active' },
  { slackId: 'U0BM0NUTDU4', name: 'Rea Tomelden Discaya', group: 2, knowledge: 91.78, sli: 275, callHandling: 83, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 100, total: 91.28, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLTP73FS9', name: 'Rocell Iyana', group: 2, knowledge: 93.56, sli: 295, callHandling: 89, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 98, total: 93.22, personality: 'Eagle', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLQNDVBHD', name: 'Ruwie Keryn Goloran', group: 2, knowledge: 92.67, sli: 285, callHandling: 76, sysNav: 90, punctuality: 100, engagement: 100, techReadiness: 90, total: 89.30, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BLZ0KE94H', name: 'Sabrina Daan', group: 2, knowledge: 90.00, sli: 270, callHandling: 78, sysNav: 85, punctuality: 100, engagement: 100, techReadiness: 100, total: 88.50, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
  { slackId: 'U0BM0P038DS', name: 'Shani Oppus', group: 2, knowledge: 87.33, sli: 280, callHandling: 77, sysNav: 80, punctuality: 85, engagement: 100, techReadiness: 95, total: 84.70, personality: 'Dove', lates: 1, absences: 1, status: 'active' },
  { slackId: 'U0BLX2N8TJN', name: 'Whilhelmina Verano', group: 2, knowledge: 89.33, sli: 260, callHandling: 72, sysNav: 75, punctuality: 100, engagement: 100, techReadiness: 100, total: 84.80, personality: 'Dove', lates: 0, absences: 0, status: 'active' },
];

export const bySlackId = Object.fromEntries(AUG_2026.filter((r) => r.slackId).map((r) => [r.slackId, r]));
