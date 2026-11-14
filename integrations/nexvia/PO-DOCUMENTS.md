# Nexvia PO document confirmation emails

The attachment delivery support is prepared, but automatic capture on the NAS
is not enabled yet. The native Print/View transport must be inspected before
the bridge can fetch the correct document for each newly verified PO.

## Read-only native document discovery

Copy `nexvia_inspect_po_document.py` into `/config` in the existing
`nexvia-browser` container, then run:

```sh
/config/nexvia-tools/bin/python /config/nexvia_inspect_po_document.py --project 60 --po 1421 --number PO7413
```

The probe inspects the existing PO7413 page in an isolated browser context. It
does not create another PO or invoke Print, View, Download or Email. All write
requests and print/send routes are blocked, including GET actions. The private
report at `/config/nexvia-po-document-discovery.json` contains redacted control
and handler metadata, not cookies, form contents or document bytes.

The earlier discovery contains a native route ending in `/sent/1`. This hint
alone does not establish whether using it changes the PO's sent status. Do not
call that route, invent a `/sent/0` variant or substitute IDs until the native
action has been established from the report.

## Prepared delivery contract

Existing NAS versions and previously queued, attempted or accepted emails keep
their existing behavior. There is no resend or migration of the PO7413 test.

An attachment-aware bridge announces `documentExpected: true` when polling for
new work. PanelStock fixes that capability when claiming a new purchase request,
before creation begins, and returns it on the work item. The verified result
must repeat `documentExpected: true`; it cannot downgrade that claim. This also
prevents a separate legacy confirmation process from sending a number-only
email in the interval between local creation and reporting verification.

PanelStock records the PO as `created_verified` while
its same confirmation job waits in `awaiting_document`; it does not send a
document-free email or invoke creation again while waiting.

After capturing the original Nexvia PDF separately from the immutable creation
result and terminal journal, that bridge will POST
`/integrations/nexvia/request-document` using the existing request-worker
credential. The body contains `workerId`, `id`, `claimToken`, `projectPageId`,
`purchaseOrderId`, `purchaseOrderNumber`, `sha256` and `contentBase64`.

The server binds the upload to the saved verified request and original claim,
accepts only a readable PDF of at most 5 MiB, verifies its SHA-256, and stores
the original bytes privately. The filename is derived from the verified PO
number. A matching replay is deduplicated; a different document cannot replace
a frozen attachment or generate another email.

Once the document is stored, the same confirmation becomes sendable. Provider
retries use the unchanged email fields, exact original PDF bytes and existing
Resend idempotency key. The retry window starts at the first provider attempt,
not while waiting for or uploading the document. Missing or corrupt frozen
bytes stop delivery for review rather than regenerating a PO or silently
dropping the attachment.

No native document action, live PDF upload or live email has been exercised by
the synthetic tests. Finish the capture integration and NAS update after the
read-only report establishes the actual native transport.
