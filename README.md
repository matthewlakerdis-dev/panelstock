# PanelStock mobile

Mobile inventory app deployed through GitHub Pages. The matching desktop app lives in `matthewlakerdis-dev/panelstock-desktop`. Both must use the same API release.

## This coordinated release

- Individual, revocable, eight-hour sessions replace the public shared credential. Existing PIN hashes are supported; new PINs require 6–12 digits and use salted PBKDF2.
- The Worker enforces user/admin permissions and rate limits login attempts. Browser identity flags are not trusted.
- Immutable, persistent local batches combine stock and activity changes. The server checks the expected previous records and commits changes atomically in a SQLite Durable Object per inventory site.
- Conflicts stop automatic retries and preserve pending data for export/reconciliation. Retrying an acknowledged mutation does not apply it twice.
- Stock data is validated on the server. Whole-collection replacement endpoints are retired. Debug endpoints return 404.
- Voided dispatches are excluded from jobs. Activity history is no longer capped at 800 entries or deleted by full reset.
- Daily backups contain stock, history, user records, and report settings. Stock restoration preserves activity history, takes a pre-restore backup, and invalidates stale pre-restore edits.

`panelstock-client.js` is shared verbatim with the desktop repo. Keep both copies identical for coordinated releases. The Worker source of truth is `worker/` in this repository; it is not duplicated in the desktop repo.

## Verification

Use Node 22 or later. From `worker/`, run `npm ci` then `npm test`. The test script builds the Worker without deploying it and runs against local Cloudflare workerd with synthetic data. No production bindings, live PINs, or email delivery are used in tests.

The frontend remains a pre-built React HTML bundle. This change deliberately preserves the layouts; recovering a modular React source tree remains separate follow-up work.

## Operations and limitations

- Read [RELEASE.md](RELEASE.md) before any deployment. Merging this frontend alone against the old Worker breaks login; deploying the new Worker blocks old apps from writing.
- Pending batches belong to their original user. A different user cannot send them. One editing tab per app origin is allowed.
- A server connection is required to verify login after a reload. An already verified open app can stage offline changes. A conflict requires review; the app does not silently merge conflicting stock quantities.
- The browser stores pending changes and its cached stock view in localStorage. Storage exhaustion stops editing and offers recovery export. Photos/history can eventually require IndexedDB and paginated reads; they are not silently discarded to stay under a quota.
- Session tokens are kept in sessionStorage and never stored in Git. The apps still use their existing external Tailwind runtime and analytics scripts; bundling CSS and reducing third-party script access is a separate hardening task.
- The old KV store is migration input only, never the new authoritative writer. Do not point old clients at any alternate legacy writable Worker.
- Backups inside the Durable Object are not a replacement for independent exports and recovery drills.
- Existing public CNC share links can be preserved by configuring the existing read-only token as a Worker secret. That token is no longer embedded in the frontend code; authenticated users can retrieve the share link token. Anyone already holding a share link retains read-only CNC access.
