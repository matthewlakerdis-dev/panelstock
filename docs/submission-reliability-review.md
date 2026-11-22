# Submission reliability review — 21 November 2026

The observed dispatch failures were backend failures, including an exhausted database-write allowance and a Worker memory reset. A browser retry alone does not prevent either cause.

## Changes

- Store new QA and monthly Safety audit evidence in the existing private R2 bucket. Keep references in database records, preserve original bytes and signed evidence metadata, and resolve authorized downloads and PDFs through the server.
- Stream QA JSON and ordinary API responses across the Worker/Durable Object boundary. Large histories must not require a single serialized RPC value or another full JSON copy.
- Gradually replace older inline evidence: at most eight distinct QA photos and one Safety file per maintenance run. Upload before replacing the database record; compare the original revision/digest before committing. Never automatically delete evidence objects.
- Confirm uncertain bulk dispatch, Site order creation and offline monthly audit submissions using an authenticated read-only request. Confirmation uses the saved request identifier; dispatch and audit checks also verify the exact payload. Unknown stays unknown. Retrying uses the original identifier.
- Reject cross-account order-create nonce reuse.
- Add an administrator-only `/admin/reliability` report with database document sizes and maintenance progress, and scheduled read-only availability probes for each public app and shared API authentication.

## Submission families reviewed

| Family | Existing protection | Change / remaining limit |
| --- | --- | --- |
| Bulk order dispatch | Atomic transaction, reviewed versions, actor-bound receipt, partial-balance checks | Read-only confirmation; client retains immutable batch on unknown outcome |
| Individual dispatch / delivery | Mutation receipts and balance/version checks | Existing retry behavior retained; no blanket automatic resubmission added |
| Site order creation | Durable local outbox and stable idempotency key | Read-only confirmation and actor-bound nonce replay |
| Site order files / finalization | File IDs, hashes, upload reconciliation, durable checkpoints and finalization receipt | Existing protections retained |
| Monthly audit drafts / evidence | Revision checks, actor/payload-bound mutation receipts, signed completion | Private R2 evidence and read-only confirmation in offline request transport |
| Audit corrective actions | Mutation receipts and revisions | Private R2 evidence; existing retry behavior retained |
| QA inspection / supplementary photos | Status/permission checks; additions have stable mutation receipts | Private R2, async-write conflict checks, streamed responses; QA inspection itself has no new universal mutation receipt |
| Mobile stock / offline work | Existing account-bound queues and operation-specific validation | No universal exactly-once guarantee introduced |
| Other admin forms | Existing endpoint-specific validation and authorization | No blanket automatic retry; universal mutation receipts remain future work |

## Verification

Exercise real Worker/Durable Object requests with a QA history larger than 32 MiB, a twenty-order batch against large saved evidence, lost responses, service errors, unknown confirmations, changed accounts, changed payloads, partial dispatch quantities, object-storage failures, corrupted evidence and concurrent backfill edits. Confirm PDF attachments preserve original photo bytes. Run the repository regression suites and production deployment checks.

## Operations and limits

Availability probes run approximately every 15 minutes through GitHub Actions. Scheduling can be delayed. Failure uses the existing Actions notification settings; this is not a paging service and does not predict memory or database quota exhaustion. Public checks do not submit customer data or validate an authenticated save. Worker observability remains enabled.

### Native monitoring added 22 November 2026

The existing Cloudflare quarter-hour scheduled handler now runs an account-wide, read-only Durable Object analytics query independently of GitHub scheduling and application storage. It runs even while application maintenance is enabled. A dedicated account-scoped **Account Analytics Read** token is stored as the `DATABASE_ANALYTICS_TOKEN` Worker secret; the deployment token is never used as the runtime fallback. CI provides the account identifier as a runtime binding. No application records or raw request logs are included in monitoring events.

The collector allows five minutes for analytics ingestion and retains UTC usage-day boundaries. It warns at 80,000 observed daily writes, or at a 100,000 projected daily total only after one elapsed hour, 20,000 observed daily writes and 10,000 last-hour writes. Recent memory, CPU and internal-error counters also warn. These are conservative operational references, not verified Paid plan quotas, billing allowances or spending caps. Missing, denied or invalid analytics produce an explicit unavailable state and omit usage counts.

Three native Cloudflare email policies cover usage warnings, unavailable analytics and absence of valid measurements for 45 minutes. They evaluate every 15 minutes and repeat at most hourly, using the existing budget alert email destinations. They activate only after a real valid production sample is indexed and their SQL, destinations and saved settings are verified. Activation may wait for the next scheduled invocation. Existing storage growth, storage silence, billing and runtime issue alerts are retained. API acceptance and notification history establish dispatch; inbox receipt requires recipient confirmation.

A denied or incomplete credential setup is reported explicitly while application fixes continue to deploy. Database-usage alert activation remains pending until a real validated sample is available; the existing GitHub usage check remains as an additional path.

Provisioning preserves an existing named Worker secret. If authorized, it creates exactly one account-scoped Analytics Read token with a 365-day expiry, validates it and installs it privately. It never broadens the deployment credential. If Cloudflare denies token management, create that dedicated read-only token in the account's API Tokens page and save it privately either as the Worker secret `DATABASE_ANALYTICS_TOKEN`, or as repository Actions secret `CLOUDFLARE_ANALYTICS_API_TOKEN` for installation by the deployment workflow. Never send the token in chat. Rerun deployment after installation; verify indexed measurements and enabled policies. Rotate before expiry; an unavailable/silence alert does not itself repair an expired credential. Ambiguous creation or installation requires inspection before retrying; no automatic reminting or revocation is performed.

Additional real Site-client-to-Worker tests exercise pre-send failure, a lost committed response, reload with unavailable confirmation, database rollback and a lost R2 upload acknowledgement. They verify stable saved request packets, actor-bound reconciliation, one order/email job and exact downloaded attachment bytes. These tests send no email and do not mutate production records.

Follow-up memory checks identified three further unnecessary allocations. Workshop Stock now shares one request-local parsed state between the view and administrator references, and successful synchronous mutations use their just-committed state for the response. Historical reporting verification scans SQLite chunks while retaining only revision and complete stocktake records, preserving the original deep tamper checks without parsing unrelated catalogue images. QA status migration counts inspect the supported status fields instead of serializing every photo-bearing record twice. The real Workshop Stock transport test includes over 33.5 MB of saved image data and a response over 67 MB; this proves transport and data preservation at that fixture size, not universal heap safety under every concurrent workload.

Cloudflare Workers billing and account-level usage-alert permissions must be checked separately; a website's Free zone plan does not establish the Workers plan. No paid plan change or new direct alert recipient is configured by this patch. Review Workers errors, CPU/memory outcomes, Durable Object writes and R2 storage in Cloudflare as data grows.

Keep R2 objects when restoring database backups: backups now contain private evidence references. Disabling the two media flags stops new offload/backfill, but deployed readers must remain able to resolve existing references. Do not roll back to a reader that predates R2 references. Existing legacy evidence remains readable throughout gradual migration.
