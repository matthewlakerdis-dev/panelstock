"""Cross-check the updater gate against a report emitted by the real checker."""
import importlib.util
import json
from pathlib import Path
import unittest

import test_nexvia_check_quote_policy as checker_fixtures
import test_nexvia_policy_alias_audit as alias_fixtures


class SavedPolicyEvidenceContractAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        checker_fixtures.PolicyCheckerTests.setUpClass()
        path = Path(__file__).parent / "install_nexvia_quote_policy_update_v2.py"
        spec = importlib.util.spec_from_file_location("audited_policy_v2_installer", path)
        cls.installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.installer)

    def test_report_emitted_by_the_frozen_v2_checker_satisfies_the_updater_gate(self):
        flow = checker_fixtures.PolicyCheckerTests("runTest")
        flow.setUp()
        self.addCleanup(flow.tearDown)
        flow.context.raw = json.dumps(alias_fixtures.observed_policy()).encode()
        report = flow.check()
        self.assertEqual(report["version"], 2)
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["code"], "quote_policy_conditions")
        result = self.installer.observed_policy_evidence(flow.root, flow.identifier)
        self.assertEqual(len(result["reports"]), 2)
        self.assertEqual(len(result["identities"]), 2)
        self.assertEqual(len(flow.context.gets), 1)
        self.assertEqual(flow.check(), report)
        self.assertEqual(len(flow.context.gets), 1)


if __name__ == "__main__":
    unittest.main()
