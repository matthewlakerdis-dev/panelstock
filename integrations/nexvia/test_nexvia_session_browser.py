"""Authentication boundaries for the standalone NAS Chromium adapter."""
from copy import deepcopy
from contextlib import contextmanager
import os
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import nexvia_session_browser as browser


def form_state():
    return {"challenge": False, "passwords": 1, "projectLinks": False, "forms": [{
        "index": 0, "method": "POST", "action": browser.ORIGIN + "/staff/login?return=%2Fstaff%2Fprojects",
        "target": "", "encoding": "application/x-www-form-urlencoded", "inputs": [
            {"index": 0, "type": "hidden", "name": "csrf", "visible": False, "disabled": False, "owner": True},
            {"index": 1, "type": "email", "name": "native[email]", "autocomplete": "username", "visible": True, "disabled": False, "owner": True},
            {"index": 2, "type": "password", "name": "native[password]", "autocomplete": "current-password", "visible": True, "disabled": False, "owner": True},
            {"index": 3, "type": "checkbox", "name": "native[remember]", "label": "Remember me", "visible": True, "disabled": False, "owner": True},
        ], "buttons": [{"index": 0, "type": "submit", "name": "sign-in", "text": "Sign in", "visible": True,
                         "disabled": False, "owner": True, "overrides": False}]}]}


class Route:
    def __init__(self, method, url, resource="document"):
        self.request = SimpleNamespace(method=method, url=url, resource_type=resource,
                                       is_navigation_request=lambda: resource == "document", frame=SimpleNamespace(page=None))
        self.outcome = None
        self.response = SimpleNamespace(status=200, headers={}, url=url)
        self.fetches = []
        self.fulfilled = None
    def fallback(self): self.outcome = "allowed"
    def abort(self): self.outcome = "blocked"
    def fetch(self, **options):
        self.fetches.append(options)
        return self.response
    def fulfill(self, **options):
        self.fulfilled = options
        self.outcome = "allowed"


class Page(SimpleNamespace):
    __hash__ = object.__hash__


