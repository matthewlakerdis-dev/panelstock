import importlib.util
from contextlib import contextmanager
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("nexvia_lookups", Path(__file__).with_name("nexvia_lookups.py"))
lookups = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lookups)


def page(number, rows, total=3, size=2, server=True, native_filter=None):
    return {"page": number, "rows": rows, "total": total, "pageSize": size,
            "serverPaging": server, "filter": native_filter}


class PagingTests(unittest.TestCase):
    def test_all_server_pages_are_collected_with_native_ids(self):
        pages = {1: page(1, [{"id": 1}, {"id": 2}]), 2: page(2, [{"id": 3}])}
        requested = []
        rows, selected_filter = lookups.collect_pages(lambda number: requested.append(number) or pages[number], "Supplier")
        self.assertEqual(requested, [1, 2])
        self.assertEqual([row["id"] for row in rows], [1, 2, 3])
        self.assertIsNone(selected_filter)

    def test_client_paging_reads_complete_data_not_only_the_visible_view(self):
        rows = [{"id": 1}, {"id": 2}, {"id": 3}]
        collected, _ = lookups.collect_pages(lambda number: page(1, rows, size=2, server=False), "Account")
        self.assertEqual(collected, rows)

    def test_changed_total_filter_page_size_or_page_identity_rejects_whole_refresh(self):
        for changed in [{"total": 4}, {"filter": {"field": "name", "value": "A"}},
                        {"pageSize": 1}, {"page": 1}, {"serverPaging": False}]:
            second = page(2, [{"id": 3}]); second.update(changed)
            with self.subTest(changed=changed), self.assertRaises(lookups.LookupError):
                lookups.collect_pages(lambda number: page(1, [{"id": 1}, {"id": 2}]) if number == 1 else second, "Supplier")

    def test_incomplete_or_duplicate_pages_never_publish_a_partial_directory(self):
        for second_rows in [[], [{"id": 2}], [{"id": 3}, {"id": 4}]]:
            with self.subTest(second_rows=second_rows), self.assertRaises(lookups.LookupError):
                lookups.collect_pages(lambda number: page(1, [{"id": 1}, {"id": 2}]) if number == 1 else page(2, second_rows), "Supplier")
        with self.assertRaises(lookups.LookupError):
            lookups.collect_pages(lambda number: page(1, [{"id": 1}], total=3, server=False), "Account")

    def test_invalid_counts_and_identities_are_rejected(self):
        for sample in [page(1, [], total=0), page(1, [], total=10001),
                       page(1, [{"id": True}], total=1), page(1, [{"id": "unknown"}], total=1),
                       page(1, [{"id": 1}], total=1, size=0)]:
            with self.subTest(sample=sample), self.assertRaises(lookups.LookupError):
                lookups.collect_pages(lambda number: sample, "Supplier")


