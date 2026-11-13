# Nexvia confirmations through PanelStockHQ

This bridge only sends email for an existing verified PO. It never creates,
updates or submits a Nexvia purchase order. The NAS remains private and makes
outbound HTTPS requests to PanelStockHQ. The existing `RESEND_API_KEY` stays in
the production `panelstock-reports` Worker; the NAS does not need a Resend key.

Confirmations use `PanelStockHQ <porequest@panelstockhq.com>`. Reports and site
order senders retain their existing settings. Resend acceptance means the
provider accepted the email; it does not prove delivery to the inbox.

## First: send the authorized PO7413 test

Deploy the reviewed code through the existing **Deploy production Worker**
GitHub Actions workflow, using **Run workflow** on the branch containing this
change and selecting **Send the requested PO7413 email test once**. This uses
the repository's existing Cloudflare secrets. No new Resend API key is needed.

The fixed email contains:

- Recipient: `matt@lennoxfacades.com`
- Sender: `porequest@panelstockhq.com`
- Existing PO: `PO7413`, internal ID `1421`, project page `60`
- Project: Jardin building
- Total: AUD $1,100.00 including GST

The workflow deploys a temporary, short-lived, authenticated Cloudflare Worker
that can call only the fixed email test RPC on the existing production Durable
Object. The helper never reads the Resend secret. It is deleted in `finally`,
and its authentication expires after five minutes even if deletion fails.
The workflow reports success only with a persisted Resend provider ID. A
repeat run returns the same test job and cannot create a second test email.
No live Nexvia re-verification is claimed by this rendering/delivery test.

An administrator may also POST an empty JSON object to
`/integrations/nexvia/test-confirmation` with their normal PanelStock session.
That route uses the same fixed test job. The NAS credential is not accepted on
the administrator route or on any stock, order or PO creation route.

## Connect the NAS after the test passes

1. Copy `nexvia_confirmations.py` to `/config/nexvia_confirmations.py` in the
   existing `nexvia-browser` container's configuration folder. Keep the existing
   creation worker and form files.
2. Create `/config/panelstock-confirmations.json` privately on the NAS:

   ```sh
   /config/nexvia-tools/bin/python - <<'PY'
   import json, os, secrets
   path = '/config/panelstock-confirmations.json'
   fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
   with os.fdopen(fd, 'w') as stream:
       json.dump({'enabled': False, 'token': secrets.token_urlsafe(48)}, stream)
   print('Private configuration created; token was not printed.')
   PY
   ```

3. Using File Station's private editor, copy the generated `token` value into
   the **panelstock** repository's **Settings → Secrets and variables → Actions
   → New repository secret**, named `NEXVIA_CONFIRMATION_TOKEN`. Keep it out of
   chat, Git and logs. Run **Deploy production Worker** again to install that
   narrow credential in Cloudflare. This preserves the existing Resend key.
4. After the test is accepted, change only `enabled` to `true` in the NAS
   configuration, preserve the token and restrict the file to mode `0600`.
5. Run one confirmation pass in the existing container:

   ```sh
   /config/nexvia-tools/bin/python /config/nexvia_confirmations.py --once
   ```

6. For ongoing confirmations, run the bridge under the container's existing
   process supervisor with:

   ```sh
   /config/nexvia-tools/bin/python /config/nexvia_confirmations.py --watch
   ```

The bridge reads the existing `/config/nexvia-projects.json` project names and
`/config/nexvia-requests/<UUID>/request.json` and `nexvia-result.json` records.
Only matching `CREATED_VERIFIED` results are eligible. No browser or Nexvia
creation code is imported. The default configuration is disabled.

## Retry and status behavior

The NAS persists the first exact payload before sending. The server snapshots
the resulting email and deduplicates by existing PO ID and test/live lane.
Changed details for the same PO are rejected; they cannot silently generate a
second email. The fixed test and the real requestor confirmation are separate
lanes, so the test does not mark the requestor's real confirmation as sent.

Queued/retrying responses are not reported as sent. The server retries transient
provider failures through the existing 15-minute cron, with leases, a stable
Resend idempotency key and a 23-hour cutoff after the first provider attempt.
After that cutoff, an ambiguous delivery needs provider review. `failed` and
`needs_review` states stop automatic NAS submissions; inspect the provider and
stored record before making any manual change.

The NAS writes a separate local confirmation receipt when Resend acceptance is
reported. It updates the legacy `requestorEmailSent` field only if its saved
request/result snapshots still match. Separate bridge processes share a lock;
the older creation worker does not share that lock, so the separate receipt is
the authoritative email record if the legacy result changes concurrently.

## Local validation (no emails or PO mutations)

```sh
cd worker
node --test test/nexvia-confirmation-email.test.mjs
node scripts/send-nexvia-confirmation-test.mjs
cd ..
python3 -m unittest discover -s integrations/nexvia -p 'test_*.py'
```
