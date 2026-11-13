import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("nexvia_projects", Path(__file__).with_name("nexvia_projects.py"))
projects = importlib.util.module_from_spec(spec)
spec.loader.exec_module(projects)


def link(identifier, name):
    return f'<a href="/staff/project/{identifier}/modify">{name}</a>'


class NativeListingTests(unittest.TestCase):
    def test_only_demonstrated_same_origin_project_links_are_selected(self):
        html = link(60, "Open Project") + link(60, " Jardin ") + link(60, "Jardin <b>Building</b>")
        html += link(61, "Project\nTwo")
        html += '<a href="https://elsewhere.example/staff/project/99/modify">External</a>'
        html += '<a href="/staff/project/62/delete">Delete</a>'
        html += '<a href="/staff/project/63/modify"> </a>'
        snapshot = projects.parse_project_page(html, projects.ORIGIN + projects.INDEX_PATH)
        self.assertEqual(snapshot["projects"], [{"projectPageId": 60, "name": "Jardin Building"},
                                                {"projectPageId": 61, "name": "Project Two"}])

    def test_native_pagination_follows_actual_safe_links_without_inventing_pages(self):
        first = link(60, "Jardin") + '''<ul class="pagination"><li><a href="?page=2">2</a></li>
        <li><a href="https://elsewhere.example/staff/projects?page=3">3</a></li>
        <li><a href="?page=3&amp;token=private">Unsafe</a></li>
        <li><a href="/staff/project-purchase-order-add/60">Other</a></li>
        <li><a aria-disabled="true" href="?page=4">Disabled</a></li></ul>
        <a href="?page=5">Ordinary listing link</a>'''
        second = link(61, "New Project") + '<a rel="previous" href="/staff/projects">Previous</a>'
        pages = {projects.ORIGIN + projects.INDEX_PATH: first,
                 projects.ORIGIN + projects.INDEX_PATH + "?page=2": second}
        visited = []
        capture = projects.collect_projects(lambda url: visited.append(url) or pages[url])
        self.assertEqual(visited, list(pages))
        self.assertEqual(len(capture["projects"]), 2)
        self.assertFalse(capture["complete"])
        self.assertFalse(capture["bounded"])

    def test_void_tags_do_not_leave_pagination_ancestry_active(self):
        html = '<nav class="pagination"><img src="next.png"><a href="?page=2">2</a></nav>'
        html += '<a href="?page=3">Unrelated</a>'
        capture = projects.parse_project_page(html, projects.ORIGIN + projects.INDEX_PATH)
        self.assertEqual(capture["pagination"], [projects.ORIGIN + projects.INDEX_PATH + "?page=2"])

    def test_cross_origin_invalid_and_unexpected_query_listing_links_are_rejected(self):
        for value in ["https://elsewhere.example/staff/projects?page=2", "//elsewhere.example/staff/projects",
                      "/staff/projects?delete=1", "/staff/projects?page=2&page=3",
                      "/staff/projects?page=two", "/staff/projects?page=2#secret",
                      "/staff/projects/login", "javascript:alert(1)"]:
            with self.subTest(value=value): self.assertIsNone(projects.listing_url(value))

    def test_page_failure_or_no_project_links_rejects_whole_capture(self):
        def read(url):
            if "page=2" in url: raise OSError("remote failure")
            return link(60, "Jardin") + '<a rel="next" href="?page=2">Next</a>'
        with self.assertRaises(OSError): projects.collect_projects(read)
        with self.assertRaises(projects.ProjectRefreshError): projects.collect_projects(lambda url: "Sign in")

    def test_page_bound_returns_unverified_snapshot(self):
        with patch.object(projects, "MAX_PAGES", 1):
            capture = projects.collect_projects(lambda url: link(60, "Jardin") + '<a rel="next" href="?page=2">Next</a>')
        self.assertTrue(capture["bounded"])
        self.assertFalse(capture["complete"])

    def test_all_page_mutation_methods_are_blocked(self):
        for method in ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]:
            class Route:
                request = type("Request", (), {"method": method})()
                def continue_(self): self.allowed = True
                def abort(self): self.allowed = False
            route = Route(); projects.readonly_route(route)
            self.assertEqual(route.allowed, method in {"GET", "HEAD", "OPTIONS"})


class RefreshCacheTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.cache = self.directory / "nexvia-projects.json"
        self.state = self.directory / "nexvia-project-refresh.json"
        self.cache.write_text(json.dumps({"scope": "Original export", "extra": {"keep": True}, "projects": [
            {"projectPageId": 60, "name": "Jardin Building"}, {"projectPageId": 61, "name": "Earlier Project"}]}))

    def refresh(self, capture, **kwargs):
        return projects.refresh_if_due(self.cache, self.state, now=1000, fetcher=lambda: capture, **kwargs)

    def test_partial_capture_adds_new_projects_updates_names_and_retains_missing_ids(self):
        result = self.refresh({"projects": [{"projectPageId": 60, "name": "Jardin"},
                                            {"projectPageId": 62, "name": "New Project"}], "complete": False})
        saved = json.loads(self.cache.read_text())
        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["projectCount"], 3)
        self.assertEqual({row["projectPageId"]: row["name"] for row in saved["projects"]},
                         {60: "Jardin", 61: "Earlier Project", 62: "New Project"})
        self.assertEqual(saved["extra"], {"keep": True})
        self.assertEqual(saved["scope"], "Original export")
        self.assertEqual(saved["snapshotCompleteness"], "unverified")
        self.assertEqual(self.cache.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o600)

    def test_only_a_proven_complete_capture_can_remove_missing_projects(self):
        result = self.refresh({"projects": [{"projectPageId": 62, "name": "New Project"}], "complete": True})
        self.assertEqual(result, {"status": "updated", "projectCount": 1, "warning": None})
        self.assertEqual(json.loads(self.cache.read_text())["snapshotCompleteness"], "complete")

    def test_network_failure_keeps_cache_unchanged_and_throttles_next_attempt(self):
        original = self.cache.read_bytes()
        def fail(): raise OSError("no connection")
        first = projects.refresh_if_due(self.cache, self.state, now=1000, fetcher=fail)
        self.assertEqual(first["status"], "retained_cache")
        self.assertEqual(self.cache.read_bytes(), original)
        fetch = lambda: self.fail("Failed refresh was retried before five minutes")
        second = projects.refresh_if_due(self.cache, self.state, now=1299, fetcher=fetch)
        self.assertEqual(second["status"], "retained_cache")
        self.assertEqual(json.loads(self.state.read_text())["nextAttemptAt"], 1300)
        third = projects.refresh_if_due(self.cache, self.state, now=1300,
                                        fetcher=lambda: {"projects": [{"projectPageId": 62, "name": "New"}], "complete": False})
        self.assertEqual(third["status"], "updated")

    def test_successful_unverified_capture_is_fresh_during_interval(self):
        self.refresh({"projects": [{"projectPageId": 62, "name": "New"}], "complete": False})
        result = projects.refresh_if_due(self.cache, self.state, now=1100,
                                         fetcher=lambda: self.fail("Fresh cache must not refetch"))
        self.assertEqual(result["status"], "fresh")
        self.assertTrue(json.loads(self.state.read_text())["lastAttemptSucceeded"])
        self.assertIn("completeness", result["warning"])

    def test_legacy_failed_state_is_not_misreported_as_fresh(self):
        self.state.write_text(json.dumps({"lastAttemptAt": 1000, "nextAttemptAt": 1300,
                                          "lastSuccessAt": 700, "warning": "Previous refresh failed"}))
        result = projects.refresh_if_due(self.cache, self.state, now=1100,
                                         fetcher=lambda: self.fail("Throttle must still apply"))
        self.assertEqual(result["status"], "retained_cache")
        self.assertEqual(result["warning"], "Previous refresh failed")

    def test_cli_reports_failure_with_a_retained_nonempty_cache(self):
        for status in ["retained_cache", "busy"]:
            with self.subTest(status=status), \
                 patch.object(projects, "refresh_if_due", return_value={"status":status, "projectCount":2,
                                                                        "warning":"Refresh unavailable"}), \
                 patch("sys.argv", ["nexvia_projects.py", "--refresh"]), patch("builtins.print"):
                self.assertEqual(projects.main(), 1)

    def test_empty_or_invalid_capture_never_replaces_good_cache(self):
        original = self.cache.read_bytes()
        for capture in [{"projects": [], "complete": True}, {"projects": [], "complete": False},
                        {"projects": [{"projectPageId": True, "name": "Bad"}], "complete": False},
                        {"projects": [{"projectPageId": 60, "name": "A"}, {"projectPageId": 60, "name": "B"}], "complete": False},
                        {"projects": [{"projectPageId": 60, "name": "A"}]},
                        {"projects": [{"projectPageId": 60, "name": " "}], "complete": False}]:
            with self.subTest(capture=capture):
                result = self.refresh(capture, force=True)
                self.assertEqual(result["status"], "retained_cache")
                self.assertEqual(self.cache.read_bytes(), original)

    def test_atomic_replace_failure_keeps_previous_cache_and_cleans_temporary_file(self):
        original = self.cache.read_bytes()
        replace = projects.os.replace
        def fail_cache(source, destination):
            if destination == self.cache: raise OSError("synthetic full disk")
            return replace(source, destination)
        with patch.object(projects.os, "replace", side_effect=fail_cache):
            result = self.refresh({"projects": [{"projectPageId": 62, "name": "New"}], "complete": False})
        self.assertEqual(result["status"], "retained_cache")
        self.assertEqual(self.cache.read_bytes(), original)
        self.assertEqual(list(self.directory.glob(".nexvia-projects-*")), [])

    def test_force_bypasses_the_due_time_without_changing_the_interval(self):
        self.refresh({"projects": [{"projectPageId": 62, "name": "New"}], "complete": False})
        result = self.refresh({"projects": [{"projectPageId": 63, "name": "Newer"}], "complete": False}, force=True)
        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["projectCount"], 4)

    def test_symlink_cache_is_rejected_without_reading_or_replacing_target(self):
        target = self.directory / "other.json"; target.write_bytes(self.cache.read_bytes())
        self.cache.unlink(); self.cache.symlink_to(target)
        with self.assertRaises(projects.ProjectRefreshError):
            self.refresh({"projects": [{"projectPageId": 62, "name": "New"}], "complete": False})
        self.assertTrue(self.cache.is_symlink())

    def test_state_failure_after_cache_commit_reports_refreshed_cache(self):
        write, count = projects.atomic_json, []
        def fail_success_state(path, value):
            count.append(path)
            if len(count) == 3: raise OSError("synthetic state failure")
            return write(path, value)
        with patch.object(projects, "atomic_json", side_effect=fail_success_state):
            result = self.refresh({"projects": [{"projectPageId": 62, "name": "New"}], "complete": False})
        self.assertEqual(result["status"], "updated")
        self.assertEqual(len(json.loads(self.cache.read_text())["projects"]), 3)


if __name__ == "__main__":
    unittest.main()
