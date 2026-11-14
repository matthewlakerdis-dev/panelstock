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
    def test_proven_new_native_string_draft_id_is_normalized_without_exporting_it(self):
        for identifier in ["", "native-temporary-draft-opaque", "9dcd1321-4c8c-42aa-967b-28a5771651d4"]:
            draft = snapshot()
            draft["rows"][0]["id"] = identifier
            draft["nativeNewRowProof"] = {"startedEmpty": True, "addedByNativeControl": True}
            allocation = native.allocation_from_native(request(), draft)
            self.assertIsNone(allocation["template"]["id"])
            self.assertEqual(allocation["nativeDraftId"], {"kind":"string", "length":len(identifier)})
            self.assertEqual(draft["rows"][0]["id"], identifier)
            self.assertIsNone(native.build_lines(request(), allocation, choices())[0]["id"])
            if identifier:
                self.assertNotIn(identifier, json.dumps(allocation))

    def test_nonnull_native_draft_id_needs_exact_born_empty_and_native_add_proof(self):
        for proof in [None, {}, {"startedEmpty":True},
                      {"startedEmpty":False,"addedByNativeControl":True},
                      {"startedEmpty":True,"addedByNativeControl":False},
                      {"startedEmpty":1,"addedByNativeControl":True}]:
            draft = snapshot()
            draft["rows"][0]["id"] = "native-temporary-draft-opaque"
            draft["nativeNewRowProof"] = proof
            with self.subTest(proof=proof), self.assertRaisesRegex(ValueError, "draft identity"):
                native.allocation_from_native(request(), draft)

    def test_numeric_and_unbounded_native_id_values_never_become_draft_ids(self):
        for identifier in [1, 0, -1, 1.5, True, False, "1", "0", "-1", "+1", "1.0", "1e3",
                           "NaN", "Infinity", "0x10", "0b10", "0o10", [], {}, "x"*161, "draft\n"]:
            draft = snapshot()
            draft["rows"][0]["id"] = identifier
            draft["nativeNewRowProof"] = {"startedEmpty":True,"addedByNativeControl":True}
            with self.subTest(identifier=identifier), self.assertRaisesRegex(ValueError, "draft identity"):
                native.allocation_from_native(request(), draft)

    def test_browser_capture_proves_native_add_for_string_id_but_not_preexisting_row(self):
        draft = snapshot()
        draft["rows"][0]["id"] = "native-temporary-draft-opaque"
        page = FakePage(draft)
        result = native.capture_native_form(SimpleNamespace(new_page=lambda:page), request())
        self.assertEqual(page.add_calls, 1)
        self.assertEqual(result["allocation"]["nativeNewRowProof"],
                         {"startedEmpty":True,"addedByNativeControl":True})
        self.assertIsNone(result["nativeTemplate"]["id"])
        page = FakePage(draft)
        page.snapshot["rows"] = copy.deepcopy(page.full_rows)
        with self.assertRaisesRegex(ValueError, "draft identity"):
            native.capture_native_form(SimpleNamespace(new_page=lambda:page), request())
        self.assertEqual(page.add_calls, 0)
        self.assertTrue(page.closed)

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

    def test_native_cost_allocation_links_are_preserved_and_checked(self):
        draft = snapshot()
        draft["rows"][0].update(cost_category_id=83, project_cost_to_complete_link_id=391,
                                project_cost_name="Display only", budget_amount=0)
        allocation = native.allocation_from_native(request(), draft)
        self.assertEqual(allocation["allocationFields"]["cost_category_id"], 83)
        self.assertEqual(allocation["allocationFields"]["project_cost_to_complete_link_id"], 391)
        self.assertNotIn("project_cost_name", allocation["allocationFields"])
        self.assertNotIn("budget_amount", allocation["allocationFields"])
        lines = native.build_lines(request(), allocation, choices())
        for field in ["cost_category_id", "project_cost_to_complete_link_id"]:
            changed = copy.deepcopy(lines)
            changed[0][field] += 1
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, field):
                native.validate_allocation_lines(changed, request(), allocation)

    def test_saved_additional_allocation_links_must_be_empty(self):
        payload = request()
        allocation = native.allocation_from_native(payload, snapshot())
        lines = native.build_lines(payload, allocation, choices())
        lines[0].update(tender_id=None, project_cost_to_complete_link_id="")
        with self.assertRaisesRegex(ValueError, "field set changed"):
            native.validate_allocation_lines(lines, payload, allocation)
        native.validate_allocation_lines(lines, payload, allocation, saved=True)
        for value in [91, "91", 0, False, [], {}]:
            changed = copy.deepcopy(lines)
            changed[0]["tender_id"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "field set changed"):
                native.validate_allocation_lines(changed, payload, allocation, saved=True)

    def test_saved_mode_still_requires_every_captured_allocation(self):
        payload = request()
        allocation = native.allocation_from_native(payload, snapshot())
        lines = native.build_lines(payload, allocation, choices())
        for field, remove in [("budget_item_category_id", True), ("job_id", False)]:
            changed = copy.deepcopy(lines)
            if remove:
                del changed[0][field]
            else:
                changed[0][field] = 999
            with self.subTest(field=field), self.assertRaises(ValueError):
                native.validate_allocation_lines(changed, payload, allocation, saved=True)

    def test_saved_native_job_helper_and_generated_link_normalization(self):
        payload, draft = request(), snapshot()
        draft["rows"][0].update(job_id=128, default_job_id=128)
        allocation = native.allocation_from_native(payload, draft)
        before = copy.deepcopy(allocation)
        lines = native.build_lines(payload, allocation, choices())
        lines[0].update(default_job_id=None, project_cost_to_complete_link_id=918,
                        tender_id=None, job_purchase_order_id=1422)
        native.validate_allocation_lines(lines, payload, allocation, saved=True)
        self.assertEqual(allocation, before)
        for field, value in [("job_id", None), ("job_id", 129), ("budget_item_id", 999),
                             ("breakdown_type", "ew_999"), ("default_job_id", ""),
                             ("default_job_id", False), ("default_job_id", 0), ("default_job_id", 129),
                             ("tender_id", 99), ("unobserved_project_id", 99)]:
            changed = copy.deepcopy(lines)
            changed[0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                native.validate_allocation_lines(changed, payload, allocation, saved=True)
        changed = copy.deepcopy(lines)
        del changed[0]["default_job_id"]
        with self.assertRaisesRegex(ValueError, "field set changed"):
            native.validate_allocation_lines(changed, payload, allocation, saved=True)
        # These exceptions never apply to an incoming/prepared native row.
        with self.assertRaises(ValueError):
            native.validate_allocation_lines(lines, payload, allocation)

    def test_only_a_positive_integer_generated_saved_link_is_accepted(self):
        payload = request()
        allocation = native.allocation_from_native(payload, snapshot())
        lines = native.build_lines(payload, allocation, choices())
        generated = copy.deepcopy(lines)
        generated[0]["project_cost_to_complete_link_id"] = 918
        with self.assertRaisesRegex(ValueError, "field set changed"):
            native.validate_allocation_lines(generated, payload, allocation)
        for value in [True, False, 0, -1, "918", 1.5, [], {}]:
            changed = copy.deepcopy(lines)
            changed[0]["project_cost_to_complete_link_id"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "field set changed"):
                native.validate_allocation_lines(changed, payload, allocation, saved=True)

    def test_parent_order_fk_is_not_eow_allocation_but_must_be_blank_before_save(self):
        draft = snapshot()
        draft["rows"][0]["job_purchase_order_id"] = None
        allocation = native.allocation_from_native(request(), draft)
        self.assertNotIn("job_purchase_order_id", allocation["allocationFields"])
        lines = native.build_lines(request(), allocation, choices())
        lines[0]["job_purchase_order_id"] = 12345
        with self.assertRaisesRegex(ValueError, "purchase-order owner"):
            native.validate_allocation_lines(lines, request(), allocation)
        # The creator checks this ownership against the newly created PO ID.
        native.validate_allocation_lines(lines, request(), allocation, saved=True)
        draft["rows"][0]["job_purchase_order_id"] = 12345
        with self.assertRaisesRegex(ValueError, "blank unsaved line"):
            native.allocation_from_native(request(), draft)

    def test_another_project_supplier_or_eow_cannot_reuse_allocation(self):
        allocation = native.allocation_from_native(request(), snapshot())
        for key, value in [("projectPageId", 61), ("supplierId", "226"), ("serviceId", "9"),
                           ("breakdownType", "ew_70"), ("quote", {"name": "quote.pdf"})]:
            changed = request()
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                native.build_lines(changed, allocation, choices())

    def test_managed_quote_opt_in_preserves_read_only_allocation_and_request(self):
        payload = request()
        descriptor = {"filename": "Supplier quote.pdf", "bytes": 128, "sha256": "a" * 64}
        payload["quote"] = descriptor
        before = copy.deepcopy(payload)
        with self.assertRaisesRegex(ValueError, "without a PDF"):
            native.allocation_from_native(payload, snapshot())
        allocation = native.allocation_from_native(payload, snapshot(), quote_attachment=descriptor)
        lines = native.build_lines(payload, allocation, choices(), quote_attachment=descriptor)
        native.validate_allocation_lines(lines, payload, allocation, quote_attachment=descriptor)
        native.validate_allocation_lines(lines, payload, allocation, saved=True,
                                         quote_attachment=descriptor)
        with self.assertRaisesRegex(ValueError, "without a PDF"):
            native.build_lines(payload, allocation, choices())
        page = FakePage()
        captured = native.capture_native_form(SimpleNamespace(new_page=lambda: page), payload,
                                              quote_attachment=descriptor)
        self.assertEqual(captured["allocation"]["jobId"], 262)
        self.assertTrue(page.closed)
        actions = []
        page.guards[0][1](SimpleNamespace(request=SimpleNamespace(method="POST"),
                                        continue_=lambda: actions.append("allowed"),
                                        abort=lambda: actions.append("blocked")))
        self.assertEqual(actions, ["blocked"])
        self.assertEqual(payload, before)

    def test_managed_quote_context_requires_exact_bounded_metadata(self):
        descriptor = {"filename": "quote.pdf", "bytes": 128, "sha256": "a" * 64}
        for change in (lambda quote: quote.update(filename="../quote.pdf"),
                       lambda quote: quote.update(filename="quote\\file.pdf"),
                       lambda quote: quote.update(filename=" quote.pdf"),
                       lambda quote: quote.update(filename="quote\n.pdf"),
                       lambda quote: quote.update(filename="quote.txt"),
                       lambda quote: quote.update(bytes=True),
                       lambda quote: quote.update(bytes=4),
                       lambda quote: quote.update(bytes=native.MAX_QUOTE_BYTES + 1),
                       lambda quote: quote.update(sha256="A" * 64),
                       lambda quote: quote.update(path="/config/private.pdf")):
            quote = copy.deepcopy(descriptor)
            change(quote)
            payload = request()
            payload["quote"] = quote
            with self.subTest(quote=quote), self.assertRaisesRegex(ValueError, "Quote attachment"):
                native.context_values(payload, quote_attachment=quote)
        payload = request()
        payload["quote"] = descriptor
        with self.assertRaisesRegex(ValueError, "does not match"):
            native.context_values(payload, quote_attachment={**descriptor, "sha256": "b" * 64})
        with self.assertRaisesRegex(ValueError, "Unexpected quote"):
            native.context_values(request(), quote_attachment=descriptor)

    def test_managed_quote_underlying_guard_blocks_late_upload_registration(self):
        for managed in (False, True):
            payload = request()
            descriptor = {"filename": "quote.pdf", "bytes": 128, "sha256": "a" * 64}
            options = {}
            if managed:
                payload["quote"] = descriptor
                options["quote_attachment"] = descriptor
            page = FakePage()
            native.capture_native_form(SimpleNamespace(new_page=lambda: page), payload, **options)
            # This is the guard restored after upload_quote removes its exact
            # one-use registration handler, including a late browser request.
            for method in ("GET", "HEAD", "OPTIONS"):
                for suffix in ("/staff/upload/details", "/staff/upload/details/",
                               "/staff/upload/details/801?filename=quote.pdf"):
                    actions = []
                    route = SimpleNamespace(request=SimpleNamespace(method=method, url=native.BASE + suffix),
                        continue_=lambda: actions.append("read"), abort=lambda: actions.append("blocked"))
                    page.guards[0][1](route)
                    with self.subTest(managed=managed, method=method, suffix=suffix):
                        self.assertEqual(actions, ["blocked" if managed else "read"])
            actions = []
            page.guards[0][1](SimpleNamespace(request=SimpleNamespace(method="GET",
                url=native.BASE + "/staff/project-purchase-order-add/60"),
                continue_=lambda: actions.append("read"), abort=lambda: actions.append("blocked")))
            self.assertEqual(actions, ["read"])

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

    def test_omitted_native_cost_allocation_link_cannot_authorize_lines(self):
        draft = snapshot()
        draft["rows"][0]["cost_category_id"] = 14
        allocation = native.allocation_from_native(request(), draft)
        lines = native.build_lines(request(), allocation, choices())
        del allocation["allocationFields"]["cost_category_id"]
        lines[0]["cost_category_id"] = 999
        with self.assertRaisesRegex(ValueError, "proof omits"):
            native.validate_allocation_lines(lines, request(), allocation)

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

    @unittest.skipUnless(shutil.which("node"), "Node is needed for native grid selection verification")
    def test_selected_raw_file_requires_exact_verified_receipt_identity(self):
        harness = r'''
const vm=require('node:vm');
const source=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const selected={name:'Supplier quote.pdf',size:128};
const input={name:'quoteFiles',files:[selected]};
const grid={columns:[{field:'item_description'}],dataSource:{data:()=>[]}};
let fields=[['form[Files][]','801'],['quoteFiles',selected]];
const form={action:'https://lennox.nexvia.com.au/staff/project-purchase-order-add/60',
 querySelector:()=>({}),querySelectorAll:selector=>selector==='input[type="file"]'?[input]:[{grid}]};
class NativeFormData{entries(){return fields;}}
const context={document:{forms:[form]},window:{jQuery:el=>({data:()=>el.grid})},FormData:NativeFormData,
 location:{href:form.action,origin:'https://lennox.nexvia.com.au',pathname:'/staff/project-purchase-order-add/60'},URL};
const attachment={filename:selected.name,bytes:selected.size,nativeFileIds:[801]};
const run=value=>vm.runInNewContext('('+source+')(attachment)',{...context,attachment:value});
const rejects=(value,label)=>{let rejected=false;try{run(value);}catch{rejected=true;}if(!rejected)throw Error(label);};
rejects(null,'Default snapshot accepted a populated file');
const result=run(attachment);
if(JSON.stringify(result.fields)!=='[["form[Files][]","801"]]')throw Error('Raw file entered form fields');
rejects({...attachment,nativeFileIds:[802]},'Changed hidden ID accepted');
rejects({...attachment,filename:'Other.pdf'},'Changed selected filename accepted');
rejects({...attachment,bytes:129},'Changed selected bytes accepted');
fields.push(['form[Files][]','801']);
rejects(attachment,'Duplicate hidden ID accepted');
fields.pop(); fields.push(['otherFiles',selected]);
rejects(attachment,'Unexpected second raw file accepted');
fields.pop(); input.files=[];fields=[['form[Files][]','801'],['quoteFiles',{name:'',size:0}]];
if(run(attachment).fields.length!==1)throw Error('Cleared native file input was not supported');
'''
        subprocess.run(["node", "-e", harness], input=json.dumps(native.NATIVE_STATE),
                       text=True, capture_output=True, check=True)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for native grid selection verification")
    def test_lines_grid_wins_over_native_order_note_description_column(self):
        harness = r'''
const vm=require('node:vm');
const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const lines={columns:[{field:'item_description',title:'Description'},{field:'breakdown_type',title:'EOW'}],dataSource:{data:()=>[{id:null,is_new:true,item_description:'',breakdown_type:'b_70',marker:'lines'}]}};
const notes={columns:[{field:'description',title:'Description'}],dataSource:{data:()=>[{id:9,description:'Private note',marker:'notes'}]}};
const elements=[{grid:lines},{grid:notes}];
const form={action:'https://lennox.nexvia.com.au/staff/project-purchase-order-add/60',querySelector:()=>({}),querySelectorAll:()=>elements};
class NativeFormData{entries(){return input.fields;}}
const context={document:{forms:[form]},window:{jQuery:el=>({data:()=>el.grid})},FormData:NativeFormData,
 location:{href:form.action,origin:'https://lennox.nexvia.com.au',pathname:'/staff/project-purchase-order-add/60'},URL};
const run=()=>vm.runInNewContext('('+input.source+')()',context);
const selected=run();
if(selected.rows[0].marker!=='lines')throw Error('Note grid was incorrectly selected');
elements.push({grid:lines}); // Duplicated DOM aliases of the same native grid remain unambiguous.
if(run().rows[0].marker!=='lines')throw Error('Native grid aliases were not deduplicated');
elements.push({grid:{...lines}});
let rejected=false;try{run();}catch{rejected=true;}
if(!rejected)throw Error('Multiple actual line grids must remain ambiguous');
process.stdout.write(JSON.stringify(selected));
'''
        result = subprocess.run(["node", "-e", harness],
                                input=json.dumps({"source": native.NATIVE_STATE, "fields": snapshot()["fields"]}),
                                text=True, capture_output=True, check=True)
        selected = json.loads(result.stdout)
        self.assertEqual(selected["bindings"], [{"field":"breakdown_type", "title":"EOW"}])
        self.assertEqual(selected["rows"][0]["marker"], "lines")


if __name__ == "__main__":
    unittest.main()
