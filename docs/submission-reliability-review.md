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

Cloudflare Workers billing and account-level usage-alert permissions must be checked separately; a website's Free zone plan does not establish the Workers plan. No paid plan change or new direct alert recipient is configured by this patch. Review Workers errors, CPU/memory outcomes, Durable Object writes and R2 storage in Cloudflare as data grows.

Keep R2 objects when restoring database backups: backups now contain private evidence references. Disabling the two media flags stops new offload/backfill, but deployed readers must remain able to resolve existing references. Do not roll back to a reader that predates R2 references. Existing legacy evidence remains readable throughout gradual migration.