class NativeGuardTests(unittest.TestCase):
    class Page:
        url = "https://lennox.nexvia.com.au/staff/third-party"
        def __init__(self, metadata): self.metadata, self.guards = metadata, []
        def evaluate(self, script, arguments): return self.metadata
        def route(self, pattern, guard): self.guards.append(guard)

    class Route:
        def __init__(self, method, url):
            self.request = type("Request", (), {"method": method, "url": url})()
            self.allowed = None
        def continue_(self): self.allowed = True
        def abort(self): self.allowed = False

    def test_only_the_actual_same_origin_read_post_is_permitted(self):
        page = self.Page({"url": "/staff/native-grid-read", "method": "POST", "serverPaging": True})
        lookups.native_reader(page, "suppliers")
        for method, url, expected in [
            ("POST", "https://lennox.nexvia.com.au/staff/native-grid-read", True),
            ("POST", "https://lennox.nexvia.com.au/staff/project-purchase-order-add/60", False),
            ("POST", "https://elsewhere.example/staff/native-grid-read", False),
            ("GET", "https://lennox.nexvia.com.au/assets/native.js", True),
        ]:
            route = self.Route(method, url); page.guards[0](route)
            self.assertEqual(route.allowed, expected)

    def test_cross_origin_or_unreadable_native_transports_stop(self):
        for metadata in [{"url": "https://elsewhere.example/staff/read", "method": "POST", "serverPaging": True},
                         {"url": "/staff/read", "method": "DELETE", "serverPaging": True},
                         {"url": None, "method": "POST", "serverPaging": True},
                         {"url": None, "method": "POST", "serverPaging": False, "serverFiltering": True}]:
            with self.subTest(metadata=metadata), self.assertRaises(lookups.LookupError):
                lookups.native_reader(self.Page(metadata), "suppliers")


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.suppliers = {"expectedTotal": 1, "filter": None, "records": [{"id": 1, "name": "Example"}]}
        self.accounts = {"accounts": [{"id": 1, "type": "Cost of Goods Sold"}], "taxes": [{"id": 4, "rate": 5}]}

    def test_both_complete_snapshots_share_a_refresh_timestamp_and_private_modes(self):
        lookups.commit_snapshots(self.root, self.suppliers, self.accounts, "2026-11-14T00:00:00+00:00")
        for name in ["nexvia-supplier-directory.json", "nexvia-account-tax-lookups.json"]:
            path = self.root / name; record = json.loads(path.read_text())
            self.assertEqual(record["refreshedAt"], "2026-11-14T00:00:00+00:00")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_commit_failure_restores_previous_complete_snapshot(self):
        lookups.commit_snapshots(self.root, self.suppliers, self.accounts, "previous")
        original = {path.name: json.loads(path.read_text()) for path in self.root.glob("*.json")}
        write, calls = lookups.atomic_json, []
        def fail_second(path, value):
            calls.append(path.name)
            if len(calls) == 2: raise OSError("synthetic write failure")
            return write(path, value)
        with patch.object(lookups, "atomic_json", side_effect=fail_second), self.assertRaises(lookups.LookupError):
            lookups.commit_snapshots(self.root, self.suppliers, self.accounts, "new")
        self.assertEqual({path.name: json.loads(path.read_text()) for path in self.root.glob("*.json")}, original)


class ModalTests(unittest.TestCase):
    def test_services_and_all_native_eow_prefixes_are_preserved(self):
        html = '''<select id="form_Service"><option value="8">Fixing</option></select>
        <select id="form_BreakdownType"></select></div><script>var options =
        {"choices":[{"id":"b_70","name":"Miscellaneous"},{"id":"ew_734","name":"Cladding"}]};</script>'''
        services, eows = lookups.modal_choices(html)
        self.assertEqual(services[0]["id"], "8")
        self.assertEqual([row["id"] for row in eows], ["b_70", "ew_734"])

    def test_incomplete_modal_is_rejected_without_guessing_choices(self):
        with self.assertRaises(lookups.LookupError): lookups.modal_choices("<html>Sign in</html>")


