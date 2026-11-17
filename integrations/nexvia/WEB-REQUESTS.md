# Lennox purchase requests in PanelStock Web

The native **Work → Purchase Requests** page uses existing PanelStock sign-in.
It records the request first, then shows its progress and the verified Nexvia
PO number. The browser never connects directly to the NAS.

Administrators have access automatically. In **Users → Task access → Purchase
requests**, grant **Submit purchase requests** to requesters and **Manage
purchase requests** to people who should see every request. Requesters see only
their own history; management access does not grant stock or receiving access.

## What this connects

- Nexvia project, supplier, service, EOW, COS and GST choices come from the NAS.
- The server checks saved choices and calculates subtotal, GST and total.
- Submission retries reuse the same request UUID. A request claimed for creation
  is never automatically put back in the queue.
- The NAS invokes the creation worker with fresh native line defaults.
  It retains live validation, saved-line verification and the attempt sentinel.
- The adapter first prepares the saved request without submitting it, checks
  the exact prepared file and hash, then authorizes that preparation with the
  existing worker's `--submit` option. Preparation alone is never shown as a PO.
- Only a verified result displays a PO number and queues a Resend confirmation
  from `porequest@panelstockhq.com`.

Requests use the native allocation for the selected EOW, including its
job, budget, category and assembly links. EOW IDs are opaque: the connector
never derives an allocation from an ID suffix. There is no Miscellaneous-only
allowlist. If Nexvia does not expose an unambiguous native allocation, the
request needs review before any submission. An optional quote PDF up to 10 MB
follows the same PO creation process and is attached through Nexvia's native
file control. Saving a request is not proof that a PO exists.

## Temporary supplier quotes

New quote requests require the NAS's version 1 quote-attachment capability and
original PO document support. Older workers skip these requests while continuing
to process compatible work. Existing requests already awaiting office review
are not migrated or automatically submitted.

The immutable request retains the quote's filename, byte count and SHA-256.
The PDF travels through a private temporary object and a private NAS spool;
neither contains an arbitrary download URL. The browser clears its selected
file and retry body after the server acknowledges the saved request. A lost
acknowledgement preserves the original request UUID and exact retry body.

Nexvia's uploaded file ID is frozen into the prepared PO. After creation, the
bridge separately checks that the saved PO references that file and that its
downloaded bytes match the original quote. Only that proof releases the
confirmation email and queues deletion of PanelStock's input quote. Deletion
retries do not upload another quote, recreate a PO or resend an accepted email.
Request history retains attachment metadata and a link to the verified Nexvia
PO, rather than a permanent PanelStock quote download.

Cloud quote objects expire 24 hours after the original upload, including when
a worker has already claimed the request. Expiry never resets the claim,
changes the recorded PO result or authorizes another creation. A matching
attachment proof can still arrive after expiry. If the quote did not reach
Nexvia and no temporary copy remains, recovery requires the original PDF;
it must use the existing PO when one has already been created.
The NAS input spool has its own 24-hour deadline, frozen before its first
download and never extended by retries. Only input PDF bytes are removed;
the request, attempt and attachment evidence remain available for recovery.
If the bridge is paused, overdue local cleanup runs when it is enabled again;
cloud expiry continues independently.

Use the packaged `install_nexvia_quote_update_v1.py` release for an existing
NAS installation. It installs all nine matching modules, preserves private
settings and journals, and checks the current native upload controls without
selecting a file or creating a PO. It adds `quoteEnabled: true` only after that
check passes and original PO document support is enabled. Copying individual
modules or enabling that setting manually does not complete the rollout.

Supplier quotes and the generated official PO document have separate
lifecycles. Input-quote cleanup never deletes the frozen PO PDF needed for
confirmation-email retries.

Native quote uploads first obtain a signed storage policy using the selected
PDF's normalized filename, byte count and MIME type. The policy guard binds
this lookup to the observed SEND function and upload operation, checks the
signed response, and permits one storage upload followed by one registration.
When Chromium supplies multipart fields, their signed values must match a
PDF-compatible policy. Native file identity and downloaded PDF bytes must
still match before an upload receipt is written.

The observed native policy uses unrestricted `starts-with` conditions for
lowercase `content-type` and `content-disposition`, while its pinned uploader
appends `Content-Type` and `Content-Disposition`. Only those two empty-prefix
aliases resolve to the corresponding source-proven fields during validation.
The signed policy bytes and native multipart fields are preserved. Other
casing, equality conditions, nonempty prefixes, storage bindings and PDF
checks retain their existing behavior.

