import base64
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location("nexvia_po_document", Path(__file__).with_name("nexvia_po_document.py"))
document = importlib.util.module_from_spec(spec)
spec.loader.exec_module(document)
TARGET = "/staff/project-purchase-order-modify/60/1421"
PROJECT = "2549 - LN0951 - Salacia Fire Engineering Upgrades - Stage 2"
SUPPLIER = "Example Industrial Services Pty Ltd"
TEXT = "LENNOX FACADES\nPURCHASE ORDER\nPO7413\nSalacia Fire Engineering Upgrades - Stage 2\nExample Industrial Services Pty Ltd\nGrand Total: AUD $1,100.00"
TEST_WHEEL = Path(os.environ.get("NEXVIA_TEST_PYPDF_WHEEL", "/nonexistent-test-pypdf.whl"))
PARSER_AVAILABLE = TEST_WHEEL.is_file() or importlib.util.find_spec("pypdf") is not None


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
        self.assertEqual(report["status"], "identity-context-unavailable")
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
const fields={'form[Lines]':JSON.stringify([{qty:1,unit_price:1000,tax_rate:10}]),'form[ServiceId]':'8'};
const document={body:{innerText:'Purchase Order # PO7413'},querySelector:()=>({}),getElementsByName:name=>fields[name]?[{value:fields[name]}]:[],querySelectorAll:selector=>selector.startsWith('embed')?sources:[button]};
const context={window,document,URL,location:{origin:'https://lennox.nexvia.com.au',href:'https://lennox.nexvia.com.au/staff/project-purchase-order-modify/60/1421'},setTimeout,clearTimeout,fetch:()=>{fetches++;throw Error('must not fetch HTTP');}};
(async()=>{const raw=await vm.runInNewContext('('+input.source+')',context)({maxBytes:5242880,maxEncoded:7000000,expectedNumber:'PO7413'});process.stdout.write(JSON.stringify({raw,actions,fetches,getters,overrides}));})();
'''
        completed = subprocess.run(["node", "-e", harness], input=json.dumps({"source": document.READ_PAGE_JS,
            "data": snapshot()["sources"][0]["content"]}), text=True, capture_output=True, check=True)
        observed = json.loads(completed.stdout)
        self.assertEqual({key: observed[key] for key in ["actions", "fetches", "getters", "overrides"]}, {"actions": 0, "fetches": 0, "getters": 0, "overrides": 0})
        self.assertEqual(document.decode_candidate(observed["raw"]["sources"][0]), pdf_bytes())
        safe = document.source_summary(observed["raw"], 1421)
        self.assertEqual(safe["sources"][2]["readStatus"], "foreign-blob-blocked")
        self.assertIn("/staff/project-purchase-order-print/1421/sent/1", safe["printHandlers"][1]["nativePrintRoutes"])
        self.assertNotIn("PRIVATE", json.dumps(safe))
        self.assertNotIn("private.invalid", json.dumps(safe))


if __name__ == "__main__":
    unittest.main()
