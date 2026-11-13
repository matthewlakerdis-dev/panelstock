import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "nexvia_confirmations", Path(__file__).with_name("nexvia_confirmations.py")
)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

REQUEST_ID = "35fc4244-267c-42c6-885c-6ab93a55b899"


class ConfirmationBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / REQUEST_ID
        self.folder.mkdir()
        self.config = self.root / "config.json"
        self.projects_path = self.root / "projects.json"
        self.projects = {"projects": [{"projectPageId": 60, "name": "Jardin building"}]}
        self.request = {
            "requestId": REQUEST_ID, "reference": "REQ-" + REQUEST_ID,
            "projectPageId": 60, "requestor": {"name": "Matt", "email": "matt@example.com"},
            "totalCents": 110000,
        }
        self.result = {
            "state": "CREATED_VERIFIED", "requestReference": self.request["reference"],
            "projectPageId": 60, "jobId": 262, "purchaseOrderId": 1421,
            "purchaseOrderNumber": "PO7413", "totalCents": 110000,
            "verifiedAt": "2026-11-13T07:00:00+00:00", "requestorEmailSent": False,
            "url": "https://lennox.nexvia.com.au/staff/project-purchase-order-modify/60/1421",
        }
        bridge.atomic_json(self.config, {"enabled": True, "token": "synthetic-" + "x" * 40})
        bridge.atomic_json(self.projects_path, self.projects)
        self.save_sources()

    def save_sources(self):
        bridge.atomic_json(self.folder / "request.json", self.request)
        bridge.atomic_json(self.folder / "nexvia-result.json", self.result)

    def run_bridge(self, post):
        return bridge.run_once(self.config, self.root, self.projects_path, REQUEST_ID, post)

    @staticmethod
    def reply(status="sent", provider="resend-synthetic"):
        return {"ok": True, "confirmation": {"id": "live:1421", "status": status,
                                               "purchaseOrderId": 1421,
                                               "purchaseOrderNumber": "PO7413", "test": False,
                                               "providerId": provider}}

    def test_only_verified_existing_po_is_sent_and_provider_receipt_is_retained(self):
        calls = []

        def post(payload, token):
            calls.append(copy.deepcopy(payload))
            return self.reply()

        self.assertEqual(self.run_bridge(post)[REQUEST_ID], "sent")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["totalCents"], 110000)
        self.assertEqual(calls[0]["purchaseOrderNumber"], "PO7413")
        self.assertEqual(calls[0]["project"], "Jardin building")
        self.assertEqual(calls[0]["currency"], "AUD")
        self.assertFalse(calls[0]["test"])
        self.assertEqual(calls[0]["verifiedAt"], "2026-11-13T07:00:00.000Z")
        recorded, _ = bridge.read_json(self.folder / "nexvia-result.json")
        self.assertTrue(recorded["requestorEmailSent"])
        self.assertEqual(recorded["requestorEmailProviderId"], "resend-synthetic")
        self.assertEqual(recorded["purchaseOrderId"], 1421)
        self.assertEqual(self.run_bridge(post)[REQUEST_ID], "sent")
        self.assertEqual(len(calls), 1)
        for filename in (bridge.JOB_FILE, bridge.RECEIPT_FILE, "nexvia-result.json"):
            self.assertEqual((self.folder / filename).stat().st_mode & 0o777, 0o600)

    def test_pending_and_failed_network_retries_reuse_original_payload(self):
        calls = []

        def post(payload, token):
            calls.append(bridge.canonical(payload))
            if len(calls) == 1:
                raise bridge.BridgeError("Timeout")
            return self.reply("retrying" if len(calls) == 2 else "sent")

        self.assertIn("Timeout", self.run_bridge(post)[REQUEST_ID])
        self.assertEqual(self.run_bridge(post)[REQUEST_ID], "retrying")
        result, _ = bridge.read_json(self.folder / "nexvia-result.json")
        self.assertFalse(result["requestorEmailSent"])
        self.assertEqual(self.run_bridge(post)[REQUEST_ID], "sent")
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(calls[1], calls[2])

    def test_unverified_results_and_disabled_or_missing_config_make_no_calls(self):
        def forbidden(*args):
            self.fail("Unexpected network call")

        self.result["state"] = "SUBMISSION_STARTED"
        self.save_sources()
        self.assertEqual(self.run_bridge(forbidden)[REQUEST_ID], "unverified")
        bridge.atomic_json(self.config, {"enabled": False})
        self.assertEqual(self.run_bridge(forbidden), {"bridge": "disabled"})
        self.config.unlink()
        self.assertEqual(self.run_bridge(forbidden), {"bridge": "disabled"})
        self.assertFalse((self.folder / bridge.JOB_FILE).exists())

    def test_mismatched_total_reference_project_or_po_never_sends(self):
        def forbidden(*args):
            self.fail("Unexpected network call")

        original = copy.deepcopy(self.result)
        for field, bad_value in (("totalCents", 110001), ("requestReference", "REQ-wrong"),
                                 ("projectPageId", 61), ("purchaseOrderNumber", "7413"),
                                 ("purchaseOrderId", True),
                                 ("verifiedAt", "2026-11-13T07:00:00"),
                                 ("verifiedAt", "2026-11-13T07:00:00+10:00")):
            with self.subTest(field=field, value=bad_value):
                self.result = {**original, field: bad_value}
                self.save_sources()
                status = self.run_bridge(forbidden)[REQUEST_ID]
                self.assertNotIn(status, {"sent", "queued", "retrying"})
                self.assertFalse((self.folder / bridge.JOB_FILE).exists())

    def test_changed_saved_payload_is_not_sent_as_a_retry(self):
        calls = []

        def post(payload, token):
            calls.append(payload)
            return self.reply("queued", None)

        self.assertEqual(self.run_bridge(post)[REQUEST_ID], "queued")
        self.request["requestor"]["email"] = "different@example.com"
        self.save_sources()
        self.assertIn("changed", self.run_bridge(post)[REQUEST_ID])
        self.assertEqual(len(calls), 1)
        saved, _ = bridge.read_json(self.folder / bridge.JOB_FILE)
        self.assertEqual(saved["payload"]["recipient"], "matt@example.com")

    def test_terminal_provider_status_or_auth_rejection_does_not_automatically_retry(self):
        for terminal in ("failed", "needs_review", "auth"):
            with self.subTest(terminal=terminal):
                for name in (bridge.JOB_FILE, bridge.RECEIPT_FILE):
                    (self.folder / name).unlink(missing_ok=True)
                calls = []

                def post(payload, token):
                    calls.append(payload)
                    if terminal == "auth":
                        raise bridge.NeedsReview("Authentication rejected")
                    return self.reply(terminal, None)

                self.assertIn(self.run_bridge(post)[REQUEST_ID], {"failed", "needs_review"})
                self.assertIn(self.run_bridge(post)[REQUEST_ID], {"failed", "needs_review"})
                self.assertEqual(len(calls), 1)
                result, _ = bridge.read_json(self.folder / "nexvia-result.json")
                self.assertFalse(result["requestorEmailSent"])

    def test_concurrent_source_change_retains_receipt_without_overwriting_result(self):
        def post(payload, token):
            changed = {**self.result, "operatorNote": "Concurrent edit"}
            bridge.atomic_json(self.folder / "nexvia-result.json", changed)
            return self.reply()

        self.assertIn("source changed", self.run_bridge(post)[REQUEST_ID])
        result, _ = bridge.read_json(self.folder / "nexvia-result.json")
        self.assertEqual(result["operatorNote"], "Concurrent edit")
        self.assertFalse(result["requestorEmailSent"])
        receipt, _ = bridge.read_json(self.folder / bridge.RECEIPT_FILE)
        self.assertEqual(receipt["status"], "sent")
        self.assertEqual(receipt["providerId"], "resend-synthetic")

    def test_already_accepted_receipt_recovers_local_flag_without_resending(self):
        original_write = bridge.atomic_json

        def interrupted_write(path, value):
            if Path(path).name == "nexvia-result.json":
                raise bridge.BridgeError("Interrupted after receipt")
            original_write(path, value)

        with patch.object(bridge, "atomic_json", interrupted_write):
            self.assertIn("Interrupted", self.run_bridge(lambda *args: self.reply())[REQUEST_ID])

        def forbidden(*args):
            self.fail("Accepted receipt must not resend")

        self.assertEqual(self.run_bridge(forbidden)[REQUEST_ID], "sent")

    def test_invalid_receipt_cannot_claim_delivery(self):
        for reply in (None, [], {"ok": True}, self.reply("sent", None)):
            with self.subTest(reply=reply):
                self.assertIn("response" if reply != self.reply("sent", None) else "receipt",
                              self.run_bridge(lambda *args: reply)[REQUEST_ID])
                self.assertFalse((self.folder / bridge.RECEIPT_FILE).exists())
                result, _ = bridge.read_json(self.folder / "nexvia-result.json")
                self.assertFalse(result["requestorEmailSent"])

    def test_mismatched_response_identity_never_records_acceptance(self):
        for field, value in (("id", "test:1421"), ("purchaseOrderId", 1422),
                             ("purchaseOrderNumber", "PO7414"), ("test", True)):
            with self.subTest(field=field):
                reply = self.reply()
                reply["confirmation"][field] = value
                self.assertIn("identity mismatch", self.run_bridge(lambda *args: reply)[REQUEST_ID])
                self.assertFalse((self.folder / bridge.RECEIPT_FILE).exists())
                result, _ = bridge.read_json(self.folder / "nexvia-result.json")
                self.assertFalse(result["requestorEmailSent"])

    def test_provider_field_limits_are_validated_locally(self):
        def forbidden(*args):
            self.fail("Invalid payload must not be posted")

        self.projects["projects"][0]["name"] = "A" * 161
        bridge.atomic_json(self.projects_path, self.projects)
        self.assertIn("Project name", self.run_bridge(forbidden)[REQUEST_ID])
        self.projects["projects"][0]["name"] = "Jardin building"
        bridge.atomic_json(self.projects_path, self.projects)
        self.request["totalCents"] = 1000000000001
        self.result["totalCents"] = self.request["totalCents"]
        self.save_sources()
        self.assertIn("total", self.run_bridge(forbidden)[REQUEST_ID])

    def test_config_permissions_symlink_and_overlapping_process_are_rejected(self):
        os.chmod(self.config, 0o644)
        with self.assertRaisesRegex(bridge.BridgeError, "0600"):
            self.run_bridge(lambda *args: self.reply())
        os.chmod(self.config, 0o600)
        with bridge.bridge_lock(self.root):
            with self.assertRaisesRegex(bridge.BridgeError, "Another"):
                self.run_bridge(lambda *args: self.reply())
        copied = self.folder.with_name("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        copied.symlink_to(self.folder, target_is_directory=True)
        with self.assertRaisesRegex(bridge.BridgeError, "folder"):
            bridge.process_folder(copied, self.projects, "synthetic", lambda *args: self.reply())

    def test_redirect_handler_never_forwards_credentials(self):
        request = bridge.urllib.request.Request(
            bridge.ENDPOINT, headers={"Authorization": "Bearer synthetic"}
        )
        with self.assertRaises(bridge.NeedsReview):
            bridge.NoRedirect().redirect_request(
                request, None, 307, "Redirect", {}, "https://elsewhere.example/"
            )


if __name__ == "__main__":
    unittest.main()
