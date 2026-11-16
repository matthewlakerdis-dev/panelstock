"""Exercise the policy-v2 updater against an already installed policy-v1 bridge."""

import fcntl
import hashlib
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import build_quote_policy_v2_installer as builder
import install_nexvia_quote_policy_update_v2 as installer
import test_install_nexvia_quote_policy_update as shared


DEPLOYED_SHA256 = dict(installer.PRIOR_SHA256)


class QuotePolicyV2InstallerTests(unittest.TestCase):
    def setUp(self):
        # Reuse the original fixture and unchanged lock/evidence/native-check
        # regressions against this independent v2 installer, without changing v1.
        for name, value in (("installer", installer), ("builder", builder)):
            replacement = patch.object(shared, name, value)
            self.addCleanup(replacement.stop)
            replacement.start()
        shared.QuotePolicyInstallerTests.setUp(self)
        # Legacy publication fixtures contain opaque historic JSON. Binding of
        # genuine v1/v2 diagnostics has its own private-file regression suite.
        evidence = patch.object(installer, "observed_policy_evidence", return_value={"syntheticFixture": True})
        self.addCleanup(evidence.stop)
        evidence.start()

    native_request = shared.QuotePolicyInstallerTests.native_request

    def test_baseline_pins_match_the_exact_immutable_installed_v1_release(self):
        path = Path(__file__).parent / "releases/install_nexvia_quote_policy_update_v1.py"
        raw = path.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),
                         "c5eadeae4c853afa0846c27080233f81eb47c796ddfc5371003fc01f57312227")
        namespace = {"__name__": "read_only_v1_baseline_validation"}
        exec(compile(raw, str(path), "exec"), namespace)
        for name, data in namespace["decoded_payload"]().items():
            self.assertEqual(DEPLOYED_SHA256[name], hashlib.sha256(data).hexdigest())
        self.assertEqual(installer.FILES, {"nexvia_quote_attachment.py", "nexvia_preparation_diagnostics.py"})
        self.assertEqual(installer.NEW_FILES, set())

    def test_two_existing_modules_update_without_new_file_publication_and_preserve_v1_backup(self):
        original_config, evidence = self.f.config.read_bytes(), self.f.evidence()
        first_backup = self.f.root / "nexvia-backup-before-quote-policy-update"
        first_backup.mkdir(mode=0o700)
        (first_backup / "original-q.py").write_bytes(b"original v1 backup must remain unchanged")
        retained = {name: (self.f.root / name).read_bytes() for name in self.f.old if name not in installer.FILES}
        with patch.object(installer, "atomic_add", side_effect=AssertionError("both targets already exist")):
            self.assertTrue(self.f.run()["contractsVerified"])
        self.assertEqual({name: (self.f.root / name).read_bytes() for name in retained}, retained)
        self.assertEqual(self.f.config.read_bytes(), original_config)
        self.assertEqual(self.f.evidence(), evidence)
        self.assertEqual((first_backup / "original-q.py").read_bytes(), b"original v1 backup must remain unchanged")
        backup = self.f.root / "nexvia-backup-before-quote-policy-v2-update"
        expected = {name: self.f.old[name] for name in installer.FILES}
        expected["panelstock-requests.json"] = original_config
        self.assertEqual({path.name: path.read_bytes() for path in backup.iterdir()}, expected)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in backup.iterdir()))

    def test_exact_rerun_preserves_the_original_v2_backup(self):
        self.f.run()
        backup = self.f.root / "nexvia-backup-before-quote-policy-v2-update"
        before = {path.name: path.read_bytes() for path in backup.iterdir()}
        self.assertFalse(self.f.run()["updated"])
        self.assertEqual({path.name: path.read_bytes() for path in backup.iterdir()}, before)

    def test_missing_existing_helper_and_each_partial_pair_refuse_before_stopping(self):
        helper = self.f.root / "nexvia_preparation_diagnostics.py"
        helper.unlink()
        with patch.object(installer, "stop_idle_watcher") as stop:
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "local changes"):
                self.f.run()
            stop.assert_not_called()
        for selected in sorted(installer.FILES):
            with self.subTest(selected=selected):
                for name in installer.FILES:
                    (self.f.root / name).write_bytes(self.f.new[name] if name == selected else self.f.old[name])
                before = {name: (self.f.root / name).read_bytes() for name in installer.FILES}
                with patch.object(installer, "stop_idle_watcher") as stop:
                    with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "local changes"):
                        self.f.run()
                    stop.assert_not_called()
                self.assertEqual({name: (self.f.root / name).read_bytes() for name in installer.FILES}, before)

    def test_publication_failure_restores_both_existing_modules_and_restarts_only_prior_watcher(self):
        for failed in sorted(installer.FILES):
            with self.subTest(failed=failed):
                fixture = shared.Fixture()
                self.addCleanup(fixture.temporary.cleanup)
                fixture.watcher()
                evidence, config = fixture.evidence(), fixture.config.read_bytes()
                real_write, interrupted = installer.atomic_write, False
                def write(path, raw, mode):
                    nonlocal interrupted
                    real_write(path, raw, mode)
                    if path.name == failed and not interrupted:
                        interrupted = True
                        raise OSError("synthetic failure after publication")
                with patch.object(installer, "atomic_write", side_effect=write), \
                        patch.object(installer, "stop_idle_watcher", side_effect=fixture.stop):
                    with self.assertRaisesRegex(installer.QuotePolicyUpdateError, "original modules were restored"):
                        fixture.run()
                fixture.assert_old(self)
                self.assertEqual(fixture.evidence(), evidence)
                self.assertEqual(fixture.config.read_bytes(), config)
                self.assertEqual(len(fixture.launched), 1)

    def test_optional_compatibility_check_still_precedes_all_v2_changes_and_is_not_retry_authority(self):
        self.f.watcher()
        evidence = self.f.evidence()
        events = []
        def native(root, python, files, identifier, *, bridge_lock_fd):
            events.append("read-only-compatibility")
            self.assertEqual(files, self.f.new)
            self.f.assert_old(self)
            self.assertTrue((self.f.proc / "9001").exists())
            self.assertFalse((root / "nexvia-backup-before-quote-policy-v2-update").exists())
            self.assertEqual(self.f.evidence(), evidence)
            return True
        def stop(*args):
            events.append("stop")
            self.f.stop(*args)
        with patch.object(installer, "stop_idle_watcher", side_effect=stop):
            self.assertTrue(self.f.run(check_request=shared.REQUEST, native_checker=native)["nativeUploaderVerified"])
        self.assertEqual(events, ["read-only-compatibility", "stop"])
        self.assertEqual(self.f.evidence(), evidence)

    def test_import_only_preflight_requires_callback_binding_api_without_invoking_it(self):
        (self.f.root / "nexvia_requests.py").write_text(
            "SNAPSHOT_REFRESH_SECONDS=86400\nREFERENCE_CACHE_VERSION=1\nWATCH_IDLE_SECONDS=2\n"
            "REVIEW_VERSION=1\nREVIEW_RESULT_PATH='/integrations/nexvia/request-review-result'\n"
            "def invoke_preparer(*args, **kwargs): raise AssertionError('must not invoke')\n")
        (self.f.root / "nexvia_form_data.py").write_text("MAX_SNAPSHOT_AGE=2592000\n")
        (self.f.root / "nexvia_projects.py").write_text("REFRESH_SECONDS=86400\nRETRY_SECONDS=900\n")
        (self.f.root / "nexvia_create.py").write_text(
            "def prepare(*args, **kwargs): raise AssertionError('must not prepare')\n"
            "def submit(*args, **kwargs): raise AssertionError('must not submit')\n")
        (self.f.root / "nexvia_reviews.py").write_text(
            "REVIEW_VERSION=1\n"
            "def assess_review(*args, **kwargs): raise AssertionError('must not assess')\n"
            "def service_pending_reviews(*args, **kwargs): raise AssertionError('must not report')\n")
        quote = self.f.new["nexvia_quote_attachment.py"] + (
            "BLANK_DRAFT_GUARD_VERSION=5\nPOLICY_UPLOAD_GUARD_VERSION=1\n"
            "def upload_quote(*args, native_snapshot=None, **kwargs): raise AssertionError('must not upload')\n"
            "def validate_native_draft(*args, native_snapshot=None, **kwargs): raise AssertionError('must not inspect')\n"
            "def validate_policy_response(raw, endpoint, metadata, acl, allowed):\n"
            " import json,base64\n"
            " value=json.loads(raw)\n"
            " return [{'pdf':True,'fields':value,'conditions':json.loads(base64.b64decode(value['policy']))['conditions']}]\n").encode()
        (self.f.root / "nexvia_quote_attachment.py").write_bytes(quote)
        helper = self.f.root / "nexvia_preparation_diagnostics.py"
        source = "DIAGNOSTICS_VERSION=1\n" + "".join(
            "def " + name + "(*args, **kwargs): raise AssertionError('must not run diagnostics')\n"
            for name in ("preparation_diagnostics", "bind_callback", "stage", "failure", "transport", "route_event", "failure_message"))
        helper.write_text(source)
        descriptor = os.open(self.f.journal / ".bridge.lock", os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        arguments = (self.f.root, self.f.root / "nexvia-tools/bin/python")
        evidence = self.f.evidence()
        self.assertTrue(installer.preflight(*arguments, bridge_lock_fd=descriptor))
        for invalid in (source.replace("def bind_callback(", "def missing_callback("),
                        source.replace("def bind_callback(*args, **kwargs)", "def bind_callback(callback, required_extra)")):
            helper.write_text(invalid)
            self.assertFalse(installer.preflight(*arguments, bridge_lock_fd=descriptor))
        self.assertEqual(self.f.evidence(), evidence)
        self.assertFalse(list(self.f.root.rglob("__pycache__")))

    def test_builder_only_bundles_two_exact_sources_and_refuses_unpinned_policy(self):
        source_root = self.f.root / "v2-build"
        source_root.mkdir()
        (source_root / "install_nexvia_quote_policy_update_v2.py").write_text(Path(installer.__file__).read_text())
        for name, raw in self.f.new.items():
            (source_root / name).write_bytes(raw)
        output = self.f.root / "fixture-v2-release.py"
        checksum, size = builder.build(output, source_root)
        namespace = {"__name__": "v2_fixture_payload_validation"}
        exec(compile(output.read_bytes(), str(output), "exec"), namespace)
        self.assertEqual(namespace["decoded_payload"](), self.f.new)
        self.assertEqual(builder.build(self.f.root / "second-fixture-v2.py", source_root), (checksum, size))
        original = output.read_bytes()
        target = source_root / "nexvia_quote_attachment.py"
        target.write_bytes(self.f.new[target.name].replace(("'" + "a" * 64 + "'").encode(), b"''"))
        with self.assertRaisesRegex(ValueError, "policy pins"):
            builder.build(output, source_root)
        self.assertEqual(output.read_bytes(), original)


for _name in (
    "test_failed_contract_check_rolls_back_and_restarts_only_known_prior_watcher",
    "test_unknown_payload_and_incompatible_dependency_versions_refuse_before_stopping_or_checking",
    "test_work_lock_prevents_stopping_active_bridge",
    "test_default_bridge_lock_wait_retries_before_stopping_only_an_idle_watcher",
    "test_contract_check_receives_real_exclusive_work_lock",
    "test_active_creator_refuses_installation",
    "test_reference_cache_mutation_during_preflight_blocks_restart",
    "test_code_drift_during_check_is_not_overwritten_or_started",
    "test_preflight_request_mutation_or_new_result_blocks_restart",
    "test_late_external_config_edit_is_preserved_and_blocks_restart",
    "test_parser_drift_blocks_automatic_restart",
    "test_invalid_bundle_and_source_or_history_symlinks_refuse_without_mutation",
    "test_native_subprocess_response_requires_exact_bound_read_only_success",
    "test_native_route_guard_blocks_writes_policy_registration_and_gcs_before_native_handler",
    "test_native_inspection_only_calls_validation_and_pure_normalizer_with_fixed_failure_stages",
    "test_native_check_requires_canonical_uuid_before_inspecting_or_stopping",
    "test_main_passes_the_optional_native_check_and_reports_compatibility_only",
):
    setattr(QuotePolicyV2InstallerTests, _name, getattr(shared.QuotePolicyInstallerTests, _name))


if __name__ == "__main__":
    unittest.main()
