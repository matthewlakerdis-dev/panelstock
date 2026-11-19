import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import nexvia_inspect_session_login as diagnostic
import nexvia_session_browser as browser


def fixture():
    inputs = [
        {'index': 0, 'type': 'email', 'name': 'PRIVATE_USERNAME_NAME', 'autocomplete': 'username',
         'disabled': False, 'visible': True, 'owner': True, 'label': 'PRIVATE_LABEL'},
        {'index': 1, 'type': 'password', 'name': 'PRIVATE_PASSWORD_NAME', 'autocomplete': 'current-password',
         'disabled': False, 'visible': True, 'owner': True, 'label': 'PRIVATE_PASSWORD'},
    ]
    return {'url': browser.ORIGIN + '/staff/login?token=PRIVATE_QUERY', 'challenge': False,
            'passwords': 1, 'baseTarget': '', 'forms': [
                {'index': 0, 'method': 'POST', 'action': browser.ORIGIN + '/staff/login?token=PRIVATE_QUERY',
                 'target': '', 'encoding': 'application/x-www-form-urlencoded', 'inputs': inputs,
                 'buttons': [{'index': 0, 'type': 'submit', 'name': 'PRIVATE_BUTTON_NAME',
                              'text': 'Log in', 'disabled': False, 'visible': True,
                              'owner': True, 'overrides': False}]}]}


class Page:
    def __init__(self, states):
        self.states = states
        self.reads = 0
        self.waits = []

    def wait_for_timeout(self, value):
        self.waits.append(value)

    def evaluate(self, source):
        return {'iframeCount': 1, 'challengeIframeCount': 0, 'challengeMarkerCount': 0,
                'visibleOTPCount': 0, 'forms': []}


class Adapter:
    def __init__(self, states, *, fail=False):
        self.page = Page(states)
        self.fail = fail
        self._guard = lambda route: route.abort()
        self._response = lambda route: route.fetch(max_redirects=0)
        self._prepare_page = lambda page: None
        self._navigate = lambda page, target: None

    def _state(self, page):
        index = min(page.reads, len(page.states) - 1)
        page.reads += 1
        return copy.deepcopy(page.states[index])

    def _can_read(self, url, resource):
        return browser._safe_read(url, resource)

    def inspect_login(self):
        self._prepare_page(self.page)
        self._navigate(self.page, browser.HEALTH_URL)
        if self.fail:
            raise RuntimeError('PRIVATE_EXCEPTION PASSWORD=PRIVATE_PASSWORD')
        state = self._state(self.page)
        native, reason = browser.native_form(state)
        return {'supported': native is not None, 'reason': reason, 'schema': native['schema'] if native else None}


