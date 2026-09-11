# GoGo Operator Training & Performance Tracker

**This project has nothing to do with Marketing.** Different department, different data,
different audience. It shares one thing with `Marketing-Growth-OS` — the Railway platform
and the read-only gogo database replica — and nothing else. No shared code, no shared
sheets, no shared Slack channels, no shared job triggers.

## What it is

The operator **training / orientation** team is graded on a scorecard their management
handed them. This automates that scorecard from the database, and then adds a layer they
don't have today: early warning on which new operators are drifting before it shows up in
their numbers.

### The scorecard we have to produce

| Metric | Goal | Source |
| --- | --- | --- |
| New hires | — | SQL — `operators.createdAt` |
| Completed Training | — | class workbook |
| % Completed Training | 90% | class workbook |
| Trainee Satisfaction | 97% | survey (measures the TRAINER, not the operator) |
| Quizzes Success Rate | 85% | class workbook |
| 30-day churn | < 5% | Class workbook + `operators.closedAt` — see "Churn" below |
| 60-day churn | < 10% | same, cumulative |
| 90-day churn | < 15% | same, cumulative |

**Churn (confirmed 2026-09-11 against management's June figure of 3).** Counts from the
first day of training: anyone who left during training *after starting it* (training
total above 0%) counts, plus anyone who completed training and was closed on or before
the milestone. Milestones are graduation + 1, 2, 3 calendar months — the dates their
sheet prints. Denominator is the people who completed training. June: Jessa Mae Odac and
Jovin Laud (left during training) + Oliver Castaneda (closed Jul 22) = 3.

**Registrations** count in calendar months from graduation, graduation day included
(August: Aug 21–Sep 20, Sep 21–Oct 20, Oct 21–Nov 20). Training vs Performance and Hard
Regs both show them as 30d / 60d / 90d columns plus "Reg ratio all 3 months".

**Priority** is judged on one ratio: the month of the class they are in — or, while that
month has no calls yet, the month before; once the 3 months are over, all 3 months
combined. Escalate 11% or under, Watch under 15%, Strong 19% and up. The same thresholds
colour every Reg ratio column red (under 15%) and green (19% and up).

**Order** on Training vs Performance and Hard Regs: lowest ratio first, people with no
ratio yet after them, leavers at the bottom (most recent first).

After 3 months a class leaves Hard Regs, Weekly Trend and Team Leads; Training vs
Performance keeps it with its final numbers.

**Star model** (weighting from Ops, 2026-09-11): weekly, 5 points, each part all or
nothing; a part with no data ("-") counts as passed — that rule reproduces all 359
Overall Stars in management's document. `OPS_TASK=starsources` finds where the parts live;
`OPS_TASK=starcompare` pulls our raw numbers so ours can be checked against theirs before
we calculate it ourselves.
| 90-day reg rate | +15% | SQL — `operatorPerformances` |
| 90-day star model | 3.70+ | definition still needed from Ops |

Five come from SQL and update themselves. Four come from the class workbook and are
manual. One needs a formula from Ops. The tracker is a **join between two sources**, and
the workbook half is the fragile half.

## Separation guarantees

These are structural, not a matter of remembering:

- The Railway service holds **`OPS_SHEET_ID` and no other sheet id.** It cannot write to a
  marketing sheet because it does not know one exists.
- `src/sheets.js` has a **hard write guard** — any write to a spreadsheet id other than
  `OPS_SHEET_ID` throws before the request is made.
- The job trigger is **`OPS_TASK`**, not `DB_TASK`. A stray marketing variable cannot fire
  an operator job, and vice versa.
- Nothing is imported from `Marketing-Growth-OS`. `src/db.js` is a deliberate copy, not a
  shared dependency. The duplication is the point.

## Railway setup

New service, **same Railway project** as Marketing Growth OS (so it inherits the static
outbound IPs already on the DBA's allowlist — the first deploy confirms whether that
holds).

Variables to set:

| Variable | Where it comes from |
| --- | --- |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | copy the values from the Marketing Growth OS service |
| `OPS_SHEET_ID` | `1-RhN9onIdqS0H7gzbnxxqDkNICNiMq7w99GPaU-CUXY` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the shared `gogo-reviews-bot@` service-account JSON |
| `SLACK_BOT_TOKEN` | optional — omit and results go to the sheet only |
| `OPS_SLACK_CHANNEL` | optional — the channel to ping when a job finishes |
| `OPS_TASK` | set to `discover` to run, then remove |

## Jobs

| `OPS_TASK` | Script | What it does |
| --- | --- | --- |
| `discover` | `scripts/discover.js` | Read-only. Inventories every operator table, proves the Slack-ID join, and writes the findings to the sheet. Writes nothing to the database. |
| `transcripts` | `scripts/probe-transcripts.js` | Read-only. Finds out whether call transcripts exist and are readable. |
| `link` | `scripts/probe-link.js` | Read-only. Tries to connect a transcript back to the call it came from. |
| `reports` | `scripts/probe-reports.js` | Read-only. Asks whether the database knows anything about op reports. (Answer: no — they live in Slack.) |
| `tracker` | `scripts/build-tracker.js` | Builds the churn-watch and performance tabs on the tracker sheet. Needs the database. |
| `opreports` | `scripts/build-op-reports.js` | Turns the archived `#op_report` forms into three tabs on the tracker sheet. **Needs no database** — so it runs even while the IP allowlist is broken. |

Set the variable, redeploy, read the sheet, remove the variable.

## Which sheet gets what

Two sheets, and the split is by **audience**, not by size:

| Sheet | Variable | What goes on it |
| --- | --- | --- |
| **GoGo Operator Training & Performance Tracker** | `OPS_TRACKER_SHEET_ID` | Things a trainer or team lead **acts on**. If nobody would change what they do because of it, it does not belong here. |
| **GoGo Operator Tracker — Build Notes (internal)** | `OPS_BUILD_SHEET_ID` | Everything we gather while working something out: probes, schema dumps, access checks, raw rows, anything that answers "says who?". |

A 281-row table of every op report is important **and** belongs on the build sheet.
A trainer opening the team sheet needs to know what to teach differently, not to scroll.

`writeTab` defaults to the **build** sheet deliberately: writing to the team sheet has
to be a deliberate choice, never something that happens because a default drifted.

## Running it daily

`OPS_TASK` is one-shot: set it, redeploy, read the sheet, remove it. Good for probes
and for anything you want to watch happen.

For a standing refresh use **`OPS_DAILY`** instead, and leave it set:

| Variable | Value | Meaning |
| --- | --- | --- |
| `OPS_DAILY` | `tracker` | tasks to run on a schedule, comma separated |
| `OPS_DAILY_AT` | `0 6 * * *` | optional cron expression, default 6am |

The schedule runs in **Eastern time**, not UTC. That is deliberate: in UTC a "6am" job
would drift an hour twice a year against every date on the sheet, and a run landing
either side of midnight would stamp the wrong day.

Two guards worth knowing about:

- An unknown task name in `OPS_DAILY` is logged and ignored, never guessed at.
- If a run is somehow still going when the next one is due, the new one is skipped.
  Two overlapping writes to the same tabs is how you end up with half a table.

Every per-operator tab carries a **Last updated** line directly under its header, in
Eastern, so nobody has to wonder whether they are reading this morning's numbers or
last month's. It is one row rather than a column, because the whole tab is rewritten
in a single pass — as a column it would print the same instant on every row.

## Op reports — how they get here

The `#op_report` Slack channel (G8HDD60Q6) is where reviewers file a structured form
every time they catch something on a call. It is the richest signal we have about what
operators actually get wrong, and far better than the `qualityAssurances` table, which
flags 93.4% of calls positive.

The pipeline is deliberately half-manual, and the README says so rather than implying
otherwise:

1. **Collecting — by hand.** Reading a private Slack channel needs a bot token with
   history scope, which we do not have. Reports are pulled manually and saved as JSON
   under `data/op-reports/`, one file per pull, named by date range. Files are merged
   and deduped by Slack message timestamp, so overlapping pulls are safe.
2. **Counting — automatic.** `src/op-reports.js` does all of it. Every number in any
   report we hand to a trainer comes from there and can be re-derived.
3. **Publishing — automatic.** `OPS_TASK=opreports`.

**No customer PII.** The Slack form carries customer name, phone number, and the number
they called from. The archive does not contain those fields and nothing here writes them.

**Known limit.** The Slack reader truncates long fields with `...` — 124 of the first 281
reports arrive with text cut off. Theme counts survive it; individual corrections may be
half-sentences. A real bot token calling `conversations.history` would fix it.

**Themes are multi-label on purpose.** A report is counted under every theme it mentions.
The first version forced one theme per report and the ranking changed depending on which
keyword list ran first — 94 of 281 reports are about two things at once. Totals therefore
add to more than the number of reports.

## Run Log

Every tracker run adds one line to a **Run Log** tab — newest on top, last seven days
only:

| When | Where | Status | Outbound IP | Detail | Deployment |

- **Build Notes** gets every run, including local test runs.
- **The team sheet** gets real Railway runs only.

Rows are matched to the tab's columns by header name, so the columns can be reordered
or renamed ("When (Eastern)" and "When" count as the same) without breaking anything.
An existing Run Log tab is never restyled.

The IP matters because the database only accepts allowlisted addresses. Railway keeps
one address for the life of a deployment — so if two runs show the same Deployment,
they will always show the same IP.
