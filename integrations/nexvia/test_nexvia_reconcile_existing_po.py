import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import nexvia_requests as bridge
import nexvia_reconcile_existing_po as recovery
from test_nexvia_requests import Fixture, REQUEST_ID, TOKEN, WORKER_ID, payload, work, catalog, verified


class RecoveryFixture:
    def __init__(self, directory):
        self.fixture = Fixture(directory)
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        self.config = bridge.load_config(f.config)
        self.work = dict(work(), documentExpected=True)
        self.target = verified()["url"]

        def attempted(identifier, prepared_hash):
            bridge.atomic_json(f.requests / identifier / "nexvia-create-attempt.json", {
                "state": "RESPONSE_RECEIVED", "status": 302, "location": self.target,
                "reference": payload()["reference"]})
            return 1

        with bridge.bridge_lock(f.journal):
            self.main, journal = bridge.handle_work(
                self.work, self.config, f.journal, f.requests, lookup=lambda _: catalog(),
                creator=attempted, preparer=f.preparer, project_names={60: "Jardin building"})
            bridge.report_terminal(self.main, journal, TOKEN, post=f.post, request_root=f.requests)
        self.folder = f.requests / REQUEST_ID
        self.source_paths = [self.folder / name for name in recovery.SOURCE_FILES] + [self.main]
        self.originals = {str(path): path.read_bytes() for path in self.source_paths}
        self.verifications, self.posts = [], []
        self.post_failure = None
        self.ack_mutation = None

    def verify(self, source):
        self.verifications.append(source["request"]["requestId"])
        return copy.deepcopy(verified())

    def post(self, path, value, token):
        self.posts.append((path, copy.deepcopy(value), token))
        if path == recovery.RECONCILE_PATH:
            if self.post_failure is not None:
                error, self.post_failure = self.post_failure, None
                raise error
            response = {"ok": True, "duplicate": len([p for p in self.posts if p[0] == path]) > 1,
                        "acceptedState": "created_verified", "reconciliation": {"version": 1, "hash": recovery.reconciliation_hash(value)},
                        "request": {"id": REQUEST_ID, "state": "created_verified", "result": copy.deepcopy(value["result"]),
                                    "confirmation": {"status": "sent", "providerId": "synthetic-provider-id"}}}
            if self.ack_mutation:
                self.ack_mutation(response)
            return response
        return self.fixture.post(path, value, token)

    def kwargs(self):
        return {"config_path": self.fixture.config, "journal_root": self.fixture.journal,
                "request_root": self.fixture.requests, "verifier": self.verify}

    def check(self, **changes):
        return recovery.check_existing(REQUEST_ID, 60, 1421, "PO7413", **dict(self.kwargs(), **changes))

    def reconcile(self, **changes):
        return recovery.reconcile(REQUEST_ID, 60, 1421, "PO7413",
                                  **dict(self.kwargs(), post=self.post, capturer=self.fixture.capturer,
                                         pause=lambda _: None, **changes))

    def assert_originals(self, testcase):
        testcase.assertEqual(self.originals, {str(path): path.read_bytes() for path in self.source_paths})

    @property
    def sidecar(self):
        return self.fixture.journal / "reconciliations" / ("request-" + REQUEST_ID + ".json")


