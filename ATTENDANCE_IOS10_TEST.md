# iOS 10.3.4 attendance test

This branch provides a separate attendance test site for the older iPad. It uses a dedicated Worker and SQLite Durable Object, with no production database, KV, file storage, custom-domain routes or scheduled jobs.

## Open the test

After the test deployment succeeds, open:

`https://panelstock-attendance-ios10-test.matthewlakerdis.workers.dev/sign-in/manage/`

Use the public demo account **ipadtest**, PIN **103434**. Use made-up names and contact details only. These credentials work only in the isolated test environment.

Create a station link, then use **Open sign-in station** on the old iPad. Its test link must stay on `panelstock-attendance-ios10-test.matthewlakerdis.workers.dev`. The production web app and its existing paired stations are separate.

## Device checks

1. Open the link in Safari on the iPad running iOS 10.3.4. Confirm the test banner and Lennox Facades logo appear, followed by the sign-in controls.
2. Sign in one made-up visitor, contractor and employee. Check the keyboard, required fields, button sizes, success message and screen reset in portrait and landscape.
3. Open **Sign out**. All three people should appear automatically. Tap one row to sign that visit out, then reopen the list and check that person has disappeared.
4. Add another person and use **Refresh** to update the list. Confirm the list can scroll naturally and that text fields do not cause unwanted page zoom.
5. Temporarily disconnect Wi-Fi and attempt an arrival or departure. There should be an error or timeout, never a false saved confirmation. Reconnect and retry the same action; it must save only once.

Use **Open sign-in station** when setting up the iPad. The test administrator screen uses a selectable CSV preview because file downloads behave differently in older Safari. Real-device checks are still required: an ES5 syntax check and simulated missing browser APIs do not reproduce the old Safari engine, keyboard or certificate store.

## Build and deployment

From `worker/`, run `npm ci`, `npm run build:attendance-ios10`, then the automated checks. The build derives the test HTML from the shared attendance UI, lowers the client scripts to ES5, adds browser fallbacks and hashes the final inline scripts/styles for CSP. All API requests stay on the test origin.

The dedicated workflow runs on the `codex/attendance-ios10-test` branch and deploys only `wrangler.attendance-ios10-test.jsonc`. Keep this work on that branch while the device is being tested. Do not merge it into main as part of the test deployment.
