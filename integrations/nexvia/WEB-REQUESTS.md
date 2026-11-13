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
- The NAS invokes the existing creation worker. That worker retains its live
  validation, saved-line verification and attempt sentinel.
- The adapter first prepares the saved request without submitting it, checks
  the exact prepared file and hash, then authorizes that preparation with the
  existing worker's `--submit` option. Preparation alone is never shown as a PO.
- Only a verified result displays a PO number and queues a Resend confirmation
  from `porequest@panelstockhq.com`.

The current NAS creation worker has been verified for **Miscellaneous EOW,
without a PDF**. A quote PDF up to 10 MB can be saved with the web request for
review; attaching one does not submit it to automatic PO creation. Other
unsupported cases are shown as needing review. Saving a request is not proof
that a PO exists.

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

Keep the existing `/config/nexvia_create.py`, local form server, Nexvia browser
sign-in and configuration. Copy `nexvia_requests.py` to
`/config/nexvia_requests.py` in the existing `nexvia-browser` container.

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

This publishes the existing project directory. Open **Purchase Requests**, pick
a project, then run another pass to load its choices. Check the choices and the
connection status before submitting a genuine request.

After the connection works and the existing creation worker is ready, set
`creationEnabled` to `true` and run under the container's existing supervisor:

```sh
/config/nexvia-tools/bin/python /config/nexvia_requests.py --watch
```

The request bridge polls every 30 seconds. It uses the saved
`/config/nexvia-projects.json`, the existing local form's GET lookup endpoint,
and the existing creation worker CLI. No NAS inbound port needs exposing.

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
