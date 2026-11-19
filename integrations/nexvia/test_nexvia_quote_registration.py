import copy
import hashlib
import json
from types import SimpleNamespace
from pathlib import Path
from urllib.parse import urlencode
import unittest
from unittest.mock import patch

import nexvia_quote_registration as registration

PREFIX = "/fixture/native-file/"
SEND_SOURCE = r"""function(e,data){let item=data.files[0];let endpoint;
item.normalized=decodeURIComponent(item.name.replace(/\+/g,'%20')).replace(new RegExp(' ', 'g'),'_').replace(/[%]/g,'_');
item.normalized=item.normalized.replace(' - ','_');item.normalized=item.normalized.replace(/\s+/g,'_');
if(controller==='opaque-1'||controller==='opaque-2'||controller==='opaque-3'||controller==='opaque-4'||controller==='opaque-5'||controller==='opaque-6'||controller==='opaque-7'||controller==='opaque-8'||controller==='opaque-9'){endpoint='/fixture/policy/';}else{endpoint='/'+controller+'/fixture/policy/';}
if(!item.cache){$.ajax({url:endpoint,type:'GET',async:false,data:{file_name:item.name,file_size:item.size,file_type:item.type},success:function(response){item.cache=response;}});}
let form=new FormData();form.append('key',item.cache.key);form.append('policy',item.cache.policy);
form.append('x-goog-algorithm',item.cache['x-goog-algorithm']);form.append('x-goog-credential',item.cache['x-goog-credential']);
form.append('x-goog-date',item.cache['x-goog-date']);form.append('x-goog-signature',item.cache['x-goog-signature']);}"""
# Synthetic valid source follows the complete independently captured anonymous
# program. It contains no private/native source or endpoints.
DONE_SOURCE = (Path(__file__).parent/'fixtures'/'nexvia-done-generated-synthetic.js').read_text()



def fixture_contract():
    contract = {'version':2,'origin':registration.ORIGIN,'doneSourceSha256':hashlib.sha256(DONE_SOURCE.encode()).hexdigest(),
                'doneProfileSha256':registration.generated_callback.SUPPORTED_DONE_PROFILE_SHA256,
                'sendSourceSha256':registration.SEND_SOURCE_SHA256,'prefixSha256':registration.PREFIX_SHA256,
                'rootPrefix':PREFIX,'selectedPathPrefix':'/staff'+PREFIX,'controller':'staff',
                'cacheProperty':'cache','queryKey':'location','nativeIdField':'id','metadataField':'path',
                'renderer':renderer_template()}
    contract['contractHash'] = registration.digest(contract)
    return contract


def renderer_template(suffix='?field=form[Files]'):
    prefix=registration.RENDERER_PREFIX
    return {'prefix':prefix,'suffix':suffix,
            'templateHash':registration.digest({'prefix':prefix,'suffix':suffix,'cacheProperty':'cache'})}


def renderer_source(expression=None):
    done = DONE_SOURCE
    if expression is not None:
        old = "data . files [ v21 ] . v38 = \"/staff/upload/details/\" + data . files [ v21 ] . cache . id + '?field=form[Files]' ;"
        assert old in done
        done = done.replace(old,expression)
    return 'var nativeSend='+SEND_SOURCE+';var nativeDone='+done+';'


def fixture_policy():
    root = {'id':419,'path':'opaque/backend/object path.pdf','key':'uploads/key.pdf',
            'policy':'PRIVATE-SIGNED-POLICY','x-goog-algorithm':'GOOG4-RSA-SHA256',
            'x-goog-credential':'PRIVATE-CREDENTIAL','x-goog-date':'20260101T000000Z','x-goog-signature':'PRIVATE-SIGNATURE'}
    candidates = [{'pdf':True,'fields':{key:root[key] for key in registration.SIGNED_FIELDS}}]
    return root,candidates


