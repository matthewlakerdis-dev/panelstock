"""Independent negative cases for policy-bound native registration requests."""
import copy
import hashlib
import json
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

import nexvia_quote_registration as protocol


class RegistrationBindingAudit(unittest.TestCase):
    def setUp(self):
        self.prefix = "/fixture/native-file/"
        override = patch.object(protocol, "PREFIX_SHA256", hashlib.sha256(self.prefix.encode()).hexdigest())
        override.start()
        self.addCleanup(override.stop)
        suffix = "?field=form%5BFiles%5D"
        renderer = {"prefix": protocol.RENDERER_PREFIX, "suffix": suffix,
                    "templateHash": protocol.digest({"prefix": protocol.RENDERER_PREFIX,
                        "suffix": suffix, "cacheProperty": "cache"})}
        self.contract = {"version": 1, "origin": protocol.ORIGIN,
            "doneSourceSha256": protocol.DONE_SOURCE_SHA256,
            "sendSourceSha256": protocol.SEND_SOURCE_SHA256,
            "prefixSha256": protocol.PREFIX_SHA256,
            "rootPrefix": self.prefix, "selectedPathPrefix": "/staff" + self.prefix,
            "controller": "staff", "cacheProperty": "cache", "queryKey": "location",
            "nativeIdField": "id", "metadataField": "path", "renderer": renderer}
        self.contract["contractHash"] = protocol.digest(self.contract)
        self.root = {"id": 419, "path": "PRIVATE/opaque object.pdf?x=1&y=%2F+plus",
            "key": "PRIVATE/signed-key.pdf", "policy": "PRIVATE-SIGNED-POLICY",
            "x-goog-algorithm": "GOOG4-RSA-SHA256", "x-goog-credential": "PRIVATE-CREDENTIAL",
            "x-goog-date": "20260101T000000Z", "x-goog-signature": "PRIVATE-SIGNATURE"}
        self.candidates = [{"pdf": True, "fields": {
            key: self.root[key] for key in protocol.SIGNED_FIELDS}}]
        self.binding = protocol.binding_from_policy(self.root, self.contract, self.candidates)
        self.url = self.binding["registrationURL"] + "?" + urlencode({"location": self.root["path"]})

    def test_the_exact_backend_value_survives_urlencoding_without_rewriting_policy_or_form_data(self):
        before = copy.deepcopy((self.root, self.contract, self.candidates))
        self.assertTrue(protocol.matches_request(self.url, "GET", self.binding))
        self.assertTrue(protocol.matches_request(self.url + "&_=123", "GET", self.binding))
        self.assertEqual((self.root, self.contract, self.candidates), before)
        safe = json.dumps(protocol.public_binding(self.binding))
        for secret in (self.root["path"], self.root["key"], "PRIVATE-SIGNED-POLICY",
                       "PRIVATE-CREDENTIAL", "PRIVATE-SIGNATURE"):
            self.assertNotIn(secret, safe)

    def test_registration_rejects_alternate_paths_origins_credentials_fragments_and_methods(self):
        changes = [self.url.replace("/419?", "/420?"), self.url.replace("/419?", "/419/?"),
            self.url.replace("/419?", "/%34%31%39?"), self.url.replace("/419?", "/418/../419?"),
            self.url.replace("/staff/fixture", "/fixture"), self.url.replace("https:", "http:"),
            self.url.replace("lennox.nexvia.com.au", "lennox.nexvia.com.au:443"),
            self.url.replace("lennox.nexvia.com.au", "other.invalid"),
            self.url.replace("lennox.nexvia.com.au", "user@lennox.nexvia.com.au"), self.url + "#fragment"]
        for value in changes:
            with self.subTest(value=value):
                self.assertFalse(protocol.matches_request(value, "GET", self.binding))
        for method in ("POST", "PUT", "DELETE", "HEAD", "OPTIONS", "get"):
            with self.subTest(method=method):
                self.assertFalse(protocol.matches_request(self.url, method, self.binding))

    def test_registration_rejects_duplicate_extra_malformed_and_double_encoded_metadata(self):
        base = self.binding["registrationURL"] + "?"
        changes = [self.url + "&location=other", self.url + "&extra=1", self.url + "&_=&_=2",
            self.url + "&_=", self.url + "&_=x", self.url + "&_=" + "1" * 21,
            base + urlencode({"Location": self.root["path"]}),
            base + urlencode({"location": urlencode({"value": self.root["path"]})}),
            base + "location=%ZZ", base + "location=%FF", base + "location", base + "location="]
        for value in changes:
            with self.subTest(value=value):
                self.assertFalse(protocol.matches_request(value, "GET", self.binding))
        tampered = copy.deepcopy(self.binding)
        tampered["exactLocation"] = "different"
        self.assertFalse(protocol.matches_request(self.url, "GET", tampered))

    def test_renderer_is_a_separate_exact_file_and_form_field_read(self):
        renderer = self.binding["rendererURL"]
        self.assertTrue(protocol.matches_renderer_request(renderer, "GET", self.binding))
        self.assertTrue(protocol.matches_renderer_request(renderer + "&_=123", "GET", self.binding))
        self.assertFalse(protocol.matches_request(renderer, "GET", self.binding))
        self.assertFalse(protocol.matches_renderer_request(self.url, "GET", self.binding))
        for value in (renderer.replace("/419?", "/420?"), renderer.replace("/419?", "/%34%31%39?"),
                      renderer.replace("/419?", "/419/?"), renderer + "&location=anything",
                      renderer + "&field=form%5BFiles%5D", renderer + "&delete=1", renderer + "&_=-1",
                      renderer.replace("form%5BFiles%5D", "form%5BOther%5D"), renderer + "#fragment"):
            with self.subTest(value=value):
                self.assertFalse(protocol.matches_renderer_request(value, "GET", self.binding))
        self.assertFalse(protocol.matches_renderer_request(renderer, "POST", self.binding))

    def test_invalid_native_id_signed_fields_and_ambiguous_policy_are_refused_before_binding(self):
        for value in (False, 0, -1, "01", "419/other", 9007199254740992):
            with self.subTest(native=value), self.assertRaises(protocol.RegistrationError):
                protocol.binding_from_policy({**self.root, "id": value}, self.contract, self.candidates)
        for field in protocol.SIGNED_FIELDS:
            with self.subTest(field=field), self.assertRaises(protocol.RegistrationError):
                protocol.binding_from_policy({**self.root, field: "different"}, self.contract, self.candidates)
        with self.assertRaises(protocol.RegistrationError):
            protocol.binding_from_policy(self.root, self.contract, self.candidates * 2)


if __name__ == "__main__":
    unittest.main()
