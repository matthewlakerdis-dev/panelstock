"""Capture a changed DONE callback through the proven v3 read-only browser guard."""
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import SimpleNamespace
from urllib.request import Request, urlopen
import zlib

REQUEST_ID = '56d29505-f653-45fe-9dbd-f3bc9f5d4654'
ROOT_URL = 'https://raw.githubusercontent.com/matthewlakerdis-dev/panelstock/'
INSTALLER_URL = ROOT_URL + '2f248b0abbe9843c897d44ec443a07ba4d2bb7fa/integrations/nexvia/releases/install_nexvia_quote_registration_update_v3.py'
INSTALLER_SHA = 'e210cba07777ffb9b812ea63d54fffe98595e5aa9014e831731ec57373f8cb4c'
PROBE_URL = ROOT_URL + '73aeae8b6a8ff5ae23a013b5fcc2bae86729f16a/integrations/nexvia/releases/inspect_nexvia_quote_registration_v1.py'
PROBE_SHA = '4bed8ec3d170f1b72ff22f5fbbe0b29aa6035b2de6e477dc2b7eb77241d96694'
VOCABULARY_SHA = 'f3437c0e06b4091ec6da5c3fbce76426eb669b1669d5efd0b81d29ccd96ab4af'
CREATOR_SHA = '98bd170cb83c43fe94094899ee8557605fcd18e533b4b394ca21c017c267d58c'
ALLOCATION_SHA = '071cb5f796b0cd91bfe1ce67d7c1799ea0066ae8119a78d2d19c715e6a3fefe9'
LOOKUPS_SHA = '500cf09a05975ef23d6a1b9a01c7398cd5db890bdf94c9ae6eb65d1430024ac3'
MAX_RELEASE = 1048576
MAX_CHILD = 524288
MAX_SOURCE = 131072
AUDIT_FIELDS = ('symbolicComplete', 'symbolicStatus', 'symbolicReason', 'sourceCharacters',
                'httpMethods', 'calls', 'responseFields', 'formDataFields', 'usesFormData', 'appendsData')
ERROR_TYPES = ('AssertionError', 'AttributeError', 'Error', 'TimeoutError', 'TypeError', 'ValueError',
               'KeyError', 'LookupError', 'QuoteAttachmentError', 'CreationError', 'CreateError', 'RegistrationError')
PHASES = frozenset({'startup', 'connect_browser', 'signed_in_context', 'open_draft',
                   'read_uploader_state', 'source_captured', 'validate_draft'})

CAPTURE_SOURCE = '''def capture_sources(state):
    widgets = state.get('widgets') if isinstance(state, dict) else None
    if not isinstance(widgets, list) or len(widgets) != 1 or not isinstance(widgets[0], dict):
        return None
    row = {key: widgets[0].get(key + 'Source') for key in ('done', 'send')}
    return row if all(isinstance(value, str) and 0 < len(value) <= 131072 for value in row.values()) else None
'''


def fetch_namespace(url, expected):
    data = urlopen(Request(url, headers={'User-Agent': 'PanelStock-Nexvia-Bridge/1.0'}), timeout=30).read(MAX_RELEASE + 1)
    if len(data) > MAX_RELEASE or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('download_verification')
    namespace = {'__name__': 'verified_readonly_diagnostic', '__file__': '/config/read_only_source_diagnostic.py'}
    exec(compile(data, namespace['__file__'], 'exec'), namespace)
    return namespace


