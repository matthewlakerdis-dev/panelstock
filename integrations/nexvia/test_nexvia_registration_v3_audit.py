"""Independent cross-contract check for the passive report and v3 updater."""
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

import nexvia_inspect_quote_registration as probe
import install_nexvia_quote_registration_update_v3 as installer
import test_nexvia_registration_v3_evidence_gate as evidence_fixtures


class EmittedRegistrationEvidenceAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        evidence_fixtures.RegistrationV3EvidenceTests.setUpClass()

    def test_passive_report_writer_and_installer_share_the_exact_evidence_fingerprint(self):
        fixture = evidence_fixtures.RegistrationV3EvidenceTests('runTest')
        fixture.setUp()
        self.addCleanup(fixture.flow.tearDown)
        originals = fixture.flow.originals()
        frozen = (Path(__file__).parent / 'releases/check_nexvia_quote_policy_v2.py').read_bytes()
        result = probe.inspect_request(
            fixture.identifier, fixture.root, frozen=frozen, browser=SimpleNamespace(),
            inspector=lambda *args: evidence_fixtures.source_contract())
        self.assertEqual(result['status'], 'inspected')
        self.assertTrue(result['originalsUnchanged'])
        self.assertEqual(fixture.flow.originals(), originals)
        self.assertEqual(json.loads(fixture.report.read_bytes()), result)
        accepted = installer.observed_registration_evidence(fixture.root, fixture.identifier)
        self.assertEqual(accepted['report'], installer.digest(result))
        self.assertEqual(fixture.flow.context.gets, [])


if __name__ == '__main__':
    unittest.main()
