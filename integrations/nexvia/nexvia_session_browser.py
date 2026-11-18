"""Restore only Nexvia authentication in the existing NAS Chromium profile.

The caller holds the request bridge lock. This adapter never calls a purchase
request, attachment or PO entrypoint and never navigates a user's existing tab.
"""

from contextlib import contextmanager
import json
import os
from pathlib import PurePosixPath
import posixpath
import re
from urllib.parse import parse_qsl, urljoin, urlsplit


MODULE_VERSION = 1
ORIGIN = "https://lennox.nexvia.com.au"
HEALTH_URL = ORIGIN + "/staff/projects"
ANCHOR_NAME = "panelstock-nexvia-session-v1"
READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
TIMEOUT_MS = 30000
AUTH_PATH = re.compile(r"^/(?:staff/)?(?:login|log-in|signin|sign-in|authenticate|session(?:/login)?|auth(?:/login)?)/?$", re.I)
FORBIDDEN = re.compile(r"(?:purchase[-_]order|project[-_]purchase|/upload(?:/|$)|/attachments?(?:/|$)|/(?:logout|log-out|delete|remove|save|send|email|print|approve|stock|outlook|reset|recover)(?:/|$))", re.I)
STATIC_EXT = re.compile(r"\.(?:js|css|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf)$", re.I)
STATIC_HOSTS = frozenset({"cdnjs.cloudflare.com", "cdn.jsdelivr.net", "ajax.googleapis.com", "fonts.googleapis.com", "fonts.gstatic.com"})
SAFE_CACHE_KEYS = frozenset({"v", "ver", "version", "_", "family", "display"})
STATES = frozenset({"signed_in", "signed_out", "manual_required", "unavailable"})


DOM_STATE_JS = r"""() => {
 const visible=el=>{if(!el||!el.getClientRects().length)return false;for(let n=el;n&&n.nodeType===1;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse')return false;}return true;};
 const short=v=>typeof v==='string'&&v.length<=180&&!/[\x00-\x1f\x7f]/.test(v)?v:'';
 const text=el=>short(String(el?.textContent||'').replace(/\s+/g,' ').trim());
 const challenge=[...document.querySelectorAll('input[autocomplete="one-time-code"],input[name*="otp" i],input[name*="verification" i],input[name*="authenticator" i]')].some(visible)
   ||!!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],[data-sitekey],.g-recaptcha,.h-captcha');
 const passwords=[...document.querySelectorAll('input[type="password"]')].filter(visible).length;
 const projectLinks=[...document.querySelectorAll('a[href]')].some(el=>{try{const u=new URL(el.getAttribute('href'),location.href);return u.origin===location.origin&&/^\/staff\/project\/[1-9][0-9]*\/modify\/?$/.test(u.pathname);}catch{return false;}});
 const forms=[...document.forms].slice(0,12).map((form,index)=>({index,method:String(form.method||'GET').toUpperCase(),action:form.action,
   target:short(form.target),encoding:String(form.enctype||'').toLowerCase(),
   inputs:[...form.querySelectorAll('input')].slice(0,80).map((el,index)=>({index,type:String(el.type||'text').toLowerCase(),name:short(el.name),autocomplete:short(el.autocomplete),disabled:el.disabled===true,visible:visible(el),owner:el.form===form,
     label:short([...el.labels||[]].map(text).join(' '))})),
   buttons:[...form.querySelectorAll('button,input[type="submit"]')].slice(0,20).map((el,index)=>({index,type:String(el.type||'submit').toLowerCase(),name:short(el.name),disabled:el.disabled===true,visible:visible(el),owner:el.form===form,
     overrides:['formaction','formmethod','formtarget','formenctype'].some(name=>el.hasAttribute(name)),
     text:el.tagName==='INPUT'?'':text(el)}))}));
 return {url:location.href,challenge,passwords,projectLinks,baseTarget:short(document.querySelector('base[target]')?.target||''),forms};
}"""


def _result(state, reason):
    return {"state": state, "reason": reason}


def _parsed(value):
    if not isinstance(value, str) or len(value) > 4096 or re.search(r"[\x00-\x20\x7f\\]", value):
        return None
    try:
        u = urlsplit(value)
        if u.scheme != "https" or u.username is not None or u.password is not None or u.port not in {None, 443} or u.fragment:
            return None
        return u
    except ValueError:
        return None


