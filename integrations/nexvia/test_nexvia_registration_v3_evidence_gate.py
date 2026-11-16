"""The v3 updater reads bound registration evidence without replaying a file."""
import copy
import hashlib
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import install_nexvia_quote_registration_update_v3 as installer
import nexvia_check_quote_policy as checker
import nexvia_inspect_failed_quote_upload as inspector
import nexvia_preparation_diagnostics as diagnostics
import nexvia_requests as bridge
import test_nexvia_check_quote_policy as flow_tests


DONE_SHA = "6bca1e312639e1f418f8da27b980417500364820031430f277eed15fe59498bf"
PREFIX_SHA = "99865d2b4faa2b895f45e7aa108017ffbf1f4d8025119878530ce1eb8d3c1486"
SELECTOR_SHA = "7afb763b2e52d444664ede7686562bf3aca2759fcbe372aa8f6423c26749c2e0"


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def name_shape(value):
    return {"sha256": hashlib.sha256(value.encode()).hexdigest(), "length": len(value),
            "safeIdentifier": True, "canonicalKnownName": value}


def source_contract():
    prefix = {"literal": {"path": "[literal]", "sha256": PREFIX_SHA,
                          "length": 15, "trailingSlash": True, "hasQuery": False}}
    native_id = {"response": {"alias": ["[member]", "id"], "sha256":
        "7ffe90ca01c88026955412c117be6dc693c1ee7a24eeb332fadd55e4f2c658d1",
        "length": 2, "leaf": name_shape("id")}}
    slash = {"literal": {"path": "[literal]", "sha256": hashlib.sha256(b"/").hexdigest(),
                         "length": 1, "trailingSlash": True, "hasQuery": False}}
    selector = {"selector": {"sha256": SELECTOR_SHA, "length": 7,
                              "safeIdentifier": True, "canonicalKnownName": None}}
    data = {"key": name_shape("location"), "responsePath": {"alias": ["[member]", "path"],
        "sha256": "f918dfdeda799c70f931ab89a7d3c3737cfc2f7e76fb95566ee0833f7dd68712",
        "length": 2, "leaf": name_shape("path")}, "metadataSourceMatchesSignedKey": False,
        "metadataSourceMatchesFileURL": True, "metadataSourceMatchesURL": False,
        "metadataSourceMatchesID": False, "encoding": "direct_member"}
    return {"doneSourceSha256": DONE_SHA, "primary": {"functionDepth": 0, "method": "GET",
        "urlTemplates": [[copy.deepcopy(prefix), copy.deepcopy(native_id)],
                         [slash, selector, copy.deepcopy(prefix), copy.deepcopy(native_id)]],
        "data": [data], "async": True}, "fileURLAssignments": 1,
        "controller": {"status": "observed", "namespace": "staff", "selector": selector["selector"],
                       "branch": "unsupported"}, "otherGETs": []}