class SessionBrowserBoundaries(unittest.TestCase):
    def adapter(self):
        primary = SimpleNamespace(pages=[], route=lambda *args: None, on=lambda *args: None,
                                  unroute=lambda *args: None, remove_listener=lambda *args: None)
        other = SimpleNamespace(pages=[])
        return browser.SessionBrowser(SimpleNamespace(contexts=[primary, other]))

    def test_resolves_native_fields_without_csrf_values_or_dynamic_ids(self):
        state = form_state()
        state["forms"][0]["inputs"][0].update(value="PRIVATE_CSRF_VALUE", id="random-dom-id")
        native, reason = browser.native_form(state)
        self.assertEqual(reason, "native_password_form")
        self.assertEqual(native["schema"]["usernameName"], "native[email]")
        self.assertEqual(native["schema"]["rememberName"], "native[remember]")
        self.assertEqual(native["schema"]["actionQueryKeys"], ["return"])
        text = str(native["schema"])
        self.assertNotIn("PRIVATE_CSRF_VALUE", text)
        self.assertNotIn("random-dom-id", text)
        self.assertNotIn("%2Fstaff", text)

    def test_challenge_ambiguous_username_and_multiple_password_forms_stop(self):
        state = form_state(); state["challenge"] = True
        self.assertEqual(browser.native_form(state), (None, "verification_required"))
        state = form_state()
        second = dict(state["forms"][0]["inputs"][1], name="other_email", index=4)
        state["forms"][0]["inputs"].append(second)
        self.assertIsNone(browser.native_form(state)[0])
        state = form_state(); state["forms"].append(deepcopy(state["forms"][0]))
        self.assertIsNone(browser.native_form(state)[0])

    def test_off_origin_business_and_popup_form_actions_are_rejected(self):
        for changed in ({"action": "https://outside.invalid/login"},
                        {"action": browser.ORIGIN + "/staff/project-purchase-order-add/60"},
                        {"method": "GET"}, {"target": "_blank"}):
            state = form_state(); state["forms"][0].update(changed)
            with self.subTest(changed=changed): self.assertIsNone(browser.native_form(state)[0])

    def test_button_overrides_and_foreign_form_controls_are_rejected(self):
        for changed in ({"overrides": True}, {"owner": False}):
            state = form_state(); state["forms"][0]["buttons"][0].update(changed)
            with self.subTest(changed=changed): self.assertIsNone(browser.native_form(state)[0])
        state = form_state(); state["forms"][0]["inputs"][2]["owner"] = False
        self.assertIsNone(browser.native_form(state)[0])

    def test_base_target_and_nonstandard_form_encoding_are_rejected(self):
        state = form_state(); state["baseTarget"] = "_blank"
        self.assertIsNone(browser.native_form(state)[0])
        state = form_state(); state["forms"][0]["encoding"] = "text/plain"
        self.assertIsNone(browser.native_form(state)[0])

    def test_credentials_cannot_leak_through_auth_get_queries(self):
        adapter = self.adapter(); adapter._sensitive = ("staff@example.invalid", "PRIVATE_PASSWORD")
        for url in (browser.ORIGIN + "/staff/login?native%5Bpassword%5D=OTHER",
                    browser.ORIGIN + "/staff/login?next=PRIVATE_PASSWORD",
                    browser.ORIGIN + "/staff/login?next=staff%40example.invalid"):
            route = Route("GET", url); adapter._guard(route)
            self.assertEqual(route.outcome, "blocked")

    def test_route_guard_allows_only_one_exact_armed_auth_post(self):
        adapter = self.adapter()
        self.assertIs(adapter.context, adapter.browser.contexts[0])
        action = browser.ORIGIN + "/staff/login?return=%2Fstaff%2Fprojects"
        for url in (action, browser.ORIGIN + "/staff/project-purchase-order-add/60"):
            route = Route("POST", url); adapter._guard(route); self.assertEqual(route.outcome, "blocked")
        adapter._post_action = action; adapter._post_budget = 1
        wrong = Route("POST", action + "&extra=1"); adapter._guard(wrong)
        self.assertEqual(wrong.outcome, "blocked"); self.assertEqual(adapter._post_budget, 1)
        first = Route("POST", action); adapter._guard(first)
        self.assertEqual(first.outcome, "allowed"); self.assertEqual(adapter._post_count, 1)
        second = Route("POST", action); adapter._guard(second)
        self.assertEqual(second.outcome, "blocked"); self.assertEqual(adapter._post_count, 1)

    def test_business_reads_and_credential_external_urls_are_always_blocked(self):
        adapter = self.adapter()
        for path in ("/staff/project-purchase-order-print/1/2", "/staff/upload/details/2", "/staff/logout", "/staff/send", "/staff/stock"):
            route = Route("GET", browser.ORIGIN + path); adapter._guard(route)
            with self.subTest(path=path): self.assertEqual(route.outcome, "blocked")
        for url in ("http://lennox.nexvia.com.au/staff/login", "https://lennox.nexvia.com.au.evil.invalid/login",
                    "https://user:pass@lennox.nexvia.com.au/login", "https://lennox.nexvia.com.au:444/login",
                    "https://cdn.jsdelivr.net/login.js?password=PRIVATE"):
            route = Route("GET", url, "script"); adapter._guard(route)
            with self.subTest(url=url): self.assertEqual(route.outcome, "blocked")
        route = Route("GET", browser.HEALTH_URL); adapter._guard(route)
        self.assertEqual(route.outcome, "allowed")

    def test_non200_login_form_is_not_an_expired_session_to_reauthenticate(self):
        adapter = self.adapter()
        state = form_state()
        page = Page(url=browser.ORIGIN + "/staff/login", goto=lambda *a, **k: SimpleNamespace(status=503),
                               wait_for_function=lambda *a, **k: None, evaluate=lambda *a: state)
        self.assertEqual(adapter._health(page), {"state": "unavailable", "reason": "session_unverified"})

    def test_authenticated_health_requires_native_project_proof_and_no_password_form(self):
        adapter = self.adapter()
        state = {"challenge": False, "passwords": 0, "projectLinks": True, "forms": []}
        page = Page(url=browser.HEALTH_URL, goto=lambda *a, **k: SimpleNamespace(status=200),
                               wait_for_function=lambda *a, **k: None, evaluate=lambda *a: state)
        self.assertEqual(adapter._health(page)["state"], "signed_in")
        state["passwords"] = 1
        self.assertNotEqual(adapter._health(page)["state"], "signed_in")
        state.update(passwords=0, projectLinks=False)
        self.assertNotEqual(adapter._health(page)["state"], "signed_in")

    def test_existing_authenticated_session_does_not_submit_credentials(self):
        adapter = self.adapter()
        adapter._work = lambda: object()
        adapter._health = lambda page: {"state": "signed_in", "reason": "authenticated_projects"}
        adapter._publish_anchor = lambda: True
        self.assertEqual(adapter.login("user@example.invalid", "PRIVATE_PASSWORD")["state"], "signed_in")
        self.assertEqual(adapter._post_count, 0)

    def test_cleanup_closes_only_temporary_work_page_and_retains_passive_anchor(self):
        adapter = self.adapter(); calls = []
        adapter._sensitive = ("PRIVATE_USER", "PRIVATE_PASSWORD")
        def closed():
            self.assertEqual(adapter._sensitive, ("PRIVATE_USER", "PRIVATE_PASSWORD"))
            calls.append("work_closed")
        page = SimpleNamespace(is_closed=lambda: False, unroute=lambda *args: calls.append(args), close=closed)
        anchor = SimpleNamespace(close=lambda: self.fail("passive anchor closed"))
        handler = lambda *args: None
        adapter._routes = [(page, handler)]; adapter.page = page; adapter.anchor_page = anchor
        adapter.close()
        self.assertEqual(calls, ["work_closed", ("**/*", handler)])
        self.assertIs(adapter.page, page)
        self.assertIs(adapter.anchor_page, anchor)
        self.assertEqual(adapter._routes, [])
        self.assertEqual(adapter._sensitive, ())

    def test_anchor_marker_is_set_after_authenticated_navigation_and_reused(self):
        adapter = self.adapter(); calls = []; page = Page(url="about:blank", marker="")
        def evaluate(script, value=None):
            if value is not None:
                page.marker = value; calls.append(("marker", page.url))
            else:
                return page.marker == browser.ANCHOR_NAME
        page.evaluate = evaluate; page.is_closed = lambda: False; page.unroute = lambda *args: None
        page.close = lambda: self.fail("verified anchor must remain open")
        adapter.context.new_page = lambda: page
        def prepare(value, active=True):
            self.assertFalse(active); adapter._routes.append((value, adapter._guard))
        adapter._prepare_page = prepare
        def health(value):
            value.url = browser.HEALTH_URL; calls.append(("health", value.url))
            return {"state": "signed_in", "reason": "authenticated_projects"}
        adapter._health = health
        self.assertTrue(adapter._publish_anchor())
        self.assertEqual(calls[-1], ("marker", browser.HEALTH_URL))
        adapter.context.pages = [page]
        second = browser.SessionBrowser(adapter.browser)
        self.assertTrue(second._publish_anchor())
        self.assertIs(second.anchor_page, page)

    def test_post_redirects_never_replay_body_or_forward_location_to_chromium(self):
        action = browser.ORIGIN + "/staff/login"
        for status in (301, 307, 308):
            adapter = self.adapter(); adapter._post_action = action; adapter._post_budget = 1
            route = Route("POST", action)
            route.response = SimpleNamespace(status=status, headers={"location": browser.HEALTH_URL}, url=action)
            adapter._guard(route)
            with self.subTest(status=status):
                self.assertTrue(adapter._unsafe_redirect)
                self.assertEqual(len(route.fetches), 1)
                self.assertEqual(route.fetches[0]["max_redirects"], 0)
                self.assertNotIn("location", route.fulfilled.get("headers", {}))
                self.assertEqual(adapter._post_count, 1)
        adapter = self.adapter(); adapter._post_action = action; adapter._post_budget = 1
        route = Route("POST", action)
        route.response = SimpleNamespace(status=303, headers={"location": browser.HEALTH_URL, "set-cookie": "native=PRIVATE; Secure"}, url=action)
        adapter._guard(route)
        self.assertEqual(len(route.fetches), 1)
        self.assertEqual(adapter._redirects[None], browser.HEALTH_URL)
        self.assertNotIn("location", route.fulfilled["headers"])
        self.assertEqual(route.fulfilled["headers"]["set-cookie"], "native=PRIVATE; Secure")

    def test_unsafe_redirects_and_encoded_query_assets_are_blocked_while_credentials_present(self):
        adapter = self.adapter()
        existing = browser.ORIGIN + "/assets/login.js?v=known"
        adapter._seen_reads.add(existing)
        adapter._sensitive = ("staff@example.invalid", "PRIVATE_PASSWORD")
        self.assertTrue(adapter._can_read(existing, "script"))
        self.assertFalse(adapter._can_read(browser.ORIGIN + "/assets/login.js?v=UFJJVkFURV9QQVNTV09SRA==", "script"))
        self.assertFalse(adapter._can_read(browser.ORIGIN + "/staff/login?return=UFJJVkFURV9QQVNTV09SRA==", "document"))
        self.assertTrue(adapter._can_read(browser.HEALTH_URL, "document"))
        action = browser.ORIGIN + "/staff/login"; adapter._post_action = action; adapter._post_budget = 1
        route = Route("POST", action)
        route.response = SimpleNamespace(status=302, headers={"location": "https://outside.invalid/login"}, url=action)
        adapter._guard(route)
        self.assertTrue(adapter._unsafe_redirect)
        self.assertEqual(len(route.fetches), 1)

    def test_context_guard_blocks_first_popup_request_without_touching_existing_user_page(self):
        adapter = self.adapter()
        work = Page(opener=lambda: None); user = Page(opener=lambda: None)
        popup = Page(opener=lambda: work)
        adapter.page = work; adapter._known_pages = {user}; adapter._sensitive = ("user", "password")
        route = Route("POST", "https://outside.invalid/login"); route.request.frame.page = popup
        adapter._context_guard(route)
        self.assertEqual(route.outcome, "blocked")
        self.assertTrue(adapter._scope_violation)
        route = Route("GET", "https://user.example.invalid/"); route.request.frame.page = user
        adapter._context_guard(route)
        self.assertEqual(route.outcome, "allowed")

    def test_scoped_service_worker_and_cache_bypass_is_required_before_owned_navigation(self):
        adapter = self.adapter(); calls = []
        session = SimpleNamespace(send=lambda method, values: calls.append((method, values)), detach=lambda: None)
        page = SimpleNamespace(context=SimpleNamespace(new_cdp_session=lambda value: session))
        adapter._bypass_worker(page)
        self.assertEqual(calls, [("Network.setBypassServiceWorker", {"bypass": True}),
                                 ("Network.setCacheDisabled", {"cacheDisabled": True})])
        self.assertEqual(adapter._sessions, [session])

    def test_persistence_requires_a_real_config_mount_and_known_nonincognito_mode(self):
        mount = "42 1 8:1 /nas/browser /config rw - btrfs /dev/volume rw\n"
        self.assertEqual(browser.profile_persistence("/config/chromium/Default", False, mount),
                         {"underConfig": True, "persistent": True})
        for mode, data in ((True, mount), (False, ""), (False, mount.replace("btrfs", "tmpfs")),
                           (False, mount.replace("btrfs", "overlay"))):
            self.assertFalse(browser.profile_persistence("/config/chromium/Default", mode, data)["persistent"])
        self.assertIsNone(browser.profile_persistence("/config/chromium/Default", None, mount)["persistent"])
        self.assertEqual(browser.profile_persistence("/config/../tmp/profile", False, mount),
                         {"underConfig": False, "persistent": False})

    def test_private_playwright_driver_suppresses_debug_logging_and_restores_environment(self):
        keys = {"DEBUG": "pw:api", "PWDEBUG": "1", "DEBUG_FILE": "/tmp/synthetic-private-debug.log"}
        for failing in (False, True):
            calls = []
            def quiet():
                self.assertTrue(all(key not in os.environ for key in keys))
            @contextmanager
            def factory():
                quiet(); calls.append("driver_started")
                try:
                    yield SimpleNamespace(chromium=SimpleNamespace(connect_over_cdp=lambda *a, **k: object()))
                finally:
                    quiet(); calls.append("driver_stopped")
            api = ModuleType("playwright.sync_api"); api.sync_playwright = factory
            adapter = SimpleNamespace(close=lambda: (quiet(), calls.append("adapter_closed")))
            with patch.dict(os.environ, keys), patch.dict(sys.modules, {"playwright": ModuleType("playwright"), "playwright.sync_api": api}), patch.object(browser, "SessionBrowser", return_value=adapter):
                if failing:
                    with self.assertRaisesRegex(RuntimeError, "synthetic"):
                        with browser.browser_session():
                            quiet(); raise RuntimeError("synthetic")
                else:
                    with browser.browser_session(): quiet()
                self.assertEqual({key: os.environ.get(key) for key in keys}, keys)
            self.assertEqual(calls, ["driver_started", "adapter_closed", "driver_stopped"])

    def test_private_driver_does_not_create_previously_unset_debug_variables(self):
        keys = ("DEBUG", "PWDEBUG", "DEBUG_FILE")
        with patch.dict(os.environ, {}, clear=True):
            with browser._quiet_driver():
                self.assertTrue(all(key not in os.environ for key in keys))
            self.assertTrue(all(key not in os.environ for key in keys))


if __name__ == "__main__": unittest.main()
