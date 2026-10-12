# Fabrication toolbox talks

The existing PanelStock Worker serves the module at `/toolbox`. After the Worker release, the existing custom-domain route allows `https://cnc.panelstockhq.com/toolbox`; no DNS change, new Worker or storage binding is required. This URL is a deployment target, not confirmation that the module is live.

## Access and workflow

Use existing PanelStock accounts. An administrator enables **Run toolbox talks** (`factory.toolbox`) for the supervisors or their role. This permission is off by default for ordinary users. The mobile entry uses Mobile app access (`app`). The desktop entry (`/toolbox?app=web`) uses Web app access (`web`), so Web-only supervisors do not need Mobile enabled. Each entry keeps its own session cache. Supervisors need the appropriate app access and the toolbox task permission. Administrators have toolbox access automatically.

Administrators edit the six daily and weekly templates, then choose **Save shared templates**. Changes apply to new talks. Supervisors create a talk, enter the workshop/project, tasks or weekly focus, comments, attendee names and follow-up actions. New daily talks also record thirteen Yes/No/Not applicable inspection answers, high-risk activities, previous-shift issues and optional attendance time-in/time-out values. Inspection answers are required before signing a new daily talk; they are independent of section discussion confirmations. Existing records and signatures remain compatible. After discussing all six sections, each worker draws their signature on the supervisor's device. The supervisor signs last and completes the talk.

Draft edits are cached under the signed-in supervisor's username on that device. **Save draft** writes them to the shared backend. Drafts can be read and edited only by their owner or an administrator. Completed talks are available to accounts with toolbox permission and cannot be edited, including by administrators. Follow-up actions can be marked resolved separately, with the resolver and server time recorded.

Signatures include their device signing time and a SHA-256 digest of the discussion, names and agreed actions. Editing these fields, inspection results or attendance times clears signatures in the interface, and the backend rejects signatures for changed content. This records drawn acknowledgements on a shared device; it does not independently authenticate each worker or provide a certificate-based signature.

## Exports and recovery

From Current talk or Saved records, **Download PDF** creates a PDF directly on the device using the supplied form for the talk type: daily pre-starts use landscape `worker/assets/prestart.pdf`; weekly talks use portrait `worker/assets/weekly.pdf`. Weekly fields map project, date, facilitator to Presenter, focus to Subject, and each attendee’s name, employer and signature. Employer is entered by the supervisor (prefilled from Company for a new attendee), validated and bound to signatures. Weekly talks do not show or require the daily inspection checklist. The daily form fills project, date, supervisor, thirteen inspection results, tasks, high-risk activities, previous-shift issues, attendance times and signatures. Additional pages contain all discussion sections, comments, actions, acknowledgement times, supervisor sign-off and record metadata. Long text continues on extra pages; attendance pages repeat for all attendees. Draft exports are marked DRAFT. Blank legacy checklist answers and attendance times are never inferred from discussion checks or signature timestamps. Unused blank pages are omitted. Weekly talking points, discussion notes and reviewed results fill the five corresponding printed sections; incident reporting / first aid has no printed box in Weekly.pdf and is included on accompanying notes pages. Existing weekly records with daily inspection data retain that data in the notes. Attendance sheets repeat for all attendees. **Download record** saves a standalone HTML copy containing the signatures. Upload either completed copy to OneDrive manually. Automatic OneDrive upload is not configured.

**Export shared records** creates a JSON export of the templates and all records accessible to the supervisor. It captures a fixed list of record identifiers before fetching them so concurrent new records cannot shift pagination and omit older records. Individual records are read at export time, not as a single point-in-time database snapshot. Store exports securely: they contain names and signatures.

**Back up current draft** and **Recover local draft** handle device draft recovery. Recovering a draft does not replace shared data; later server saves still enforce revisions. If another device has changed a record, reopen the shared version rather than overwriting it. An interrupted save can be retried with the retained mutation identifier.

Records are persisted as individually chunked documents in the existing SQLite Durable Object. They do not alter inventory records or the existing stock-restore process. Toolbox records are not included in the current inventory-only daily backup; independent toolbox exports should be part of the operational backup routine. No automatic record-deletion policy is introduced.

## Source and validation

Edit `worker/templates/toolbox.html` for the interface and `worker/src/toolbox.js` for the API and validation. Run `node worker/scripts/toolbox-page.mjs` to regenerate the tracked page module. The generator embeds the same signature-content function used by the backend, along with a self-contained browser PDF bundle built from pdf-lib/fontkit dependencies and the bundled DejaVu Sans font. No CDN or third-party network requests are used; the form and PDF rendering stay on the device. The PDF font covers common Latin, Greek and Cyrillic text; unsupported characters cause an explicit export error instead of being silently removed. The pretest check rejects stale generated output.

From `worker/`:

```sh
npm test
npx wrangler deploy --config wrangler.production.jsonc --dry-run
```

The existing production workflow deploys this module with the Worker after merging into `main`. Review the change and approve release before merging; merging triggers a production deployment. Test with synthetic workshop data in staging first, including supervisor access, signing, conflicts, action resolution and signed PDF export. Existing inventory migration flags, bindings and secrets must remain unchanged.

The interface works on tablets and phones and uses pointer input for finger, stylus or mouse signatures. Shared reads and saves require a connection. Cached device drafts are not a full offline login or offline synchronization system.
