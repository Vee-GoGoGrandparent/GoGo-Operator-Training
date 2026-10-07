# GoGo Academy

Pin placement practice and class pin tests for GoGo orientation. Built from Oscar's pin trainer idea.

- **Practice:** trainees pick a hard place, the pin starts where Google drops it (like the dashboard), they move
  it to where the driver should stop, then see the right spot, the distance and *why*.
- **Tests:** a trainer builds a test for one class (addresses, pass distance, how many right pins to pass, time
  limit) and opens it. One go per trainee, timer enforced by the server, no hints until hand-in.
- **Trainer screens:** addresses (set the right pin and the reason), build tests, results by class with a CSV,
  which addresses the class gets wrong, people and classes.
- **The call in steps:** an admin sets the call's steps in the scenario editor. Each step shows a few lines (best: the
  right one plus two that sound right), and one or two can be right. Practice: a wrong pick says "Not quite" and they
  pick again (still a miss). Test: the wrong line is said, the call goes on, and it is graded at the end. A call
  with no steps shows every line at once, as before.
- **Pin skills:** every call teaches one situation (place or business name, past rides, multiple entrances,
  hospitals and clinics, airports, apartments and complexes, drop-off checks, confirm the address). Practice is
  grouped by skill with a one-line tip; Scenarios shows how many calls each skill has (3 = 2 practice + 1 test).
  The list and tips live in `src/skills.js`.
- **Sign in with Slack.** No passwords. Trainers = `ADMIN_SLACK_IDS` plus anyone a trainer promotes in the app.

Scoring always happens on the server; answers are never sent to the browser before a trainee answers.
Use public places only (hospitals, airports, complexes), never a customer's home address.

## Run locally

```
DEV_LOGIN=1 npm start        # test sign-in without Slack (refused on Railway)
npm test                     # end-to-end check on a throwaway database
```

## Railway variables

| Variable | What |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Browser key, restricted to this site's address and to Maps JavaScript API, Places API (New), Geocoding API |
| `GOOGLE_MAP_ID` | Optional. A Map ID from Google Cloud; without it the demo map style is used |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | From the "GoGo Pin Academy" Slack app (Sign in with Slack) |
| `SLACK_TEAM_ID` | GoGo's Slack workspace ID, so only GoGo accounts can sign in |
| `ADMIN_SLACK_IDS` | Comma-separated Slack IDs of trainers |
| `SESSION_SECRET` | 32+ random characters |
| `PUBLIC_URL` | The site's https address |
| `DATA_DIR` | Where the volume is mounted, e.g. `/data` (the database file lives there) |

Node 22.5+ (uses the built-in SQLite). No other dependencies.
