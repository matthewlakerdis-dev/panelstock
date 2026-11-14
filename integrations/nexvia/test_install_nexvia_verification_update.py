import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import build_verification_installer as builder
import install_nexvia_verification_update as installer


def bundled(files):
    value = {name: {"sha256": hashlib.sha256(raw).hexdigest(),
                    "contentBase64": base64.b64encode(raw).decode()}
             for name, raw in files.items()}
    return base64.b64encode(json.dumps(value).encode()).decode()


class Fixture:
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.proc = self.root / "proc"
        self.proc.mkdir()
        self.old = {name: ("# deployed quote v1 " + name + "\n").encode() for name in installer.PRIOR_SHA256}
        self.new = {name: ("# verification patch " + name + "\n").encode() for name in installer.FILES}
        for name, raw in self.old.items():
            (self.root / name).write_bytes(raw)
            (self.root / name).chmod(0o755 if name == "nexvia_allocations.py" else 0o644)
        tools = self.root / "nexvia-tools/bin"
        tools.mkdir(parents=True)
        (tools / "python").symlink_to("/usr/bin/python3")
        vendor = self.root / "nexvia-po-vendor"
        vendor.mkdir(mode=0o700)
        self.parser = vendor / "pypdf.whl"
        self.parser.write_bytes(b"synthetic pinned parser")
        self.parser.chmod(0o600)
        self.journal = self.root / "panelstock-request-journal"
        self.journal.mkdir(mode=0o700)
        self.record = self.journal / ("request-" + installer.DEFAULT_REQUEST + ".json")
        self.record.write_bytes(b"immutable terminal outbound and claim")
        self.record.chmod(0o600)
        self.request = self.root / "nexvia-requests" / installer.DEFAULT_REQUEST
        self.request.mkdir(mode=0o700, parents=True)
        for name in ["request.json", "nexvia-prepared.json", "nexvia-create-attempt.json", "nexvia-create-response.html"]:
            (self.request / name).write_bytes(("immutable " + name).encode())
            (self.request / name).chmod(0o600)
        self.quote_backup = self.root / "nexvia-backup-before-quote-update"
        self.quote_backup.mkdir(mode=0o700)
        (self.quote_backup / "original.txt").write_bytes(b"original quote-update backup")
        self.config = self.root / "panelstock-requests.json"
        self.config.write_bytes(b'{"enabled":true,"creationEnabled":true,"documentEnabled":true,"quoteEnabled":true,"token":"synthetic-private","workerId":"synthetic-worker","extra":{"unchanged":true}}')
        self.config.chmod(0o600)
        self.success = True
        self.checked, self.launched = [], []

    def checker(self, *args, **kwargs):
        self.checked.append((args, kwargs))
        descriptor = kwargs["bridge_lock_fd"]
        self.asserted_lock = os.fstat(descriptor)
        return self.success

    def launch(self, *args):
        self.launched.append(args)

    def run(self, **options):
        return installer.install(self.root, self.proc,
                                 **{"checker": self.checker, "launch": self.launch, **options})

    def watcher(self, script="nexvia_requests.py"):
        folder = self.proc / "9001"
        folder.mkdir()
        args = [str(self.root / "nexvia-tools/bin/python"), "-u", str(self.root / script), "--watch"]
        (folder / "cmdline").write_bytes(b"\0".join(value.encode() for value in args) + b"\0")
        (folder / "stat").write_text("9001 (python test) S " + "0 " * 18 + "1234 0")

    def stop(self, root, proc, identity):
        folder = self.proc / str(identity[0])
        for path in folder.iterdir():
            path.unlink()
        folder.rmdir()

    def assert_old(self, test):
        for name, raw in self.old.items():
            test.assertEqual((self.root / name).read_bytes(), raw)
        test.assertFalse((self.root / "nexvia_reconcile_existing_po.py").exists())


class VerificationInstallerTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.temporary.cleanup)
        self.addCleanup(patch.stopall)
        patch.object(installer, "BUNDLE_BASE64", bundled(self.f.new)).start()
        patch.object(installer, "PRIOR_SHA256", {name: hashlib.sha256(raw).hexdigest()
                                               for name, raw in self.f.old.items()}).start()
        patch.object(installer, "PYPDF_SHA256", hashlib.sha256(self.f.parser.read_bytes()).hexdigest()).start()

    def test_narrow_patch_preserves_config_evidence_other_modules_and_prior_backup(self):
        config = self.f.config.read_bytes()
        evidence = installer.protected_request(self.f.root, installer.DEFAULT_REQUEST)
        result = self.f.run()
        self.assertTrue(result["nativeVerified"])
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(installer.protected_request(self.f.root, installer.DEFAULT_REQUEST), evidence)
        self.assertFalse((self.f.request / "nexvia-result.json").exists())
        for name, raw in self.f.new.items():
            self.assertEqual((self.f.root / name).read_bytes(), raw)
        for name, raw in self.f.old.items():
            if name not in self.f.new:
                self.assertEqual((self.f.root / name).read_bytes(), raw)
        self.assertEqual((self.f.quote_backup / "original.txt").read_bytes(), b"original quote-update backup")
        backup = self.f.root / "nexvia-backup-before-verification-update"
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in backup.iterdir()))
        self.assertEqual((backup / "panelstock-requests.json").read_bytes(), config)
        self.assertEqual((self.f.root / "nexvia_allocations.py").stat().st_mode & 0o777, 0o755)

    def test_failed_read_check_rolls_back_patch_and_restarts_only_known_prior_watcher(self):
        self.f.success = False
        config = self.f.config.read_bytes()
        self.f.watcher()
        with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
            with self.assertRaisesRegex(installer.VerificationUpdateError, "existing PO could not be verified"):
                self.f.run()
        self.f.assert_old(self)
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(len(self.f.checked), 1)
        self.assertFalse((self.f.request / "nexvia-result.json").exists())
        self.assertEqual(len(self.f.launched), 1)

    def test_current_patch_rerun_keeps_original_verification_backup(self):
        self.f.run()
        backup = self.f.root / "nexvia-backup-before-verification-update"
        before = {path.name: path.read_bytes() for path in backup.iterdir()}
        self.assertFalse(self.f.run()["updated"])
        self.assertEqual({path.name: path.read_bytes() for path in backup.iterdir()}, before)

    def test_unknown_and_partial_module_versions_refuse_before_stopping_or_checking(self):
        for name, raw in [("nexvia_create.py", b"# local edit\n"),
                          ("nexvia_allocations.py", self.f.new["nexvia_allocations.py"])]:
            path = self.f.root / name
            path.write_bytes(raw)
            with self.assertRaisesRegex(installer.VerificationUpdateError, "local changes"):
                self.f.run()
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual(self.f.checked, [])
            path.write_bytes(self.f.old[name])

    def test_work_lock_prevents_stopping_active_bridge(self):
        descriptor = os.open(self.f.journal / ".bridge.lock", os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.f.watcher()
        with patch.object(installer, "stop_idle_watcher") as stop:
            with self.assertRaisesRegex(installer.VerificationUpdateError, "handling work"):
                self.f.run()
            stop.assert_not_called()
        self.f.assert_old(self)

    def test_check_receives_real_inherited_exclusive_work_lock(self):
        def checking(*args, bridge_lock_fd):
            info = os.fstat(bridge_lock_fd)
            self.assertEqual(info.st_mode & 0o777, 0o600)
            self.assertEqual(info.st_ino, (self.f.journal / ".bridge.lock").stat().st_ino)
            duplicate = os.dup(bridge_lock_fd)
            try:
                fcntl.flock(duplicate, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(duplicate)
            fresh = os.open(self.f.journal / ".bridge.lock", os.O_RDWR)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(fresh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(fresh)
            return True

        self.assertTrue(self.f.run(checker=checking)["nativeVerified"])

    def test_active_creator_refuses_installation(self):
        self.f.watcher(script="nexvia_create.py")
        with self.assertRaisesRegex(installer.VerificationUpdateError, "creation process is active"):
            self.f.run()
        self.f.assert_old(self)

    def test_write_failure_rolls_back_changed_modules_without_touching_creation_evidence(self):
        config = self.f.config.read_bytes()
        evidence = installer.protected_request(self.f.root, installer.DEFAULT_REQUEST)
        write = installer.atomic_write
        failed = False

        def interrupted(path, raw, mode):
            nonlocal failed
            if path.name == "nexvia_reconcile_existing_po.py" and not failed:
                failed = True
                raise OSError("synthetic failure")
            return write(path, raw, mode)

        with patch.object(installer, "atomic_write", side_effect=interrupted):
            with self.assertRaisesRegex(installer.VerificationUpdateError, "original modules were restored"):
                self.f.run()
        self.f.assert_old(self)
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(installer.protected_request(self.f.root, installer.DEFAULT_REQUEST), evidence)

    def test_code_drift_during_check_cannot_be_started(self):
        self.f.watcher()

        def changed(*args, **kwargs):
            (self.f.root / "nexvia_allocations.py").write_bytes(b"# unknown concurrent edit\n")
            return True

        with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError):
                self.f.run(checker=changed)
        self.assertEqual((self.f.root / "nexvia_allocations.py").read_bytes(), b"# unknown concurrent edit\n")
        self.assertEqual(self.f.launched, [])

    def test_result_write_during_read_check_is_detected_and_never_accepted(self):
        self.f.watcher()

        def changed(*args, **kwargs):
            result = self.f.request / "nexvia-result.json"
            result.write_bytes(b"unexpected result write")
            result.chmod(0o600)
            return True

        with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError):
                self.f.run(checker=changed)
        self.assertEqual(self.f.launched, [])
        self.assertEqual((self.f.request / "nexvia-result.json").read_bytes(), b"unexpected result write")

    def test_late_external_config_edit_is_preserved_and_patch_rolled_back(self):
        self.f.watcher()
        config = json.loads(self.f.config.read_bytes())
        config["enabled"] = False

        def changed(*args, **kwargs):
            self.f.config.write_text(json.dumps(config))
            return True

        with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError):
                self.f.run(checker=changed)
        self.f.assert_old(self)
        self.assertEqual(json.loads(self.f.config.read_bytes()), config)
        self.assertEqual(self.f.launched, [])

    def test_parser_drift_blocks_automatic_restart(self):
        self.f.watcher()

        def changed(*args, **kwargs):
            self.f.parser.write_bytes(b"unknown parser")
            return True

        with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError):
                self.f.run(checker=changed)
        self.f.assert_old(self)
        self.assertEqual(self.f.launched, [])

    def test_stale_or_actionful_report_cannot_pass_readonly_preflight(self):
        descriptor = os.open(self.f.journal / ".bridge.lock", os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, descriptor)
        value = {"format": "nexvia-existing-po-check", "version": 1, "nativeVerified": True,
                 "requestId": installer.DEFAULT_REQUEST, "projectPageId": 36, "purchaseOrderId": 1422,
                 "purchaseOrderNumber": "PO7414", "readOnly": True, "poCreated": False,
                 "poChanged": False, "resultWritten": False}
        overrides = {}

        def invoke(args, **kwargs):
            self.assertIn("--check", args)
            self.assertNotIn("--reconcile", args)
            self.assertEqual(kwargs["pass_fds"], (descriptor,))
            self.assertEqual(kwargs["stdout"], subprocess.DEVNULL)
            report = self.f.root / installer.REPORT_NAME
            report.write_text(json.dumps({**value, **overrides}))
            report.chmod(0o600)
            return SimpleNamespace(returncode=0)

        args = (self.f.root, self.f.root / "nexvia-tools/bin/python", installer.DEFAULT_REQUEST, 36, 1422, "PO7414")
        with patch.object(installer.subprocess, "run", side_effect=invoke):
            self.assertTrue(installer.preflight(*args, bridge_lock_fd=descriptor))
            for overrides in [{"poCreated": True}, {"poChanged": True}, {"resultWritten": True},
                              {"requestId": "wrong"}, {"purchaseOrderId": 1423}, {"readOnly": False}]:
                self.assertFalse(installer.preflight(*args, bridge_lock_fd=descriptor))
        with patch.object(installer.subprocess, "run", return_value=SimpleNamespace(returncode=0)):
            self.assertFalse(installer.preflight(*args, bridge_lock_fd=descriptor))

    def test_invalid_bundle_and_source_symlinks_refuse_without_mutation(self):
        with patch.object(installer, "BUNDLE_BASE64", ""):
            with self.assertRaises(installer.VerificationUpdateError):
                self.f.run()
        target = self.f.root / "nexvia_create.py"
        target.unlink()
        target.symlink_to(self.f.root / "nexvia_requests.py")
        with self.assertRaises(installer.VerificationUpdateError):
            self.f.run()
        self.assertEqual(self.f.checked, [])

    def test_builder_contains_only_two_exact_patch_sources(self):
        source_root = self.f.root / "build"
        source_root.mkdir()
        (source_root / "install_nexvia_verification_update.py").write_text(Path(installer.__file__).read_text())
        for name, raw in self.f.new.items():
            (source_root / name).write_bytes(raw)
        output = self.f.root / "release.py"
        checksum, size = builder.build(output, source_root)
        self.assertEqual(checksum, hashlib.sha256(output.read_bytes()).hexdigest())
        self.assertEqual(size, output.stat().st_size)
        namespace = {"__name__": "verification_release_test"}
        exec(compile(output.read_bytes(), str(output), "exec"), namespace)
        self.assertEqual(namespace["decoded_payload"](), self.f.new)
        self.f.assert_old(self)


if __name__ == "__main__":
    unittest.main()
