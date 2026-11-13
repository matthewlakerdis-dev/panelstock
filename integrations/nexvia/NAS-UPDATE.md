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

The version 2 report includes fixed failure stages and structural controls
before/after the native Add-row click. A completed script does not itself prove
that a native row was captured: check `nativeForms.samples[].inspection` and
`nativeRow` before enabling the updated creator. Use `--also-project ID` to
inspect another accessible project's EOW choices (at most two additional
projects). Only native rows can establish actual allocation defaults; nullable
schema declarations alone do not establish a null job or allocation value.

## Replace the scripts together

1. In Synology **Control Panel → Task Scheduler**, disable the existing
   **PanelStock Nexvia bridge** task to prevent it restarting during the update.
2. Stop only the existing `nexvia_requests.py --watch` process. If it is attached
   to the terminal, use Ctrl+C. For a background process, identify its exact PID
   with `pgrep -af '[n]exvia_requests.py --watch'`, then use `kill PID` for that
   process. Do not stop the browser or local form server.
3. Back up the existing six Python modules listed in `WEB-REQUESTS.md`, then
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
5. Re-enable and run the existing Task Scheduler task. Its current `flock`
   command starts one watcher and logs to `/config/panelstock-requests.log`.
   Confirm that the bridge returns `idle` or a completed lookup result. Verify
   the web app reports the connection online.

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
