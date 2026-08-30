# Security and stock reliability update

Release status: prepared for coordinated deployment; not yet live.

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

Cloudflare access is restored. The isolated staging backend passed 12 cloud integration tests and five additional workflow checks with synthetic data and email disabled. Cloud-backed browser smoke checks also passed for both logins, receiving, dispatch, administrator voiding, stock reversal and corrected job totals. Production migration remains pending. Operators must finish syncing before a fresh backup and coordinated migration. See [STAGING_VALIDATION.md](STAGING_VALIDATION.md) for results and [RELEASE.md](RELEASE.md) for the deployment and rollback sequence.

Companion desktop change: [panelstock-desktop PR #1](https://github.com/matthewlakerdis-dev/panelstock-desktop/pull/1).
