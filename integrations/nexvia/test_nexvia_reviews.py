import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import nexvia_requests as bridge
import nexvia_reviews as reviews
from test_nexvia_requests import payload, work, WORKER_ID, REQUEST_ID, TOKEN


REVIEW_ID = "e3842d97-9c1e-46fc-82d6-4cb334b4d41c"
REVIEW_CLAIM = "36dde335-191a-4138-8bdc-e77d8e04d895"
NOW = datetime(2026, 11, 16, 1, 2, 3, tzinfo=timezone.utc).timestamp()


class RequestReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.root.chmod(0o700)
        self.requests = self.root / "requests"
        self.requests.mkdir(mode=0o700)
        self.journals = self.root / "journals"
        self.journals.mkdir(mode=0o700)
        self.source = work()
        self.source["payload"]["lines"][0]["description"] = "Survey façade and provide DWG / DXF 📐"
        self.source["documentExpected"] = True
        self.folder = bridge.stage_request(self.requests, self.source["payload"])
        self.message = "Fresh preparation failed; no submission authorized"
        self.outbound = {"workerId": WORKER_ID, "id": REQUEST_ID, "kind": "request",
                         "claimToken": self.source["claimToken"], "state": "needs_review", "message": self.message}
        self.journal = {"version": 1, "workerId": WORKER_ID, "id": REQUEST_ID, "kind": "request",
                        "claimToken": self.source["claimToken"], "workHash": bridge.claimed_work_hash(self.source),
                        "phase": "TERMINAL", "reported": True, "outbound": self.outbound,
                        "documentExpected": True}
        self.journal_path = self.journals / ("request-" + REQUEST_ID + ".json")
        bridge.atomic_json(self.journal_path, self.journal)
        cloud_outcome = json.dumps({"state": "needs_review", "message": self.message},
                                   sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        self.review = {"version": 1, "id": REVIEW_ID, "claimToken": REVIEW_CLAIM, "requestId": REQUEST_ID,
                       "sourceWork": self.source,
                       "previous": {"state": "needs_review", "message": self.message,
                                    "outcomeHash": hashlib.sha256(cloud_outcome).hexdigest()}}
        self.config = {"workerId": WORKER_ID, "token": TOKEN}
        self.delivered = []

    def tearDown(self):
        self.temporary.cleanup()

    def post(self, path, body, token):
        self.assertEqual(path, reviews.REVIEW_RESULT_PATH)
        self.assertEqual(token, TOKEN)
        self.delivered.append(copy.deepcopy(body))
        return {"ok": True, "duplicate": False,
                "review": {key: body[key] for key in ("id", "requestId", "status")}}

    def assess(self, post=None):
        return reviews.assess_review(self.review, self.config, self.journals, self.requests,
                                     post or self.post, NOW)

    def original_bytes(self):
        return self.journal_path.read_bytes(), (self.folder / "request.json").read_bytes()

    def test_exact_reported_failure_without_any_start_markers_is_ready_and_original_is_unchanged(self):
        before = self.original_bytes()
        self.assertEqual(self.assess(), "review_retry_ready")
        body = self.delivered[0]
        self.assertEqual(body["status"], "retry_ready")
        self.assertEqual(body["sourceOutcomeHash"], self.review["previous"]["outcomeHash"])
        self.assertEqual(body["evidence"], {"sourceWorkHash": bridge.claimed_work_hash(self.source),
                         "sourceRequestHash": bridge.fingerprint(self.source["payload"]),
                         "sourceJournalHash": bridge.fingerprint(self.journal), "markersAbsent": True})
        self.assertEqual(body["checkedAt"], "2026-11-16T01:02:03.000Z")
        self.assertEqual(self.original_bytes(), before)
        journal = bridge.read_json(self.journals / "reviews" / (REVIEW_ID + ".json"), private=True)
        self.assertTrue(journal["reported"])
        self.assertEqual(len(list(self.journals.glob("*.json"))), 1)

    def test_quote_source_bytes_are_not_needed_or_read_for_a_replacement_assessment(self):
        self.source.update(quoteAttachmentVersion=1)
        self.source["payload"]["quote"] = {"filename": "New quote required.pdf", "bytes": 15, "sha256": "a" * 64}
        bridge.atomic_json(self.folder / "request.json", self.source["payload"])
        self.journal.update(quoteAttachmentVersion=1, workHash=bridge.claimed_work_hash(self.source))
        bridge.atomic_json(self.journal_path, self.journal)
        self.assertFalse((self.folder / bridge.QUOTE_FILE).exists())
        self.assertEqual(self.assess(), "review_retry_ready")

    def test_every_native_start_marker_blocks_even_if_a_broken_symlink(self):
        for index, marker in enumerate(reviews.MARKERS):
            self.review["id"] = str(__import__("uuid").uuid4())
            target = self.folder / marker
            if index % 2:
                target.symlink_to(self.folder / "missing-target")
            else:
                target.write_text("not opened")
            with self.subTest(marker=marker):
                self.assertEqual(self.assess(), "review_blocked")
                self.assertEqual(self.delivered[-1]["message"], reviews.BLOCKED["started"])
                self.assertIsNone(self.delivered[-1]["evidence"])
            target.unlink()

    def test_preparation_hash_without_its_deleted_marker_still_blocks(self):
        self.journal["preparedHash"] = "b" * 64
        bridge.atomic_json(self.journal_path, self.journal)
        self.assertEqual(self.assess(), "review_blocked")
        self.assertEqual(self.delivered[-1]["message"], reviews.BLOCKED["started"])

    def test_missing_and_nonprivate_original_files_block_with_fixed_messages(self):
        for case in ("request-missing", "request-mode", "request-hardlink", "journal-mode"):
            self.review["id"] = str(__import__("uuid").uuid4())
            local = self.folder / "request.json"
            before = local.read_bytes()
            if case == "request-missing":
                local.unlink()
            elif case == "request-mode":
                local.chmod(0o644)
            elif case == "request-hardlink":
                os.link(local, self.folder / "unexpected-hardlink")
            else:
                self.journal_path.chmod(0o644)
            with self.subTest(case=case):
                self.assertEqual(self.assess(), "review_blocked")
                self.assertEqual(self.delivered[-1]["message"], reviews.BLOCKED["missing" if case == "request-missing" else "unsafe"])
            if case == "request-missing":
                local.write_bytes(before)
            local.chmod(0o600)
            self.journal_path.chmod(0o600)
            (self.folder / "unexpected-hardlink").unlink(missing_ok=True)

    def test_substituted_request_directory_or_json_symlink_never_reads_target(self):
        original = self.folder.with_name("original")
        self.folder.rename(original)
        self.folder.symlink_to(original, target_is_directory=True)
        self.assertEqual(self.assess(), "review_blocked")
        self.assertEqual(self.delivered[-1]["message"], reviews.BLOCKED["unsafe"])
        self.folder.unlink()
        original.rename(self.folder)
        self.review["id"] = str(__import__("uuid").uuid4())
        local = self.folder / "request.json"
        local.rename(self.folder / "original.json")
        local.symlink_to(self.folder / "original.json")
        self.assertEqual(self.assess(), "review_blocked")
        self.assertEqual(self.delivered[-1]["message"], reviews.BLOCKED["unsafe"])

    def test_worker_claim_work_hash_phase_reported_and_outbound_must_all_match(self):
        mutations = [{"workerId": REVIEW_ID}, {"claimToken": REVIEW_CLAIM}, {"workHash": "0" * 64},
                     {"phase": "PREPARING"}, {"reported": False}, {"kind": "lookup"},
                     {"outbound": dict(self.outbound, state="created_verified")},
                     {"outbound": dict(self.outbound, message="Different failure")},
                     {"outbound": dict(self.outbound, result={"purchaseOrderNumber": "PO1"})}]
        for mutation in mutations:
            self.review["id"] = str(__import__("uuid").uuid4())
            bridge.atomic_json(self.journal_path, dict(self.journal, **mutation))
            with self.subTest(mutation=mutation):
                self.assertEqual(self.assess(), "review_blocked")
                self.assertEqual(self.delivered[-1]["message"], reviews.BLOCKED["mismatch"])

    def test_exact_request_values_and_presence_are_bound_not_just_request_uuid(self):
        for changes in ({"totalCents": 1}, {"supplierId": "999"}, {"quote": {"changed": True}}):
            self.review["id"] = str(__import__("uuid").uuid4())
            bridge.atomic_json(self.folder / "request.json", dict(self.source["payload"], **changes))
            with self.subTest(changes=changes):
                self.assertEqual(self.assess(), "review_blocked")
                self.assertEqual(self.delivered[-1]["message"], reviews.BLOCKED["mismatch"])
        self.review["id"] = str(__import__("uuid").uuid4())
        local = dict(self.source["payload"])
        local.pop("quote")
        bridge.atomic_json(self.folder / "request.json", local)
        self.assertEqual(self.assess(), "review_blocked")

    def test_lost_result_response_replays_frozen_body_without_inspecting_source_again(self):
        def lost(path, body, token):
            self.post(path, body, token)
            raise bridge.BridgeError("Synthetic lost response")
        with self.assertRaises(bridge.BridgeError):
            self.assess(lost)
        original_body = self.delivered[0]
        (self.folder / reviews.MARKERS[0]).symlink_to("missing")
        self.journal_path.unlink()
        with patch.object(reviews, "_inspect", side_effect=AssertionError("must not inspect frozen review")):
            self.assertEqual(reviews.service_pending_reviews(self.config, self.journals, self.post), "review_retry_ready")
        self.assertEqual(self.delivered, [original_body, original_body])
        self.assertIsNone(reviews.service_pending_reviews(self.config, self.journals, self.post))

    def test_changed_claim_or_frozen_outbound_is_rejected_without_delivery(self):
        self.assess()
        self.delivered.clear()
        changed = copy.deepcopy(self.review)
        changed["previous"]["message"] = "A different failed request"
        with self.assertRaisesRegex(reviews.ReviewError, "Claimed review changed"):
            reviews.assess_review(changed, self.config, self.journals, self.requests, self.post, NOW)
        self.assertEqual(self.delivered, [])
        path = self.journals / "reviews" / (REVIEW_ID + ".json")
        frozen = bridge.read_json(path, private=True)
        frozen["outbound"]["status"] = "blocked"
        bridge.atomic_json(path, frozen)
        with self.assertRaises(reviews.ReviewError):
            reviews.service_pending_reviews(self.config, self.journals, self.post)
        self.assertEqual(self.delivered, [])

    def test_only_exact_review_identity_and_status_acknowledges_frozen_result(self):
        for wrong in ({"id": REQUEST_ID}, {"requestId": REVIEW_ID}, {"status": "blocked"}):
            def bad_ack(path, body, token):
                self.post(path, body, token)
                return {"ok": True, "review": {**{key: body[key] for key in ("id", "requestId", "status")}, **wrong}}
            with self.subTest(wrong=wrong), self.assertRaises(reviews.ReviewError):
                self.assess(bad_ack)
            frozen = bridge.read_json(self.journals / "reviews" / (REVIEW_ID + ".json"), private=True)
            self.assertFalse(frozen["reported"])

    def test_unsafe_review_directory_or_review_journal_never_overwrites_foreign_target(self):
        target = self.root / "foreign"
        target.mkdir(mode=0o700)
        (self.journals / "reviews").symlink_to(target, target_is_directory=True)
        with self.assertRaises(reviews.ReviewError):
            self.assess()
        self.assertEqual(list(target.iterdir()), [])
        (self.journals / "reviews").unlink()
        (self.journals / "reviews").mkdir(mode=0o700)
        foreign = target / "important.json"
        foreign.write_text("preserved")
        (self.journals / "reviews" / (REVIEW_ID + ".json")).symlink_to(foreign)
        with self.assertRaises(reviews.ReviewError):
            self.assess()
        self.assertEqual(foreign.read_text(), "preserved")

    def test_new_review_directory_repairs_only_its_own_native_creation_mode(self):
        mkdir = os.mkdir
        def native_mkdir(path, mode=0o777, **kwargs):
            mkdir(path, mode, **kwargs)
            os.chmod(path, 0o755, dir_fd=kwargs.get("dir_fd"))
        with patch.object(reviews.os, "mkdir", side_effect=native_mkdir):
            self.assertIsNone(reviews.service_pending_reviews(self.config, self.journals, self.post))
        root = self.journals / "reviews"
        self.assertEqual(root.stat().st_mode & 0o777, 0o700)
        root.chmod(0o755)
        with self.assertRaises(reviews.ReviewError):
            reviews.service_pending_reviews(self.config, self.journals, self.post)
        self.assertEqual(root.stat().st_mode & 0o777, 0o755)

    def test_replayed_same_review_delivers_exact_frozen_assessment_even_after_ack(self):
        self.assess()
        self.folder.rename(self.folder.with_name("original-gone"))
        self.assertEqual(self.assess(), "review_retry_ready")
        self.assertEqual(self.delivered[0], self.delivered[1])

    def test_invalid_claim_envelopes_never_create_assessment_journals(self):
        for mutation in ({"version": True}, {"requestId": "not-a-uuid"}, {"claimToken": "invalid"},
                         {"previous": {"state": "created_verified"}}, {"unexpected": True}):
            changed = dict(self.review, **mutation)
            with self.subTest(mutation=mutation), self.assertRaises(reviews.ReviewError):
                reviews.assess_review(changed, self.config, self.journals, self.requests, self.post, NOW)
        self.assertFalse((self.journals / "reviews").exists())

    def test_nonfinite_claim_or_non_scalar_frozen_status_fails_with_fixed_review_error(self):
        invalid = copy.deepcopy(self.review)
        invalid["sourceWork"]["payload"]["totalCents"] = float("nan")
        with self.assertRaisesRegex(reviews.ReviewError, "Review JSON is invalid"):
            reviews.assess_review(invalid, self.config, self.journals, self.requests, self.post, NOW)
        self.assertFalse((self.journals / "reviews").exists())
        self.assess()
        path = self.journals / "reviews" / (REVIEW_ID + ".json")
        frozen = bridge.read_json(path, private=True)
        frozen["outbound"]["status"] = ["retry_ready"]
        frozen["outboundHash"] = bridge.fingerprint(frozen["outbound"])
        bridge.atomic_json(path, frozen)
        with self.assertRaises(reviews.ReviewError):
            reviews.service_pending_reviews(self.config, self.journals, self.post)


class WatcherReviewTests(unittest.TestCase):
    setUp = RequestReviewTests.setUp
    tearDown = RequestReviewTests.tearDown
    post = RequestReviewTests.post
    assess = RequestReviewTests.assess
    original_bytes = RequestReviewTests.original_bytes
    def watcher(self, post):
        config = self.root / "config.json"
        bridge.atomic_json(config, {"enabled": True, "creationEnabled": True, **self.config})
        projects = self.root / "projects.json"
        bridge.atomic_json(projects, {"projects": [{"projectPageId": 60, "name": "Jardin"}]})
        return bridge.run_once(config, self.requests, projects, self.journals, post=post,
            lookup=lambda *args: self.fail("review cannot call lookup"),
            creator=lambda *args: self.fail("review cannot create a PO"),
            preparer=lambda *args: self.fail("review cannot prepare a PO"),
            refresher=lambda *args: None, now=NOW, prefer_work=True)

    def test_watcher_negotiates_separate_review_and_never_invokes_financial_functions(self):
        def post(path, body, token):
            if path == bridge.WORK_PATH:
                self.assertEqual(body["reviewVersion"], 1)
                return {"ok": True, "work": None, "review": self.review}
            return self.post(path, body, token)
        before = self.original_bytes()
        self.assertEqual(self.watcher(post), "review_retry_ready")
        self.assertEqual(self.original_bytes(), before)

    def test_pending_assessment_delivery_precedes_poll_and_all_other_work(self):
        def lost(*args):
            raise bridge.BridgeError("not delivered")
        with self.assertRaises(bridge.BridgeError):
            self.assess(lost)
        with patch.object(bridge, "service_quote_expiry", side_effect=AssertionError("pending reviews deliver first")):
            self.assertEqual(self.watcher(self.post), "review_retry_ready")

    def test_ordinary_work_and_review_in_one_reply_fail_before_either_is_executed(self):
        def post(path, body, token):
            self.assertEqual(path, bridge.WORK_PATH)
            return {"ok": True, "work": work(), "review": self.review}
        with self.assertRaisesRegex(bridge.BridgeError, "conflicting work and review"):
            self.watcher(post)
        self.assertEqual(self.delivered, [])


if __name__ == "__main__":
    unittest.main()