class SourceTests(unittest.TestCase):
    def setUp(self):
        for key,value in {'SEND_SOURCE_SHA256':hashlib.sha256(SEND_SOURCE.encode()).hexdigest(),
                          'PREFIX_SHA256':hashlib.sha256(PREFIX.encode()).hexdigest()}.items():
            mock=patch.object(registration,key,value);mock.start();self.addCleanup(mock.stop)

    def test_source_proves_primary_done_metadata_and_direct_policy_root(self):
        contract=registration._source_contract(DONE_SOURCE,SEND_SOURCE)
        self.assertEqual(contract['rootPrefix'],PREFIX)
        self.assertEqual(contract['cacheProperty'],'cache')
        self.assertEqual(contract['queryKey'],'location')
        self.assertEqual(contract['controllerVariable'],'controller')

    def test_full_contract_accepts_the_existing_three_regex_normalizer_fixture(self):
        # Reuse the filename-normalizer shape already covered by upload tests.
        # The former registration-only fixture omitted this native SEND prefix.
        from test_nexvia_quote_attachment import SEND_SOURCE as upload_send
        upload_prefix = upload_send.split('if(kind)', 1)[0].split('file.normalized=', 1)[1]
        normalizer = 'item.normalized=' + upload_prefix.replace('file.', 'item.')
        self.assertIn(normalizer, SEND_SOURCE)
        tokens = registration._tokens(SEND_SOURCE, pinned_send=True)
        self.assertEqual([value for kind, value in tokens if kind == 'regex'], ['', '', ''])
        parsed = registration._source_contract(DONE_SOURCE, SEND_SOURCE)
        self.assertEqual(parsed['cacheProperty'], 'cache')
        self.assertEqual(parsed['queryKey'], 'location')
        self.assertEqual(parsed['rootPrefix'], PREFIX)

    def test_opaque_regex_permission_requires_the_exact_pinned_send_bytes(self):
        for source in (SEND_SOURCE + ' ', SEND_SOURCE.replace('/[%]/g', '/[other]/g'), '', None):
            with self.subTest(source=type(source).__name__), self.assertRaisesRegex(
                    registration.RegistrationError, 'registration_send_source_changed'):
                registration._tokens(source, pinned_send=True)
        with self.assertRaisesRegex(registration.RegistrationError, 'registration_send_source_changed'):
            registration._source_contract(DONE_SOURCE, SEND_SOURCE + ' ')

    def test_default_and_done_tokenization_still_reject_regexes(self):
        with self.assertRaisesRegex(registration.RegistrationError, 'registration_source_regex'):
            registration._tokens(SEND_SOURCE)
        done = DONE_SOURCE.replace('{', '{let unobserved=/hidden/;', 1)
        with self.assertRaisesRegex(registration.RegistrationError, 'registration_done_profile_changed'):
            registration._source_contract(done, SEND_SOURCE)
        # DONE must also remain strict independently of the syntax fingerprint.
        with patch.object(registration.generated_callback, 'profile', return_value={
                'doneProfileSha256': registration.generated_callback.SUPPORTED_DONE_PROFILE_SHA256,
                'doneSourceSha256': hashlib.sha256(done.encode()).hexdigest()}):
            with self.assertRaisesRegex(registration.RegistrationError, 'registration_source_regex'):
                registration._source_contract(done, SEND_SOURCE)

    def test_unterminated_regex_is_refused_even_in_a_pinned_send_fixture(self):
        source = 'function(e,data){let matcher=/unterminated;}'
        with patch.object(registration, 'SEND_SOURCE_SHA256', hashlib.sha256(source.encode()).hexdigest()):
            with self.assertRaisesRegex(registration.RegistrationError, 'registration_source_regex'):
                registration._tokens(source, pinned_send=True)

    def test_generated_literals_and_layout_keep_profile_but_bind_fresh_raw_hash(self):
        changed = DONE_SOURCE.replace('opaque-100','generated-uuid-123')+' '
        a = registration._source_contract(DONE_SOURCE,SEND_SOURCE)
        b = registration._source_contract(changed,SEND_SOURCE)
        self.assertEqual(a['doneProfileSha256'],b['doneProfileSha256'])
        self.assertNotEqual(a['doneSourceSha256'],b['doneSourceSha256'])

    def test_critical_raw_literals_are_checked_even_when_profile_is_unchanged(self):
        for old,new in (("dataType : 'json'","dataType : 'script'"),
                        ("'/fixture/native-file/'","'/fixture/other-file/'"),
                        ("'location'","'another'")):
            done=DONE_SOURCE.replace(old,new)
            self.assertEqual(registration.generated_callback.profile(done)['doneProfileSha256'],
                             registration.generated_callback.SUPPORTED_DONE_PROFILE_SHA256)
            with self.subTest(changed=new),self.assertRaises(registration.RegistrationError):
                registration._source_contract(done,SEND_SOURCE)

    def test_masked_transport_names_and_controller_literals_are_refused(self):
        for old,new in (("v19 . v20 ( file . url )","transport . send ( file . url )"),
                        ("v19 . v20 ( file . url )","transport . sendAsBinary ( file . url )"),
                        ("v19 . v20 ( file . url )","transport . load ( file . url )"),
                        ('"opaque-1"','"staff"')):
            done=DONE_SOURCE.replace(old,new)
            self.assertNotEqual(done,DONE_SOURCE)
            self.assertEqual(registration.generated_callback.profile(done)['doneProfileSha256'],
                             registration.generated_callback.SUPPORTED_DONE_PROFILE_SHA256)
            with self.subTest(changed=new),self.assertRaises(registration.RegistrationError):
                registration._source_contract(done,SEND_SOURCE)

    def test_added_network_or_critical_writes_are_rejected(self):
        marker='$ . ajax ('
        for insertion in ("fetch('/side-effect');", "$.ajax({url:'/extra',type:'GET'});",
                          "v4='/fixture/other/';", "file.cache.path='different';",
                          "file.cache.id=999;", "controller='admin';"):
            done=DONE_SOURCE.replace(marker,insertion+marker)
            with self.subTest(insertion=insertion),self.assertRaises(registration.RegistrationError):
                registration._source_contract(done,SEND_SOURCE)
        # Exercise raw provenance independently of the syntax fingerprint so a
        # future supported profile cannot accidentally bypass these checks.
        for insertion in ("v4='/fixture/other/';", "file.cache.path='different';", "controller='admin';"):
            done=DONE_SOURCE.replace(marker,insertion+marker)
            with patch.object(registration.generated_callback,'profile',return_value={
                    'doneProfileSha256':registration.generated_callback.SUPPORTED_DONE_PROFILE_SHA256,
                    'doneSourceSha256':hashlib.sha256(done.encode()).hexdigest()}):
                with self.subTest(raw=insertion),self.assertRaisesRegex(registration.RegistrationError,'registration_source_provenance'):
                    registration._source_contract(done,SEND_SOURCE)

    def test_private_binding_matches_only_exact_native_id_and_location_with_optional_cachebuster(self):
        root,candidates=fixture_policy()
        original=copy.deepcopy(root)
        binding=registration.binding_from_policy(root,fixture_contract(),candidates)
        base=binding['registrationURL']
        url=base+'?'+urlencode({'location':root['path']})
        self.assertTrue(registration.matches_request(url,'GET',binding))
        self.assertTrue(registration.matches_request(url+'&_=123456','GET',binding))
        self.assertEqual(root,original)
        self.assertEqual(binding['nativeFileId'],419)
        self.assertEqual(binding['exactLocation'],root['path'])
        for changed,method in ((url,'POST'),(url.replace('/419?','/420?'),'GET'),(url+'&extra=1','GET'),
                               (url+'&_=wrong','GET'),(url+'&location='+root['path'],'GET'),
                               (base+'?'+urlencode({'location':'different'}),'GET'),(url.replace('https:','http:'),'GET'),
                               (url.replace('lennox.nexvia.com.au','other.invalid'),'GET'),(url+'#fragment','GET')):
            with self.subTest(url=changed,method=method):self.assertFalse(registration.matches_request(changed,method,binding))
        public=json.dumps(registration.public_binding(binding))
        for private in ('PRIVATE-',root['path'],root['key']):self.assertNotIn(private,public)

    def test_binding_requires_positive_id_exact_signed_root_and_preserved_contract(self):
        root,candidates=fixture_policy()
        for native in (None,False,0,-1,'0','01','419/other',9007199254740992):
            changed={**root,'id':native}
            with self.subTest(native=native),self.assertRaises(registration.RegistrationError):registration.binding_from_policy(changed,fixture_contract(),candidates)
        for changed in ({**root,'path':'bad\nvalue'},{**root,'key':'another'},{**root,'x-goog-signature':'another'}):
            with self.assertRaises(registration.RegistrationError):registration.binding_from_policy(changed,fixture_contract(),candidates)
        for field,value in (('version',1),('doneSourceSha256','invalid'),('doneProfileSha256','0'*64)):
            bad=fixture_contract();bad[field]=value
            bad['contractHash']=registration.digest({key:v for key,v in bad.items() if key!='contractHash'})
            with self.subTest(field=field),self.assertRaisesRegex(registration.RegistrationError,'registration_contract_invalid'):
                registration.binding_from_policy(root,bad,candidates)
        bad=fixture_contract();bad['selectedPathPrefix']='/wrong/'
        with self.assertRaisesRegex(registration.RegistrationError,'registration_contract_invalid'):registration.binding_from_policy(root,bad,candidates)


