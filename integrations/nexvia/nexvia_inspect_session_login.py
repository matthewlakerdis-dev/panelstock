"""Read only anonymous Nexvia login metadata; never read or submit credentials."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urljoin, urlsplit

PINS = {
    'nexvia_session_keeper': '0cba4e0514648658ff704f17e78b31dce871da781f19ffad1f24cca4e66dfd81',
    'nexvia_session_browser': '48e11c454244d7fdcd9a9537186a16a1b107d698effc0add801447a88eb41be6',
}
READ_METHODS = frozenset({'GET', 'HEAD', 'OPTIONS'})
PUBLIC_PATHS = frozenset({'/', '/staff', '/staff/', '/staff/projects', '/staff/projects/'} | {
    prefix + name + slash for prefix in ('/', '/staff/')
    for name in ('login', 'log-in', 'signin', 'sign-in', 'authenticate', 'session',
                 'session/login', 'auth', 'auth/login') for slash in ('', '/')})
PUBLIC_AUTH_WORDS = frozenset({'staff', 'login', 'log-in', 'signin', 'sign-in', 'authenticate',
    'session', 'auth', 'account', 'accounts', 'user', 'users', 'authentication', 'index', 'site', 'security'})
REASONS = frozenset({'native_password_form', 'verification_required', 'native_login_changed',
                     'native_login_unavailable', 'login_discovery_unavailable'})

EXTRA_DOM_JS = r'''() => {
 const visible=el=>{if(!el||!el.getClientRects().length)return false;for(let n=el;n&&n.nodeType===1;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse')return false;}return true;};
 const cap=n=>Math.min(1000,n);
 return {iframeCount:cap(document.querySelectorAll('iframe').length),
   challengeIframeCount:cap(document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"]').length),
   challengeMarkerCount:cap(document.querySelectorAll('[data-sitekey],.g-recaptcha,.h-captcha').length),
   visibleOTPCount:cap([...document.querySelectorAll('input[autocomplete="one-time-code"],input[name*="otp" i],input[name*="verification" i],input[name*="authenticator" i]')].filter(visible).length),
   forms:[...document.forms].slice(0,12).map(form=>({
     associatedOutsideCount:cap([...form.elements].filter(el=>!form.contains(el)).length),
     overrideButtons:[...form.querySelectorAll('button,input[type="submit"]')].slice(0,20).filter(el=>['formaction','formmethod','formtarget','formenctype'].some(k=>el.hasAttribute(k))).map(el=>({
       kinds:['formaction','formmethod','formtarget','formenctype'].filter(k=>el.hasAttribute(k)),
       actionEquivalent:el.formAction===form.action,methodEquivalent:el.formMethod===form.method,
       targetEquivalent:el.formTarget===form.target,encodingEquivalent:el.formEnctype===form.enctype
     }))
   }))};
}'''


class InspectionError(ValueError):
    pass


def _count(value):
    return min(value, 1000) if type(value) is int and value >= 0 else None


def _enum(value, allowed):
    return value if type(value) is str and value in allowed else 'other'


def error_summary(error, phase):
    """Expose fixed categories and script coordinates, never exception text."""
    message = str(error)[:20000]
    lower = message.lower()
    if any(value in lower for value in ('execution context was destroyed', 'cannot find context',
                                       'most likely because of a navigation')):
        category = 'evaluation_context_changed'
    elif any(value in lower for value in ('target page, context or browser has been closed', 'target closed')):
        category = 'page_closed'
    elif 'queryselectorall is not a function' in lower:
        category = 'form_dom_clobbered'
    elif 'typeerror' in lower:
        category = 'javascript_type_error'
    elif 'referenceerror' in lower:
        category = 'javascript_reference_error'
    elif type(error).__name__ == 'TimeoutError':
        category = 'timeout'
    else:
        category = 'reader_error'
    coordinates = []
    for line, column in re.findall(r'<anonymous>:([0-9]{1,5}):([0-9]{1,5})', message):
        pair = {'line': int(line), 'column': int(column)}
        if 0 < pair['line'] <= 10000 and 0 < pair['column'] <= 10000 and pair not in coordinates:
            coordinates.append(pair)
        if len(coordinates) == 3:
            break
    return {'phase': _enum(phase, {'dom_state', 'form_summary', 'settled_state', 'settled_summary'}),
            'category': category, 'coordinates': coordinates}


def url_shape(value):
    """Only a fixed public auth path may escape; all other paths are hashed."""
    try:
        target = urlsplit(value)
        host = 'nexvia' if target.hostname == 'lennox.nexvia.com.au' else 'other'
        parts = target.path.strip('/').split('/')
        public = target.path in PUBLIC_PATHS or (1 <= len(parts) <= 3
            and all(part in PUBLIC_AUTH_WORDS for part in parts)
            and target.path in {'/' + '/'.join(parts), '/' + '/'.join(parts) + '/'})
        path = {'public': target.path} if public else {
            'sha256': hashlib.sha256(target.path.encode()).hexdigest(),
            'segments': min(100, len([part for part in target.path.split('/') if part]))}
        return {'host': host, 'https': target.scheme == 'https', 'path': path,
                'hasQuery': bool(target.query), 'hasUserInfo': target.username is not None or target.password is not None}
    except (TypeError, ValueError, AttributeError):
        return {'invalid': True}


def extra_summary(value):
    value = value if isinstance(value, dict) else {}
    output = {key: _count(value.get(key)) for key in
              ('iframeCount', 'challengeIframeCount', 'challengeMarkerCount', 'visibleOTPCount')}
    forms = value.get('forms')
    output['forms'] = []
    for form in forms[:12] if isinstance(forms, list) else []:
        if not isinstance(form, dict):
            continue
        buttons = []
        for button in form.get('overrideButtons', [])[:20] if isinstance(form.get('overrideButtons'), list) else []:
            if not isinstance(button, dict):
                continue
            buttons.append({'kinds': [key for key in ('formaction', 'formmethod', 'formtarget', 'formenctype')
                                      if key in button.get('kinds', [])],
                            **{key: button.get(key) if type(button.get(key)) is bool else None for key in
                               ('actionEquivalent', 'methodEquivalent', 'targetEquivalent', 'encodingEquivalent')}})
        output['forms'].append({'associatedOutsideCount': _count(form.get('associatedOutsideCount')),
                                'overrideButtons': buttons})
    return output


def state_summary(state, browser):
    state = state if isinstance(state, dict) else {}
    native, reason = browser.native_form(state)
    output = {'supported': native is not None, 'reason': reason if reason in REASONS else 'other',
              'page': url_shape(state.get('url')), 'challenge': state.get('challenge') is True,
              'visiblePasswordCount': _count(state.get('passwords')),
              'baseTargetAllowed': state.get('baseTarget', '') in {'', '_self'}, 'forms': []}
    forms = state.get('forms')
    for form in forms[:12] if isinstance(forms, list) else []:
        if not isinstance(form, dict):
            continue
        inputs = form.get('inputs') if isinstance(form.get('inputs'), list) else []
        buttons = form.get('buttons') if isinstance(form.get('buttons'), list) else []
        inputs, buttons = inputs[:80], buttons[:20]
        enabled = [x for x in inputs if isinstance(x, dict) and x.get('visible') is True
                   and x.get('disabled') is False and x.get('owner') is True]
        users = [x for x in enabled if x.get('type') in {'text', 'email'}]
        text_count = len(users)
        if len(users) > 1:
            users = [x for x in users if x.get('autocomplete') in {'username', 'email'}
                     or re.search(r'(?:user|email|login)', x.get('name', ''), re.I)]
        passwords = [x for x in enabled if x.get('type') == 'password']
        submits = [x for x in buttons if isinstance(x, dict) and x.get('type') == 'submit'
                   and x.get('visible') is True and x.get('disabled') is False and x.get('owner') is True
                   and x.get('overrides') is False]
        submit_count = len(submits)
        if len(submits) > 1:
            submits = [x for x in submits if re.fullmatch(r'(?:sign\s*in|log\s*in|login)', x.get('text', ''), re.I)]
        one = dict(state, forms=[form])
        candidate, _ = browser.native_form(one)
        output['forms'].append({
            'method': _enum(form.get('method'), {'GET', 'POST'}), 'action': url_shape(form.get('action')),
            'actionAllowed': bool(browser._auth_url(form.get('action'))),
            'targetAllowed': form.get('target', '') in {'', '_self'},
            'encoding': _enum(form.get('encoding'), {'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'}),
            'eligible': candidate is not None, 'inputCount': len(inputs), 'buttonCount': len(buttons),
            'disabledInputCount': sum(isinstance(x, dict) and x.get('disabled') is True for x in inputs),
            'foreignInputCount': sum(isinstance(x, dict) and x.get('owner') is False for x in inputs),
            'disabledButtonCount': sum(isinstance(x, dict) and x.get('disabled') is True for x in buttons),
            'foreignButtonCount': sum(isinstance(x, dict) and x.get('owner') is False for x in buttons),
            'visibleTextEmailCount': text_count, 'eligibleUsernameCount': len(users),
            'eligiblePasswordCount': len(passwords), 'eligibleSubmitCountBeforeText': submit_count,
            'eligibleSubmitCount': len(submits),
            'buttonTypes': {kind: sum(isinstance(x, dict) and x.get('type') == kind for x in buttons)
                            for kind in ('submit', 'button', 'reset', 'image')},
            'overrideButtonCount': sum(isinstance(x, dict) and x.get('overrides') is True for x in buttons),
            'usernameNamed': len(users) == 1 and bool(users[0].get('name')),
            'passwordNamed': len(passwords) == 1 and bool(passwords[0].get('name')),
            'namesDistinct': len(users) == len(passwords) == 1 and users[0].get('name') != passwords[0].get('name'),
            'checkboxCount': sum(x.get('type') == 'checkbox' for x in enabled),
        })
    return output


def verified_modules(root):
    """Read the two exact installed modules with no import-time filesystem writes."""
    root = Path(root)
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    sources = {}
    try:
        for name, expected in PINS.items():
            fd = os.open(name + '.py', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
            with os.fdopen(fd, 'rb') as stream:
                before = os.fstat(stream.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_mode & 0o022:
                    raise InspectionError('Installed session modules are unsafe; inspection stopped.')
                raw = stream.read(131073)
                after = os.fstat(stream.fileno())
            identity = lambda info: (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
                                     info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            if identity(before) != identity(after) or len(raw) > 131072 or hashlib.sha256(raw).hexdigest() != expected:
                raise InspectionError('Installed session modules differ; inspection stopped.')
            sources[name] = raw
    finally:
        os.close(descriptor)
    modules = []
    for name in PINS:
        spec = importlib.util.spec_from_loader('_verified_login_inspection_' + name, loader=None)
        module = importlib.util.module_from_spec(spec)
        module.__file__ = str(root / (name + '.py'))
        exec(compile(sources[name], module.__file__, 'exec'), module.__dict__)
        modules.append(module)
    return modules


class _ObservedRoute:
    def __init__(self, route, report, browser):
        self.route, self.report, self.browser = route, report, browser

    def __getattr__(self, name):
        return getattr(self.route, name)

    def fetch(self, *args, **kwargs):
        request = self.route.request
        method = kwargs.get('method', request.method).upper()
        target = kwargs.get('url', request.url)
        if method not in READ_METHODS or not self.browser._safe_read(target, request.resource_type):
            raise InspectionError('Read-only transport blocked.')
        response = self.route.fetch(*args, **kwargs)
        row = {'status': response.status if type(response.status) is int else None, 'target': url_shape(target)}
        location = response.headers.get('location')
        if response.status in {301, 302, 303, 307, 308} and isinstance(location, str):
            row['redirect'] = url_shape(urljoin(target, location))
        if row not in self.report['responses'] and len(self.report['responses']) < 16:
            self.report['responses'].append(row)
        return response


def inspect_adapter(adapter, browser):
    report = {'format': 'nexvia-session-login-inspection', 'version': 1, 'stage': 'anonymous_context',
              'supported': False, 'reason': 'login_discovery_unavailable', 'responses': [], 'blocked': [],
              'immediate': None, 'settled': None, 'settlePasses': 0, 'readerError': None,
              'credentialsRead': False, 'credentialsSubmitted': False}
    original_guard, original_response, original_state = adapter._guard, adapter._response, adapter._state
    original_prepare, original_navigate = adapter._prepare_page, adapter._navigate

    def prepare(page, *args, **kwargs):
        report['stage'] = 'prepare_guard'
        return original_prepare(page, *args, **kwargs)

    def navigate(page, target):
        report['stage'] = 'navigate'
        return original_navigate(page, target)

    def guard(route):
        request = route.request
        method = request.method.upper()
        if method not in READ_METHODS or not adapter._can_read(request.url, request.resource_type):
            row = {'method': _enum(method, READ_METHODS | {'POST', 'PUT', 'PATCH', 'DELETE'}),
                   'resource': _enum(request.resource_type, {'document', 'script', 'stylesheet', 'image', 'font', 'xhr', 'fetch'}),
                   'target': url_shape(request.url)}
            if row not in report['blocked'] and len(report['blocked']) < 12:
                report['blocked'].append(row)
            return route.abort()
        return original_guard(route)

    def response(route):
        return original_response(_ObservedRoute(route, report, browser))

    def summarize(page, state):
        result = state_summary(state, browser)
        try:
            result['markers'] = extra_summary(page.evaluate(EXTRA_DOM_JS))
        except Exception:
            result['markers'] = None
        return result

    def state(page):
        report['stage'] = 'native_form'
        def observed(operation, phase):
            try:
                return operation()
            except Exception as error:
                report['readerError'] = error_summary(error, phase)
                raise
        current = observed(lambda: original_state(page), 'dom_state')
        report['immediate'] = observed(lambda: summarize(page, current), 'form_summary')
        for index in range(20):
            if browser.native_form(current)[0] is not None:
                break
            page.wait_for_timeout(200)
            current = observed(lambda: original_state(page), 'settled_state')
            report['settlePasses'] = index + 1
        report['settled'] = observed(lambda: summarize(page, current), 'settled_summary')
        return current

    adapter._guard, adapter._response, adapter._state = guard, response, state
    adapter._prepare_page, adapter._navigate = prepare, navigate
    try:
        result = adapter.inspect_login()
        report['supported'] = isinstance(result, dict) and result.get('supported') is True
        reason = result.get('reason') if isinstance(result, dict) else None
        report['reason'] = reason if reason in REASONS else 'login_discovery_unavailable'
        if report['settled'] is not None:
            report['stage'] = 'complete'
    except Exception:
        report['reason'] = 'inspection_unavailable'
    finally:
        adapter._guard, adapter._response, adapter._state = original_guard, original_response, original_state
        adapter._prepare_page, adapter._navigate = original_prepare, original_navigate
    return report


def form_console_summary(report):
    immediate, settled = report['immediate'], report['settled']
    if immediate is not None and immediate == settled:
        immediate = {key: immediate[key] for key in ('supported', 'reason', 'visiblePasswordCount')}
        immediate.update(formCount=len(settled['forms']), sameAsSettled=True)
    return {'immediate': immediate, 'settled': settled, 'settlePasses': report['settlePasses']}


def main(argv=None):
    if argv:
        raise InspectionError('This read-only check takes no arguments.')
    sys.dont_write_bytecode = True
    try:
        keeper, browser = verified_modules(Path('/config'))
        with keeper.bridge_lock(Path('/config')), browser.browser_session() as adapter:
            report = inspect_adapter(adapter, browser)
    except InspectionError:
        raise
    except Exception:
        raise InspectionError('Read-only session inspection unavailable; no credential operation was invoked.') from None
    print('Login inspection:', json.dumps({key: report[key] for key in
          ('stage', 'supported', 'reason', 'responses', 'readerError')}, separators=(',', ':')))
    print('Form checks:', json.dumps(form_console_summary(report), separators=(',', ':')))
    print('Blocked requests:', json.dumps(report['blocked'], separators=(',', ':')))
    print('No credentials were read or submitted. Existing signed-in tabs were preserved.')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main(sys.argv[1:]))
    except InspectionError as error:
        raise SystemExit(str(error)) from None
