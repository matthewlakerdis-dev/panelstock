# Production release v2026.08.31

Deployment date: 31 August 2026, Australia/Brisbane.

Both frontends and the production backend are deployed. Stock editing remains temporarily paused (`READ_ONLY=true`) pending confirmation that existing users can sign in and see their inventory. No production test stock movements or manual report emails were sent.

## Deployment record

- Mobile merge commit: `ee54a8996078b0170a29796e9ea0ef0ccaa1004b` (PR #1).
- Desktop merge commit: `94636810b41933159da2620a0848d9b73347caa1` (companion PR #1).
- Production Worker: `panelstock-reports`.
- Read-only Worker deployment after migration: `fe5b2435d92948199493aea7563e9ad6`.
- Migration is disabled for subsequent requests/deployments (`MIGRATION_READY=false`).
- Existing scheduled trigger remains `*/15 * * * *`. Read-only mode suppresses scheduled reports and writes until editing reopens.

## Backup and migration verification

The operator confirmed all devices had synced/exported pending work and closed both apps. A maintenance Worker paused live requests and scheduled writes. The current Worker source/settings and all 23 legacy KV records were then exported privately; a second read confirmed no records changed during export.

The new SQLite-backed inventory imported all 21 applicable data records, including current stock, all four user accounts, report settings, registration configuration and historical backups. SHA-256 comparisons against the independent export matched every imported record. Inventory revision remained zero, confirming no new inventory mutations during verification. The remaining legacy schedule marker and obsolete stock snapshot remain preserved in the independent export and unchanged legacy KV.

Verified inventory counts: six full-panel variants, 18 offcuts, six catalog records, 34 activity entries and zero CNC panels. User credentials and roles were preserved without resetting PINs.

A temporary, randomly authenticated verification Worker compared internal record hashes and was deleted after verification. It did not expose inventory or account records publicly. Existing email secrets and the CNC share token were preserved as secret bindings. The obsolete shared secret remains stored for rollback handling but is never accepted by the new API.

## Deployment checks

Both GitHub verification and Pages deployment workflows passed for the merge commits. Live `index.html` and `panelstock-client.js` from both custom domains matched the tested repository files after newline normalization. Authentication rejects unauthenticated requests, debug routes return 404, and cross-origin preflight allows both production apps.

Pre-release checks: 19 local automated checks, 12 cloud integration tests, five extra cloud workflows, and authenticated browser smoke checks across mobile and desktop. See [STAGING_VALIDATION.md](STAGING_VALIDATION.md).

## Final operator check

Open both apps, refresh and sign in using existing accounts. Confirm the expected stock is visible. Administrator and ordinary-user production sign-in have not been claimed as tested by the release agent, which does not have personal PINs. After this check, reopen editing by setting `READ_ONLY=false`, then verify the first real stock operation and its activity on the other app.

Do not roll back to the legacy Worker after new writes without exporting and reconciling the authoritative inventory. Legacy KV is no longer updated by the new apps. See [RELEASE.md](RELEASE.md).
