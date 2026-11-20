#!/usr/bin/env python3
"""Maintain the NAS Nexvia sign-in without touching purchase-request work.

Credentials are collected only from the local terminal and kept in a private
NAS directory. Browser operations share the request bridge's existing work
lock. This module never imports a PO creator or changes request evidence.
"""

import argparse
from contextlib import contextmanager
import fcntl
import getpass
import json
import math
import os
from pathlib import Path
import secrets
import stat
import sys
import time
import warnings


VERSION = 1
DEFAULT_ROOT = Path('/config')
DIRECTORY = 'nexvia-session'
CREDENTIALS = 'credentials.json'
STATE = 'state.json'
MAX_BYTES = 65536
HEALTH_SECONDS = 300
BUSY_SECONDS = 5
ERROR_SECONDS = 30
LOGIN_COOLDOWN_SECONDS = 1800
MAX_UNCERTAIN_ATTEMPTS = 3

STATUSES = frozenset({'not_configured', 'disabled', 'configured', 'busy', 'signed_in',
                     'reauthenticated', 'login_pending', 'login_cooldown', 'manual_required',
                     'browser_unavailable', 'already_running'})
REASONS = frozenset({'not_configured', 'disabled', 'credentials_configured', 'bridge_busy',
                    'session_active', 'session_restored', 'login_in_progress', 'login_cooldown',
                    'manual_sign_in_required', 'credentials_rejected', 'login_attempt_limit',
                    'browser_unavailable', 'keeper_already_running'})
MESSAGES = {
    'not_configured': 'Nexvia automatic sign-in is not configured.',
    'disabled': 'Nexvia automatic sign-in is disabled.',
    'configured': 'Nexvia automatic sign-in configured. Credentials were saved privately on this NAS.',
    'busy': 'Nexvia work is active; automatic sign-in will wait.',
    'signed_in': 'Nexvia session is signed in.',
    'reauthenticated': 'Nexvia session restored and verified.',
    'login_pending': 'Nexvia automatic sign-in is in progress.',
    'login_cooldown': 'Nexvia automatic sign-in is waiting before another attempt.',
    'manual_required': 'Nexvia sign-in needs attention. Run --configure to resume automatic sign-in.',
    'browser_unavailable': 'Nexvia browser is unavailable; automatic sign-in will check again.',
    'already_running': 'Nexvia session keeper is already running.',
}


class SessionError(ValueError):
    """Fixed messages contain no credentials or browser response text."""


class SessionBusy(SessionError):
    pass


def require(condition, message):
    if not condition:
        raise SessionError(message)


def timestamp(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                      allow_nan=False).encode()


def _private_info(info, *, directory=False):
    return ((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and stat.S_IMODE(info.st_mode) == (0o700 if directory else 0o600)
            and info.st_uid == os.geteuid() and (directory or info.st_nlink == 1))


@contextmanager
def private_directory(root=DEFAULT_ROOT, *, create=False):
    """Open only the dedicated session directory; never change foreign paths."""
    root = Path(root)
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    folder = None
    try:
        created = False
        if create:
            try:
                os.mkdir(DIRECTORY, 0o700, dir_fd=descriptor)
                created = True
            except FileExistsError:
                pass
        try:
            folder = os.open(DIRECTORY, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=descriptor)
        except FileNotFoundError:
            if not create:
                yield None
                return
            raise
        info = os.fstat(folder)
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid(),
                'The private session directory has unexpected ownership.')
        if created:
            os.fchmod(folder, 0o700)
            os.fsync(folder)
            os.fsync(descriptor)
        require(_private_info(os.fstat(folder), directory=True),
                'The session directory must be private and regular.')
        yield folder
    finally:
        if folder is not None:
            os.close(folder)
        os.close(descriptor)


def private_read(directory, name, *, optional=False):
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    except FileNotFoundError:
        if optional:
            return None
        raise SessionError('Private session configuration is missing.') from None
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(_private_info(info), 'A session file is not private and regular.')
        raw = stream.read(MAX_BYTES + 1)
        after = os.fstat(stream.fileno())
    require(len(raw) <= MAX_BYTES and (info.st_dev, info.st_ino, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size,
            after.st_mtime_ns, after.st_ctime_ns), 'A session file changed while reading.')
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        raise SessionError('Private session configuration is invalid.') from None
    require(isinstance(value, dict), 'Private session configuration is invalid.')
    return value


