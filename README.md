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
| 30-day churn | < 5% | SQL — `operators.closedAt` |
| 60-day churn | < 10% | SQL |
| 90-day churn | < 15% | SQL |
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

Set the variable, redeploy, read the sheet, remove the variable.
