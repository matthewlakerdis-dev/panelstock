"""Old versioned builders must not accidentally package a newer runtime."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_quote_policy_installer as v1
import build_quote_policy_v2_installer as v2


class ReleasedPolicyBuilderTests(unittest.TestCase):
    def test_default_builds_reproduce_their_reviewed_releases_after_runtime_changes(self):
        for builder in (v1, v2):
            with self.subTest(builder=builder.__name__), tempfile.TemporaryDirectory() as temporary:
                destination = Path(temporary) / "release.py"
                expected = (Path(builder.__file__).parent / builder.ARCHIVE).read_bytes()
                checksum, size = builder.build(destination)
                self.assertEqual(destination.read_bytes(), expected)
                self.assertEqual((checksum, size), (builder.ARCHIVE_SHA256, len(expected)))
                self.assertEqual(hashlib.sha256(expected).hexdigest(), checksum)
                with patch.object(builder, "ARCHIVE_SHA256", "0" * 64):
                    with self.assertRaisesRegex(ValueError, "immutable"):
                        builder.build(destination)
                self.assertEqual(destination.read_bytes(), expected)


if __name__ == "__main__":
    unittest.main()
