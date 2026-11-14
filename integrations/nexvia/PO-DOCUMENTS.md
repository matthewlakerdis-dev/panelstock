# Original Nexvia PO documents in confirmation emails

New attachment-capable requests keep their existing PO-number confirmation email
and attach the original verified Nexvia PDF. Document capture and delivery run
separately from creation: a document failure never creates another PO or changes
an existing verified creation result.

## NAS installation and source check

The release artifact `install_nexvia_document_update.py` is a single-file
installer containing the request bridge, document capture module and checksummed
pure Python PDF parser. The source installer in this directory is a template
without its release payload and deliberately cannot install by itself.

Copy the packaged installer into `/config` in the existing `nexvia-browser`
container and run:

```sh
/config/nexvia-tools/bin/python /config/install_nexvia_document_update.py
```

The installer checks existing PO7413 (project 60, internal PO ID 1421) without
creating a PO, uploading a document or sending an email. It enables
`documentEnabled` only if the existing official PDF can be verified. A failed
check leaves the previous connection and creation settings intact, keeps
attachments disabled, and writes a private structural report at
`/config/nexvia-po-document-check.json`. A rerun never disables an already
enabled document setting.

If the existing PO shows its supplier as read-only text and the cached names are
ambiguous, pass `--check-supplier 'Supplier name shown on the PO'` to the
installer. This value applies only to the existing-PO source check, stays out of
configuration and future work, and does not bypass native or PDF verification.
New requests continue to use their frozen Nexvia supplier selection.

The installer requires a supported, checksummed bridge release,
holds the existing work and watcher locks, refuses active creation or unknown
local script changes, and backs up and atomically replaces its files. Tokens,
worker identity, creation settings, existing request results and journals are
preserved. It restarts the existing watcher after releasing the locks. Upgrades
from the first document release use separate permissions-update backups so the
original pre-document backups remain intact.

New private directories and locks receive explicit permissions after creation,
because NAS ACL inheritance can override the mode requested by mkdir or open.
Known request folders are repaired only after their saved request identity has
been verified; unrelated directories are not changed. Early setup errors now
produce a sanitized status report, and the installer prints the short status
and stage directly if document verification fails.

## Native document capture

The live source check identifies an application/pdf embed using a signed
`storage.googleapis.com` object URL. Capture accepts that exact native PDF
embed, alongside already embedded data PDFs and same-origin blob PDFs, from an
isolated context for the exact verified PO modify URL.

The Google Cloud Storage download uses a separate client without Nexvia cookies,
authorization or referrer headers. It permits only the pinned HTTPS object host,
validates the signed PDF URL, rejects redirects, and bounds response bytes and
time. Signed URLs remain in memory; reports, manifests and upload journals never
store their paths or access tokens. Native order identity is checked before the
download, then the PDF's readable order identity and final total are checked
before retaining its unchanged original bytes. Ambiguous, mismatched or
unavailable documents fail closed and produce structural diagnostics without
exporting PDF text.

All writes, WebSockets, unrelated navigation and print/send routes remain
blocked. The earlier `/staff/project-purchase-order-print/1421/sent/1` hint does
not establish that the route preserves sent status. The module neither calls it
nor invents a `/sent/0` variant. It does not click Print, Download, Email, Outlook
or Mark Sent. The existing creator's native action flags stay off.

The parser wheel is pypdf 7.1.0, SHA-256
`47cca6b24bdcf4c4d65b5f7b8b972535c61710a061261e737688777cfd9a7bfb`.
Its license is included in the wheel; installation needs no NAS package download.

To reproduce the release artifact, download that exact wheel with
`python -m pip download --no-deps --only-binary=:all: pypdf==7.1.0`, then run
`python integrations/nexvia/build_document_installer.py --wheel /path/to/pypdf-7.1.0-py3-none-any.whl --output /path/to/install_nexvia_document_update.py`.
The builder checks the pinned dependency, compiles the bundled modules and
verifies that the packaged payload reproduces their exact source bytes.

## Claim, result and document delivery

The bridge announces `documentExpected: true` only when `documentEnabled` is
explicitly enabled and its capture module is available. PanelStock fixes that
capability when claiming a new purchase request, before creation begins, and
returns it at the work-item root. Existing processing requests keep their
original behavior. The verified result must repeat the fixed expectation.
This gate also blocks a legacy confirmation scanner from sending a number-only
email between local creation and cloud verification.

PanelStock records the PO as `created_verified` immediately. Its same
confirmation job waits in `awaiting_document` without contacting the provider.
The NAS persists document progress independently of the immutable creation
result and frozen terminal outbound journal. Capture and upload retries reuse
that verified PO and original frozen PDF; they never invoke the creator.

The bridge uploads through `POST /integrations/nexvia/request-document` with the
existing request-worker credential. The body contains `workerId`, `id`,
`claimToken`, `projectPageId`, `purchaseOrderId`, `purchaseOrderNumber`, `sha256`
and `contentBase64`. The server binds the upload to the saved request and claim,
accepts a readable PDF of at most 5 MiB, and verifies its SHA-256. Original bytes
are stored privately under a content-addressed key, named after the verified PO
number. Identical replays are deduplicated; a different PDF cannot replace the
frozen attachment or generate another email.

After storage, the same confirmation becomes sendable. Provider retries use the
unchanged email fields, exact original PDF bytes and existing Resend idempotency
key. The retry window begins at the first provider attempt, rather than while
waiting for the document. Missing or corrupt frozen bytes stop delivery for
review instead of silently dropping the attachment.

Previously queued, attempted or accepted emails retain their original behavior.
There is no migration or resend of the accepted PO7413 test confirmation.

## Verification boundary

Unit and Chromium fixtures cover private capture, wrong-document rejection,
document delivery replay and installer faults without contacting Nexvia or the
email provider. Actual native capture must pass the installer's local
existing-PO check before attachment-capable claims are enabled on the NAS.

## Controlled PDF confirmation test

`nexvia_test_po_document_email.py` tests the attachment sender using the already
verified, frozen PO7413 PDF. It never opens Nexvia, invokes the creator or edits
an existing PO. Its recipient and PO details are fixed on the server; callers
cannot supply another email address or purchase order.

The default command checks the local private artifact only. `--status` reads the
separate test job without queueing or sending. Explicit `--send` freezes the
exact upload body in a private test receipt and posts it through the existing
request-worker credential. A repeated command or lost acknowledgement reuses
those bytes and the deterministic `test-document:1421` job; a different PDF is
rejected. Previously accepted number-only test and live confirmation jobs keep
their original state.

The machine-only test route is `/integrations/nexvia/test-document-confirmation`.
POST accepts only `sha256` and `contentBase64`; GET reads status without provider
or queue activity. The original PDF uses the production private attachment
reader and confirmation sender, with a separate test idempotency key and a
clearly labelled TEST subject. Only `sent` plus a provider ID is reported as
provider acceptance; inbox delivery and opening the attachment remain separate
checks. Signed document URLs and request credentials are never printed or
stored in the test receipt.