class RegistrationV3EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        flow_tests.PolicyCheckerTests.setUpClass()

    def setUp(self):
        self.flow = flow_tests.PolicyCheckerTests("runTest")
        self.flow.setUp()
        self.addCleanup(self.flow.tearDown)
        self.root, self.identifier = self.flow.root, self.flow.identifier
        self.report = self.root / "nexvia-registration-source-checks" / (self.identifier + ".json")
        self.report.parent.mkdir(mode=0o700)
        self.diag = self.flow.folder / diagnostics.DIAGNOSTIC_FILE
        try:
            with diagnostics.preparation_diagnostics(self.flow.folder, self.flow.request):
                diagnostics.stage("quote_upload")
                diagnostics.transport(policyRequests=1, storageUploads=1, registrations=0)
                diagnostics.route_event("native_policy", "GET", status=200)
                diagnostics.route_event("native_other", "GET", denied=True)
                diagnostics.route_event("storage_upload", "POST", status=204)
                diagnostics.failure("quote_upload_incomplete")
                raise RuntimeError("synthetic operation stopped")
        except RuntimeError:
            pass
        self.write_report()

    def write_report(self, **changes):
        with checker.runtime_bundle(self.flow.bundle) as (_q, parser, _hashes):
            proof, _records = checker.originals(self.root, self.identifier, parser)
        value = {"format": "nexvia-registration-source-check", "version": 1,
            "requestId": self.identifier, "requestHash": digest(self.flow.request),
            "evidenceBeforeHash": digest(proof), "evidenceAfterHash": digest(proof),
            "originalsUnchanged": True, "readOnly": True, "policyRequests": 0,
            "storageUploads": 0, "registrations": 0, "poSubmissions": 0, "emails": 0,
            "status": "inspected", "code": "done_source_observed", "contract": source_contract()}
        value.update(changes)
        bridge.atomic_json(self.report, value)
        return value

    def evaluate(self):
        return installer.observed_registration_evidence(self.root, self.identifier)

    def reject(self):
        with self.assertRaises(installer.QuotePolicyUpdateError) as caught:
            self.evaluate()
        self.assertNotIn("PRIVATE_UNEXPECTED_VALUE", str(caught.exception))

    def test_bound_report_is_stable_and_no_pdf_or_original_evidence_is_touched(self):
        original = {path: path.read_bytes() for path in (self.report, self.diag, self.flow.main,
                    self.flow.folder / "request.json", self.flow.folder / checker.MARKERS[0])}
        real_open = os.open
        def no_pdf(path, *args, **kwargs):
            if str(path).endswith(".pdf"):
                self.fail("The evidence gate must not read source PDF bytes")
            return real_open(path, *args, **kwargs)
        with patch("os.open", side_effect=no_pdf):
            result = self.evaluate()
            self.assertEqual(self.evaluate(), result)
        self.assertEqual({path: path.read_bytes() for path in original}, original)
        self.assertEqual(self.flow.context.gets, [])

    def test_missing_symlink_and_world_readable_report_are_rejected(self):
        raw = self.report.read_bytes()
        self.report.unlink()
        self.reject()
        other = self.root / "unrelated"
        other.write_bytes(raw)
        other.chmod(0o600)
        self.report.symlink_to(other)
        self.reject()
        self.report.unlink()
        self.report.write_bytes(raw)
        self.report.chmod(0o644)
        self.reject()

    def test_report_identity_read_only_flags_and_proof_are_required(self):
        for changes in ({"requestId": "00000000-0000-0000-0000-000000000000"},
                        {"requestHash": "0" * 64}, {"version": 2}, {"version": True},
                        {"format": "PRIVATE_UNEXPECTED_VALUE"}, {"originalsUnchanged": False},
                        {"readOnly": False}, {"evidenceAfterHash": "0" * 64},
                        {"status": "blocked"}, {"code": "inspection_failed"},
                        {"policyRequests": 1}, {"storageUploads": 1}, {"registrations": 1},
                        {"poSubmissions": True}, {"emails": 1}):
            self.write_report(**changes)
            with self.subTest(changes=changes): self.reject()

    def test_exact_done_route_and_location_provenance_are_required(self):
        for name in ("source", "method", "depth", "route", "key", "path", "url_source", "controller"):
            value = self.write_report()
            contract = value["contract"]
            if name == "source": contract["doneSourceSha256"] = "0" * 64
            elif name == "method": contract["primary"]["method"] = "POST"
            elif name == "depth": contract["primary"]["functionDepth"] = 1
            elif name == "route": contract["primary"]["urlTemplates"][0][0]["literal"]["sha256"] = "0" * 64
            elif name == "key": contract["primary"]["data"][0]["key"]["sha256"] = "0" * 64
            elif name == "path": contract["primary"]["data"][0]["responsePath"]["leaf"]["sha256"] = "0" * 64
            elif name == "url_source": contract["primary"]["data"][0]["metadataSourceMatchesFileURL"] = False
            elif name == "controller": contract["controller"]["namespace"] = "PRIVATE_UNEXPECTED_VALUE"
            bridge.atomic_json(self.report, value)
            with self.subTest(name=name): self.reject()

    def test_original_diagnostic_must_prove_one_accepted_storage_transport_without_registration(self):
        original = json.loads(self.diag.read_bytes())
        for name in ("phase", "code", "counters", "counter_type", "request", "request_hash", "status",
                     "policy_status", "storage_status", "registered", "denied"):
            value = copy.deepcopy(original)
            if name == "phase": value["phase"] = "quote_policy"
            elif name == "code": value["code"] = "quote_policy_conditions"
            elif name == "counters": value["counters"]["storageUploads"] = 0
            elif name == "counter_type": value["counters"]["storageUploads"] = True
            elif name == "request": value["requestId"] = "00000000-0000-0000-0000-000000000000"
            elif name == "request_hash": value["requestHash"] = "0" * 64
            elif name == "status": value["status"] = "prepared"
            elif name == "policy_status": value["events"][0]["status"] = 403
            elif name == "storage_status": value["events"][-1]["status"] = 403
            elif name == "registered": value["counters"]["registrations"] = 1
            elif name == "denied": value["events"][-1]["denied"] = True
            bridge.atomic_json(self.diag, value)
            self.write_report()
            with self.subTest(name=name): self.reject()

    def test_later_creation_marker_and_changed_main_journal_block_replacement_gate(self):
        original_main = self.flow.main.read_bytes()
        value = json.loads(original_main)
        value["phase"] = "SUBMISSION_STARTED"
        bridge.atomic_json(self.flow.main, value)
        self.write_report()
        self.reject()
        self.flow.main.write_bytes(original_main)
        self.flow.main.chmod(0o600)
        for marker in checker.MARKERS[1:]:
            path = self.flow.folder / marker
            bridge.atomic_json(path, {})
            self.write_report()
            with self.subTest(marker=marker): self.reject()
            path.unlink()

    def test_source_only_native_wrapper_rechecks_and_preserves_a_changed_report(self):
        arguments = (self.root, self.root / "unused-python", {}, self.identifier)
        with patch.object(installer, "_native_policy_preflight", return_value=True) as native:
            self.assertTrue(installer.native_policy_preflight(*arguments, bridge_lock_fd=17))
            native.assert_called_once_with(*arguments, bridge_lock_fd=17)
        def change(*args, **kwargs):
            value = json.loads(self.report.read_bytes())
            value["externalNote"] = "Changed while the native check was running"
            bridge.atomic_json(self.report, value)
            return True
        with patch.object(installer, "_native_policy_preflight", side_effect=change) as native:
            with self.assertRaises(installer.QuotePolicyUpdateError):
                installer.native_policy_preflight(*arguments, bridge_lock_fd=17)
            self.assertEqual(native.call_count, 1)
        self.assertIn("externalNote", json.loads(self.report.read_bytes()))
        self.assertEqual(self.flow.context.gets, [])

    def test_protected_state_includes_registration_source_reports(self):
        state = installer.protected_state(self.root)
        self.assertIn(str(self.report.relative_to(self.root)), state)
        value = json.loads(self.report.read_bytes())
        value["externalNote"] = True
        bridge.atomic_json(self.report, value)
        self.assertNotEqual(installer.protected_state(self.root), state)


if __name__ == "__main__":
    unittest.main()
