# Security and stock reliability update

## Add missing materials from Receive — 31 August 2026

- Admins can open a matching Add missing material dialog directly from Receive, including when the catalog is empty.
- Validates required material/colour, dimensions, reorder point and duplicates using the catalog validation. The new catalog item and zero-stock entry are created together, then selected automatically.
- Enter the delivery quantity and use Add to SOH to receive stock normally. Creating a catalog item alone does not increase stock. Worker permissions are unchanged.
- Verified end-to-end using isolated test data; all 61 automated checks pass.


## Shared CNC Excel status colours — 31 August 2026

- Connected Excel downloads now use whole-row conditional formatting: completed is green and pending is yellow, across all eleven columns and future refreshed rows. Headers and blank rows are unchanged.
- Download the workbook once again to receive the new rules; its existing one-minute refresh continues afterwards. Other exports are unchanged.
- Verified in Microsoft Excel: opens without repair, status changes switch colours after refresh, and newly added rows receive colours. All 57 automated checks pass.


## Compact CNC and catalog bulk entry — v2026.08.31.2

## CNC bulk entry
- Enter the order number and job reference once; both are required for bulk entry.
- Compact sheet-number and panel-ID columns replace the numbered row cards. Shorter fields sit together with a red trash icon at the end of each row.
- Add or remove rows as needed. Blank rows are ignored; incomplete rows and repeated sheet/panel pairs block the whole submission.
- Existing order cleanup, job-reference capitalization and panel-ID capitalization are preserved.

## Material catalog bulk entry
- Replaces the CSV import with an admin-only in-app form.
- Enter the required material and colour once, then add rows for thickness, width, height and reorder point.
- Dimensions are in millimetres and must be positive. Reorder point is an optional nonnegative whole number and defaults to zero.
- Incomplete sizes, invalid numbers and duplicate material/colour/size combinations in the batch or existing catalog are rejected before saving.
- New catalog items receive unique SKUs and matching stock entries with zero quantity through the existing synchronized batch-save workflow. Existing stock quantities remain unchanged.


- Verified with 56 automated checks and isolated browser testing.


## In-app CNC bulk entry — 31 August 2026

- Replaced CNC spreadsheet import with an admin-only form. Enter the order and optional job reference once, then add/remove sheet-number and panel-ID lines as needed.
- Empty lines are ignored; incomplete lines and repeated sheet/panel pairs block the whole submission. Existing order cleanup and capitalization apply to every new panel.
- Saves the batch through the existing synchronized schedule workflow. Single-panel scheduling, completion, catalog imports and Excel exports are unchanged.
- All 50 automated checks pass; browser testing confirmed validation and a multi-panel save with isolated test data.


## CNC panel confirmation — 31 August 2026

- Complete panel now opens a matching in-app confirmation showing the order, sheet and selected panel ID. Cancel or Escape leaves the panel unchanged.
- Confirmation completes only the selected pending panel; an already completed panel is not stamped again. Whole-sheet completion is unchanged.


## CNC completion actions and panel preview — 31 August 2026

- Stacked Complete sheet above Complete panel in both apps; renamed Mark complete to Complete panel.
- Sheet confirmation now lists all affected pending panel IDs, including search-hidden panels, with a scrollable keyboard-accessible list. Its count and IDs come from the same live set. Already completed panels remain unchanged.
- Verified the dialog and button arrangement in the browser and all 40 automated checks. No backend or inventory changes required.


## CNC panel capitalization and order sorting — 31 August 2026

- Panel IDs capitalize a leading letter on new entry/CSV upload. Existing IDs display the same way in both apps, the shared tracker and Excel without rewriting historical records; numeric IDs and leading zeros remain unchanged.
- Orders sort highest number first within each job, including prefixed IDs such as WO-1042. Orders without a number appear after numeric orders. All 40 checks pass.


## Compact CNC panel views — 31 August 2026

- Removed repeated job-reference and uploaded details from panel cards/rows in both apps and the shared tracker. Job headings, completion details and actions remain visible.
- Stored data, search, and the connected Excel export remain unchanged. All 38 checks pass.


## CNC job groups and upload cleanup — 31 August 2026

- Added collapsible job-reference groups above collapsible orders in both apps and the read-only shared tracker, with separate counts and a No job reference group.
- New single-panel entries and CSV uploads normalize job references to title case and remove the word Order and other non-digits from labelled order numbers, preserving leading zeros. IDs without the Order label remain unchanged.
- The server applies the same cleanup to new panels and rejects labelled orders containing no digits. Existing records are not rewritten when completed; display grouping consolidates job-reference casing without a data migration.
- Verified 38 automated checks plus browser entry, cleanup and nested expansion using isolated test data.


## Automatically refreshing CNC Excel workbook — 31 August 2026

