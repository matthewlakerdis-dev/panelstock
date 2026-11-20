"""Supported syntax evidence is fixed independently of private generated source."""
import hashlib
from pathlib import Path
import unittest

import nexvia_generated_callback as profile

FIXTURES = Path(__file__).parent/'fixtures'


class GeneratedCallbackTests(unittest.TestCase):
    def test_synthetic_body_reproduces_complete_passive_audit_profile(self):
        body=(FIXTURES/'nexvia-done-generated-synthetic.js').read_text()
        observed=(FIXTURES/'nexvia-done-syntax-profile-v1.txt').read_text().rstrip()
        self.assertEqual(hashlib.sha256(observed.encode()).hexdigest(),
                         '6f44c66a5ad9719ae1707edabf79724d3cc04fd6ebbdb36ae6a8b5cab317e9b7')
        self.assertEqual(profile.canonical_program(body),observed)
        self.assertEqual(profile.profile(body)['doneSourceSha256'],hashlib.sha256(body.encode()).hexdigest())

    def test_generated_config_values_change_raw_hash_and_preserve_supported_shape(self):
        body=(FIXTURES/'nexvia-done-generated-synthetic.js').read_text()
        changed=body.replace('opaque-100','generated-id-2026')+' /* display-only */ '
        self.assertNotEqual(body,changed)
        self.assertEqual(profile.profile(body)['doneProfileSha256'],profile.profile(changed)['doneProfileSha256'])
        self.assertNotEqual(profile.profile(body)['doneSourceSha256'],profile.profile(changed)['doneSourceSha256'])

    def test_unobserved_interpolation_regex_and_extra_syntax_are_rejected(self):
        body=(FIXTURES/'nexvia-done-generated-synthetic.js').read_text()
        for suffix in (';fetch("/new")', ';let x=`${fetch("/new")}`;', ';let x=/hidden/;', ';let x="broken'):
            with self.subTest(suffix=suffix),self.assertRaises(profile.CallbackProfileError):
                profile.profile(body+suffix)
        for value in (None,'','x'*65537):
            with self.subTest(value=type(value).__name__),self.assertRaises(profile.CallbackProfileError):
                profile.profile(value)


if __name__=='__main__':unittest.main()