Guard version 2 derives completion from the pinned native DONE callback and
its captured controller. The one permitted registration uses the policy
response's exact native file ID and `location` metadata; it does not assume
that this metadata is an absolute GCS URL or that registration uses the HTML
details route. A separate source-proven attachment-card request is limited to
that file ID and the exact static `form[Files]` template. Other requests remain
blocked. A receipt requires accepted storage, successful registration, the
matching native hidden ID, and the original downloaded PDF hash.

Before forwarding the policy, the bridge writes a private
`nexvia-quote-upload-context.json` record containing the request/attempt binding
and minimal recovery coordinates. Storage acceptance and a bounded first-denial
shape are recorded durably. This record contains no PDF and omits the signed
POST policy, signature and credential fields. It does not authorize an
automatic retry or resume.

Preparation observations are saved separately in the private, bounded
`nexvia-preparation-diagnostic.json` file. Fixed stage names and transport
counts improve failure messages; these observations never authorize another
upload or PO submission. Missing or invalid observations preserve the existing
failure behavior, and failed requests are never retried by an installer.
The policy updater and its packager reject missing or malformed SEND and
operation fingerprints before installation. A draft with unverified pins
cannot produce a ready release.
The packaged `install_nexvia_quote_policy_update_v1.py --check-request UUID`
also checks the live uploader source, filename normalization and static upload
fields using an owned unsaved form before changing installed modules. This
compatibility check never selects a file, requests a policy or retries the
saved request, including when its earlier upload attempt remains uncertain.

For the installed policy-v1 bridge, the packaged
`install_nexvia_quote_policy_update_v2.py --check-request UUID` installs the
two observed empty-prefix aliases and callback diagnostic correction. It
binds the private, linked version-1/version-2 reports to the unchanged request,
upload attempt and main journal, then checks the live native uploader source
without requesting another policy. An offline policy fixture must pass with
the replacement validator before the update is accepted. Only quote handling
and preparation diagnostics are replaced; reference caches, settings, quote
records, confirmation records and failed-request markers are preserved.
The update does not upload a file, submit a PO or retry a failed request.

For the installed policy-v2 bridge, the packaged
`install_nexvia_quote_registration_update_v3.py --check-request UUID` adds the
source-bound registration helper and updates quote handling. It verifies the
private passive-registration report and unchanged request evidence, then
checks the live completion and renderer contracts without invoking them.
Synthetic policy bindings must match both exact requests. Unsupported source
formats stop before installation and produce a fixed stage/reason in a private
check report. Existing requests and upload attempts remain unchanged. Previous
versioned policy builders reproduce their pinned immutable releases; the new
builder packages the current matching quote module and registration helper.

The generic allocation and directory exporters require validation against the
NAS's current Nexvia UI before rollout. Run `nexvia_inspect_live.py --project 60`
to capture read-only schema metadata. Automated tests use synthetic native
schemas; they do not establish live compatibility with every EOW.

## Automatic Nexvia choices

The bridge refreshes projects, suppliers, COS accounts and taxes every five
minutes using the existing NAS browser sign-in. It follows native pagination
and rejects partial supplier/account/tax results. Both finance and supplier
snapshots carry the same successful refresh timestamp. Lookup publication
rejects mismatched snapshots or snapshots older than ten minutes, allowing a
five-minute cycle plus refresh time. A failed refresh retains the last files
and emits a fixed warning; it cannot authorize creation with stale choices.