class NativeAccountTaxTests(unittest.TestCase):
    def setUp(self):
        self.accounts = [{"id": 9, "accountNo": "51062", "accountFullName": "COS - Estimating",
                          "accountType": "Cost of Goods Sold", "disabled": "0"},
                         {"id": 10, "accountNo": 60000, "accountFullName": "Expense",
                          "accountType": "Expense", "disabled": "1"}]
        self.taxes = [{"id": 7, "name": "New native rate", "rate": "7.5", "disabled": False},
                      {"id": 8, "name": "Retired rate", "rate": 10, "disabled": 1}]

    def test_new_native_tax_ids_rates_and_account_types_are_preserved(self):
        result = lookups.normalize_account_taxes(self.accounts, self.taxes)
        self.assertEqual(result["accounts"][0]["name"], "51062 - COS - Estimating")
        self.assertFalse(result["accounts"][0]["disabled"])
        self.assertEqual(result["accounts"][1]["type"], "Expense")
        self.assertTrue(result["accounts"][1]["disabled"])
        self.assertEqual(result["taxes"][0], {"id": 7, "name": "New native rate", "rate": "7.5", "disabled": False})
        self.assertTrue(result["taxes"][1]["disabled"])

    def test_exact_editor_helper_reads_both_live_sources_and_preserves_types(self):
        editor = object()
        requested = []
        def reader(page_object, kind):
            self.assertIs(page_object, editor)
            requested.append(kind)
            rows = self.accounts if kind == "accounts" else self.taxes
            return lambda number: page(number, rows, total=len(rows), size=len(rows), server=False)
        with patch.object(lookups, "native_reader", side_effect=reader):
            result = lookups.account_tax_for_editor(editor)
        self.assertEqual(requested, ["accounts", "taxes"])
        self.assertEqual([row["type"] for row in result["accounts"]], ["Cost of Goods Sold", "Expense"])
        self.assertEqual(result["taxes"][0]["rate"], "7.5")

    def test_global_lookup_uses_enabled_native_supplier_service_and_eow_context(self):
        html = '''<select id="form_Service"><option value="8" disabled>Old</option><option value="9">Current</option></select>
        <select id="form_BreakdownType"></select></div><script>var options =
        {"choices":[{"id":"b_70","name":"Old EOW","disabled":"1"},
                    {"id":"ew_734","name":"Current EOW","disabled":"false"}]};</script>'''
        contractors = [{"id": 1, "can_create_po": True, "disabled": "true"},
                       {"id": 2, "can_create_po": True, "disabled": "0"}]
        selected, editor_page = [], object()
        @contextmanager
        def editor(context, request):
            selected.append(request)
            yield {"page": editor_page}
        result = {"accounts": [], "taxes": []}
        with patch.object(lookups, "native_json", side_effect=[{"_html": html}, {"_resp": contractors}]), \
             patch.dict("sys.modules", {"nexvia_allocations": SimpleNamespace(native_line_editor=editor)}), \
             patch.object(lookups, "account_tax_for_editor", return_value=result) as finance:
            self.assertIs(lookups.account_tax_records(object(), 60), result)
        self.assertEqual(selected, [{"projectPageId": 60, "supplierId": "2", "serviceId": "9",
                                     "breakdownType": "ew_734", "quote": None}])
        finance.assert_called_once_with(editor_page)

    def test_last_completed_catalog_project_precedes_unrelated_open_tabs(self):
        tabs = [SimpleNamespace(url="https://lennox.nexvia.com.au/staff/project/60/modify")]
        self.assertEqual(lookups.preferred_context_project([60, 61], tabs, {"projectPageId": 61}), 61)
        self.assertEqual(lookups.preferred_context_project([60, 61], tabs, {"projectPageId": 61}, 60), 60)
        self.assertEqual(lookups.preferred_context_project([60, 61], tabs, {"projectPageId": 999}), 60)
        with self.assertRaisesRegex(lookups.LookupError, "Unknown refresh project"):
            lookups.preferred_context_project([60, 61], tabs, {"projectPageId": 61}, 999)

    def test_only_known_authenticated_nexvia_project_tabs_are_context_hints(self):
        tabs = [SimpleNamespace(url="https://elsewhere.example/staff/project/61/modify"),
                SimpleNamespace(url="https://lennox.nexvia.com.au/staff/project/999/modify"),
                SimpleNamespace(url="https://lennox.nexvia.com.au/staff/project-purchase-order-modify/61/1421")]
        self.assertEqual(lookups.preferred_context_project([60, 61], tabs), 61)
        self.assertEqual(lookups.preferred_context_project([60, 61], [], {"projectPageId": True}), 60)

    def test_invalid_or_missing_account_number_does_not_become_literal_none(self):
        for value in [None, True, {"id": 1}]:
            self.accounts[0]["accountNo"] = value
            with self.subTest(value=value), self.assertRaises(lookups.LookupError):
                lookups.normalize_account_taxes(self.accounts, self.taxes)

    def test_invalid_rates_or_native_eligibility_rejects_refresh(self):
        for value in [True, float("nan"), "-1", "101", "10%"]:
            self.taxes[0]["rate"] = value
            with self.subTest(value=value), self.assertRaises(lookups.LookupError):
                lookups.normalize_account_taxes(self.accounts, self.taxes)
        for value in [0.0, "unknown", [], {}]:
            with self.subTest(value=value), self.assertRaises(lookups.LookupError): lookups.disabled(value)

    def test_no_eligible_cos_or_tax_does_not_replace_usable_choices(self):
        self.accounts[0]["disabled"] = True
        with self.assertRaises(lookups.LookupError): lookups.normalize_account_taxes(self.accounts, self.taxes)
        self.accounts[0]["disabled"] = False
        self.taxes[0]["disabled"] = True
        with self.assertRaises(lookups.LookupError): lookups.normalize_account_taxes(self.accounts, self.taxes)


if __name__ == "__main__":
    unittest.main()
