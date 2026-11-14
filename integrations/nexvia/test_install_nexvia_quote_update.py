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

import build_quote_installer as builder
import install_nexvia_quote_update as installer


def fixture_bundle(files):
    bundle = {name: {"sha256": hashlib.sha256(data).hexdigest(),
                     "contentBase64": base64.b64encode(data).decode()}
              for name, data in files.items()}
    return base64.b64encode(json.dumps(bundle).encode()).decode()


class Fixture:
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.proc = self.root / "proc"
        self.proc.mkdir()
        self.old = {name: ("# previous " + name + "\n").encode() for name in installer.PRIOR_SHA256}
        self.new = {name: ("# released " + name + "\n").encode() for name in installer.FILES}
        for name, raw in self.old.items():
            (self.root / name).write_bytes(raw)
            (self.root / name).chmod(0o755 if name == "nexvia_requests.py" else 0o644)
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
        self.record = self.journal / "sent.json"
        self.record.write_bytes(b"immutable accepted email")
        requests = self.root / "nexvia-requests"
        requests.mkdir(mode=0o700)
        self.request_result = requests / "result.json"
        self.request_result.write_bytes(b"immutable verified PO")
        self.config = self.root / "panelstock-requests.json"
        self.config.write_bytes(b'{"enabled":true,"creationEnabled":false,"documentEnabled":true,"token":"synthetic-private","workerId":"synthetic-worker","extra":{"saved":true}}')
        self.config.chmod(0o600)
        self.success = True
        self.launched, self.checked = [], []

    def launch(self, *args):
        self.launched.append(args)

    def checker(self, *args, **kwargs):
        self.checked.append((args, kwargs))
        return self.success

    def run(self, **options):
        return installer.install(self.root, self.proc,
                                 **{"launch": self.launch, "checker": self.checker, **options})

    def watcher(self, script="nexvia_requests.py", arguments=None):
        process = self.proc / "9001"
        process.mkdir()
        args = arguments or [str(self.root / "nexvia-tools/bin/python"), "-u",
                             str(self.root / script), "--watch"]
        (process / "cmdline").write_bytes(b"\0".join(arg.encode() for arg in args) + b"\0")
        (process / "stat").write_text("9001 (python test) S " + "0 " * 18 + "1234 0")
        return installer.process_identity(self.proc, 9001)

    def remove_process(self, identity):
        folder = self.proc / str(identity[0])
        for path in folder.iterdir():
            path.unlink()
        folder.rmdir()

    def assert_old(self, test):
        for name, raw in self.old.items():
            test.assertEqual((self.root / name).read_bytes(), raw)
        test.assertFalse((self.root / "nexvia_quote_attachment.py").exists())
        test.assertEqual(self.record.read_bytes(), b"immutable accepted email")
        test.assertEqual(self.request_result.read_bytes(), b"immutable verified PO")


class QuoteInstallerTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.temporary.cleanup)
        self.addCleanup(patch.stopall)
        patch.object(installer, "BUNDLE_BASE64", fixture_bundle(self.f.new)).start()
        patch.object(installer, "PRIOR_SHA256", {name: hashlib.sha256(raw).hexdigest()
                                               for name, raw in self.f.old.items()}).start()
        patch.object(installer, "PYPDF_SHA256", hashlib.sha256(self.f.parser.read_bytes()).hexdigest()).start()

    def test_success_replaces_complete_release_and_enables_only_quote_flag_after_check(self):
        old_config = json.loads(self.f.config.read_bytes())
        result = self.f.run()
        self.assertTrue(result["nativeUploadReady"])
        self.assertTrue(result["quoteEnabled"])
        self.assertEqual(json.loads(self.f.config.read_bytes()), {**old_config, "quoteEnabled": True})
        for name, raw in self.f.new.items():
            self.assertEqual((self.f.root / name).read_bytes(), raw)
        self.assertEqual((self.f.root / "nexvia_requests.py").stat().st_mode & 0o777, 0o755)
        self.assertEqual(self.f.config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.f.checked[0][1], {"supplier_name": "Bunnings"})
        self.assertEqual(self.f.record.read_bytes(), b"immutable accepted email")
        self.assertEqual(self.f.request_result.read_bytes(), b"immutable verified PO")
        backup = self.f.root / "nexvia-backup-before-quote-update"
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual(json.loads((backup / "panelstock-requests.json").read_bytes()), old_config)
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in backup.iterdir()))

    def test_synology_inherited_modes_are_tightened_before_private_backup_bytes_are_written(self):
        opened, fdopened, mkdir = os.open, os.fdopen, Path.mkdir
        private_writes = []

        def inherited(path, flags, mode=0o777, **kwargs):
            descriptor = opened(path, flags, mode, **kwargs)
            if flags & os.O_CREAT:
                os.fchmod(descriptor, 0o666)
            return descriptor

        def inherited_directory(path, *args, **kwargs):
            result = mkdir(path, *args, **kwargs)
            if path.name == "nexvia-backup-before-quote-update":
                path.chmod(0o755)
            return result

        test = self

        class CheckedFile:
            def __init__(self, descriptor, mode, *args, **kwargs):
                self.path = Path(os.readlink("/proc/self/fd/" + str(descriptor)))
                self.stream = fdopened(descriptor, mode, *args, **kwargs)

            def __enter__(self):
                self.stream.__enter__()
                return self

            def __exit__(self, *args):
                return self.stream.__exit__(*args)

            def __getattr__(self, name):
                return getattr(self.stream, name)

            def write(self, data):
                if self.path.parent.name == "nexvia-backup-before-quote-update":
                    test.assertEqual(os.fstat(self.stream.fileno()).st_mode & 0o777, 0o600)
                    test.assertEqual(self.path.parent.stat().st_mode & 0o777, 0o700)
                    private_writes.append(self.path.name)
                return self.stream.write(data)

        with patch.object(installer.os, "open", side_effect=inherited), \
                patch.object(installer.os, "fdopen", side_effect=CheckedFile), \
                patch.object(Path, "mkdir", inherited_directory):
            self.assertTrue(self.f.run()["quoteEnabled"])
        self.assertEqual(set(private_writes), set(self.f.old) | {"panelstock-requests.json"})

    def test_failed_native_check_installs_but_cannot_enable_quote_claims(self):
        self.f.success = False
        before = self.f.config.read_bytes()
        result = self.f.run()
        self.assertFalse(result["nativeUploadReady"])
        self.assertFalse(result["quoteEnabled"])
        self.assertEqual(self.f.config.read_bytes(), before)
        self.assertEqual((self.f.root / "nexvia_requests.py").read_bytes(), self.f.new["nexvia_requests.py"])

    def test_document_support_is_required_before_native_check_and_quote_enable(self):
        config = json.loads(self.f.config.read_bytes())
        config["documentEnabled"] = False
        before = json.dumps(config).encode()
        self.f.config.write_bytes(before)
        result = self.f.run()
        self.assertFalse(result["nativeUploadReady"])
        self.assertFalse(result["quoteEnabled"])
        self.assertEqual(self.f.checked, [])
        self.assertEqual(self.f.config.read_bytes(), before)

    def test_rerun_keeps_original_backups_and_existing_capability(self):
        self.f.run()
        backup = self.f.root / "nexvia-backup-before-quote-update"
        originals = {path.name: path.read_bytes() for path in backup.iterdir()}
        enabled_config = self.f.config.read_bytes()
        self.f.success = False
        result = self.f.run()
        self.assertFalse(result["updated"])
        self.assertTrue(result["quoteEnabled"])
        self.assertFalse(result["nativeUploadReady"])
        self.assertEqual(self.f.config.read_bytes(), enabled_config)
        self.assertEqual({path.name: path.read_bytes() for path in backup.iterdir()}, originals)

    def test_failed_check_can_be_retried_without_replacing_prior_backup(self):
        self.f.success = False
        self.f.run()
        backup = self.f.root / "nexvia-backup-before-quote-update"
        before = {path.name: path.read_bytes() for path in backup.iterdir()}
        self.f.success = True
        self.assertTrue(self.f.run()["quoteEnabled"])
        self.assertEqual({path.name: path.read_bytes() for path in backup.iterdir()}, before)

    def test_unknown_or_mixed_module_version_refuses_before_mutation(self):
        for name, raw in [("nexvia_create.py", b"# user local edit\n"),
                          ("nexvia_requests.py", self.f.new["nexvia_requests.py"])]:
            with self.subTest(name=name):
                path = self.f.root / name
                path.write_bytes(raw)
                with self.assertRaisesRegex(installer.QuoteUpdateError, "local changes"):
                    self.f.run()
                self.assertEqual(path.read_bytes(), raw)
                self.assertEqual(self.f.checked, [])
                path.write_bytes(self.f.old[name])

    def test_unverified_enabled_flag_is_not_accepted_on_prior_release(self):
        config = json.loads(self.f.config.read_bytes())
        config["quoteEnabled"] = True
        self.f.config.write_text(json.dumps(config))
        with self.assertRaisesRegex(installer.QuoteUpdateError, "unverified quote"):
            self.f.run()
        self.f.assert_old(self)

    def test_reviewed_optional_reader_is_backed_up_but_unknown_reader_is_refused(self):
        path = self.f.root / "nexvia_inspect_quote_upload.py"
        reviewed = b"# reviewed passive reader\n"
        path.write_bytes(reviewed)
        with patch.object(installer, "OPTIONAL_PRIOR_SHA256", {
                path.name: {hashlib.sha256(reviewed).hexdigest()}}):
            self.assertTrue(self.f.run()["quoteEnabled"])
        self.assertEqual((self.f.root / "nexvia-backup-before-quote-update" / path.name).read_bytes(), reviewed)

    def test_unknown_optional_reader_is_not_treated_as_a_previous_release(self):
        path = self.f.root / "nexvia_inspect_quote_upload.py"
        path.write_bytes(b"# local diagnostic edit\n")
        with self.assertRaisesRegex(installer.QuoteUpdateError, "local changes"):
            self.f.run()
        self.assertEqual(path.read_bytes(), b"# local diagnostic edit\n")
        self.f.assert_old(self)

    def test_source_and_backup_symlinks_are_refused(self):
        path = self.f.root / "nexvia_create.py"
        original = path.read_bytes()
        path.unlink()
        path.symlink_to(self.f.root / "nexvia_requests.py")
        with self.assertRaises(installer.QuoteUpdateError):
            self.f.run()
        self.assertEqual(self.f.checked, [])
        path.unlink()
        path.write_bytes(original)
        (self.f.root / "nexvia-backup-before-quote-update").symlink_to(self.f.journal, target_is_directory=True)
        with self.assertRaisesRegex(installer.QuoteUpdateError, "backup directory"):
            self.f.run()
        self.f.assert_old(self)

    def test_held_work_lock_never_stops_or_modifies_active_bridge(self):
        lock = self.f.journal / ".bridge.lock"
        descriptor = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.f.watcher()
        with patch.object(installer, "stop_idle_watcher") as stop:
            with self.assertRaisesRegex(installer.QuoteUpdateError, "handling work"):
                self.f.run()
            stop.assert_not_called()
        self.f.assert_old(self)

    def test_active_creator_and_nonstandard_watcher_refuse_installation(self):
        self.f.watcher(script="nexvia_create.py")
        with self.assertRaisesRegex(installer.QuoteUpdateError, "creation process is active"):
            self.f.run()
        self.f.assert_old(self)

    def test_idle_watcher_is_stopped_only_inside_work_lock_then_restarted(self):
        identity = self.f.watcher()

        def stop(root, proc, actual):
            self.assertEqual(actual, identity)
            descriptor = os.open(self.f.journal / ".bridge.lock", os.O_RDWR)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(descriptor)
            self.f.remove_process(actual)

        with patch.object(installer, "stop_idle_watcher", side_effect=stop):
            self.assertTrue(self.f.run()["quoteEnabled"])
        self.assertEqual(len(self.f.launched), 1)

    def test_drift_after_idle_stop_cannot_restart_unknown_original_code(self):
        self.f.watcher()

        def changed(root, proc, identity):
            self.f.remove_process(identity)
            (self.f.root / "nexvia_create.py").write_bytes(b"# late user source edit\n")

        with patch.object(installer, "stop_idle_watcher", side_effect=changed):
            with self.assertRaises(installer.RollbackError):
                self.f.run()
        self.assertEqual((self.f.root / "nexvia_create.py").read_bytes(), b"# late user source edit\n")
        self.assertEqual(self.f.checked, [])
        self.assertEqual(self.f.launched, [])

    def test_write_failure_restores_all_original_bytes_modes_and_config(self):
        before = self.f.config.read_bytes()
        write = installer.atomic_write
        failed = False

        def interrupted(path, data, mode):
            nonlocal failed
            if path.name == "nexvia_create.py" and not failed:
                failed = True
                raise OSError("synthetic write failure")
            return write(path, data, mode)

        with patch.object(installer, "atomic_write", side_effect=interrupted):
            with self.assertRaisesRegex(installer.QuoteUpdateError, "original modules were restored"):
                self.f.run()
        self.f.assert_old(self)
        self.assertEqual(self.f.config.read_bytes(), before)
        self.assertEqual((self.f.root / "nexvia_requests.py").stat().st_mode & 0o777, 0o755)
        self.assertEqual(self.f.launched, [])

    def test_config_changed_during_check_is_preserved_and_modules_rolled_back(self):
        external = {**json.loads(self.f.config.read_bytes()), "enabled": False}

        def changed(*args, **kwargs):
            self.f.config.write_text(json.dumps(external))
            return True

        with self.assertRaisesRegex(installer.QuoteUpdateError, "configuration changed"):
            self.f.run(checker=changed)
        self.f.assert_old(self)
        self.assertEqual(json.loads(self.f.config.read_bytes()), external)

    def test_installed_code_drift_cannot_enable_claims_or_launch_unknown_code(self):
        before = self.f.config.read_bytes()

        def changed(*args, **kwargs):
            (self.f.root / "nexvia_create.py").write_bytes(b"# local edit during check\n")
            return True

        with self.assertRaises(installer.RollbackError):
            self.f.run(checker=changed)
        self.assertEqual(self.f.config.read_bytes(), before)
        self.assertEqual((self.f.root / "nexvia_create.py").read_bytes(), b"# local edit during check\n")
        self.assertEqual(self.f.launched, [])

    def test_installed_mode_drift_refuses_even_when_native_check_fails(self):
        def changed(*args, **kwargs):
            (self.f.root / "nexvia_create.py").chmod(0o666)
            return False

        with self.assertRaisesRegex(installer.QuoteUpdateError, "module changed"):
            self.f.run(checker=changed)
        self.f.assert_old(self)
        self.assertNotIn("quoteEnabled", json.loads(self.f.config.read_bytes()))
        self.assertEqual(self.f.launched, [])

    def test_parser_drift_does_not_restart_previous_watcher_with_unknown_dependency(self):
        self.f.watcher()
        before = self.f.config.read_bytes()

        def changed(*args, **kwargs):
            self.f.parser.write_bytes(b"# unknown parser edit")
            return True

        with patch.object(installer, "stop_idle_watcher",
                          side_effect=lambda root, proc, identity: self.f.remove_process(identity)):
            with self.assertRaisesRegex(installer.RollbackError, "PDF parser changed"):
                self.f.run(checker=changed)
        self.f.assert_old(self)
        self.assertEqual(self.f.parser.read_bytes(), b"# unknown parser edit")
        self.assertEqual(self.f.config.read_bytes(), before)
        self.assertEqual(self.f.launched, [])

    def test_missing_wrong_or_symlink_parser_cannot_authorize_update(self):
        self.f.parser.write_bytes(b"wrong parser")
        with self.assertRaisesRegex(installer.QuoteUpdateError, "different version"):
            self.f.run()
        self.f.assert_old(self)

    def test_unbundled_tampered_or_unexpected_file_bundle_is_rejected(self):
        for bundle in ["", "invalid", fixture_bundle({**self.f.new, "extra.py": b"# no\n"}),
                       fixture_bundle({**self.f.new, "nexvia_create.py": b"not python syntax !!!"})]:
            with self.subTest(bundle=bundle[:10]):
                with patch.object(installer, "BUNDLE_BASE64", bundle):
                    with self.assertRaises(installer.QuoteUpdateError):
                        self.f.run()
                self.f.assert_old(self)

    def test_native_preflight_requires_fresh_private_exact_identity_and_action_free_report(self):
        def invoke(arguments, **kwargs):
            self.assertEqual(kwargs["stdout"], subprocess.DEVNULL)
            self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
            report = self.f.root / installer.REPORT_NAME
            value = {"format": "nexvia-quote-upload-check", "version": 1, "capabilityVersion": 1,
                     "nativeUploadReady": True, "readOnly": True, "uploadOrSaveInvoked": False,
                     "fileSelectionInvoked": False,
                     "projectPageId": 60, "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413"}
            value.update(overrides)
            report.write_text(json.dumps(value))
            report.chmod(0o600)
            return SimpleNamespace(returncode=0)

        overrides = {}
        with patch.object(installer.subprocess, "run", side_effect=invoke):
            self.assertTrue(installer.native_preflight(self.f.root, self.f.root / "nexvia-tools/bin/python",
                                                       60, 1421, "PO7413", supplier_name="Bunnings"))
            for overrides in [{"purchaseOrderId": 1422}, {"readOnly": False}, {"uploadOrSaveInvoked": True},
                              {"fileSelectionInvoked": True}, {"capabilityVersion": 2}, {"nativeUploadReady": False}]:
                self.assertFalse(installer.native_preflight(self.f.root, self.f.root / "nexvia-tools/bin/python",
                                                            60, 1421, "PO7413", supplier_name="Bunnings"))
        with patch.object(installer.subprocess, "run", return_value=SimpleNamespace(returncode=0)):
            self.assertFalse(installer.native_preflight(self.f.root, self.f.root / "nexvia-tools/bin/python",
                                                        60, 1421, "PO7413", supplier_name="Bunnings"))

    def test_builder_reproduces_nine_exact_sources_and_never_installs_during_packaging(self):
        source = Path(installer.__file__).read_text()
        source_root = self.f.root / "build"
        source_root.mkdir()
        (source_root / "install_nexvia_quote_update.py").write_text(source)
        for name, raw in self.f.new.items():
            (source_root / name).write_bytes(raw)
        output = self.f.root / "installer.py"
        checksum, size = builder.build(output, source_root)
        self.assertEqual(checksum, hashlib.sha256(output.read_bytes()).hexdigest())
        self.assertEqual(size, output.stat().st_size)
        namespace = {"__name__": "test_packaged_quote_installer"}
        exec(compile(output.read_bytes(), str(output), "exec"), namespace)
        self.assertEqual(namespace["decoded_payload"](), self.f.new)
        self.f.assert_old(self)


if __name__ == "__main__":
    unittest.main()
