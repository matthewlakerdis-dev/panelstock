# Cloud staging validation — 31 August 2026 (Brisbane)

Production has not been changed. Cloudflare authentication and write access now work.

## Isolated environment

- Worker: `panelstock-reports-staging`.
- URL: `https://panelstock-reports-staging.matthewlakerdis.workers.dev`.
- KV: `panelstock-staging-security-review`, containing synthetic inventory and independently generated test accounts only.
- SQLite Durable Object: `InventoryStore`, site `panelstock-staging-review`.
- No production secrets, stock or user accounts were copied. Email sending is disabled; no cron trigger was configured.
- Initial import used `MIGRATION_READY=true`; subsequent staging configuration uses `false` to prevent re-import. Staging remains writable for testing.
- Local preview frontends use ports 8092 (mobile) and 8093 (desktop), with the backend URL replaced only in the served response. Production frontend URLs in Git remain unchanged.

## Passed checks

All 19 local checks passed again against a fresh build. The following 12 integration tests also passed over HTTPS against Cloudflare:

1. Shared credentials and claimed administrator usernames cannot authorize access.
2. Sessions identify the actual user; public debug endpoints are unavailable; legacy snapshot writes are rejected.
3. Stock and activity commit together; retries are deduplicated; stale writes conflict.
4. Invalid quantities, missing stock activity and activity deletion are rejected.
5. Logout revokes the session.
6. Administrator voiding reverses stock and records the actual administrator.
7. Registration cannot inherit a caller's administrator permissions.
8. PIN reset revokes old sessions and requires changing the temporary PIN.
9. Restore checks the reviewed revision, retains history and rejects pre-restore edits.
10. Repeated failed login attempts are rate-limited.
11. Two concurrent consumers of the same stock snapshot cannot both succeed.
12. Activity survives beyond 800 entries.

Five additional checks passed: staff offcut creation/dispatch; atomic damage/photo saving and evidence protection; administrator CNC scheduling with staff completion; report settings/backup listing with email blocked; accepted frontend origins and rejection of an untrusted origin.

The first test attempt preceded propagation of the new Worker URL and received an HTML response before login. After the endpoint served the Worker, the complete 12-test run passed. No failed application assertion was hidden or removed.

## Cloud-backed browser smoke checks

After explicit user approval to submit the synthetic credentials, desktop administrator and mobile staff sign-in both succeeded. Desktop receiving added two panels (7 to 9), which mobile displayed after reload. Mobile dispatched one panel to `STAGING-VISUAL-JOB` (9 to 8), and desktop showed one panel against that job. Desktop administrator voiding restored stock to 9 and removed the voided job from totals in both apps while preserving its activity record. Staff settings did not expose administrator controls. Both test accounts were logged out afterward.

The browser operation timed out while handling the void action; inspection afterward confirmed it had already saved and synced. The action was not repeated. Screenshots and DOM checks used the desktop browser viewport; this does not certify physical phone camera/QR behavior or every responsive breakpoint.
## Still required before live release


- Confirm all operators have synced or exported pending work and closed both old apps.
- Pause live writes and take a fresh independent production backup, then follow the migration, read-only verification and rollback steps in [RELEASE.md](RELEASE.md).
- Verify production administrator/staff sign-in, migrated data, reporting configuration and backup availability before enabling stock editing.

API tests do not prove end-to-end email delivery or every browser workflow. No test stock movements or emails were sent to production.
