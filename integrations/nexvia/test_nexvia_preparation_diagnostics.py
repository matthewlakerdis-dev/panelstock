import copy
from contextvars import Context
import inspect
import json
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest.mock import patch

import nexvia_preparation_diagnostics as diagnostics
import nexvia_requests as bridge
from test_nexvia_requests import Fixture, REQUEST_ID, payload


IDENTIFIER = "4d4d512f-5635-4a27-827c-bdfc1eeea439"
SECRET = "https://storage.example/private.pdf?Signature=NEVER_RECORD_THIS"


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.request = {"requestId": IDENTIFIER, "description": "Survey façade", "private": SECRET}

    def tearDown(self):
        self.temporary.cleanup()

    def path(self):
        return self.folder / diagnostics.DIAGNOSTIC_FILE

    def read(self):
        return json.loads(self.path().read_text())

    def failed(self, phase="quote_upload", code=None):
        before = time.time()
        error = ValueError(SECRET)
        with self.assertRaises(ValueError) as caught:
            with diagnostics.preparation_diagnostics(self.folder, self.request):
                diagnostics.stage(phase)
                if code:
                    diagnostics.failure(code)
                raise error
        self.assertIs(caught.exception, error)
        return before, self.read()

    def test_bound_callbacks_carry_only_the_operation_and_support_nested_contexts(self):
        with diagnostics.preparation_diagnostics(self.folder, self.request):
            recorder = diagnostics._CURRENT.get()
            seen = []
            def response(value):
                seen.append(diagnostics._CURRENT.get() is recorder)
                diagnostics.route_event("native_policy", "GET", status=200)
                return value
            bound_response = diagnostics.bind_callback(response)
            def route():
                seen.append(diagnostics._CURRENT.get() is recorder)
                diagnostics.stage("quote_policy")
                diagnostics.transport(policyRequests=1)
                self.assertEqual(Context().run(bound_response, 42), 42)
                self.assertIs(diagnostics._CURRENT.get(), recorder)
                return "same result"
            bound_route = diagnostics.bind_callback(route)
            self.assertEqual(Context().run(bound_route), "same result")
            self.assertIs(diagnostics._CURRENT.get(), recorder)
        self.assertEqual(seen, [True, True])
        self.assertIsNone(diagnostics._CURRENT.get())
        self.assertEqual(self.read()["counters"]["policyRequests"], 1)
        self.assertEqual(self.read()["events"][0]["status"], 200)

    def test_bound_callback_preserves_the_playwright_route_adapter_signature(self):
        def route_callback(route):
            return route
        def dual_callback(route, request):
            return route, request
        for callback in (route_callback, dual_callback):
            callback.synthetic_existing_adapter = object()
            bound = diagnostics.bind_callback(callback)
            self.assertEqual(inspect.signature(bound), inspect.signature(callback))
            self.assertIs(bound.__wrapped__, callback)
            self.assertFalse(hasattr(bound, "synthetic_existing_adapter"))
            route, request = object(), object()
            arguments = [route, request][:len(inspect.signature(bound).parameters)]
            self.assertEqual(bound(*arguments), callback(*arguments))

    def test_bound_callback_preserves_original_exception_and_resets_its_token(self):
        error = ValueError(SECRET)
        with diagnostics.preparation_diagnostics(self.folder, self.request):
            recorder = diagnostics._CURRENT.get()
            def operation():
                self.assertIs(diagnostics._CURRENT.get(), recorder)
                raise error
            bound = diagnostics.bind_callback(operation)
            isolated = Context()
            with self.assertRaises(ValueError) as caught:
                isolated.run(bound)
            self.assertIs(caught.exception, error)
            self.assertIsNone(isolated.run(diagnostics._CURRENT.get))
            self.assertIs(diagnostics._CURRENT.get(), recorder)

    def test_late_and_unscoped_callbacks_run_without_attributing_another_request(self):
        seen = []
        def operation():
            seen.append(diagnostics._CURRENT.get())
            diagnostics.stage("quote_policy")
            diagnostics.transport(policyRequests=1)
            return "still called"
        unscoped = diagnostics.bind_callback(operation)
        with diagnostics.preparation_diagnostics(self.folder, self.request):
            late = diagnostics.bind_callback(operation)
        original = self.path().read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            other = Path(temporary)
            with diagnostics.preparation_diagnostics(other, {**self.request, "other": True}):
                current = diagnostics._CURRENT.get()
                self.assertEqual(late(), "still called")
                self.assertEqual(unscoped(), "still called")
                self.assertIs(diagnostics._CURRENT.get(), current)
            self.assertEqual(json.loads((other / diagnostics.DIAGNOSTIC_FILE).read_text())["counters"]["policyRequests"], 0)
        self.assertEqual(seen, [None, None])
        self.assertEqual(self.path().read_bytes(), original)

    def test_callback_binding_faults_cannot_change_the_operation_result(self):
        class BrokenContext:
            def get(self):
                raise OSError(SECRET)
            def set(self, value):
                raise OSError(SECRET)
        calls = []
        with patch.object(diagnostics, "_CURRENT", BrokenContext()):
            bound = diagnostics.bind_callback(lambda value: calls.append(value) or 42)
            self.assertEqual(bound("executed"), 42)
        self.assertEqual(calls, ["executed"])
        class BrokenReset:
            def get(self):
                return None
            def set(self, value):
                return object()
            def reset(self, token):
                raise OSError(SECRET)
        error = ValueError("original callback failure")
        def failed():
            raise error
        with patch.object(diagnostics, "_CURRENT", BrokenReset()):
            self.assertEqual(diagnostics.bind_callback(lambda: 42)(), 42)
            with self.assertRaises(ValueError) as caught:
                diagnostics.bind_callback(failed)()
        self.assertIs(caught.exception, error)

    def test_transport_observations_are_typed_and_never_contain_native_secrets(self):
        before = time.time()
        with self.assertRaisesRegex(RuntimeError, "NEVER_RECORD_THIS"):
            with diagnostics.preparation_diagnostics(self.folder, self.request):
                diagnostics.stage("quote_policy")
                diagnostics.transport(policyRequests=1, storageUploads=0, registrations=0, header=SECRET)
                diagnostics.route_event("native_policy", "POST", status=403, denied=True)
                diagnostics.route_event(SECRET, "POST", status=403)
                diagnostics.stage(SECRET)
                diagnostics.failure(SECRET)
                diagnostics.failure("quote_policy_blocked")
                raise RuntimeError(SECRET)
        record = self.read()
        self.assertEqual(record["phase"], "quote_policy")
        self.assertEqual(record["code"], "quote_policy_blocked")
        self.assertEqual(record["counters"], {"policyRequests": 1, "storageUploads": 0, "registrations": 0})
        self.assertEqual(record["events"], [{"class": "native_policy", "method": "POST", "status": 403,
                                             "denied": True, "count": 1}])
        raw = self.path().read_text()
        for secret in (SECRET, "NEVER_RECORD_THIS", "Signature", "façade", "RuntimeError"):
            self.assertNotIn(secret, raw)
        self.assertEqual(diagnostics.failure_message(self.folder, self.request, before),
                         diagnostics.PUBLIC_MESSAGES["quote_policy_blocked"])
        self.assertEqual(stat.S_IMODE(self.path().stat().st_mode), 0o600)

    def test_counts_and_event_rows_are_bounded_without_logging_arbitrary_fields(self):
        with self.assertRaises(ValueError):
            with diagnostics.preparation_diagnostics(self.folder, self.request):
                diagnostics.stage("quote_registration")
                diagnostics.transport(policyRequests=100, storageUploads=True, registrations=-1)
                for index in range(30):
                    diagnostics.route_event("native_other", "GET", status=200 + index, denied=True)
                for _ in range(30):
                    diagnostics.route_event("native_other", "GET", status=200, denied=True)
                raise ValueError(SECRET)
        record = self.read()
        self.assertLessEqual(self.path().stat().st_size, diagnostics.MAX_BYTES)
        self.assertEqual(record["counters"]["policyRequests"], diagnostics.MAX_COUNT)
        self.assertEqual(record["counters"]["storageUploads"], 0)
        self.assertEqual(record["counters"]["registrations"], 0)
        self.assertEqual(len(record["events"]), diagnostics.MAX_EVENTS)
        self.assertEqual(record["events"][0]["count"], diagnostics.MAX_COUNT)
        self.assertTrue(record["truncated"])

    def test_existing_request_and_attempt_evidence_are_not_changed(self):
        names = ("request.json", "nexvia-quote-upload-attempt.json", "nexvia-quote-upload.json",
                 "nexvia-prepared.json", "nexvia-create-attempt.json", "nexvia-result.json")
        for name in names:
            (self.folder / name).write_bytes(("original " + name).encode())
        before = {name: (self.folder / name).read_bytes() for name in names}
        self.failed()
        self.assertEqual(before, {name: (self.folder / name).read_bytes() for name in names})
        self.assertEqual(set(path.name for path in self.folder.iterdir()), {*names, diagnostics.DIAGNOSTIC_FILE})

    def test_only_a_fresh_failure_bound_to_the_full_request_can_supply_a_message(self):
        before, record = self.failed()
        self.assertIsNotNone(diagnostics.failure_message(self.folder, self.request, before))
        self.assertIsNone(diagnostics.failure_message(self.folder, {**self.request, "description": "Different"}, before))
        self.assertIsNone(diagnostics.failure_message(self.folder, self.request, time.time() + 1))
        self.assertIsNone(diagnostics.failure_message(self.folder, self.request, before,
                         now=time.time() + diagnostics.MAX_AGE_SECONDS + 1))
        self.assertIsNone(diagnostics.failure_message(self.folder, self.request, float("nan")))
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["code"], "quote_upload_incomplete")

    def test_reader_rejects_malformed_or_unbounded_private_observations(self):
        before, original = self.failed()
        mutations = [lambda value: value.update(version=True),
                     lambda value: value.update(url=SECRET),
                     lambda value: value.update(code=SECRET),
                     lambda value: value.update(phase=SECRET),
                     lambda value: value.update(startedAt="2026-01-01"),
                     lambda value: value.update(requestHash="0" * 64),
                     lambda value: value["counters"].update(storageUploads=True),
                     lambda value: value.update(events=[{"class": "external", "method": "GET", "status": SECRET,
                                                        "denied": True, "count": 1}]),
                     lambda value: value.update(events=[{"class": "external", "method": "GET", "status": 200,
                                                        "denied": True, "count": 1, "url": SECRET}])]
        for mutate in mutations:
            value = copy.deepcopy(original)
            mutate(value)
            self.path().write_text(json.dumps(value))
            with self.subTest(value=value):
                self.assertIsNone(diagnostics.failure_message(self.folder, self.request, before))
        self.path().write_bytes(b"x" * (diagnostics.MAX_BYTES + 1))
        self.assertIsNone(diagnostics.failure_message(self.folder, self.request, before))

    def test_unsafe_file_modes_links_and_folders_are_never_read_or_overwritten(self):
        before, original = self.failed()
        self.path().chmod(0o644)
        self.assertIsNone(diagnostics.failure_message(self.folder, self.request, before))
        self.failed()
        self.assertEqual(self.read(), original)
        self.path().unlink()
        target = self.folder / "do-not-touch.json"
        target.write_text("private original")
        self.path().symlink_to(target)
        with self.assertRaises(ValueError):
            with diagnostics.preparation_diagnostics(self.folder, self.request):
                diagnostics.stage("finance")
                raise ValueError("original exception")
        self.assertTrue(self.path().is_symlink())
        self.assertEqual(target.read_text(), "private original")
        self.assertIsNone(diagnostics.failure_message(self.folder, self.request, before))
        self.path().unlink()
        self.folder.chmod(0o755)
        with self.assertRaises(ValueError):
            with diagnostics.preparation_diagnostics(self.folder, self.request):
                raise ValueError("original exception")
        self.assertFalse(self.path().exists())

    def test_logging_failures_do_not_mask_exceptions_and_context_is_reset(self):
        original = ValueError(SECRET)
        with patch.object(diagnostics.os, "rename", side_effect=OSError("private failure")):
            with self.assertRaises(ValueError) as caught:
                with diagnostics.preparation_diagnostics(self.folder, self.request):
                    diagnostics.stage("finance")
                    raise original
        self.assertIs(caught.exception, original)
        self.assertEqual(list(self.folder.iterdir()), [])
        diagnostics.stage("source")
        diagnostics.failure("quote_policy_blocked")
        diagnostics.transport(policyRequests=1)
        diagnostics.route_event("native_policy", "POST", status=500)
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_persist_or_close_faults_cannot_change_returns_or_original_exceptions(self):
        original = ValueError("business operation failure")
        with patch.object(diagnostics._Recorder, "persist", side_effect=RuntimeError(SECRET)):
            with diagnostics.preparation_diagnostics(self.folder, self.request):
                diagnostics.stage("finance")
            with self.assertRaises(ValueError) as caught:
                with diagnostics.preparation_diagnostics(self.folder, self.request):
                    diagnostics.stage("quote_upload")
                    raise original
            self.assertIs(caught.exception, original)
        close = diagnostics.os.close
        def failed_close(descriptor):
            close(descriptor)
            raise OSError(SECRET)
        with patch.object(diagnostics.os, "close", side_effect=failed_close):
            with diagnostics.preparation_diagnostics(self.folder, self.request):
                diagnostics.stage("finance")
            with self.assertRaises(ValueError) as caught:
                with diagnostics.preparation_diagnostics(self.folder, self.request):
                    diagnostics.stage("quote_upload")
                    raise original
            self.assertIs(caught.exception, original)
            self.assertIsNotNone(diagnostics.failure_message(self.folder, self.request, 0))
        before = self.path().read_bytes()
        diagnostics.stage("source")
        diagnostics.failure("quote_policy_blocked")
        diagnostics.transport(policyRequests=1)
        diagnostics.route_event("native_policy", "POST", status=500)
        self.assertEqual(self.path().read_bytes(), before)

    def test_success_or_interruption_records_status_without_exposing_exceptions(self):
        before = time.time()
        with diagnostics.preparation_diagnostics(self.folder, self.request):
            diagnostics.stage("prepared_save")
        self.assertEqual(self.read()["status"], "prepared")
        self.assertIsNone(diagnostics.failure_message(self.folder, self.request, before))
        with self.assertRaises(KeyboardInterrupt):
            with diagnostics.preparation_diagnostics(self.folder, self.request):
                diagnostics.stage("quote_upload")
                raise KeyboardInterrupt(SECRET)
        self.assertEqual(self.read()["code"], "preparation_interrupted")
        self.assertNotIn(SECRET, self.path().read_text())

    def test_inherited_file_permissions_are_verified_before_writing_observations(self):
        opened, chmod = diagnostics.os.open, diagnostics.os.fchmod
        def inherit_mode(path, *args, **kwargs):
            descriptor = opened(path, *args, **kwargs)
            if str(path).startswith(".nexvia-preparation-diagnostic-"):
                chmod(descriptor, 0o644)
            return descriptor
        with patch.object(diagnostics.os, "open", side_effect=inherit_mode), \
                patch.object(diagnostics.os, "fchmod", return_value=None):
            with diagnostics.preparation_diagnostics(self.folder, self.request):
                diagnostics.stage("finance")
        self.assertEqual(list(self.folder.iterdir()), [])


