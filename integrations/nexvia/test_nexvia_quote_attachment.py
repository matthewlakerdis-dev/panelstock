import base64
import copy
import hashlib
import io
import importlib.util
import json
import os
import shutil
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import urllib.error
from urllib.parse import urlencode
import unittest
from unittest.mock import patch


DIRECTORY = Path(__file__).parent
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location("nexvia_quote_attachment", DIRECTORY / "nexvia_quote_attachment.py")
quote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quote)
RAW = b"%PDF-1.7\nSynthetic supplier quote\n%%EOF"
PATH = "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type=ew_734"
ENDPOINT = "https://synthetic-bucket.storage.googleapis.com/"
SIGNED = "https://storage.googleapis.com/synthetic-bucket/quote.pdf?Expires=9999999999&Signature=synthetic-signature-value"
REGISTER = quote.ORIGIN + "/staff/upload/details/419?" + urlencode({"nativeMetadata": "https://storage.googleapis.com/synthetic-bucket/quote.pdf"})

POLICY_OPERATION = "fixturePolicy"
SEND_SOURCE = r"""function(e,data){let file=data.files[0];let url;
file.normalized=decodeURIComponent(file.name.replace(/\+/g,'%20')).replace(new RegExp(' ', 'g'),'_').replace(/[%]/g,'_');
file.normalized=file.normalized.replace(' - ','_');file.normalized=file.normalized.replace(/\s+/g,'_');
if(kind){let form=new FormData();form.append('Content-Type',file.type);form.append('acl','private');
form.append('key',file.response.key);form.append('policy',file.response.policy);
form.append('x-goog-algorithm',file.response.algorithm);form.append('x-goog-credential',file.response.credential);
form.append('x-goog-date',file.response.date);form.append('x-goog-signature',file.response.signature);
form.append('Content-Disposition','attachment');form.append('file',file);}}"""


def policy_fields(mime="application/pdf", bucket="synthetic-bucket", key="quote.pdf", size=100000):
    document = {"expiration": "2099-01-01T00:00:00Z", "conditions": [{"bucket": bucket},
        {"Content-Type": mime}, {"acl": "private"}, ["starts-with", "$Content-Disposition", ""],
        ["content-length-range", 0, size]]}
    return {"key": key, "policy": base64.b64encode(json.dumps(document).encode()).decode(),
            "x-goog-algorithm": "GOOG4-RSA-SHA256", "x-goog-credential": "fixture@example.invalid/20260101/auto/storage/goog4_request",
            "x-goog-date": "20260101T000000Z", "x-goog-signature": "a" * 512}