def _same_origin(value):
    u = _parsed(value)
    return u if u is not None and u.hostname == "lennox.nexvia.com.au" else None


def _auth_url(value):
    u = _same_origin(value)
    return u is not None and not _credential_query(value) and not FORBIDDEN.search(u.path) and (u.path in {"/", "/staff", "/staff/"} or AUTH_PATH.fullmatch(u.path))


def _credential_query(value, secrets=()):
    try:
        pairs = parse_qsl(urlsplit(value).query, keep_blank_values=True, max_num_fields=40)
        return any(re.search(r"password|passwd|pwd|username|email", re.sub(r"[^a-z]", "", key.lower()))
                   or any(secret and secret in item for secret in secrets) for key, item in pairs)
    except (ValueError, TypeError):
        return True


def _safe_read(value, resource):
    u = _parsed(value)
    if u is None or _credential_query(value) or FORBIDDEN.search(u.path):
        return False
    if u.hostname == "lennox.nexvia.com.au":
        return u.path.rstrip("/") in {"/staff/projects", "/staff/dashboard", "/staff/index", "/staff/home"} or _auth_url(value) or bool(
            resource in {"script", "stylesheet", "image", "font"} and STATIC_EXT.search(u.path))
    return bool(u.hostname in STATIC_HOSTS and resource in {"script", "stylesheet", "font", "image"}
                and (STATIC_EXT.search(u.path) or u.hostname == "fonts.googleapis.com" and u.path in {"/css", "/css2"})
                and all(key in SAFE_CACHE_KEYS for key, _value in parse_qsl(u.query, keep_blank_values=True)))


def profile_persistence(path, incognito, mountinfo):
    """Prove a persistent /config mount without returning private paths/argv."""
    if not isinstance(path, str) or not path.startswith("/"):
        return {"underConfig": None, "persistent": None}
    path = posixpath.normpath(path)
    under = PurePosixPath(path).is_relative_to("/config")
    if not under or incognito is True:
        return {"underConfig": under, "persistent": False}
    mounted = False
    if isinstance(mountinfo, str) and len(mountinfo) <= 1048576:
        for line in mountinfo.splitlines():
            pieces = line.split(" - ", 1)
            if len(pieces) != 2:
                continue
            left, right = pieces[0].split(), pieces[1].split()
            if len(left) < 5 or not right or right[0] in {"tmpfs", "ramfs", "overlay"}:
                continue
            target = re.sub(r"\\([0-7]{3})", lambda value: chr(int(value.group(1), 8)), left[4])
            if target.startswith("/config") and PurePosixPath(target).is_relative_to("/config") \
                    and PurePosixPath(path).is_relative_to(target):
                mounted = True
                break
    return {"underConfig": under, "persistent": mounted if incognito is False else None}