Suppliers, services, COS accounts and tax choices are shared across Lennox jobs;
only EOW choices belong to the selected project. The NAS reads native service
and EOW identities from the PO modal. The web form reuses fresh common choices
as soon as it opens, before a project is selected. If no fresh common snapshot
exists, the form queues a read-only lookup using a known project internally;
that source project is never selected in the form and its EOWs are not reused.
Suppliers, services, COS and tax menus become available when this lookup returns.
The form also reuses common choices when switching projects, preserving
selected IDs and draft lines while only the EOW menu loads. A matching full
project catalog and revision are still
required before submission; an EOW from another project is never carried over.
The form preloads saved EOW lists for up to 50 current projects when it opens.
Selecting a cached project shows its extents immediately while the normal
lookup verifies current Nexvia choices in the background. A saved list may be
up to 30 days old and is for selection only: it has no catalog revision and
cannot authorize submission. The verified result keeps a selected extent only
if that exact ID is still available. A project with no saved list still needs
its first Nexvia read. Preview reads never queue NAS work or create a PO.
The authenticated shared-choices response contains no EOWs, request details or
project catalog revision, and keeps its original verification timestamp.
Its GET remains read-only; an explicit POST starts or reuses an owned lookup
when fresh shared choices are unavailable. A forced refresh also handles a
cached snapshot that expires while its response is in transit. Choice responses
include precise server time: the form measures the remaining five-minute life
against server time and elapsed time in the browser, so an inaccurate computer
clock cannot reject freshly verified choices. Reading a snapshot retains its
original verification time and cannot renew its life. Opening the form never
queues PO creation.
Selecting a project reuses its validated cloud snapshot when it is less than
five minutes old, so reopening it does not need another NAS job. Cache reads
keep the original revision and timestamp. Missing, expired or failed-refresh
snapshots use the normal lookup queue. Automatic refresh and the recovery
button send `refresh: true` to bypass this cache and check Nexvia again.
The web form refreshes all selected-project choices every five minutes and
preserves valid field IDs, text, line entries and zero-GST selections. Removed
IDs require reselection. Submission pauses while current choices are loading.
Creation separately rechecks supplier permission and reads current COS/tax
choices from the exact request's native editor before preparing lines.

New projects visible to the NAS account are added from `/staff/projects` on the
next refresh, then appear in the web app's normal ten-second project poll.
Project listing completeness is not yet proven, so refresh merges discoveries
with the saved directory and retains earlier entries. Login or access changes
can delay discovery; a later creation preflight still checks actual access.

The shared **PanelStock Projects** list also receives newly discovered Nexvia
projects through the existing bridge. The first non-empty directory the Worker
receives establishes the baseline for future additions. Later discoveries are
added as active projects unless a shared project with the same name already
exists. Existing project details and status are preserved, and reappearing
Nexvia entries do not recreate projects removed in PanelStock. The directory
currently supplies a project name and a Nexvia internal ID, so the PanelStock
project number and address start blank.

In PanelStock Web, administrators can select an existing project in
**Projects**, load the Nexvia directory, and save or clear its match. The match
is one-to-one and can be changed independently of the project's other details.
The project ID used for Site Orders and scheduling stays the same.

## Release order

1. Merge and deploy the `panelstock` Worker change first, using the existing
   **Deploy production Worker** workflow.
2. Merge the companion `panelstock-desktop` change. The existing Pages workflow
   publishes the page at `https://web.panelstockhq.com/?page=purchase-requests`.
3. Connect the NAS below. Until it connects, the page explains that choices are
   unavailable and does not accept a request with guessed or stale choices.

Do not recreate PO7413 as a connection test. It already exists. The earlier
deduplicated email-only test remains separate from this request workflow.

## Connect the existing Synology worker

Keep the existing local form server, Nexvia browser sign-in, private
configuration and request journals. Install these six modules together in
`/config` inside the existing `nexvia-browser` container:

- `nexvia_requests.py`
- `nexvia_create.py`
- `nexvia_allocations.py`
- `nexvia_projects.py`
- `nexvia_lookups.py`
- `nexvia_form_data.py`

For an existing installation, follow [NAS-UPDATE.md](NAS-UPDATE.md) so the
running bridge is stopped and the previous scripts backed up before replacing
them. Do not replace private configuration, attempt records or journals.

Create a new, private configuration in that container:

```sh
/config/nexvia-tools/bin/python - <<'PY'
import json, os, secrets, uuid
path = '/config/panelstock-requests.json'
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    json.dump({
        'enabled': False,
        'token': secrets.token_urlsafe(48),
        'workerId': str(uuid.uuid4()),
        'creationEnabled': False
    }, stream, indent=2)
print('Private purchase request connection configuration created.')
PY
```

Using the private File Station editor, copy only its `token` into the
**panelstock** repository's **Settings → Secrets and variables → Actions →
New repository secret**, named `NEXVIA_REQUEST_TOKEN`. Keep it out of chat and
Git. Run **Deploy production Worker** to apply the secret.

This is a new request-worker credential. Keep the earlier
`NEXVIA_CONFIRMATION_TOKEN` separate: that older credential still grants only
confirmation delivery. The Resend key stays in Cloudflare.

