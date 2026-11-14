import base64
import copy
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error


spec = importlib.util.spec_from_file_location("nexvia_po_document", Path(__file__).with_name("nexvia_po_document.py"))
document = importlib.util.module_from_spec(spec)
spec.loader.exec_module(document)
TARGET = "/staff/project-purchase-order-modify/60/1421"
PROJECT = "2549 - LN0951 - Salacia Fire Engineering Upgrades - Stage 2"
SUPPLIER = "Example Industrial Services Pty Ltd"
TEXT = "LENNOX FACADES\nPURCHASE ORDER\nPO7413\nSalacia Fire Engineering Upgrades - Stage 2\nExample Industrial Services Pty Ltd\nGrand Total: AUD $1,100.00"
TEST_WHEEL = Path(os.environ.get("NEXVIA_TEST_PYPDF_WHEEL", "/nonexistent-test-pypdf.whl"))
PARSER_AVAILABLE = TEST_WHEEL.is_file() or importlib.util.find_spec("pypdf") is not None
GCS_URL = "https://storage.googleapis.com/nexvia-documents/private-file.pdf?GoogleAccessId=private-account%40example.invalid&Expires=1999999999&Signature=PRIVATE_SIGNATURE_VALUE_123456789"


def pdf_bytes(text=TEXT):
    """A small real one-page PDF fixture; no report generator dependency."""
    stream = "BT /F1 12 Tf 40 760 Td\n"
    for index, line in enumerate(text.splitlines()):
        escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream += ("0 -18 Td\n" if index else "") + "(" + escaped + ") Tj\n"
    stream += "ET"
    content = stream.encode("ascii")
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
               b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream"]
    raw, offsets = b"%PDF-1.4\n", [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(raw))
        raw += str(index).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    xref = len(raw)
    raw += b"xref\n0 6\n0000000000 65535 f \n"
    raw += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    return raw + b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + str(xref).encode() + b"\n%%EOF\n"


def request_and_result():
    request = {"reference": "REQ-12345678", "projectPageId": 60, "totalCents": 110000, "supplierId": "225", "serviceId": "8",
               "lines": [{"description": "Order materials", "quantity": "1", "unitPriceExGst": "1000", "chartOfAccountId": "401", "taxRateId": "17"}]}
    result = {"state": "CREATED_VERIFIED", "requestReference": request["reference"], "projectPageId": 60,
              "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413", "totalCents": 110000,
              "url": document.ORIGIN + TARGET, "verifiedAt": "2026-11-14T07:00:00Z"}
    return request, result


def snapshot(raw=None, kind="data"):
    raw = pdf_bytes() if raw is None else raw
    encoded = base64.b64encode(raw).decode()
    return {"hasLines": True, "numbers": ["PO7413"], "body": TEXT,
            "lines": [{"qty": 1, "unit_price": 1000, "tax_rate": 10, "item_description": "Order materials",
                       "chart_of_account_id": 401, "tax_rate_id": 17, "job_purchase_order_id": 1421}],
            "supplierIds": ["225"], "supplierLabels": [SUPPLIER], "service": "8", "comment": "Request reference: REQ-12345678",
            "sources": [{"tag": "EMBED", "scheme": kind, "length": len(encoded), "pdfType": True,
                         "kind": kind, "content": "data:application/pdf;base64," + encoded if kind == "data" else encoded, "status": "captured"}],
            "handlers": [{"inline": "arbitraryPrintHelper(true,true)", "functions": [{"kind": "named-global", "source": "function arbitraryPrintHelper(a,b){if(/PRIVATE/.test(a))window.open('/staff/project-purchase-order-print/1421/sent/1');}"}]}],
            "blockedRequestCount": 0}


def gcs_snapshot():
    raw = snapshot()
    raw["sources"] = [{"tag": "EMBED", "scheme": "https", "length": len(GCS_URL), "pdfType": True,
                       "kind": "gcs", "downloadUrl": GCS_URL, "status": "external-pdf-candidate"}]
    return raw


class GcsResponse:
    def __init__(self, raw=None, headers=None, status=200):
        self.raw = pdf_bytes() if raw is None else raw
        self.headers = {"Content-Type": "application/pdf", "Content-Length": str(len(self.raw))} if headers is None else headers
        self.status, self.position, self.reads = status, 0, 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read1(self, size):
        self.reads += 1
        chunk = self.raw[self.position:self.position + size]
        self.position += len(chunk)
        return chunk


