# Update an existing Synology purchase-request bridge

This changes the NAS scripts and the companion web form. No Cloudflare Worker
deployment or Resend secret change is required. Do not create PO7413 again.

## Check current native schemas first

Copy `nexvia_inspect_live.py` to `/config` in the existing `nexvia-browser`
container. Keep Nexvia signed in, then run:

```sh
/config/nexvia-tools/bin/python /config/nexvia_inspect_live.py --project 60
```

Review `/config/nexvia-live-discovery.json` against the exporters and allocation
capture before enabling this version. It contains bounded route/schema names
and native allocation IDs, without credentials or full customer records. The
probe opens unsaved forms, blocks write methods, and never submits a PO.

Reports from version 2 onward include fixed failure stages and structural controls
before/after the native Add-row click. A completed script does not itself prove
that a native row was captured: check `nativeForms.samples[].inspection` and
`nativeRow` before enabling the updated creator. Use `--also-project ID` to
inspect another accessible project's EOW choices (at most two additional
projects). Only native rows can establish actual allocation defaults; nullable
schema declarations alone do not establish a null job or allocation value.
Version 3 also accepts the bounded native text identifier of a newly added
blank draft row, without exporting its value. It captures native job/EOW widget
identities and project job-link IDs alongside finance editor metadata. The
creator accepts such an identifier only with proof that the form and grid were
empty before the native Add control produced that row, then prepares new lines
with a null persistent ID.

## Replace the scripts together

1. In Synology **Control Panel → Task Scheduler**, disable the existing
   **PanelStock Nexvia bridge** task to prevent it restarting during the update.
2. Inspect `pgrep -af '[n]exvia_(requests|create)\.py'`. If a
   `nexvia_create.py` process is active, let it finish before stopping the
   watcher or replacing files. Stop only the existing `nexvia_requests.py --watch` process. If it is attached
   to the terminal, use Ctrl+C. For a background process, identify its exact PID
   with `pgrep -af '[n]exvia_requests.py --watch'`, then use `kill PID` for that
   process. Do not stop the browser or local form server.
3. Back up the existing six Python modules listed in `WEB-REQUESTS.md` and the
   private connection configuration in a private directory. With the watcher
   stopped, temporarily set `enabled` and `creationEnabled` false in
   `/config/panelstock-requests.json`, preserving the token, worker ID and mode
   `0600`. Then
   replace those six modules together with this version. Keep the configuration
   files, request folders and journals unchanged. The new creator intentionally
   refuses old preparations without native allocation proof.
4. Run the following read-only refresh checks in the container terminal:

   ```sh
   /config/nexvia-tools/bin/python /config/nexvia_projects.py --force
   /config/nexvia-tools/bin/python /config/nexvia_lookups.py --refresh --project 60
   /config/nexvia-tools/bin/python /config/nexvia_form_data.py --project 60
   ```

   These commands cannot create a PO. Check that the current Nexvia choices
   appear in the web form, including newly added entries and all EOW families.
5. After the read-only checks succeed, restore the connection's previous
   `enabled` and `creationEnabled` settings. Re-enable and run the existing Task Scheduler task. Its current `flock`
   command starts one watcher and logs to `/config/panelstock-requests.log`.
   Confirm that the bridge returns `idle` or a completed lookup result. Verify
   the web app reports the connection online.

The read-only helper checks do not claim cloud requests or create POs. Do not
use `nexvia_requests.py --once` as a read-only installation check: it can claim
queued work and may create a PO if creation is enabled.

The updater does not enable PO creation. Keep the existing `creationEnabled`
setting appropriate to your installation. Any genuine submission requires
fresh native mapping and current selected fields. An uncertain prior attempt
must be reconciled; never remove its sentinel or resubmit it as a new request.

## What to expect

The NAS refreshes the directory every five minutes. The web app polls projects
every ten seconds and refreshes the selected project's fields every five
minutes. Accessible new projects are merged into the directory. Cached project
entries are retained while full-list completeness remains unverified.

Supplier/account/tax exports require complete, stable native pagination. Failed
exports keep previous files, emit a warning, and eventually block stale lookup
publication. Current supplier permission and the selected request's COS/tax
choices are checked again during preparation. Generic EOW allocation uses the
native unsaved row; missing or ambiguous mappings require review.
