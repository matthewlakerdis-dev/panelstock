import copy
from contextlib import nullcontext
import fcntl
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


spec = importlib.util.spec_from_file_location("quote_preparation_inspector", Path(__file__).with_name("nexvia_inspect_quote_preparation.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def fixture():
    state = {"formCount": 1, "formMethod": "POST", "inputCount": 1, "linesEmpty": False,
             "malformedIds": False, "pending": 0, "widgets": [{"url": "https://signed.invalid/private-token"}],
             "policyNames": ["key"], "lines": [{"is_new": True, "item_description": ""}]}
    page = SimpleNamespace(evaluate=Mock(return_value=state))
    editor = {"page": page, "createPath": "/staff/project-purchase-order-add/60", "rows": [{}]}
    creator = SimpleNamespace(prepare=Mock(), submit=Mock(), save=Mock(),
        quote_attachment_descriptor=Mock(side_effect=lambda request, value: value),
        native_line_editor=Mock(return_value=nullcontext(editor)), allocation_from_native=Mock(return_value={}),
        account_tax_for_editor=Mock(return_value={"accounts": [{"type": "Cost of Goods Sold", "id": 1}], "taxes": []}),
        build_lines=Mock(return_value=[]))
    form = SimpleNamespace(collect_choices=Mock(return_value={}), validate_request=Mock(), save_choices=Mock())
    quote = SimpleNamespace(verify_source=Mock(), upload_quote=Mock(), begin_upload=Mock(), complete_upload=Mock(),
        source_upload_payload=Mock(), validate_native_draft=Mock(), NATIVE_STATE_JS="read-only-state", POLICY_FIELDS={"key"},
        QuoteAttachmentError=ValueError)
    lookups = SimpleNamespace(LookupError=type("NativeLookupError", (Exception,), {}))
    request = {"projectPageId": 60, "quote": {"filename": "Quote.pdf", "bytes": 100}}
    return creator, form, quote, lookups, request, editor


class ReadOnlyProbeTests(unittest.TestCase):
    def test_validated_nonempty_draft_is_inspected_with_original_proof_and_no_mutations(self):
        creator, form, quote, lookups, request, editor = fixture()
        original = copy.deepcopy(request)
        result = probe.inspect(object(), request, Path("/synthetic"), creator, form, quote, lookups)
        self.assertTrue(result["passed"])
        self.assertFalse(result["draft"]["linesEmpty"])
        self.assertEqual(request, original)
        self.assertIs(quote.validate_native_draft.call_args.kwargs["native_snapshot"], editor)
        self.assertNotIn("private-token", json.dumps(result))
        for module, names in ((creator, ("prepare", "submit", "save")),
                              (quote, ("upload_quote", "begin_upload", "complete_upload", "source_upload_payload")),
                              (form, ("save_choices",))):
            for name in names:
                getattr(module, name).assert_not_called()

    def test_native_guard_failure_reports_stage_without_signed_upload_values(self):
        creator, form, quote, lookups, request, editor = fixture()
        quote.validate_native_draft.side_effect = ValueError("Native allocation changed.")
        result = probe.inspect(object(), request, Path("/synthetic"), creator, form, quote, lookups)
        self.assertFalse(result["passed"])
        self.assertEqual(result["stage"], "Native quote uploader")
        self.assertEqual(result["message"], "Native allocation changed.")
        self.assertNotIn("private-token", json.dumps(result))

    def test_unexpected_exception_details_are_not_exposed(self):
        creator, form, quote, lookups, request, editor = fixture()
        form.collect_choices.side_effect = RuntimeError("private browser response or token")
        result = probe.inspect(object(), request, Path("/synthetic"), creator, form, quote, lookups)
        self.assertEqual(result["message"], "RuntimeError")
        self.assertEqual(result["stage"], "Live choices and supplier eligibility")

    def test_independent_tripwires_block_mutations_from_a_reader(self):
        for module_name, operation in (("creator", "save"), ("creator", "submit"), ("creator", "prepare"),
                                       ("quote", "begin_upload"), ("quote", "upload_quote"),
                                       ("quote", "source_upload_payload"), ("form", "save_choices")):
            creator, form, quote, lookups, request, editor = fixture()
            module = {"creator": creator, "quote": quote, "form": form}[module_name]
            original = getattr(module, operation)
            form.collect_choices.side_effect = lambda *args: getattr(module, operation)()
            result = probe.inspect(object(), request, Path("/synthetic"), creator, form, quote, lookups)
            self.assertFalse(result["passed"])
            self.assertIn("blocked", result["message"])
            original.assert_not_called()

    def test_evidence_proof_detects_mutations_and_rejects_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            file = root / "request.json"
            file.write_text('{"original":true}')
            before = probe.proof([file, root / "missing.json"])
            self.assertEqual(before, probe.proof([file, root / "missing.json"]))
            file.write_text('{"original":false}')
            self.assertNotEqual(before, probe.proof([file, root / "missing.json"]))
            link = root / "linked.json"
            link.symlink_to(file)
            with self.assertRaises(OSError):
                probe.proof([link])

    def test_existing_work_lock_is_not_created_or_modified_and_busy_worker_is_not_interrupted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            journal = root / "panelstock-request-journal"
            journal.mkdir()
            file = journal / ".bridge.lock"
            file.write_bytes(b"existing")
            with file.open("rb") as busy:
                fcntl.flock(busy, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(probe.InspectionError, "busy"):
                    with probe.work_lock(root, timeout=0):
                        self.fail("must not enter while the watcher owns the lock")
            with probe.work_lock(root, timeout=0):
                self.assertEqual(file.read_bytes(), b"existing")


if __name__ == "__main__":
    unittest.main()
