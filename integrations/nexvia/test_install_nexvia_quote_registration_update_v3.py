"""Publication, rollback and exact-v2 baseline for the registration-v3 updater."""
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import build_quote_registration_v3_installer as builder
import install_nexvia_quote_registration_update_v3 as installer
import test_install_nexvia_quote_policy_update as shared


DEPLOYED = dict(installer.PRIOR_SHA256)
NEW_HELPER = 'nexvia_quote_registration.py'


class RegistrationV3InstallerTests(unittest.TestCase):
    def setUp(self):
        for name, value in (('installer', installer), ('builder', builder)):
            bound = patch.object(shared, name, value)
            self.addCleanup(bound.stop)
            bound.start()
        self.f = shared.Fixture()
        self.addCleanup(self.f.temporary.cleanup)
        self.f.new[NEW_HELPER] += (
            "DONE_SOURCE_SHA256='" + installer.REGISTRATION_DONE_SHA256 + "'\n"
            "SEND_SOURCE_SHA256='96bfef70560ed8611fb07bbc0321d5d7dbbdf8b938dd08c4f92438398d3b4b16'\n"
            "PREFIX_SHA256='" + installer.REGISTRATION_PREFIX_SHA256 + "'\n"
            "QUERY_SHA256='e6eaea18e885e1078829b56df34896be5ab51439e8f0ba00cb1624b2c572c10e'\n").encode()
        for name, value in (('BUNDLE_BASE64', shared.bundled(self.f.new)),
                            ('PRIOR_SHA256', {key: hashlib.sha256(raw).hexdigest() for key, raw in self.f.old.items()}),
                            ('PYPDF_SHA256', hashlib.sha256(self.f.parser.read_bytes()).hexdigest()),
                            ('observed_registration_evidence', lambda *args: {'syntheticFixture': True})):
            bound = patch.object(installer, name, value)
            self.addCleanup(bound.stop)
            bound.start()

    def test_baseline_matches_the_immutable_installed_v2_release(self):
        path = Path(__file__).parent / 'releases/install_nexvia_quote_policy_update_v2.py'
        raw = path.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'b004a575f290c8438d90716729594f57d466242640d4d4568be22e0c918f7bf7')
        namespace = {'__name__': 'v2_baseline_read_only'}
        exec(compile(raw, str(path), 'exec'), namespace)
        for name, source in namespace['decoded_payload']().items():
            self.assertEqual(DEPLOYED[name], hashlib.sha256(source).hexdigest())
        self.assertEqual(installer.FILES, {'nexvia_quote_attachment.py', NEW_HELPER})
        self.assertEqual(installer.NEW_FILES, {NEW_HELPER})
        self.assertEqual(DEPLOYED['nexvia_preparation_diagnostics.py'], '9a146254aa66f3b33c3ad4780f95e8fa2c61f006772fc403128d02e4f0a2328e')

    def test_new_helper_backup_absence_marker_and_exact_rerun_preserve_all_existing_records(self):
        config, evidence = self.f.config.read_bytes(), self.f.evidence()
        kept = {name: (self.f.root/name).read_bytes() for name in self.f.old if name not in installer.FILES}
        self.assertTrue(self.f.run()['updated'])
        self.assertEqual({name:(self.f.root/name).read_bytes() for name in kept}, kept)
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(self.f.evidence(), evidence)
        backup = self.f.root / 'nexvia-backup-before-quote-registration-v3-update'
        self.assertEqual(set(path.name for path in backup.iterdir()), {'panelstock-requests.json','nexvia_quote_attachment.py',NEW_HELPER+'.absent'})
        before = {path.name:path.read_bytes() for path in backup.iterdir()}
        self.assertEqual(before[NEW_HELPER+'.absent'], ('Absent before quote registration update: '+NEW_HELPER+'\n').encode())
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in backup.iterdir()))
        self.assertFalse(self.f.run()['updated'])
        self.assertEqual({path.name:path.read_bytes() for path in backup.iterdir()}, before)

    def test_failure_after_new_file_publication_removes_only_owned_helper_and_restores_q(self):
        self.f.watcher()
        original, config = self.f.evidence(), self.f.config.read_bytes()
        real_sync, failed = installer.sync_directory, False
        def interrupted(path):
            nonlocal failed
            if not failed:
                failed = True
                raise OSError('synthetic interruption after publication')
            return real_sync(path)
        with patch.object(installer, 'sync_directory', side_effect=interrupted), patch.object(installer,'stop_idle_watcher',side_effect=self.f.stop):
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError, 'original modules were restored'):
                self.f.run()
        self.f.assert_old(self)
        self.assertEqual(self.f.evidence(), original)
        self.assertEqual(self.f.config.read_bytes(), config)
        self.assertEqual(len(self.f.launched), 1)

    def test_concurrent_unowned_helper_is_not_deleted_or_automatically_started(self):
        self.f.watcher()
        real_add = installer.atomic_add
        def external(path, raw, mode, owned):
            path.write_bytes(b'# concurrent helper belongs to another operator\n')
            return real_add(path, raw, mode, owned)
        with patch.object(installer,'atomic_add',side_effect=external), patch.object(installer,'stop_idle_watcher',side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError): self.f.run()
        self.assertEqual((self.f.root/NEW_HELPER).read_bytes(), b'# concurrent helper belongs to another operator\n')
        self.assertEqual(self.f.launched, [])

    def test_replaced_added_helper_is_preserved_and_blocks_restart(self):
        self.f.watcher()
        def drift(*args, **kwargs):
            path = self.f.root / NEW_HELPER
            replacement = self.f.root / 'external-helper.py'
            replacement.write_bytes(path.read_bytes())
            replacement.chmod(0o644)
            os.replace(replacement, path)
            return True
        with patch.object(installer,'stop_idle_watcher',side_effect=self.f.stop):
            with self.assertRaises(installer.RollbackError): self.f.run(checker=drift)
        self.assertEqual((self.f.root/NEW_HELPER).read_bytes(), self.f.new[NEW_HELPER])
        self.assertEqual(self.f.launched, [])

    def test_new_file_ownership_descriptor_stays_open_until_restart_then_closes(self):
        descriptors=[]
        original=installer.atomic_add
        def capture(path, raw, mode, owned):
            original(path,raw,mode,owned)
            descriptors.append(owned[path.name][2])
        def checking(*args,**kwargs):
            self.assertEqual(len(descriptors),1)
            os.fstat(descriptors[0])
            return True
        def launch(*args):
            os.fstat(descriptors[0])
            self.f.launch(*args)
        with patch.object(installer,'atomic_add',side_effect=capture):
            self.f.run(checker=checking,launch=launch)
        with self.assertRaises(OSError): os.fstat(descriptors[0])

    def test_source_only_check_precedes_stopping_and_all_publication(self):
        self.f.watcher()
        events=[]
        before=self.f.evidence()
        def native(root,python,files,identifier,*,bridge_lock_fd):
            events.append('native')
            self.f.assert_old(self)
            self.assertEqual(files,self.f.new)
            self.assertTrue((self.f.proc/'9001').exists())
            self.assertFalse((root/'nexvia-backup-before-quote-registration-v3-update').exists())
            self.assertEqual(self.f.evidence(),before)
            return True
        def stop(*args):
            events.append('stop');self.f.stop(*args)
        with patch.object(installer,'stop_idle_watcher',side_effect=stop):
            result=self.f.run(check_request=shared.REQUEST,native_checker=native)
        self.assertEqual(events,['native','stop'])
        self.assertTrue(result['nativeUploaderVerified'])
        self.assertEqual(self.f.evidence(),before)

    def test_builder_uses_only_two_sources_and_refuses_missing_helper_source_pins(self):
        root=self.f.root/'source';root.mkdir()
        (root/'install_nexvia_quote_registration_update_v3.py').write_text(Path(installer.__file__).read_text())
        for name,raw in self.f.new.items():(root/name).write_bytes(raw)
        target=self.f.root/'release.py'
        checksum,size=builder.build(target,root)
        namespace={'__name__':'release_validation'}
        exec(compile(target.read_bytes(),str(target),'exec'),namespace)
        self.assertEqual(namespace['decoded_payload'](),self.f.new)
        self.assertEqual(builder.build(self.f.root/'second.py',root),(checksum,size))
        before=target.read_bytes()
        (root/NEW_HELPER).write_text('# missing source pins\n')
        with self.assertRaisesRegex(ValueError,'pins'):builder.build(target,root)
        self.assertEqual(target.read_bytes(),before)

    def test_source_pinned_opaque_completion_routes_are_denied_during_native_preflight(self):
        namespace = {'__name__': 'source_only_guard_test'}
        exec(compile(installer.NATIVE_PREFLIGHT, '<source-only-native-check>', 'exec'), namespace)
        actual_sha256 = hashlib.sha256
        prefix = '/syntheticCompletion/'
        def controlled_hash(raw):
            if raw == prefix.encode():
                return SimpleNamespace(hexdigest=lambda: installer.REGISTRATION_PREFIX_SHA256)
            return actual_sha256(raw)
        namespace['hashlib'] = SimpleNamespace(sha256=controlled_hash)
        quote = SimpleNamespace(policy_path=lambda value: False)
        for path in (prefix + '419', '/staff' + prefix + '419', prefix, '/staff' + prefix):
            request = SimpleNamespace(url='https://lennox.nexvia.com.au' + path,
                                      method='GET', resource_type='xhr')
            with self.subTest(path=path):
                self.assertEqual(namespace['route_decision'](request, quote), (False, True))
        request = SimpleNamespace(url='https://lennox.nexvia.com.au/staff/project-read/60',
                                  method='GET', resource_type='xhr')
        self.assertEqual(namespace['route_decision'](request, quote), (True, False))

    def test_native_failure_report_keeps_only_finite_stage_reason_and_known_hashes(self):
        expected = {'requestFileSha256': 'a' * 64, 'sourceSha256': {'helper': 'b' * 64},
                    'passed': True, 'stage': 'verified'}
        observed = {'passed': False, 'stage': 'registration_source',
                    'reason': 'registration_renderer_query', 'privateException': 'PRIVATE_NATIVE_URL_TOKEN'}
        safe = installer.save_native_check_report(self.f.root, shared.REQUEST, observed, expected,
                                                 frozenset({'registration_renderer_query'}))
        path = self.f.root / 'nexvia-registration-v3-checks' / (shared.REQUEST + '.json')
        self.assertEqual(safe['reason'], 'registration_renderer_query')
        self.assertFalse(safe['passed'])
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        self.assertNotIn('PRIVATE_NATIVE_URL_TOKEN', path.read_text())
        observed.update(stage={'private': 'value'}, reason='PRIVATE_NATIVE_URL_TOKEN')
        safe = installer.save_native_check_report(self.f.root, shared.REQUEST, observed, expected,
                                                 frozenset({'registration_renderer_query'}))
        self.assertEqual(safe['stage'], 'unknown')
        self.assertIsNone(safe['reason'])
        self.assertNotIn('PRIVATE_NATIVE_URL_TOKEN', path.read_text())

    def test_native_preflight_reports_fixed_helper_failure_before_module_mutation(self):
        (self.f.request / 'request.json').write_text(json.dumps({'requestId': shared.REQUEST,
            'quote': {'filename': 'quote.pdf', 'bytes': 100, 'sha256': 'a' * 64}}))
        files = dict(self.f.new)
        files[NEW_HELPER] += b"PUBLIC_FAILURE_CODES=frozenset({'registration_renderer_source'})\n"
        request_hash = hashlib.sha256((self.f.request / 'request.json').read_bytes()).hexdigest()
        observed = {'format': 'nexvia-native-policy-compatibility', 'version': 1,
            'requestId': shared.REQUEST, 'requestFileSha256': request_hash,
            'sourceSha256': {name: hashlib.sha256(files[name + '.py']).hexdigest()
                for name in ('nexvia_quote_registration', 'nexvia_quote_attachment')},
            'passed': False, 'stage': 'registration_source', 'reason': 'registration_renderer_source',
            'privateException': 'PRIVATE_NATIVE_URL_TOKEN'}
        result = SimpleNamespace(returncode=0, stdout=json.dumps(observed).encode())
        with patch.object(installer.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(installer.QuotePolicyUpdateError,
                    r'failed at registration_source \(registration_renderer_source\)') as caught:
                installer._native_policy_preflight(self.f.root, self.f.root / 'nexvia-tools/bin/python', files, shared.REQUEST,
                                                  bridge_lock_fd=17)
        self.assertNotIn('PRIVATE_NATIVE_URL_TOKEN', str(caught.exception))
        self.f.assert_old(self)
        report = self.f.root / 'nexvia-registration-v3-checks' / (shared.REQUEST + '.json')
        self.assertEqual(json.loads(report.read_text())['reason'], 'registration_renderer_source')


for _name in (
    'test_failed_contract_check_rolls_back_and_restarts_only_known_prior_watcher',
    'test_unknown_payload_and_incompatible_dependency_versions_refuse_before_stopping_or_checking',
    'test_work_lock_prevents_stopping_active_bridge',
    'test_default_bridge_lock_wait_retries_before_stopping_only_an_idle_watcher',
    'test_contract_check_receives_real_exclusive_work_lock',
    'test_active_creator_refuses_installation',
    'test_every_partial_exact_patch_refuses_until_all_four_modules_match',
    'test_reference_cache_mutation_during_preflight_blocks_restart',
    'test_code_drift_during_check_is_not_overwritten_or_started',
    'test_preflight_request_mutation_or_new_result_blocks_restart',
    'test_late_external_config_edit_is_preserved_and_blocks_restart',
    'test_parser_drift_blocks_automatic_restart',
    'test_invalid_bundle_and_source_or_history_symlinks_refuse_without_mutation',
    'test_native_route_guard_blocks_writes_policy_registration_and_gcs_before_native_handler',
    'test_native_check_requires_canonical_uuid_before_inspecting_or_stopping',
):
    setattr(RegistrationV3InstallerTests,_name,getattr(shared.QuotePolicyInstallerTests,_name))

if __name__=='__main__':unittest.main()