class ExistingPoRecoveryTests(unittest.TestCase):
    def test_readonly_check_validates_existing_po_without_result_journal_or_network_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            report = f.check()
            self.assertTrue(report["nativeVerified"])
            self.assertTrue(report["readOnly"])
            self.assertFalse(report["poCreated"] or report["poChanged"] or report["resultWritten"])
            self.assertEqual(report["purchaseOrderNumber"], "PO7413")
            self.assertEqual(f.posts, [])
            self.assertFalse(f.sidecar.exists())
            self.assertFalse((f.folder / "nexvia-result.json").exists())
            f.assert_originals(self)

    def test_reconciles_original_claim_then_delivers_original_document_once(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            result = f.reconcile()
            self.assertEqual(result["documentStatus"], "uploaded")
            self.assertEqual(result["confirmationStatus"], "sent")
            self.assertEqual([call[0] for call in f.posts], [recovery.RECONCILE_PATH, bridge.DOCUMENT_PATH,
                                                         recovery.RECONCILE_PATH])
            body = f.posts[0][1]
            self.assertEqual(set(body), {"workerId", "id", "claimToken", "version", "previous", "result"})
            self.assertEqual(body["previous"], {"state": "needs_review", "message": bridge.read_json(f.main)["outbound"]["message"]})
            self.assertTrue(body["result"]["documentExpected"])
            self.assertEqual(len(f.verifications), 1)
            self.assertEqual(len(f.fixture.capture_calls), 1)
            first = f.sidecar.read_bytes()
            f.reconcile(verifier=lambda _: self.fail("Accepted recovery must not verify or create again"))
            self.assertEqual(len(f.posts), 4)
            self.assertEqual(f.sidecar.read_bytes(), first)
            self.assertEqual(len(f.fixture.capture_calls), 1)
            f.assert_originals(self)
            for path in (f.sidecar, f.folder / "nexvia-result.json"):
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_lost_reconciliation_ack_reuses_frozen_body_and_verification_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            f.post_failure = TimeoutError("synthetic lost acknowledgement")
            with self.assertRaises(TimeoutError):
                f.reconcile()
            self.assertTrue((f.folder / "nexvia-result.json").exists())
            saved = bridge.read_json(f.sidecar)
            self.assertFalse(saved["reported"])
            self.assertEqual(len(f.fixture.capture_calls), 0)
            first = copy.deepcopy(f.posts[0][1])
            f.reconcile(verifier=lambda _: self.fail("A lost acknowledgement cannot rerun native verification"))
            self.assertEqual(f.posts[1][1], first)
            self.assertEqual(len(f.verifications), 1)
            f.assert_originals(self)

    def test_mismatched_ack_does_not_release_document_and_can_retry_same_body(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            f.ack_mutation = lambda reply: reply["request"]["result"].update(purchaseOrderId=999)
            with self.assertRaisesRegex(recovery.ReconciliationError, "acknowledged"):
                f.reconcile()
            self.assertEqual(len(f.fixture.capture_calls), 0)
            f.ack_mutation = None
            f.reconcile()
            self.assertEqual(f.posts[0][1], f.posts[1][1])
            f.assert_originals(self)

    def test_original_source_mutation_blocks_frozen_recovery_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            f.post_failure = TimeoutError()
            with self.assertRaises(TimeoutError):
                f.reconcile()
            main = bridge.read_json(f.main)
            main["outbound"]["message"] += " changed"
            bridge.atomic_json(f.main, main)
            with self.assertRaisesRegex(recovery.ReconciliationError, "Frozen recovery"):
                f.reconcile()
            self.assertEqual(len(f.posts), 1)

    def test_frozen_recovery_body_mutation_is_not_sent(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            f.post_failure = TimeoutError()
            with self.assertRaises(TimeoutError):
                f.reconcile()
            saved = bridge.read_json(f.sidecar)
            saved["reconcileOutbound"]["result"]["purchaseOrderNumber"] = "PO9999"
            bridge.atomic_json(f.sidecar, saved)
            with self.assertRaisesRegex(recovery.ReconciliationError, "Frozen recovery"):
                f.reconcile()
            self.assertEqual(len(f.posts), 1)

    def test_conflicting_existing_result_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            before = {"unexpected": "retained"}
            bridge.atomic_json(f.folder / "nexvia-result.json", before)
            with self.assertRaisesRegex(recovery.ReconciliationError, "existing result"):
                f.reconcile()
            self.assertEqual(bridge.read_json(f.folder / "nexvia-result.json"), before)
            self.assertEqual(f.verifications, [])
            self.assertEqual(f.posts, [])

    def test_unacknowledged_original_outcome_wrong_owner_and_wrong_po_stop_before_readback(self):
        for change in ("unreported", "owner", "location", "number"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                f = RecoveryFixture(directory)
                if change in {"unreported", "owner"}:
                    main = bridge.read_json(f.main)
                    main["reported" if change == "unreported" else "workerId"] = False if change == "unreported" else "b66c4422-1da1-4271-875e-73689c0a41c9"
                    bridge.atomic_json(f.main, main)
                elif change == "location":
                    attempt = bridge.read_json(f.folder / "nexvia-create-attempt.json")
                    attempt["location"] = attempt["location"] + "?sent=1"
                    bridge.atomic_json(f.folder / "nexvia-create-attempt.json", attempt)
                if change == "number":
                    with self.assertRaisesRegex(recovery.ReconciliationError, "selected number"):
                        recovery.check_existing(REQUEST_ID, 60, 1421, "PO9999", **f.kwargs())
                    self.assertEqual(len(f.verifications), 1)
                else:
                    with self.assertRaises((recovery.ReconciliationError, bridge.BridgeError)):
                        f.check()
                    self.assertEqual(f.verifications, [])
                self.assertEqual(f.posts, [])

    def test_native_verification_failure_does_not_write_result_or_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            def fail(_source):
                raise ValueError("Synthetic native allocation mismatch")
            with self.assertRaises(ValueError):
                f.reconcile(verifier=fail)
            self.assertFalse((f.folder / "nexvia-result.json").exists())
            self.assertFalse(f.sidecar.exists())
            self.assertEqual(f.posts, [])
            f.assert_originals(self)

    def test_inherited_installer_lock_is_only_accepted_for_readonly_and_not_released(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            lock = os.open(f.fixture.journal / ".bridge.lock", os.O_RDWR)
            other = os.open(f.fixture.journal / ".bridge.lock", os.O_RDWR)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertTrue(f.check(inherited_lock_fd=lock)["nativeVerified"])
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(recovery.ReconciliationError, "read-only"):
                    with recovery.recovery_lock(f.fixture.journal, lock, check_only=False):
                        self.fail("Inherited lock cannot authorize reconciliation")
            finally:
                os.close(other)
                os.close(lock)

    def test_private_evidence_symlink_is_rejected_without_following(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            path = f.folder / "nexvia-prepared.json"
            copied = f.folder / "copied.json"
            path.rename(copied)
            path.symlink_to(copied)
            with self.assertRaises(recovery.ReconciliationError):
                f.check()
            self.assertEqual(f.verifications, [])

    def test_default_transport_uses_fixed_new_endpoint_and_original_document_transport(self):
        body = {"synthetic": "metadata"}
        with patch.object(bridge, "request_json", return_value={"ok": True}) as send:
            self.assertEqual(recovery.post_api(recovery.RECONCILE_PATH, body, TOKEN), {"ok": True})
            request, timeout = send.call_args.args
            self.assertEqual(request.full_url, bridge.ORIGIN + recovery.RECONCILE_PATH)
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.data, bridge.canonical(body))
            self.assertEqual(request.get_header("Authorization"), "Bearer " + TOKEN)
            self.assertEqual(timeout, 30)
        with patch.object(bridge, "post_api", return_value={"ok": True}) as original:
            recovery.post_api(bridge.DOCUMENT_PATH, body, TOKEN)
            original.assert_called_once_with(bridge.DOCUMENT_PATH, body, TOKEN)
        with self.assertRaises(recovery.ReconciliationError):
            recovery.post_api("https://foreign.invalid/", body, TOKEN)

    def test_confirmation_checks_are_bounded_and_print_provider_acceptance_truthfully(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            f.ack_mutation = lambda reply: reply["request"]["confirmation"].update(status="queued", providerId=None)
            result = f.reconcile()
            self.assertEqual(result["confirmationStatus"], "queued")
            self.assertEqual([p[0] for p in f.posts].count(recovery.RECONCILE_PATH), 4)
            self.assertEqual(len(f.fixture.capture_calls), 1)
            f.assert_originals(self)

    def test_wrong_reconciliation_hash_does_not_release_document(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            f.ack_mutation = lambda reply: reply["reconciliation"].update(hash="b"*64)
            with self.assertRaisesRegex(recovery.ReconciliationError, "acknowledged"):
                f.reconcile()
            self.assertEqual(f.fixture.capture_calls, [])
            f.assert_originals(self)

    @unittest.skipUnless(shutil.which("node"), "JavaScript is needed for the Worker hash contract")
    def test_reconciliation_hash_matches_worker_unicode_encoding(self):
        result = verified()
        result.pop("jobId")
        result.pop("requestorEmailSent")
        result["verifiedAt"] = "2026-11-13T01:02:03.123Z"
        result["documentExpected"] = True
        body = {"version": 1, "previous": {"state": "needs_review",
                "message": "Création interrompue — 確認\u2028requise"}, "result": result}
        script = r'''
const crypto=require('node:crypto'),body=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>crypto.createHash('sha256').update(canonical(v),'utf8').digest('hex');
const originalOutcomeHash=hash({state:body.previous.state,message:body.previous.message});
process.stdout.write(hash({version:1,originalOutcomeHash,result:body.result}));
'''
        expected = subprocess.run(["node", "-e", script], input=json.dumps(body), text=True,
                                  capture_output=True, check=True).stdout
        self.assertEqual(recovery.reconciliation_hash(body), expected)

    def test_check_mode_can_use_explicit_private_report_without_result_files(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            report = f.check()
            destination = Path(directory) / "nexvia-verification-update-check.json"
            args = ["--check", "--request", REQUEST_ID, "--project", "60", "--po", "1421", "--number", "PO7413",
                    "--output", str(destination)]
            with patch.object(recovery, "check_existing", return_value=report), patch.object(recovery, "REPORT_ROOT", Path(directory)):
                self.assertEqual(recovery.main(args), 0)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertFalse((f.folder / "nexvia-result.json").exists())
            f.assert_originals(self)

    def test_check_report_cannot_replace_original_or_result_files_even_on_error(self):
        with tempfile.TemporaryDirectory() as directory:
            f = RecoveryFixture(directory)
            for destination in (f.folder / "request.json", f.folder / "nexvia-result.json", f.main, f.fixture.config,
                                Path(directory) / "nexvia_create.py"):
                with self.subTest(destination=destination.name):
                    args = ["--check", "--request", REQUEST_ID, "--project", "60", "--po", "1421", "--number", "PO7413",
                            "--output", str(destination)]
                    with patch.object(recovery, "check_existing") as verify, patch.object(recovery, "REPORT_ROOT", Path(directory)):
                        self.assertEqual(recovery.main(args), 1)
                        verify.assert_not_called()
            self.assertFalse((f.folder / "nexvia-result.json").exists())
            f.assert_originals(self)

    def test_check_report_cannot_follow_symlink_or_replace_a_hardlinked_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "original.json"
            original.write_text('{"keep":true}')
            destination = root / "nexvia-verification-update-check.json"
            destination.symlink_to(original)
            with patch.object(recovery, "REPORT_ROOT", root), self.assertRaises(recovery.ReconciliationError):
                recovery.report_path(destination)
            destination.unlink()
            os.link(original, destination)
            with patch.object(recovery, "REPORT_ROOT", root), self.assertRaises(recovery.ReconciliationError):
                recovery.report_path(destination)
            self.assertEqual(original.read_text(), '{"keep":true}')


if __name__ == "__main__":
    unittest.main()
