import ast
from contextlib import contextmanager,redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('contract_harness',ROOT/'releases/check_nexvia_uploader_contract_v1.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
class TestContractHarness(unittest.TestCase):
 def setUp(self):
  self.release=(ROOT/'releases/install_nexvia_quote_registration_update_v3.py').read_bytes()
  self.http=patch.object(h,'urlopen',return_value=SimpleNamespace(read=lambda maximum:self.release[:maximum]))
  self.urlopen=self.http.start();self.addCleanup(self.http.stop)
  self.ns=h.load_release()
  q=SimpleNamespace(POLICY_FIELDS={'acl','key'},REGISTRATION_DONE_SHA256=hashlib.sha256(b'done PRIVATE_SOURCE').hexdigest(),POLICY_SEND_SHA256=hashlib.sha256(b'send PRIVATE_SOURCE').hexdigest())
  self.q=q
  scope={'hashlib':hashlib};exec(h.FACTS_SOURCE,scope);self.facts=scope['uploader_checks']
  self.state={'widgets':[{'index':0,'method':'POST','autoUpload':True,'disabled':False,'chunkSize':0,'doneSource':'done PRIVATE_SOURCE','sendSource':'send PRIVATE_SOURCE'}],'policyNames':['acl','key'],'binding':True}
 def test_all_flags_true(self):
  facts=self.facts(self.state,self.q)
  self.assertTrue(all(facts[k] for k in h.CHECK_KEYS))
  self.assertEqual(h.safe_projection(facts),facts)
 def test_each_uploader_condition_is_independently_visible(self):
  cases=[('index',1,'firstInput'),('method','GET','postMethod'),('autoUpload',False,'autoUpload'),('disabled',True,'enabled'),('chunkSize',1,'noChunks'),('doneSource','different','doneMatches'),('sendSource','different','sendMatches')]
  for field,value,key in cases:
   state=json.loads(json.dumps(self.state));state['widgets'][0][field]=value
   with self.subTest(field=field):self.assertFalse(self.facts(state,self.q)[key])
  state=dict(self.state,policyNames=['acl']);self.assertFalse(self.facts(state,self.q)['policyFields'])
  self.assertFalse(self.facts(dict(self.state,binding=False),self.q)['fileBinding'])
  self.assertFalse(self.facts(dict(self.state,widgets=[]),self.q)['singleWidget'])
  self.assertFalse(self.facts(dict(self.state,widgets=[None]),self.q)['widgetObject'])
  self.assertFalse(self.facts(dict(self.state,widgets=None),self.q)['widgetList'])
 def test_missing_done_is_visible_and_no_private_source_or_url_printed(self):
  self.state['widgets'][0].update(doneSource=None,url='https://PRIVATE_TOKEN.example/')
  facts=self.facts(self.state,self.q)
  self.assertFalse(facts['donePresent']);self.assertFalse(facts['doneMatches']);self.assertIsNone(facts['doneSha256'])
  text=json.dumps(h.safe_projection(facts));self.assertNotIn('PRIVATE_SOURCE',text);self.assertNotIn('PRIVATE_TOKEN',text)
 def test_projection_rejects_unknown_details_and_non_boolean_or_hash_values(self):
  facts=self.facts(self.state,self.q)
  for changed in (dict(facts,private='SECRET'),dict(facts,donePresent='PRIVATE_TOKEN'),dict(facts,doneSha256='PRIVATE_TOKEN')):
   with self.assertRaises(ValueError):h.safe_projection(changed)
 def test_child_reports_checks_before_guard_failure_without_uploading(self):
  with patch.object(self.ns['subprocess'],'run'):
   h.prepare(self.ns)
  child={'__name__':'source_test'};exec(self.ns['NATIVE_PREFLIGHT'],child)
  class QuoteError(ValueError):pass
  q=SimpleNamespace(**vars(self.q))
  for name in ('upload_quote','begin_upload','complete_upload','source_upload_payload','begin_upload_context','validate_upload_context','accept_storage_upload'):
   setattr(q,name,lambda *a,**k: self.fail('mutation function called'))
  q.NATIVE_STATE_JS='trusted reader'
  def validate(*a,**k):raise QuoteError('Native quote uploader contract changed.')
  q.validate_native_draft=validate
  @contextmanager
  def editor(*a,**k):yield {'page':SimpleNamespace(evaluate=lambda *a:self.state),'createPath':'/safe-draft'}
  creator=SimpleNamespace(quote_attachment_descriptor=lambda *a:{'filename':'PRIVATE.pdf','bytes':12},native_line_editor=editor,prepare=lambda:None,submit=lambda:None,save=lambda:None)
  checkpoint={'passed':False,'denied':False}
  with self.assertRaises(QuoteError):child['inspect_native'](None,{'quote':{}},creator,q,checkpoint)
  self.assertEqual(checkpoint['stage'],'native_guard')
  self.assertEqual(checkpoint['uploaderChecks'],self.facts(self.state,self.q))
 def test_wrapper_strips_extra_fields_so_successful_report_remains_exact(self):
  facts=self.facts(self.state,self.q);expected={'passed':True,'stage':'verified'}
  def run(*a,**kw):return SimpleNamespace(returncode=0,stdout=json.dumps(dict(expected,uploaderChecks=facts)).encode())
  with patch.object(self.ns['subprocess'],'run',run):
   files,original=h.prepare(self.ns)
   with redirect_stdout(io.StringIO()) as out:
    result=self.ns['subprocess'].run(['python','-I','-B','-c',self.ns['NATIVE_PREFLIGHT'],'/config','5'])
   self.assertEqual(json.loads(result.stdout),expected)
   self.assertIn('Failed checks:',out.getvalue());self.assertNotIn('PRIVATE_',out.getvalue())
 def test_only_native_preflight_runs_under_lock_and_evidence_is_preserved(self):
  calls=[];held=False
  @contextmanager
  def lock(*a):
   nonlocal held
   held=True;calls.append('lock')
   try:yield 41
   finally:held=False;calls.append('unlock')
  def evidence(*a):calls.append('evidence');return {'same':True}
  def preflight(*a,**kw):
   self.assertTrue(held);self.assertEqual(kw['bridge_lock_fd'],41);calls.append('preflight');return True
  def forbidden(*a,**kw):self.fail('installer entrypoint invoked')
  self.ns.update(lock_file=lock,observed_registration_evidence=evidence,_native_policy_preflight=preflight,main=forbidden,install=forbidden)
  with patch.object(self.ns['subprocess'],'run'),redirect_stdout(io.StringIO()):h.diagnose(self.ns,Path('/synthetic'))
  self.assertEqual(calls,['lock','evidence','preflight','evidence','unlock'])
 def test_route_and_mutation_tripwire_functions_are_unchanged(self):
  before=self.ns['NATIVE_PREFLIGHT']
  with patch.object(self.ns['subprocess'],'run'):h.prepare(self.ns)
  old=ast.parse(before);new=ast.parse(self.ns['NATIVE_PREFLIGHT'])
  for name in ('blocked','completion_path','route_decision','guarded_route'):
   first=next(n for n in old.body if isinstance(n,ast.FunctionDef) and n.name==name)
   second=next(n for n in new.body if isinstance(n,ast.FunctionDef) and n.name==name)
   self.assertEqual(ast.dump(first),ast.dump(second))
 def test_loader_uses_only_pinned_https_release_with_size_bound(self):
  self.urlopen.reset_mock()
  ns=h.load_release()
  self.assertEqual(ns['decoded_payload'](),self.ns['decoded_payload']())
  args,kwargs=self.urlopen.call_args
  self.assertEqual(args[0].full_url,h.RELEASE_URL)
  self.assertEqual(kwargs,{'timeout':30})
  self.assertTrue(h.RELEASE_URL.startswith('https://raw.githubusercontent.com/'))
  sizes=[]
  self.urlopen.return_value=SimpleNamespace(read=lambda maximum:(sizes.append(maximum) or self.release))
  h.load_release()
  self.assertEqual(sizes,[h.MAX_RELEASE_BYTES+1])
 def test_loader_rejects_mismatched_or_oversized_release_without_exec(self):
  for data in (b'print("PRIVATE_UNVERIFIED_EXECUTION")',b'x'*(h.MAX_RELEASE_BYTES+1)):
   self.urlopen.return_value=SimpleNamespace(read=lambda maximum:data)
   with redirect_stdout(io.StringIO()) as out,self.assertRaisesRegex(SystemExit,'Verification failed'):
    h.load_release()
   self.assertEqual(out.getvalue(),'')
if __name__=='__main__':unittest.main()
