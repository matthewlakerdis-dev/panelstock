import base64
import fcntl
import hashlib
from itertools import combinations
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import build_quote_policy_installer as builder
import install_nexvia_quote_policy_update as installer


REQUEST = "bbdadaff-35de-4bab-9680-403a989e454c"


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
        self.old = {name: ("# deployed quote and verification release " + name + "\n").encode()
                    for name in installer.PRIOR_SHA256}
        self.new = {name: ("# quote policy and diagnostics patch " + name + "\n").encode()
                    for name in installer.FILES}
        self.new["nexvia_quote_attachment.py"] += (
            "POLICY_SEND_SHA256 = '" + "a" * 64 + "'\n"
            "POLICY_OPERATION_SHA256 = '" + "b" * 64 + "'\n").encode()
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
        self.record = self.journal / ("request-" + REQUEST + ".json")
        self.record.write_bytes(b"immutable terminal outbound and claim")
        self.record.chmod(0o600)
        self.request = self.root / "nexvia-requests" / REQUEST
        self.request.mkdir(mode=0o700, parents=True)
        for name in ("request.json", "nexvia-prepared.json", "nexvia-create-attempt.json",
                     "nexvia-create-response.html", "nexvia-result.json",
                     "nexvia-supplier-quote.pdf", "nexvia-purchase-order.pdf"):
            (self.request / name).write_bytes(("immutable " + name).encode())
            (self.request / name).chmod(0o600)
        for name in ("documents", "quotes", "reconciliations"):
            directory = self.journal / name
            directory.mkdir(mode=0o700)
            (directory / "existing.json").write_bytes(b"original quote/document/email evidence")
            (directory / "existing.json").chmod(0o600)
        self.prior_backup = self.root / "nexvia-backup-before-quote-draft-v5-update"
        self.prior_backup.mkdir(mode=0o700)
        (self.prior_backup / "original.txt").write_bytes(b"original guard-5 backup")
        self.review_backup = self.root / "nexvia-backup-before-review-update"
        self.review_backup.mkdir(mode=0o700)
        (self.review_backup / "original.txt").write_bytes(b"original review backup")
        self.config = self.root / "panelstock-requests.json"
        self.config.write_bytes(b'{"enabled":true,"creationEnabled":true,"documentEnabled":true,"quoteEnabled":true,"token":"synthetic-private","workerId":"synthetic-worker","extra":{"unchanged":true}}')
        self.config.chmod(0o600)
        self.caches = {}
        for name in installer.CACHE_FILES:
            raw = ("saved complete cache " + name).encode()
            (self.root / name).write_bytes(raw)
            self.caches[name] = raw
        self.success = True
        self.checked, self.launched = [], []

    def checker(self, *args, **kwargs):
        self.checked.append((args, kwargs))
        os.fstat(kwargs["bridge_lock_fd"])
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

    def evidence(self):
        return {str(path.relative_to(self.root)): path.read_bytes()
                for base in (self.root / "nexvia-requests", self.journal)
                for path in base.rglob("*") if path.is_file() and path.name != ".bridge.lock"}

    def assert_old(self, test):
        for name, raw in self.old.items():
            test.assertEqual((self.root / name).read_bytes(), raw)
        for name in installer.NEW_FILES:
            test.assertFalse((self.root / name).exists())


class QuotePolicyInstallerTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.temporary.cleanup)
        self.addCleanup(patch.stopall)
        patch.object(installer, "BUNDLE_BASE64", bundled(self.f.new)).start()
        patch.object(installer, "PRIOR_SHA256", {name: hashlib.sha256(raw).hexdigest()
                                               for name, raw in self.f.old.items()}).start()
        patch.object(installer, "PYPDF_SHA256", hashlib.sha256(self.f.parser.read_bytes()).hexdigest()).start()

    def test_narrow_patch_preserves_config_all_request_quote_document_evidence_and_other_modules(self):
        config, evidence = self.f.config.read_bytes(), self.f.evidence()
        self.assertTrue(self.f.run()["contractsVerified"])
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(self.f.evidence(), evidence)
        for name, raw in self.f.caches.items():
            self.assertEqual((self.f.root / name).read_bytes(), raw)
        for name, raw in self.f.new.items():
            self.assertEqual((self.f.root / name).read_bytes(), raw)
        for name, raw in self.f.old.items():
            if name not in self.f.new:
                self.assertEqual((self.f.root / name).read_bytes(), raw)
        self.assertEqual((self.f.prior_backup / "original.txt").read_bytes(), b"original guard-5 backup")
        self.assertEqual((self.f.review_backup / "original.txt").read_bytes(), b"original review backup")
        backup = self.f.root / "nexvia-backup-before-quote-policy-update"
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual({path.name for path in backup.iterdir()},
                         {"nexvia_requests.py", "nexvia_create.py", "nexvia_quote_attachment.py",
                          "nexvia_preparation_diagnostics.py.absent", "panelstock-requests.json"})
        self.assertEqual((backup / "nexvia_preparation_diagnostics.py.absent").read_bytes(),
                         b"Absent before quote policy update: nexvia_preparation_diagnostics.py\n")
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in backup.iterdir()))
        self.assertEqual((backup / "panelstock-requests.json").read_bytes(), config)
        self.assertEqual((self.f.root / "nexvia_requests.py").stat().st_mode & 0o777, 0o755)

    def test_failed_contract_check_rolls_back_and_restarts_only_known_prior_watcher(self):
        self.f.success = False
        config, evidence = self.f.config.read_bytes(), self.f.evidence()
        self.f.watcher()
        with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "contracts could not be verified"):
                self.f.run()
        self.f.assert_old(self)
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(self.f.evidence(), evidence)
        self.assertEqual(len(self.f.checked), 1)
        self.assertEqual(len(self.f.launched), 1)

    def test_current_patch_rerun_keeps_original_private_backup(self):
        self.f.run()
        backup = self.f.root / "nexvia-backup-before-quote-policy-update"
        before = {path.name: path.read_bytes() for path in backup.iterdir()}
        self.assertFalse(self.f.run()["updated"])
        self.assertEqual({path.name: path.read_bytes() for path in backup.iterdir()}, before)

    def test_unknown_payload_and_incompatible_dependency_versions_refuse_before_stopping_or_checking(self):
        for name, raw in [("nexvia_create.py", b"# local edit\n"),
                          ("nexvia_requests.py", b"# incompatible worker\n"),
                          ("nexvia_quote_attachment.py", b"# unknown quote guard\n"),
                          ("nexvia_reviews.py", b"# unexpected review dependency\n")]:
            path = self.f.root / name
            path.write_bytes(raw)
            with patch.object(installer, "stop_idle_watcher") as stop:
                with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "local changes"):
                    self.f.run()
                stop.assert_not_called()
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual(self.f.checked, [])
            path.write_bytes(self.f.old[name])

    def test_work_lock_prevents_stopping_active_bridge(self):
        descriptor = os.open(self.f.journal / ".bridge.lock", os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.f.watcher()
        with patch.object(installer, "stop_idle_watcher") as stop, \
                patch.object(installer.time, "monotonic", side_effect=[0, 31]):
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "handling work"):
                self.f.run()
            stop.assert_not_called()
        self.f.assert_old(self)

    def test_default_bridge_lock_wait_retries_before_stopping_only_an_idle_watcher(self):
        self.assertEqual(installer.BRIDGE_WAIT_SECONDS, 30)
        self.f.watcher()
        real_flock = installer.fcntl.flock
        events, attempts, delays = [], 0, []
        def delayed_lock(descriptor, operation):
            nonlocal attempts
            if operation == fcntl.LOCK_EX | fcntl.LOCK_NB:
                attempts += 1
                events.append('lock')
                if attempts <= 2:
                    raise BlockingIOError('busy while the original work finishes')
            return real_flock(descriptor, operation)
        def stopped(*args):
            events.append('stop')
            self.f.stop(*args)
        with patch.object(installer.fcntl, "flock", side_effect=delayed_lock), \
                patch.object(installer.time, "monotonic", return_value=100), \
                patch.object(installer.time, "sleep", side_effect=delays.append), \
                patch.object(installer, "stop_idle_watcher", side_effect=stopped):
            self.assertTrue(self.f.run()['contractsVerified'])
        self.assertEqual(events[:4], ['lock', 'lock', 'lock', 'stop'])
        self.assertEqual(delays, [0.1, 0.1])
        self.assertEqual(len(self.f.launched), 1)

    def test_contract_check_receives_real_exclusive_work_lock(self):
        def checking(*args, bridge_lock_fd):
            info = os.fstat(bridge_lock_fd)
            self.assertEqual(info.st_mode & 0o777, 0o600)
            self.assertEqual(info.st_ino, (self.f.journal / ".bridge.lock").stat().st_ino)
            fresh = os.open(self.f.journal / ".bridge.lock", os.O_RDWR)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(fresh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(fresh)
            return True
        self.assertTrue(self.f.run(checker=checking)["contractsVerified"])

    def test_active_creator_refuses_installation(self):
        self.f.watcher(script="nexvia_create.py")
        with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "creation process is active"):
            self.f.run()
        self.f.assert_old(self)

    def test_write_failure_rolls_back_modules_without_touching_request_evidence(self):
        config, evidence = self.f.config.read_bytes(), self.f.evidence()
        write, failed = installer.atomic_write, False
        def interrupted(path, raw, mode):
            nonlocal failed
            if path.name == "nexvia_requests.py" and not failed:
                failed = True
                raise OSError("synthetic failure")
            return write(path, raw, mode)
        with patch.object(installer, "atomic_write", side_effect=interrupted):
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "original modules were restored"):
                self.f.run()
        self.f.assert_old(self)
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(self.f.evidence(), evidence)

    def test_unknown_existing_new_module_refuses_without_overwriting_or_stopping(self):
        path = self.f.root / "nexvia_preparation_diagnostics.py"
        path.write_bytes(b"# an unrelated local module\n")
        with patch.object(installer, "stop_idle_watcher") as stop:
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "local changes"):
                self.f.run()
            stop.assert_not_called()
        self.assertEqual(path.read_bytes(), b"# an unrelated local module\n")
        self.assertEqual(self.f.checked, [])

    def test_every_partial_exact_patch_refuses_until_all_four_modules_match(self):
        files = sorted(installer.FILES)
        for size in range(1, len(files)):
            for selected in combinations(files, size):
                with self.subTest(selected=selected):
                    for name in files:
                        path = self.f.root / name
                        if name in self.f.old:
                            path.write_bytes(self.f.old[name])
                        else:
                            path.unlink(missing_ok=True)
                    for name in selected:
                        (self.f.root / name).write_bytes(self.f.new[name])
                    before = {name: (self.f.root / name).read_bytes()
                              for name in files if (self.f.root / name).exists()}
                    with patch.object(installer, "stop_idle_watcher") as stop:
                        with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "local changes"):
                            self.f.run()
                        stop.assert_not_called()
                    self.assertEqual({name: (self.f.root / name).read_bytes()
                                      for name in files if (self.f.root / name).exists()}, before)

    def test_new_module_publication_failure_rolls_back_owned_file_and_watcher(self):
        real_sync = installer.sync_directory
        failed = False
        def interrupted(path):
            nonlocal failed
            if not failed:
                failed = True
                raise OSError("synthetic directory sync failure after publish")
            return real_sync(path)
        evidence, config = self.f.evidence(), self.f.config.read_bytes()
        with patch.object(installer, "sync_directory", side_effect=interrupted):
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "original modules were restored"):
                self.f.run()
        self.f.assert_old(self)
        self.assertEqual(self.f.evidence(), evidence)
        self.assertEqual(self.f.config.read_bytes(), config)

    def test_concurrent_new_module_is_not_owned_and_is_never_deleted(self):
        target = self.f.root / "nexvia_preparation_diagnostics.py"
        real_add = installer.atomic_add
        def external(path, raw, mode, owned):
            path.write_bytes(b"# unexpected concurrent module\n")
            return real_add(path, raw, mode, owned)
        self.f.watcher()
        with patch.object(installer, "atomic_add", side_effect=external), \
                patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError):
                self.f.run()
        self.assertEqual(target.read_bytes(), b"# unexpected concurrent module\n")
        self.assertEqual(self.f.launched, [])

    def test_changed_or_replaced_added_module_blocks_deletion_and_restart(self):
        target = self.f.root / "nexvia_preparation_diagnostics.py"
        for change in ("contents", "replacement", "unlink-and-recreate"):
            with self.subTest(change=change):
                if target.exists():
                    target.unlink()
                for name, raw in self.f.old.items():
                    (self.f.root / name).write_bytes(raw)
                self.f.watcher()
                def drift(*args, **kwargs):
                    if change == "replacement":
                        replacement = self.f.root / "external-replacement.py"
                        replacement.write_bytes(self.f.new["nexvia_preparation_diagnostics.py"])
                        # Bytes and mode must match so only inode ownership can
                        # detect replacement, independently of the runner umask.
                        replacement.chmod(0o644)
                        os.replace(replacement, target)
                    elif change == "unlink-and-recreate":
                        target.unlink()
                        target.write_bytes(self.f.new["nexvia_preparation_diagnostics.py"])
                        target.chmod(0o644)
                    else:
                        target.write_bytes(b"# modified after publication\n")
                    return True
                with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
                    with self.assertRaises(installer.RollbackError):
                        self.f.run(checker=drift)
                self.assertTrue(target.exists())
                self.assertEqual(self.f.launched, [])

    def test_added_module_descriptor_remains_open_through_restart_and_closes_on_every_exit(self):
        for outcome in ("success", "failed-check", "changed-module", "launch-failure"):
            with self.subTest(outcome=outcome):
                fixture = Fixture()
                self.addCleanup(fixture.temporary.cleanup)
                descriptors = []
                real_add = installer.atomic_add
                def capture(path, raw, mode, owned):
                    real_add(path, raw, mode, owned)
                    descriptors.append(owned[path.name][2])
                def check_open():
                    self.assertEqual(len(descriptors), 1)
                    descriptor = descriptors[0]
                    os.fstat(descriptor)
                    self.assertFalse(os.get_inheritable(descriptor))
                def checking(*args, **kwargs):
                    check_open()
                    if outcome == "changed-module":
                        path = fixture.root / "nexvia_preparation_diagnostics.py"
                        path.unlink()
                        path.write_bytes(fixture.new[path.name])
                        path.chmod(0o644)
                        # The held original inode cannot be reused by this path.
                        self.assertEqual(os.fstat(descriptors[0]).st_nlink, 0)
                        self.assertNotEqual(os.fstat(descriptors[0]).st_ino, path.stat().st_ino)
                    return outcome != "failed-check"
                def launch(*args):
                    check_open()
                    if outcome == "launch-failure":
                        raise OSError("synthetic launch failure")
                    fixture.launch(*args)
                fixture.watcher()
                with patch.object(installer, "atomic_add", side_effect=capture), \
                        patch.object(installer, "stop_idle_watcher", side_effect=fixture.stop):
                    if outcome == "success":
                        fixture.run(checker=checking, launch=launch)
                    elif outcome == "launch-failure":
                        with self.assertRaises(OSError):
                            fixture.run(checker=checking, launch=launch)
                    else:
                        error = installer.RollbackError if outcome == "changed-module" else installer.QuotePolicyUpdateError
                        with self.assertRaises(error):
                            fixture.run(checker=checking, launch=launch)
                self.assertEqual(len(descriptors), 1)
                with self.assertRaises(OSError):
                    os.fstat(descriptors[0])

    def test_atomic_add_closes_unpublished_descriptor_when_target_already_exists(self):
        target = self.f.root / "nexvia_preparation_diagnostics.py"
        target.write_bytes(b"# concurrent file\n")
        duplicated, owned = [], {}
        real_dup = os.dup
        def duplicate(descriptor):
            retained = real_dup(descriptor)
            duplicated.append(retained)
            return retained
        with patch.object(installer.os, "dup", side_effect=duplicate):
            with self.assertRaises(FileExistsError):
                installer.atomic_add(target, self.f.new[target.name], 0o644, owned)
        self.assertEqual(owned, {})
        self.assertEqual(target.read_bytes(), b"# concurrent file\n")
        self.assertEqual(len(duplicated), 1)
        with self.assertRaises(OSError):
            os.fstat(duplicated[0])

    def test_reference_cache_mutation_during_preflight_blocks_restart(self):
        self.f.watcher()
        cache = self.f.root / installer.CACHE_FILES[0]
        def drift(*args, **kwargs):
            cache.write_bytes(b"unexpected cache replacement")
            return True
        with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError):
                self.f.run(checker=drift)
        self.assertEqual(cache.read_bytes(), b"unexpected cache replacement")
        self.assertEqual(self.f.launched, [])

    def test_code_drift_during_check_is_not_overwritten_or_started(self):
        self.f.watcher()
        def changed(*args, **kwargs):
            (self.f.root / "nexvia_requests.py").write_bytes(b"# unknown concurrent edit\n")
            return True
        with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError):
                self.f.run(checker=changed)
        self.assertEqual((self.f.root / "nexvia_requests.py").read_bytes(), b"# unknown concurrent edit\n")
        self.assertEqual(self.f.launched, [])

    def test_preflight_request_mutation_or_new_result_blocks_restart(self):
        for name in ("request.json", "unexpected-result.json"):
            with self.subTest(name=name):
                path = self.f.request / name
                previous = path.read_bytes() if path.exists() else None
                self.f.watcher()
                def changed(*args, **kwargs):
                    path.write_bytes(b"unexpected request write")
                    path.chmod(0o600)
                    return True
                with patch.object(installer, "stop_idle_watcher", side_effect=self.f.stop):
                    with self.assertRaises(installer.RollbackError):
                        self.f.run(checker=changed)
                self.assertEqual(self.f.launched, [])
                self.f.assert_old(self)
                if previous is None:
                    path.unlink()
                else:
                    path.write_bytes(previous)

    def test_late_external_config_edit_is_preserved_and_blocks_restart(self):
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

    def test_preflight_rejects_actionful_or_ambiguous_contract_response(self):
        descriptor = os.open(self.f.journal / ".bridge.lock", os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, descriptor)
        value = {"format": "nexvia-quote-policy-contract-check", "version": 1,
                 "contractsVerified": True, "readOnly": True,
                 "poCreated": False, "poChanged": False, "fileUploaded": False, "emailSent": False}
        overrides = {}
        def invoke(args, **kwargs):
            self.assertIn("-B", args)
            self.assertIn("-I", args)
            self.assertEqual(kwargs["pass_fds"], (descriptor,))
            self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
            return SimpleNamespace(returncode=0, stdout=json.dumps({**value, **overrides}).encode())
        args = (self.f.root, self.f.root / "nexvia-tools/bin/python")
        with patch.object(installer.subprocess, "run", side_effect=invoke):
            self.assertTrue(installer.preflight(*args, bridge_lock_fd=descriptor))
            for overrides in ({"poCreated": True}, {"poChanged": True}, {"fileUploaded": True},
                              {"emailSent": True}, {"readOnly": False}, {"extra": True}):
                self.assertFalse(installer.preflight(*args, bridge_lock_fd=descriptor))

    def test_real_import_preflight_uses_no_historic_po_or_network_and_leaves_no_bytecode(self):
        (self.f.root / "nexvia_requests.py").write_text(
            "SNAPSHOT_REFRESH_SECONDS=86400\nREFERENCE_CACHE_VERSION=1\nWATCH_IDLE_SECONDS=2\n"
            "REVIEW_VERSION=1\nREVIEW_RESULT_PATH='/integrations/nexvia/request-review-result'\n"
            "def invoke_preparer(*args, **kwargs): raise AssertionError('must not invoke preparer')\n")
        (self.f.root / "nexvia_form_data.py").write_text("MAX_SNAPSHOT_AGE=2592000\n")
        (self.f.root / "nexvia_projects.py").write_text("REFRESH_SECONDS=86400\nRETRY_SECONDS=900\n")
        (self.f.root / "nexvia_create.py").write_text(
            "def prepare(*args, **kwargs): raise AssertionError('must not prepare')\n"
            "def submit(*args, **kwargs): raise AssertionError('must not submit')\n")
        quote_source = (
            "BLANK_DRAFT_GUARD_VERSION=5\nPOLICY_UPLOAD_GUARD_VERSION=1\n"
            "POLICY_SEND_SHA256 = '" + "a" * 64 + "'\n"
            "POLICY_OPERATION_SHA256 = '" + "b" * 64 + "'\n"
            "def upload_quote(*args, native_snapshot=None, **kwargs): raise AssertionError('must not upload')\n"
            "def validate_native_draft(*args, native_snapshot=None, **kwargs): raise AssertionError('must not inspect live')\n")
        (self.f.root / "nexvia_quote_attachment.py").write_text(quote_source)
        (self.f.root / "nexvia_reviews.py").write_text(
            "REVIEW_VERSION=1\n"
            "def assess_review(*args, **kwargs): raise AssertionError('must not assess')\n"
            "def service_pending_reviews(*args, **kwargs): raise AssertionError('must not report')\n")
        (self.f.root / "nexvia_preparation_diagnostics.py").write_text(
            "DIAGNOSTICS_VERSION=1\n"
            "def preparation_diagnostics(*args, **kwargs): raise AssertionError('must not record')\n"
            "def stage(*args, **kwargs): raise AssertionError('must not emit')\n"
            "def failure(*args, **kwargs): raise AssertionError('must not emit')\n"
            "def transport(*args, **kwargs): raise AssertionError('must not emit')\n"
            "def route_event(*args, **kwargs): raise AssertionError('must not emit')\n"
            "def failure_message(*args, **kwargs): raise AssertionError('must not inspect')\n")
        descriptor = os.open(self.f.journal / ".bridge.lock", os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        args = (self.f.root, self.f.root / "nexvia-tools/bin/python")
        before = self.f.evidence()
        self.assertTrue(installer.preflight(*args, bridge_lock_fd=descriptor))
        self.assertEqual(self.f.evidence(), before)
        self.assertFalse((self.f.root / "__pycache__").exists())
        diagnostic_path = self.f.root / "nexvia_preparation_diagnostics.py"
        diagnostic_source = diagnostic_path.read_text()
        for name, invalid in (
            ("nexvia_quote_attachment.py", quote_source.replace("VERSION=5", "VERSION=4")),
            ("nexvia_quote_attachment.py", quote_source.replace("POLICY_UPLOAD_GUARD_VERSION=1", "POLICY_UPLOAD_GUARD_VERSION=0")),
            (diagnostic_path.name, diagnostic_source.replace("DIAGNOSTICS_VERSION=1", "DIAGNOSTICS_VERSION=0")),
            (diagnostic_path.name, diagnostic_source.replace("def route_event(*args, **kwargs)", "def route_event(route_class, method)")),
            (diagnostic_path.name, diagnostic_source.replace("def failure_message(", "def unknown_message(")),
            *[("nexvia_quote_attachment.py", quote_source.replace(
                pin + " = '" + valid * 64 + "'", pin + " = " + repr(invalid)))
              for pin, valid in (("POLICY_SEND_SHA256", "a"), ("POLICY_OPERATION_SHA256", "b"))
              for invalid in ("", "a" * 63, "a" * 65, "A" * 64, "g" * 64, None, 123)],
        ):
            with self.subTest(contract=name, invalid=invalid):
                path = self.f.root / name
                original = path.read_text()
                try:
                    path.write_text(invalid)
                    self.assertFalse(installer.preflight(*args, bridge_lock_fd=descriptor))
                finally:
                    path.write_text(original)
        self.assertEqual(self.f.evidence(), before)
        self.assertFalse((self.f.root / "__pycache__").exists())

    def test_placeholder_policy_sources_cannot_be_installed_or_packaged(self):
        source_root = self.f.root / "invalid-build"
        source_root.mkdir()
        (source_root / "install_nexvia_quote_policy_update.py").write_text(Path(installer.__file__).read_text())
        output = self.f.root / "unchanged-release.py"
        output.write_bytes(b"existing release must not be replaced")
        for pin, value in (("POLICY_SEND_SHA256", "a"), ("POLICY_OPERATION_SHA256", "b")):
            assignment = pin + " = '" + value * 64 + "'"
            for invalid in ("", "x" * 64, "A" * 64, "a" * 63, None, 123):
                with self.subTest(pin=pin, invalid=invalid):
                    files = dict(self.f.new)
                    files["nexvia_quote_attachment.py"] = files["nexvia_quote_attachment.py"].replace(
                        assignment.encode(), (pin + " = " + repr(invalid)).encode())
                    with patch.object(installer, "BUNDLE_BASE64", bundled(files)), \
                            patch.object(installer, "stop_idle_watcher") as stop:
                        with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "policy callback pins"):
                            self.f.run()
                        stop.assert_not_called()
                    self.f.assert_old(self)
                    self.assertEqual(self.f.checked, [])
                    for name, raw in files.items():
                        (source_root / name).write_bytes(raw)
                    with self.assertRaisesRegex(ValueError, "policy pins"):
                        builder.build(output, source_root)
                    self.assertEqual(output.read_bytes(), b"existing release must not be replaced")
        valid_source = self.f.new["nexvia_quote_attachment.py"]
        for invalid in (valid_source + b"POLICY_SEND_SHA256 = '" + b"a" * 64 + b"'\n",
                        valid_source.replace(b"POLICY_SEND_SHA256 = '" + b"a" * 64 + b"'", b"POLICY_SEND_SHA256 = 'a' * 64")):
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "policy callback pins"):
                installer.check_policy_source(invalid)

    def test_invalid_bundle_and_source_or_history_symlinks_refuse_without_mutation(self):
        with patch.object(installer, "BUNDLE_BASE64", ""):
            with self.assertRaises(installer.QuotePolicyUpdateError):
                self.f.run()
        target = self.f.root / "nexvia_create.py"
        target.unlink()
        target.symlink_to(self.f.root / "nexvia_requests.py")
        with self.assertRaises(installer.QuotePolicyUpdateError):
            self.f.run()
        target.unlink()
        target.write_bytes(self.f.old["nexvia_create.py"])
        (self.f.request / "linked.pdf").symlink_to(self.f.config)
        with self.assertRaises(installer.QuotePolicyUpdateError):
            self.f.run()
        self.assertEqual(self.f.checked, [])
        self.f.assert_old(self)

    def test_builder_contains_only_four_exact_reviewed_policy_sources(self):
        self.assertEqual(installer.FILES, {"nexvia_requests.py", "nexvia_create.py",
                                          "nexvia_quote_attachment.py", "nexvia_preparation_diagnostics.py"})
        source_root = self.f.root / "build"
        source_root.mkdir()
        (source_root / "install_nexvia_quote_policy_update.py").write_text(Path(installer.__file__).read_text())
        for name, raw in self.f.new.items():
            (source_root / name).write_bytes(raw)
        output = self.f.root / "release.py"
        checksum, size = builder.build(output, source_root)
        self.assertEqual(checksum, hashlib.sha256(output.read_bytes()).hexdigest())
        self.assertEqual(size, output.stat().st_size)
        second = self.f.root / "second-release.py"
        self.assertEqual(builder.build(second, source_root), (checksum, size))
        self.assertEqual(second.read_bytes(), output.read_bytes())
        namespace = {"__name__": "quote_policy_release_test"}
        exec(compile(output.read_bytes(), str(output), "exec"), namespace)
        self.assertEqual(namespace["decoded_payload"](), self.f.new)
        self.f.assert_old(self)


if __name__ == "__main__":
    unittest.main()