class Session:
    def __init__(self):self.detached=False;self.calls=[]
    def send(self,method,options):
        self.calls.append((method,options))
        if method=='Runtime.evaluate':return {'result':{'objectId':'meta'}}
        if method=='Runtime.releaseObjectGroup':return {}
        key=options['objectId']
        if key=='meta':return {'result':[{'name':'source','value':{'type':'string','value':DONE_SOURCE}},{'name':'callback','value':{'type':'function','objectId':'fn'}}]}
        if key=='fn':return {'result':[],'internalProperties':[{'name':'[[Scopes]]','value':{'objectId':'scopes'}}]}
        if key=='scopes':return {'result':[{'name':'0','value':{'objectId':'near','description':'Closure'}},{'name':'1','value':{'objectId':'global','description':'Global'}}]}
        if key=='near':return {'result':[{'name':'controller','value':{'type':'string','value':'staff'}}]}
        raise AssertionError('Forbidden scope read')
    def detach(self):self.detached=True


class PassiveTests(unittest.TestCase):
    def setUp(self): SourceTests.setUp(self)

    def test_read_contract_uses_passive_controller_scope_without_invoking_callback(self):
        session=Session();page=SimpleNamespace(context=SimpleNamespace(new_cdp_session=lambda _:session))
        page.evaluate=lambda source,args:[renderer_source()]
        contract=registration.read_contract(page,DONE_SOURCE,SEND_SOURCE)
        self.assertEqual(contract,fixture_contract())
        self.assertTrue(session.detached)
        self.assertEqual(session.calls[-1][0],'Runtime.releaseObjectGroup')
        self.assertFalse(any(options.get('objectId')=='global' for _,options in session.calls))


