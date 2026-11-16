"""Independent safety checks for the one-GET quote policy diagnostic."""
import base64
import copy
import hashlib
import json
from types import SimpleNamespace
import unittest

import nexvia_check_quote_policy as checker
import nexvia_inspect_failed_quote_upload as parser
import nexvia_quote_attachment as quote


PRIVATE = "PRIVATE-VALUE-NEVER-IN-DIAGNOSTICS"
SEND = """function(e,data){let file=data.files[0];let target;
if(controller==='staff'||controller==='client'){target='/upload/security';}else{target='/'+controller+'/upload/security';}
$.ajax({url:target,type:'GET',data:{file_name:file.clean_name,file_size:file.size,file_type:file.type},async:false});}"""


def fields():
    document = {"expiration": "2099-01-01T00:00:00Z", "conditions": [
        {"bucket": "synthetic-bucket"}, {"acl": "private"}, {"Content-Type": "application/pdf"},
        ["starts-with", "$Content-Disposition", PRIVATE], ["content-length-range", 0, 1000],
        {PRIVATE: PRIVATE}]}
    return {"key": PRIVATE, "policy": base64.b64encode(json.dumps(document).encode()).decode(),
            "x-goog-algorithm": "GOOG4-RSA-SHA256", "x-goog-credential": "fixture@example.invalid/20260101/auto/storage/goog4_request",
            "x-goog-date": "20260101T000000Z", "x-goog-signature": "a" * 512}


class Route:
    def __init__(self, url, method="GET", resource="xhr"):
        self.request = SimpleNamespace(url=url, method=method, resource_type=resource)
        self.calls = []

    def fallback(self): self.calls.append("fallback")
    def abort(self): self.calls.append("abort")


def descriptor(name, value):
    return {"name": name, "value": {"type": "string", "value": value}}


class Session:
    def __init__(self):
        self.calls, self.detached = [], False
        self.graph = {
            "metadata": {"result": [{"name": "send", "value": {"type": "function", "objectId": "fn"}}, descriptor("source", SEND)]},
            "fn": {"result": [], "internalProperties": [{"name": "[[Scopes]]", "value": {"objectId": "scopes"}}]},
            "scopes": {"result": [{"name": "0", "value": {"objectId": "near", "description": "Closure (near)"}},
                                   {"name": "1", "value": {"objectId": "outer", "description": "Closure (outer)"}},
                                   {"name": "2", "value": {"objectId": "global", "description": "Global"}}]},
            "near": {"result": [descriptor("controller", "staff")]},
            "outer": {"result": [descriptor("controller", "WRONG-OUTER")]},
        }

    def send(self, method, params):
        self.calls.append((method, params))
        if method == "Runtime.evaluate": return {"result": {"objectId": "metadata"}}
        if method == "Runtime.getProperties": return self.graph[params["objectId"]]
        if method == "Runtime.releaseObjectGroup": return {}
        raise AssertionError("Unexpected CDP action")

    def detach(self): self.detached = True


