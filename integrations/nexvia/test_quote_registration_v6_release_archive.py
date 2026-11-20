"""The released v6 builder must not silently bundle a newer registration runtime."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_quote_registration_v6_installer as builder


class RegistrationV6ReleaseArchiveTests(unittest.TestCase):
    def test_repeated_default_builds_reproduce_the_reviewed_archive_without_runtime_reads(self):
        archive = Path(builder.__file__).parent / builder.ARCHIVE
        expected = archive.read_bytes()
        read_bytes = Path.read_bytes
        def archived_only(path):
            if path.resolve() != archive.resolve():
                raise AssertionError("mutable runtime read")
            return read_bytes(path)
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "release.py"
            with patch.object(Path, "read_text", side_effect=AssertionError("mutable template read")), \
                    patch.object(Path, "read_bytes", archived_only):
                first = builder.build(destination)
                second = builder.build(destination)
            self.assertEqual(destination.read_bytes(), expected)
            self.assertEqual(first, second)
            self.assertEqual(first, (builder.ARCHIVE_SHA256, len(expected)))
            self.assertEqual(hashlib.sha256(expected).hexdigest(), first[0])
        self.assertEqual(archive.read_bytes(), expected)

    def test_explicit_source_root_still_builds_the_requested_legacy_fixture(self):
        template = '''import base64,json
BUNDLE_BASE64 = ""
FILES = frozenset({'fixture.py'})
class QuotePolicyUpdateError(ValueError): pass
def decoded_payload():
    bundle=json.loads(base64.b64decode(BUNDLE_BASE64))
    return {name:base64.b64decode(row['contentBase64']) for name,row in bundle.items()}
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = b"# Explicit v6 fixture, independent of the current runtime.\n"
            (root / "install_nexvia_quote_registration_update_v6.py").write_text(template)
            (root / "fixture.py").write_bytes(source)
            destination = root / "fixture-release.py"
            with patch.object(builder, "ARCHIVE", "missing-archive.py"):
                checksum, size = builder.build(destination, source_root=root)
            released = destination.read_bytes()
            namespace = {"__name__": "explicit_legacy_fixture"}
            exec(compile(released, str(destination), "exec"), namespace)
            self.assertEqual(namespace["decoded_payload"](), {"fixture.py": source})
            self.assertEqual((checksum, size), (hashlib.sha256(released).hexdigest(), len(released)))

    def test_corrupt_archive_is_refused_before_changing_the_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "corrupt.py"
            archive.write_bytes(b"# Corrupted immutable release.\n")
            destination = root / "release.py"
            destination.write_bytes(b"UNCHANGED DESTINATION")
            with patch.object(builder, "ARCHIVE", str(archive)):
                with self.assertRaisesRegex(ValueError, "immutable"):
                    builder.build(destination)
            self.assertEqual(destination.read_bytes(), b"UNCHANGED DESTINATION")
            self.assertEqual(archive.read_bytes(), b"# Corrupted immutable release.\n")

    def test_symlink_destination_is_refused_without_touching_its_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target.py"
            target.write_bytes(b"UNCHANGED TARGET")
            destination = root / "release.py"
            destination.symlink_to(target)
            with self.assertRaisesRegex(ValueError, "symlink"):
                builder.build(destination)
            self.assertTrue(destination.is_symlink())
            self.assertEqual(destination.readlink(), target)
            self.assertEqual(target.read_bytes(), b"UNCHANGED TARGET")

    def test_archive_destination_and_hardlink_alias_are_never_replaced(self):
        expected = (Path(builder.__file__).parent / builder.ARCHIVE).read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "reviewed-release.py"
            archive.write_bytes(expected)
            alias = root / "hardlink.py"
            alias.hardlink_to(archive)
            identity = archive.stat()
            with patch.object(builder, "ARCHIVE", str(archive)):
                for destination in (archive, alias):
                    with self.subTest(destination=destination.name):
                        with self.assertRaisesRegex(ValueError, "must not be overwritten"):
                            builder.build(destination)
            after = archive.stat()
            self.assertEqual((after.st_dev, after.st_ino, after.st_mtime_ns, after.st_nlink),
                             (identity.st_dev, identity.st_ino, identity.st_mtime_ns, identity.st_nlink))
            self.assertEqual(archive.read_bytes(), expected)
            self.assertTrue(alias.samefile(archive))

    def test_all_older_archives_and_hardlinks_remain_immutable(self):
        source_root = Path(builder.__file__).parent
        for version in (3, 4, 5, 6):
            archive = source_root / ("releases/install_nexvia_quote_registration_update_v" + str(version) + ".py")
            expected = archive.read_bytes()
            identity = archive.stat()
            with tempfile.TemporaryDirectory(prefix=".v6-archive-guard-", dir=archive.parent) as directory:
                alias = Path(directory) / "archive-alias.py"
                alias.hardlink_to(archive)
                for output in (archive, alias):
                    with self.subTest(version=version, output=output.name):
                        with self.assertRaisesRegex(ValueError, "must not be overwritten"):
                            builder.build(output)
            self.assertEqual(archive.read_bytes(), expected)
            after = archive.stat()
            self.assertEqual((after.st_dev, after.st_ino, after.st_mtime_ns, after.st_nlink),
                             (identity.st_dev, identity.st_ino, identity.st_mtime_ns, identity.st_nlink))


if __name__ == "__main__":
    unittest.main()
