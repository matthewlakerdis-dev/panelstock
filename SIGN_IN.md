# Standalone sign-in

The attendance section records arrivals and departures for visitors, contractors and employees. Open [administrator setup](https://web.panelstockhq.com/sign-in/manage) to create the iPad station link. The web-hosted screens use the existing PanelStock Worker for attendance records and authentication.

## Open and set up a station

1. Open `https://web.panelstockhq.com/sign-in/manage` and sign in with an existing PanelStock administrator account.
2. Create a sign-in station link and open it on the reception tablet or other shared device. The station credential is scoped to attendance check-in, the current on-site sign-out list and check-out. It cannot open inventory or the attendance register.
3. Keep the administrator screen on a staff device. Creating a replacement station link invalidates the previous link; revoking the station also disables devices already using it.

`https://web.panelstockhq.com/sign-in/` is the standalone station page. On an iPad, open it in Safari and choose **Share → Add to Home Screen**. Open **Lennox Sign In** and connect with an existing administrator username and PIN if needed. The app logs out that temporary administrator session and retains only station access. A station link remains another setup option: its private fragment is removed from the visible URL and its credential is retained in local/session storage. Treat station links as credentials. Internet access is required. The Worker-hosted pages remain available.

## Daily use

- Start with **Sign in** or **Sign out**. Sign in then shows **Visitor**, **Contractor** and **Employee**; selecting a role opens its details and questions. Back returns to the previous choice. Sign out opens the complete current on-site list directly.
- Visitors and contractors must enter full name, company and person visiting. Employees enter full name and person visiting, with optional phone/email and no company field. Required labels use red asterisks. Reason for visit is removed.
- Visitors acknowledge safety instructions provided by their host and choose whether they need workshop access. Contractors acknowledge site safety instructions provided by their Lennox Facades contact and choose whether they will enter the workshop or work areas. If yes, they answer whether they have the required PPE. A No PPE answer is recorded and shows a reminder to speak to their host or contact before entering the area or starting work; it does not prevent the attendance record. No safety policy, PPE list or induction document is invented by the app.
- Visitors and contractors also answer Yes or No about knowing the emergency evacuation procedure and assembly point, permitted areas, and who to contact about hazards or incidents. Contractors confirm whether they will carry out work; if Yes, they answer whether they have completed the required induction and discussed today's work activities, hazards and controls with their Lennox Facades contact. These answers are required when shown. A No answer about safety understanding, induction or the work-risk discussion shows a reminder to speak to the host/contact before proceeding. Attendance can still be recorded; these are self-reported answers, not a work approval or verified induction record.
- Wait for the saved confirmation before leaving the screen. There is no offline attendance queue: a failed request keeps the form available for retry, and retries use the same request identifier to prevent duplicate records.
- Select Sign out to see everyone currently signed in, then tap your name to record departure. The list refreshes automatically; Refresh reloads it immediately.
- Done, the 15-second success timeout and the two-minute idle reset return to the Sign in/Sign out choice. Safety acknowledgements and answers are cleared for the next person and when changing roles.
- Employee attendance is self-reported. Choosing Employee does not authenticate a PanelStock account or grant access to another part of the system.
- In the administrator view, review people on site, browse history and export CSV. An administrator can record a departure for someone who forgot to sign out.

Names and the selected role are attendance declarations. The section does not certify identity, induction completion, permission to work or physical access approval.

## Storage and access

Records use server timestamps and the existing site's SQLite Durable Object. The station view clears completed forms automatically and does not store visitor details in browser storage. Administrator requests use existing eight-hour PanelStock sessions and freshly checked administrator permissions.

The register, contact details and safety answers are restricted to administrators. The desktop app has an administrator-only **Sign-in register** shortcut directly beneath **Safety**, opening the management page in a new tab. Paired sign-out stations expose only name, person type, company and arrival/departure times. Administrators can expand the safety section in a visitor or contractor register row and export the answers as CSV columns. Historical records and older cached clients have **Not collected** answers; those are never backfilled as acknowledged. PPE is **Not applicable** when workshop/work-area access is No. Contractor induction and work-risk answers are **Not applicable** when undertaking work is No, and contractor-only answers are **Not applicable** for visitors. Employees do not receive the safety questions. The nullable safety columns are added idempotently without rewriting existing visits or station credentials. Attendance records are included in internal backup snapshots; stock restoration does not rewind attendance.

The register flags **Staff follow-up** when an applicable safety, PPE, induction or work-risk answer is No. The CSV includes the same derived indicator. No workshop access or no work on site is not a follow-up issue by itself. Missing historical answers remain **Not collected**, not a declaration that follow-up is unnecessary.

The existing maintenance read-only gate also pauses attendance writes. The section sends no host notifications or emails. Dates and times in the interface use Australia/Brisbane.

## Development and release

From `worker/`, run `npm test`. This builds the Worker and tests with synthetic records; no production attendance is created. Deploy this additive Worker change through the existing production workflow. No new Cloudflare binding, domain, inventory migration or coordinated frontend replacement is required.

The desktop repository publishes the web-hosted pages through its existing GitHub Pages build. After changing the shared UI, regenerate both pages from the Worker checkout with `node scripts/build-attendance.mjs --output-directory /absolute/path/to/panelstock-desktop/sign-in`, then commit and publish the generated desktop files. Their API origin is fixed to the production Worker, and their inline scripts and styles use generated CSP hashes. The Worker-hosted pages continue to use same-origin requests.