Set `enabled` to `true` in `/config/panelstock-requests.json`, keep
`creationEnabled` false for the initial connection check, and preserve mode `0600`.
Run one pass:

```sh
/config/nexvia-tools/bin/python /config/nexvia_requests.py --once
```

This refreshes and publishes the project directory. Open **Purchase Requests**, pick
a project, then run another pass to load its choices. Check the choices and the
connection status before submitting a genuine request.

After the connection works and the existing creation worker is ready, set
`creationEnabled` to `true` and run under the container's existing supervisor:

```sh
/config/nexvia-tools/bin/python /config/nexvia_requests.py --watch
```

The request bridge checks for work every two seconds while idle and claims the
next job immediately after an acknowledged outcome. Connection errors back off
for 5, 10, 20 and then at most 30 seconds; disabled configurations wait 30
seconds. Unchanged idle messages are logged only every 30 seconds.

Pending terminal-result delivery still comes first. In watch mode, a valid
saved project directory lets interactive work run before due directory
maintenance. An idle pass performs the refresh, or a persistent one-minute
deferral limit makes the next pass refresh before claiming more work. A job
already running finishes first. New projects discovered by maintenance are
published on the next poll. An installation without a valid project directory
must refresh before claiming work. The default `--once` behavior still refreshes
before a new claim.

The directory exporters and native lookup themselves still need time to read
Nexvia. This change removes the fixed 30-second polling delay and avoids
starting due maintenance ahead of already-queued work; it does not interrupt an
export already running. The local form's GET lookup endpoint invokes the
updated import-safe `nexvia_form_data.py`; the creator uses that module's
validation directly, avoiding the old server's import-time listener. No NAS
inbound port needs exposing.

The connector identifies itself as `PanelStock-Nexvia-Bridge/1.0` on cloud
requests. Keep this header when updating the connector: Cloudflare may reject
Python's default user agent with HTTP 403/error 1010 before the API is reached.

## Daily saved Nexvia reference data

PanelStock serves saved projects, suppliers, services, COS accounts and tax
choices immediately. Extents of work remain scoped to their native project.
The website reads these saved lists without forcing a native refresh when a
project is selected. Cached menus remain usable for up to 30 days if a daily
refresh fails; their original capture times are preserved. They are reference
data only: PO preparation still reads the current native service/EOW form,
supplier eligibility, allocation, COS and tax editors before submission.

An updated NAS watcher advertises `referenceCacheVersion: 1` on its existing
work poll. A daily sync first refreshes the native directory exporters, then
warms one project's choices at a time through the existing claimed lookup
result path. Interactive requests and lookups have priority. Saved common
lists are shared across projects; a common-list refresh cannot replace or
renew another project's EOW. Failed reads retain the last complete snapshot.
Failed directory syncs retry after fifteen minutes. Project warming is attempted
daily; a project that cannot be read retains its saved EOW without causing the
whole directory to be fetched repeatedly. An administrator can retry sooner.

Administrators can use **Sync Nexvia data** on Purchase Requests to request an
immediate background sync. Sync actions require administrator access. A missing
project's choices can still use the normal targeted lookup.
This schedule is separate from the existing ten-second request-status refresh.

`releases/install_nexvia_cache_update_v1.py` is the standalone NAS updater built
by `build_cache_installer.py`. It updates only `nexvia_requests.py`,
`nexvia_form_data.py` and `nexvia_projects.py` from the supported quote-attachment
and saved-PO-verification baseline. It waits for the existing work lock, backs
up private originals, checks imports without native actions and restores them
if preflight fails. Configuration, request IDs, saved preparations, creation
attempts, journals and confirmation records are preserved. An active PO must
finish before the installer can acquire the work lock; it never interrupts a
creation or resubmits a request. The restarted watcher performs the initial
sync in the background. Existing NAS versions continue to process ordinary
requests until this updater is installed.

## Reviewing stopped requests

Administrators and users with **Manage purchase requests** can review a request
that needs attention from its details panel. **Check request** asks the original
NAS worker to inspect its saved evidence. The check does not open Nexvia, upload
a file, prepare or create a PO, or send email. It preserves the original request
and terminal journal.

The review records notes, the reviewer and time. **Close review** records a
resolution without creating a PO; **Reopen review** permits further review.
Requesters can see the review outcome for their own requests.