class BridgeDiagnosticTests(unittest.TestCase):
    def test_only_fresh_bound_diagnostics_supply_a_fixed_public_failure_message(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Fixture(temporary)
            fixture.save_config(creationEnabled=True)
            def fail(request_id):
                folder = fixture.requests / request_id
                request = bridge.read_json(folder / "request.json", private=True)
                try:
                    with diagnostics.preparation_diagnostics(folder, request):
                        diagnostics.stage("quote_policy")
                        diagnostics.failure("quote_policy_blocked")
                        diagnostics.transport(policyRequests=1)
                        diagnostics.route_event("native_policy", "POST", denied=True)
                        raise RuntimeError(SECRET)
                except RuntimeError:
                    return 1
            self.assertEqual(fixture.run(preparer=fail), "needs_review")
            journal = bridge.read_json(fixture.journal / ("request-" + REQUEST_ID + ".json"))
            self.assertEqual(journal["outbound"]["message"], diagnostics.PUBLIC_MESSAGES["quote_policy_blocked"])
            self.assertNotIn(SECRET, json.dumps(journal))
            self.assertNotIn("diagnostics", journal)
            self.assertEqual(fixture.create_calls, [])
            folder = fixture.requests / REQUEST_ID
            self.assertFalse((folder / "nexvia-create-attempt.json").exists())
            before = (fixture.journal / ("request-" + REQUEST_ID + ".json")).read_bytes()
            self.assertEqual(fixture.run(preparer=lambda identifier: self.fail("must not prepare again")), "needs_review")
            self.assertEqual((fixture.journal / ("request-" + REQUEST_ID + ".json")).read_bytes(), before)

    def test_stale_tampered_or_unsafe_observations_fall_back_without_submitting(self):
        for case in ("stale", "wrong-request", "unsafe", "prepared"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                fixture = Fixture(temporary)
                fixture.save_config(creationEnabled=True)
                folder = bridge.stage_request(fixture.requests, payload())
                request = bridge.read_json(folder / "request.json", private=True)
                if case == "stale":
                    with diagnostics.preparation_diagnostics(folder, request):
                        diagnostics.stage("finance")
                def fail(identifier):
                    if case != "stale":
                        try:
                            with diagnostics.preparation_diagnostics(folder, request):
                                diagnostics.stage("finance")
                                if case != "prepared":
                                    raise ValueError(SECRET)
                        except ValueError:
                            pass
                        path = folder / diagnostics.DIAGNOSTIC_FILE
                        if case == "wrong-request":
                            value = json.loads(path.read_text())
                            value["requestHash"] = "0" * 64
                            path.write_text(json.dumps(value))
                        elif case == "unsafe":
                            path.chmod(0o644)
                    return 1
                self.assertEqual(fixture.run(preparer=fail), "needs_review")
                journal = bridge.read_json(fixture.journal / ("request-" + REQUEST_ID + ".json"))
                self.assertEqual(journal["outbound"]["message"], "Fresh preparation failed; no submission authorized")
                self.assertEqual(fixture.create_calls, [])
                self.assertFalse((folder / "nexvia-create-attempt.json").exists())

    def test_failure_observations_do_not_override_an_actual_verified_preparation(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Fixture(temporary)
            fixture.save_config(creationEnabled=True)
            def prepare(identifier):
                result = fixture.preparer(identifier)
                folder = fixture.requests / identifier
                request = bridge.read_json(folder / "request.json", private=True)
                try:
                    with diagnostics.preparation_diagnostics(folder, request):
                        diagnostics.stage("quote_upload")
                        raise ValueError(SECRET)
                except ValueError:
                    return result
            self.assertEqual(fixture.run(preparer=prepare), "created_verified")
            self.assertEqual(len(fixture.create_calls), 1)


if __name__ == "__main__":
    unittest.main()