class CaptureTests(unittest.TestCase):
    def test_read_guard_rejects_document_actions_and_foreign_or_action_looking_assets(self):
        self.assertTrue(document.allow_request(document.ORIGIN + TARGET, "GET", TARGET, "document"))
        self.assertTrue(document.allow_request(document.ORIGIN + "/staff/js/app.js?v=123", "GET", TARGET, "script"))
        for path, method, kind in [(TARGET, "POST", "document"), (TARGET + "?Print=true", "GET", "document"),
                                  ("/staff/project-purchase-order-print/1421/sent/0", "GET", "document"),
                                  ("/staff/project-purchase-order-print/1421/sent/1", "GET", "document"),
                                  ("/staff/email-action.png?send=1", "GET", "image"),
                                  ("/staff/js/app.js?send=1", "GET", "script"),
                                  ("/staff/js/app.js", "GET", "document")]:
            self.assertFalse(document.allow_request(document.ORIGIN + path, method, TARGET, kind))
        self.assertFalse(document.allow_request("https://foreign.example/staff/js/app.js", "GET", TARGET, "script"))

    def test_data_and_blob_decoding_preserve_original_pdf_bytes(self):
        raw = pdf_bytes()
        for kind in ["data", "blob"]:
            self.assertEqual(document.decode_candidate(snapshot(raw, kind)["sources"][0]), raw)
        for candidate in [{"kind": "http", "content": "https://private.invalid"},
                          {"kind": "data", "content": "data:application/pdf;base64,bad!!!"},
                          {"kind": "blob", "content": base64.b64encode(b"<html>Login</html>").decode()},
                          {"kind": "data", "content": "x" * (document.MAX_ENCODED + 1)}]:
            with self.assertRaises(document.DocumentError):
                document.decode_candidate(candidate)

    def test_signed_gcs_url_is_pinned_and_never_normalized_or_allowed_to_be_a_native_action(self):
        self.assertEqual(document.validated_gcs_url(GCS_URL), GCS_URL)
        port = GCS_URL.replace("storage.googleapis.com/", "storage.googleapis.com:443/")
        self.assertEqual(document.validated_gcs_url(port), port)
        invalid = [GCS_URL.replace("https:", "http:"), GCS_URL.replace("storage.googleapis.com", "storage.googleapis.com.evil.invalid"),
                   GCS_URL.replace("storage.googleapis.com", "private@storage.googleapis.com"), GCS_URL + "#fragment",
                   GCS_URL.replace("storage.googleapis.com", "storage.googleapis.com:444"),
                   GCS_URL.replace("private-file.pdf", "private-file.html"), GCS_URL.replace("nexvia-documents/", "../"),
                   GCS_URL.replace("private-file.pdf", "%2e%2e/private-file.pdf"),
                   GCS_URL.replace("private-file.pdf", "private%5cfile.pdf"), GCS_URL.replace("private-file.pdf", "private%0afile.pdf"),
                   GCS_URL.replace("private-file.pdf", "private%ZZfile.pdf"), GCS_URL + "&Signature=DUPLICATE_SIGNATURE",
                   GCS_URL.replace("Expires=1999999999", "Expires=not-numeric"), GCS_URL + "&Authorization=private",
                   GCS_URL.replace("Signature=PRIVATE_SIGNATURE_VALUE_123456789", "Signature="),
                   document.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1?Expires=1999999999&Signature=PRIVATE_SIGNATURE_VALUE_123456789"]
        for value in invalid:
            with self.subTest(value=value), self.assertRaisesRegex(document.DocumentError, "^gcs-url-invalid$"):
                document.validated_gcs_url(value)

    def test_gcs_download_is_cookie_free_and_preserves_exact_original_bytes_for_pdf_and_binary_mime(self):
        raw = pdf_bytes()
        for mime in ["application/pdf", "application/pdf; charset=binary", "application/octet-stream", "binary/octet-stream"]:
            response = GcsResponse(raw, {"Content-Type": mime})
            opener = SimpleNamespace(open=Mock(return_value=response))
            self.assertEqual(document.download_gcs_pdf(GCS_URL, opener=opener), raw)
            sent = opener.open.call_args.args[0]
            self.assertEqual(sent.full_url, GCS_URL)
            self.assertEqual(sent.get_method(), "GET")
            headers = {key.lower(): value for key, value in sent.header_items()}
            self.assertEqual(set(headers), {"accept", "accept-encoding", "user-agent"})
            self.assertEqual(headers["accept-encoding"], "identity")
            for name in ["authorization", "cookie", "referer", "origin"]:
                self.assertNotIn(name, headers)
            self.assertEqual(opener.open.call_args.kwargs["timeout"], document.GCS_TIMEOUT_SECONDS)
        opener = SimpleNamespace(open=Mock(return_value=GcsResponse()))
        with patch.object(document.urllib.request, "build_opener", return_value=opener) as build, \
                patch.object(document.urllib.request, "urlopen", side_effect=AssertionError("global opener forbidden")):
            self.assertEqual(document.download_gcs_pdf(GCS_URL), raw)
        handlers = build.call_args.args
        self.assertEqual(handlers[0].proxies, {})
        self.assertIsInstance(handlers[1], document.NoGcsRedirect)
        self.assertFalse(any(isinstance(handler, document.urllib.request.HTTPCookieProcessor) for handler in handlers))

    def test_gcs_redirect_content_type_lengths_and_stream_limits_fail_closed(self):
        raw = pdf_bytes()
        cases = [(GcsResponse(status=302), "gcs-redirect-blocked"), (GcsResponse(status=307), "gcs-redirect-blocked"),
                 (GcsResponse(status=403), "gcs-download-unavailable"),
                 (GcsResponse(headers={"Content-Type": "text/html"}), "gcs-content-type-mismatch"),
                 (GcsResponse(headers={"Content-Type": "application/pdf", "Content-Encoding": "gzip"}), "gcs-content-type-mismatch"),
                 (GcsResponse(headers={"Content-Type": "application/pdf", "Content-Length": str(document.MAX_PDF_BYTES + 1)}), "gcs-size-limit"),
                 (GcsResponse(headers={"Content-Type": "application/pdf", "Content-Length": "-1"}), "gcs-length-mismatch"),
                 (GcsResponse(headers={"Content-Type": "application/pdf", "Content-Length": str(len(raw) + 1)}), "gcs-length-mismatch"),
                 (GcsResponse(b"%PDF-" + b"x" * document.MAX_PDF_BYTES, {"Content-Type": "application/pdf"}), "gcs-size-limit"),
                 (GcsResponse(b"<html>PRIVATE LOGIN</html>"), "invalid-inline-pdf")]
        for response, code in cases:
            with self.subTest(code=code), self.assertRaisesRegex(document.DocumentError, "^" + code + "$"):
                document.download_gcs_pdf(GCS_URL, opener=SimpleNamespace(open=Mock(return_value=response)))
        with self.assertRaisesRegex(document.DocumentError, "gcs-redirect-blocked"):
            document.NoGcsRedirect().redirect_request(None, None, 302, "PRIVATE", {}, "https://foreign.invalid/private")

    def test_gcs_deadline_and_errors_never_expose_signed_urls_or_provider_bodies(self):
        opener = SimpleNamespace(open=Mock(return_value=GcsResponse()))
        times = iter([0, 0, document.GCS_DEADLINE_SECONDS + 1])
        with self.assertRaisesRegex(document.DocumentError, "^gcs-download-timeout$"):
            document.download_gcs_pdf(GCS_URL, opener=opener, clock=lambda: next(times))
        for error in [urllib.error.HTTPError(GCS_URL, 403, "PRIVATE RESPONSE", {}, None),
                      RuntimeError("PRIVATE " + GCS_URL), TimeoutError("PRIVATE " + GCS_URL)]:
            with self.subTest(kind=type(error).__name__):
                try:
                    document.download_gcs_pdf(GCS_URL, opener=SimpleNamespace(open=Mock(side_effect=error)))
                except document.DocumentError as safe:
                    self.assertIn(str(safe), document.STATUS_CODES)
                    self.assertNotIn("PRIVATE", str(safe))
                    self.assertNotIn("storage.googleapis.com", str(safe))
                else:
                    self.fail("Download error was accepted")

    def test_gcs_is_downloaded_only_from_typed_native_embed_after_complete_native_identity(self):
        request, _ = request_and_result()
        for mutate, code in [(lambda raw: raw.update(body="Different native identity"), "identity-context-unavailable"),
                             (lambda raw: raw.update(numbers=["PO7414"]), "native-po-number-mismatch"),
                             (lambda raw: raw.update(comment="Different request"), "native-request-mismatch"),
                             (lambda raw: raw["lines"][0].update(qty=2), "native-total-mismatch")]:
            raw = gcs_snapshot()
            mutate(raw)
            with patch.object(document, "download_gcs_pdf") as download:
                with self.assertRaisesRegex(document.DocumentError, code):
                    document.validate_snapshot(raw, None, 60, 1421, "PO7413", expected_project=PROJECT,
                                               expected_supplier=SUPPLIER, total_cents=110000, request=request)
                download.assert_not_called()
        for changes in [{"tag": "A"}, {"pdfType": False}, {"status": "captured", "tag": "A"}, {"tag": "IFRAME"}]:
            raw = gcs_snapshot()
            raw["sources"][0].update(changes)
            with patch.object(document, "download_gcs_pdf") as download:
                _, _, report = document.validate_snapshot(raw, None, 60, 1421, "PO7413", expected_project=PROJECT, expected_supplier=SUPPLIER)
                self.assertFalse(report["documentVerified"])
                download.assert_not_called()

    def test_gcs_original_is_frozen_without_signed_url_and_replay_never_downloads_again(self):
        request, result = request_and_result()
        with tempfile.TemporaryDirectory() as folder, patch.object(document, "check_dependencies", return_value=True), \
                patch.object(document, "read_page", return_value=gcs_snapshot()), \
                patch.object(document, "download_gcs_pdf", return_value=pdf_bytes()) as download, \
                patch.object(document, "official_pdf", return_value={"officialHeading": True}):
            root = Path(folder)
            manifest = document.capture_document(root, request, result, expected_project=PROJECT, expected_supplier=SUPPLIER, browser=object())
            self.assertEqual(manifest["sourceKind"], "gcs")
            self.assertEqual((root / document.PDF_NAME).read_bytes(), pdf_bytes())
            self.assertNotIn("PRIVATE_SIGNATURE", (root / document.MANIFEST_NAME).read_text())
            self.assertNotIn("storage.googleapis.com", (root / document.MANIFEST_NAME).read_text())
            download.assert_called_once_with(GCS_URL)
            download.reset_mock()
            self.assertEqual(document.capture_document(root, request, result, expected_project=PROJECT, expected_supplier=SUPPLIER), manifest)
            download.assert_not_called()
            report = document.capture_check(60, 1421, "PO7413", folder=root / "check", expected_project=PROJECT,
                                            expected_supplier=SUPPLIER, browser=object())
            self.assertTrue(report["documentVerified"])
            self.assertNotIn("PRIVATE_SIGNATURE", json.dumps(report))
            self.assertNotIn("private-account", json.dumps(report))
            self.assertNotIn("storage.googleapis.com", json.dumps(report))

    def test_supplier_directory_text_fallback_keeps_unique_identity_requirement(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "suppliers.json"
            path.write_text(json.dumps({"records": [{"id": 225, "text": SUPPLIER}]}))
            self.assertEqual(document.directory_name(path, "records", "225", "id"), SUPPLIER)
            path.write_text(json.dumps({"records": [{"id": 225, "text": SUPPLIER}, {"id": 225, "text": "Other"}]}))
            self.assertIsNone(document.directory_name(path, "records", "225", "id"))

    def test_standalone_supplier_inference_uses_one_complete_full_word_label_only(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "suppliers.json"
            rows = [{"id": 225, "name": SUPPLIER}, {"id": 226, "text": SUPPLIER.upper().replace("PTY LTD", "PTY. LTD.")},
                    {"id": 227, "name": "Another Supplier Pty Ltd"}]
            path.write_text(json.dumps({"expectedTotal": len(rows), "records": rows}))
            self.assertEqual(document.cached_supplier_from_body(path, "Supplier:\n" + SUPPLIER), "example industrial services pty ltd")
            for body in ["Example Industrial", "Example Industrial Servicesman Pty Ltd", "No supplier here",
                         SUPPLIER + "\nAnother Supplier Pty Ltd"]:
                with self.subTest(body=body), self.assertRaisesRegex(document.DocumentError, "^supplier-context-unavailable$"):
                    document.cached_supplier_from_body(path, body)
            path.write_text(json.dumps({"expectedTotal": 1, "records": [{"id": 1, "name": "CSR"}]}))
            with self.assertRaisesRegex(document.DocumentError, "supplier-context-unavailable"):
                document.cached_supplier_from_body(path, "CSR")
            path.write_text(json.dumps({"expectedTotal": 1, "records": [{"id": 1, "name": "Example Services"}]}))
            with self.assertRaisesRegex(document.DocumentError, "supplier-context-unavailable"):
                document.cached_supplier_from_body(path, "Contact Example.Services@example.invalid")

    def test_incomplete_or_malformed_supplier_cache_cannot_hide_ambiguous_labels(self):
        with tempfile.TemporaryDirectory() as folder:
            root, path = Path(folder), Path(folder) / "suppliers.json"
            for directory in [{"expectedTotal": 2, "records": [{"name": SUPPLIER}]},
                              {"expectedTotal": 2, "records": [{"name": SUPPLIER}, {}]},
                              {"expectedTotal": 2, "records": [{"name": SUPPLIER}, {"name": 1234}]}]:
                path.write_text(json.dumps(directory))
                with self.assertRaisesRegex(document.DocumentError, "supplier-context-unavailable"):
                    document.cached_supplier_from_body(path, SUPPLIER)
            path.write_text(json.dumps({"expectedTotal": 1, "records": [{"name": SUPPLIER}]}))
            path.chmod(0o755)  # Existing read-only directory snapshots may inherit this NAS mode.
            self.assertEqual(document.cached_supplier_from_body(path, SUPPLIER), "example industrial services pty ltd")
            link = root / "linked.json"
            link.symlink_to(path)
            with self.assertRaisesRegex(document.DocumentError, "supplier-context-unavailable"):
                document.cached_supplier_from_body(link, SUPPLIER)
            path.chmod(0o666)
            with self.assertRaisesRegex(document.DocumentError, "supplier-context-unavailable"):
                document.cached_supplier_from_body(path, SUPPLIER)

    def test_supplier_body_inference_is_check_only_and_precedes_any_gcs_download(self):
        request, _ = request_and_result()
        raw = gcs_snapshot()
        raw["supplierIds"], raw["supplierLabels"] = [], []
        with tempfile.TemporaryDirectory() as folder, patch.object(document, "download_gcs_pdf", return_value=pdf_bytes()) as download, \
                patch.object(document, "official_pdf", return_value={"officialHeading": True}):
            root = Path(folder)
            path = root / "nexvia-supplier-directory.json"
            path.write_text(json.dumps({"expectedTotal": 1, "records": [{"id": 225, "name": SUPPLIER}]}))
            _, identity, report = document.validate_snapshot(raw, root, 60, 1421, "PO7413", expected_project=PROJECT, config_root=root)
            self.assertTrue(report["documentVerified"])
            self.assertEqual(identity["supplierName"], "example industrial services pty ltd")
            self.assertNotIn("example industrial", json.dumps(report))
            download.reset_mock()
            with patch.object(document, "cached_supplier_from_body") as infer:
                with self.assertRaisesRegex(document.DocumentError, "identity-context-unavailable"):
                    document.validate_snapshot(raw, root, 60, 1421, "PO7413", expected_project=PROJECT, config_root=root, request=request)
                infer.assert_not_called()
                download.assert_not_called()
                _, identity, report = document.validate_snapshot(raw, root, 60, 1421, "PO7413", expected_project=PROJECT,
                    expected_supplier=SUPPLIER, config_root=root, request=request)
                self.assertEqual(identity["supplierName"], SUPPLIER)
                self.assertTrue(report["documentVerified"])
                infer.assert_not_called()
            download.reset_mock()
            raw["body"] += "\nAnother Supplier Pty Ltd"
            path.write_text(json.dumps({"expectedTotal": 2, "records": [{"name": SUPPLIER}, {"name": "Another Supplier Pty Ltd"}]}))
            with self.assertRaisesRegex(document.DocumentError, "supplier-context-unavailable"):
                document.validate_snapshot(raw, root, 60, 1421, "PO7413", expected_project=PROJECT, config_root=root)
            download.assert_not_called()

    def test_official_identity_requires_heading_issuer_po_project_supplier_and_total(self):
        identity = {"purchaseOrderNumber": "PO7413", "projectName": PROJECT, "supplierName": SUPPLIER, "totalCents": 110000}
        self.assertTrue(document.official_pdf(pdf_bytes(), identity, None, extractor=lambda *_: [TEXT])["totalMatched"])
        for text, code in [(TEXT.replace("PURCHASE ORDER", "QUOTATION"), "not-an-official-purchase-order"),
                           (TEXT.replace("LENNOX FACADES", "OTHER SUPPLIER"), "not-an-official-purchase-order"),
                           ("Tax Invoice\n" + TEXT, "not-an-official-purchase-order"),
                           (TEXT.replace("PURCHASE ORDER", "Purchase Order reference PO7413\nQUOTATION"), "not-an-official-purchase-order"),
                           (TEXT.replace("PO7413", "PO7414"), "pdf-po-number-mismatch"),
                           (TEXT.replace("Salacia Fire Engineering Upgrades - Stage 2", "A different project"), "pdf-project-mismatch"),
                           (TEXT.replace(SUPPLIER, "A different supplier"), "pdf-supplier-mismatch"),
                           (TEXT.replace("1,100.00", "1,200.00"), "pdf-total-mismatch")]:
            with self.subTest(code=code), self.assertRaisesRegex(document.DocumentError, code):
                document.official_pdf(pdf_bytes(), identity, None, extractor=lambda *_, value=text: [value])
        self.assertTrue(document.name_matches("Jardin building", "2558 - 802 - Jardin building", project=True))
        self.assertFalse(document.name_matches("Unrelated project", PROJECT, project=True))

    @unittest.skipUnless(PARSER_AVAILABLE, "pypdf is needed for the real original-PDF parsing test")
    def test_real_pdf_is_parsed_in_bounded_child_with_original_bytes_unchanged(self):
        wheel = TEST_WHEEL if TEST_WHEEL.is_file() else document.VENDOR_WHEEL
        with tempfile.TemporaryDirectory() as folder, patch.object(document, "VENDOR_WHEEL", wheel):
            raw = pdf_bytes()
            identity = {"purchaseOrderNumber": "PO7413", "projectName": PROJECT, "supplierName": SUPPLIER, "totalCents": 110000}
            before = hashlib.sha256(raw).hexdigest()
            self.assertTrue(document.official_pdf(raw, identity, Path(folder))["officialHeading"])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), before)
            self.assertEqual(list(Path(folder).iterdir()), [])
            with self.assertRaisesRegex(document.DocumentError, "not-a-complete-pdf"):
                document.pdf_text(raw[:-20], Path(folder))

    @unittest.skipUnless(PARSER_AVAILABLE, "pypdf is needed for real document-title and total regressions")
    def test_real_pdf_quote_reference_and_matching_subtotal_cannot_authorize_attachment(self):
        wheel = TEST_WHEEL if TEST_WHEEL.is_file() else document.VENDOR_WHEEL
        identity = {"purchaseOrderNumber": "PO7413", "projectName": PROJECT, "supplierName": SUPPLIER, "totalCents": 110000}
        quote = TEXT.replace("PURCHASE ORDER", "Purchase Order reference PO7413\nQUOTATION")
        conflicting = TEXT.replace("Grand Total: AUD $1,100.00", "Sub Total: AUD $1,100.00\nGrand Total: AUD $1,210.00")
        conflicting_finals = TEXT.replace("Grand Total: AUD $1,100.00", "Total: AUD $1,100.00\nGrand Total: AUD $1,210.00")
        disagreeing_explicit = TEXT.replace("Grand Total: AUD $1,100.00", "Total including GST: AUD $1,100.00\nGrand Total: AUD $1,210.00")
        standalone_tax = TEXT.replace("Grand Total: AUD $1,100.00", "Total: AUD $1,100.00\nTax\nGrand Total: AUD $1,210.00")
        valid = TEXT.replace("Grand Total: AUD $1,100.00", "Sub Total: AUD $1,000.00\nTax: AUD $100.00\nTotal: AUD $1,100.00")
        pretax_total = TEXT.replace("Grand Total: AUD $1,100.00", "Total: AUD $1,000.00\nTax: AUD $100.00\nGrand Total: AUD $1,100.00")
        title_first = valid.replace("LENNOX FACADES\nPURCHASE ORDER", "PURCHASE ORDER\nLENNOX FACADES")
        with tempfile.TemporaryDirectory() as folder, patch.object(document, "VENDOR_WHEEL", wheel):
            for text, code in [(quote, "not-an-official-purchase-order"),
                               (conflicting, "pdf-total-mismatch"), (conflicting_finals, "pdf-total-mismatch"),
                               (disagreeing_explicit, "pdf-total-mismatch"), (standalone_tax, "pdf-total-mismatch")]:
                with self.subTest(code=code), self.assertRaisesRegex(document.DocumentError, code):
                    document.official_pdf(pdf_bytes(text), identity, Path(folder))
            self.assertTrue(document.official_pdf(pdf_bytes(valid), identity, Path(folder))["totalMatched"])
            self.assertTrue(document.official_pdf(pdf_bytes(pretax_total), identity, Path(folder))["totalMatched"])
            self.assertTrue(document.official_pdf(pdf_bytes(title_first), identity, Path(folder))["issuerMatched"])

    def test_native_totals_zero_gst_and_invalid_rows(self):
        self.assertEqual(document.native_total([{"qty": "2", "unit_price": "10", "tax_rate": "0"}]), 2000)
        self.assertEqual(document.native_total(snapshot()["lines"]), 110000)
        for rows in [[], [None], [{"qty": "NaN", "unit_price": 1, "tax_rate": 10}],
                     [{"qty": -1, "unit_price": 1, "tax_rate": 10}]]:
            with self.assertRaises(document.DocumentError):
                document.native_total(rows)

    def test_no_inline_pdf_returns_useful_scheme_and_exact_handler_route_without_private_data(self):
        raw = snapshot()
        raw["sources"] = [{"tag": "EMBED", "scheme": "about", "length": 11, "pdfType": True, "status": "not-inline-pdf"}]
        with tempfile.TemporaryDirectory() as folder, patch.object(document, "check_dependencies", return_value=True), patch.object(document, "read_page", return_value=raw):
            report = document.capture_check(60, 1421, "PO7413", browser=object(), folder=Path(folder))
        self.assertFalse(report["documentVerified"])
        self.assertEqual(report["status"], "no-readable-inline-pdf")
        self.assertEqual(report["sources"][0]["scheme"], "about")
        self.assertIn("/staff/project-purchase-order-print/1421/sent/1", report["printHandlers"][1]["nativePrintRoutes"])
        for private in ["PRIVATE", SUPPLIER, PROJECT, "arbitraryPrintHelper"]:
            self.assertNotIn(private, json.dumps(report))

    def test_missing_native_identity_context_preserves_safe_diagnostics(self):
        raw = snapshot()
        raw["supplierIds"], raw["supplierLabels"] = [], []
        with tempfile.TemporaryDirectory() as folder, patch.object(document, "check_dependencies", return_value=True), patch.object(document, "read_page", return_value=raw):
            report = document.capture_check(60, 1421, "PO7413", browser=object(), folder=Path(folder), config_root=Path(folder))
        self.assertEqual(report["status"], "supplier-context-unavailable")
        self.assertEqual(report["sources"][0]["scheme"], "data")
        self.assertTrue(report["printHandlers"])

    def test_native_request_mutations_do_not_freeze_any_pdf(self):
        request, result = request_and_result()
        for change in [lambda raw: raw.update(comment="Other reference"), lambda raw: raw.update(service="9"),
                       lambda raw: raw["lines"][0].update(job_purchase_order_id=1422),
                       lambda raw: raw["lines"][0].update(item_description="Changed")]:
            raw = snapshot()
            change(raw)
            with tempfile.TemporaryDirectory() as folder, patch.object(document, "check_dependencies", return_value=True), patch.object(document, "read_page", return_value=raw):
                with self.assertRaisesRegex(document.DocumentError, "native-request-mismatch"):
                    document.capture_document(Path(folder), request, result, expected_project=PROJECT, expected_supplier=SUPPLIER, browser=object())
                self.assertFalse((Path(folder) / document.PDF_NAME).exists())

    def test_verified_original_is_private_frozen_and_retried_without_browser_or_creator(self):
        request, result = request_and_result()
        original_request, original_result = copy.deepcopy(request), copy.deepcopy(result)
        with tempfile.TemporaryDirectory() as folder, patch.object(document, "check_dependencies", return_value=True), \
                patch.object(document, "read_page", return_value=snapshot()) as read, \
                patch.object(document, "official_pdf", return_value={"officialHeading": True}):
            root = Path(folder)
            saved = document.capture_document(root, request, result, expected_project=PROJECT, expected_supplier=SUPPLIER, browser=object())
            self.assertEqual((root / document.PDF_NAME).read_bytes(), pdf_bytes())
            self.assertEqual((root / document.PDF_NAME).stat().st_mode & 0o777, 0o600)
            self.assertEqual((root / document.MANIFEST_NAME).stat().st_mode & 0o777, 0o600)
            read.reset_mock()
            self.assertEqual(document.capture_document(root, request, result, expected_project=PROJECT, expected_supplier=SUPPLIER), saved)
            read.assert_not_called()
            changed = copy.deepcopy(request)
            changed["lines"][0]["description"] = "Changed immutable request"
            with self.assertRaisesRegex(document.DocumentError, "document-artifact-identity-mismatch"):
                document.capture_document(root, changed, result, expected_project=PROJECT, expected_supplier=SUPPLIER)
            (root / document.PDF_NAME).write_bytes(b"changed")
            with self.assertRaisesRegex(document.DocumentError, "document-artifact-hash-mismatch"):
                document.capture_document(root, request, result, expected_project=PROJECT, expected_supplier=SUPPLIER)
            read.assert_not_called()
        self.assertEqual((request, result), (original_request, original_result))

    def test_unique_match_is_required_and_duplicate_embeds_of_same_bytes_are_allowed(self):
        raw = snapshot()
        raw["sources"].append(copy.deepcopy(raw["sources"][0]))
        with tempfile.TemporaryDirectory() as folder, patch.object(document, "official_pdf", return_value={"officialHeading": True}):
            data, _, report = document.validate_snapshot(raw, Path(folder), 60, 1421, "PO7413", expected_project=PROJECT, expected_supplier=SUPPLIER)
            self.assertEqual(data, pdf_bytes())
            self.assertTrue(report["documentVerified"])
            raw["sources"].append(snapshot(pdf_bytes(TEXT + "\nAnother version"))["sources"][0])
            data, _, report = document.validate_snapshot(raw, Path(folder), 60, 1421, "PO7413", expected_project=PROJECT, expected_supplier=SUPPLIER)
            self.assertIsNone(data)
            self.assertEqual(report["status"], "ambiguous-official-pdf")

    def test_parser_missing_fails_before_opening_browser_and_never_accepts_header_only(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(document, "check_dependencies", side_effect=document.DocumentError("parser-unavailable")), patch.object(document, "read_page") as read:
            report = document.capture_check(60, 1421, "PO7413", folder=Path(folder), browser=object())
            self.assertEqual(report["status"], "parser-unavailable")
            read.assert_not_called()
        with self.assertRaises(document.DocumentError):
            document.valid_identity(60, 1421, "PO7413/private")

    def test_new_directories_are_explicitly_private_after_inherited_mkdir_mode(self):
        original_mkdir = Path.mkdir

        def inherited_mkdir(path, mode=0o777, parents=False, exist_ok=False):
            original_mkdir(path, mode=0o755, parents=parents, exist_ok=exist_ok)
            path.chmod(0o755)

        with tempfile.TemporaryDirectory() as folder:
            parent, leaf = Path(folder) / "checks", Path(folder) / "checks" / "PO7413"
            with patch.object(Path, "mkdir", inherited_mkdir), patch.object(document.os, "fchmod", wraps=os.fchmod) as chmod:
                self.assertEqual(document.private_folder(leaf), leaf)
            self.assertEqual(parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual(leaf.stat().st_mode & 0o777, 0o700)
            self.assertEqual([call.args[1] for call in chmod.call_args_list], [0o700, 0o700])

    def test_new_inherited_lock_is_tightened_but_existing_permissive_lock_is_not(self):
        original_open, original_chmod = os.open, os.fchmod

        def inherited_open(path, flags, mode=0o777, **kwargs):
            descriptor = original_open(path, flags, mode, **kwargs)
            if Path(path).name == ".document.lock" and flags & os.O_CREAT:
                original_chmod(descriptor, 0o755)
            return descriptor

        identity = {"projectPageId": 60, "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413"}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(document.os, "open", inherited_open):
                saved = document.freeze_document(root, pdf_bytes(), identity, "a" * 64, "data")
            self.assertEqual((root / ".document.lock").stat().st_mode & 0o777, 0o600)
            self.assertEqual(saved["size"], len(pdf_bytes()))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            lock = root / ".document.lock"
            lock.write_bytes(b"")
            lock.chmod(0o644)
            with patch.object(document.os, "fchmod") as chmod:
                with self.assertRaisesRegex(document.DocumentError, "invalid-document-artifact"):
                    document.freeze_document(root, pdf_bytes(), identity, "a" * 64, "data")
                chmod.assert_not_called()
            self.assertEqual(lock.stat().st_mode & 0o777, 0o644)
            self.assertFalse((root / document.PDF_NAME).exists())

    def test_existing_permissive_or_symlink_folders_are_rejected_without_chmod_or_browser(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            permissive = root / "existing"
            permissive.mkdir()
            permissive.chmod(0o755)
            link = root / "link"
            link.symlink_to(permissive, target_is_directory=True)
            with patch.object(document.os, "fchmod") as chmod, patch.object(document, "read_page") as read:
                for target in [permissive, link, link / "child"]:
                    report = document.capture_check(60, 1421, "PO7413", folder=target, browser=object())
                    self.assertEqual((report["status"], report["stage"]), ("invalid-document-folder", "document-folder"))
                    self.assertFalse(report["documentVerified"])
                chmod.assert_not_called()
                read.assert_not_called()
            self.assertEqual(permissive.stat().st_mode & 0o777, 0o755)
            self.assertTrue(link.is_symlink())
            self.assertFalse((permissive / "child").exists())
            default_parent = root / "nexvia-po-document-check"
            default_parent.mkdir()
            default_parent.chmod(0o755)
            report = document.capture_check(60, 1421, "PO7413", config_root=root)
            self.assertEqual(report["status"], "invalid-document-folder")
            self.assertFalse((default_parent / "PO7413").exists())
            self.assertEqual(default_parent.stat().st_mode & 0o777, 0o755)

    def test_setup_failures_return_fixed_private_diagnostics_without_escaping(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(Path, "mkdir", side_effect=PermissionError(13, "PRIVATE PATH AND CREDENTIAL")), patch.object(document, "read_page") as read:
                report = document.capture_check(60, 1421, "PO7413", folder=Path(folder) / "missing", browser=object())
                self.assertEqual((report["status"], report["stage"]), ("document-folder-unavailable", "document-folder"))
                self.assertNotIn("PRIVATE", json.dumps(report))
                read.assert_not_called()
            with patch.object(document, "private_folder") as create:
                invalid = document.capture_check(60, 1421, "PO7413/PRIVATE-CREDENTIAL")
                self.assertEqual((invalid["status"], invalid["stage"]), ("invalid-po-identity", "identity"))
                self.assertIsNone(invalid["purchaseOrderNumber"])
                self.assertNotIn("PRIVATE", json.dumps(invalid))
                create.assert_not_called()
            with patch.object(document, "check_dependencies", side_effect=document.DocumentError("PRIVATE CREDENTIAL")):
                report = document.capture_check(60, 1421, "PO7413", folder=Path(folder), browser=object())
                self.assertEqual(report["status"], "capture-unavailable")
                self.assertNotIn("PRIVATE", json.dumps(report))
        request, result = request_and_result()
        with patch.object(document, "_capture_document", side_effect=PermissionError("PRIVATE CREDENTIAL")):
            with self.assertRaisesRegex(document.DocumentError, "^capture-unavailable$"):
                document.capture_document(None, request, result)

    def test_cli_saves_private_report_for_setup_failure_and_still_prints_when_report_write_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output = Path(folder), Path(folder) / "report.json"
            bad = root / "existing"
            bad.mkdir()
            bad.chmod(0o755)
            args = ["--check", "--project", "60", "--po", "1421", "--number", "PO7413", "--folder", str(bad), "--output", str(output)]
            console = io.StringIO()
            with redirect_stdout(console):
                self.assertEqual(document.main(args), 1)
            saved = json.loads(output.read_text())
            self.assertEqual((saved["status"], saved["stage"]), ("invalid-document-folder", "document-folder"))
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(bad.stat().st_mode & 0o777, 0o755)
            self.assertIn("Status: invalid-document-folder", console.getvalue())
            console = io.StringIO()
            with patch.object(document, "atomic_private", side_effect=PermissionError("PRIVATE CREDENTIAL PATH")), redirect_stdout(console):
                self.assertEqual(document.main(args), 1)
            self.assertIn("Report status: report-write-unavailable", console.getvalue())
            self.assertIn("Status: invalid-document-folder", console.getvalue())
            self.assertNotIn("PRIVATE", console.getvalue())

    @unittest.skipUnless(shutil.which("node"), "Node is needed for passive existing-source inspection")
    def test_browser_program_reads_data_only_and_resolves_actual_arbitrary_print_callback_without_calls(self):
        harness = r'''
const vm=require('node:vm'),input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
let actions=0,fetches=0,getters=0,overrides=0;
function actualArbitraryPrintHelper(a,b){actions++;if(/PRIVATE/.test('private'))window.open('/staff/project-purchase-order-print/1421/sent/1');}
actualArbitraryPrintHelper.toString=()=>{overrides++;throw Error();};
const window={actualArbitraryPrintHelper};Object.defineProperty(window,'otherPrintGetter',{get(){getters++;throw Error();}});
const attrs={onclick:'actualArbitraryPrintHelper(true,true);otherPrintGetter();'};
const button={tagName:'A',textContent:'Print',getAttribute:key=>attrs[key]||null,onclick:null};
const sources=[{tagName:'EMBED',getAttribute:key=>({src:input.data,type:'application/pdf'})[key]||null},
 {tagName:'EMBED',getAttribute:key=>({src:'https://private.invalid/doc.pdf',type:'application/pdf'})[key]||null},
 {tagName:'EMBED',getAttribute:key=>({src:'blob:https://foreign.invalid/abc',type:'application/pdf'})[key]||null}];
const readonly=[
 {type:'text',readOnly:true,value:'Visible Supplier Pty Ltd',getClientRects:()=>[1]},
 {type:'search',disabled:true,value:'Disabled Search Supplier',getClientRects:()=>[1]},
 {type:'hidden',readOnly:true,value:'PRIVATE HIDDEN',getClientRects:()=>[1]},
 {type:'password',readOnly:true,value:'PRIVATE PASSWORD',getClientRects:()=>[1]},
 {type:'email',readOnly:true,value:'PRIVATE-EMAIL@example.invalid',getClientRects:()=>[1]},
 {type:'text',readOnly:true,value:'private-text-email@example.invalid',getClientRects:()=>[1]},
 {type:'text',value:'PRIVATE EDITABLE',getClientRects:()=>[1]},
 {type:'text',readOnly:true,value:'PRIVATE INVISIBLE',getClientRects:()=>[]},
 {type:'text',readOnly:true,value:'PRIVATE CSS HIDDEN',getClientRects:()=>[1],cssHidden:true}
];
const fields={'form[Lines]':JSON.stringify([{qty:1,unit_price:1000,tax_rate:10}]),'form[ServiceId]':'8'};
const document={body:{innerText:'Purchase Order # PO7413'},querySelector:()=>({}),getElementsByName:name=>fields[name]?[{value:fields[name]}]:[],querySelectorAll:selector=>selector.startsWith('input[readonly]')?readonly:selector.startsWith('embed')?sources:[button]};
const context={window,document,URL,getComputedStyle:el=>({visibility:el.cssHidden?'hidden':'visible'}),location:{origin:'https://lennox.nexvia.com.au',href:'https://lennox.nexvia.com.au/staff/project-purchase-order-modify/60/1421'},setTimeout,clearTimeout,fetch:()=>{fetches++;throw Error('must not fetch HTTP');}};
(async()=>{const raw=await vm.runInNewContext('('+input.source+')',context)({maxBytes:5242880,maxEncoded:7000000,expectedNumber:'PO7413'});process.stdout.write(JSON.stringify({raw,actions,fetches,getters,overrides}));})();
'''
        completed = subprocess.run(["node", "-e", harness], input=json.dumps({"source": document.READ_PAGE_JS,
            "data": snapshot()["sources"][0]["content"]}), text=True, capture_output=True, check=True)
        observed = json.loads(completed.stdout)
        self.assertEqual({key: observed[key] for key in ["actions", "fetches", "getters", "overrides"]}, {"actions": 0, "fetches": 0, "getters": 0, "overrides": 0})
        self.assertEqual(document.decode_candidate(observed["raw"]["sources"][0]), pdf_bytes())
        self.assertIn("Visible Supplier Pty Ltd", observed["raw"]["body"])
        self.assertIn("Disabled Search Supplier", observed["raw"]["body"])
        self.assertNotIn("PRIVATE", observed["raw"]["body"])
        self.assertNotIn("@example.invalid", observed["raw"]["body"])
        safe = document.source_summary(observed["raw"], 1421)
        self.assertEqual(safe["sources"][2]["readStatus"], "foreign-blob-blocked")
        self.assertIn("/staff/project-purchase-order-print/1421/sent/1", safe["printHandlers"][1]["nativePrintRoutes"])
        self.assertNotIn("PRIVATE", json.dumps(safe))
        self.assertNotIn("private.invalid", json.dumps(safe))


if __name__ == "__main__":
    unittest.main()
