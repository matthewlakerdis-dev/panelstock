import base64
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error


DIRECTORY = Path(__file__).parent
spec = importlib.util.spec_from_file_location("nexvia_test_po_document_email", DIRECTORY / "nexvia_test_po_document_email.py")
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)
fixture_spec = importlib.util.spec_from_file_location("po_document_pdf_fixture", DIRECTORY / "test_nexvia_po_document.py")
fixture = importlib.util.module_from_spec(fixture_spec)
fixture_spec.loader.exec_module(fixture)
WORKER = "7d913213-5be7-4271-a0fa-9ed1462367f4"
TOKEN = "PRIVATE_TOKEN_" + "x" * 40
PDF_TEXT = "LENNOX FACADES\nPURCHASE ORDER\nPO7413\nJardin building\nBUNNINGS WAREHOUSE\nTotal including GST $1,100.00"


def private_json(path, value):
    path.write_text(json.dumps(value))
    path.chmod(0o600)


def setup(root):
    folder = root / "PO7413"
    folder.mkdir(mode=0o700)
    folder.chmod(0o700)
    raw = fixture.pdf_bytes(PDF_TEXT)
    pdf = folder / script.PDF_NAME
    pdf.write_bytes(raw)
    pdf.chmod(0o600)
    manifest = {"version": 1, "projectPageId": 60, "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413",
                "filename": script.PDF_NAME, "sourceKind": "gcs", "identityHash": "a" * 64,
                "sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw)}
    private_json(folder / script.MANIFEST, manifest)
    config = root / "config.json"
    private_json(config, {"token": TOKEN, "workerId": WORKER, "enabled": True, "documentEnabled": True})
    return folder, config, raw, manifest


def acknowledgement(sha256, status="sent", duplicate=False, **changes):
    job = {"id": script.JOB_ID, "status": status, "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413",
           "test": True, "providerId": "provider-123" if status == "sent" else None}
    job.update(changes)
    return {"ok": True, "duplicate": duplicate, "confirmation": job, "documentAttached": True, "documentSha256": sha256}


class TestDocumentEmailTests(unittest.TestCase):
    def test_default_mode_only_checks_local_pdf_and_does_not_queue_email(self):
        with tempfile.TemporaryDirectory() as root:
            folder, _, raw, _ = setup(Path(root))
            with patch.object(script, "CHECK_FOLDER", folder), patch.object(script, "verify_pdf") as verify, \
                    patch.object(script, "request_test") as transport, redirect_stdout(io.StringIO()) as console:
                self.assertEqual(script.main([]), 0)
            verify.assert_called_once_with(raw, folder)
            transport.assert_not_called()
            self.assertFalse((folder / script.RECEIPT).exists())
            self.assertIn("No email requested", console.getvalue())

    @unittest.skipUnless(fixture.PARSER_AVAILABLE, "pypdf is needed for fixed real-PDF validation")
    def test_real_parser_requires_fixed_po_project_bunnings_and_total_without_browser(self):
        module = script.capture_module()
        wheel = fixture.TEST_WHEEL if fixture.TEST_WHEEL.is_file() else module.VENDOR_WHEEL
        with tempfile.TemporaryDirectory() as root, patch.object(module, "VENDOR_WHEEL", wheel), \
                patch.object(script, "capture_module", return_value=module), \
                patch.object(module, "with_browser", side_effect=AssertionError("No Nexvia browser allowed")):
            folder = Path(root)
            script.verify_pdf(fixture.pdf_bytes(PDF_TEXT), folder)
            for text in [PDF_TEXT.replace("PO7413", "PO7414"), PDF_TEXT.replace("Jardin building", "Other project"),
                         PDF_TEXT.replace("BUNNINGS WAREHOUSE", "Other supplier"), PDF_TEXT.replace("1,100.00", "1,200.00")]:
                with self.assertRaisesRegex(script.TestEmailError, "fixed-po-pdf-verification-failed"):
                    script.verify_pdf(fixture.pdf_bytes(text), folder)

    def test_explicit_send_freezes_exact_original_body_and_never_resends_sent_receipt(self):
        with tempfile.TemporaryDirectory() as root:
            folder, config, raw, manifest = setup(Path(root))
            before = {(folder / name): (folder / name).read_bytes() for name in [script.MANIFEST, script.PDF_NAME]}
            transport = Mock(return_value=acknowledgement(manifest["sha256"]))
            result = script.send_test(folder=folder, config_path=config, transport=transport, validator=Mock())
            self.assertEqual(result, {"status": "sent", "providerAccepted": True})
            method, token, body = transport.call_args.args
            self.assertEqual((method, token), ("POST", TOKEN))
            self.assertEqual(set(body), {"sha256", "contentBase64"})
            self.assertEqual(base64.b64decode(body["contentBase64"]), raw)
            receipt = script.load_receipt(folder, WORKER)
            self.assertEqual(receipt["bodyHash"], script.digest(script.canonical(body)))
            self.assertEqual(receipt["jobId"], "test-document:1421")
            self.assertEqual((folder / script.RECEIPT).stat().st_mode & 0o777, 0o600)
            self.assertNotIn(TOKEN, (folder / script.RECEIPT).read_text())
            transport.reset_mock()
            self.assertEqual(script.send_test(folder=folder, config_path=config, transport=transport, validator=Mock()), result)
            transport.assert_not_called()
            for path, saved in before.items():
                self.assertEqual(path.read_bytes(), saved)

    def test_lost_ack_retry_uses_identical_frozen_body_and_same_remote_job(self):
        with tempfile.TemporaryDirectory() as root:
            folder, config, _, manifest = setup(Path(root))
            transport = Mock(side_effect=script.TestEmailError("test-connection-unavailable"))
            pending = script.send_test(folder=folder, config_path=config, transport=transport, validator=Mock())
            self.assertEqual(pending["status"], "pending_ack")
            frozen = script.load_receipt(folder, WORKER)
            old_body = script.canonical(transport.call_args.args[2])
            transport = Mock(return_value=acknowledgement(manifest["sha256"], duplicate=True))
            self.assertTrue(script.send_test(folder=folder, config_path=config, transport=transport, validator=Mock())["providerAccepted"])
            self.assertEqual(script.canonical(transport.call_args.args[2]), old_body)
            self.assertEqual(script.load_receipt(folder, WORKER)["bodyHash"], frozen["bodyHash"])

    def test_get_status_resolves_uncertain_receipt_without_pdf_parser_or_post(self):
        with tempfile.TemporaryDirectory() as root:
            folder, config, _, manifest = setup(Path(root))
            script.send_test(folder=folder, config_path=config, transport=Mock(side_effect=script.TestEmailError("test-connection-unavailable")), validator=Mock())
            transport = Mock(return_value=acknowledgement(manifest["sha256"]))
            with patch.object(script, "verified_artifact", side_effect=AssertionError("Status must not parse current PDF")):
                result = script.test_status(folder=folder, config_path=config, transport=transport)
            self.assertTrue(result["providerAccepted"])
            transport.assert_called_once_with("GET", TOKEN)
            self.assertEqual(script.load_receipt(folder, WORKER)["status"], "sent")

    def test_terminal_failures_and_wrong_ack_identity_or_hash_never_trigger_another_post(self):
        cases = [lambda sha: acknowledgement(sha, status="failed"),
                 lambda sha: acknowledgement(sha, status="needs_review"),
                 lambda sha: acknowledgement("b" * 64),
                 lambda sha: acknowledgement(sha, test=False),
                 lambda sha: acknowledgement(sha, id="test:1421"),
                 lambda sha: acknowledgement(sha, providerId=None)]
        for make_reply in cases:
            with tempfile.TemporaryDirectory() as root:
                folder, config, _, manifest = setup(Path(root))
                transport = Mock(return_value=make_reply(manifest["sha256"]))
                result = script.send_test(folder=folder, config_path=config, transport=transport, validator=Mock())
                self.assertFalse(result["providerAccepted"])
                self.assertIn(result["status"], {"failed", "needs_review"})
                transport.reset_mock()
                script.send_test(folder=folder, config_path=config, transport=transport, validator=Mock())
                transport.assert_not_called()

    def test_changed_pdf_or_manifest_after_freeze_is_not_uploaded_or_relabelled_as_sent(self):
        with tempfile.TemporaryDirectory() as root:
            folder, config, _, manifest = setup(Path(root))
            script.send_test(folder=folder, config_path=config, transport=Mock(side_effect=script.TestEmailError("test-connection-unavailable")), validator=Mock())
            before = (folder / script.RECEIPT).read_bytes()
            changed = fixture.pdf_bytes(PDF_TEXT + "\nChanged local document")
            (folder / script.PDF_NAME).write_bytes(changed)
            manifest.update(size=len(changed), sha256=script.digest(changed))
            private_json(folder / script.MANIFEST, manifest)
            transport = Mock()
            with self.assertRaisesRegex(script.TestEmailError, "frozen-test-source-changed"):
                script.send_test(folder=folder, config_path=config, transport=transport, validator=Mock())
            transport.assert_not_called()
            self.assertEqual((folder / script.RECEIPT).read_bytes(), before)

    def test_manifest_permissions_symlinks_and_fixed_identity_are_checked_before_network(self):
        changes = [lambda folder, manifest: private_json(folder / script.MANIFEST, {**manifest, "purchaseOrderId": 1422}),
                   lambda folder, manifest: (folder / script.PDF_NAME).chmod(0o644),
                   lambda folder, manifest: (folder / script.MANIFEST).chmod(0o644),
                   lambda folder, manifest: folder.chmod(0o755),
                   lambda folder, manifest: (folder / script.PDF_NAME).write_bytes(b"Changed")]
        for mutate in changes:
            with tempfile.TemporaryDirectory() as root:
                folder, config, _, manifest = setup(Path(root))
                mutate(folder, manifest)
                transport = Mock()
                with self.assertRaises(script.TestEmailError):
                    script.send_test(folder=folder, config_path=config, transport=transport, validator=Mock())
                transport.assert_not_called()

    def test_request_uses_only_pinned_test_endpoint_no_redirect_or_proxy_and_fixed_ua(self):
        body = {"sha256": "a" * 64, "contentBase64": "PRIVATE_BYTES"}
        reply = {"ok": True, "confirmation": None, "documentAttached": False, "documentSha256": None}

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self, maximum):
                return json.dumps(reply).encode()

        for method in ["GET", "POST"]:
            opener = SimpleNamespace(open=Mock(return_value=Response()))
            script.request_test(method, TOKEN, body if method == "POST" else None, opener=opener)
            request = opener.open.call_args.args[0]
            self.assertEqual(request.full_url, script.ENDPOINT)
            self.assertEqual(request.get_method(), method)
            self.assertEqual(request.data, script.canonical(body) if method == "POST" else None)
            self.assertEqual(request.get_header("User-agent"), "PanelStock-Nexvia-Bridge/1.0")
            self.assertEqual(request.get_header("Authorization"), "Bearer " + TOKEN)
            self.assertFalse(request.has_header("Cookie"))
            self.assertFalse(request.has_header("Referer"))
        with self.assertRaisesRegex(script.NeedsReview, "test-endpoint-redirected"):
            script.NoRedirect().redirect_request(None, None, 302, "PRIVATE", {}, "https://foreign.invalid/PRIVATE")
        for error in [urllib.error.HTTPError(script.ENDPOINT, 409, "PRIVATE", {}, None), RuntimeError("PRIVATE " + TOKEN)]:
            try:
                script.request_test("POST", TOKEN, body, opener=SimpleNamespace(open=Mock(side_effect=error)))
            except script.TestEmailError as safe:
                self.assertNotIn("PRIVATE", str(safe))
                self.assertNotIn(TOKEN, str(safe))
            else:
                self.fail("Network failure was accepted")

    def test_readonly_get_has_no_queue_when_no_remote_job_exists(self):
        with tempfile.TemporaryDirectory() as root:
            folder, config, _, _ = setup(Path(root))
            transport = Mock(return_value={"ok": True, "confirmation": None, "documentAttached": False, "documentSha256": None})
            self.assertEqual(script.test_status(folder=folder, config_path=config, transport=transport), {"status": "not_sent", "providerAccepted": False})
            transport.assert_called_once_with("GET", TOKEN)
            self.assertFalse((folder / script.RECEIPT).exists())


if __name__ == "__main__":
    unittest.main()
