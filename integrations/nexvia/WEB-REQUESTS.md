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
- The NAS invokes the no-PDF creation worker with fresh native line defaults.
  It retains live validation, saved-line verification and the attempt sentinel.
- The adapter first prepares the saved request without submitting it, checks
  the exact prepared file and hash, then authorizes that preparation with the
  existing worker's `--submit` option. Preparation alone is never shown as a PO.
- Only a verified result displays a PO number and queues a Resend confirmation
  from `porequest@panelstockhq.com`.

No-PDF requests use the native allocation for the selected EOW, including its
job, budget, category and assembly links. EOW IDs are opaque: the connector
never derives an allocation from an ID suffix. There is no Miscellaneous-only
allowlist. If Nexvia does not expose an unambiguous native allocation, the
request needs review before any submission. A quote PDF up to 10 MB can be
saved with the web request for review; attaching one does not submit it to
automatic PO creation. Saving a request is not proof that a PO exists.

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
when switching projects, preserving selected IDs and draft lines while only
the EOW menu loads. A matching full project catalog and revision are still
required before submission; an EOW from another project is never carried over.
The authenticated shared-choices response contains no EOWs, request details or
project catalog revision, and keeps its original verification timestamp.
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

## Uncertain results and recovery

The adapter writes a private journal under
`/config/panelstock-request-journal/` before invoking creation. It persists the
terminal outcome before sending it back to PanelStock. A lost cloud response
retries that outcome, not PO creation.

If a create attempt exists without a verified result, the adapter reports
**Needs review**. Check Nexvia and the existing local result before any manual
recovery. Do not delete attempt/journal files or submit a new request to work
around an uncertain outcome.

Requests can be cancelled only while queued. Once the NAS has claimed one,
changes require review because a real creation attempt may already have begun.

The page distinguishes a verified PO from Resend acceptance. A pending email
does not require recreating the PO. Existing confirmation retry protections
continue to apply.