class RendererTests(unittest.TestCase):
    def test_renderer_source_binds_actual_done_file_loop(self):
        result=registration._renderer_contract([renderer_source()],DONE_SOURCE,SEND_SOURCE,'cache')
        self.assertEqual(result,renderer_template())
        direct="file.htmlURL='/staff/upload/details/'+file.cache.id+'?name=form%5BFiles%5D%5B%5D';"
        source=renderer_source(direct)
        done=source.split('var nativeDone=',1)[1][:-1]
        self.assertEqual(registration._renderer_contract([source],done,SEND_SOURCE,'cache'),
                         renderer_template('?name=form%5BFiles%5D%5B%5D'))

    def test_unrelated_inline_or_wrong_loop_or_action_renderer_is_rejected(self):
        variants=[
            "data.files[j].htmlURL='/staff/upload/details/'+data.files[v21].cache.id+'?field=form[Files]';",
            "data.files[v21].htmlURL='/staff/upload/details/'+data.files[v21].other.id+'?field=form[Files]';",
            "globalURL='/staff/upload/details/'+data.files[v21].cache.id+'?field=form[Files]';",
            "data.files[v21].htmlURL='/staff/upload/details/'+data.files[v21].cache.id+'?delete=form[Files]';",
            "data.files[v21].htmlURL='/staff/upload/details/'+data.files[v21].cache.id+'?field=anotherForm';",
            "data.files[v21].htmlURL='/staff/upload/details/'+data.files[v21].cache.id+'?field=form[Files]&field=form[Files]';",
        ]
        for expression in variants:
            source=renderer_source(expression);done=source.split('var nativeDone=',1)[1][:-1]
            with self.subTest(expression=expression),self.assertRaises(registration.RegistrationError):
                registration._renderer_contract([source],done,SEND_SOURCE,'cache')
        empty_done=renderer_source(';').split('var nativeDone=',1)[1][:-1]
        unrelated=';file.htmlURL=\"/staff/upload/details/\"+file.cache.id+\"?field=form[Files]\";'
        with self.assertRaises(registration.RegistrationError):
            registration._renderer_contract([SEND_SOURCE+empty_done+unrelated],empty_done,SEND_SOURCE,'cache')
        for sources in ([],["unrelated"]):
            with self.assertRaises(registration.RegistrationError):
                registration._renderer_contract(sources,DONE_SOURCE,SEND_SOURCE,'cache')

    def test_renderer_request_accepts_only_the_bound_id_query_and_numeric_cachebuster(self):
        root,candidates=fixture_policy()
        with patch.object(registration,'PREFIX_SHA256',hashlib.sha256(PREFIX.encode()).hexdigest()):
            binding=registration.binding_from_policy(root,fixture_contract(),candidates)
        target=binding['rendererURL']
        self.assertTrue(registration.matches_renderer_request(target,'GET',binding))
        self.assertTrue(registration.matches_renderer_request(target+'&_=123','GET',binding))
        for url,method in ((target,'POST'),(target.replace('/419?','/420?'),'GET'),(target+'&action=delete','GET'),
                           (target+'&_=NaN','GET'),(target+'&field=form[Files]','GET'),
                           (target.replace('form[Files]','other'),'GET'),(target+'#fragment','GET'),
                           (target.replace('https:','http:'),'GET')):
            with self.subTest(url=url,method=method):self.assertFalse(registration.matches_renderer_request(url,method,binding))


if __name__=='__main__':unittest.main()
