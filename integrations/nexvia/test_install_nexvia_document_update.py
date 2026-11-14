import base64
from contextlib import redirect_stdout
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch
import zipfile

import install_nexvia_document_update as installer


OLD = b"# synthetic deployed bridge\n"
NEW = b"# synthetic document bridge\n"
MODULE = b"# synthetic isolated document capture\n"
PRIOR_BRIDGE = b"# synthetic released document bridge\n"
PRIOR_CAPTURE = b"# synthetic released capture before explicit directory permissions\n"


def packaged_fixture():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as wheel:
        wheel.writestr("pypdf/__init__.py", "# synthetic parser\n")
    parser = stream.getvalue()
    files = {"nexvia_requests.py": NEW, "nexvia_po_document.py": MODULE,
             "nexvia-po-vendor/pypdf.whl": parser}
    bundle = {name: {"sha256": hashlib.sha256(data).hexdigest(),
                     "contentBase64": base64.b64encode(data).decode()}
              for name, data in files.items()}
    return files, base64.b64encode(json.dumps(bundle).encode()).decode(), parser


class Fixture:
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.proc = self.root / "proc"
        self.proc.mkdir()
        self.target = self.root / "nexvia_requests.py"
        self.target.write_bytes(OLD)
        self.target.chmod(0o755)
        tools = self.root / "nexvia-tools/bin"
        tools.mkdir(parents=True)
        (tools / "python").symlink_to("/usr/bin/python3")
        self.journal = self.root / "panelstock-request-journal"
        self.journal.mkdir(mode=0o700)
        (self.journal / "sent.json").write_bytes(b"private immutable journal")
        self.config = self.root / "panelstock-requests.json"
        self.config.write_bytes(b'{"enabled":true,"creationEnabled":true,"token":"synthetic-only","workerId":"synthetic-id","extra":{"saved":true}}')
        self.config.chmod(0o600)
        self.requests = self.root / "nexvia-requests"
        self.requests.mkdir()
        (self.requests / "saved-result.json").write_bytes(b"immutable verified result")
        self.launched = []
        self.checks = []
        self.success = True

    def launch(self, *args):
        self.launched.append(args)

    def checker(self, *args):
        self.checks.append(args)
        return self.success

    def run(self, **overrides):
        options = {"launch": self.launch, "checker": self.checker}
        options.update(overrides)
        return installer.install(self.root, self.proc, **options)

    def watcher(self, pid=9001, script="nexvia_requests.py", args=None):
        directory = self.proc / str(pid)
        directory.mkdir()
        if args is None:
            args = [str(self.root / "nexvia-tools/bin/python"), "-u", str(self.root / script), "--watch"]
        (directory / "cmdline").write_bytes(b"\0".join(a.encode() for a in args) + b"\0")
        (directory / "stat").write_text(str(pid) + " (python test) S " + "0 " * 18 + "1234 0")
        return installer.process_identity(self.proc, pid)

    def remove_process(self, identity):
        for path in (self.proc / str(identity[0])).iterdir():
            path.unlink()
        (self.proc / str(identity[0])).rmdir()

    def close(self):
        self.temporary.cleanup()


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.files, bundle, parser = packaged_fixture()
        self.addCleanup(patch.stopall)
        patch.object(installer, "BUNDLE_BASE64", bundle).start()
        patch.object(installer, "OLD_BRIDGE_SHA256", hashlib.sha256(OLD).hexdigest()).start()
        patch.object(installer, "PYPDF_SHA256", hashlib.sha256(parser).hexdigest()).start()
        patch.object(installer, "PRIOR_CAPTURE_SHA256", {hashlib.sha256(PRIOR_CAPTURE).hexdigest()}).start()
        patch.object(installer, "PRIOR_DOCUMENT_BRIDGE_SHA256", hashlib.sha256(PRIOR_BRIDGE).hexdigest()).start()

    def prior_release(self, *, enabled=False, bridge=PRIOR_BRIDGE, capture=PRIOR_CAPTURE, parser=True):
        self.f.target.write_bytes(bridge)
        module = self.f.root / "nexvia_po_document.py"
        module.write_bytes(capture)
        module.chmod(0o750)
        vendor = self.f.root / "nexvia-po-vendor"
        vendor.mkdir(mode=0o700)
        if parser:
            (vendor / "pypdf.whl").write_bytes(self.files["nexvia-po-vendor/pypdf.whl"])
        if enabled:
            config = json.loads(self.f.config.read_bytes())
            config["documentEnabled"] = True
            self.f.config.write_text(json.dumps(config))

    def test_known_prior_release_upgrades_and_retains_existing_enabled_pending_work(self):
        self.prior_release(enabled=True)
        old_config = self.f.config.read_bytes()
        original_backup = self.f.root / "nexvia_requests.before-document-update.py"
        installer.atomic_write(original_backup, OLD, 0o600)
        self.f.success = False
        result = self.f.run()
        self.assertTrue(result["documentEnabled"])
        self.assertFalse(result["documentVerified"])
        self.assertEqual(self.f.config.read_bytes(), old_config)
        self.assertEqual(self.f.target.read_bytes(), NEW)
        self.assertEqual((self.f.root / "nexvia_po_document.py").read_bytes(), MODULE)
        self.assertEqual((self.f.root / "nexvia_po_document.py").stat().st_mode & 0o777, 0o750)
        self.assertEqual((self.f.root / "nexvia_po_document.before-permissions-update.py").read_bytes(), PRIOR_CAPTURE)
        self.assertEqual((self.f.root / "nexvia_requests.before-permissions-update.py").read_bytes(), PRIOR_BRIDGE)
        self.assertEqual(original_backup.read_bytes(), OLD)
        self.assertEqual((self.f.root / "nexvia_po_document.before-permissions-update.py").stat().st_mode & 0o777, 0o600)

    def test_known_prior_release_failed_check_cannot_enable_new_capability(self):
        self.prior_release()
        old_config = self.f.config.read_bytes()
        self.f.success = False
        result = self.f.run()
        self.assertFalse(result["documentEnabled"])
        self.assertEqual(self.f.config.read_bytes(), old_config)
        self.assertEqual(self.f.target.read_bytes(), NEW)
        self.assertEqual((self.f.root / "nexvia_po_document.py").read_bytes(), MODULE)

    def test_known_prior_release_successful_check_can_enable_capability(self):
        self.prior_release()
        self.assertTrue(self.f.run()["documentEnabled"])
        self.assertTrue(json.loads(self.f.config.read_bytes())["documentEnabled"])

    def test_old_speed_bridge_or_mixed_release_cannot_retain_unverified_enabled_flag(self):
        for bridge, capture, parser in ((OLD, PRIOR_CAPTURE, True),
                                        (NEW, PRIOR_CAPTURE, True),
                                        (PRIOR_BRIDGE, MODULE, True),
                                        (PRIOR_BRIDGE, PRIOR_CAPTURE, False)):
            with self.subTest(bridge=bridge, capture=capture, parser=parser):
                self.prior_release(enabled=True, bridge=bridge, capture=capture, parser=parser)
                config = self.f.config.read_bytes()
                with self.assertRaisesRegex(installer.DocumentUpdateError, "unverified document setting"):
                    self.f.run()
                self.assertEqual(self.f.config.read_bytes(), config)
                self.assertEqual(self.f.target.read_bytes(), bridge)
                self.assertEqual(self.f.checks, [])
                (self.f.root / "nexvia_po_document.py").unlink()
                (self.f.root / "nexvia-po-vendor/pypdf.whl").unlink(missing_ok=True)
                (self.f.root / "nexvia-po-vendor").rmdir()

    def test_unknown_capture_edits_are_not_accepted_as_a_released_upgrade(self):
        self.prior_release(capture=b"# arbitrary local capture change\n")
        with self.assertRaisesRegex(installer.DocumentUpdateError, "local changes"):
            self.f.run()
        self.assertEqual(self.f.target.read_bytes(), PRIOR_BRIDGE)
        self.assertEqual(self.f.checks, [])

    def test_prior_capture_update_write_failure_restores_its_original_bytes_and_mode(self):
        self.prior_release()
        config = self.f.config.read_bytes()
        write = installer.atomic_write

        def broken(path, data, mode):
            write(path, data, mode)
            if path.name == "nexvia_po_document.py" and data == MODULE:
                raise OSError("synthetic failure after upgrading capture module")

        with patch.object(installer, "atomic_write", side_effect=broken):
            with self.assertRaisesRegex(installer.DocumentUpdateError, "original files were restored"):
                self.f.run()
        self.assertEqual(self.f.target.read_bytes(), PRIOR_BRIDGE)
        self.assertEqual((self.f.root / "nexvia_po_document.py").read_bytes(), PRIOR_CAPTURE)
        self.assertEqual((self.f.root / "nexvia_po_document.py").stat().st_mode & 0o777, 0o750)
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(self.f.launched, [])

    def test_new_vendor_and_backup_permissions_are_explicit_when_creation_mode_is_ignored(self):
        mkdir = Path.mkdir
        original_open = os.open

        def inherited_mkdir(path, mode=0o777, parents=False, exist_ok=False):
            mkdir(path, mode=0o755, parents=parents, exist_ok=exist_ok)
            if path.name == "nexvia-po-vendor":
                path.chmod(0o755)

        def inherited_open(path, flags, mode=0o777, **kwargs):
            descriptor = original_open(path, flags, mode, **kwargs)
            if flags & os.O_EXCL and str(path).endswith("before-document-update.json"):
                os.fchmod(descriptor, 0o644)
            return descriptor

        with patch.object(Path, "mkdir", inherited_mkdir), patch.object(installer.os, "open", side_effect=inherited_open):
            self.f.run()
        self.assertEqual((self.f.root / "nexvia-po-vendor").stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.f.root / "panelstock-requests.before-document-update.json").stat().st_mode & 0o777, 0o600)

    def test_bundle_is_checked_and_source_template_cannot_install(self):
        self.assertEqual(installer.decoded_payload(), self.files)
        with patch.object(installer, "BUNDLE_BASE64", ""):
            with self.assertRaisesRegex(installer.DocumentUpdateError, "source template"):
                self.f.run()
        with patch.object(installer, "PYPDF_SHA256", "0" * 64):
            with self.assertRaisesRegex(installer.DocumentUpdateError, "parser version"):
                self.f.run()
        self.assertEqual(self.f.target.read_bytes(), OLD)
        self.assertEqual(self.f.launched, [])

    def test_success_enables_only_after_check_preserves_identity_and_results(self):
        config = self.f.config.read_bytes()
        original = json.loads(config)
        result = self.f.run()
        self.assertTrue(result["documentEnabled"])
        self.assertTrue(result["documentVerified"])
        self.assertEqual(self.f.target.read_bytes(), NEW)
        self.assertEqual(self.f.target.stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.f.root / "nexvia_po_document.py").read_bytes(), MODULE)
        for name in ("nexvia_requests.before-document-update.py", "panelstock-requests.before-document-update.json"):
            self.assertEqual((self.f.root / name).stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.f.root / "panelstock-requests.before-document-update.json").read_bytes(), config)
        updated = json.loads(self.f.config.read_bytes())
        self.assertEqual(updated, dict(original, documentEnabled=True))
        self.assertEqual(self.f.config.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.f.journal / "sent.json").read_bytes(), b"private immutable journal")
        self.assertEqual((self.f.requests / "saved-result.json").read_bytes(), b"immutable verified result")
        self.assertEqual(len(self.f.checks), 1)
        self.assertFalse(self.f.run()["updated"])
        self.assertEqual(len(self.f.launched), 2)

    def test_failed_check_keeps_legacy_configuration_bytes_and_mode(self):
        config = self.f.config.read_bytes()
        self.f.success = False
        result = self.f.run()
        self.assertFalse(result["documentEnabled"])
        self.assertFalse(result["documentVerified"])
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(self.f.config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.f.target.read_bytes(), NEW)
        self.assertEqual(len(self.f.launched), 1)
        self.assertFalse((self.f.root / "panelstock-requests.before-document-update.json").exists())

    def test_unknown_preexisting_enabled_capability_cannot_bypass_capture_check(self):
        data = json.loads(self.f.config.read_bytes())
        data["documentEnabled"] = True
        self.f.config.write_text(json.dumps(data))
        with self.assertRaisesRegex(installer.DocumentUpdateError, "unverified document setting"):
            self.f.run()
        self.assertEqual(self.f.target.read_bytes(), OLD)
        self.assertEqual(self.f.checks, [])

    def test_rerun_does_not_disable_existing_managed_work_on_transient_check_failure(self):
        self.f.run()
        config = self.f.config.read_bytes()
        self.f.success = False
        result = self.f.run()
        self.assertTrue(result["documentEnabled"])
        self.assertFalse(result["documentVerified"])
        self.assertEqual(self.f.config.read_bytes(), config)

    def test_active_work_refuses_before_stopping_or_creating_files(self):
        with open(self.f.journal / ".bridge.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(installer, "stop_idle_watcher") as stop:
                with self.assertRaisesRegex(installer.DocumentUpdateError, "handling work"):
                    self.f.run()
                stop.assert_not_called()
        self.assertEqual(self.f.target.read_bytes(), OLD)
        self.assertEqual(self.f.checks, [])
        self.assertFalse((self.f.root / "nexvia-po-vendor").exists())

    def test_unknown_version_symlink_destination_or_parser_directory_refuses(self):
        self.f.target.write_bytes(b"# local edits")
        with self.assertRaisesRegex(installer.DocumentUpdateError, "different version"):
            self.f.run()
        self.f.target.write_bytes(OLD)
        (self.f.root / "nexvia_po_document.py").symlink_to(self.f.config)
        with self.assertRaisesRegex(installer.DocumentUpdateError, "unexpected type"):
            self.f.run()
        (self.f.root / "nexvia_po_document.py").unlink()
        (self.f.root / "nexvia-po-vendor").symlink_to(self.f.requests)
        with self.assertRaisesRegex(installer.DocumentUpdateError, "parser directory"):
            self.f.run()
        self.assertEqual(self.f.launched, [])

    def test_creator_and_multiple_watchers_are_never_interrupted(self):
        identity = self.f.watcher(script="nexvia_create.py")
        with patch.object(installer, "stop_idle_watcher") as stop:
            with self.assertRaisesRegex(installer.DocumentUpdateError, "creation process"):
                self.f.run()
            stop.assert_not_called()
        self.f.remove_process(identity)
        self.f.watcher()
        self.f.watcher(pid=9002)
        with self.assertRaisesRegex(installer.DocumentUpdateError, "More than one"):
            self.f.run()
        self.assertEqual(self.f.target.read_bytes(), OLD)

    def test_check_runs_under_both_locks_and_restart_happens_after_unlock(self):
        observed = self.f.watcher()
        events = []

        def stop(root, proc, identity):
            self.assertEqual(identity, observed)
            events.append("stop")
            self.f.remove_process(identity)

        def checker(*args):
            events.append("check")
            for path in (self.f.journal / ".bridge.lock", self.f.root / "panelstock-requests-watch.lock"):
                with open(path, "r+") as lock:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True

        def launch(*args):
            events.append("launch")
            for path in (self.f.journal / ".bridge.lock", self.f.root / "panelstock-requests-watch.lock"):
                with open(path, "r+") as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

        with patch.object(installer, "stop_idle_watcher", side_effect=stop):
            self.f.run(checker=checker, launch=launch)
        self.assertEqual(events, ["stop", "check", "launch"])

    def test_partial_write_failure_rolls_back_scripts_and_restarts_original(self):
        observed = self.f.watcher()
        write = installer.atomic_write
        config = self.f.config.read_bytes()

        def broken(path, data, mode):
            write(path, data, mode)
            if path.name == "nexvia_po_document.py":
                raise OSError("synthetic failure after replace")

        with patch.object(installer, "stop_idle_watcher", side_effect=lambda r, p, i: self.f.remove_process(i)), \
                patch.object(installer, "atomic_write", side_effect=broken):
            with self.assertRaisesRegex(installer.DocumentUpdateError, "original files were restored"):
                self.f.run()
        self.assertEqual(self.f.target.read_bytes(), OLD)
        self.assertEqual(self.f.target.stat().st_mode & 0o777, 0o755)
        self.assertFalse((self.f.root / "nexvia_po_document.py").exists())
        self.assertFalse((self.f.root / "nexvia-po-vendor").exists())
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(len(self.f.launched), 1)

    def test_failed_rollback_never_restarts_uncertain_bridge(self):
        observed = self.f.watcher()
        with patch.object(installer, "stop_idle_watcher", side_effect=lambda r, p, i: self.f.remove_process(i)), \
                patch.object(installer, "atomic_write", side_effect=OSError("synthetic double failure")):
            with self.assertRaises(installer.RollbackError):
                self.f.run()
        self.assertEqual(self.f.launched, [])

    def test_changed_config_during_capture_does_not_get_overwritten(self):
        updated = b'{"enabled":false,"creationEnabled":false,"token":"new-synthetic-only"}'

        def checker(*args):
            self.f.config.write_bytes(updated)
            return True

        with self.assertRaisesRegex(installer.DocumentUpdateError, "configuration changed"):
            self.f.run(checker=checker)
        self.assertEqual(self.f.config.read_bytes(), updated)
        self.assertEqual(self.f.target.read_bytes(), OLD)
        self.assertFalse((self.f.root / "nexvia_po_document.py").exists())

    def test_failed_capture_with_changed_config_rolls_back_without_overwriting_user_changes(self):
        updated = b'{"enabled":true,"creationEnabled":true,"documentEnabled":true,"workerId":"changed-synthetic-id","token":"changed-synthetic-token"}'

        def checker(*args):
            self.f.config.write_bytes(updated)
            return False

        with self.assertRaisesRegex(installer.DocumentUpdateError, "configuration changed"):
            self.f.run(checker=checker)
        self.assertEqual(self.f.config.read_bytes(), updated)
        self.assertEqual(self.f.target.read_bytes(), OLD)
        self.assertFalse((self.f.root / "nexvia_po_document.py").exists())
        self.assertFalse((self.f.root / "nexvia-po-vendor").exists())
        self.assertEqual(self.f.launched, [])

    def test_private_config_and_invalid_boolean_fail_closed(self):
        self.f.config.chmod(0o644)
        with self.assertRaisesRegex(installer.DocumentUpdateError, "private bridge configuration"):
            self.f.run()
        self.f.config.chmod(0o600)
        self.f.config.write_text('{"enabled":true,"creationEnabled":true,"documentEnabled":"true"}')
        with self.assertRaisesRegex(installer.DocumentUpdateError, "configuration is invalid"):
            self.f.run()
        self.assertEqual(self.f.checks, [])

    def diagnostic_report(self, **changes):
        value = {"format": "nexvia-po-document-check", "version": 1,
                 "documentVerified": False, "projectPageId": 60,
                 "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413",
                 "status": "gcs-download-unavailable", "stage": "capture",
                 "otherPrivateDetail": "https://private.example.test/?Signature=private-synthetic-only"}
        value.update(changes)
        installer.atomic_write(self.f.root / "nexvia-po-document-check.json", json.dumps(value).encode(), 0o600)

    def test_failed_check_prints_only_allowlisted_status_and_stage(self):
        config = self.f.config.read_bytes()

        def checker(*args):
            self.diagnostic_report()
            return False

        result = self.f.run(checker=checker)
        self.assertFalse(result["documentEnabled"])
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(result["checkStatus"], "gcs-download-unavailable")
        self.assertEqual(result["checkStage"], "capture")
        output = io.StringIO()
        with patch.object(installer, "install", return_value=result), redirect_stdout(output):
            installer.main([])
        self.assertIn("Check status: gcs-download-unavailable", output.getvalue())
        self.assertIn("Check stage: capture", output.getvalue())
        self.assertNotIn("private.example", output.getvalue())
        self.assertNotIn("Signature", output.getvalue())
        self.assertNotIn("private-synthetic-only", output.getvalue())

    def test_wrong_po_identity_and_unknown_secret_diagnostics_are_never_printed(self):
        cases = ({"projectPageId": 59}, {"purchaseOrderId": 9999},
                 {"purchaseOrderNumber": "PO9999"}, {"documentVerified": True},
                 {"status": "private-synthetic-token-and-error", "stage": "https://private.example.test/token"})
        for changes in cases:
            with self.subTest(changes=changes):
                self.diagnostic_report(**changes)
                diagnostic = installer.capture_diagnostic(self.f.root, 60, 1421, "PO7413")
                self.assertEqual(diagnostic, {"checkStatus": "check-unavailable", "checkStage": "check-unavailable"})
                result = dict(diagnostic, documentEnabled=False, documentVerified=False)
                output = io.StringIO()
                with patch.object(installer, "install", return_value=result), redirect_stdout(output):
                    installer.main([])
                self.assertIn("Check status: check-unavailable", output.getvalue())
                self.assertNotIn("gcs-download-unavailable", output.getvalue())
                self.assertNotIn("private-synthetic", output.getvalue())
                self.assertNotIn("private.example", output.getvalue())

    def test_candidate_failure_prints_first_allowlisted_reason_without_private_values(self):
        def checker(*args):
            self.diagnostic_report(status="official-pdf-not-verified", candidateFailures=[
                "https://private.example.test/?Signature=synthetic-secret", {"error": "synthetic-secret"},
                "pdf-project-mismatch", "gcs-content-type-mismatch"])
            return False

        result = self.f.run(checker=checker)
        self.assertEqual(result["checkReason"], "pdf-project-mismatch")
        self.assertFalse(result["documentEnabled"])
        output = io.StringIO()
        with patch.object(installer, "install", return_value=result), redirect_stdout(output):
            installer.main([])
        self.assertIn("Check reason: pdf-project-mismatch", output.getvalue())
        self.assertNotIn("synthetic-secret", output.getvalue())
        self.assertNotIn("private.example", output.getvalue())
        self.assertNotIn("gcs-content-type-mismatch", output.getvalue())

    def test_unknown_nonlist_or_wrong_identity_candidate_reasons_are_omitted(self):
        cases = ({"candidateFailures": "pdf-project-mismatch"},
                 {"candidateFailures": ["synthetic-secret", {"error": "synthetic-secret"}]},
                 {"candidateFailures": ["pdf-project-mismatch"], "purchaseOrderId": 9999},
                 {"candidateFailures": ["pdf-project-mismatch"], "status": "capture-unavailable"})
        for changes in cases:
            with self.subTest(changes=changes):
                fields = dict(status="official-pdf-not-verified")
                fields.update(changes)
                self.diagnostic_report(**fields)
                diagnostic = installer.capture_diagnostic(self.f.root, 60, 1421, "PO7413")
                self.assertNotIn("checkReason", diagnostic)
                result = dict(diagnostic, documentEnabled=False, documentVerified=False)
                output = io.StringIO()
                with patch.object(installer, "install", return_value=result), redirect_stdout(output):
                    installer.main([])
                self.assertNotIn("Check reason:", output.getvalue())
                self.assertNotIn("synthetic-secret", output.getvalue())
                self.assertNotIn("pdf-project-mismatch", output.getvalue())

    def test_unavailable_or_nonprivate_diagnostic_report_has_fixed_fallback(self):
        fallback = {"checkStatus": "check-unavailable", "checkStage": "check-unavailable"}
        self.assertEqual(installer.capture_diagnostic(self.f.root, 60, 1421, "PO7413"), fallback)
        self.diagnostic_report()
        (self.f.root / "nexvia-po-document-check.json").chmod(0o644)
        self.assertEqual(installer.capture_diagnostic(self.f.root, 60, 1421, "PO7413"), fallback)
        (self.f.root / "nexvia-po-document-check.json").chmod(0o600)
        (self.f.root / "nexvia-po-document-check.json").write_bytes(b"private invalid JSON synthetic-only")
        self.assertEqual(installer.capture_diagnostic(self.f.root, 60, 1421, "PO7413"), fallback)

    def test_optional_supplier_is_passed_to_checker_without_bypassing_failed_validation(self):
        supplier = "Example & Co (Qld) 'quoted' $value; --other-option"
        config = self.f.config.read_bytes()
        calls = []

        def checker(*args, **kwargs):
            calls.append((args, kwargs))
            return False

        result = self.f.run(check_supplier=supplier, checker=checker)
        self.assertEqual(len(calls[0][0]), 5)
        self.assertEqual(calls[0][1], {"supplier_name": supplier})
        self.assertFalse(result["documentVerified"])
        self.assertFalse(result["documentEnabled"])
        self.assertEqual(self.f.config.read_bytes(), config)

    def test_optional_supplier_rejects_empty_oversized_or_control_text_before_installing(self):
        config = self.f.config.read_bytes()
        for supplier in ("", "   ", "x" * 501, "Company\nName", "Company\tName", "Company\x00Name",
                         "Company\x7fName", "Company\x85Name", "Company\u200bName", 12, {}, []):
            with self.subTest(supplier=repr(supplier)):
                with self.assertRaisesRegex(installer.DocumentUpdateError, "supplier name"):
                    self.f.run(check_supplier=supplier)
                self.assertEqual(self.f.target.read_bytes(), OLD)
                self.assertEqual(self.f.config.read_bytes(), config)
                self.assertEqual(self.f.checks, [])
        self.assertEqual(installer.supplier_for_check("x" * 500), "x" * 500)

    def test_supplier_argument_special_characters_are_data_in_a_real_subprocess(self):
        marker = self.f.root / "must-not-execute"
        supplier = "Example & Co '$value' $(touch " + str(marker) + "); `touch " + str(marker) + "` --bad=1"
        source = '''import argparse
import json
import os
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--check',action='store_true')
p.add_argument('--project',type=int)
p.add_argument('--po',type=int)
p.add_argument('--number')
p.add_argument('--output')
p.add_argument('--supplier-name')
a=p.parse_args()
Path(__file__).with_name('received-supplier').write_text(a.supplier_name)
value={'documentVerified':True,'projectPageId':a.project,'purchaseOrderId':a.po,'purchaseOrderNumber':a.number}
fd=os.open(a.output,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as output:json.dump(value,output)
'''
        (self.f.root / "nexvia_po_document.py").write_text(source)
        self.assertTrue(installer.capture_check(self.f.root, Path(sys.executable), 60, 1421, "PO7413",
                                               supplier_name=supplier))
        self.assertEqual((self.f.root / "received-supplier").read_text(), supplier)
        self.assertFalse(marker.exists())

    def test_cli_passes_optional_supplier_without_printing_the_name(self):
        supplier = "Private Supplier & Co 'quoted'"
        result = {"documentEnabled": False, "documentVerified": False,
                  "checkStatus": "check-unavailable", "checkStage": "check-unavailable"}
        output = io.StringIO()
        with patch.object(installer, "install", return_value=result) as install, redirect_stdout(output):
            installer.main(["--check-supplier", supplier])
        self.assertEqual(install.call_args.kwargs["check_supplier"], supplier)
        self.assertNotIn(supplier, output.getvalue())

    def test_capture_subprocess_never_prints_private_output_and_requires_full_identity(self):
        report = self.f.root / "nexvia-po-document-check.json"
        data = {"documentVerified": True, "projectPageId": 60,
                "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413"}
        def generated_report(*args, **kwargs):
            installer.atomic_write(report, json.dumps(data).encode(), 0o600)
            return type("Result", (), {"returncode": 0})()

        with patch.object(installer.subprocess, "run", side_effect=generated_report) as run:
            self.assertTrue(installer.capture_check(self.f.root, Path("/python"), 60, 1421, "PO7413"))
            self.assertEqual(run.call_args.kwargs["stdout"], installer.subprocess.DEVNULL)
            self.assertEqual(run.call_args.kwargs["stderr"], installer.subprocess.DEVNULL)
            self.assertIn("--check", run.call_args.args[0])
            self.assertIn("--output", run.call_args.args[0])
            data["purchaseOrderNumber"] = "PO9999"
            self.assertFalse(installer.capture_check(self.f.root, Path("/python"), 60, 1421, "PO7413"))
        data["purchaseOrderNumber"] = "PO7413"
        installer.atomic_write(report, json.dumps(data).encode(), 0o600)
        with patch.object(installer.subprocess, "run", return_value=type("Result", (), {"returncode": 0})()):
            self.assertFalse(installer.capture_check(self.f.root, Path("/python"), 60, 1421, "PO7413"))
        with patch.object(installer.subprocess, "run", side_effect=installer.subprocess.TimeoutExpired("synthetic-only", 90)):
            self.assertFalse(installer.capture_check(self.f.root, Path("/python"), 60, 1421, "PO7413"))


if __name__ == "__main__":
    unittest.main()