class PolicyAuditTests(unittest.TestCase):
    def test_pinned_source_contract_extracts_only_exact_native_get(self):
        q = SimpleNamespace(POLICY_SEND_SHA256=hashlib.sha256(SEND.encode()).hexdigest())
        self.assertEqual(checker.source_route_contract(SEND, q, parser), {
            "controller": "controller", "accepted": ["staff", "client"], "root": "/upload/security",
            "prefix": "/", "suffix": "/upload/security"})
        with self.assertRaisesRegex(checker.PolicyCheckError, "send_source_pin"):
            checker.source_route_contract(SEND + " ", q, parser)
        changed = SEND.replace("type:'GET'", "type:'POST'")
        q.POLICY_SEND_SHA256 = hashlib.sha256(changed.encode()).hexdigest()
        with self.assertRaisesRegex(checker.PolicyCheckError, "policy_callsite_structure"):
            checker.source_route_contract(changed, q, parser)

    def test_browser_barrier_preserves_static_reads_but_denies_uploads_and_actions(self):
        target = quote.ORIGIN + "/staff/project-purchase-order-add/60?service=8"
        cases = [
            (target, "GET", "document", True),
            (quote.ORIGIN + "/staff/project-purchase-order-add/60?service=9", "GET", "document", False),
            (quote.ORIGIN + "/upload/security", "GET", "xhr", False),
            (quote.ORIGIN + "/staff/upload/security", "GET", "xhr", False),
            (quote.ORIGIN + "/staff/upload/details/419", "GET", "xhr", False),
            (quote.ORIGIN + "/staff/upload/details/419.js", "GET", "script", False),
            (quote.ORIGIN + "/staff/project-purchase-order-print/60/1", "GET", "document", False),
            (quote.ORIGIN + "/staff/project-purchase-order-modify/60/1", "GET", "xhr", False),
            (target, "POST", "document", False),
            ("https://synthetic.storage.googleapis.com/", "POST", "xhr", False),
            ("https://storage.googleapis.com/synthetic/logo.png", "GET", "image", True),
            ("https://static.example.invalid/vendor.js", "GET", "script", True),
            (quote.ORIGIN + "/upload/logo.png", "GET", "image", True),
            ("https://storage.googleapis.com/synthetic/private.pdf", "GET", "fetch", False),
            ("https://elsewhere.invalid/private", "GET", "xhr", False),
        ]
        for url, method, resource, allowed in cases:
            with self.subTest(url=url, method=method):
                route = Route(url, method, resource)
                checker.browser_guard(route, target)
                self.assertEqual(route.calls, ["fallback" if allowed else "abort"])

    def test_policy_shape_exposes_types_conditions_and_booleans_without_values(self):
        raw = json.dumps({PRIVATE: {"data": fields()}}).encode()
        shape = checker.response_shape(raw, quote, endpoint="https://synthetic-bucket.storage.googleapis.com/",
                                       acl="private", metadata={"bytes": 100})
        encoded = json.dumps(shape)
        self.assertNotIn(PRIVATE, encoded)
        self.assertNotIn("fixture@example.invalid", encoded)
        self.assertNotIn("synthetic-bucket", encoded)
        self.assertEqual(shape["completeCandidates"], 1)
        candidate = shape["candidates"][0]
        self.assertEqual(candidate["path"], ["[child-0]", "data"])
        disposition = next(row for row in candidate["conditions"] if row.get("field") == "Content-Disposition")
        self.assertFalse(disposition["emptyPrefix"])
        self.assertTrue(candidate["checks"]["algorithmSupported"])
        self.assertTrue(candidate["checks"]["signatureLengthAllowed"])
        self.assertTrue(candidate["checks"]["expiryFuture"])
        self.assertTrue(next(row["coversSourceSize"] for row in candidate["conditions"] if row["op"] == "content-length-range"))

    def test_partial_policy_containers_remain_visible_without_private_names(self):
        value = fields()
        del value["x-goog-signature"]
        shape = checker.response_shape(json.dumps({"data": {"fields": value}}).encode(), quote)
        self.assertEqual(shape["completeCandidates"], 0)
        self.assertIn("x-goog-signature", shape["candidates"][0]["mandatoryMissing"])
        self.assertNotIn(PRIVATE, json.dumps(checker.console_shape(shape)))

    def test_invalid_json_and_nonobject_roots_have_no_raw_content(self):
        for raw in (b'{"key":1,"key":2}', PRIVATE.encode(), b'[]', b'null'):
            shape = checker.response_shape(raw, quote)
            self.assertIn(shape["json"], {"invalid", "nonobject"})
            self.assertNotIn(PRIVATE, json.dumps(shape))

    def test_nearest_lexical_controller_wins_and_cdp_objects_are_released(self):
        session = Session()
        page = SimpleNamespace(context=SimpleNamespace(new_cdp_session=lambda _: session))
        actual = checker.controller_value(page, hashlib.sha256(SEND.encode()).hexdigest(), "controller")
        self.assertEqual(actual, "staff")
        inspected = [params.get("objectId") for method, params in session.calls if method == "Runtime.getProperties"]
        self.assertNotIn("outer", inspected)
        self.assertNotIn("global", inspected)
        self.assertEqual(session.calls[-1][0], "Runtime.releaseObjectGroup")
        self.assertTrue(session.detached)
        self.assertTrue(all(method in {"Runtime.evaluate", "Runtime.getProperties", "Runtime.releaseObjectGroup"} for method, _ in session.calls))

    def test_nearest_accessor_or_invalid_binding_cannot_fall_back(self):
        for value in ({"name": "controller", "get": {"type": "function", "objectId": "getter"}},
                      descriptor("controller", "/external/path"),
                      {"name": "controller", "value": {"type": "object", "objectId": "object"}}):
            session = Session()
            session.graph["near"]["result"] = [copy.deepcopy(value)]
            page = SimpleNamespace(context=SimpleNamespace(new_cdp_session=lambda _: session))
            with self.assertRaises(checker.PolicyCheckError):
                checker.controller_value(page, hashlib.sha256(SEND.encode()).hexdigest(), "controller")
            self.assertFalse(any(params.get("objectId") in {"getter", "outer", "global", "object"} for _, params in session.calls))
            self.assertTrue(session.detached)

    def test_source_mismatch_and_missing_binding_cannot_use_global(self):
        for bad_hash in (False, True):
            session = Session()
            session.graph["near"]["result"] = []
            session.graph["outer"]["result"] = []
            page = SimpleNamespace(context=SimpleNamespace(new_cdp_session=lambda _: session))
            with self.assertRaisesRegex(checker.PolicyCheckError, "send_source_pin" if bad_hash else "controller_not_found"):
                checker.controller_value(page, "0" * 64 if bad_hash else hashlib.sha256(SEND.encode()).hexdigest(), "controller")
            self.assertFalse(any(params.get("objectId") == "global" for _, params in session.calls))
            self.assertTrue(session.detached)


if __name__ == "__main__": unittest.main()
