import copy
import hashlib
import json
from types import SimpleNamespace
from urllib.parse import urlencode
import unittest
from unittest.mock import patch

import nexvia_quote_registration as registration

PREFIX = "/fixture/native-file/"
SEND_SOURCE = """function(e,data){let item=data.files[0];let endpoint;
if(!item.cache){$.ajax({url:endpoint,type:'GET',async:false,data:{file_name:item.name,file_size:item.size,file_type:item.type},success:function(response){item.cache=response;}});}
let form=new FormData();form.append('key',item.cache.key);form.append('policy',item.cache.policy);
form.append('x-goog-algorithm',item.cache['x-goog-algorithm']);form.append('x-goog-credential',item.cache['x-goog-credential']);
form.append('x-goog-date',item.cache['x-goog-date']);form.append('x-goog-signature',item.cache['x-goog-signature']);}"""
DONE_SOURCE = """function(e,data){let file=data.files[0];if(data.response){let target;file.url=file.cache.path;
if(controller==='admin'||controller==='client'){target='/fixture/native-file/';}else{target='/'+controller+'/fixture/native-file/';}
$.ajax({url:target+file.cache.id,type:'GET',data:{location:file.cache.path},async:true});
function preview(data){$.ajax({url:'/preview/'+data.id,type:'GET',data:{url:data.path}});}}}"""


def fixture_contract():
    contract = {'version':1,'origin':registration.ORIGIN,'doneSourceSha256':registration.DONE_SOURCE_SHA256,
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


def renderer_source(expression="data.files[i].htmlURL='/staff/upload/details/'+data.files[i].cache.id+'?field=form[Files]';"):
    return 'var nativeSend='+SEND_SOURCE+';var nativeDone='+DONE_SOURCE+';'+expression


def fixture_policy():
    root = {'id':419,'path':'opaque/backend/object path.pdf','key':'uploads/key.pdf',
            'policy':'PRIVATE-SIGNED-POLICY','x-goog-algorithm':'GOOG4-RSA-SHA256',
            'x-goog-credential':'PRIVATE-CREDENTIAL','x-goog-date':'20260101T000000Z','x-goog-signature':'PRIVATE-SIGNATURE'}
    candidates = [{'pdf':True,'fields':{key:root[key] for key in registration.SIGNED_FIELDS}}]
    return root,candidates


class SourceTests(unittest.TestCase):
    def setUp(self):
        for key,value in {'DONE_SOURCE_SHA256':hashlib.sha256(DONE_SOURCE.encode()).hexdigest(),
                          'SEND_SOURCE_SHA256':hashlib.sha256(SEND_SOURCE.encode()).hexdigest(),
                          'PREFIX_SHA256':hashlib.sha256(PREFIX.encode()).hexdigest()}.items():
            mock=patch.object(registration,key,value);mock.start();self.addCleanup(mock.stop)

    def test_source_proves_primary_done_metadata_and_direct_policy_root(self):
        contract=registration._source_contract(DONE_SOURCE,SEND_SOURCE)
        self.assertEqual(contract['rootPrefix'],PREFIX)
        self.assertEqual(contract['cacheProperty'],'cache')
        self.assertEqual(contract['queryKey'],'location')
        self.assertEqual(contract['controllerVariable'],'controller')

    def test_source_change_or_wrong_root_or_ambiguous_outer_get_is_rejected(self):
        with self.assertRaisesRegex(registration.RegistrationError,'registration_done_source_changed'):
            registration._source_contract(DONE_SOURCE+' ',SEND_SOURCE)
        for done,send,code in ((DONE_SOURCE,SEND_SOURCE.replace('item.cache=response','item.cache=response.fields'),'registration_policy_root'),
                               (DONE_SOURCE.replace('data:{location:file.cache.path}','data:{location:file.other.path}'),SEND_SOURCE,'registration_query_source'),
                               (DONE_SOURCE.replace('function preview(data)',"$.ajax({url:target+file.cache.id,type:'GET',data:{location:file.cache.path}});function preview(data)"),SEND_SOURCE,'registration_primary_get')):
            with patch.object(registration,'DONE_SOURCE_SHA256',hashlib.sha256(done.encode()).hexdigest()),patch.object(registration,'SEND_SOURCE_SHA256',hashlib.sha256(send.encode()).hexdigest()):
                with self.subTest(code=code),self.assertRaisesRegex(registration.RegistrationError,code):registration._source_contract(done,send)

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
    def test_renderer_source_binds_the_same_file_and_static_form_field(self):
        result=registration._renderer_contract([renderer_source()],DONE_SOURCE,SEND_SOURCE,'cache')
        self.assertEqual(result,renderer_template())
        direct="file.htmlURL='/staff/upload/details/'+file.cache.id+'?name=form%5BFiles%5D%5B%5D';"
        self.assertEqual(registration._renderer_contract([renderer_source(direct)],DONE_SOURCE,SEND_SOURCE,'cache'),
                         renderer_template('?name=form%5BFiles%5D%5B%5D'))

    def test_missing_or_unrelated_or_action_renderer_sources_stop_before_registration(self):
        variants=[
            "// data.files[i].htmlURL='/staff/upload/details/'+data.files[i].cache.id+'?field=form[Files]';",
            "data.files[j].htmlURL='/staff/upload/details/'+data.files[i].cache.id+'?field=form[Files]';",
            "data.files[i].htmlURL='/staff/upload/details/'+data.files[i].other.id+'?field=form[Files]';",
            "globalURL='/staff/upload/details/'+data.files[i].cache.id+'?field=form[Files]';",
            "data.files[i].htmlURL='/staff/upload/details/'+data.files[i].cache.id+'?delete=form[Files]';",
            "data.files[i].htmlURL='/staff/upload/details/'+data.files[i].cache.id+'?field=anotherForm';",
            "data.files[i].htmlURL='/staff/upload/details/'+data.files[i].cache.id+'?field=form[Files]&field=form[Files]';",
        ]
        for expression in variants:
            with self.subTest(expression=expression),self.assertRaises(registration.RegistrationError):
                registration._renderer_contract([renderer_source(expression)],DONE_SOURCE,SEND_SOURCE,'cache')
        for sources in ([],["unrelated"],[renderer_source(),renderer_source("file.htmlURL='/staff/upload/details/'+file.cache.id+'?name=form[Files]';")]):
            with self.subTest(sources=sources),self.assertRaises(registration.RegistrationError):
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