def native_form(state):
    """Resolve one native password form, without inspecting any input values."""
    if not isinstance(state, dict) or state.get("challenge") is True:
        return None, "verification_required"
    if state.get("baseTarget", "") not in {"", "_self"}:
        return None, "native_login_changed"
    forms = state.get("forms")
    if not isinstance(forms, list):
        return None, "native_login_unavailable"
    candidates = []
    for form in forms:
        if not isinstance(form, dict) or form.get("method") != "POST" or not _auth_url(form.get("action")) or form.get("target", "") not in {"", "_self"} \
                or form.get("encoding") not in {"application/x-www-form-urlencoded", "multipart/form-data"}:
            continue
        inputs = form.get("inputs")
        buttons = form.get("buttons")
        if not isinstance(inputs, list) or not isinstance(buttons, list):
            continue
        enabled = [x for x in inputs if isinstance(x, dict) and x.get("visible") is True and x.get("disabled") is False and x.get("owner") is True]
        passwords = [x for x in enabled if x.get("type") == "password"]
        if len(passwords) != 1:
            continue
        users = [x for x in enabled if x.get("type") in {"text", "email"}]
        if len(users) > 1:
            users = [x for x in users if x.get("autocomplete") in {"username", "email"}
                     or re.search(r"(?:user|email|login)", x.get("name", ""), re.I)]
        submits = [x for x in buttons if isinstance(x, dict) and x.get("type") == "submit"
                   and x.get("visible") is True and x.get("disabled") is False and x.get("owner") is True
                   and x.get("overrides") is False]
        if len(submits) > 1:
            submits = [x for x in submits if re.fullmatch(r"(?:sign\s*in|log\s*in|login)", x.get("text", ""), re.I)]
        remembers = [x for x in enabled if x.get("type") == "checkbox" and re.search(
            r"\b(?:remember\s*me|keep\s*me\s*(?:signed|logged)\s*in|stay\s*(?:signed|logged)\s*in)\b", x.get("label", ""), re.I)]
        if len(users) != 1 or len(submits) != 1 or len(remembers) > 1:
            continue
        if any(type(x.get("index")) is not int or x["index"] < 0 for x in (form, users[0], passwords[0], submits[0], *remembers)):
            continue
        username, password, submit = users[0], passwords[0], submits[0]
        if not username.get("name") or not password.get("name") or username["name"] == password["name"]:
            continue
        u = _same_origin(form["action"])
        schema = {"version": 1, "method": "POST", "actionPath": u.path,
                  "actionQueryKeys": sorted({key for key, _value in parse_qsl(u.query, keep_blank_values=True)}),
                  "usernameName": username["name"], "usernameType": username["type"],
                  "passwordName": password["name"], "passwordType": "password",
                  "rememberName": remembers[0]["name"] if remembers else None,
                  "submitName": submit["name"], "submitText": submit.get("text", "").casefold()}
        candidates.append({"form": form, "username": username, "password": password, "submit": submit,
                           "remember": remembers[0] if remembers else None, "schema": schema})
    return (candidates[0], "native_password_form") if len(candidates) == 1 else (None, "native_login_changed")


