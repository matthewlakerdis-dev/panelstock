"""Exercise private credentials and auth-only state transitions without Nexvia writes."""
from contextlib import contextmanager, redirect_stdout
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import pty
import select
import signal
import stat
import tempfile
import time
import unittest
from unittest.mock import patch
import warnings

import nexvia_session_keeper as keeper


USERNAME = 'private-user@example.invalid'
PASSWORD = 'PRIVATE_PASSWORD_NEVER_LOG'
SCHEMA = {'actionPath': '/login', 'method': 'POST', 'username': {'name': 'user'},
          'password': {'name': 'password'}}


class Browser:
    def __init__(self, check='signed_in', login='signed_in', schema=SCHEMA):
        self.health = check
        self.restored = login
        self.schema = schema
        self.logins = []
        self.checks = 0
        self.discoveries = 0
        self.on_login = None
        self.profile = {'persistent': None}

    def check(self):
        self.checks += 1
        if isinstance(self.health, Exception):
            raise self.health
        return {'state': self.health, 'reason': 'PRIVATE_UNTRUSTED_BROWSER_TEXT'}

    def inspect_login(self):
        self.discoveries += 1
        return {'supported': self.schema is not None, 'schema': self.schema}

    def profile_status(self):
        if isinstance(self.profile, Exception):
            raise self.profile
        return self.profile

    def login(self, username, password, *, expected_schema=None):
        self.logins.append((username, password, expected_schema))
        if self.on_login:
            self.on_login()
        if isinstance(self.restored, Exception):
            raise self.restored
        return {'state': self.restored, 'reason': 'PRIVATE_BROWSER_FAILURE'}

    @contextmanager
    def factory(self):
        yield self


class StopWatch(BaseException):
    pass


class SessionKeeperTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        journal = self.root / 'panelstock-request-journal'
        journal.mkdir(mode=0o700)
        (journal / '.bridge.lock').touch(mode=0o600)
        (journal / 'original-request.json').write_bytes(b'ORIGINAL_JOURNAL')
        requests = self.root / 'nexvia-requests'
        requests.mkdir(mode=0o700)
        for name in ('nexvia-quote-upload-attempt.json', 'nexvia-create-attempt.json', 'request.json'):
            (requests / name).write_bytes(b'ORIGINAL_REQUEST_EVIDENCE')
        self.browser = Browser()

    def configure(self, browser=None):
        return keeper.configure(self.root, browser_factory=(browser or self.browser).factory,
                                prompt=lambda: (USERNAME, PASSWORD), now=100)

    def read(self, name):
        with keeper.private_directory(self.root) as directory:
            return keeper.private_read(directory, name)

    def once(self, browser=None, now=200):
        return keeper.run_once(self.root, browser_factory=(browser or self.browser).factory, now=now)

    def business_snapshot(self):
        return {str(p.relative_to(self.root)): (p.stat().st_mode, hashlib.sha256(p.read_bytes()).hexdigest())
                for parent in ('nexvia-requests', 'panelstock-request-journal')
                for p in (self.root / parent).rglob('*') if p.is_file()}

    def test_configuration_discovers_native_form_without_logging_out_or_testing_password(self):
        before = self.business_snapshot()
        with redirect_stdout(io.StringIO()) as output:
            result = self.configure()
        self.assertEqual(result['status'], 'configured')
        self.assertEqual((self.browser.checks, self.browser.discoveries, self.browser.logins), (1, 1, []))
        folder = self.root / keeper.DIRECTORY
        self.assertEqual(stat.S_IMODE(folder.stat().st_mode), 0o700)
        for name in (keeper.CREDENTIALS, keeper.STATE, '.control.lock'):
            self.assertEqual(stat.S_IMODE((folder / name).stat().st_mode), 0o600)
        self.assertEqual(self.read(keeper.CREDENTIALS)['password'], PASSWORD)
        self.assertEqual(self.business_snapshot(), before)
        self.assertNotIn(USERNAME, output.getvalue())
        self.assertNotIn(PASSWORD, output.getvalue())

    def test_new_inherited_directory_mode_is_tightened_but_existing_unsafe_directory_is_refused(self):
        original = os.mkdir
        def inherited(path, mode=0o777, **options):
            original(path, mode, **options)
            if path == keeper.DIRECTORY:
                os.chmod(path, 0o755, dir_fd=options['dir_fd'])
        with patch.object(keeper.os, 'mkdir', inherited):
            self.configure()
        self.assertEqual(stat.S_IMODE((self.root / keeper.DIRECTORY).stat().st_mode), 0o700)
        os.chmod(self.root / keeper.DIRECTORY, 0o755)
        with self.assertRaisesRegex(keeper.SessionError, 'private and regular'):
            self.once()
        self.assertEqual(stat.S_IMODE((self.root / keeper.DIRECTORY).stat().st_mode), 0o755)

    def test_private_directory_and_file_symlinks_and_hardlinks_are_refused(self):
        external = self.root / 'external'
        external.mkdir(mode=0o700)
        (self.root / keeper.DIRECTORY).symlink_to(external, target_is_directory=True)
        with self.assertRaises(OSError):
            self.configure()
        (self.root / keeper.DIRECTORY).unlink()
        self.configure()
        path = self.root / keeper.DIRECTORY / keeper.CREDENTIALS
        saved = path.read_bytes()
        path.unlink()
        outside = external / 'credentials.json'
        outside.write_bytes(saved)
        outside.chmod(0o600)
        path.symlink_to(outside)
        with self.assertRaises(OSError):
            self.once()
        path.unlink()
        os.link(outside, path)
        with self.assertRaisesRegex(keeper.SessionError, 'private and regular'):
            self.once()
        self.assertEqual(outside.read_bytes(), saved)

    def test_current_owner_is_required_even_when_process_is_root(self):
        self.configure()
        with patch.object(keeper.os, 'geteuid', return_value=os.geteuid() + 999):
            with self.assertRaisesRegex(keeper.SessionError, 'ownership'):
                self.once()

    def test_authenticated_check_never_submits_credentials(self):
        self.configure()
        before = self.business_snapshot()
        self.assertEqual(self.once()['status'], 'signed_in')
        self.assertEqual(self.browser.logins, [])
        self.assertEqual(self.business_snapshot(), before)

    def test_login_intent_is_durable_before_single_auth_attempt_and_does_not_retry_business_work(self):
        self.configure()
        browser = Browser(check='signed_out')
        def prove_intent():
            state = self.read(keeper.STATE)
            self.assertTrue(state['attemptPending'])
            self.assertEqual(state['lastLoginAttemptAt'], 200)
            self.assertEqual(state['nextLoginAt'], 200 + keeper.LOGIN_COOLDOWN_SECONDS)
            self.assertEqual(state['uncertainAttempts'], 1)
        browser.on_login = prove_intent
        before = self.business_snapshot()
        result = self.once(browser)
        self.assertEqual(result['status'], 'reauthenticated')
        self.assertEqual(browser.logins, [(USERNAME, PASSWORD, SCHEMA)])
        state = self.read(keeper.STATE)
        self.assertFalse(state['attemptPending'])
        self.assertEqual(state['uncertainAttempts'], 0)
        self.assertEqual(self.business_snapshot(), before)

    def test_bridge_lock_conflict_skips_browser_and_preserves_auth_state(self):
        self.configure()
        before = self.read(keeper.STATE)
        fd = os.open(self.root / 'panelstock-request-journal/.bridge.lock', os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            browser = Browser(check='signed_out')
            self.assertEqual(self.once(browser)['status'], 'busy')
        finally:
            os.close(fd)
        self.assertEqual(browser.checks, 0)
        self.assertEqual(self.read(keeper.STATE), before)

    def test_uncertain_login_survives_restart_and_cools_down_before_another_attempt(self):
        self.configure()
        browser = Browser(check='signed_out', login=RuntimeError(PASSWORD))
        self.assertEqual(self.once(browser)['status'], 'login_cooldown')
        later = Browser(check='signed_out')
        self.assertEqual(self.once(later, now=201)['status'], 'login_cooldown')
        self.assertEqual(later.logins, [])
        # A later check may find the original submission actually succeeded.
        verified = Browser(check='signed_in')
        self.assertEqual(self.once(verified, now=202)['status'], 'signed_in')
        self.assertEqual(verified.logins, [])
        self.assertFalse(self.read(keeper.STATE)['attemptPending'])

    def test_uncertain_authentication_is_bounded_and_then_requires_manual_attention(self):
        self.configure()
        browser = Browser(check='signed_out', login='unavailable')
        for index in range(keeper.MAX_UNCERTAIN_ATTEMPTS):
            self.assertEqual(self.once(browser, now=200 + index * keeper.LOGIN_COOLDOWN_SECONDS)['status'], 'login_cooldown')
        self.assertEqual(self.once(browser, now=10000)['status'], 'manual_required')
        self.assertEqual(len(browser.logins), keeper.MAX_UNCERTAIN_ATTEMPTS)

    def test_rejected_credentials_and_challenges_pause_until_reconfigured_even_after_manual_signin(self):
        self.configure()
        for login_state in ('signed_out', 'manual_required'):
            self.configure()
            browser = Browser(check='signed_out', login=login_state)
            self.assertEqual(self.once(browser)['status'], 'manual_required')
            self.assertTrue(self.read(keeper.STATE)['manualRequired'])
            self.once(Browser(check='signed_in'), now=201)
            again = Browser(check='signed_out')
            self.assertEqual(self.once(again, now=10000)['status'], 'manual_required')
            self.assertEqual(again.logins, [])

    def test_invalid_browser_data_and_exception_text_never_reaches_saved_state_or_output(self):
        self.configure()
        browser = Browser(check=RuntimeError(PASSWORD))
        with redirect_stdout(io.StringIO()) as output:
            value = self.once(browser)
            keeper.emit_status(value)
        self.assertEqual(value['status'], 'browser_unavailable')
        self.assertNotIn(PASSWORD, output.getvalue())
        self.assertNotIn(USERNAME, json.dumps(self.read(keeper.STATE)))
        self.assertNotIn(PASSWORD, json.dumps(self.read(keeper.STATE)))
        self.assertNotIn(PASSWORD, json.dumps(keeper.status(self.root)))

    def test_disable_uses_no_browser_and_prevents_future_automatic_login(self):
        self.configure()
        keeper.disable(self.root)
        browser = Browser(check='signed_out')
        self.assertEqual(self.once(browser)['status'], 'disabled')
        self.assertEqual(browser.checks, 0)
        self.assertEqual(keeper.status(self.root)['status'], 'disabled')

    def test_unsupported_login_form_does_not_prompt_or_save_credentials(self):
        browser = Browser(schema=None)
        def prompt():
            self.fail('credential prompt must not run before native form proof')
        with self.assertRaisesRegex(keeper.SessionError, 'manual inspection'):
            keeper.configure(self.root, browser_factory=browser.factory, prompt=prompt, now=100)
        self.assertFalse((self.root / keeper.DIRECTORY / keeper.CREDENTIALS).exists())

    def test_credential_entry_does_not_hold_the_purchase_request_work_lock(self):
        def prompt():
            # An actual PO worker can acquire its work lock while the owner
            # types a password. The session-only control lock still excludes
            # a second authentication maintenance pass.
            with keeper.bridge_lock(self.root):
                pass
            self.assertEqual(self.once()['status'], 'busy')
            return USERNAME, PASSWORD
        value = keeper.configure(self.root, browser_factory=self.browser.factory, prompt=prompt, now=100)
        self.assertEqual(value['status'], 'configured')

    def test_invalid_credential_values_are_rejected_before_they_can_be_saved(self):
        with self.assertRaisesRegex(keeper.SessionError, 'credentials are invalid'):
            keeper.configure(self.root, browser_factory=self.browser.factory,
                             prompt=lambda: ('bad\nname', PASSWORD), now=100)
        self.assertFalse((self.root / keeper.DIRECTORY / keeper.CREDENTIALS).exists())

    def test_cli_status_reports_manual_pause_without_printing_credentials(self):
        self.configure()
        self.once(Browser(check='signed_out', login='signed_out'))
        self.once(Browser(check='signed_in'), now=201)
        with redirect_stdout(io.StringIO()) as output:
            code = keeper.main(['--root', str(self.root), '--status'])
        self.assertEqual(code, 0)
        data = json.loads(output.getvalue().splitlines()[-1])
        self.assertTrue(data['manualRequired'])
        self.assertNotIn(USERNAME, output.getvalue())
        self.assertNotIn(PASSWORD, output.getvalue())
        self.assertIn('automatic sign-in remains paused', output.getvalue())

    def test_manually_restored_session_does_not_claim_automatic_login_has_resumed(self):
        self.configure()
        self.once(Browser(check='signed_out', login='manual_required'))
        value = self.once(Browser(check='signed_in'), now=201)
        self.assertTrue(value['manualRequired'])
        with redirect_stdout(io.StringIO()) as output:
            keeper.emit_status(value)
        self.assertIn('automatic sign-in remains paused', output.getvalue())
        self.assertIn('--configure', output.getvalue())
        self.assertNotIn(PASSWORD, output.getvalue())
        self.assertIn('--configure', keeper.MESSAGES['manual_required'])

    def test_prompt_reads_tty_instead_of_loader_stdin_and_requires_hidden_passwords(self):
        class Terminal(io.StringIO):
            def close(self):
                pass
            def write(self, text):
                return len(text)
        terminal = Terminal()
        reader = io.BytesIO((USERNAME + '\n').encode())
        with patch('builtins.open', side_effect=[reader, terminal]) as opened, \
                patch.object(keeper.getpass, 'getpass', side_effect=[PASSWORD, PASSWORD]) as secret, \
                patch.object(keeper.sys, 'stdin', None):
            self.assertEqual(keeper.prompt_credentials(), (USERNAME, PASSWORD))
        self.assertEqual(opened.call_count, 2)
        self.assertEqual(opened.call_args_list[0].args, ('/dev/tty', 'rb'))
        self.assertEqual(opened.call_args_list[0].kwargs, {'buffering': 0})
        self.assertEqual(opened.call_args_list[1].args, ('/dev/tty', 'w'))
        self.assertEqual(secret.call_count, 2)
        self.assertTrue(all(call.kwargs['stream'] is terminal for call in secret.call_args_list))
        terminal = Terminal()
        def cannot_hide(*args, **kwargs):
            warnings.warn('echo fallback', keeper.getpass.GetPassWarning)
            self.fail('unsafe fallback continued')
        with patch('builtins.open', side_effect=[io.BytesIO((USERNAME + '\n').encode()), terminal]), \
                patch.object(keeper.getpass, 'getpass', cannot_hide):
            with self.assertRaisesRegex(keeper.SessionError, 'could not hide'):
                keeper.prompt_credentials()

    def test_bad_password_confirmation_cannot_write_credentials(self):
        class Terminal(io.StringIO):
            def close(self):
                pass
            def write(self, text):
                return len(text)
        with patch('builtins.open', side_effect=[io.BytesIO((USERNAME + '\n').encode()), Terminal()]), \
                patch.object(keeper.getpass, 'getpass', side_effect=[PASSWORD, 'different']):
            with self.assertRaisesRegex(keeper.SessionError, 'did not match'):
                keeper.prompt_credentials()

    def test_real_controlling_terminal_works_with_stdin_eof_and_never_echoes_password(self):
        pid, descriptor = pty.fork()
        if pid == 0:
            # Match a streamed loader: source/stdin is already at EOF, but the
            # container terminal is still a usable controlling terminal.
            null = os.open('/dev/null', os.O_RDONLY)
            os.dup2(null, 0)
            os.close(null)
            try:
                username, password = keeper.prompt_credentials()
                print('PROMPT_OK:' + str(username == USERNAME and password == PASSWORD), flush=True)
                os._exit(0)
            except BaseException as error:
                print('PROMPT_FAILED:' + type(error).__name__, flush=True)
                os._exit(1)
        output = bytearray()
        phase = 0
        completed = False
        deadline = time.monotonic() + 5
        markers = (b'Nexvia email or username: ', b'Nexvia password (hidden): ',
                   b'Confirm Nexvia password (hidden): ')
        try:
            while time.monotonic() < deadline:
                readable, _, _ = select.select([descriptor], [], [], 0.1)
                if not readable:
                    continue
                try:
                    chunk = os.read(descriptor, 4096)
                except OSError:
                    completed = True
                    break
                if not chunk:
                    completed = True
                    break
                output.extend(chunk)
                if phase < len(markers) and markers[phase] in output:
                    value = USERNAME if phase == 0 else PASSWORD
                    os.write(descriptor, (value + '\n').encode())
                    phase += 1
            if not completed:
                os.kill(pid, signal.SIGKILL)
            _, code = os.waitpid(pid, 0)
        finally:
            os.close(descriptor)
        self.assertTrue(completed, 'TTY prompt did not finish')
        self.assertEqual(os.waitstatus_to_exitcode(code), 0, output.decode(errors='replace'))
        self.assertIn(b'PROMPT_OK:True', output)
        self.assertNotIn(PASSWORD.encode(), output)

    def test_profile_report_is_optional_finite_and_contains_no_paths_or_browser_error(self):
        for profile, expected in (({'persistent': True, 'path': '/PRIVATE_PROFILE'}, True),
                                  ({'persistent': False}, False),
                                  ({'persistent': 'PRIVATE_TOKEN'}, None),
                                  (RuntimeError('PRIVATE_BROWSER_TOKEN'), None)):
            self.browser.profile = profile
            result = self.configure()
            self.assertIs(result['profilePersistent'], expected)
            self.assertNotIn('PRIVATE_', json.dumps(result))
            self.assertEqual(self.browser.logins, [])

    def test_duplicate_watchers_exit_without_state_change_or_browser_operations(self):
        self.configure()
        before = self.read(keeper.STATE)
        with keeper.private_directory(self.root) as directory, keeper.private_lock(directory, '.watch.lock'):
            self.assertTrue(keeper.watch_running(self.root))
            with redirect_stdout(io.StringIO()) as output:
                keeper.run_watch(self.root, runner=lambda root: self.fail('duplicate watcher ran'))
        self.assertIn('already running', output.getvalue())
        self.assertEqual(self.read(keeper.STATE), before)
        self.assertFalse(keeper.watch_running(self.root))

    def test_watch_backoff_and_logs_use_only_fixed_statuses(self):
        self.configure()
        delays = []
        values = iter([keeper.result('busy', 'bridge_busy'), keeper.result('browser_unavailable', 'browser_unavailable'),
                       keeper.result('signed_in', 'session_active')])
        def sleep(delay):
            delays.append(delay)
            if len(delays) == 3:
                raise StopWatch()
        with redirect_stdout(io.StringIO()) as output, self.assertRaises(StopWatch):
            keeper.run_watch(self.root, runner=lambda root: next(values), sleep=sleep)
        self.assertEqual(delays, [keeper.BUSY_SECONDS, keeper.ERROR_SECONDS, keeper.HEALTH_SECONDS])
        self.assertNotIn(PASSWORD, output.getvalue())
        self.assertNotIn(USERNAME, output.getvalue())


if __name__ == '__main__':
    unittest.main()
