// Everything a human reads is Eastern Time. Vee's rule, 2026-08-31.
//
// There are two different kinds of timestamp here and they must NOT be treated
// the same way:
//
//   1. "When did this job run?" — a real moment in time. Convert it to ET.
//
//   2. A DATETIME read out of the database — e.g. an aggregationDate of
//      "2026-08-19 00:00:00". That is a stored label, not an instant. Railway runs
//      in UTC, so mysql2 hands it back as UTC midnight. Converting THAT to ET would
//      print "Aug 18, 8:00 PM" and silently move a shift to the wrong day. So we
//      read those back with UTC getters, which reproduces the stored value exactly.
//
// Getting this backwards is the kind of bug that quietly shifts a whole cohort's
// churn window by a day, so the two cases live in two named functions.

const ET = 'America/New_York';

/** Right now, in Eastern. For "Run at" and anything else wall-clock. */
export function nowET() {
  return fmtInstantET(new Date());
}

/** A real instant, rendered in Eastern — e.g. "2026-08-31 04:01 PM ET". */
export function fmtInstantET(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}

/**
 * A DATETIME/DATE that came out of the database, reproduced as stored.
 * No timezone maths — that is the point.
 */
export function fmtDbDate(date) {
  if (!(date instanceof Date)) return String(date ?? '');
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const d = `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
  const t = `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
  return t === '00:00:00' ? d : `${d} ${t}`; // a plain DATE stays a plain date
}