class SessionBrowser:
    def __init__(self, browser):
        if not browser.contexts:
            raise ValueError("persistent_browser_unavailable")
        self.browser = browser
        self.context = browser.contexts[0]
        self.page = None
        self.anchor_page = None
        self._post_action = None
        self._post_budget = 0
        self._post_count = 0
        self._denied = False
        self._unsafe_redirect = False
        self._scope_violation = False
        self._sensitive = ()
        self._redirects = {}
        self._routes = []
        self._sessions = []
        self._seen_reads = set()
        self._known_pages = set(self.context.pages)
        self._context_handler = self._context_guard
        self._page_handler = self._new_page
        self.context.route("**/*", self._context_handler)
        self.context.on("page", self._page_handler)

    def _from_work_page(self, page):
        for _index in range(6):
            if page is self.page:
                return True
            try:
                page = page.opener()
            except Exception:
                return False
            if page is None:
                return False
        return False

    def _new_page(self, page):
        if page is self.page or page is self.anchor_page:
            return
        try:
            opener = page.opener()
            if opener is not None and self._from_work_page(opener):
                self._scope_violation = True
                page.close()
        except Exception:
            pass

    def _context_guard(self, route):
        request = route.request
        try:
            page = request.frame.page
        except Exception:
            if self._sensitive or self._post_budget:
                self._scope_violation = True
                return route.abort()
            return route.fallback()
        if page is self.page or page is self.anchor_page:
            return route.fallback()
        if self._from_work_page(page):
            self._scope_violation = True
            return route.abort()
        try:
            unknown_navigation = page not in self._known_pages and request.is_navigation_request()
        except Exception:
            unknown_navigation = True
        if unknown_navigation and (self._sensitive or self._post_budget):
            self._scope_violation = True
            return route.abort()
        return route.fallback()

    def _response(self, route):
        """Never give Chromium an unchecked redirect, including POST replay."""
        request = route.request
        response = route.fetch(max_redirects=0, timeout=TIMEOUT_MS)
        method = request.method.upper()
        current_url = request.url
        for _index in range(6):
            if response.status not in {301, 302, 303, 307, 308}:
                return route.fulfill(response=response)
            headers = response.headers
            location = headers.get("location")
            target = urljoin(current_url, location) if isinstance(location, str) else None
            permitted = target is not None and self._can_read(target, request.resource_type)
            if method == "POST" and response.status not in {302, 303}:
                permitted = False
            if not permitted:
                self._unsafe_redirect = True
                self._denied = True
                return route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>Sign-in requires review</title>")
            if method == "POST" or request.is_navigation_request():
                self._redirects[request.frame.page] = target
                clean = {key: value for key, value in headers.items() if key.lower() not in {"location", "content-length", "content-encoding", "content-type"}}
                clean.update({"content-type": "text/html; charset=utf-8", "cache-control": "no-store"})
                return route.fulfill(status=200, headers=clean, body="<!doctype html><title>Restoring Nexvia session</title>")
            # Static assets may redirect, but each hop is fetched explicitly and
            # remains a read of an approved asset; no Location reaches Chromium.
            response = route.fetch(url=target, method="GET", max_redirects=0, timeout=TIMEOUT_MS)
            method = "GET"
            current_url = target
        self._unsafe_redirect = True
        return route.fulfill(status=200, content_type="text/plain", body="")

    def _can_read(self, url, resource):
        if _credential_query(url, self._sensitive) or not _safe_read(url, resource):
            return False
        if not self._sensitive or url in self._seen_reads:
            return True
        # Native redirects to a fixed, query-free authenticated/authentication
        # page are safe. New assets and new query values are frozen while any
        # password is present, including encoded values unrecognizable as text.
        parsed = _same_origin(url)
        return bool(resource not in {"script", "stylesheet", "font", "image"}
                    and parsed is not None and not parsed.query)

    def _guard(self, route):
        request = route.request
        method = request.method.upper()
        if _credential_query(request.url, self._sensitive):
            self._denied = True
            return route.abort()
        allowed = method in READ_METHODS and self._can_read(request.url, request.resource_type)
        if allowed and not self._sensitive:
            self._seen_reads.add(request.url)
        if method == "POST" and self._post_budget == 1 and self._post_action == request.url and _auth_url(request.url):
            self._post_budget = 0
            self._post_count += 1
            allowed = True
        if not allowed:
            self._denied = True
            return route.abort()
        try:
            return self._response(route)
        except Exception:
            self._denied = True
            return route.abort()

    def _bypass_worker(self, page):
        session = page.context.new_cdp_session(page)
        try:
            session.send("Network.setBypassServiceWorker", {"bypass": True})
            session.send("Network.setCacheDisabled", {"cacheDisabled": True})
        except Exception:
            session.detach()
            raise ValueError("browser_guard_unavailable") from None
        self._sessions.append(session)

    def _prepare_page(self, page, active=True):
        self._bypass_worker(page)
        handler = self._guard
        page.route("**/*", handler)
        self._routes.append((page, handler))
        if active:
            if not callable(getattr(page, "route_web_socket", None)):
                raise ValueError("browser_guard_unavailable")
            page.route_web_socket("**/*", lambda socket: socket.close())
            page.add_init_script("window.open=()=>null;window.print=()=>undefined;")
        return page

    def _work(self):
        if self.page is None or self.page.is_closed():
            self.page = self.context.new_page()
            self._prepare_page(self.page)
        return self.page

    def _navigate(self, page, target):
        for _index in range(7):
            self._redirects.pop(page, None)
            response = page.goto(target, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            target = self._redirects.pop(page, None)
            if target is None:
                return response
            if not _safe_read(target, "document"):
                self._unsafe_redirect = True
                raise ValueError("native_redirect_changed")
        self._unsafe_redirect = True
        raise ValueError("native_redirect_changed")

    @staticmethod
    def _state(page):
        value = page.evaluate(DOM_STATE_JS)
        if not isinstance(value, dict):
            raise ValueError("native_state_unavailable")
        return value

    def _health(self, page):
        response = self._navigate(page, HEALTH_URL)
        try:
            page.wait_for_function("() => {const s=(" + DOM_STATE_JS + ")();return s.challenge||s.passwords>0||s.projectLinks;}", timeout=5000)
        except Exception:
            pass
        state = self._state(page)
        if state.get("challenge") is True:
            return _result("manual_required", "verification_required")
        u = _same_origin(page.url)
        if response is not None and response.status == 200 and u is not None and u.path.rstrip("/") == "/staff/projects" \
                and state.get("projectLinks") is True and state.get("passwords") == 0:
            return _result("signed_in", "authenticated_projects")
        if response is None or response.status != 200 or not _auth_url(page.url):
            return _result("unavailable", "session_unverified")
        native, reason = native_form(state)
        if native is not None:
            return _result("signed_out", "native_password_form")
        return _result("manual_required", reason) if state.get("passwords", 0) else _result("unavailable", "session_unverified")

    def _publish_anchor(self):
        if self.anchor_page is None:
            candidates = []
            for page in self.context.pages[:100]:
                if page is self.page or _same_origin(page.url) is None:
                    continue
                try:
                    if page.evaluate("() => window.name === " + json.dumps(ANCHOR_NAME)) is True:
                        candidates.append(page)
                except Exception:
                    pass
            if len(candidates) > 1:
                return False
            self.anchor_page = candidates[0] if candidates else None
        if self.anchor_page is not None and not self.anchor_page.is_closed() \
                and self.anchor_page.url.rstrip("/") == HEALTH_URL:
            return True
        if self.anchor_page is None or self.anchor_page.is_closed():
            self.anchor_page = self.context.new_page()
            self.anchor_page.evaluate("value => {window.name=value;}", ANCHOR_NAME)
        # This retained tab has no websocket/init-script hook. Only its initial
        # authenticated load is protected, and those removable hooks are removed.
        page = self.anchor_page
        before_sessions = len(self._sessions)
        verified = False
        try:
            self._prepare_page(page, active=False)
            verified = self._health(page)["state"] == "signed_in"
            if verified:
                page.evaluate("value => {window.name=value;}", ANCHOR_NAME)
        except Exception:
            verified = False
        finally:
            for item, handler in self._routes:
                if item is page:
                    try:
                        page.unroute("**/*", handler)
                    except Exception:
                        pass
            self._routes = [(item, handler) for item, handler in self._routes if item is not page]
            for session in self._sessions[before_sessions:]:
                try:
                    session.send("Network.setBypassServiceWorker", {"bypass": False})
                    session.send("Network.setCacheDisabled", {"cacheDisabled": False})
                except Exception:
                    pass
                try:
                    session.detach()
                except Exception:
                    pass
            del self._sessions[before_sessions:]
        if not verified:
            page.close()
            self.anchor_page = None
        return verified

    def check(self):
        self._post_action = None
        self._post_budget = 0
        self._unsafe_redirect = False
        try:
            result = self._health(self._work())
            if self._unsafe_redirect:
                return _result("manual_required", "native_login_changed")
            if result["state"] == "signed_in" and not self._publish_anchor():
                return _result("unavailable", "session_anchor_unavailable")
            return result
        except Exception:
            return _result("unavailable", "browser_unavailable")

    def inspect_login(self):
        context = None
        try:
            context = self.browser.new_context(service_workers="block", accept_downloads=False)
            page = context.new_page()
            def discovery_guard(route):
                try:
                    if route.request.frame.page is not page:
                        return route.abort()
                except Exception:
                    return route.abort()
                return route.fallback()
            context.route("**/*", discovery_guard)
            context.on("page", lambda extra: extra.close() if extra is not page else None)
            self._prepare_page(page)
            self._navigate(page, HEALTH_URL)
            native, reason = native_form(self._state(page))
            if native is None:
                return {"supported": False, "reason": reason, "schema": None}
            return {"supported": True, "reason": reason, "schema": native["schema"]}
        except Exception:
            return {"supported": False, "reason": "login_discovery_unavailable", "schema": None}
        finally:
            if context is not None:
                context.close()

    def login(self, username, password, expected_schema=None):
        if not isinstance(username, str) or not isinstance(password, str) or not username or not password \
                or len(username) > 320 or len(password) > 4096 or re.search(r"[\x00\r\n]", username + password):
            return _result("manual_required", "credentials_invalid")
        self._post_action = None
        self._post_budget = 0
        self._post_count = 0
        self._denied = False
        self._unsafe_redirect = False
        self._scope_violation = False
        try:
            page = self._work()
            current = self._health(page)
            if current["state"] != "signed_out":
                if current["state"] == "signed_in" and not self._publish_anchor():
                    return _result("unavailable", "session_anchor_unavailable")
                return current
            snapshot = self._state(page)
            native, reason = native_form(snapshot)
            if native is None or expected_schema is not None and native["schema"] != expected_schema:
                return _result("manual_required", reason if native is None else "native_login_changed")
            form = page.locator("form").nth(native["form"]["index"])
            user = form.locator("input").nth(native["username"]["index"])
            secret = form.locator("input").nth(native["password"]["index"])
            if user.get_attribute("name") != native["username"]["name"] or secret.get_attribute("name") != native["password"]["name"] \
                    or (secret.get_attribute("type") or "").lower() != "password":
                return _result("manual_required", "native_login_changed")
            self._sensitive = (username, password)
            user.fill(username, timeout=TIMEOUT_MS)
            secret.fill(password, timeout=TIMEOUT_MS)
            if native["remember"] is not None:
                form.locator("input").nth(native["remember"]["index"]).check(timeout=TIMEOUT_MS)
            fresh, _reason = native_form(self._state(page))
            if fresh is None or fresh["schema"] != native["schema"] or fresh["form"]["action"] != native["form"]["action"]:
                return _result("manual_required", "native_login_changed")
            if form.evaluate("form => form.checkValidity()") is not True:
                return _result("manual_required", "native_login_changed")
            self._post_action = native["form"]["action"]
            self._post_budget = 1
            with page.expect_response(lambda response: response.request.method == "POST" and response.url == self._post_action, timeout=TIMEOUT_MS):
                form.locator('button,input[type="submit"]').nth(native["submit"]["index"]).click(timeout=TIMEOUT_MS)
            self._post_budget = 0
            if self._unsafe_redirect or self._scope_violation:
                return _result("manual_required", "native_login_changed")
            next_url = self._redirects.pop(page, None)
            if next_url is not None:
                self._navigate(page, next_url)
            if self._state(page).get("challenge") is True:
                return _result("manual_required", "verification_required")
            result = self._health(page)
            if self._unsafe_redirect or self._scope_violation:
                return _result("manual_required", "native_login_changed")
            if result["state"] == "signed_in" and self._post_count == 1:
                return result if self._publish_anchor() else _result("unavailable", "session_anchor_unavailable")
            if result["state"] == "manual_required":
                return result
            return _result("manual_required", "credentials_rejected") if self._post_count == 1 else _result("manual_required", "native_login_changed")
        except Exception:
            if self._scope_violation or self._unsafe_redirect:
                return _result("manual_required", "native_login_changed")
            return _result("unavailable", "login_unavailable")
        finally:
            self._post_budget = 0
            self._post_action = None

    def profile_status(self):
        path = None
        incognito = None
        try:
            session = self.browser.new_browser_cdp_session()
            try:
                arguments = session.send("Browser.getBrowserCommandLine").get("arguments", [])
            finally:
                session.detach()
            incognito = "--incognito" in arguments
            for index, argument in enumerate(arguments):
                if argument.startswith("--user-data-dir="):
                    path = argument.split("=", 1)[1]
                elif argument == "--user-data-dir" and index + 1 < len(arguments):
                    path = arguments[index + 1]
        except Exception:
            pass
        if path is None:
            page = None
            try:
                page = self.context.new_page()
                page.goto("chrome://version/", wait_until="domcontentloaded", timeout=5000)
                path = page.locator("#profile_path").text_content(timeout=5000)
                if isinstance(path, str):
                    path = path.strip()
            except Exception:
                pass
            finally:
                if page is not None:
                    page.close()
        mountinfo = None
        try:
            with open("/proc/self/mountinfo", "r") as stream:
                mountinfo = stream.read(1048577)
        except OSError:
            pass
        return profile_persistence(path, incognito, mountinfo)

    def close(self):
        self._post_action = None
        self._post_budget = 0
        if self.page is not None:
            try:
                self.page.close()
            except Exception:
                pass
        self._sensitive = ()
        for page, handler in self._routes:
            try:
                if not page.is_closed():
                    page.unroute("**/*", handler)
            except Exception:
                pass
        self._routes.clear()
        for session in self._sessions:
            try:
                session.send("Network.setBypassServiceWorker", {"bypass": False})
                session.send("Network.setCacheDisabled", {"cacheDisabled": False})
            except Exception:
                pass
            try:
                session.detach()
            except Exception:
                pass
        self._sessions.clear()
        try:
            self.context.unroute("**/*", self._context_handler)
            self.context.remove_listener("page", self._page_handler)
        except Exception:
            pass


@contextmanager
def _quiet_driver():
    """The private driver must not inherit API logging that records fill values."""
    keys = ("DEBUG", "PWDEBUG", "DEBUG_FILE")
    previous = {key: os.environ.get(key) for key in keys}
    try:
        for key in keys:
            os.environ.pop(key, None)
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


@contextmanager
def browser_session():
    with _quiet_driver():
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
            adapter = SessionBrowser(browser)
            try:
                yield adapter
            finally:
                adapter.close()