class LoginInspectionTests(unittest.TestCase):
    def test_unknown_paths_and_all_query_values_are_redacted(self):
        raw = 'https://private-user:PRIVATE_PASSWORD@other.invalid/PRIVATE_PATH/private.pdf?token=PRIVATE_QUERY'
        value = diagnostic.url_shape(raw)
        text = json.dumps(value)
        for forbidden in ('PRIVATE_', 'other.invalid', 'private-user', 'token', 'private.pdf'):
            self.assertNotIn(forbidden, text)
        self.assertEqual(value['path']['sha256'], hashlib.sha256(b'/PRIVATE_PATH/private.pdf').hexdigest())
        public = diagnostic.url_shape(browser.ORIGIN + '/staff/login?token=PRIVATE_QUERY')
        self.assertEqual(public['path'], {'public': '/staff/login'})
        self.assertNotIn('PRIVATE', json.dumps(public))
        for path in ('/account/login', '/user/login/', '/site/security/login'):
            self.assertEqual(diagnostic.url_shape(browser.ORIGIN + path)['path'], {'public': path})
        for path in ('/account/PRIVATE/login', '/account/security/auth/login', '//account/login'):
            self.assertNotIn('public', diagnostic.url_shape(browser.ORIGIN + path)['path'])

    def test_form_summary_shows_selection_failure_without_names_values_or_labels(self):
        state = fixture()
        state['forms'][0]['inputs'].append({'index': 2, 'type': 'text', 'name': 'login_other',
                                          'visible': True, 'disabled': False, 'owner': True})
        state['forms'][0]['buttons'].append({'index': 1, 'type': 'button', 'visible': True,
                                           'disabled': True, 'owner': False, 'overrides': True})
        result = diagnostic.state_summary(state, browser)
        form = result['forms'][0]
        self.assertEqual(form['eligibleUsernameCount'], 2)
        self.assertFalse(form['eligible'])
        self.assertEqual(form['foreignButtonCount'], 1)
        self.assertEqual(form['disabledButtonCount'], 1)
        self.assertEqual(form['overrideButtonCount'], 1)
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('login_other', json.dumps(result))

    def test_bounded_delayed_form_comparison_uses_only_the_existing_anonymous_inspection(self):
        empty = fixture()
        empty['forms'] = []
        empty['passwords'] = 0
        adapter = Adapter([empty, fixture()])
        original_guard = adapter._guard
        report = diagnostic.inspect_adapter(adapter, browser)
        self.assertFalse(report['immediate']['supported'])
        self.assertTrue(report['settled']['supported'])
        self.assertTrue(report['supported'])
        self.assertEqual(adapter.page.waits, [200])
        self.assertIs(adapter._guard, original_guard)
        self.assertFalse(report['credentialsRead'])
        self.assertFalse(report['credentialsSubmitted'])
        self.assertNotIn('PRIVATE', json.dumps(report))

    def test_missing_form_wait_is_bounded_and_original_methods_are_restored_on_exception(self):
        empty = fixture()
        empty['forms'] = []
        adapter = Adapter([empty])
        report = diagnostic.inspect_adapter(adapter, browser)
        self.assertEqual(len(adapter.page.waits), 20)
        self.assertEqual(report['settlePasses'], 20)
        adapter = Adapter([fixture()], fail=True)
        original = adapter._response
        report = diagnostic.inspect_adapter(adapter, browser)
        self.assertEqual(report['reason'], 'inspection_unavailable')
        self.assertEqual(report['stage'], 'navigate')
        self.assertIs(adapter._response, original)
        self.assertNotIn('PRIVATE', json.dumps(report))

    def test_transport_tripwire_rejects_post_policy_and_logout_before_fetch(self):
        for method, path in [('POST', '/staff/login'), ('GET', '/upload/security'), ('GET', '/staff/logout')]:
            calls = []
            request = SimpleNamespace(method=method, url=browser.ORIGIN + path, resource_type='document')
            route = SimpleNamespace(request=request, fetch=lambda **kwargs: calls.append(kwargs))
            observed = diagnostic._ObservedRoute(route, {'responses': []}, browser)
            with self.subTest(method=method, path=path), self.assertRaises(diagnostic.InspectionError):
                observed.fetch(max_redirects=0)
            self.assertEqual(calls, [])

    def test_response_metadata_preserves_status_and_redacts_redirect_query(self):
        request = SimpleNamespace(method='GET', url=browser.HEALTH_URL, resource_type='document')
        response = SimpleNamespace(status=302, headers={'location': '/staff/login?token=PRIVATE_QUERY',
                                                       'set-cookie': 'PRIVATE_COOKIE'})
        report = {'responses': []}
        route = SimpleNamespace(request=request, fetch=lambda **kwargs: response)
        self.assertIs(diagnostic._ObservedRoute(route, report, browser).fetch(max_redirects=0), response)
        self.assertEqual(report['responses'][0]['status'], 302)
        self.assertNotIn('PRIVATE', json.dumps(report))

    def test_installed_module_integrity_is_verified_before_any_source_executes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in diagnostic.PINS:
                (root / (name + '.py')).write_text("raise RuntimeError('PRIVATE_BAD_SOURCE')\n")
            with patch('builtins.exec', side_effect=AssertionError('unverified source executed')):
                with self.assertRaisesRegex(diagnostic.InspectionError, 'differ'):
                    diagnostic.verified_modules(root)

    def test_verified_module_reads_do_not_create_bytecode_or_read_private_credentials(self):
        # This inspector intentionally targets the deployed immutable v1 pair,
        # even while the source checkout advances to a later browser revision.
        archive = (Path(__file__).parent / 'releases/install_nexvia_session_keeper_v1.py').read_bytes()
        self.assertEqual(hashlib.sha256(archive).hexdigest(),
                         'bb75bd30aff0af1d04122dcc213c94b93a05dc94b56e2faf274dee648ee29990')
        namespace = {'__name__': 'immutable_v1_inspection_fixture'}
        exec(compile(archive, 'immutable_v1_inspection_fixture.py', 'exec'), namespace)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, source in namespace['decoded_payload']().items():
                (root / name).write_bytes(source)
            with patch.object(Path, 'read_text', side_effect=AssertionError('unexpected file read')):
                keeper, native = diagnostic.verified_modules(root)
        self.assertEqual(native.MODULE_VERSION, 1)
        self.assertTrue(callable(keeper.bridge_lock))

    def test_extra_dom_whitelist_drops_arbitrary_fields(self):
        value = diagnostic.extra_summary({'iframeCount': 2, 'private': 'PRIVATE', 'forms': [
            {'associatedOutsideCount': 1, 'private': 'PRIVATE', 'overrideButtons': [
                {'kinds': ['formaction', 'PRIVATE'], 'actionEquivalent': True, 'private': 'PRIVATE'}]}]})
        self.assertEqual(value['forms'][0]['overrideButtons'][0]['kinds'], ['formaction'])
        self.assertNotIn('PRIVATE', json.dumps(value))

    def test_identical_form_output_is_not_duplicated(self):
        report = diagnostic.inspect_adapter(Adapter([fixture()]), browser)
        output = diagnostic.form_console_summary(report)
        self.assertTrue(output['immediate']['sameAsSettled'])
        self.assertNotIn('forms', output['immediate'])
        self.assertEqual(output['settled'], report['settled'])

    def test_reader_errors_expose_only_fixed_categories_and_bounded_script_coordinates(self):
        error = RuntimeError('Page.evaluate: TypeError: PRIVATE_PASSWORD PRIVATE_COOKIE https://private.invalid/token '
                             'at eval (<anonymous>:14:91) at eval (<anonymous>:99999:99999)')
        result = diagnostic.error_summary(error, 'dom_state')
        self.assertEqual(result, {'phase': 'dom_state', 'category': 'javascript_type_error',
                                  'coordinates': [{'line': 14, 'column': 91}]})
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('private.invalid', json.dumps(result))

    def test_reader_failure_is_distinguished_from_summary_failure_without_raw_messages(self):
        adapter = Adapter([fixture()])
        adapter._state = lambda page: (_ for _ in ()).throw(RuntimeError(
            'Execution context was destroyed PRIVATE_PASSWORD'))
        result = diagnostic.inspect_adapter(adapter, browser)
        self.assertEqual(result['readerError']['phase'], 'dom_state')
        self.assertEqual(result['readerError']['category'], 'evaluation_context_changed')
        self.assertNotIn('PRIVATE', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
