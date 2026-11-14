import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


DIRECTORY = Path(__file__).parent
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location("nexvia_quote_attachment", DIRECTORY / "nexvia_quote_attachment.py")
quote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quote)
RAW = b"%PDF-1.7\nSynthetic supplier quote\n%%EOF"
PATH = "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type=ew_734"


def request():
    return {"requestId": "7d913213-5be7-4271-a0fa-9ed1462367f4", "reference": "PR-12345678",
            "projectPageId": 60, "supplierId": "225", "serviceId": "8", "breakdownType": "ew_734",
            "date": "2026-11-13", "requestor": {"name": "Test", "email": "test@example.invalid"},
            "quote": {"filename": "Supplier quote.pdf", "bytes": len(RAW), "sha256": hashlib.sha256(RAW).hexdigest()},
            "lines": [], "totalCents": 110000}


def save(path, value):
    path.write_bytes(quote.canonical(value))
    path.chmod(0o600)


class QuoteEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.folder.chmod(0o700)
        self.request = request()
        self.source = self.folder / quote.SOURCE_FILE
        self.source.write_bytes(RAW)
        self.source.chmod(0o600)
        save(self.folder / "request.json", self.request)
        self.created_at = time.time()
        self.transfer = {"version": 1, "id": self.request["requestId"],
                         "workerId": "a4021607-322d-461f-8ca9-c60287708415",
                         "claimToken": "synthetic-private-claim-token", "quote": self.request["quote"],
                         "createdAt": self.created_at, "expiresAt": self.created_at + quote.SOURCE_TTL_SECONDS}
        save(self.folder / quote.TRANSFER_FILE, self.transfer)

    def tearDown(self):
        self.temporary.cleanup()

    def test_exact_source_is_verified_once_and_upload_payload_keeps_verified_bytes(self):
        self.assertEqual(quote.verify_source(self.folder, self.request), self.source)
        payload = quote.source_upload_payload(self.folder, self.request)
        self.source.write_bytes(b"changed after payload was frozen")
        self.assertEqual(payload, {"name": "Supplier quote.pdf", "mimeType": "application/pdf", "buffer": RAW})
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.source_upload_payload(self.folder, self.request)

    def test_source_must_belong_to_the_exact_saved_request_and_fixed_child(self):
        changed = copy.deepcopy(self.request)
        changed["totalCents"] += 1
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, changed)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request, self.folder / "other.pdf")
        (self.folder / "request.json").chmod(0o644)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)

    def test_symlink_hardlink_and_unsafe_source_permissions_are_rejected(self):
        self.source.chmod(0o644)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)
        self.source.chmod(0o600)
        link = self.folder / "second.pdf"
        os.link(self.source, link)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)
        link.unlink()
        self.source.unlink()
        external = self.folder / "original.pdf"
        external.write_bytes(RAW)
        external.chmod(0o600)
        self.source.symlink_to(external)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)
        self.assertEqual(external.read_bytes(), RAW)

    def test_nonprivate_or_substituted_folder_is_rejected(self):
        self.folder.chmod(0o755)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)
        self.folder.chmod(0o700)
        alias = self.folder / "alias"
        alias.symlink_to(self.folder, target_is_directory=True)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(alias, self.request)

    def test_pdf_size_signature_and_hash_all_match_the_same_opened_bytes(self):
        for raw in [RAW[:-1], RAW + b"extra", b"TEXT-" + RAW[5:], RAW[:-2] + b"xx"]:
            self.source.write_bytes(raw)
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.source_upload_payload(self.folder, self.request)

    def test_expired_missing_or_changed_transfer_blocks_source_and_new_upload(self):
        with patch.object(quote.time, "time", return_value=self.transfer["expiresAt"]):
            with self.assertRaisesRegex(quote.QuoteAttachmentError, "expired"):
                quote.verify_source(self.folder, self.request)
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.source_upload_payload(self.folder, self.request)
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.begin_upload(self.folder, self.request, PATH)
        for changes in [{"id": "a4021607-322d-461f-8ca9-c60287708415"}, {"expiresAt": self.created_at + 3600},
                        {"workerId": "not-a-worker"}, {"claimToken": "short"}, {"createdAt": float("nan")}]:
            # JSON encoding intentionally rejects NaN; validate directly for that shape.
            with self.subTest(changes=changes), self.assertRaises(quote.QuoteAttachmentError):
                quote.validate_source_transfer({**self.transfer, **changes}, self.request)
        (self.folder / quote.TRANSFER_FILE).unlink()
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)

    def test_draft_path_must_preserve_exact_native_request_context(self):
        valid = quote.binding(self.request, PATH)
        self.assertEqual(valid["requestId"], self.request["requestId"])
        self.assertEqual(valid["requestHash"], quote.digest(self.request))
        paths = ["https://foreign.invalid" + PATH, PATH.replace("/60?", "/61?"),
                 PATH.replace("client=225", "client=226"), PATH.replace("service=8", "service=9"),
                 PATH.replace("ew_734", "b_70"), PATH + "&send=true", PATH + "#sent"]
        for path in paths:
            with self.subTest(path=path), self.assertRaises(quote.QuoteAttachmentError):
                quote.binding(self.request, path)

    def test_attempt_is_durable_private_and_exclusive_before_any_upload(self):
        before = self.source.read_bytes()
        attempt = quote.begin_upload(self.folder, self.request, PATH)
        path = self.folder / quote.ATTEMPT_FILE
        self.assertEqual(json.loads(path.read_bytes()), attempt)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        with self.assertRaisesRegex(quote.QuoteAttachmentError, "do not upload again"):
            quote.begin_upload(self.folder, self.request, PATH)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertFalse((self.folder / quote.RECEIPT_FILE).exists())

    def test_partial_or_linked_attempt_also_blocks_replay(self):
        path = self.folder / quote.ATTEMPT_FILE
        path.write_bytes(b"{")
        path.chmod(0o600)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.begin_upload(self.folder, self.request, PATH)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.complete_upload(self.folder, self.request, PATH, [419])
        path.unlink()
        path.symlink_to(self.source)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.begin_upload(self.folder, self.request, PATH)
        self.assertEqual(self.source.read_bytes(), RAW)

    def test_receipt_matches_attempt_request_source_and_exact_native_identity(self):
        quote.begin_upload(self.folder, self.request, PATH)
        receipt = quote.complete_upload(self.folder, self.request, PATH, [419])
        self.assertEqual(quote.load_receipt(self.folder, self.request, PATH), receipt)
        self.assertEqual(quote.receipt_fields(receipt), [["form[Files][]", "419"]])
        self.assertEqual(quote.file_ids_from_fields([["form[Lines]", "[]"], ["form[Files][]", ""],
                                                    ["form[Files][]", "419"]]), [419])
        self.assertEqual(stat.S_IMODE((self.folder / quote.RECEIPT_FILE).stat().st_mode), 0o600)
        # Metadata remains usable after the independently acknowledged byte purge.
        self.source.unlink()
        with patch.object(quote.time, "time", return_value=self.transfer["expiresAt"] + 1):
            self.assertEqual(quote.load_receipt(self.folder, self.request, PATH), receipt)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.complete_upload(self.folder, self.request, PATH, [420])

    def test_receipt_mutation_and_other_request_context_are_rejected(self):
        quote.begin_upload(self.folder, self.request, PATH)
        receipt = quote.complete_upload(self.folder, self.request, PATH, [419])
        for changes in [{"nativeFileIds": [420]}, {"quote": {**self.request["quote"], "sha256": "0" * 64}},
                        {"requestId": "2c2eaf70-1735-4b17-b48b-acb65c38bdc2"}, {"uploadedAt": "no date"},
                        {"extra": True}]:
            with self.subTest(changes=changes), self.assertRaises(quote.QuoteAttachmentError):
                quote.validate_receipt({**receipt, **changes}, self.request, PATH)
        changed = copy.deepcopy(self.request)
        changed["reference"] = "PR-other"
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.load_receipt(self.folder, changed, PATH)

    def test_only_one_positive_js_safe_native_file_id_is_accepted(self):
        for values in [[], [1, 2], [True], [0], [-1], ["419"], [9007199254740992]]:
            with self.subTest(values=values), self.assertRaises(quote.QuoteAttachmentError):
                quote.native_file_ids(values)
        for fields in [[], [["form[Files][]", "0"]], [["form[Files][]", "0419"]],
                       [["form[Files][]", "419"], ["form[Files][]", "419"]],
                       [["form[Files][]", "9007199254740992"]]]:
            with self.subTest(fields=fields), self.assertRaises(quote.QuoteAttachmentError):
                quote.file_ids_from_fields(fields)

    def test_synology_permission_inheritance_is_corrected_before_evidence_write(self):
        real_open, real_fchmod, real_write = os.open, os.fchmod, os.fdopen
        opened = []

        def inherited_open(path, flags, mode=0o777, **kwargs):
            descriptor_fd = real_open(path, flags, mode, **kwargs)
            if flags & os.O_CREAT:
                real_fchmod(descriptor_fd, 0o666)
                opened.append(descriptor_fd)
            return descriptor_fd

        def checked_fdopen(descriptor_fd, mode):
            stream = real_write(descriptor_fd, mode)
            original_write = stream.write

            def write(raw):
                self.assertEqual(stat.S_IMODE(os.fstat(descriptor_fd).st_mode), 0o600)
                return original_write(raw)

            if "w" in mode:
                stream.write = write
            return stream

        with patch.object(quote.os, "open", side_effect=inherited_open), \
                patch.object(quote.os, "fdopen", side_effect=checked_fdopen):
            quote.begin_upload(self.folder, self.request, PATH)
            quote.complete_upload(self.folder, self.request, PATH, [419])
        self.assertEqual(len(opened), 2)


if __name__ == "__main__":
    unittest.main()
