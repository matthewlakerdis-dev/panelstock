# Villa Scopes

Villa Scopes is a PanelStockHQ module using the existing username/PIN accounts and `INVENTORY` SQLite Durable Object. Managers maintain the shared register on desktop; the iPad report offers filters, search, sorting and document links. It checks for changes every 30 seconds while visible and when brought to the foreground.

## Access and use

After deployment, open **Work → Villa Scopes** in the desktop app. Administrators have access automatically. In **User Access**, grant other users **View villa scope report** (`site.scopes.view`) or **Manage villa scopes** (`site.scopes.manage`). Both are off by default; management includes viewing. Existing app access restrictions still apply.

The management page opens from PanelStock using a one-use ticket, valid for 60 seconds. It exchanges that ticket for a module-only session, removes the ticket from the address bar and stores the session in the current tab. A direct link supports the existing PanelStock username/PIN login. Parent logout, account deactivation, PIN reset, app restrictions and task changes are checked on subsequent requests. An account requiring a PIN change must update it in the main app first.

Use **Add entry** for each villa/scope/colour combination, **Edit** for its details and PO numbers, and **Links** for document URLs. Stage, Villa, Scope type, Scope description and Colour are required. Stage, Villa and PO references remain text, including leading zeroes and stages such as `5a`. Multiple scopes per villa and multiple POs per system remain separate. Delete asks for confirmation inside the page and leaves the documents themselves intact.

**iPad report link** supplies the viewing URL, containing neither credentials nor register data. The production target, available only after release, is:

`https://cnc.panelstockhq.com/villa-scopes/view?app=web`

Open it in Safari and sign in with an authorised PanelStock account. Report sessions cannot modify entries even when the signed-in account is an administrator. Villa, Scope and each Nexvia, Palm Lakes and Knotwood PO reference open their assigned HTTPS document URLs. OneDrive/SharePoint document permissions remain in force. The module stores URLs, not uploaded PDFs; it does not change document sharing permissions.

## Initial import and ongoing data

The live register starts empty. From management, expand **Import & backup tools → Import Excel** and choose the populated `.xlsx` or `.xlsm` register after saving it in Excel. The reader accepts these headers in the first 25 rows of the workbook:

| Source | Required headers |
| --- | --- |
| VillaScopes | ScopeEntryID, Stage, Villa, ScopeType, ScopeDescription, Colour, VillaPDFURL, ScopePDFURL |
| POReferences | ScopeEntryID, POSystem, PONumber |

`DocumentURL` is optional on POReferences. POSystem must be `Nexvia`, `Palm Lakes` or `Knotwood`. Cell hyperlinks on Villa, ScopeType or PONumber also supply their document URLs. Keep identifiers as text in Excel. Each scope needs a unique, stable ScopeEntryID; do not merge entries by villa number. Blank rows are ignored, while duplicate IDs, orphan POs and invalid document URLs block the import.

Review the preview before importing. Import merges by ScopeEntryID, keeps entries absent from the file, and replaces the imported entries' PO associations. Blank imported URLs retain the matching saved document links. To clear a saved URL, use **Links**. Cancel does not write anything. If another manager changes the register after preview, refresh and review the import again.

Import is a snapshot; edits to the Excel workbook do not sync automatically. After initial import, maintain the shared register here, or deliberately re-import an updated workbook. The workbook and its macros are never changed or executed. No example records, private workbook, PDFs or real document URLs are deployed.

## Storage, conflicts and backups

Entries, revisions, deletion tombstones and a bounded mutation ledger use `villa-scopes:*` documents in the existing SQLite-backed store. New SQL tables hold scoped sessions and tickets. There is no new Cloudflare binding, bucket, DNS record, secret, Microsoft app registration or external database.

Every write checks current access and the reviewed entry revision; imports check the reviewed register revision and commit atomically. Conflicts retain the open fields. If a response is lost, retry the same save without changing the fields; the mutation ID prevents applying it twice. If fields were changed after an uncertain save, reload and review the saved entry before retrying. Deleted IDs remain tombstoned so an old import cannot silently resurrect a deleted scope. Recreating a reviewed deleted scope requires a new ID.

Limits: 5,000 active entries, 4 MiB of canonical register data, 32 KiB per entry and 100 PO associations per entry. A workbook upload can be at most 20 MB. Requests are subject to the existing Worker body limit and per-user write limits.

**Download backup** exports the register and document URLs as compatible version-1 JSON without session tokens. **Import backup** previews and merges that JSON like Excel. Keep backups private. Existing scheduled/admin backups also include the active register under `villaScopes` when it exists. The stock restore path does **not** restore or overwrite this module. To recover an active register from a full backup, use its `villaScopes` object as the module's JSON import. Import is a merge, not a complete historical rollback; tombstoned IDs need explicit review and new IDs.

## Release order

This is a coordinated change with `matthewlakerdis-dev/panelstock-desktop`, branch `codex/villa-scopes-module`.

1. Review and release this Worker change first using the existing production workflow. Its push trigger runs on `main`; pushing the feature branch does not deploy production. No stock migration, stock restore or maintenance flag change is needed.
2. Check the management and `/view` HTML pages and the Excel reader asset on the existing CNC host. An unauthenticated `GET /villa-scopes/records` must return 401. With a test account, verify both task permissions, a saved entry and document link, and read-only report access.
3. Release the desktop counterpart second. Its existing Pages workflow publishes `main`. The build now explicitly packages `villa-scopes-launcher.js`.
4. Grant the intended users access, import the current populated workbook, review the records and open the generated report link on the iPad. Test the real iPad's Safari login and document permissions before operational use.

For rollback, first revert the desktop navigation, then revert the Worker feature if necessary. The namespaced register data remains stored; reverting code does not delete it. Back up newly entered data before any recovery operation.

## Development and validation

Node 22 or newer is required. From the repository root:

```sh
npm ci --prefix worker --cache /workspace/.cache/npm --no-audit --no-fund
node worker/scripts/villa-scopes-page.mjs
XDG_CONFIG_HOME=/workspace/.cache/panelstock-worker WRANGLER_LOG_PATH=/tmp/panelstock-worker.log npm --prefix worker test
```

Edit `worker/templates/villa-scopes*` and regenerate; do not edit the generated `src/villa-scopes-page.js` or `src/villa-scopes-excel.js` directly. The pinned ExcelJS 4.4.0 reader is served from the same Worker and loaded only when importing; its MIT license is retained in `worker/assets/villa-scopes`.

Backend tests cover validation, text IDs, duplicates, conflicts, atomic imports, retries, permissions, parent logout, task revocation and session confinement. `worker/test/villa-scopes.browser.mjs` is an optional real Chromium/Miniflare check requiring Playwright and Chromium; it exercises desktop editing, links, Excel import/cancel/merge, a lost response after commit, secret-free export, and tablet portrait/landscape layouts. Run after building the Worker with `npm test`. Tablet emulation does not replace testing physical Safari.
