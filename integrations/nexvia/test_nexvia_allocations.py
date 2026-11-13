import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
import unittest


spec = importlib.util.spec_from_file_location("nexvia_allocations", Path(__file__).with_name("nexvia_allocations.py"))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def request(eow="b_70"):
    return {
        "projectPageId": 60, "supplierId": "225", "serviceId": "8", "breakdownType": eow,
        "quote": None, "supplierReference": "Quote 12",
        "lines": [{"description": "Purchase materials", "quantity": "1", "unitPriceExGst": "1000",
                   "chartOfAccountId": "401", "taxRateId": "17", "breakdownType": eow}],
        "subtotalCents": 100000, "taxCents": 10000, "totalCents": 110000,
    }


def snapshot(eow="b_70"):
    return {
        "fields": [["form[ServiceId]", "8"], ["form[CurrencyId]", "8"], ["form[Lines]", "[]"]],
        "bindings": [{"field": "breakdown_type", "title": "Element of work"}],
        "rows": [{"id": None, "is_new": True, "item_description": "", "job_id": 262,
                  "default_job_id": 262, "breakdown_type": eow, "budget_item_category_id": 70,
                  "budget_item_id": None, "assembly_id": None, "currency_id": 8,
                  "curr_alpha3": "AUD", "curr_rate": 1, "qty": None, "unit_price": None,
                  "native_custom_default": "retained"}],
    }


def choices():
    return {"projectPageId": 60, "accounts": [{"id": 401, "name": "Materials"}],
            "taxes": [{"id": 17, "name": "Current GST", "rate": "10"},
                      {"id": 27, "name": "Current GST free", "rate": "0"}]}


class FakePage:
    def __init__(self, initial=None, redirect=None):
        self.snapshot = copy.deepcopy(initial or snapshot())
        self.full_rows = self.snapshot["rows"]
        self.snapshot["rows"] = []
        self.redirect = redirect
        self.closed = False
        self.add_calls = 0
        self.guards = []

    def route(self, pattern, handler):
        self.guards.append((pattern, handler))

    def goto(self, url, **options):
        self.url = self.redirect or url

    def wait_for_function(self, expression, **options):
        pass

    def evaluate(self, expression):
        if expression == native.NATIVE_ADD:
            self.add_calls += 1
            self.snapshot["rows"] = copy.deepcopy(self.full_rows)
            return None
        if expression != native.NATIVE_STATE:
            raise AssertionError("Unexpected browser operation")
        return copy.deepcopy(self.snapshot)

    def close(self):
        self.closed = True