def private_write(directory, name, value):
    """Atomically replace only a private regular file in the already-open folder."""
    raw = canonical(value) + b'\n'
    require(len(raw) <= MAX_BYTES, 'Private session state exceeds its limit.')
    try:
        existing = os.stat(name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        existing = None
    require(existing is None or _private_info(existing),
            'A session destination is not private and regular.')
    temporary = '.pending-' + secrets.token_hex(12)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=directory)
    try:
        os.fchmod(descriptor, 0o600)
        require(_private_info(os.fstat(descriptor)), 'Private session state could not be protected.')
        with os.fdopen(descriptor, 'wb') as stream:
            descriptor = None
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if existing is not None:
            latest = os.stat(name, dir_fd=directory, follow_symlinks=False)
            require((latest.st_dev, latest.st_ino, latest.st_mode, latest.st_size,
                    latest.st_mtime_ns, latest.st_ctime_ns) ==
                    (existing.st_dev, existing.st_ino, existing.st_mode, existing.st_size,
                     existing.st_mtime_ns, existing.st_ctime_ns),
                    'Private session state changed before saving.')
        else:
            try:
                os.stat(name, dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise SessionError('Private session state appeared before saving.')
        os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass


@contextmanager
def private_lock(directory, name):
    created = False
    try:
        descriptor = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        created = True
    except FileExistsError:
        descriptor = os.open(name, os.O_RDWR | os.O_NOFOLLOW, dir_fd=directory)
    try:
        if created:
            os.fchmod(descriptor, 0o600)
        require(_private_info(os.fstat(descriptor)), 'A session lock is not private and regular.')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SessionBusy('Session maintenance is already active.') from None
        yield
    finally:
        os.close(descriptor)


@contextmanager
def bridge_lock(root=DEFAULT_ROOT):
    """Use the bridge's existing lock without creating or rewriting its files."""
    journal = os.open(Path(root) / 'panelstock-request-journal',
                      os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        require(_private_info(os.fstat(journal), directory=True),
                'The existing request journal is not private.')
        descriptor = os.open('.bridge.lock', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=journal)
        info = os.fstat(descriptor)
        require(_private_info(info) and info.st_size == 0, 'The existing bridge lock is invalid.')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SessionBusy('Nexvia work is active; session maintenance will wait.') from None
        yield
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(journal)


def load_credentials(directory):
    value = private_read(directory, CREDENTIALS, optional=True)
    if value is None:
        return None
    return validate_credentials(value)


def validate_credentials(value):
    require(isinstance(value, dict) and set(value) == {'format', 'version', 'enabled', 'username', 'password',
                           'loginSchema', 'configuredAt'}
            and value['format'] == 'nexvia-session-credentials'
            and type(value['version']) is int and value['version'] == VERSION
            and type(value['enabled']) is bool and timestamp(value['configuredAt'])
            and type(value['username']) is str and value['username'] == value['username'].strip()
            and 0 < len(value['username']) <= 320
            and not any(ord(c) < 32 or ord(c) == 127 for c in value['username'])
            and type(value['password']) is str and 0 < len(value['password']) <= 4096
            and '\x00' not in value['password'] and isinstance(value['loginSchema'], dict)
            and 0 < len(canonical(value['loginSchema'])) <= 16384,
            'Private session credentials are invalid.')
    return value


def empty_state():
    return {'version': VERSION, 'status': 'configured', 'reason': 'credentials_configured',
            'lastCheckAt': None, 'lastSuccessAt': None, 'lastLoginAttemptAt': None,
            'nextLoginAt': 0, 'attemptPending': False, 'uncertainAttempts': 0,
            'manualRequired': False}


def load_state(directory):
    value = private_read(directory, STATE, optional=True)
    if value is None:
        return empty_state()
    expected = set(empty_state())
    require(set(value) == expected and type(value['version']) is int and value['version'] == VERSION
            and type(value['status']) is str and value['status'] in STATUSES
            and type(value['reason']) is str and value['reason'] in REASONS
            and all(value[key] is None or timestamp(value[key])
                for key in ('lastCheckAt', 'lastSuccessAt', 'lastLoginAttemptAt'))
            and timestamp(value['nextLoginAt']) and type(value['attemptPending']) is bool
            and type(value['manualRequired']) is bool and type(value['uncertainAttempts']) is int
            and 0 <= value['uncertainAttempts'] <= MAX_UNCERTAIN_ATTEMPTS,
            'Private session state is invalid.')
    return value


def result(status, reason, **extra):
    require(status in STATUSES and reason in REASONS, 'Session status is invalid.')
    return {'status': status, 'reason': reason, **extra}


def _browser_factory():
    from nexvia_session_browser import browser_session
    return browser_session()


def _browser_state(value):
    require(isinstance(value, dict) and value.get('state') in
            {'signed_in', 'signed_out', 'manual_required', 'unavailable'},
            'The browser returned an unsupported session result.')
    return value['state']


def _save_result(directory, state, status, reason, instant, **changes):
    state.update(status=status, reason=reason, lastCheckAt=instant, **changes)
    private_write(directory, STATE, state)
    return result(status, reason, manualRequired=state['manualRequired'])


def run_once(root=DEFAULT_ROOT, *, browser_factory=None, now=None):
    """Check/restore one session while excluding all active request work."""
    instant = time.time() if now is None else now
    require(timestamp(instant), 'The session clock is invalid.')
    browser_factory = _browser_factory if browser_factory is None else browser_factory
    try:
        with private_directory(root) as directory:
            if directory is None:
                return result('not_configured', 'not_configured')
            with private_lock(directory, '.control.lock'):
                credentials = load_credentials(directory)
                if credentials is None:
                    return result('not_configured', 'not_configured')
                if not credentials['enabled']:
                    return result('disabled', 'disabled')
                state = load_state(directory)
                with bridge_lock(root):
                    try:
                        with browser_factory() as browser:
                            health = _browser_state(browser.check())
                            if health == 'signed_in':
                                return _save_result(directory, state, 'signed_in', 'session_active', instant,
                                    lastSuccessAt=instant, attemptPending=False,
                                    nextLoginAt=0, uncertainAttempts=0)
                            if state['manualRequired'] or health == 'manual_required':
                                return _save_result(directory, state, 'manual_required',
                                    'manual_sign_in_required', instant, manualRequired=True)
                            if health != 'signed_out':
                                return _save_result(directory, state, 'browser_unavailable', 'browser_unavailable', instant)
                            if state['uncertainAttempts'] >= MAX_UNCERTAIN_ATTEMPTS:
                                return _save_result(directory, state, 'manual_required',
                                    'login_attempt_limit', instant, manualRequired=True)
                            # A prior process may have died after submitting the
                            # native login. Recheck health first, but never replay
                            # its login until the durable cooldown has elapsed.
                            if instant < state['nextLoginAt']:
                                return _save_result(directory, state, 'login_cooldown', 'login_cooldown', instant)
                            state.update(status='login_pending', reason='login_in_progress',
                                lastCheckAt=instant, lastLoginAttemptAt=instant,
                                nextLoginAt=instant + LOGIN_COOLDOWN_SECONDS,
                                attemptPending=True,
                                uncertainAttempts=state['uncertainAttempts'] + 1)
                            private_write(directory, STATE, state)
                            restored = _browser_state(browser.login(credentials['username'], credentials['password'],
                                                          expected_schema=credentials['loginSchema']))
                            if restored == 'signed_in':
                                return _save_result(directory, state, 'reauthenticated', 'session_restored', instant,
                                    lastSuccessAt=instant, attemptPending=False, nextLoginAt=0,
                                    uncertainAttempts=0)
                            if restored in {'manual_required', 'signed_out'}:
                                return _save_result(directory, state, 'manual_required',
                                    'credentials_rejected' if restored == 'signed_out' else 'manual_sign_in_required',
                                    instant, manualRequired=True, attemptPending=False)
                            return _save_result(directory, state, 'login_cooldown', 'login_cooldown', instant)
                    except Exception:
                        # Exception messages can contain URLs or browser input.
                        # Persist only a finite local status; a durable pending
                        # attempt remains protected by its cooldown.
                        return _save_result(directory, state,
                            'login_cooldown' if state['attemptPending'] else 'browser_unavailable',
                            'login_cooldown' if state['attemptPending'] else 'browser_unavailable', instant)
    except SessionBusy:
        return result('busy', 'bridge_busy')


def prompt_credentials():
    """Read directly from the NAS TTY, including when a loader owns stdin."""
    try:
        # A terminal is not seekable: buffered r+ would use BufferedRandom
        # and fail before prompting. Separate read/write handles also avoid
        # consuming future password input in a username read-ahead buffer.
        with open('/dev/tty', 'rb', buffering=0) as reader, \
                open('/dev/tty', 'w', encoding='utf-8', buffering=1) as terminal:
            terminal.write('Nexvia email or username: ')
            terminal.flush()
            raw_username = reader.readline(4097)
            require(bool(raw_username) and len(raw_username) <= 4096,
                    'Credential entry was cancelled.')
            try:
                username = raw_username.decode('utf-8').rstrip('\r\n').strip()
            except UnicodeError:
                raise SessionError('The entered username is invalid; credentials were not saved.') from None
            # getpass normally falls back to echoed input when a terminal
            # cannot disable echo. That fallback is inappropriate for a NAS
            # setup loader, whose stdin may also be the downloaded source.
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                password = getpass.getpass('Nexvia password (hidden): ', stream=terminal)
                confirmation = getpass.getpass('Confirm Nexvia password (hidden): ', stream=terminal)
    except (EOFError, KeyboardInterrupt):
        raise SessionError('Credential entry was cancelled.') from None
    except OSError:
        raise SessionError('Open an interactive NAS terminal to configure automatic sign-in.') from None
    except getpass.GetPassWarning:
        raise SessionError('The terminal could not hide password entry; credentials were not saved.') from None
    require(password == confirmation, 'The password entries did not match; credentials were not saved.')
    require(0 < len(username) <= 320 and not any(ord(c) < 32 or ord(c) == 127 for c in username)
            and 0 < len(password) <= 4096 and '\x00' not in password,
            'The entered credentials are invalid; credentials were not saved.')
    return username, password


def configure(root=DEFAULT_ROOT, *, browser_factory=None, prompt=None, now=None):
    """Discover native controls without a login, then save locally entered credentials."""
    instant = time.time() if now is None else now
    require(timestamp(instant), 'The session clock is invalid.')
    browser_factory = _browser_factory if browser_factory is None else browser_factory
    prompt = prompt_credentials if prompt is None else prompt
    profile_persistent = None
    with private_directory(root, create=True) as directory, private_lock(directory, '.control.lock'):
        # The user's current session is retained. The adapter discovers the
        # native login form in an empty, owned, read-only context.
        with bridge_lock(root), browser_factory() as browser:
            health = _browser_state(browser.check())
            require(health in {'signed_in', 'signed_out'},
                    'Open Nexvia in the NAS browser before configuring automatic sign-in.')
            native = browser.inspect_login()
            require(isinstance(native, dict) and native.get('supported') is True
                    and isinstance(native.get('schema'), dict) and native['schema'],
                    'The native sign-in form needs manual inspection; credentials were not saved.')
            schema = native['schema']
            require(len(canonical(schema)) <= 16384,
                    'The native sign-in form exceeds its supported limit.')
            try:
                profile = browser.profile_status()
                if isinstance(profile, dict) and type(profile.get('persistent')) is bool:
                    profile_persistent = profile['persistent']
            except Exception:
                # A profile observation is advisory. Credentials have their
                # own private /config storage even when CDP cannot report it.
                pass
        username, password = prompt()
        candidate = {'format': 'nexvia-session-credentials', 'version': VERSION,
                     'enabled': True, 'username': username, 'password': password,
                     'loginSchema': schema, 'configuredAt': instant}
        validate_credentials(candidate)
        private_write(directory, CREDENTIALS, candidate)
        # Validate through the same strict reader before enabling a watch pass.
        load_credentials(directory)
        state = empty_state()
        state.update(lastCheckAt=instant, status='signed_in' if health == 'signed_in' else 'configured',
                     reason='session_active' if health == 'signed_in' else 'credentials_configured',
                     lastSuccessAt=instant if health == 'signed_in' else None)
        private_write(directory, STATE, state)
    return result('configured', 'credentials_configured', profilePersistent=profile_persistent)


def disable(root=DEFAULT_ROOT):
    with private_directory(root) as directory:
        if directory is None:
            return result('not_configured', 'not_configured')
        with private_lock(directory, '.control.lock'):
            credentials = load_credentials(directory)
            if credentials is None:
                return result('not_configured', 'not_configured')
            credentials['enabled'] = False
            private_write(directory, CREDENTIALS, credentials)
            state = load_state(directory)
            state.update(status='disabled', reason='disabled')
            private_write(directory, STATE, state)
    return result('disabled', 'disabled')


def status(root=DEFAULT_ROOT):
    with private_directory(root) as directory:
        if directory is None:
            return result('not_configured', 'not_configured')
        credentials = load_credentials(directory)
        if credentials is None:
            return result('not_configured', 'not_configured')
        state = load_state(directory)
        return result(state['status'] if credentials['enabled'] else 'disabled',
                      state['reason'] if credentials['enabled'] else 'disabled',
                      enabled=credentials['enabled'], lastCheckAt=state['lastCheckAt'],
                      lastSuccessAt=state['lastSuccessAt'],
                      nextLoginAt=state['nextLoginAt'], manualRequired=state['manualRequired'])


def watch_running(root=DEFAULT_ROOT):
    with private_directory(root) as directory:
        if directory is None:
            return False
        try:
            with private_lock(directory, '.watch.lock'):
                return False
        except SessionBusy:
            return True


def emit_status(value):
    if value['status'] == 'signed_in' and value.get('manualRequired') is True:
        print('Nexvia session is signed in; automatic sign-in remains paused. Run --configure to resume.', flush=True)
    else:
        print(MESSAGES[value['status']], flush=True)


def run_watch(root=DEFAULT_ROOT, *, runner=None, sleep=None, emit=emit_status):
    runner = run_once if runner is None else runner
    sleep = time.sleep if sleep is None else sleep
    with private_directory(root, create=True) as directory:
        try:
            with private_lock(directory, '.watch.lock'):
                previous = None
                while True:
                    try:
                        current = runner(root)
                    except Exception:
                        current = result('browser_unavailable', 'browser_unavailable')
                    if current['status'] != previous:
                        emit(current)
                        previous = current['status']
                    delay = BUSY_SECONDS if current['status'] == 'busy' else ERROR_SECONDS \
                        if current['status'] == 'browser_unavailable' else HEALTH_SECONDS
                    sleep(delay)
        except SessionBusy:
            emit(result('already_running', 'keeper_already_running'))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--configure', action='store_true')
    mode.add_argument('--once', action='store_true')
    mode.add_argument('--watch', action='store_true')
    mode.add_argument('--status', action='store_true')
    mode.add_argument('--disable', action='store_true')
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args(argv)
    try:
        if args.configure:
            value = configure(args.root)
        elif args.disable:
            value = disable(args.root)
        elif args.status:
            value = status(args.root)
        elif args.watch:
            run_watch(args.root)
            return 0
        else:
            value = run_once(args.root)
        emit_status(value)
        if args.configure:
            print('Chromium profile persistence: ' + (
                'confirmed.' if value.get('profilePersistent') is True else
                'not confirmed; credentials are stored privately on this NAS.'
                if value.get('profilePersistent') is False else
                'unknown; credentials are stored privately on this NAS.'), flush=True)
        if args.status:
            print(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False), flush=True)
        return 0 if value['status'] not in {'busy', 'manual_required', 'browser_unavailable'} else 2
    except SessionError as error:
        print(str(error), flush=True)
        return 2
    except (OSError, ValueError, TypeError):
        print('Automatic sign-in stopped; check the private NAS configuration and browser.', flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