def local_source(root, name, expected):
    descriptor = os.open(Path(root) / name, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o022:
            raise ValueError('local_source_file')
        data = stream.read(MAX_RELEASE + 1)
    if len(data) > MAX_RELEASE or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('local_source_verification')
    return data


def literal_errors(source):
    result = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        name = node.func.id if isinstance(node.func, ast.Name) else ''
        index = 1 if name in {'require', 'check'} else 0 if name.endswith('Error') else None
        if index is not None and len(node.args) > index:
            value = node.args[index]
            if isinstance(value, ast.Constant) and isinstance(value.value, str) and 0 < len(value.value) <= 240 \
                    and not re.search(r'[\x00-\x1f\x7f]', value.value):
                result.add(value.value)
    return frozenset(result)


def vocabulary(source):
    namespace = {'__name__': 'verified_callback_vocabulary'}
    exec(compile(source, '<verified-callback-vocabulary>', 'exec'), namespace)
    return SimpleNamespace(**namespace)


def inspect_sources(sources, probe, words):
    if not isinstance(sources, dict) or set(sources) != {'done', 'send'} or not all(
            isinstance(value, str) and 0 < len(value) <= MAX_SOURCE for value in sources.values()):
        return {'status': 'unavailable', 'code': 'callback_sources_missing'}
    done, send = sources['done'], sources['send']
    output = {'doneSourceSha256': hashlib.sha256(done.encode()).hexdigest(),
              'sendSourceSha256': hashlib.sha256(send.encode()).hexdigest(), 'status': 'blocked'}
    stage = 'load_parser'
    try:
        runtime = probe['frozen_runtime']()
        with runtime.runtime_bundle() as (_quote, parser, _hashes):
            stage = 'symbolic_callback'
            audit = {}
            output['sourceAudit'] = audit
            try:
                details = parser.symbolic_details(done, words)
                audit.update({key: details.get(key) for key in
                    ('symbolicComplete', 'symbolicStatus', 'symbolicReason', 'sourceCharacters')})
            except Exception as error:
                audit.update(symbolicStatus='failed', symbolicReason='symbolic_analysis_failed',
                             symbolicErrorType=safe_error_type(error))
            # A summary helper failure must not discard the independently
            # captured anonymous body or prevent the structural parser.
            stage = 'network_summary'
            try:
                row = parser.callback_report({'handlers': [{'kind': 'done', 'source': done}]}, words)[0]
                audit.update({key: row.get(key) for key in
                    ('httpMethods', 'calls', 'responseFields', 'formDataFields', 'usesFormData', 'appendsData')})
                audit['summaryStatus'] = 'complete'
            except Exception as error:
                audit.update(summaryStatus='failed', summaryErrorType=safe_error_type(error))
            stage = 'structural_contract'
            try:
                output['contract'] = probe['source_contract'](done, send, parser)[0]
                output.update(status='inspected', code='done_source_observed')
            except probe['RegistrationInspectionError'] as error:
                reason = str(error)
                output['code'] = reason if re.fullmatch(r'[a-z][a-z0-9_]{0,79}', reason) else 'contract_unsupported'
    except Exception as error:
        output.update(code='source_analysis_failed', errorType=safe_error_type(error))
    output['analysisStage'] = stage
    return output


def safe_error_type(error):
    name = type(error).__name__
    return name if name in ERROR_TYPES else 'UnexpectedError'


def report_chunks(value):
    raw = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()
    if len(raw) > 262144:
        raise ValueError('sanitized_report_size')
    encoded = base64.b64encode(zlib.compress(raw, 9)).decode()
    if len(encoded) > 32768:
        raise ValueError('encoded_report_size')
    rows = [encoded[index:index + 800] for index in range(0, len(encoded), 800)]
    return ['AUDIT ' + str(index + 1) + '/' + str(len(rows)) + ' ' + row for index, row in enumerate(rows)]


def prepare(installer, analyze, messages):
    source = installer['NATIVE_PREFLIGHT']
    marker = "            quote.validate_native_draft(state, request, editor['createPath'], native_snapshot=editor)"
    final = "    print(json.dumps(report, separators=(',', ':')))"
    error_end = "    report.update(passed=checkpoint['passed'], stage=checkpoint['stage'])"
    connect = "                browser = playwright.chromium.connect_over_cdp('http://127.0.0.1:9222', timeout=15000)"
    signed = "                assert signed_in is not None"
    state_read = "            state = editor['page'].evaluate(quote.NATIVE_STATE_JS,"
    for token in (marker, final, error_end, connect, signed, state_read):
        if source.count(token) != 1:
            raise ValueError('reader_version')
    source = CAPTURE_SOURCE + '\n' + source
    source = source.replace(connect, "                checkpoint['auditPhase'] = 'connect_browser'\n" + connect)
    source = source.replace(signed, "                checkpoint['auditPhase'] = 'signed_in_context'\n"
        "                if signed_in is None: checkpoint['auditReason'] = 'no_signed_in_context'\n" + signed +
        "\n                checkpoint['auditPhase'] = 'open_draft'")
    source = source.replace(state_read, "            checkpoint['auditPhase'] = 'read_uploader_state'\n" + state_read)
    source = source.replace(marker, "            checkpoint['callbackSources'] = capture_sources(state)\n"
        "            checkpoint['auditPhase'] = 'source_captured'\n"
        "            checkpoint['captureStatus'] = 'captured' if checkpoint['callbackSources'] is not None else 'missing'\n" + marker)
    error_addition = "        kind = type(error).__name__\n"
    error_addition += "        checkpoint['errorType'] = kind if kind in " + repr(ERROR_TYPES) + " else 'UnexpectedError'\n"
    error_addition += "        if str(error) in " + repr(messages) + ": checkpoint['auditReason'] = str(error)\n"
    source = source.replace(error_end, error_addition + error_end)
    source = source.replace(final, "    report['callbackSources'] = checkpoint.get('callbackSources')\n"
        "    report['captureStatus'] = checkpoint.get('captureStatus', 'not_reached')\n"
        "    report['auditPhase'] = checkpoint.get('auditPhase', 'startup')\n"
        "    report['auditReason'] = checkpoint.get('auditReason')\n"
        "    report['errorType'] = checkpoint.get('errorType')\n" + final)
    compile(source, '<read-only-callback-capture>', 'exec')
    installer['NATIVE_PREFLIGHT'] = source
    original_run = installer['subprocess'].run
    observed = {}
    def observe(*args, **kwargs):
        result = original_run(*args, **kwargs)
        command = args[0] if args else kwargs.get('args')
        if not (isinstance(command, list) and len(command) == 7 and command[4] == source):
            return result
        if result.returncode != 0 or len(result.stdout) > MAX_CHILD:
            observed.update(phase='child_process', code='child_capture_unavailable')
            return result
        report = json.loads(result.stdout)
        captured = report.pop('callbackSources', None)
        status = report.pop('captureStatus', None)
        phase = report.pop('auditPhase', None)
        reason = report.pop('auditReason', None)
        error_type = report.pop('errorType', None)
        # Remove private source before analysis and before the original verifier
        # can persist its sanitized preflight report, even when analysis fails.
        result.stdout = json.dumps(report, separators=(',', ':')).encode()
        observed.update(phase=phase if phase in PHASES else 'startup',
            captureStatus=status if status in {'captured', 'missing', 'not_reached'} else 'not_reached',
            errorType=error_type if error_type in ERROR_TYPES else None,
            reason=reason if reason in messages or reason == 'no_signed_in_context' else None)
        if captured is not None:
            try:
                observed['callback'] = analyze(captured)
            except Exception as error:
                observed['callback'] = {'status': 'blocked', 'code': 'source_analysis_failed', 'errorType': safe_error_type(error)}
        return result
    installer['subprocess'].run = observe
    return original_run, observed


def diagnose(installer, probe, words, creator_source, root=Path('/config')):
    files = installer['decoded_payload']()
    messages = literal_errors(files['nexvia_quote_attachment.py']) | literal_errors(creator_source)
    analyze = lambda value: inspect_sources(value, probe, words)
    original_run, observed = prepare(installer, analyze, messages)
    compatibility = 'blocked'
    try:
        with installer['lock_file'](root / 'panelstock-request-journal/.bridge.lock', 'Bridge busy; run this check again.', 30) as descriptor:
            installer['native_policy_preflight'](root, root / 'nexvia-tools/bin/python', files, REQUEST_ID, bridge_lock_fd=descriptor)
        compatibility = 'passed'
    except installer['QuotePolicyUpdateError'] as error:
        # This exception has a fixed local message, never native/browser text.
        print(str(error))
    except Exception as error:
        observed.update(phase='parent_preflight', code='diagnostic_stopped', errorType=safe_error_type(error))
    finally:
        installer['subprocess'].run = original_run
    print('Source capture:', observed.get('captureStatus', 'not_reached'), 'at', observed.get('phase', 'startup'))
    if observed.get('reason'):
        print('Capture reason:', observed['reason'])
    if observed.get('errorType'):
        print('Capture error type:', observed['errorType'])
    output = {'format': 'nexvia-done-source-v2', 'version': 2, 'requestId': REQUEST_ID,
              'readOnly': True, 'compatibility': compatibility, **observed}
    for row in report_chunks(output):
        print(row)
    print('No callback invoked; no policy lookup, upload, registration, PO or email performed.')
    return output


def main():
    sys.dont_write_bytecode = True
    root = Path('/config')
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    installer = fetch_namespace(INSTALLER_URL, INSTALLER_SHA)
    probe = fetch_namespace(PROBE_URL, PROBE_SHA)
    words = vocabulary(local_source(root, 'nexvia_inspect_quote_upload.py', VOCABULARY_SHA))
    validators = b'\n'.join(local_source(root, name, expected) for name, expected in (
        ('nexvia_create.py', CREATOR_SHA), ('nexvia_allocations.py', ALLOCATION_SHA),
        ('nexvia_lookups.py', LOOKUPS_SHA)))
    return diagnose(installer, probe, words, validators, root)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Read-only diagnostic stopped:', safe_error_type(error))
