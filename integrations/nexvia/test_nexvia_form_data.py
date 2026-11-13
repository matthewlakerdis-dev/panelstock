import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("form_data", Path(__file__).with_name("nexvia_form_data.py"))
form_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(form_data)
NOW = datetime(2026, 11, 13, 20, tzinfo=timezone.utc)
STAMP = NOW.isoformat()


def modal():
    return ('<select id="form_Service"><option value="">Select</option>'
            '<option value="8">Fixing</option><option value="39">New service</option></select>'
            '<select id="form_BreakdownType"></select></div><script>var options = '
            '{"choices":[{"id":"b_70","name":"Miscellaneous"},'
            '{"id":"ew_999","name":"New EOW"}]};</script>')


def snapshots(root):
    suppliers = {"refreshedAt": STAMP, "expectedTotal": 2, "records": [
        {"id": 225, "name": "Supplier", "disabled": False},
        {"id": 909, "name": "New supplier", "disabled": False}]}
    finance = {"refreshedAt": STAMP, "accounts": [
        {"id": 401, "name": "Materials", "type": "Cost of Goods Sold"},
        {"id": 489, "name": "New account", "type": "Cost of Goods Sold"},
        {"id": 499, "name": "Expense", "type": "Expense"}],
        "taxes": [{"id": 17, "name": "GST", "rate": "10"},
                  {"id": 88, "name": "New zero tax", "rate": "0"}]}
    for name, value in [("nexvia-supplier-directory.json", suppliers),
                        ("nexvia-account-tax-lookups.json", finance)]:
        (root / name).write_text(json.dumps(value))
    return suppliers, finance


def request():
    return {"projectPageId": 60, "supplierId": "225", "serviceId": "39",
            "breakdownType": "ew_999", "quote": None, "date": "2026-11-13",
            "requestor": {"name": "Requester", "email": "test@example.com"},
            "lines": [{"description": "Materials", "quantity": "1", "unitPriceExGst": "1000",
                       "chartOfAccountId": "489", "taxRateId": "88", "breakdownType": "ew_999"}],
            "subtotalCents": 100000, "taxCents": 0, "totalCents": 100000,
            "testOnly": True, "nexviaSubmissionEnabled": False}