- CNC Excel downloads now include a read-only web data connection that refreshes on opening and every minute while desktop Excel is open. Existing snapshot files need to be replaced with one new download.
- Excel may require Enable Editing / Enable Content for this workbook. Trust Center settings are not changed; no macros are included. The connection contains the same read-only sharing token as the tracker link, so share the workbook only with intended viewers.
- The static Excel feed preserves identifiers as text and is protected by the existing CNC share token. Empty schedules clear old rows on refresh. Browser/mobile viewers should use the live share page.
- Verified the one-minute timer in Microsoft Excel, empty/populated refreshes, leading zeros, and 33 automated checks. Production Worker deployment: e5aca84c44244021a93c5382b07a2aee.


## Collapsible CNC orders and mobile sharing — 31 August 2026

- Both apps group CNC panels into collapsible orders with pending and completed counts. Search reveals matching panels; expansion choices survive normal refreshes.
- The existing read-only share link now uses responsive panel cards, collapsible orders, search, status filters, Expand all/Collapse all and clearer connection warnings. Excel download and automatic updates remain available.
- No stock, CNC records or sharing permissions are changed. Verified 32 automated checks and a phone-width browser preview.


## CNC whole-sheet completion — 31 August 2026

- Sheet completion now uses a styled in-app confirmation dialog instead of the browser popup, with a live panel count, Cancel/Complete sheet buttons, Escape support and keyboard focus handling.

- Workers can select Complete sheet from a pending CNC panel in either app. Confirmation shows the order, sheet and number of pending panels affected, including panels hidden by search.
- Only pending panels with the exact same order and sheet numbers are completed. Earlier completion details and other sheets/orders are preserved. Individual panel completion remains available.
- Saves through the existing atomic, retry-safe sync process with a sheet activity entry. No stock is deducted. No backend permission changes are required.


## CNC Excel export hotfix — 31 August 2026

- Fixed invalid Excel downloads when the CNC schedule is empty. Exports now retain all 11 column headings without inventing a blank panel record.
- Applies to the shared download link used by both apps; no frontend update or inventory changes are required.
- Verified all 21 automated tests and opened the fresh production download in Microsoft Excel. Shared Worker deployment: `85c1b9c5d51448b3a5f96200541d45fb`.

## Original coordinated release

Release: v2026.08.31. Both frontends and the shared backend are deployed. Stock editing is enabled after successful production administrator sign-in and inventory verification in both apps.

This update must be released together with PanelStock desktop and the shared Cloudflare backend. The existing app layouts are largely unchanged.

## Changes

- Individual login sessions replace the shared app credential. Sessions expire after eight hours and can be revoked.
- The server verifies administrator permissions and limits repeated login attempts. Existing personal PINs remain supported; new and reset PINs require 6–12 digits.
- Stock movements and their activity records save together. Retrying the same saved request does not apply it twice.
- Conflicting changes are flagged instead of overwriting another person's work. Pending changes remain on the device for recovery and reconciliation.
- Server validation rejects invalid quantities and malformed records. Public debugging endpoints have been removed.
- Voided dispatches no longer contribute to job totals.
- Activity history is no longer limited to 800 entries. Full stock resets retain history and damage evidence.
- Restores create a recovery backup and reject pending edits created before the restore. Daily backups include inventory, history, user records and report settings.
- Scheduled reporting includes safeguards against duplicate sends.

## What users need to know

- Before the live switch, finish syncing on every device, export any unsent work and close both apps.
- After deployment, refresh the apps and sign in again using your existing account.
- Use one editing tab per app. Pending work stays associated with the account that created it.
- Conflicts require review; export pending work before discarding it.
- Login after a reload requires a connection. An already verified open app can queue changes offline.
- Previously deleted activity history cannot be recreated automatically.

## Validation and deployment status

The code passed 19 local automated checks and both GitHub verification workflows before this documentation update. Synthetic-data browser checks covered login in both apps, cross-app receiving, dispatch, administrator voiding, stock reversal and job totals.

Cloudflare access is restored. The isolated staging backend passed 12 cloud integration tests and five additional workflow checks with synthetic data and email disabled. Cloud-backed browser smoke checks also passed for both logins, receiving, dispatch, administrator voiding, stock reversal and corrected job totals. Production migration is complete and all 21 migrated data records match the independent export. Stock editing is enabled; production administrator sign-in and stock visibility were verified in both apps. Operators confirmed all devices were synced and closed before the verified backup and migration. See [STAGING_VALIDATION.md](STAGING_VALIDATION.md) for results and [RELEASE.md](RELEASE.md) for the deployment and rollback sequence.

Companion desktop change: [panelstock-desktop PR #1](https://github.com/matthewlakerdis-dev/panelstock-desktop/pull/1).