class AllocationTests(unittest.TestCase):
    def test_each_eow_uses_its_actual_native_link_fields(self):
        for eow, category, budget, assembly in [("b_70", 70, None, None),
                                                ("b_615", 19, 482, None),
                                                ("ew_734", None, 583, 919),
                                                ("custom_47", 26, None, 909)]:
            with self.subTest(eow=eow):
                draft = snapshot(eow)
                draft["rows"][0].update(budget_item_category_id=category, budget_item_id=budget,
                                         assembly_id=assembly, eow_allocation_id=5731)
                allocation = native.allocation_from_native(request(eow), draft)
                lines = native.build_lines(request(eow), allocation, choices())
                self.assertEqual(lines[0]["breakdown_type"], eow)
                self.assertEqual(lines[0]["budget_item_category_id"], category)
                self.assertEqual(lines[0]["budget_item_id"], budget)
                self.assertEqual(lines[0]["assembly_id"], assembly)
                self.assertEqual(lines[0]["eow_allocation_id"], 5731)
                self.assertEqual(lines[0]["native_custom_default"], "retained")
                self.assertEqual(draft["rows"][0]["item_description"], "")

    def test_selected_eow_needs_an_exact_native_identity_not_suffix_inference(self):
        draft = snapshot("b_70")
        with self.assertRaisesRegex(ValueError, "selected EOW identity"):
            native.allocation_from_native(request("ew_70"), draft)
        draft["fields"].append(["form[BreakdownType]", "ew_70"])
        with self.assertRaisesRegex(ValueError, "conflicts"):
            native.allocation_from_native(request("ew_70"), draft)
        del draft["rows"][0]["breakdown_type"]
        allocation = native.allocation_from_native(request("ew_70"), draft)
        self.assertEqual(allocation["eowProof"], [{"source": "form", "field": "form[BreakdownType]"}])

    def test_native_bound_eow_widget_identity_can_prove_a_new_family(self):
        draft = snapshot("ew_734")
        del draft["rows"][0]["breakdown_type"]
        draft["rows"][0]["allocation"] = {"id": "ew_734", "text": "Current EOW"}
        draft["bindings"] = [{"field": "allocation", "title": "Element of work"}]
        allocation = native.allocation_from_native(request("ew_734"), draft)
        self.assertEqual(allocation["eowProof"], [{"source": "line", "field": "allocation"}])
        lines = native.build_lines(request("ew_734"), allocation, choices())
        lines[0]["allocation"]["id"] = "ew_735"
        with self.assertRaisesRegex(ValueError, "allocation"):
            native.validate_allocation_lines(lines, request("ew_734"), allocation)

    def test_job_must_be_a_consistent_positive_native_default(self):
        draft = snapshot()
        draft["rows"][0]["job_id"] = None
        allocation = native.allocation_from_native(request(), draft)
        self.assertEqual(allocation["template"]["job_id"], 262)
        for job, default in [(None, None), (262, 999), (False, 262), ("not-a-job", 262)]:
            with self.subTest(job=job, default=default), self.assertRaisesRegex(ValueError, "job allocation"):
                draft["rows"][0].update(job_id=job, default_job_id=default)
                native.allocation_from_native(request(), draft)

    def test_non_aud_and_non_base_currency_defaults_are_rejected(self):
        for updates in [{"currency_id": 9}, {"curr_alpha3": "NZD"}, {"curr_rate": "1.01"}]:
            draft = snapshot()
            draft["rows"][0].update(updates)
            with self.subTest(updates=updates), self.assertRaisesRegex(ValueError, "AUD"):
                native.allocation_from_native(request(), draft)

    def test_line_build_uses_live_tax_identifiers_and_rates(self):
        payload = request()
        allocation = native.allocation_from_native(payload, snapshot())
        lines = native.build_lines(payload, allocation, choices())
        self.assertEqual((lines[0]["tax_rate_id"], lines[0]["tax_rate"]), (17, 10))
        payload["lines"][0]["taxRateId"] = "27"
        payload.update(taxCents=0, totalCents=100000)
        lines = native.build_lines(payload, allocation, choices())
        self.assertEqual((lines[0]["tax_rate_id"], lines[0]["tax_rate"]), (27, 0))
        payload["lines"][0]["taxRateId"] = "1"
        with self.assertRaisesRegex(ValueError, "tax choice"):
            native.build_lines(payload, allocation, choices())

    def test_current_tax_change_or_removed_cos_requires_review(self):
        payload = request()
        allocation = native.allocation_from_native(payload, snapshot())
        current = choices()
        current["taxes"][0]["rate"] = 9
        with self.assertRaisesRegex(ValueError, "totals differ"):
            native.build_lines(payload, allocation, current)
        current = choices()
        current["accounts"][0]["disabled"] = True
        with self.assertRaisesRegex(ValueError, "COS account"):
            native.build_lines(payload, allocation, current)

    def test_per_line_gst_rounding_matches_saved_cent_totals(self):
        payload = request()
        payload["lines"] = [dict(payload["lines"][0], quantity="3", unitPriceExGst="0.015"),
                            dict(payload["lines"][0], quantity="1", unitPriceExGst="0.05")]
        payload.update(subtotalCents=10, taxCents=2, totalCents=12)
        allocation = native.allocation_from_native(payload, snapshot())
        lines = native.build_lines(payload, allocation, choices())
        self.assertEqual([line["amount"] for line in lines], [0.05, 0.05])

    def test_saved_native_allocation_changes_are_detected(self):
        payload = request()
        allocation = native.allocation_from_native(payload, snapshot())
        lines = native.build_lines(payload, allocation, choices())
        for field, value in [("job_id", 999), ("budget_item_category_id", 71),
                             ("budget_item_id", 91), ("assembly_id", 88), ("breakdown_type", "ew_70")]:
            changed = copy.deepcopy(lines)
            changed[0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, field):
                native.validate_allocation_lines(changed, payload, allocation)
        # The server may serialize numeric identities as strings.
        lines[0]["job_id"] = "262"
        native.validate_allocation_lines(lines, payload, allocation)

    def test_another_project_supplier_or_eow_cannot_reuse_allocation(self):
        allocation = native.allocation_from_native(request(), snapshot())
        for key, value in [("projectPageId", 61), ("supplierId", "226"), ("serviceId", "9"),
                           ("breakdownType", "ew_70"), ("quote", {"name": "quote.pdf"})]:
            changed = request()
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                native.build_lines(changed, allocation, choices())

    def test_extra_allocation_links_and_unproven_canonical_eow_are_rejected(self):
        payload = request("ew_734")
        draft = snapshot("ew_734")
        del draft["rows"][0]["breakdown_type"]
        del draft["rows"][0]["budget_item_id"]
        draft["fields"].append(["form[BreakdownType]", "ew_734"])
        allocation = native.allocation_from_native(payload, draft)
        lines = native.build_lines(payload, allocation, choices())
        for field, value in [("budget_item_id", 900), ("breakdown_type", "ew_735")]:
            changed = copy.deepcopy(lines)
            changed[0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "field set changed"):
                native.validate_allocation_lines(changed, payload, allocation)

    def test_corrupt_or_inconsistent_eow_proof_fails_validation(self):
        allocation = native.allocation_from_native(request(), snapshot())
        for proof in ["breakdown_type", ["breakdown_type"], [{"source": "unknown", "field": "x"}],
                      [{"source": "line", "field": "budget_item_category_id"}],
                      [{"source": "line", "field": "unobserved_allocation"}]]:
            changed = copy.deepcopy(allocation)
            changed["eowProof"] = proof
            with self.subTest(proof=proof), self.assertRaisesRegex(ValueError, "proof"):
                native.build_lines(request(), changed, choices())

    def test_capture_blocks_writes_uses_native_add_and_closes_its_page(self):
        page = FakePage()
        result = native.capture_native_form(SimpleNamespace(new_page=lambda: page), request())
        self.assertTrue(page.closed)
        self.assertEqual(page.add_calls, 1)
        self.assertEqual(result["allocation"]["jobId"], 262)
        self.assertEqual(result["createPath"], "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type=b_70")
        for method in ["GET", "HEAD", "OPTIONS", "POST", "PATCH", "PUT", "DELETE"]:
            actions = []
            route = SimpleNamespace(request=SimpleNamespace(method=method),
                                    continue_=lambda: actions.append("read"), abort=lambda: actions.append("blocked"))
            page.guards[0][1](route)
            self.assertEqual(actions, ["read" if method in native.READ_METHODS else "blocked"])

    def test_unproven_allocation_can_be_read_for_lookup_but_not_created(self):
        draft = snapshot()
        draft["rows"][0].update(job_id=None, default_job_id=None)
        page = FakePage(draft)
        with native.native_line_editor(SimpleNamespace(new_page=lambda: page), request()) as editor:
            self.assertIs(editor["page"], page)
            self.assertIsNone(editor["nativeTemplate"]["job_id"])
        self.assertTrue(page.closed)
        with self.assertRaisesRegex(ValueError, "job allocation"):
            native.capture_native_form(SimpleNamespace(new_page=lambda: FakePage(draft)), request())

    def test_capture_rejects_redirect_or_existing_lines_and_still_closes(self):
        for page in [FakePage(redirect="https://lennox.nexvia.com.au/staff/login"),
                     FakePage(initial={**snapshot(), "fields": [["form[ServiceId]", "8"],
                                                               ["form[CurrencyId]", "8"],
                                                               ["form[Lines]", '[{"id":123}]']]})]:
            with self.assertRaises(ValueError):
                native.capture_native_form(SimpleNamespace(new_page=lambda: page), request())
            self.assertTrue(page.closed)
            self.assertEqual(page.add_calls, 0)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for browser JS syntax verification")
    def test_embedded_browser_programs_parse(self):
        script = "const vm=require('node:vm');for(const source of JSON.parse(require('node:fs').readFileSync(0,'utf8')))new vm.Script('('+source+')');"
        subprocess.run(["node", "-e", script], input=json.dumps([native.NATIVE_STATE, native.NATIVE_ADD]),
                       text=True, capture_output=True, check=True)


if __name__ == "__main__":
    unittest.main()