**Prepare retry** is available only after a current check proves that the
original, acknowledged failure has no quote-upload attempt, upload receipt,
prepared PO, creation attempt or verified result. An uncertain or partially
completed attempt remains blocked for inspection in Nexvia. Never infer that a
PO is absent from the error message alone.

A retry opens a prefilled form and still requires explicit submission with
current choices and totals. If the original request had a quote, select the PDF
again. The replacement receives a new request number, links to the original,
and remains visible to the original requester. Only one replacement may be
created for a stopped request, including concurrent reviewers and lost-response
retries. Replacement submission also requires **Submit purchase requests**
permission. The failed record and its original result remain unchanged.

The NAS advertises `reviewVersion: 1`; older workers continue ordinary work but
do not claim review checks. The review updater installs only the watcher and
its separate read-only review module over the supported guard-5 release.
Review delivery uses its own private journals, so a network retry cannot
reprocess the failed purchase request or change its original claim.

## Uncertain results and recovery

### Serialized blank rows before quote upload

Nexvia can serialize its blank allocation row when a native finance editor is
opened. Managed quote preparation retains the original native editor snapshot
and verifies that a nonempty `form[Lines]` still represents exactly that blank,
unsaved row. Its live grid and serialized form must agree, preserving the native
identity, project/job/EOW allocation, supplier, service and AUD currency. Entered
descriptions, monetary amounts, received quantities and existing PO ownership
remain rejected before the quote upload attempt marker or file selection.

`releases/install_nexvia_quote_draft_update_v1.py` updates only
`nexvia_create.py` and `nexvia_quote_attachment.py` on the supported daily-cache
NAS baseline. Installation checks imports and signatures, preserves private
configuration and request evidence, and restarts only the idle guarded watcher.
It does not retry failed requests, upload quotes, create POs or send emails.

The native serializer can also clear that temporary row's `id` while preserving
the exact identity in `uid`, and omit the grid's boolean `_editable` metadata.
Guard version 2 binds both representations to the observed native model UID and
original born-empty row proof. Only these proven client metadata differences
are normalized; allocation identities and business fields remain exact.
`releases/install_nexvia_quote_draft_update_v2.py` upgrades an installed
version-1 guard by replacing only `nexvia_quote_attachment.py`. Its distinct
private backup preserves the first updater's backup and all request evidence.

Guard version 3 recognises Nexvia's unchanged `supplier_min_qty: false` flag as
metadata beside the numeric quantity fields. Only that exact native false
default is accepted; actual quantities, received work and changed flag values
remain subject to the existing checks. The packaged
`releases/install_nexvia_quote_draft_update_v3.py` upgrades an installed
version-2 guard by replacing only `nexvia_quote_attachment.py`, with a separate
private backup. It waits briefly for the bridge work lock and never interrupts
an active request or retries a failed one.

Guard version 4 also accepts additional native confirmation of the same EOW.
The original nonempty evidence set must remain present in both the live grid
and serialized form; duplicate evidence and order do not change its meaning.
Project, supplier, service, EOW, job and all allocation fields must still match
exactly. A present native `breakdown_type` form field must name the selected
EOW exactly once. `releases/install_nexvia_quote_draft_update_v4.py` includes
the quantity-flag correction and upgrades the deployed version-2 guard directly,
using its own private backup; it does not require installing version 3 first.

Guard version 5 permits one empty native `breakdown_type` form control only
when that snapshot's single native line directly identifies the selected EOW.
It leaves the captured form and proof unchanged; a populated control must still
match, and duplicate or conflicting controls remain rejected. Original EOW
evidence and all allocation links must still be preserved. The standalone
`releases/install_nexvia_quote_draft_update_v5.py` includes the earlier fixes
and upgrades the deployed version-2 guard directly with a separate backup.

`nexvia_inspect_quote_preparation.py --request UUID` checks an unattempted saved
quote request using isolated read-only native forms. It never calls preparation,
file selection or submission. The check holds the existing bridge lock, refuses
any upload/prepared/create/result marker, and verifies that the original request
evidence is unchanged. A passing result confirms current pre-upload validation;
it does not establish that a native file upload or PO creation has succeeded.

