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

## Still required before live release

- Complete visual checks of both apps against cloud staging. The browser safety policy blocked automated submission of the synthetic staging PIN, so authenticated cloud browser checks have not been claimed as passing. Previous authenticated browser checks used the local backend.
- Confirm all operators have synced or exported pending work and closed both old apps.
- Pause live writes and take a fresh independent production backup, then follow the migration, read-only verification and rollback steps in [RELEASE.md](RELEASE.md).
- Verify production administrator/staff sign-in, migrated data, reporting configuration and backup availability before enabling stock editing.

API tests do not prove end-to-end email delivery or every browser workflow. No test stock movements or emails were sent to production.
