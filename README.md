# PanelStock mobile

Mobile inventory app deployed through GitHub Pages. The matching desktop app lives in `matthewlakerdis-dev/panelstock-desktop`. Both must use the same API release.

## This coordinated release

- Individual, revocable, eight-hour sessions replace the public shared credential. Existing PIN hashes are supported; new PINs require 6–12 digits and use salted PBKDF2.
- The Worker enforces user/admin permissions and rate limits login attempts. Browser identity flags are not trusted.
- Immutable, persistent local batches combine stock and activity changes. The server checks the expected previous records and commits changes atomically in a SQLite Durable Object per inventory site.
- Conflicts stop automatic retries and preserve pending data for export/reconciliation. Retrying an acknowledged mutation does not apply it twice.
- Stock data is validated on the server. Whole-collection replacement endpoints are retired. Debug endpoints return 404.
- Voided dispatches are excluded from jobs. Activity history is no longer capped at 800 entries or deleted by full reset.
- Daily backups contain stock, history, user records, and report settings. Stock restoration preserves activity history, takes a pre-restore backup, and invalidates stale pre-restore edits.

`panelstock-client.js` is shared verbatim with the desktop repo. Keep both copies identical for coordinated releases. The Worker source of truth is `worker/` in this repository; it is not duplicated in the desktop repo.

## Verification

