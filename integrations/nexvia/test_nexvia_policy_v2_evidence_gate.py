"""The v2 installer consumes bound, private diagnostics without another lookup."""
import ast
import base64
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
from types import ModuleType
import unittest
from unittest.mock import patch

import install_nexvia_quote_policy_update_v2 as installer
import nexvia_check_quote_policy as checker
import nexvia_inspect_failed_quote_upload as inspector
import nexvia_quote_attachment as quote
import nexvia_requests as bridge
import test_nexvia_check_quote_policy as flow_tests
from test_nexvia_quote_attachment import ENDPOINT, policy_fields


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=True, allow_nan=False).encode()).hexdigest()


class PolicyV2EvidenceGateTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).parent / "releases/check_nexvia_quote_policy_v2.py"
        assignment = next(node for node in ast.parse(source.read_bytes()).body
                          if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
                          and node.targets[0].id == "BUNDLE_BASE64")
        self.flow = flow_tests.PolicyCheckerTests("runTest")
        self.flow.bundle = base64.b64decode(ast.literal_eval(assignment.value))
        self.flow.setUp()
        self.addCleanup(self.flow.tearDown)
        self.root, self.identifier = self.flow.root, self.flow.identifier
        self.v1path = self.root / "nexvia-policy-checks" / (self.identifier + ".json")
        self.v2path = self.root / "nexvia-policy-checks-v2" / (self.identifier + ".json")
        self.v2path.parent.mkdir(mode=0o700)
        self.v1 = json.loads(self.v1path.read_bytes())
        self.v1["sourceHashes"] = dict(installer.POLICY_CHECK_SOURCE_SHA256)
        value = policy_fields()
        document = json.loads(base64.b64decode(value["policy"]))
        document["conditions"].extend([
            ["starts-with", "$content-disposition", ""],
            ["starts-with", "$content-type", ""],
        ])
        value["policy"] = base64.b64encode(json.dumps(document).encode()).decode()
        shape = checker.response_shape(json.dumps(value).encode(), quote, endpoint=ENDPOINT,
                                       acl="private", metadata=self.flow.request["quote"],
                                       source_fields=quote.SIGNED_POLICY_FIELDS | {
                                           "Content-Type", "Content-Disposition", "acl", "file"})
        self.v2 = {**copy.deepcopy(self.v1), "version": 2, "shape": shape}
        self.write_reports()

    def save(self, path, value):
        value = copy.deepcopy(value)
        value["recordHash"] = digest({key: item for key, item in value.items() if key != "recordHash"})
        bridge.atomic_json(path, value)
        return value

    def write_reports(self, v1=None, v2=None):
        first = self.save(self.v1path, self.v1 if v1 is None else v1)
        with inspector.private_directory(self.v1path.parent) as directory:
            _, identity = inspector.private_file(directory, self.v1path.name, 256 * 1024)
        second = copy.deepcopy(self.v2 if v2 is None else v2)
        second.update(priorPolicyCheckHash=digest(first), priorPolicyCheckIdentity=digest(identity))
        return self.save(self.v2path, second)

    def evaluate(self):
        return installer.observed_policy_evidence(self.root, self.identifier)

    def reject(self):
        with self.assertRaises(installer.QuotePolicyUpdateError) as caught:
            self.evaluate()
        self.assertNotIn("PRIVATE-UNEXPECTED-VALUE", str(caught.exception))

    def test_exact_pair_is_bound_and_reports_and_pdf_are_never_written_or_read(self):
        pdf = self.flow.folder / "nexvia-supplier-quote.pdf"
        pdf.write_bytes(b"%PDF-synthetic-never-read")
        pdf.chmod(0o600)
        before = {path: path.read_bytes() for path in (self.v1path, self.v2path,
                  self.flow.folder / "request.json", self.flow.folder / checker.MARKERS[0], self.flow.main)}
        original_open = os.open
        def guarded(path, *args, **kwargs):
            if str(path).endswith(".pdf"):
                self.fail("An installer evidence gate must not read PDF bytes")
            return original_open(path, *args, **kwargs)
        with patch("os.open", side_effect=guarded):
            result = self.evaluate()
            self.assertEqual(self.evaluate(), result)
        self.assertEqual({path: path.read_bytes() for path in before}, before)
        self.assertEqual(self.flow.context.gets, [])

    def test_missing_and_symlink_reports_are_rejected(self):
        for path in (self.v1path, self.v2path):
            original = path.read_bytes()
            path.unlink()
            self.reject()
            target = self.root / "unrelated-report"
            target.write_bytes(original)
            target.chmod(0o600)
            path.symlink_to(target)
            self.reject()
            path.unlink()
            path.write_bytes(original)
            path.chmod(0o600)

    def test_report_checksums_bindings_and_action_markers_are_required(self):
        for changed in ({"requestHash": "0" * 64}, {"attemptHash": "0" * 64},
                        {"mainJournalHash": "0" * 64}, {"sourceHashes": {}},
                        {"evidenceAfterHash": "0" * 64}, {"originalsUnchanged": False},
                        {"version": 1}, {"httpStatus": 201}, {"code": "policy_verified"},
                        {"fileUploads": 1}, {"poSubmissions": True}, {"emails": 1}):
            self.write_reports(v2={**copy.deepcopy(self.v2), **changed})
            with self.subTest(changed=changed): self.reject()
        self.write_reports()
        value = json.loads(self.v2path.read_bytes())
        value["recordHash"] = "0" * 64
        bridge.atomic_json(self.v2path, value)
        self.reject()

    def test_prior_v1_report_is_independently_bound_even_with_updated_link(self):
        for changed in ({"requestHash": "0" * 64}, {"sourceHashes": {}},
                        {"stage": "quote_draft"}, {"version": True}, {"policyRequestInvoked": False}):
            self.write_reports(v1={**copy.deepcopy(self.v1), **changed})
            with self.subTest(changed=changed): self.reject()

    def test_only_two_exact_observed_header_predicates_are_accepted(self):
        for field, replacement in (("dollarPrefix", False), ("safeASCIIFieldName", False),
                ("sourceAppendedExact", True), ("sourceAppendedCaseFold", False),
                ("canonicalKnownField", "PRIVATE-UNEXPECTED-VALUE"),
                ("nameSha256", "0" * 64), ("nameLength", 500),
                ("emptyPrefix", False), ("op", "eq"), ("valueType", "number")):
            value = copy.deepcopy(self.v2)
            row = next(row for row in value["shape"]["candidates"][0]["conditions"]
                       if row.get("field") == "[other]")
            row[field] = replacement
            self.write_reports(v2=value)
            with self.subTest(field=field): self.reject()
        for action in ("missing", "duplicate"):
            value = copy.deepcopy(self.v2)
            rows = value["shape"]["candidates"][0]["conditions"]
            row = next(row for row in rows if row.get("field") == "[other]")
            rows.remove(row) if action == "missing" else rows.append(copy.deepcopy(row))
            self.write_reports(v2=value)
            with self.subTest(action=action): self.reject()

    def test_failed_protected_matches_or_metadata_checks_are_never_accepted(self):
        for field in ("protected", "signature"):
            value = copy.deepcopy(self.v2)
            candidate = value["shape"]["candidates"][0]
            if field == "protected":
                row = next(row for row in candidate["conditions"] if isinstance(row.get("protectedMatches"), dict))
                row["protectedMatches"]["bucket"] = False
            else:
                candidate["checks"]["signatureHex"] = False
            self.write_reports(v2=value)
            with self.subTest(field=field): self.reject()

    def test_original_request_and_later_creation_markers_cannot_drift(self):
        self.evaluate()
        path = self.flow.folder / "request.json"
        original = path.read_bytes()
        value = json.loads(original)
        value["supplierReference"] = "PRIVATE-UNEXPECTED-VALUE"
        bridge.atomic_json(path, value)
        self.reject()
        path.write_bytes(original)
        path.chmod(0o600)
        # Rebind metadata identities after the intentional rewrite, then add a
        # result marker that never existed during the observed policy checks.
        first = self.flow.make_prior(sourceHashes=installer.POLICY_CHECK_SOURCE_SHA256)
        self.v1 = first
        self.v2.update({key: first[key] for key in ("requestHash", "attemptHash", "mainJournalHash",
                        "evidenceBeforeHash", "evidenceAfterHash")})
        self.write_reports()
        self.evaluate()
        bridge.atomic_json(self.flow.folder / "nexvia-result.json", {})
        self.reject()

    def test_protected_state_covers_both_saved_diagnostic_directories(self):
        before = installer.protected_state(self.root)
        self.assertIn(str(self.v1path.relative_to(self.root)), before)
        self.assertIn(str(self.v2path.relative_to(self.root)), before)
        value = json.loads(self.v2path.read_bytes())
        value["observedExtra"] = True
        bridge.atomic_json(self.v2path, value)
        self.assertNotEqual(installer.protected_state(self.root), before)

    def test_source_only_native_gate_rechecks_reports_and_preserves_external_changes(self):
        arguments = (self.root, self.root / "unused-python", {}, self.identifier)
        with patch.object(installer, "_native_policy_preflight", return_value=True) as native, \
                patch.object(installer.subprocess, "run") as subprocess_call:
            self.assertTrue(installer.native_policy_preflight(*arguments, bridge_lock_fd=17))
            native.assert_called_once_with(*arguments, bridge_lock_fd=17)
            subprocess_call.assert_not_called()
        v2_before = self.v2path.read_bytes()
        def changed(*args, **kwargs):
            first = json.loads(self.v1path.read_bytes())
            first["externalNote"] = "changed by the test during source inspection"
            self.save(self.v1path, first)
            return True
        with patch.object(installer, "_native_policy_preflight", side_effect=changed) as native, \
                patch.object(installer.subprocess, "run") as subprocess_call:
            for _ in range(2):
                with self.assertRaises(installer.QuotePolicyUpdateError):
                    installer.native_policy_preflight(*arguments, bridge_lock_fd=17)
            # The second check must fail on its saved evidence before invoking
            # even the source-only native reader for a second time.
            self.assertEqual(native.call_count, 1)
            subprocess_call.assert_not_called()
        self.assertEqual(self.v2path.read_bytes(), v2_before)
        self.assertIn("externalNote", json.loads(self.v1path.read_bytes()))
        self.assertEqual(self.flow.context.gets, [])

    def test_offline_synthetic_preflight_requires_the_fresh_fixed_validator(self):
        snippet = installer.PREFLIGHT.split("# This synthetic response exercises", 1)[1]
        snippet = "# This synthetic response exercises" + snippet.split("print(json.dumps", 1)[0]
        namespace = {"base64": base64, "json": json, "datetime": datetime,
                     "timedelta": timedelta, "timezone": timezone}
        path = Path(__file__).parent / "nexvia_quote_attachment.py"
        fresh = ModuleType("fresh_quote_policy_preflight_test")
        exec(compile(path.read_bytes(), str(path), "exec"), fresh.__dict__)
        current = {**namespace, "quote": fresh}
        exec(compile(snippet, "<offline-policy-preflight>", "exec"), current)
        self.assertEqual(current["verified"][0]["fields"]["policy"], current["policy"])
        self.assertEqual(current["verified"][0]["conditions"], current["conditions"])
        with checker.runtime_bundle(self.flow.bundle) as (old, parser, hashes):
            with self.assertRaises(old.QuoteAttachmentError):
                exec(compile(snippet, "<old-policy-preflight-must-fail>", "exec"),
                     {**namespace, "quote": old})
        self.assertEqual(self.flow.context.gets, [])


if __name__ == "__main__": unittest.main()
