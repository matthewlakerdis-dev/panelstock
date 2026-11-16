"""Independent regressions for the observed unrestricted metadata aliases."""
import base64
import copy
import json
from types import SimpleNamespace
import unittest

import nexvia_quote_attachment as quote
import test_nexvia_quote_attachment as fixtures


def observed_policy():
    value = fixtures.policy_fields()
    document = {"expiration": "2099-01-01T00:00:00Z", "conditions": [
        {"bucket": "synthetic-bucket"},
        ["starts-with", "$content-disposition", ""],
        {"key": value["key"]},
        ["starts-with", "$content-type", ""],
        {"x-goog-date": value["x-goog-date"]},
        {"x-goog-credential": value["x-goog-credential"]},
        {"x-goog-algorithm": value["x-goog-algorithm"]},
        ["starts-with", "$acl", ""],
    ]}
    value["policy"] = base64.b64encode(json.dumps(document).encode()).decode()
    return value


class PolicyAliasAudit(unittest.TestCase):
    def setUp(self):
        self.allowed = quote.policy_append_fields(fixtures.SEND_SOURCE)
        self.metadata = {"bytes": len(fixtures.RAW)}

    def validate(self, value, allowed=None):
        return quote.validate_policy_response(json.dumps(value).encode(), fixtures.ENDPOINT,
            self.metadata, "private", self.allowed if allowed is None else allowed)

    def condition(self, value, condition):
        result = copy.deepcopy(value)
        document = json.loads(base64.b64decode(result["policy"]))
        document["conditions"].append(condition)
        result["policy"] = base64.b64encode(json.dumps(document).encode()).decode()
        return result

    def post(self, candidates, fields, raw=None):
        body, content_type = fixtures.multipart(fields)
        request = SimpleNamespace(post_data_buffer=body if raw is None else raw,
                                  headers={"content-type": content_type})
        quote.validate_storage_post(request, candidates, fixtures.ENDPOINT,
                                    self.metadata, "private", self.allowed)

    def test_observed_case_aliases_preserve_signed_bytes_and_titlecase_form_fields(self):
        value = observed_policy()
        frozen = copy.deepcopy(value)
        candidates = self.validate(value)
        fields = {**value, "Content-Type": "application/pdf", "acl": "private",
                  "Content-Disposition": "attachment"}
        self.post(candidates, fields)
        self.assertEqual(value, frozen)
        self.assertEqual(candidates[0]["fields"]["policy"], frozen["policy"])
        self.assertEqual(candidates[0]["conditions"],
                         json.loads(base64.b64decode(frozen["policy"]))["conditions"])
        self.assertNotIn("content-type", fields)
        self.assertNotIn("content-disposition", fields)

    def test_empty_aliases_do_not_override_a_second_mime_or_size_restriction(self):
        for extra in ({"Content-Type": "image/jpeg"},
                      ["eq", "$Content-Type", "image/jpeg"],
                      ["content-length-range", 0, len(fixtures.RAW) - 1]):
            with self.subTest(condition=extra), self.assertRaises(quote.QuoteAttachmentError):
                self.validate(self.condition(observed_policy(), extra))

    def test_each_alias_requires_its_own_proven_native_source_field(self):
        for native in ("Content-Type", "Content-Disposition"):
            with self.subTest(missing=native), self.assertRaises(quote.QuoteAttachmentError):
                self.validate(observed_policy(), self.allowed - {native})

    def test_no_alias_for_protected_fields_nonempty_values_eq_or_unobserved_casing(self):
        for extra in (["starts-with", "$KEY", ""],
                      ["starts-with", "$X-Goog-Credential", ""],
                      ["starts-with", "$CONTENT-TYPE", ""],
                      ["starts-with", "$Content-type", ""],
                      ["starts-with", "content-type", ""],
                      ["starts-with", "$content-type", "application/"],
                      ["starts-with", "$content-disposition", "attachment"],
                      ["eq", "$content-disposition", ""],
                      {"content-type": "application/pdf"},
                      ["starts-with", "$unknown", ""]):
            with self.subTest(condition=extra), self.assertRaises(quote.QuoteAttachmentError):
                self.validate(self.condition(observed_policy(), extra))

    def test_post_still_rejects_lowercase_shadow_fields_signature_changes_and_duplicate_values(self):
        value = observed_policy()
        candidates = self.validate(value)
        original = {**value, "Content-Type": "application/pdf", "acl": "private",
                    "Content-Disposition": "attachment"}
        for changed in ({"content-type": "image/jpeg"},
                        {"content-disposition": "unexpected"},
                        {"x-goog-signature": "b" * 512},
                        {"key": "different.pdf"}, {"acl": "public-read"}):
            with self.subTest(changed=changed), self.assertRaises(quote.QuoteAttachmentError):
                self.post(candidates, {**original, **changed})
        body, _ = fixtures.multipart(original)
        duplicate = (b'--fixture-policy-boundary\r\nContent-Disposition: form-data; '
                     b'name="Content-Disposition"\r\n\r\nattachment\r\n--fixture-policy-boundary--')
        with self.assertRaises(quote.QuoteAttachmentError):
            self.post(candidates, original, body.replace(b'--fixture-policy-boundary--', duplicate))


if __name__ == "__main__":
    unittest.main()