The live Lennox Facades attendance kiosk is at [web.panelstockhq.com/sign-in/](https://web.panelstockhq.com/sign-in/), with its register at [web.panelstockhq.com/sign-in/manage/](https://web.panelstockhq.com/sign-in/manage/). On the iPad, open the live kiosk in Safari, use **Share → Add to Home Screen**, and name it **Lennox Sign In**. Open that icon and connect with an existing administrator username and PIN if setup appears. Connecting replaces the current station link; the app shows this notice before submission. Only the station credential persists. Administrator setup sessions are logged out, and Internet access is required.

The production app supports iOS 10.3.4. Visitors and contractors must enter full name, company and person visiting; employees enter full name and person visiting, with optional phone/email. Company stays hidden for employees and reason for visit is removed. Required fields have red asterisks. Existing attendance history and paired station access are retained by deployment. The separate **Lennox Test** icon still points at the isolated demo environment; install the live page for real attendance.

`npm run build:attendance` compiles the production scripts to ES5 and generates the ignored Worker page module with exact CSP hashes. `npm test` runs this build before the Worker dry run. Generate the matching desktop pages with `node worker/scripts/build-attendance.mjs --output-directory ../panelstock-desktop/sign-in`; publish both repositories for a coordinated attendance release. No Babel or filesystem code runs in the deployed Worker.

Use Node 22 or later. From `worker/`, run `npm ci` then `npm test`. The test script builds the Worker without deploying it and runs against local Cloudflare workerd with synthetic data. No production bindings, live PINs, or email delivery are used in tests.

The frontend remains a pre-built React HTML bundle. This change deliberately preserves the layouts; recovering a modular React source tree remains separate follow-up work.

## Repository components

- `index.html` and `panelstock-client.js` are the mobile inventory app published at `app.panelstockhq.com`.
- The mobile bottom task bar includes SOH, Receive, Dispatch, CNC, QA Check and Orders according to user permissions. Damage is available in **More**.
- Site Orders is also available from **Orders** in the bottom task bar in the mobile app for users with order-view access. It reuses the current order screens and mobile login; account drafts and orders are shared with Site Orders and Web. Device drafts and pending uploads stay on their original browser origin.
- Admins and order managers mark Gate orders Drawn from Site/mobile order details or Gate progress on Desktop. Each order item then appears in the QA Centre using the metalwork checklist. When all current items pass QA, Fabricated/QA and Ready for Dispatch complete automatically, the Gate appears in Dispatch, and the requester is notified once. Resetting Drawn withdraws the current QA revision; redraws require fresh checks. Other tracker stages show N/A. Dispatched Gates stay locked, and production/QA evidence is audited.
- Order emails append attached PDFs and JPG/PNG photos after the order sheet in one PDF once uploads finish. Other file types remain separate attachments. PDF downloads include all current printable attachments. Files added later send one follow-up PDF email per upload batch. Upload retries preserve the original email payload and creator CC; explicitly omitted files are recorded before the initial email is released.
- Administrators can set, change or clear scheduled delivery dates for active Site Orders, including panels and ready orders. Use Scheduled delivery in the Site/mobile order details or Schedule delivery on Desktop. Requested dates stay unchanged, and delivery updates are recorded in order history and requester notifications.
- Goodnotes PDF sharing uses an account-scoped Apple Shortcut configured in standalone Site Orders Settings. Imports create private drafts, preserve unfinished orders and require normal login before editing/submission. See [Goodnotes Shortcut setup](docs/GOODNOTES_SHORTCUT.md).
- Site Orders runs at `https://site.panelstockhq.com`, packaged by `worker/scripts/site-orders.mjs` from the client assets in `site/` and the active HTML/service-worker templates in `worker/templates/site-orders/`. The old `app.panelstockhq.com/site/` and `/site-orders/` entry pages now redirect to the new domain after confirmation that all pending orders were synced. The main mobile app remains unchanged. See [SITE_ORDERS_DOMAIN.md](SITE_ORDERS_DOMAIN.md).
- `converter/` is the active Dockerized Python/LibreOffice XLSX-to-PDF service. The Worker calls it when producing a Site Order PDF; production config supplies its URL and the converter authentication token is provided through the environment.
- `worker/` is the authoritative Cloudflare Worker. In addition to the shared inventory API, it serves the CNC tracker and the read-only Daily Schedule TV display. Production routes include `cnc.panelstockhq.com` and `tv.panelstockhq.com`, with `/schedule-display/` retained for compatible schedule links.
- The standalone sign-in section at the Worker's `/sign-in/` records visitor, contractor and employee arrivals and departures. Administrators set up the station and review the register at `/sign-in/manage`. See [SIGN_IN.md](SIGN_IN.md).

## Operations and limitations

- Read [RELEASE.md](RELEASE.md) before any deployment. Merging this frontend alone against the old Worker breaks login; deploying the new Worker blocks old apps from writing.
- Pending batches belong to their original user. A different user cannot send them. One editing tab per app origin is allowed.
- A server connection is required to verify login after a reload. An already verified open app can stage offline changes. A conflict requires review; the app does not silently merge conflicting stock quantities.
- The browser stores pending changes and its cached stock view in localStorage. Storage exhaustion stops editing and offers recovery export. Photos/history can eventually require IndexedDB and paginated reads; they are not silently discarded to stay under a quota.
- Session tokens are kept in sessionStorage and never stored in Git. The apps still use their existing external Tailwind runtime and analytics scripts; bundling CSS and reducing third-party script access is a separate hardening task.
- The old KV store is migration input only, never the new authoritative writer. Do not point old clients at any alternate legacy writable Worker.
- Backups inside the Durable Object are not a replacement for independent exports and recovery drills.
- Existing public CNC share links can be preserved by configuring the existing read-only token as a Worker secret. That token is no longer embedded in the frontend code; authenticated users can retrieve the share link token. Anyone already holding a share link retains read-only CNC access.

## Standard operating procedures

[Open the approved SOP (PDF)](PanelStock_SOP.pdf). Both apps use the same user-supplied document. Replace this PDF in both repositories together; do not regenerate it from the retired SOP builders. The app download remains under Settings.

Site Order type details: new Gate orders require Villa. Panels require Location and have a separate optional Notes field. Drafts can remain incomplete; historical Location / notes text stays readable. These details follow the order into PDF, Excel, email and dispatch views. Gate production accepts Drawn plus a required positive total area (m²) when completing Drawn. QA still controls Fabricated/QA and Ready for dispatch; correcting area alone preserves QA approvals. The Production Tracker includes Gate area in Status / notes, immediately before Drawn.

Fresh Production Tracker downloads place Location and Order notes side by side; Order notes contains only the optional text saved on the order. Production and dispatch details share Status / notes, with repeated state messages removed and Gate area retained. Gate Villa supplies Location. Older downloads retain their existing feed layouts.

Site Order forms use the same Order details, Site contact, Requested delivery and Notes sections for every type. Gate Villa and Panel Location appear within Order details; Notes is optional for all types. Older note text is restored into the common editor, with distinct historical text retained separately when both saved note fields contain content.

Production Tracker keeps the old combined text as Location for Panel orders without an explicit location. For other order types, that older text appears under Order notes, alongside any current order notes. Production and dispatch messages remain separate; saved order records are not rewritten.

The Production Tracker includes Scheduled for production (✓ / -), derived from person-assigned General or CNC schedule entries linked to the order. Delivery, cancelled and unlinked custom activities do not count. Multiple bookings keep the tick until the final qualifying booking is removed. Download a fresh tracker once to get the new column; existing workbook refresh layouts remain compatible.
