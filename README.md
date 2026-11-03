# CCH Grants Command Center

A web app for tracking grants from pre-award through closeout: award set-up and Board gating, spend pace and
lapse risk, budget lines, invoices and drawdowns, time and effort, reports, subrecipients, amendments, closeout,
and a risk log. **Smartsheet is the database.** Every kind of record lives in its own sheet in a Smartsheet
folder you choose, with real columns, so your team can also filter, report on and share the data in Smartsheet.

```
Browser  ──►  Render web service (Node)  ──►  Smartsheet API  ──►  19 sheets (IDs in sheets.json)
              (API, in-memory cache)
```

* The page is the same app you have been using. A small server replaces the claude.ai database.
* Reads come from an in-memory copy. Writes go to Smartsheet first, then update the copy.
* Edits people make directly in Smartsheet appear in the app within about 20 seconds.

---

## 1. What you need

| You need | Notes |
|---|---|
| A Smartsheet account with API access | The Smartsheet API is limited to Business and Enterprise plans. |
| An API token | Smartsheet → Account → Personal Settings → API Access. **Use a dedicated service account** (not a person's login). The account's name appears as "Modified by" in Smartsheet, and the app can only reach what that account can reach. |
| The 19 app sheets | Already created in the CCH folder (ID `7432624944768900`); their IDs are listed in `sheets.json`. **Share those sheets (or the folder) with the service account as Editor.** |
| A GitHub account and a Render account | See sections 4 and 5. |

If CCH uses Smartsheet Gov, EU or AU, set `SMARTSHEET_API_BASE` (see the table in section 7).

## 2. Try it first (no Smartsheet needed)

```bash
npm install
npm run demo        # http://localhost:3000   (no sign-in)
```

Open **/import** and load `seed/seed.json` to see the app with your starter data. A pretend Smartsheet
runs in memory, so nothing is saved when you stop it.

## 3. Check your real Smartsheet connection

```bash
cp .env.example .env        # fill in SMARTSHEET_ACCESS_TOKEN (the folder ID is optional)
node --env-file=.env scripts/doctor.js      # Node 20.6+; or export the variables yourself
```

`doctor` opens all 19 sheets from `sheets.json` and checks their columns. If `SMARTSHEET_FOLDER_ID` is set it also
creates a throwaway sheet, writes and reads a row, tests clearing a date, a checkbox and text, and deletes the sheet. **Run this before you deploy.** The automated tests use a stand-in for Smartsheet that
follows its documentation; `doctor` is the check against the real service.

Optional: create all sheets now from your own computer.

```bash
node --env-file=.env scripts/setup.js
```

(The server does the same thing automatically at startup, so this is only for convenience.)

## 4. Put it on GitHub

Use a **private** repository. The code contains no secrets, but it describes your grant process.

```bash
git init
git add .
git commit -m "CCH Grants Command Center"
git branch -M main
git remote add origin https://github.com/<your-org>/<your-repo>.git
git push -u origin main
```

`.gitignore` already keeps `.env`, `node_modules` and `seed/seed.json` (your real grant data) out of Git.
GitHub Actions runs the tests on every push (`.github/workflows/test.yml`).

## 5. Deploy on Render

1. Render dashboard → **New → Blueprint** → select your repository. Render reads `render.yaml`.
2. Render asks for one value: `SMARTSHEET_ACCESS_TOKEN` (section 1). There is no password to set; see section 9.
3. Click **Apply**. On first start the app opens the 19 sheets by ID and adds any missing columns (about a minute).
4. Open the Render URL. The 19 sheets already hold the baseline data (7 grants, 44 tasks, 9 risks, 9 reports and more),
   so there is nothing to import. (`/import` with `seed/seed.json` skips records that already exist, so it is harmless.)

Keep the service at **one instance** (`numInstances: 1`). The app caches Smartsheet data in memory and queues
writes per sheet. The Starter plan stays awake; a free web service sleeps when idle and wakes slowly.

## 6. Working with the data in Smartsheet

Sheets are named `CCH Grants - Grants`, `CCH Grants - Tasks`, and so on. The app's **/sheets** page lists them with links.

Safe to do in Smartsheet: filter, sort, group, hide or reorder columns, add your own columns (including formulas),
format, build reports and dashboards, share sheets, edit cell values, add or delete rows.

Please don't: rename or delete the app's columns, or edit the **`_id`** and **`_extra`** columns. A column that is
removed is added back at the next restart. A row you add by hand is "adopted": it gets an id and appears in the app.

Dates are real Smartsheet dates, yes/no fields are checkboxes, and numbers are numbers. Nested data (for example
the monthly spend plan) is stored as JSON text in a column ending in "(JSON)".

## 7. Settings

| Variable | Required | What it does |
|---|---|---|
| `SMARTSHEET_ACCESS_TOKEN` | yes | API token of the service account. |
| `SMARTSHEET_FOLDER_ID` | no | Only for `npm run doctor`'s write test, or to auto-create a sheet that has no ID in `sheets.json`. |
| `SHEET_IDS` | no | JSON that overrides `sheets.json`. |
| `SMARTSHEET_API_BASE` | no | Default `https://api.smartsheet.com/2.0`. Gov: `https://api.smartsheetgov.com/2.0`. EU: `https://api.smartsheet.eu/2.0`. AU: `https://api.smartsheet.au/2.0`. |
| `POLL_SECONDS` | no | How often to check Smartsheet for direct edits (default 20). |
| `PORT` | no | Set by Render. |

## 8. Limits and how the app handles them

| Smartsheet limit | What the app does |
|---|---|
| 300 API requests per minute per token | Keeps itself under 240. Background checks back off when the budget runs low so edits are never starved. On a 429 it pauses for a minute, as Smartsheet advises. Polling pauses completely when nobody is using the app. |
| One write at a time per sheet | Writes to a sheet are queued. Error 4004 is retried. |
| 500 rows per write | Imports are sent in batches of 500. |
| 4,000 characters per cell | A longer value is refused with a clear message instead of being silently cut. |
| 20,000 rows and 500,000 cells per sheet | The activity log keeps the newest 3,000 entries. Other sheets have room for years of normal use. |
| Text starting with `=` becomes a formula | Such text is stored with an invisible marker so it stays text. |

All users share one token, so Smartsheet's own "Modified by" shows the service account. The app's **Activity Log**
records "CCH user" for every change until sign-in is added.

## 9. Security notes

* **There is no sign-in yet.** Anyone who has the URL can read and change every record. Until sign-in is added,
  do not share or post the URL, and treat it like a password. Sign-in is meant to be added later, the way it was for
  the CCH Legal app: everything about "who is this person" lives in `lib/auth.js` (`identify(req)`), so adding
  single sign-on or a proxy header check is a change to that one file. Writes still require an app-only request
  header, and a strict content security policy is set.
* Do not store patient information here. The app is designed for grant, budget and staffing data.
* **Backup** (link in the top bar for editors, or `/api/export`) downloads every record as one JSON file that
  **/import** can restore.
* Rotate the token by generating a new one in Smartsheet and updating it in Render.

## 10. Changing the data model

Fields and sheets are defined in `lib/schema.js`. Add a field and its column is created automatically at the next
start. A field the app writes that is not in the schema is kept in the `_extra` column, so nothing is lost.

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Starting up. Connecting to Smartsheet…" stays on | Wrong token, or the service account has no access to the sheets (the log names the sheet and ID it could not open). The Render log shows the reason. Fix the variable and redeploy. |
| 401 or 403 from Smartsheet in the log | Token revoked, wrong region (`SMARTSHEET_API_BASE`), or no access to the sheets. |
| Saves fail with "too long" | A text field is over 4,000 characters. Shorten it. |
| "That record changed in Smartsheet" | Someone deleted the row in Smartsheet. Refresh. |
| Slow right after a deploy or wake-up | The app is loading every sheet once (about 40 requests). |

## 12. What was tested

Automated: 47 checks run against a stand-in Smartsheet that follows its documented behaviour (paging, 500-row
limit, 4,000-character cells, strict types, clearing, versions, 429 and 4004 errors), plus a browser run through
import, editing, the open-access default, the identity hook (editor and view-only) and live updates. **Not tested:** the real Smartsheet service. Run
`scripts/doctor.js` first.

## Commands

```
npm install      install dependencies
npm start        run the server (needs the variables above)
npm run demo     try the app with a pretend Smartsheet
npm run doctor   check the real Smartsheet connection
npm run setup    create the sheets now
npm test         run the automated checks
```
