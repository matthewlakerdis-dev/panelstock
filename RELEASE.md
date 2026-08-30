# Coordinated security and stock-integrity release

Status: prepared for review. Production has NOT been switched by this change.

Validation so far: 19 local checks pass, and both GitHub verification workflows pass. Browser smoke tests covered both logins, a receipt reflected across apps, dispatch, admin void, stock reversal and corrected job totals. Creating isolated staging KV storage was attempted but Cloudflare returned authentication error 10000. No staging resource was created; enable the required KV creation/write and Worker deployment permissions before cloud staging validation. Local testing uses synthetic records only.

## Preconditions

1. Review and merge the matching mobile/Worker and desktop pull requests only within a coordinated release window. Record both commit SHAs and the deployed Worker version.
2. Run both verification workflows and a local/browser smoke test. Check receiving, dispatch, offcuts, damage with photos, CNC completion, voiding, reports and backups.
3. Ask operators to finish/sync current work, export any unsent changes, and close both old apps. Pause all writes for the migration. Do not assume that an old device marked synced proves all other devices are synced.
4. Take a fresh independent export of all current `app:*`, `users`, `config`, `registration_code`, schedule markers, and existing backup keys. Preserve the deployed Worker source and configuration privately. The earlier review export was sequential while the system was live, so it must be refreshed in the release window.
5. Preserve the existing `DEFAULT_PIN`, `FROM_EMAIL`, `RESEND_API_KEY` and, if present, `PIN_SALT` secret bindings. Configure `CNC_PUBLIC_TOKEN` privately if existing share links must continue. Do not put these values in Git or a PR.

## Deployment sequence

1. Prepare the production Worker using `worker/wrangler.production.jsonc`. Its defaults are read-only and migration-disabled to prevent an accidental cutover. The new binding is `INVENTORY` (`InventoryStore`, SQLite); legacy KV is renamed to `LEGACY_KV` with the existing namespace ID. This adds storage and may affect Cloudflare usage/billing; inspect the account plan before approval.
2. With all writers stopped and the independent export verified, deploy the new Worker with `MIGRATION_READY=true` and `READ_ONLY=true`. Old `/data` POST and `/sync` clients can no longer write. The first request initializes the per-site object from existing KV and imports old backups once. It does not write back into legacy KV.
3. Publish both updated frontends during the same window. Everyone must refresh and log in again. Existing personal PINs remain valid; resets/new PINs use the new policy.
4. Verify an existing administrator and an ordinary user can log in, compare stock/catalog/offcut/CNC counts and quantities against the paused export, check history and settings, and confirm old shared-token requests fail. Inspect migration errors before proceeding. Do not test with production stock changes yet.
5. Verify a recovery path and new backup availability. Check the existing 15-minute trigger and report timezone. The Worker uses the preserved reporting secrets, and migration read-only mode suppresses scheduled writes/emails.
6. Only after explicit release approval, set `READ_ONLY=false` and reopen editing. Keep `MIGRATION_READY=false` on subsequent deployments; the initialized object no longer imports KV.
7. Verify a real user-approved stock operation, refresh the other app, and check the corresponding activity. Remove the obsolete `SHARED_SECRET` binding once rollback handling is settled. It is never accepted by the new API.

## Rollback

Before new writes are enabled, pause traffic and restore both old frontend commits and the saved Worker only if the security exposure is understood; legacy KV has not been modified by migration.

After any new write, do NOT simply restore the old Worker. Legacy KV is stale. Pause editing, export/reconcile the authoritative Durable Object state and all pending batches, then prepare a reviewed rollback/migration. Reverting code alone would lose post-cutover changes and reopen the former access vulnerabilities.

## Recovery behavior

- A conflict or rejected batch remains saved locally. Export it, compare with server history and current stock, and re-enter only movements that were not applied. The app offers explicit discard only after initiating a recovery export.
- Restore requires the revision the operator reviewed. Every restore increments a restore epoch; pending batches from earlier epochs are rejected even if their quantities happen to match.
- Database backups include users/config for disaster recovery, but the app's stock-restore action intentionally does not overwrite current user credentials or roles.
- Activity records are append-only except for an admin void marker. Older history already removed by the previous 800-entry cap cannot be recovered automatically; inspect retained historical backups if needed.
