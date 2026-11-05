# Standalone sign-in

The attendance section records arrivals and departures for visitors, contractors and employees. Open [administrator setup](https://web.panelstockhq.com/sign-in/manage) to create the iPad station link. The web-hosted screens use the existing PanelStock Worker for attendance records and authentication.

## Open and set up a station

1. Open `https://web.panelstockhq.com/sign-in/manage` and sign in with an existing PanelStock administrator account.
2. Create a sign-in station link and open it on the reception tablet or other shared device. The station credential is scoped to attendance check-in, exact-name sign-out lookup and check-out. It cannot open inventory or the attendance register.
3. Keep the administrator screen on a staff device. Creating a replacement station link invalidates the previous link; revoking the station also disables devices already using it.

`https://web.panelstockhq.com/sign-in/` is the standalone station page. The setup link carries its station credential in the URL fragment, which is removed from the visible URL and retained in session storage on that tab. Treat the station link as a credential. Closing the tab or clearing session storage may require opening the link again. GitHub Pages may add a trailing slash to the administrator URL. The existing Worker-hosted pages remain available.

## Daily use

- Choose Visitor, Contractor or Employee and enter the requested details. Visitors and contractors supply a host and purpose; contractors also supply their company. Contact details are optional.
- Wait for the saved confirmation before leaving the screen. There is no offline attendance queue: a failed request keeps the form available for retry, and retries use the same request identifier to prevent duplicate records.
- Select Sign out and enter the full name used at arrival. Only matching active visits are shown. Select the matching entry to record departure.
- Employee attendance is self-reported. Choosing Employee does not authenticate a PanelStock account or grant access to another part of the system.
- In the administrator view, review people on site, browse history and export CSV. An administrator can record a departure for someone who forgot to sign out.

Names and the selected role are attendance declarations. The section does not certify identity, induction completion, permission to work or physical access approval.

## Storage and access

Records use server timestamps and the existing site's SQLite Durable Object. The station view clears completed forms automatically and does not store visitor details in browser storage. Administrator requests use existing eight-hour PanelStock sessions and freshly checked administrator permissions.

The register and contact details are restricted to administrators. Station lookup requires a complete matching name and returns only minimal active-visit details; it does not expose the full register. CSV export is available independently of stock exports. Attendance records are included in new internal backup snapshots; stock restoration does not rewind attendance.

The existing maintenance read-only gate also pauses attendance writes. The section sends no host notifications or emails. Dates and times in the interface use Australia/Brisbane.

## Development and release

From `worker/`, run `npm test`. This builds the Worker and tests with synthetic records; no production attendance is created. Deploy this additive Worker change through the existing production workflow. No new Cloudflare binding, domain, inventory migration or coordinated frontend replacement is required.

The desktop repository publishes the web-hosted pages through its existing GitHub Pages build. After changing the shared UI, regenerate both pages from the Worker checkout with `node scripts/build-attendance.mjs --output-directory /absolute/path/to/panelstock-desktop/sign-in`, then commit and publish the generated desktop files. Their API origin is fixed to the production Worker, and their inline scripts and styles use generated CSP hashes. The Worker-hosted pages continue to use same-origin requests.
