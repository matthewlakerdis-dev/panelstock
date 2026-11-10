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

The station first asks **Sign in** or **Sign out**. Arrivals then select a role before seeing details. Visitors acknowledge host-provided safety instructions and answer workshop access plus conditional PPE questions. No PPE prompts a host reminder while recording the answer. Back navigation and completed/idle resets clear visitor answers; administrators can review them in the register and CSV. See [SIGN_IN.md](SIGN_IN.md).

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

Site Order type details: new Gate orders require Villa. Panels require Location and have a separate optional Notes field. Drafts can remain incomplete; historical Location / notes text stays readable. These details follow the order into PDF, Excel, email and dispatch views. Gate production accepts Drawn plus a required positive total area (m²) when completing Drawn. QA still controls Fabricated/QA and Ready for dispatch; correcting area alone preserves QA approvals. The Production Tracker includes Gate area in Status / notes.

Fresh Production Tracker downloads place Location and Order notes side by side; Order notes contains only the optional text saved on the order. Production and dispatch details share Status / notes, with repeated state messages removed and Gate area retained. Gate Villa supplies Location. Older downloads retain their existing feed layouts.

Site Order forms use the same Order details, Site contact, Requested delivery and Notes sections for every type. Gate Villa and Panel Location appear within Order details; Notes is optional for all types. Older note text is restored into the common editor, with distinct historical text retained separately when both saved note fields contain content.

Production Tracker keeps the old combined text as Location for Panel orders without an explicit location. For other order types, that older text appears under Order notes, alongside any current order notes. Production and dispatch messages remain separate; saved order records are not rewritten.

The Production Tracker includes Scheduled for production (✓ / -), derived from person-assigned General or CNC schedule entries linked to the order. Delivery, cancelled and unlinked custom activities do not count. Multiple bookings keep the tick until the final qualifying booking is removed. Download a fresh tracker once to get the new column; existing workbook refresh layouts remain compatible.

## 50 × 30 mm offcut stickers

Retaining offcuts in CNC scheduling opens the print window after the schedule is saved locally. Each retained physical piece gets one 50 × 30 mm sticker; multiple panels on the same sheet do not duplicate its labels. The sticker has three large, centred fields: dimensions, thickness and material, then colour/finish. Proposed pieces remain outside SOH until the operator confirms the completed cut. Matching offcuts continue to share their existing stock line and SKU.

Use **Print offcut labels** in the CNC tracker to reprint the currently filtered pending work. In SOH, use the offcut's **Manage → Print offcut label** action, or its stock-detail print action. Workshop profile offcuts are supported too. Each manual print defaults to one physical piece.

For a **NIIMBOT B1 connected to Windows by USB**, install the model-compatible Windows software/driver from the [NIIMBOT download centre](https://www.niimbot.com/us/downloadCenter), then select the B1 in the browser/system print dialog if it is available. Set paper to **50 mm wide × 30 mm high**, **100% / Actual size**, zero margins, and browser headers/footers off. Print one test sticker to check alignment before a batch.

The print window's **Print / Save PDF** action also provides a file hand-off: choose **Save as PDF**, then import the file into printing software that supports PDF and use the same 50 × 30 mm paper settings. If your installed NIIMBOT software accepts images rather than PDFs, convert each PDF page to a high-contrast image and import it at the original label size. Printing uses the installed print driver or this file hand-off. `offcut-labels.js` is shared verbatim by the desktop and mobile apps.

Site Order dispatch summaries include the current saved project address as `siteAddress`. Matching uses the linked project ID, with an unambiguous case/whitespace-insensitive name fallback for older orders without an ID. Missing project addresses stay blank for manual entry. Reading the dispatch queue does not rewrite orders or project records; the dispatcher can edit the destination before confirming.

Consumables, Fixings, Other, Framing, Knotwood and Plant / Equipment show n/a for Scheduled for production in the Production Tracker. Fabricated order types retain their person-booking tick/dash. Existing downloads with the column receive the change through Refresh All.

Site app order notifications are on by default for the requester, with existing opt-outs preserved. Settings and the notification inbox include order/device notification controls. Users enable browser permission once per device; iPhone/iPad users must add Site Orders to the Home Screen and open it there. Granted devices reconnect to the signed-in account, logout removes the device subscription, and clicking a device alert opens the Site notification inbox without discarding unfinished work. Preference updates preserve other notification categories.

Admins can add dated, attributed Admin notes from View order in Site Orders and the web app. Only admins can add notes; admins and the order requester can read them. Notes have their own storage, history and retry IDs, notify the requester subject to their order preferences, and do not change submitted items, order dates, PDF/email/Excel content or production/dispatch state. Release this Worker/Site change before the companion desktop note UI. The matching generated legacy Site client is included.

Fresh Production Tracker downloads start Site Orders with PDF, Action, then Date ordered. Status / notes follows Schedule delivery (columns L and M); optional Order notes stays beside Location. Previous workbook refresh layouts and existing order sorting remain compatible. Download a fresh tracker for the new layout.

New orders use Bin Gate or Buggy Gate in place of the old Gate choice. Both require Villa and Colour, chosen from Spruce or Norwegian Beech. Each saved item description gets one uppercase suffix, for example `V132 FRONT BIN GATE SET - SPRUCE`; choosing another colour replaces that suffix. The selected colour follows saved/copy drafts and appears in Site/web order details; the suffixed descriptions follow into PDF, email, QA and dispatch. Explicit colour/item changes obey existing production and receipt locks. Older orders keep their recorded items and can retain an unrecorded colour during unrelated edits; no order migration is performed.

Historical orders labelled Gate retain their type and production/QA links. The generic Gate choice is hidden in new-order and correction selectors; older saved/queued Gate requests stay compatible. No existing order is guessed into a new subtype.


Production Tracker Open PDF links open the current order PDF, including its printable order attachments, without signing in. Each signed link grants read-only access to that one PDF; forwarding the link also grants that access. The shared tracker credential is not included in PDF URLs. Rotating CNC_PUBLIC_TOKEN revokes all existing tracker PDF links, and deleting an order removes PDF access. Refresh All updates existing tracker links; new downloads include them immediately. Action and Schedule delivery still require PanelStockHQ sign-in.

Fresh Production Tracker Daily, Weekly and Monthly reports include Gate area (m²) and Total production area (m²), alongside the existing CNC panel totals. A Gate, Bin Gate or Buggy Gate contributes its saved total area once, on the Brisbane date the whole order passed fabrication QA. Pending/reopened/cancelled orders and missing or invalid areas/dates are excluded. Dispatch and area-only corrections retain the completion date. Historical completion dates are recovered from existing order audit records when available. Gate-only production days remain in Daily; days with 0 m² combined production are omitted. Weekly and Monthly retain quiet periods with numeric zeros. Refresh All applies the Daily zero-area filter to existing downloads. New report queries use reportVersion=2 and six columns; previous four-column report refreshes keep their original panel-only layout. Download a fresh tracker for the new columns.

Fresh Production Tracker downloads include a Completed Orders tab for dispatched Site Orders. Site Orders retains every order not marked Dispatched, including orders ready for dispatch. Both tabs share the same columns, signed PDF links and formatting, with independent 15-minute/Refresh All queries. The split uses the saved order status, so descriptive dispatch notes cannot move an active order. New order queries use siteOrdersVersion=12; older downloads keep their full order list until replaced. Download a fresh tracker to get the new tab.