class FormDataTests(unittest.TestCase):
    def test_all_choice_families_include_new_native_ids_and_zero_tax(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            snapshots(root)
            with patch.object(form_data, "read_native", return_value={"_html": modal()}):
                choices = form_data.collect_choices(None, 60, config_root=root, now=NOW)
        self.assertEqual([row["id"] for row in choices["services"]], ["8", "39"])
        self.assertEqual([row["id"] for row in choices["breakdowns"]], ["b_70", "ew_999"])
        self.assertEqual({row["id"] for row in choices["suppliers"]}, {225, 909})
        self.assertEqual([row["id"] for row in choices["accounts"]], [401, 489])
        self.assertEqual([(row["id"], row["rate"]) for row in choices["taxes"]], [(17, "10"), (88, "0")])

    def test_partial_mixed_or_stale_snapshot_cannot_publish_choices(self):
        for failure in ["partial", "mixed", "stale"]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                suppliers, finance = snapshots(root)
                if failure == "partial":
                    suppliers["records"].pop()
                elif failure == "mixed":
                    finance["refreshedAt"] = (NOW - timedelta(seconds=1)).isoformat()
                else:
                    suppliers["refreshedAt"] = finance["refreshedAt"] = (NOW - timedelta(seconds=601)).isoformat()
                (root / "nexvia-supplier-directory.json").write_text(json.dumps(suppliers))
                (root / "nexvia-account-tax-lookups.json").write_text(json.dumps(finance))
                with self.assertRaises(ValueError):
                    form_data.completed_snapshots(root, NOW)

    def test_malformed_snapshot_roots_and_supplier_records_are_rejected(self):
        cases = [("nexvia-supplier-directory.json", []),
                 ("nexvia-account-tax-lookups.json", []),
                 ("nexvia-supplier-directory.json", {"refreshedAt": STAMP,
                                                       "expectedTotal": 1, "records": [None]})]
        for name, invalid in cases:
            with self.subTest(name=name, invalid=invalid), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                snapshots(root)
                (root / name).write_text(json.dumps(invalid))
                with self.assertRaises(ValueError):
                    form_data.completed_snapshots(root, NOW)

    def test_unknown_disabled_flag_cannot_become_an_eligible_choice(self):
        for flag in [0.0, 1.0, 2, "unknown", [], {}]:
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                form_data.normalize_choices([{"id": 1, "name": "Choice", "disabled": flag}])
        for flag in [True, 1, "1", "true"]:
            with self.subTest(flag=flag):
                self.assertTrue(form_data.normalize_choices([
                    {"id": 1, "name": "Choice", "disabled": flag}])[0]["disabled"])

    def test_oversized_or_nontext_supplier_search_fails_before_network(self):
        for search in ["x" * 101, None, True, []]:
            with self.subTest(search=search), patch.object(form_data, "read_native") as read:
                with self.assertRaises(ValueError):
                    form_data.collect_choices(None, 60, search)
                read.assert_not_called()

    def test_duplicate_eow_ids_and_incomplete_native_modal_are_rejected(self):
        for source in [modal().replace('"id":"ew_999"', '"id":"b_70"'),
                       modal().replace('form_Service', 'unrelated')]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                form_data.modal_choices(source)

    def test_fresh_validation_checks_selected_supplier_permission_and_keeps_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            snapshots(root)
            with patch.object(form_data, "read_native", return_value={"_html": modal()}):
                choices = form_data.collect_choices(None, 60, config_root=root, now=NOW)
            payload = request()
            before = copy.deepcopy(payload)
            with patch.object(form_data, "read_native", return_value={"_resp": [
                    {"id": 225, "can_create_po": True}]} ) as read:
                form_data.validate_request(payload, choices, "context")
                read.assert_called_once_with("context", 60, "Supplier")
            self.assertEqual(payload, before)
            for response in [[], [{"id": 225, "can_create_po": False}],
                             [{"id": 909, "can_create_po": True}],
                             [{"id": 225, "can_create_po": True, "disabled": True}]]:
                with patch.object(form_data, "read_native", return_value={"_resp": response}), self.assertRaisesRegex(ValueError, "Supplier"):
                    form_data.validate_request(payload, choices, None)

    def test_removed_ids_changed_tax_or_wrong_eow_block_preparation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            snapshots(root)
            with patch.object(form_data, "read_native", return_value={"_html": modal()}):
                choices = form_data.collect_choices(None, 60, config_root=root, now=NOW)
        for failure in ["account", "tax", "eow", "project"]:
            payload = request()
            current = copy.deepcopy(choices)
            if failure == "account":
                current["accounts"].pop()
            elif failure == "tax":
                current["taxes"][1]["rate"] = "10"
            elif failure == "eow":
                payload["lines"][0]["breakdownType"] = "b_70"
            else:
                current["projectPageId"] = 61
            with self.subTest(failure=failure), patch.object(form_data, "read_native", return_value={"_resp": [
                    {"id": 225, "can_create_po": True}]}), self.assertRaises(ValueError):
                form_data.validate_request(payload, current, None)

    def test_request_total_limit_applies_after_current_tax_calculation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            snapshots(root)
            with patch.object(form_data, "read_native", return_value={"_html": modal()}):
                choices = form_data.collect_choices(None, 60, config_root=root, now=NOW)
        for price, allowed in [("10000", True), ("10001", False)]:
            payload = request()
            payload["lines"][0].update(quantity="1000000", unitPriceExGst=price)
            payload["subtotalCents"] = payload["totalCents"] = 1000000 * int(price) * 100
            with self.subTest(price=price), patch.object(form_data, "read_native", return_value={"_resp": [
                    {"id": 225, "can_create_po": True}]}):
                if allowed:
                    form_data.validate_request(payload, choices, None)
                else:
                    with self.assertRaisesRegex(ValueError, "totals"):
                        form_data.validate_request(payload, choices, None)

    def test_only_known_modal_get_and_read_only_supplier_search_post_are_used(self):
        calls = []
        response = SimpleNamespace(status=200, json=lambda: {"_success": True})
        context = SimpleNamespace(request=SimpleNamespace(
            get=lambda url, **kwargs: calls.append(("GET", url, kwargs)) or response,
            post=lambda url, **kwargs: calls.append(("POST", url, kwargs)) or response))
        form_data.read_native(context, 60)
        form_data.read_native(context, 60, "Supplier")
        self.assertIn("/staff/project-purchase-order-new-modal/60/Assembly?", calls[0][1])
        self.assertEqual(calls[1][1], "https://lennox.nexvia.com.au/staff/project/contractors/60")
        self.assertEqual(calls[1][2]["form"], {"q": "Supplier"})
        self.assertTrue(all(call[2]["max_redirects"] == 0 for call in calls))


if __name__ == "__main__":
    unittest.main()
