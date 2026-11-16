"""V2 policy field diagnosis remains metadata-only and requires the failed v1 check."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import build_quote_policy_checker as builder
import nexvia_check_quote_policy as checker
import nexvia_quote_attachment as quote
from test_nexvia_quote_attachment import ENDPOINT, policy_fields
import test_nexvia_check_quote_policy as flow_tests


PRIVATE_FIELD = "X-Private-Account-Identifier"
PRIVATE_VALUE = "PRIVATE-CONDITION-VALUE"


class DiagnosticSnapshotTests(unittest.TestCase):
    def test_runtime_updates_do_not_change_the_published_diagnostic_bundle(self):
        root = Path(__file__).parent
        expected = builder.bundle(root)
        self.assertEqual(builder.build(), (root / "releases/check_nexvia_quote_policy_v2.py").read_bytes())
        with tempfile.TemporaryDirectory() as temporary:
            other = Path(temporary)
            snapshot = other / builder.SNAPSHOT
            snapshot.parent.mkdir()
            snapshot.write_bytes((root / builder.SNAPSHOT).read_bytes())
            (other / "nexvia_quote_attachment.py").write_text("This is a changed runtime module.")
            self.assertEqual(builder.bundle(other), expected)
            snapshot.write_bytes(snapshot.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "snapshot changed"):
                builder.bundle(other)


class FieldPredicateTests(unittest.TestCase):
    def test_case_and_missing_dollar_are_distinct_without_printing_unknown_names(self):
        lower = checker.condition_field_shape("$content-type", {"Content-Type"})
        self.assertTrue(lower["dollarPrefix"])
        self.assertTrue(lower["safeASCIIFieldName"])
        self.assertFalse(lower["sourceAppendedExact"])
        self.assertTrue(lower["sourceAppendedCaseFold"])
        self.assertEqual(lower["canonicalKnownField"], "Content-Type")
        missing = checker.condition_field_shape("Content-Type", {"Content-Type"})
        self.assertFalse(missing["dollarPrefix"])
        self.assertTrue(missing["sourceAppendedExact"])
        self.assertNotEqual(lower, missing)
        unknown = checker.condition_field_shape("$" + PRIVATE_FIELD, {PRIVATE_FIELD})
        self.assertIsNone(unknown["canonicalKnownField"])
        self.assertTrue(unknown["sourceAppendedExact"])
        self.assertEqual(unknown["nameLength"], len(PRIVATE_FIELD))
        self.assertEqual(unknown["nameSha256"], hashlib.sha256(PRIVATE_FIELD.encode()).hexdigest())
        self.assertNotIn(PRIVATE_FIELD, json.dumps(unknown))

    def test_nonstring_and_unsafe_names_never_become_literals(self):
        for value in (None, False, 12, [PRIVATE_FIELD], {PRIVATE_FIELD: PRIVATE_VALUE}, "$Bad\nName", "$\u2603"):
            result = checker.condition_field_shape(value, {PRIVATE_FIELD})
            self.assertFalse(result["safeASCIIFieldName"])
            self.assertIsNone(result["canonicalKnownField"])
            self.assertNotIn(PRIVATE_FIELD, json.dumps(result))
            self.assertNotIn(PRIVATE_VALUE, json.dumps(result))
        self.assertEqual(checker.condition_field_shape([], ())["fieldType"], "array")

    def test_duplicate_masked_conditions_keep_both_detailed_predicates_in_console(self):
        value = policy_fields()
        document = json.loads(base64.b64decode(value["policy"]))
        document["conditions"] = [["starts-with", "$content-type", ""],
                                  ["starts-with", "Content-Type", ""],
                                  ["starts-with", "$" + PRIVATE_FIELD, PRIVATE_VALUE]]
        value["policy"] = base64.b64encode(json.dumps(document).encode()).decode()
        shape = checker.response_shape(json.dumps(value).encode(), quote, endpoint=ENDPOINT,
                                       source_fields={"Content-Type", PRIVATE_FIELD})
        compact = checker.console_shape(shape)
        details = compact["candidates"][0]["fieldDetails"]
        self.assertEqual(len(details), 3)
        indexed = {row["index"]: row for row in details}
        self.assertEqual(indexed[0]["canonicalKnownField"], "Content-Type")
        self.assertTrue(indexed[0]["dollarPrefix"])
        self.assertFalse(indexed[1]["dollarPrefix"])
        self.assertNotEqual(details[0]["index"], details[1]["index"])
        self.assertNotIn(PRIVATE_FIELD, json.dumps(shape))
        self.assertNotIn(PRIVATE_VALUE, json.dumps(shape))
        self.assertNotIn(PRIVATE_FIELD, json.dumps(compact))

    def test_protected_bucket_membership_does_not_displace_either_unknown_field(self):
        value = policy_fields()
        document = json.loads(base64.b64decode(value["policy"]))
        document["conditions"] = [["eq", "$bucket", "synthetic-bucket"],
                                  ["starts-with", "$content-type", ""],
                                  ["starts-with", "Content-Type", ""]]
        value["policy"] = base64.b64encode(json.dumps(document).encode()).decode()
        shape = checker.response_shape(json.dumps(value).encode(), quote, endpoint=ENDPOINT,
                                       source_fields={"Content-Type"})
        details = checker.console_shape(shape)["candidates"][0]["fieldDetails"]
        self.assertEqual({row["index"] for row in details[:2]}, {1, 2})


class PrerequisiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        flow_tests.PolicyCheckerTests.setUpClass()

    def setUp(self):
        self.flow = flow_tests.PolicyCheckerTests("runTest")
        self.flow.setUp()
        self.addCleanup(self.flow.tearDown)
        self.path = self.flow.root / checker.PRIOR_REPORT_DIRECTORY / (self.flow.identifier + ".json")

    def test_failed_v1_report_remains_unchanged_and_v2_uses_separate_single_get_checkpoint(self):
        before = self.path.read_bytes(), self.path.stat().st_mtime_ns
        result = self.flow.check()
        self.assertEqual(result["version"], 2)
        self.assertEqual(result["priorPolicyCheckHash"], checker.digest(json.loads(before[0])))
        self.assertEqual((self.path.read_bytes(), self.path.stat().st_mtime_ns), before)
        self.assertEqual(checker.REPORT_DIRECTORY, "nexvia-policy-checks-v2")
        self.assertEqual(self.flow.check(), result)
        self.assertEqual(len(self.flow.context.gets), 1)

    def test_missing_or_incompatible_v1_report_stops_before_any_browser_or_get(self):
        self.path.unlink()
        with self.assertRaises(ValueError):
            self.flow.check()
        for changed in ({"status": "passed"}, {"code": "policy_verified"}, {"httpStatus": 302},
                        {"version": 2}, {"fileUploads": 1}, {"poSubmissions": 1}, {"emails": 1},
                        {"fileUploads": False}, {"originalsUnchanged": False},
                        {"requestHash": "a" * 64}, {"sourceHashes": {}}, {"evidenceAfterHash": "a" * 64}):
            self.flow.make_prior(**changed)
            with self.subTest(changed=changed), self.assertRaisesRegex(checker.PolicyCheckError, "prior_policy_check_identity"):
                self.flow.check()
        self.assertEqual(self.flow.context.gets, [])

    def test_prior_report_tampering_cannot_be_repaired_by_an_automatic_second_get(self):
        self.flow.check()
        value = json.loads(self.path.read_text())
        value["httpStatus"] = 201
        self.path.write_text(json.dumps(value))
        self.path.chmod(0o600)
        with self.assertRaisesRegex(checker.PolicyCheckError, "prior_policy_check_identity"):
            self.flow.check()
        self.assertEqual(len(self.flow.context.gets), 1)

    def test_prior_report_changed_during_get_preserves_checkpoint_and_cannot_lookup_again(self):
        def changed():
            value = json.loads(self.path.read_text())
            value["diagnosticNote"] = "changed by synthetic test"
            value["recordHash"] = checker.digest({key: item for key, item in value.items() if key != "recordHash"})
            flow_tests.bridge.atomic_json(self.path, value)
        self.flow.context.on_get = changed
        with self.assertRaisesRegex(checker.PolicyCheckError, "prior_policy_check_changed"):
            self.flow.check()
        checkpoint = self.flow.root / checker.REPORT_DIRECTORY / (self.flow.identifier + ".json")
        self.assertTrue(json.loads(checkpoint.read_text())["policyRequestInvoked"])
        with self.assertRaisesRegex(checker.PolicyCheckError, "policy_check_replay_identity"):
            self.flow.check()
        self.assertEqual(len(self.flow.context.gets), 1)
        self.assertEqual(json.loads(self.path.read_text())["diagnosticNote"], "changed by synthetic test")

    def test_original_v1_release_is_immutable(self):
        artifact = Path(__file__).parent / "releases/check_nexvia_quote_policy_v1.py"
        self.assertEqual(hashlib.sha256(artifact.read_bytes()).hexdigest(),
                         "f9f64d8c01b92c0aa6f24b2ebcf84d64c99af7e2389d938ae796fe4e05800ece")


if __name__ == "__main__":
    unittest.main()