def multipart(fields, raw=RAW):
    boundary = "fixture-policy-boundary"
    parts = []
    for name,value in fields.items():
        parts.append(("--"+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n'+value+'\r\n').encode())
    parts.append(("--"+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="quote.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode()+raw+b"\r\n")
    parts.append(("--"+boundary+"--\r\n").encode())
    return b"".join(parts), "multipart/form-data; boundary="+boundary


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
        for name,value in (("POLICY_SEND_SHA256",hashlib.sha256(SEND_SOURCE.encode()).hexdigest()),
                           ("POLICY_OPERATION_SHA256",hashlib.sha256(POLICY_OPERATION.encode()).hexdigest())):
            setting=patch.object(quote,name,value);setting.start();self.addCleanup(setting.stop)
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


def native_state():
    return {"url": quote.ORIGIN + PATH, "formCount": 1, "formMethod": "POST", "inputCount": 1,
            "widgets": [{"index": 0, "url": ENDPOINT, "method": "POST", "autoUpload": True,
                         "chunkSize": 0, "disabled": False,"sendSource":SEND_SOURCE}], "policyNames": sorted(quote.POLICY_FIELDS),
            "registrationPrefixes": [quote.REGISTRATION_PREFIX], "binding": True, "ids": [],
            "malformedIds": False, "cards": [], "linesEmpty": True, "numbers": [],
            "service": "8", "comment": "", "pending": 0}


def blank_native_snapshot():
    row = {"id": "native-draft-opaque", "is_new": True, "item_description": "",
           "job_purchase_order_id": None, "job_id": 262, "default_job_id": 262,
           "breakdown_type": "ew_734", "budget_item_id": 1,
           "currency_id": 8, "curr_alpha3": "AUD", "curr_rate": 1,
           "quantity": 1, "supplier_min_qty": False, "unit_price": 0, "amount": 0, "curr_amount": 0,
           "tax_rate": 10, "tax_rate_id": 1, "chart_of_account_id": 401,
           "received_qty": 0, "qty_received": 0, "qty_received_modified": False,
           "received": None, "comment": ""}
    return {"fields": [["form[ServiceId]", "8"], ["form[CurrencyId]", "8"], ["form[Lines]", "[]"]],
            "rows": [row], "bindings": [],
            "nativeNewRowProof": {"startedEmpty": True, "addedByNativeControl": True}}


def serialized_native_state(original=None):
    current = copy.deepcopy(original or blank_native_snapshot())
    # Nexvia finance editing serializes its existing blank row into Lines.
    current["fields"] = [[key, json.dumps(current["rows"]) if key == "form[Lines]" else value]
                         for key, value in current["fields"]]
    current.pop("nativeNewRowProof", None)
    return {**native_state(), "linesEmpty": False, "lines": copy.deepcopy(current["rows"]),
            "currency": "8", "nativeSnapshot": current}


def kendo_serialized_native_state(original=None):
    original = copy.deepcopy(original or blank_native_snapshot())
    original["rows"][0]["_editable"] = {"item_description": True, "qty_received": False}
    state = serialized_native_state(original)
    wire = state["lines"][0]
    wire.pop("_editable")
    wire["uid"] = original["rows"][0]["id"]
    wire["id"] = None
    state["nativeSnapshot"]["fields"][2][1] = json.dumps(state["lines"])
    state["nativeRowUid"] = original["rows"][0]["id"]
    return original, state


def live_blank_eow_control_state():
    original = blank_native_snapshot()
    original["rows"][0]["qty"] = original["rows"][0].pop("quantity")
    original["rows"][0].pop("received_qty")
    original["bindings"] = [{"field": "breakdown_type", "title": "Extent of work"}]
    original["fields"].append(["breakdown_type", ""])
    return kendo_serialized_native_state(original)


class NativePage:
    def __init__(self, state=None):
        self.state = copy.deepcopy(state or native_state())
        self.url = self.state["url"]
        self.context = SimpleNamespace(cookies=lambda urls: [])
        self.guards, self.actions = [], []
        self.listeners = []
        self.file_selections, self.policy_fetches = 0, 0
        self.raw = None
        self.registration = REGISTER
        self.extra_requests = []
        self.before_policy = []
        self.before_registration = []
        self.policy_url = quote.ORIGIN+"/staff/upload/"+POLICY_OPERATION
        self.policy_query = None
        self.policy_status = 200
        self.policy_body = json.dumps(policy_fields()).encode()
        self.post_fields = {**policy_fields(),"Content-Type":"application/pdf","acl":"private","Content-Disposition":"attachment"}
        self.post_buffer = "default"
        self.policy_resource = "xhr"
        self.policy_post_data = None

    def evaluate(self, source, arg=None):
        if isinstance(arg,str):
            return arg.replace(" ","_")
        return copy.deepcopy(self.state)

    def on(self,event,callback):
        self.listeners.append(callback)

    def remove_listener(self,event,callback):
        self.listeners.remove(callback)

    def route(self, pattern, guard):
        self.guards.append(guard)

    def unroute(self, pattern, guard):
        self.guards.remove(guard)

    def dispatch(self, method, url, headers=None):
        raw, content_type = multipart(self.post_fields, self.raw or RAW)
        current=SimpleNamespace(method=method,url=url,headers=headers or {},
            resource_type=self.policy_resource if '/upload/'+POLICY_OPERATION in url else "xhr",
            post_data=self.policy_post_data if method=='GET' else None,
            post_data_buffer=(raw if self.post_buffer=="default" else self.post_buffer) if method=='POST' and url==ENDPOINT else None)
        if method=='POST' and url==ENDPOINT:current.headers={**current.headers,'content-type':content_type}
        def continued():
            self.actions.append((method,url,True))
            response=SimpleNamespace(request=current,status=204 if url==ENDPOINT else 200)
            for callback in self.listeners:callback(response)
        def fetch(**options):
            if options!={'max_redirects':0,'timeout':15000}:raise AssertionError(options)
            self.policy_fetches+=1
            return SimpleNamespace(status=self.policy_status,headers={'content-length':str(len(self.policy_body))},
                body=lambda:self.policy_body,dispose=lambda:None)
        route=SimpleNamespace(request=current,continue_=continued,abort=lambda:self.actions.append((method,url,False)),
            fetch=fetch,fulfill=lambda **kwargs:self.actions.append((method,url,True)))
        self.guards[-1](route)

    def locator(self, selector):
        if selector == 'input[type="file"]':
            return SimpleNamespace(set_input_files=self.set_files)
        return SimpleNamespace(wait_for=lambda **kwargs: None)

    def set_files(self, payload):
        self.file_selections += 1
        self.raw = payload["buffer"]
        for method,url,headers in self.before_policy:self.dispatch(method,url,headers)
        query=self.policy_query or {"file_name":payload['name'].replace(' ','_'),"file_size":str(len(payload['buffer'])),"file_type":payload['mimeType']}
        self.policy_request=self.policy_url+'?'+urlencode(query)
        self.dispatch('GET',self.policy_request)
        self.dispatch("OPTIONS", ENDPOINT, {"access-control-request-method": "POST"})
        self.dispatch("POST", ENDPOINT)
        for method,url,headers in self.before_registration:self.dispatch(method,url,headers)
        self.dispatch("GET", self.registration)
        for method, url, headers in self.extra_requests:
            self.dispatch(method, url, headers)
        self.state.update(ids=["419"], cards=[{"url": SIGNED, "pathIds": []}])

    def wait_for_function(self, source, **options):
        pass


class NativeFlowTests(unittest.TestCase):
    setUp = QuoteEvidenceTests.setUp
    tearDown = QuoteEvidenceTests.tearDown

    def isolated_upload(self, page, *, succeeds=False):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary)
            for name in (quote.SOURCE_FILE, "request.json", quote.TRANSFER_FILE):
                (folder/name).write_bytes((self.folder/name).read_bytes())
                (folder/name).chmod(0o600)
            if succeeds:
                result=quote.upload_quote(page,folder,self.request,PATH,downloader=lambda *args:RAW)
                self.assertEqual(result["nativeFileIds"],[419])
            else:
                with self.assertRaises(quote.QuoteAttachmentError):
                    quote.upload_quote(page,folder,self.request,PATH,downloader=lambda *args:RAW)
                self.assertFalse((folder/quote.RECEIPT_FILE).exists())
                self.assertFalse((folder/'nexvia-create-attempt.json').exists())
            return (folder/quote.ATTEMPT_FILE).exists()

    def test_source_pin_and_pure_prefix_are_required_before_any_file_selection(self):
        for source in (None,SEND_SOURCE+' ',SEND_SOURCE.replace('decodeURIComponent','fetch')):
            page=NativePage()
            page.state['widgets'][0]['sendSource']=source
            if source and 'fetch' in source:
                with patch.object(quote,'POLICY_SEND_SHA256',hashlib.sha256(source.encode()).hexdigest()):
                    self.assertFalse(self.isolated_upload(page))
            else:self.assertFalse(self.isolated_upload(page))
            self.assertEqual(page.file_selections,0)
            self.assertEqual(page.policy_fetches,0)

    def test_only_observed_path_grammar_and_exact_typed_metadata_reach_policy_fetch(self):
        for path in ('/upload/','/staff/upload/','/Project/upload/'):
            page=NativePage();page.policy_url=quote.ORIGIN+path+POLICY_OPERATION
            page.policy_query={'file_name':'Supplier_quote.pdf','file_size':str(len(RAW)),'file_type':'application/pdf','_':'1760000000000'}
            self.assertTrue(self.isolated_upload(page,succeeds=True));self.assertEqual(page.policy_fetches,1)
        bad=[('/staff/project-purchase-order-add/'+POLICY_OPERATION,None),
             ('/staff/nested/upload/'+POLICY_OPERATION,None),('/../upload/'+POLICY_OPERATION,None),
             ('/staff/upload/otherOperation',None),('/staff/upload/'+POLICY_OPERATION+'/',None)]
        for changed in ({'file_name':'Supplierquote.pdf'},{'file_size':'0'},{'file_type':'image/png'},
                        {'_':'not-numeric'},{'extra':'1'}):
            query={'file_name':'Supplier_quote.pdf','file_size':str(len(RAW)),'file_type':'application/pdf',**changed}
            bad.append(('/staff/upload/'+POLICY_OPERATION,query))
        for path,query in bad:
            page=NativePage();page.policy_url=quote.ORIGIN+path;page.policy_query=query
            self.assertTrue(self.isolated_upload(page));self.assertEqual(page.policy_fetches,0)
        for resource,body in (('fetch',None),('xhr','unexpected body')):
            page=NativePage();page.policy_resource=resource;page.policy_post_data=body
            self.isolated_upload(page);self.assertEqual(page.policy_fetches,0)

    def test_policy_rejection_never_enables_a_storage_post_or_receipt(self):
        wrong_bucket=policy_fields(bucket='different-bucket')
        expired=policy_fields();document=json.loads(base64.b64decode(expired['policy']));document['expiration']='2000-01-01T00:00:00Z';expired['policy']=base64.b64encode(json.dumps(document).encode()).decode()
        algorithm=policy_fields();algorithm['x-goog-algorithm']='AWS4-HMAC-SHA256'
        for status,body in [(302,json.dumps(policy_fields()).encode()),(403,b'private response'),
                            (200,b'{"key":"one","key":"two"}'),(200,b'x'*(quote.MAX_POLICY_BYTES+1)),
                            *[(200,json.dumps(value).encode()) for value in (wrong_bucket,expired,algorithm,{},[policy_fields()])]]:
            page=NativePage();page.policy_status=status;page.policy_body=body
            self.assertTrue(self.isolated_upload(page));self.assertEqual(page.policy_fetches,1)
            self.assertNotIn(('POST',ENDPOINT,True),page.actions)

    def test_preview_policy_is_validated_but_cannot_authorize_the_original_pdf_post(self):
        pdf=policy_fields();preview=policy_fields(mime='image/jpeg',key='preview.jpg',size=10)
        for shape in ({**pdf,'preview':preview},{'original':pdf,'preview':preview}):
            page=NativePage();page.policy_body=json.dumps(shape).encode()
            self.assertTrue(self.isolated_upload(page,succeeds=True))
        page=NativePage();page.policy_body=json.dumps({**pdf,'preview':preview}).encode()
        page.post_fields={**preview,'Content-Type':'application/pdf','acl':'private','Content-Disposition':'attachment'}
        self.isolated_upload(page);self.assertNotIn(('POST',ENDPOINT,True),page.actions)
        page=NativePage();page.policy_body=json.dumps({**pdf,'preview':policy_fields(bucket='different')}).encode()
        self.isolated_upload(page);self.assertNotIn(('POST',ENDPOINT,True),page.actions)

    def test_native_multipart_fields_bind_one_policy_while_file_bytes_may_be_omitted(self):
        for file_body in (RAW,b''):
            page=NativePage();page.post_buffer=multipart(page.post_fields,file_body)[0]
            self.assertTrue(self.isolated_upload(page,succeeds=True))
        for changed in ({'key':'another.pdf'},{'policy':'bad'},{'x-goog-signature':'b'*512},
                        {'Content-Type':'image/jpeg'},{'acl':'public-read'},{'unexpected':'value'}):
            page=NativePage();page.post_fields.update(changed)
            self.isolated_upload(page);self.assertNotIn(('POST',ENDPOINT,True),page.actions)
        page=NativePage();raw,_=multipart(page.post_fields)
        page.post_buffer=raw.replace(b'--fixture-policy-boundary\r\n',b'--fixture-policy-boundary\r\n',1).replace(b'--fixture-policy-boundary--',b'--fixture-policy-boundary\r\nContent-Disposition: form-data; name="key"\r\n\r\nquote.pdf\r\n--fixture-policy-boundary--')
        self.isolated_upload(page);self.assertNotIn(('POST',ENDPOINT,True),page.actions)
        page=NativePage();page.post_buffer=None
        self.assertTrue(self.isolated_upload(page,succeeds=True))

    def test_one_policy_fetch_gates_upload_and_duplicate_or_early_transports_are_aborted(self):
        policy=quote.ORIGIN+'/staff/upload/'+POLICY_OPERATION+'?'+urlencode({'file_name':'Supplier_quote.pdf','file_size':str(len(RAW)),'file_type':'application/pdf'})
        for early in ([('POST',ENDPOINT,None)],[('GET',REGISTER,None)],[('GET',policy,None)]):
            page=NativePage();page.before_policy=early
            self.isolated_upload(page)
            self.assertLessEqual(page.policy_fetches,1)
            self.assertLessEqual(sum(method=='POST' and url==ENDPOINT and allowed for method,url,allowed in page.actions),1)
        page=NativePage();page.before_registration=[('GET',policy,None)]
        self.isolated_upload(page);self.assertEqual(page.policy_fetches,1)

    def test_standard_hmac_policy_and_policy_failure_diagnostics_are_sanitized(self):
        value=policy_fields();value['x-goog-algorithm']='GOOG4-HMAC-SHA256';value['x-goog-signature']='c'*64
        page=NativePage();page.policy_body=json.dumps(value).encode();page.post_fields={**value,'Content-Type':'application/pdf','acl':'private','Content-Disposition':'attachment'}
        self.assertTrue(self.isolated_upload(page,succeeds=True))
        import nexvia_preparation_diagnostics as diagnostics
        page=NativePage();page.policy_status=403;page.policy_body=b'NEVER-LOG-THIS-POLICY'
        with self.assertRaises(quote.QuoteAttachmentError):
            with diagnostics.preparation_diagnostics(self.folder,self.request):
                quote.upload_quote(page,self.folder,self.request,PATH,downloader=lambda *args:RAW)
        raw=(self.folder/diagnostics.DIAGNOSTIC_FILE).read_text();observed=json.loads(raw)
        self.assertEqual(observed['code'],'quote_policy_blocked')
        self.assertEqual(observed['counters'],{'policyRequests':1,'storageUploads':0,'registrations':0})
        self.assertNotIn('NEVER-LOG-THIS-POLICY',raw);self.assertNotIn('https://',raw)
        self.assertTrue(any(event['status']==403 and event['class']=='native_policy' for event in observed['events']))

    def test_native_input_uploads_exact_verified_bytes_once_and_freezes_receipt(self):
        page = NativePage()
        receipt = quote.upload_quote(page, self.folder, self.request, PATH,
                                     downloader=lambda context, url, descriptor: page.raw)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(page.raw, RAW)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(page.actions, [("GET",page.policy_request,True),("OPTIONS", ENDPOINT, True), ("POST", ENDPOINT, True), ("GET", REGISTER, True)])
        self.assertEqual(page.policy_fetches,1)
        self.assertEqual(page.guards, [])
        # A local retry with completed native UI can reuse proof, never select again.
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH,
                                           downloader=lambda context, url, descriptor: RAW), receipt)
        self.assertEqual(page.file_selections, 1)

    def test_native_serialized_blank_row_is_proven_before_one_upload_and_on_receipt_reuse(self):
        original = blank_native_snapshot()
        before = copy.deepcopy(original)
        page = NativePage(serialized_native_state(original))
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda context, url, descriptor: page.raw)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(original, before, "blank draft evidence must remain unchanged")
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                           downloader=lambda *args: RAW), receipt)
        self.assertEqual(page.file_selections, 1, "receipt reuse must never select the file again")

    def test_kendo_cleared_id_uid_and_editable_map_preserve_proven_native_blank_row(self):
        original, state = kendo_serialized_native_state()
        before = copy.deepcopy(original)
        page = NativePage(state)
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda *args: RAW)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                           downloader=lambda *args: RAW), receipt)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(original, before)

    def test_recomputed_boolean_editability_map_does_not_change_blank_business_proof(self):
        original, state = kendo_serialized_native_state()
        state["nativeSnapshot"]["rows"][0]["_editable"] = {"item_description": False, "qty_received": True}
        page = NativePage(state)
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda *args: RAW)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(page.file_selections, 1)

    def test_live_false_supplier_minimum_flag_is_not_treated_as_an_entered_quantity(self):
        original = blank_native_snapshot()
        original["rows"][0]["qty"] = original["rows"][0].pop("quantity")
        original["rows"][0].pop("received_qty")
        original, state = kendo_serialized_native_state(original)
        before = copy.deepcopy(original)
        self.assertIs(original["rows"][0]["supplier_min_qty"], False)
        self.assertEqual(original["rows"][0]["qty"], 1)
        self.assertEqual(original["rows"][0]["qty_received"], 0)
        page = NativePage(state)
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda *args: RAW)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                           downloader=lambda *args: RAW), receipt)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(original, before)

    def test_supplier_minimum_flag_changes_types_and_missing_provenance_block_upload(self):
        mutations = [lambda o,s: s["nativeSnapshot"]["rows"][0].update(supplier_min_qty=True),
                     lambda o,s: s["nativeSnapshot"]["rows"][0].update(supplier_min_qty=0),
                     lambda o,s: s["nativeSnapshot"]["rows"][0].update(supplier_min_qty=None),
                     lambda o,s: s["nativeSnapshot"]["rows"][0].pop("supplier_min_qty"),
                     lambda o,s: o["rows"][0].pop("supplier_min_qty"),
                     lambda o,s: o["rows"][0].update(supplier_min_qty=0),
                     lambda o,s: s["nativeSnapshot"]["rows"][0].update(supplier_max_qty=False),
                     lambda o,s: s["nativeSnapshot"]["rows"][0].update(qty=2),
                     lambda o,s: s["nativeSnapshot"]["rows"][0].update(qty=True),
                     lambda o,s: s["nativeSnapshot"]["rows"][0].update(qty_received=1)]
        for mutate in mutations:
            original = blank_native_snapshot()
            original["rows"][0]["qty"] = original["rows"][0].pop("quantity")
            original["rows"][0].pop("received_qty")
            original, state = kendo_serialized_native_state(original)
            mutate(original, state)
            # Make both live representations agree, so the flag guard itself
            # must reject instead of merely detecting a serialization mismatch.
            wire = copy.deepcopy(state["nativeSnapshot"]["rows"][0])
            wire.pop("_editable")
            wire["uid"], wire["id"] = state["nativeRowUid"], None
            state["lines"] = [wire]
            state["nativeSnapshot"]["fields"][2][1] = json.dumps(state["lines"])
            page = NativePage(state)
            with self.subTest(mutate=mutate), self.assertRaises(quote.QuoteAttachmentError):
                quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_late_matching_form_eow_proof_extends_original_duplicate_line_evidence(self):
        original = blank_native_snapshot()
        original["rows"][0]["qty"] = original["rows"][0].pop("quantity")
        original["rows"][0].pop("received_qty")
        original["bindings"] = [{"field": "breakdown_type", "title": "Extent of work"}]
        original, state = kendo_serialized_native_state(original)
        before = copy.deepcopy(original)
        state["nativeSnapshot"]["fields"].append(["breakdown_type", self.request["breakdownType"]])
        initial = quote.allocation_from_native(self.request, original, quote_attachment=self.request["quote"])
        fresh = quote.allocation_from_native(self.request, dict(state["nativeSnapshot"],
            nativeNewRowProof=original["nativeNewRowProof"]), quote_attachment=self.request["quote"])
        self.assertEqual(initial["eowProof"], [{"source": "line", "field": "breakdown_type"}] * 2)
        self.assertEqual(fresh["eowProof"], initial["eowProof"] + [{"source": "form", "field": "breakdown_type"}])
        self.assertEqual(initial["allocationFields"], fresh["allocationFields"])
        page = NativePage(state)
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda *args: RAW)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                           downloader=lambda *args: RAW), receipt)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(original, before)

    def test_live_empty_optional_eow_control_keeps_proven_row_for_upload_and_receipt_reuse(self):
        original, state = live_blank_eow_control_state()
        before = copy.deepcopy(original)
        self.assertEqual([pair for pair in original["fields"] if pair[0] == "breakdown_type"],
                         [["breakdown_type", ""]])
        self.assertEqual(original["rows"][0]["qty"], 1)
        self.assertEqual(original["rows"][0]["qty_received"], 0)
        self.assertIs(original["rows"][0]["supplier_min_qty"], False)
        page = NativePage(state)
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda *args: RAW)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                           downloader=lambda *args: RAW), receipt)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(original, before)
        self.assertEqual([pair for pair in page.state["nativeSnapshot"]["fields"]
                          if pair[0] == "breakdown_type"], [["breakdown_type", ""]])

    def test_native_empty_optional_eow_control_can_later_fill_exact_selected_value(self):
        original, state = live_blank_eow_control_state()
        state["nativeSnapshot"]["fields"][-1][1] = self.request["breakdownType"]
        before = copy.deepcopy(original)
        page = NativePage(state)
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda *args: RAW)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                           downloader=lambda *args: RAW), receipt)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(original, before)

    def test_empty_optional_eow_control_never_masks_invalid_controls_or_missing_selected_row_proof(self):
        cases = ["selected-to-empty", "duplicate-empty", "duplicate-selected", "row-missing-eow", "row-other-eow",
                 None, 0, False, " ", " ew_734", "ew_other"]
        for case in cases:
            original, state = live_blank_eow_control_state()
            fields = state["nativeSnapshot"]["fields"]
            if case == "selected-to-empty":
                original["fields"][-1][1] = self.request["breakdownType"]
            elif case in {"duplicate-empty", "duplicate-selected"}:
                fields.append(["breakdown_type", "" if case == "duplicate-empty" else self.request["breakdownType"]])
            elif case in {"row-missing-eow", "row-other-eow"}:
                # Keep alternative matching evidence available so a blank
                # optional control still needs the exact direct row identity.
                for snapshot in (original, state["nativeSnapshot"]):
                    snapshot["rows"][0]["selected_eow"] = self.request["breakdownType"]
                    snapshot["bindings"] = [{"field": "selected_eow", "title": "Extent of work"}]
                    snapshot["rows"][0]["breakdown_type"] = None if case == "row-missing-eow" else "ew_other"
                wire = copy.deepcopy(state["nativeSnapshot"]["rows"][0])
                wire.pop("_editable")
                wire["uid"], wire["id"] = state["nativeRowUid"], None
                state["lines"] = [wire]
                fields[2][1] = json.dumps(state["lines"])
            else:
                fields[-1][1] = case
            page = NativePage(state)
            with self.subTest(case=case), self.assertRaises(quote.QuoteAttachmentError):
                quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_eow_evidence_extension_never_hides_lost_controls_conflicts_or_business_changes(self):
        for case in ("lost", "all-new", "conflict", "duplicate", "changed-job", "changed-eow"):
            original = blank_native_snapshot()
            if case in {"lost", "all-new"}:
                original["fields"].append(["breakdown_type", self.request["breakdownType"]])
            if case == "all-new":
                original["rows"][0]["breakdown_type"] = None
            original, state = kendo_serialized_native_state(original)
            fields = state["nativeSnapshot"]["fields"]
            if case == "lost":
                fields[:] = [pair for pair in fields if pair[0] != "breakdown_type"]
            elif case == "all-new":
                fields[:] = [["form[replacement_breakdown_type]", value] if name == "breakdown_type" else [name, value]
                             for name, value in fields]
            elif case == "conflict":
                fields.append(["breakdown_type", "ew_different"])
            elif case == "duplicate":
                fields.extend([["breakdown_type", self.request["breakdownType"]]] * 2)
            else:
                fields.append(["breakdown_type", self.request["breakdownType"]])
                state["nativeSnapshot"]["rows"][0].update(
                    {"job_id": 263, "default_job_id": 263} if case == "changed-job" else {"breakdown_type": "ew_different"})
                wire = copy.deepcopy(state["nativeSnapshot"]["rows"][0])
                wire.pop("_editable")
                wire["uid"], wire["id"] = state["nativeRowUid"], None
                state["lines"] = [wire]
                fields[2][1] = json.dumps(state["lines"])
            page = NativePage(state)
            with self.subTest(case=case), self.assertRaises(quote.QuoteAttachmentError):
                quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_invalid_eow_evidence_from_a_changed_native_reader_blocks_file_selection(self):
        invalid = [{"source": "other", "field": "breakdown_type"},
                   {"source": [], "field": "breakdown_type"},
                   {"source": "form", "field": ""},
                   {"source": "form", "field": "breakdown_type\n"},
                   {"source": "form", "field": "breakdown_type", "unvalidated": True}]
        producer = quote.allocation_from_native
        for bad in invalid:
            original, state = kendo_serialized_native_state()
            def changed_reader(request, snapshot, **options):
                allocation = producer(request, snapshot, **options)
                if snapshot is not original:
                    allocation["eowProof"].append(copy.deepcopy(bad))
                return allocation
            page = NativePage(state)
            with self.subTest(bad=bad), patch.object(quote, "allocation_from_native", side_effect=changed_reader), \
                    self.assertRaisesRegex(quote.QuoteAttachmentError, "EOW evidence"):
                quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_kendo_identity_normalization_rejects_wrong_or_unproven_metadata(self):
        changes = [lambda o,s: s.update(nativeRowUid="another-model"),
                   lambda o,s: s["lines"][0].update(uid="another-model"),
                   lambda o,s: s["lines"][0].update(id=1421),
                   lambda o,s: s["lines"][0].update(id="another-draft"),
                   lambda o,s: s["lines"][0].pop("id"),
                   lambda o,s: s["lines"][0].pop("uid"),
                   lambda o,s: o.pop("nativeNewRowProof"),
                   lambda o,s: s["nativeSnapshot"]["rows"][0].update(_editable=True),
                   lambda o,s: s["nativeSnapshot"]["rows"][0].update(_editable={"amount": 1}),
                   lambda o,s: s["nativeSnapshot"]["rows"][0].update(_editable={"amount": {"editable": True}}),
                   lambda o,s: s["lines"][0].update(unit_price=1),
                   lambda o,s: s["lines"][0].update(budget_item_id=True),
                   lambda o,s: s["lines"][0].update(unrecognized_business_field="populated"),
                   lambda o,s: s.update(formFieldsValid=False)]
        for change in changes:
            original, state = kendo_serialized_native_state()
            change(original, state)
            state["nativeSnapshot"]["fields"][2][1] = json.dumps(state["lines"])
            page = NativePage(state)
            with self.subTest(change=change), self.assertRaises(quote.QuoteAttachmentError):
                quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_nonempty_lines_without_original_native_proof_never_select_a_file(self):
        page = NativePage(serialized_native_state())
        with self.assertRaisesRegex(quote.QuoteAttachmentError, "proof"):
            quote.upload_quote(page, self.folder, self.request, PATH)
        self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())
        self.assertEqual(page.file_selections, 0)

    def test_populated_or_changed_serialized_drafts_fail_before_attempt_or_selection(self):
        original = blank_native_snapshot()
        changes = [{"item_description": "Existing work"}, {"comment": "Existing note"},
                   {"contractor_comments": "Existing contractor note"},
                   {"unit_price": 1}, {"amount": "0.01"}, {"curr_amount": -1},
                   {"amount_inc": 1}, {"curr_amount_inc": 1}, {"curr_cost": 1},
                   {"curr_base_cost": 1}, {"curr_converted_cost": 1},
                   {"received_qty": 1}, {"quantity": 2}, {"quantity": True},
                   {"quantity": float("inf")}, {"job_purchase_order_id": 1421},
                   {"received": 1}, {"qty_received_modified": True},
                   {"id": 1421}, {"id": "another-native-draft"},
                   {"budget_item_id": True},
                   {"job_id": 263, "default_job_id": 263}, {"breakdown_type": "ew_735"},
                   {"currency_id": 1, "curr_alpha3": "GBP"}]
        for change in changes:
            with self.subTest(change=change):
                state = serialized_native_state(original)
                state["nativeSnapshot"]["rows"][0].update(change)
                state["lines"] = copy.deepcopy(state["nativeSnapshot"]["rows"])
                state["nativeSnapshot"]["fields"][2][1] = json.dumps(state["lines"])
                page = NativePage(state)
                with self.assertRaises(quote.QuoteAttachmentError):
                    quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
                self.assertEqual(page.file_selections, 0)
                self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_serialized_grid_disagreement_extra_rows_currency_and_birth_proof_are_rejected(self):
        original = blank_native_snapshot()
        mutations = [lambda s: s["lines"][0].update(amount=1),
                     lambda s: s["lines"].append(copy.deepcopy(s["lines"][0])),
                     lambda s: s["nativeSnapshot"]["rows"].append(copy.deepcopy(s["lines"][0])),
                     lambda s: s["nativeSnapshot"]["fields"][2].__setitem__(1, "[]"),
                     lambda s: s.update(currency="1"),
                     lambda s: s["nativeSnapshot"]["fields"].__setitem__(1, ["form[CurrencyId]", "1"])]
        for mutate in mutations:
            state = serialized_native_state(original)
            mutate(state)
            page = NativePage(state)
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())
        missing = copy.deepcopy(original)
        missing.pop("nativeNewRowProof")
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.upload_quote(NativePage(serialized_native_state(original)), self.folder, self.request,
                               PATH, native_snapshot=missing)
        self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_native_contract_change_fails_before_attempt_or_file_selection(self):
        for change in [{"numbers": ["PO7413"]}, {"ids": ["999"]}, {"inputCount": 2},
                       {"policyNames": ["key", "file"]}, {"binding": False},
                       {"widgets": [{**native_state()["widgets"][0], "url": "https://foreign.invalid/"}]}]:
            state = {**native_state(), **change}
            page = NativePage(state)
            with self.subTest(change=change), self.assertRaises(quote.QuoteAttachmentError):
                quote.upload_quote(page, self.folder, self.request, PATH)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_native_guard_blocks_extra_upload_registration_actions_and_invalid_options(self):
        page = NativePage()
        blocked = [("POST", ENDPOINT, {}), ("GET", REGISTER, {}),
                   ("OPTIONS", ENDPOINT, {"access-control-request-method": "DELETE"}),
                   ("POST", quote.ORIGIN + PATH, {}),
                   ("GET", quote.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1", {}),
                   ("GET", "https://foreign.invalid/", {})]
        page.extra_requests = blocked
        quote.upload_quote(page, self.folder, self.request, PATH,
                           downloader=lambda context, url, descriptor: RAW)
        self.assertEqual([row[2] for row in page.actions[-len(blocked):]], [False] * len(blocked))

    def test_wrong_draft_download_keeps_attempt_but_never_creates_receipt_or_reuploads(self):
        page = NativePage()
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.upload_quote(page, self.folder, self.request, PATH,
                               downloader=lambda context, url, descriptor: RAW + b"wrong")
        self.assertTrue((self.folder / quote.ATTEMPT_FILE).exists())
        self.assertFalse((self.folder / quote.RECEIPT_FILE).exists())
        next_page = NativePage()
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.upload_quote(next_page, self.folder, self.request, PATH,
                               downloader=lambda context, url, descriptor: RAW)
        self.assertEqual(next_page.file_selections, 0)
        self.assertEqual(next_page.guards, [])

    def test_saved_multiple_ids_need_explicit_quote_download_id_binding(self):
        state = {**native_state(), "ids": ["419", "777"], "cards": [{"url": SIGNED, "pathIds": []}]}
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_file_cards(None, state, self.request["quote"], [419], saved=True,
                                    downloader=lambda *args: RAW)
        state["cards"] = [{"url": quote.ORIGIN + "/staff/file-download/60/419", "pathIds": ["60", "419"]}]
        self.assertEqual(quote.verify_file_cards(None, state, self.request["quote"], [419], saved=True,
                                               downloader=lambda *args: RAW), [419])
        state["ids"] = ["777"]
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_file_cards(None, state, self.request["quote"], [419], saved=True,
                                    downloader=lambda *args: RAW)

    def test_native_metadata_query_is_bounded_to_the_upload_bucket(self):
        self.assertTrue(quote.registration_url(REGISTER, ENDPOINT))
        self.assertTrue(quote.registration_url(REGISTER + "&_=123", ENDPOINT))
        for url in [REGISTER.replace("synthetic-bucket", "different-bucket"),
                    REGISTER + "&send=true", REGISTER.replace("https%3A%2F%2Fstorage.googleapis.com", "http%3A%2F%2Fforeign.invalid"),
                    quote.ORIGIN + "/staff/upload/details/delete", REGISTER.replace("/419?", "/419/another?")]:
            with self.subTest(url=url):
                self.assertFalse(quote.registration_url(url, ENDPOINT))


class Response(io.BytesIO):
    def __init__(self, raw=RAW, status=200, headers=None):
        super().__init__(raw)
        self.status = status
        self.headers = {"Content-Type": "application/pdf", "Content-Length": str(len(raw)), **(headers or {})}


class DownloadTests(unittest.TestCase):
    def test_cookie_free_gcs_get_is_bounded_and_matches_exact_source(self):
        context = SimpleNamespace(cookies=lambda urls: self.fail("External download must not request cookies"))
        requests = []
        opener = SimpleNamespace(open=lambda req, timeout: (requests.append(req), Response())[1])
        self.assertEqual(quote.download_quote(context, SIGNED, request()["quote"], opener=opener), RAW)
        self.assertNotIn("Cookie", requests[0].headers)
        self.assertEqual(requests[0].method, "GET")

    def test_authenticated_native_link_can_redirect_once_to_gcs_without_forwarding_cookie(self):
        native = quote.ORIGIN + "/staff/file-download/60/419"
        requests = []

        def open_response(req, timeout):
            requests.append(req)
            if len(requests) == 1:
                raise urllib.error.HTTPError(native, 302, "redirect", {"Location": SIGNED}, io.BytesIO())
            return Response()

        context = SimpleNamespace(cookies=lambda urls: [{"name": "session", "value": "synthetic-private-cookie"}])
        self.assertEqual(quote.download_quote(context, native, request()["quote"],
                                             opener=SimpleNamespace(open=open_response)), RAW)
        self.assertIn("Cookie", requests[0].headers)
        self.assertNotIn("Cookie", requests[1].headers)

    def test_download_rejects_wrong_body_oversize_encoding_redirect_and_action_link(self):
        cases = [Response(RAW + b"excess"), Response(RAW[:-1]), Response(RAW[:-2] + b"xx"),
                 Response(headers={"Content-Encoding": "gzip"}), Response(headers={"Content-Type": "text/html"})]
        for response in cases:
            with self.subTest(headers=response.headers), self.assertRaises(quote.QuoteAttachmentError):
                quote.download_quote(SimpleNamespace(), SIGNED, request()["quote"],
                                     opener=SimpleNamespace(open=lambda req, timeout: response))
        for url in [quote.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1", "https://foreign.invalid/a.pdf",
                    "http://storage.googleapis.com/bucket/quote.pdf", SIGNED + "&send=1"]:
            with self.subTest(url=url), self.assertRaises(quote.QuoteAttachmentError):
                quote.validated_download_url(url)


class NativeSnapshotScriptTests(unittest.TestCase):
    def test_browser_readers_scope_fields_and_model_uid_to_the_exact_native_form(self):
        script = """
const fs=require('node:fs'), input=JSON.parse(fs.readFileSync(0,'utf8'));
global.location={origin:'https://lennox.nexvia.com.au',pathname:'/staff/project-purchase-order-add/60',href:'https://lennox.nexvia.com.au/staff/project-purchase-order-add/60?type=Assembly'};
const fields=[{name:'form[Lines]',value:'[{"id":null,"uid":"bound-model"}]'},
 {name:'form[ServiceId]',value:'8'},{name:'form[CurrencyId]',value:'8'},{name:'form[Comment]',value:''}];
const model={uid:'bound-model',toJSON:()=>({id:'bound-model',is_new:true})};
const grid={columns:[{field:'item_description'}],dataSource:{data:()=>[model]}};
const form={action:location.href,method:'post',querySelector:()=>fields[0],
 querySelectorAll:selector=>selector==='[name]'?fields:selector==='[data-role="grid"],.k-grid'?[{grid}]:[]};
const other={action:'https://lennox.nexvia.com.au/staff/source',querySelector:()=>({value:'wrong form'})};
global.window={jQuery:element=>({data:()=>element.grid})};
global.document={forms:[other,form],scripts:[],body:{innerText:''},querySelectorAll:()=>[],
 getElementsByName:()=>{throw Error('Global named fields must not be read');}};
const upload=new Function('return ('+input.upload+');')(), identity=new Function('return ('+input.identity+');')();
const valid=upload({filename:'quote.pdf'}), bound=identity();
fields.push({name:'form[Lines]',value:'[]'});
const duplicated=upload({filename:'quote.pdf'});
process.stdout.write(JSON.stringify({valid,bound,duplicated}));
"""
        completed = subprocess.run(["node", "-e", script], input=json.dumps({
            "upload": quote._UPLOAD_STATE_JS, "identity": quote._NATIVE_MODEL_IDENTITY_JS,
        }), text=True, capture_output=True, timeout=15, check=True)
        result = json.loads(completed.stdout)
        self.assertTrue(result["valid"]["formFieldsValid"])
        self.assertEqual(result["valid"]["service"], "8")
        self.assertEqual(result["valid"]["currency"], "8")
        self.assertEqual(result["valid"]["lines"], [{"id": None, "uid": "bound-model"}])
        self.assertEqual(result["bound"], {"uid": "bound-model", "row": {"id": "bound-model", "is_new": True}})
        self.assertFalse(result["duplicated"]["formFieldsValid"], "duplicate Lines controls must fail closed")

    def test_browser_snapshot_compiles_and_binds_exact_selected_file_to_live_grid(self):
        cases = [
            {"path": "/staff/project-purchase-order-add/60", "state": {"linesEmpty": False, "lines": [{"id": None, "uid": "native-id"}], "numbers": [], "ids": []},
             "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
            {"path": "/staff/project-purchase-order-add/60", "state": {"linesEmpty": False, "lines": [{"id": None, "uid": "native-id"}], "numbers": [], "ids": ["419"]},
             "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
            {"path": "/staff/project-purchase-order-modify/60/1421", "state": {"linesEmpty": False, "numbers": ["PO7413"], "ids": ["419"]},
             "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
            {"path": "/staff/project-purchase-order-add/60", "state": {"linesEmpty": True, "lines": [], "numbers": [], "ids": []},
             "afterState": {"linesEmpty": False, "lines": [{"id": None, "uid": "native-id"}], "numbers": [], "ids": []},
             "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
            {"path": "/staff/project-purchase-order-add/60", "state": {"linesEmpty": False, "lines": [{"id": None, "uid": "native-id"}], "numbers": [], "ids": []},
             "staleFields": True, "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
        ]
        script = """
const fs=require('node:fs'), input=JSON.parse(fs.readFileSync(0,'utf8'));
// Compile the complete real reader before replacing its DOM readers.
if(typeof new Function('return ('+input.source+');')()!=='function')throw Error('reader missing');
const results=input.cases.map(c=>{
 global.location={pathname:c.path};
 global.fixtureState=c.state;global.afterState=c.afterState;global.staleFields=c.staleFields;
 const source=input.source.split(input.uploadReader).join('args => global.fixtureState')
   .split(input.allocationReader).join('(attachment=null) => {if(global.afterState)global.fixtureState=global.afterState;return {attachment,rows:[{id:"native-id"}],fields:[["form[Lines]",JSON.stringify(global.staleFields?[]:global.fixtureState.lines)]]};}')
   .split(input.identityReader).join('() => ({uid:"native-id",row:{id:"native-id"}})');
 return new Function('return ('+source+');')()(c.args);
});
process.stdout.write(JSON.stringify(results));
"""
        completed = subprocess.run(["node", "-e", script], input=json.dumps({
            "source": quote.NATIVE_STATE_JS, "uploadReader": quote._UPLOAD_STATE_JS,
            "allocationReader": quote.ALLOCATION_STATE_JS,
            "identityReader": quote._NATIVE_MODEL_IDENTITY_JS, "cases": cases,
        }), text=True, capture_output=True, timeout=15, check=True)
        results = json.loads(completed.stdout)
        self.assertEqual(results[0]["nativeSnapshot"]["attachment"], None)
        self.assertEqual(results[0]["nativeRowUid"], "native-id")
        self.assertEqual(results[1]["nativeSnapshot"]["attachment"], {
            "filename": "Supplier quote.pdf", "bytes": len(RAW), "nativeFileIds": [419]})
        self.assertNotIn("nativeSnapshot", results[2], "saved-PO inspection must not capture a draft proof")
        self.assertFalse(results[3]["linesEmpty"], "the hidden-field snapshot must follow native FormData serialization")
        self.assertEqual(json.loads(results[3]["nativeSnapshot"]["fields"][0][1]), results[3]["lines"])
        self.assertIsNone(results[4]["nativeSnapshot"], "conflicting FormData and hidden Lines must remain rejected")


class SavedProofTests(unittest.TestCase):
    setUp = QuoteEvidenceTests.setUp
    tearDown = QuoteEvidenceTests.tearDown

    def saved_fixture(self):
        quote.begin_upload(self.folder, self.request, PATH)
        receipt = quote.complete_upload(self.folder, self.request, PATH, [419])
        target = quote.ORIGIN + "/staff/project-purchase-order-modify/60/1421"
        result = {"state": "CREATED_VERIFIED", "requestReference": self.request["reference"],
                  "projectPageId": 60, "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413", "url": target,
                  "totalCents": self.request["totalCents"], "verifiedAt": "2026-11-14T00:00:00.123456+00:00",
                  "jobId": 262, "requestorEmailSent": False}
        save(self.folder / "nexvia-result.json", result)
        from nexvia_requests import verified_result
        result = verified_result(self.folder, self.request)
        state = {**native_state(), "url": target, "numbers": ["PO7413"], "comment": "Request reference: " + self.request["reference"],
                 "ids": ["419", "777"], "cards": [{"url": quote.ORIGIN + "/staff/file-download/60/419", "pathIds": ["60", "419"]}]}
        page = NativePage(state)
        page.goto = lambda url, **kwargs: SimpleNamespace(status=200)
        page.wait_for_timeout = lambda value: None
        closed, options, guards = [], {}, []
        context = SimpleNamespace(route=lambda pattern, callback: guards.append(callback),
                                  route_web_socket=lambda *args: None, add_init_script=lambda source: None,
                                  new_page=lambda: page, close=lambda: closed.append(True))

        def owned_context(**kwargs):
            options.update(kwargs)
            return context

        original = SimpleNamespace(pages=[SimpleNamespace(url=quote.ORIGIN + PATH)],
                                   storage_state=lambda: {"cookies": [{"domain": ".nexvia.com.au", "value": "private"},
                                                                      {"domain": "foreign.invalid", "value": "private"}], "origins": []})
        browser = SimpleNamespace(contexts=[original], new_context=owned_context)
        return receipt, result, page, browser, closed, options, guards

    def test_saved_quote_is_read_back_without_source_bytes_or_another_upload(self):
        receipt, result, page, browser, closed, options, guards = self.saved_fixture()
        self.source.unlink()
        with patch.object(quote.time, "time", return_value=self.transfer["expiresAt"] + 1):
            proof = quote.verify_saved_quote(self.folder, self.request, result, receipt, browser=browser,
                                             downloader=lambda *args: RAW)
        self.assertEqual(proof["nativeFileIds"], [419])
        self.assertEqual(proof["uploadReceiptHash"], receipt["receiptHash"])
        self.assertEqual(proof["sha256"], self.request["quote"]["sha256"])
        self.assertEqual(closed, [True])
        self.assertEqual(page.file_selections, 0)
        self.assertEqual(options["service_workers"], "block")
        self.assertFalse(options["accept_downloads"])
        self.assertEqual(len(options["storage_state"]["cookies"]), 1)
        actions = []
        for method, url, kind in [("POST", result["url"], "document"),
                                  ("GET", quote.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1", "document")]:
            guards[0](SimpleNamespace(request=SimpleNamespace(method=method, url=url, resource_type=kind),
                                      continue_=lambda: actions.append("allowed"), abort=lambda: actions.append("blocked")))
        self.assertEqual(actions, ["blocked", "blocked"])

    def test_saved_quote_rejects_wrong_number_ids_bytes_and_changed_result(self):
        receipt, result, page, browser, closed, options, guards = self.saved_fixture()
        original = copy.deepcopy(page.state)
        for changes in [{"numbers": ["PO9999"]}, {"ids": ["777"]}, {"comment": "Different request"}]:
            page.state = {**original, **changes}
            with self.subTest(changes=changes), self.assertRaises(quote.QuoteAttachmentError):
                quote.verify_saved_quote(self.folder, self.request, result, receipt, browser=browser,
                                          downloader=lambda *args: RAW)
        page.state = original
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_saved_quote(self.folder, self.request, result, receipt, browser=browser,
                                      downloader=lambda *args: RAW + b"wrong")
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_saved_quote(self.folder, self.request, {**result, "purchaseOrderId": 999}, receipt,
                                      browser=browser, downloader=lambda *args: RAW)
        self.assertEqual(page.file_selections, 0)

    def test_preflight_checks_policy_and_completion_without_file_selection(self):
        report = {"readOnly": True, "fileSelectionInvoked": False, "uploadOrSaveInvoked": False,
                  "addPage": {"available": True, "emptyUnsavedPostForm": True,
                              "fileInputs": [{"widgets": [{"params": {"type": "POST", "autoUpload": True},
                                                           "routes": [{"destination": {"provider": "gcs", "scheme": "https", "pathClass": "root"}}]}]}],
                              "handlers": [{"formDataFields": sorted(quote.POLICY_FIELDS), "mentionsFilesField": True,
                                            "routes": [{"path": "/staff/upload/details/"}]}]}}
        with patch.object(quote, "check_dependencies", return_value=True), \
                patch("nexvia_inspect_quote_upload.inspect_browser", return_value=report):
            ready = quote.preflight(60, 1421, "PO7413", "Bunnings", browser=object())
            self.assertTrue(ready["nativeUploadReady"])
            self.assertFalse(ready["fileSelectionInvoked"])
            self.assertFalse(ready["uploadOrSaveInvoked"])
            report["addPage"]["available"] = False
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.preflight(60, 1421, "PO7413", "Bunnings", browser=object())


NormalizerError = quote.NormalizerError
normalizer_wrapper = quote.normalizer_wrapper

NORMALIZER_PRIVATE = "NORMALIZER_PRIVATE-SIGNED-POLICY-DO-NOT-EXPORT"
NORMALIZER_PREFIX = r"""let file=data.files[0];let url;
file.normalized=decodeURIComponent(file.name.replace(/\+/g,'%20')).replace(new RegExp('\\r\\n','g'),'').replace(/[%]/g,' ');
file.normalized=file.normalized.replace(' - ','_');
file.normalized=file.normalized.replace(/\s+/g,'_');"""
NORMALIZER_SOURCE = "function(event,data){" + NORMALIZER_PREFIX + "if(kind){fetch('" + NORMALIZER_PRIVATE + "');}return false;}"


def normalizer_digest(source):
    return hashlib.sha256(source.encode()).hexdigest()


def wrap_normalizer(source=NORMALIZER_SOURCE):
    return normalizer_wrapper(source, normalizer_digest(source))


@unittest.skipUnless(shutil.which("node"), "Node executes only the synthetic pure wrapper fixture")
class NormalizerRuntimeTests(unittest.TestCase):
    def execute(self, function, names):
        source = "const vm=require('node:vm');const fn=" + json.dumps(function) + ";const names=" + json.dumps(names) + ";" + \
            "let calls=0;const sandbox={fetch(){calls++;throw Error('network');},XMLHttpRequest(){calls++;throw Error('network');}};" + \
            "const result=vm.runInNewContext('('+fn+')',sandbox);console.log(JSON.stringify({values:names.map(result),calls}));"
        result = subprocess.run(["node", "-e", source], check=True, capture_output=True, text=True)
        return json.loads(result.stdout)

    def test_closed_ast_matches_genuine_pure_prefix_without_calling_native_send_or_network(self):
        wrapper = wrap_normalizer()
        expected = "name=>{let data={files:[{name}]};" + NORMALIZER_PREFIX + "return file.normalized;}"
        names = ["QSS - Queen St.pdf", "hello+world.pdf", "encoded%20space.pdf", "if.pdf", "comma, dot.pdf", "façade.pdf", "emoji 📐.pdf"]
        self.assertEqual(self.execute(wrapper, names), self.execute(expected, names))
        self.assertEqual(self.execute(wrapper, ["QSS - Queen St.pdf"]), {"values": ["QSS_Queen_St.pdf"], "calls": 0})
        self.assertNotIn(NORMALIZER_PRIVATE, wrapper)
        self.assertNotIn("fetch", wrapper)
        self.assertNotIn("XMLHttpRequest", wrapper)

    def test_comments_strings_regexes_with_if_are_not_treated_as_control_flow(self):
        source = "function(e,d){/* if (private) */let f=d.files[0];let u;f.clean=f.name.replace(/if/g,'if string');/* if */if(a){network();}}"
        self.assertEqual(self.execute(wrap_normalizer(source), ["if.pdf"])["values"], ["if string.pdf"])

    def test_native_local_names_cannot_shadow_synthetic_wrapper_bindings(self):
        source = "function(e,d){let __nexvia_file=d.files[0];let __nexvia_filename;__nexvia_file.clean=__nexvia_file.name.replace(/x/g,'y');if(a){network();}}"
        self.assertEqual(self.execute(wrap_normalizer(source), ["x.pdf"])["values"], ["y.pdf"])

    def test_string_escape_and_literal_replacement_syntax_stays_data(self):
        source = r"function(e,d){let f=d.files[0];let u;f.clean=f.name.replace(new RegExp('\u0078','g'),'\";fetch(1);//');if(a){network();}}"
        self.assertEqual(self.execute(wrap_normalizer(source), ["x.pdf"]), {"values": ['";fetch(1);//.pdf'], "calls": 0})


class NormalizerParserTests(unittest.TestCase):
    def test_exact_source_hash_is_verified_before_parsing(self):
        for expected in ("a" * 64, normalizer_digest(NORMALIZER_SOURCE).upper(), "invalid"):
            with self.subTest(expected=expected), self.assertRaises(NormalizerError):
                normalizer_wrapper(NORMALIZER_SOURCE, expected)
        with self.assertRaisesRegex(NormalizerError, "source_mismatch"):
            normalizer_wrapper(NORMALIZER_SOURCE + NORMALIZER_PRIVATE, normalizer_digest(NORMALIZER_SOURCE))

    def test_non_pure_prefixes_cannot_smuggle_globals_callbacks_members_or_control_flow(self):
        expressions = ["fetch('" + NORMALIZER_PRIVATE + "')", "file.name.constructor('network')()", "global.name",
                       "file.response.name", "decodeURIComponent(global.name)",
                       "file.name.replace(/x/,function(){fetch('" + NORMALIZER_PRIVATE + "')})",
                       "file.name.replace(/x/,()=>fetch('" + NORMALIZER_PRIVATE + "'))",
                       "file.name.replace(new RegExp(global.pattern,'g'),'x')",
                       "file.name.replace(new Function('return 1'),'x')", "file.name.replace(/x/,global.replacement)",
                       "file.name.toString()", "file.name.replaceAll('x','y')", "file['name']", "file.normalized"]
        for expression in expressions:
            source = "function(event,data){let file=data.files[0];let url;file.normalized=" + expression + ";if(kind){}}"
            with self.subTest(expression=expression), self.assertRaises(NormalizerError) as error:
                wrap_normalizer(source)
            self.assertNotIn(NORMALIZER_PRIVATE, str(error.exception))

    def test_only_one_safe_derived_filename_field_can_be_assigned(self):
        for field in ("name", "__proto__", "constructor", "prototype", "callee", "arguments"):
            source = "function(e,d){let f=d.files[0];let u;f." + field + "=f.name;if(a){}}"
            with self.subTest(field=field), self.assertRaisesRegex(NormalizerError, "target_forbidden"):
                wrap_normalizer(source)
        for inserted in ("file.other=file.name;", "url=file.name;", "do{file.normalized=file.name;}while(x);",
                         "try{file.normalized=file.name;}catch(x){}", "file.normalized+=file.name;"):
            source = NORMALIZER_SOURCE.replace("if(kind)", inserted + "if(kind)")
            with self.subTest(inserted=inserted), self.assertRaises(NormalizerError):
                wrap_normalizer(source)

    def test_unsupported_and_excessive_literal_syntax_fails_with_fixed_reasons(self):
        for expression in (r"file.name.replace(/x/gg,'y')", r"file.name.replace(/x/v,'y')",
                           r"file.name.replace(new RegExp('x','gg'),'y')", "`" + NORMALIZER_PRIVATE + "`", r"file.name.replace('\8','x')"):
            source = "function(event,data){let file=data.files[0];let url;file.normalized=" + expression + ";if(kind){}}"
            with self.subTest(expression=expression), self.assertRaises(NormalizerError) as error:
                wrap_normalizer(source)
            self.assertNotIn(NORMALIZER_PRIVATE, str(error.exception))
        expression = "file.name" + ".replace('x','y')" * 65
        source = "function(event,data){let file=data.files[0];let url;file.normalized=" + expression + ";if(kind){}}"
        with self.assertRaisesRegex(NormalizerError, "expression_limit"):
            wrap_normalizer(source)



if __name__ == "__main__":
    unittest.main()
