// Slack IDs transcribed from the training documents (2026-08-31).
//
// These exist for ONE job: proving the join. If `operators.slackId` matches these,
// the whole tracker works — training-time data on one side, lifetime performance on
// the other, joined on this column. If it does not match, we need a different key
// and we need to know that before building anything.
//
// The mix is intentional: brand-new hires, tenured operators, and people who were
// terminated. A key that only works for active operators is not a key.

export const CLASS_SLACK_IDS = [
  // ---- August 2026 class, group 1 (Oscar & Christene) ----
  { slackId: 'U0BLV30S7C6', name: 'Berdannette Ranera', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BBS8MLYA2', name: 'Daryl Molina', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLTP7UGG5', name: 'Dasheil Gonzaga', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLQQMDK6F', name: 'Fely Mostajo', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLV2R9UKY', name: 'Ghislaine Entera', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLX2FTK34', name: 'Jayson Acedo', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BCNJANAUQ', name: 'Jorgy Mendoza', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLFM25LLF', name: 'Jude Cabaljog', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLV2W73FY', name: 'Juffrey Canaña', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLX2DKGHG', name: 'Karl Polinar', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLV2XPBFY', name: 'Kelly Millama', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLX2C6LAE', name: 'Lloyd Kelim', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BMRC6AM32', name: 'Mark Agpas', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLZ0FJ0RX', name: 'Roderica Tambis', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLV30066S', name: 'Rodney Hermoso', cohort: 'aug-2026-c1', status: 'active' },
  { slackId: 'U0BLFM09LCX', name: 'Shirley Sumega', cohort: 'aug-2026-c1', status: 'active' },
  // Terminated during or just after orientation — the churn cases.
  { slackId: 'U0BLQQR9QFM', name: 'Ezra Pagtan', cohort: 'aug-2026-c1', status: 'terminated' },
  { slackId: 'U0BMRCGSYEL', name: 'Karen Nicole Romero Ayala', cohort: 'aug-2026-c1', status: 'terminated' },

  // ---- August 2026 class, group 2 (Aina & Ki) ----
  { slackId: 'U0BLX2LDRPC', name: 'Aldrin Guadalupe', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLX2MS602', name: 'Arianne Comique', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLFM65BCP', name: 'Barbara Anito', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLTPDNKJ9', name: 'Daniel Manalo', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLV2UG5RU', name: 'Grapes Seladores', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLZ0H1L6M', name: 'Janriel Cauba', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLFM0UU07', name: 'Jim Apusaga', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLX2KTMPC', name: 'Jiro Sombilon', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLQQVRSJF', name: 'John Cornelious Villamor', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLTPCBN3F', name: 'Krisha Isobelle Enderes', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLTP83SBF', name: 'Maricar Garcia', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLX2AK41Y', name: 'Queen Lopez', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BM0NUTDU4', name: 'Rea Tomelden Discaya', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLTP73FS9', name: 'Rocell Iyana', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLQNDVBHD', name: 'Ruwie Keryn Goloran', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLZ0KE94H', name: 'Sabrina Daan', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BM0P038DS', name: 'Shani Oppus', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLX2N8TJN', name: 'Whilhelmina Verano', cohort: 'aug-2026-c2', status: 'active' },
  { slackId: 'U0BLFM1ST8X', name: 'Faye Marie Villegas', cohort: 'aug-2026-c2', status: 'terminated' },

  // ---- June 2026 cohort (hired 6/22) — far enough along to have real numbers ----
  { slackId: 'U0BBW5KDS65', name: 'Jairo Menocal', cohort: 'jun-2026', status: 'active' },

  // ---- Tenured operators from Op's Refresher — the "does this key work for
  //      long-timers too" control group ----
  { slackId: 'U0AKQKPTHCZ', name: 'Peach Mayen Rance', cohort: 'tenured', status: 'active' },
  { slackId: 'U0B33045F3L', name: 'Rochilme Anticuando', cohort: 'tenured', status: 'active' },
  { slackId: 'U0B3X8DJXEU', name: 'John Henry Ibañez', cohort: 'tenured', status: 'active' },
  { slackId: 'U067UBHBQ01', name: 'Ulece Paña Bayocboc', cohort: 'tenured', status: 'active' },
  { slackId: 'U0B34S7M4C9', name: 'Franz Christian Lainez', cohort: 'tenured', status: 'active' },
  { slackId: 'U0ARXJWKEJX', name: 'Maria Trixia Lustañas', cohort: 'tenured', status: 'active' },
  { slackId: 'U07A8181AFL', name: 'Marjorie Venenoso', cohort: 'tenured', status: 'active' },
  { slackId: 'U07A7T7SJUB', name: 'Cherilyne Mehoy', cohort: 'tenured', status: 'active' },
  { slackId: 'U07MSRGUUJV', name: 'Jucille Lugares', cohort: 'tenured', status: 'active' },
  { slackId: 'U05N58LFUHY', name: 'Regine Previlla', cohort: 'tenured', status: 'active' },
  { slackId: 'U0B34S61EBT', name: 'Jovyro Farole', cohort: 'tenured', status: 'active' },
  { slackId: 'U0AKQKJ05R7', name: 'Veejay Ramos', cohort: 'tenured', status: 'active' },
  { slackId: 'U09M01W4QKV', name: 'Anne Marie Lorraine Gurat', cohort: 'tenured', status: 'active' },
  { slackId: 'U0AED9H5UDN', name: 'Razzel Erbito', cohort: 'tenured', status: 'active' },
  { slackId: 'U0ADFFAE8VB', name: 'Jiella Dolero', cohort: 'tenured', status: 'active' },
  { slackId: 'U04J409UAF6', name: 'John Paul Carl Mendoza', cohort: 'tenured', status: 'active' },
  { slackId: 'U08UTERJXHQ', name: 'Deo Pambid', cohort: 'tenured', status: 'active' },
  { slackId: 'U0B2MHEHX8F', name: 'Jerwin Martus', cohort: 'tenured', status: 'active' },
  { slackId: 'U0ADK0T3B34', name: 'Jonathan Rebucas', cohort: 'tenured', status: 'active' },
  { slackId: 'U097YHAAF7S', name: 'Michael Joshua Felisilda', cohort: 'tenured', status: 'active' },
  { slackId: 'U04J1G2JUAW', name: 'Emily Bermejo', cohort: 'tenured', status: 'active' },
  { slackId: 'U0B3X9VFV5W', name: 'Sweet Mary Dela Rama', cohort: 'tenured', status: 'active' },
  { slackId: 'U045HGAS5R6', name: 'Yvone Lascuña', cohort: 'tenured', status: 'active' },
  { slackId: 'U09UENBFDDJ', name: 'Novie Grace Dizon', cohort: 'tenured', status: 'active' },
  { slackId: 'U039SEC9GD9', name: 'Mercylene Catubig', cohort: 'tenured', status: 'active' },
  { slackId: 'U0AK89SA2UV', name: 'Vaughn Yestin Evangelista', cohort: 'tenured', status: 'active' },
  { slackId: 'U03JRAAJJKT', name: 'Cristine Mendoza', cohort: 'tenured', status: 'active' },
  { slackId: 'U08JSP5ULSV', name: 'Ricky Cole', cohort: 'tenured', status: 'active' },
  { slackId: 'U0600KJDSQL', name: 'Vanessa Sanjorjo', cohort: 'tenured', status: 'active' },
];

// Same person, two different Slack IDs across two documents. Somebody's manual
// sheet is wrong, and we cannot tell which from the paperwork alone — the database
// settles it. Reported by the discovery job so the training team can fix the source.
export const CONFLICTING_IDS = [
  { name: 'Eleonor Andres', ids: ['U0BLXQWJMQA', 'U0BMRCD54SC'] },
  { name: 'Sheryl Dela Vega', ids: ['U0BLXQTKF3L', 'U0BLX2EFN2W'] },
  { name: 'Kerine Lyn Unos', ids: ['U077J9CQHA4', 'U07FJ9CQHA4'] },
];