If a quote-upload attempt exists without a receipt or later PO evidence,
`nexvia_inspect_failed_quote_upload.py --request UUID` inspects a fresh unsaved
form without selecting or uploading a file. It preserves the existing lock and
original evidence, and records sanitized callback structure plus form/tab
ownership in a private diagnostic report. Template literals and their
interpolations remain opaque; unsupported syntax is reported with a fixed
reason. The bounded console output prioritizes the native `send` callback.
Source inspection also reports candidate policy paths, request-field provenance
and response-to-FormData mappings without invoking the uploader or its requests.
It neither recovers the previous network error nor authorizes another upload.
Preparation must not be
rerun as a diagnostic for an attempt-only failure.

When storage accepted the PDF but no native registration was observed,
`nexvia_inspect_quote_registration.py --request UUID` inspects the primary
DONE callback in a fresh owned editor. It separates nested preview callbacks,
reports route templates and metadata provenance, and observes captured
controller values without invoking the callback. Policy, storage, registration
and PO mutations remain blocked; it does not read the source PDF. Its private
per-request report preserves the original JSON evidence and does not authorize
registration, a replacement upload or PO submission. Callback structure cannot
recover an earlier upload's native ID or object key if those values were not
saved before the original browser context closed.

`nexvia_check_quote_policy.py --request UUID` is a separate, controlled
policy-only diagnostic for an attempt-only failure. It opens an owned unsaved
form, verifies the pinned native uploader, and resolves its captured controller
without calling the upload handler. It may perform one upload-security GET;
that lookup can allocate an unused upload-metadata record. It does not select
or read the quote PDF, upload to storage, submit a PO or send an email.
The standalone release bundles its reviewed validator in memory and leaves
installed modules and original request evidence unchanged.

The checker freezes a private per-request checkpoint before the policy GET
under `/config/nexvia-policy-checks/`. Once the lookup has been invoked, a
repeat run returns its saved sanitized result instead of making another
request. Its output contains fixed failure codes, response field types and
policy-condition shapes, without private URLs or signed values. It does not
clear the original upload attempt or authorize a purchase-request retry.

The version-2 checker requires a matching version-1 report that stopped on
policy conditions. It keeps a separate one-use checkpoint under
`/config/nexvia-policy-checks-v2/`; the original report is preserved. This
explicit second lookup distinguishes a missing `$` prefix, field casing and
source-appended fields that version 1 combined as `[other]`. It reports known
field aliases and bounded predicates rather than private policy values or
unknown field-name literals. Repeating version 2 replays its own result.
The diagnostic builder extracts its frozen validator bundle from the immutable
version-1 release, so correcting the upload runtime does not alter previously
published diagnostics or their reproduced checksums.

Browser callback diagnostics explicitly carry the current preparation recorder
into Playwright's callback greenlets. Without that binding, zero counters and
an empty event list are not evidence that no HTTP request occurred. Callback
observations and policy-check results remain diagnostic evidence only.

The adapter writes a private journal under
`/config/panelstock-request-journal/` before invoking creation. It persists the
terminal outcome before sending it back to PanelStock. A lost cloud response
retries that outcome, not PO creation.

If a create attempt exists without a verified result, the adapter reports
**Needs review**. Check Nexvia and the existing local result before any manual
recovery. Do not delete attempt/journal files or submit a new request to work
around an uncertain outcome.

Nexvia may clear the saved row's `default_job_id` draft helper and generate a
positive `project_cost_to_complete_link_id`. Saved verification accepts those
specific native changes; the actual job, EOW, ownership, line contents and tax
checks remain strict. Draft validation and preparation hashes are unchanged.

For a request whose original creation response points to an existing saved PO,
`nexvia_reconcile_existing_po.py --check` verifies that exact PO without creating
or changing it. An explicit `--reconcile` publishes the verified result and
delivers its original PO PDF through the existing confirmation pipeline. Supply
the original request UUID, project, internal PO ID and displayed PO number.
The command rejects quote requests, unreported original outcomes and conflicting
identities. It preserves the original request, preparation, attempt and main
journal bytes, and freezes recovery under a separate `reconciliations/` journal.
Repeated recovery reuses that evidence and the same confirmation job.

The packaged `install_nexvia_verification_update_v1.py` patch installs only the
allocation verifier and recovery helper over the exact supported NAS release.
It checks the existing PO before activation; a failed check restores the known
previous modules. Installation alone never reconciles, uploads or emails a PO.

Requests can be cancelled only while queued. Once the NAS has claimed one,
changes require review because a real creation attempt may already have begun.

The page distinguishes a verified PO from Resend acceptance. A pending email
does not require recreating the PO. Existing confirmation retry protections
continue to apply.
