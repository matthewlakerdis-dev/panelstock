"""Inspect the frozen V6 renderer query without invoking uploader actions."""
import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import types
from urllib.request import Request, urlopen
import uuid

RELEASE_URL = 'https://raw.githubusercontent.com/matthewlakerdis-dev/panelstock/0c17a40feea89b77d659856fa0f9e59d41f88ebe/integrations/nexvia/releases/install_nexvia_quote_registration_update_v6.py'
RELEASE_SHA256 = '6bbdf43b317a42518da908af2d54b10784b8cf202c3d4a7299792ac1ecd3aeb7'
RELEASE_BYTES = 354262
MAX_OUTPUT_BYTES = 16384

# This same pure projection runs in the isolated child and its local tests.
# No unknown query names or values are returned to the parent process.
PROBE_CODE = r'''
import hashlib
import json
import re
from urllib.parse import urlsplit, parse_qsl

KNOWN_KEYS = frozenset({'field','name','field_name','file_field_name','input','input_name','file_input','field_id',
    'form','form_field','form_name','form_id','type','mode','render','view','html','multiple','readonly','read_only',
    'editable','editable_fields','preview','display','inline','download','downloadable','allowDownload','allow_download',
    'delete','deletable','allowDelete','allow_delete','remove','removable','allowRemove','allow_remove',
    'button','buttons','controls','attachment','controller','_'})
CANONICAL_KEYS = {key.casefold():key for key in KNOWN_KEYS}
VALUE_KINDS = frozenset({'formFiles','formFilesArray','empty','zero','one','true','false','integer','other'})
CLAUSES = frozenset({'shape','url','parse','bindings','entry','none'})
CHECK_KEYS = frozenset({'string','lengthBound','ascii','startsQuestion','noControls','noMalformedPercent','urlParsed',
    'pathEmpty','fragmentEmpty','runtimeParsed','diagnosticParsed','runtimePairBound','uniqueKeys','hasFilesBinding',
    'entriesValid','htmlEntitySeparator','pairsTruncated'})
PARAMETER_KEYS = frozenset({'index','key','keySha256','keyLength','keySafeASCII','keyActionWord','keySensitive',
    'keyIsCachebuster','valueKind','valueSha256','valueLength','valueSafeASCIIIdentifier','valueJSONKind','entryValid'})
JSON_KINDS = frozenset({'object','array','string','number','boolean','null','invalid'})
ACTION_RE = r'delete|remove|send|email|approve|save|print|action|operation|method|callback'
SENSITIVE_RE = r'token|signature|credential|password|auth|key|session|csrf|security|policy|url|link|path|redirect|email|user'

def renderer_query_summary(suffix):
    string = type(suffix) is str
    text = suffix if string else ''
    flags = {key:False for key in CHECK_KEYS}
    flags.update(string=string, lengthBound=string and 0<len(text)<=1000,
        ascii=string and text.isascii(), startsQuestion=string and text.startswith('?'),
        noControls=string and re.search(r'[\x00-\x20\x7f\\]',text) is None,
        noMalformedPercent=string and re.search(r'%(?![a-fA-F0-9]{2})',text) is None,
        htmlEntitySeparator=string and '&amp;' in text)
    parsed=None
    if string:
        try:parsed=urlsplit(text)
        except ValueError:pass
    flags.update(urlParsed=parsed is not None, pathEmpty=parsed is not None and not parsed.path,
                 fragmentEmpty=parsed is not None and not parsed.fragment)
    pairs=[]
    if parsed is not None:
        try:
            parse_qsl(parsed.query,keep_blank_values=True,strict_parsing=True,max_num_fields=4,errors='strict')
            flags['runtimeParsed']=True
        except (ValueError,UnicodeError):pass
        try:
            pairs=parse_qsl(parsed.query,keep_blank_values=True,strict_parsing=True,max_num_fields=16,errors='strict')
            flags['diagnosticParsed']=True
        except (ValueError,UnicodeError):
            flags['pairsTruncated']=parsed.query.count('&')>=16
    flags.update(runtimePairBound=0<len(pairs)<=4, uniqueKeys=len(pairs)==len(dict(pairs)),
                 hasFilesBinding=any(value in {'form[Files]','form[Files][]'} for _,value in pairs))
    parameters=[]
    for index,(key,value) in enumerate(pairs):
        key_safe=re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]{0,79}',key) is not None
        action=re.search(ACTION_RE,key,re.I) is not None
        sensitive=re.search(SENSITIVE_RE,key,re.I) is not None
        cache=key=='_'
        valid=key_safe and not action and (re.fullmatch(r'[0-9]{1,20}',value) is not None if cache
                                          else value in {'form[Files]','form[Files][]'})
        kind={'form[Files]':'formFiles','form[Files][]':'formFilesArray','':'empty',
              '0':'zero','1':'one','true':'true','false':'false'}.get(value)
        if kind is None:kind='integer' if re.fullmatch(r'[0-9]{1,20}',value) else 'other'
        json_kind='invalid'
        try:
            item=json.loads(value)
            json_kind=('null' if item is None else 'boolean' if type(item) is bool else 'number' if type(item) in {int,float}
                       else 'string' if type(item) is str else 'array' if type(item) is list else 'object')
        except (ValueError,TypeError,RecursionError):pass
        parameters.append({'index':index,'key':CANONICAL_KEYS.get(key.casefold(),'[other]'),
            'keySha256':hashlib.sha256(key.encode()).hexdigest(),'keyLength':min(262144,len(key)),
            'keySafeASCII':key_safe,'keyActionWord':action,'keySensitive':sensitive,'keyIsCachebuster':cache,
            'valueKind':kind,'valueSha256':hashlib.sha256(value.encode()).hexdigest(),'valueLength':min(262144,len(value)),
            'valueSafeASCIIIdentifier':re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]{0,79}',value) is not None,
            'valueJSONKind':json_kind,'entryValid':valid})
    flags['entriesValid']=bool(pairs) and all(row['entryValid'] for row in parameters)
    shape=all(flags[key] for key in ('string','lengthBound','ascii','startsQuestion','noControls','noMalformedPercent'))
    clause=('shape' if not shape else 'url' if not all(flags[key] for key in ('urlParsed','pathEmpty','fragmentEmpty'))
            else 'parse' if not flags['runtimeParsed'] else 'bindings' if not (pairs and flags['uniqueKeys'] and flags['hasFilesBinding'])
            else 'entry' if not flags['entriesValid'] else 'none')
    return {'suffixSha256':hashlib.sha256(text.encode()).hexdigest() if string else None,
            'suffixLength':min(262144,len(text)) if string else None,'firstFailure':clause,
            'checks':flags,'pairCount':len(pairs),'parameters':parameters,'original':'not_called'}

def install_renderer_probe(registration, checkpoint):
    original=registration._renderer_suffix
    def measured(suffix):
        checkpoint['rendererCalls']=min(100,checkpoint.get('rendererCalls',0)+1)
        first='rendererQuery' not in checkpoint
        if first:
            try:checkpoint['rendererQuery']=renderer_query_summary(suffix)
            except Exception:checkpoint['rendererQuery']=None
        try:result=original(suffix)
        except Exception:
            if first and checkpoint['rendererQuery'] is not None:checkpoint['rendererQuery']['original']='rejected'
            raise
        if first and checkpoint['rendererQuery'] is not None:checkpoint['rendererQuery']['original']='accepted'
        return result
    registration._renderer_suffix=measured
'''
_helpers = {}
exec(compile(PROBE_CODE, 'readonly_renderer_helpers.py', 'exec'), _helpers)
renderer_query_summary = _helpers['renderer_query_summary']
install_renderer_probe = _helpers['install_renderer_probe']
KNOWN_KEYS = _helpers['KNOWN_KEYS']
VALUE_KINDS = _helpers['VALUE_KINDS']
CLAUSES = _helpers['CLAUSES']
CHECK_KEYS = _helpers['CHECK_KEYS']
PARAMETER_KEYS = _helpers['PARAMETER_KEYS']
JSON_KINDS = _helpers['JSON_KINDS']


class InspectionError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InspectionError(message)


def release_namespace():
    try:
        raw=urlopen(Request(RELEASE_URL,headers={'User-Agent':'PanelStock-Nexvia-Bridge/1.0'}),timeout=30).read(1048577)
        require(len(raw)==RELEASE_BYTES and hashlib.sha256(raw).hexdigest()==RELEASE_SHA256,
                'Frozen quote updater verification failed; no inspection performed.')
        namespace={'__name__':'verified_readonly_renderer_release'}
        exec(compile(raw,'verified_readonly_renderer_release.py','exec'),namespace)
        return types.SimpleNamespace(**namespace)
    except InspectionError:
        raise
    except Exception:
        raise InspectionError('Frozen quote updater could not be read; no inspection performed.') from None


@contextmanager
def work_lock(root):
    folder=os.open(root/'panelstock-request-journal',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    descriptor=None
    try:
        descriptor=os.open('.bridge.lock',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=folder)
        info=os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600,
                'Existing Nexvia work lock is unsafe; no inspection performed.')
        try:fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            raise InspectionError('The bridge is handling work. Let it finish, then run this read-only check again.') from None
        yield descriptor
    finally:
        if descriptor is not None:os.close(descriptor)
        os.close(folder)


def diagnostic_preflight(source):
    replacements=(
        ('def blocked(*args, **kwargs):',PROBE_CODE+'\ndef blocked(*args, **kwargs):'),
        ("        quote = sys.modules['nexvia_quote_attachment']","        install_renderer_probe(sys.modules['nexvia_quote_registration'], checkpoint)\n        quote = sys.modules['nexvia_quote_attachment']"),
        ("    report.update(passed=checkpoint['passed'], stage=checkpoint['stage'])","    report['rendererDiagnostic'] = {'query':checkpoint.get('rendererQuery'),'calls':checkpoint.get('rendererCalls',0)}\n    report.update(passed=checkpoint['passed'], stage=checkpoint['stage'])"),
    )
    for marker,replacement in replacements:
        require(source.count(marker)==1,'Frozen inspection markers changed; no inspection performed.')
        source=source.replace(marker,replacement)
    compile(source,'readonly_renderer_preflight.py','exec')
    return source


def project_result(value, expected, failure_codes):
    require(type(value) is dict and set(value)<=set(expected)|{'passed','stage','reason','rendererDiagnostic'}
            and all(value.get(key)==item for key,item in expected.items()) and type(value.get('passed')) is bool
            and value.get('stage') in {'open_draft','native_guard','source_normalizer','upload_fields','registration_source','registration_binding','verified'},
            'Read-only renderer inspection returned an invalid result.')
    reason=value.get('reason')
    require(reason is None or type(reason) is str and reason in failure_codes,'Renderer reason code is invalid.')
    detail=value.get('rendererDiagnostic')
    require(type(detail) is dict and set(detail)=={'query','calls'} and type(detail['calls']) is int and 0<=detail['calls']<=100,
            'Read-only renderer metadata is invalid.')
    query=detail['query']
    def valid_hash(item):return type(item) is str and re.fullmatch(r'[a-f0-9]{64}',item) is not None
    if query is not None:
        require(type(query) is dict and set(query)=={'suffixSha256','suffixLength','firstFailure','checks','pairCount','parameters','original'}
                and len(json.dumps(query))<=12000,'Renderer query fields changed.')
        require((query['suffixSha256'] is None or valid_hash(query['suffixSha256']))
                and (query['suffixLength'] is None or type(query['suffixLength']) is int and 0<=query['suffixLength']<=262144)
                and type(query['firstFailure']) is str and query['firstFailure'] in CLAUSES
                and type(query['original']) is str and query['original'] in {'accepted','rejected'},'Renderer query summary is invalid.')
        checks=query['checks']
        require(type(checks) is dict and set(checks)==CHECK_KEYS and all(type(flag) is bool for flag in checks.values()),
                'Renderer query checks changed.')
        rows=query['parameters']
        require(type(query['pairCount']) is int and type(rows) is list and 0<=query['pairCount']==len(rows)<=16,
                'Renderer parameter count exceeded its bound.')
        for index,row in enumerate(rows):
            require(type(row) is dict and set(row)==PARAMETER_KEYS and type(row['index']) is int and row['index']==index,
                    'Renderer parameter fields changed.')
            require(type(row['key']) is str and row['key'] in KNOWN_KEYS|{'[other]'}
                    and valid_hash(row['keySha256']) and valid_hash(row['valueSha256'])
                    and type(row['valueKind']) is str and row['valueKind'] in VALUE_KINDS
                    and type(row['valueJSONKind']) is str and row['valueJSONKind'] in JSON_KINDS,'Renderer parameter classifications changed.')
            require(all(type(row[key]) is int and 0<=row[key]<=262144 for key in ('keyLength','valueLength'))
                    and all(type(row[key]) is bool for key in ('keySafeASCII','keyActionWord','keySensitive','keyIsCachebuster','valueSafeASCIIIdentifier','entryValid')),
                    'Renderer parameter flags changed.')
    return {'stage':value['stage'],'reason':reason,'passed':value['passed'],'query':query,'calls':detail['calls'],
            'readOnly':True,'compatibilityApproved':False}


def inspect(root, identifier, release):
    root=Path(root)
    try:
        require(str(uuid.UUID(identifier))==identifier,'Use the exact saved request UUID.')
        files=release.decoded_payload()
        with work_lock(root) as descriptor:
            originals=release.snapshot(root)
            require(all(originals[name] is not None and hashlib.sha256(originals[name][0]).hexdigest()==checksum
                        for name,checksum in release.PRIOR_SHA256.items())
                    and all(originals[name] is None for name in release.NEW_FILES),
                    'Installed business modules differ from the saved failure; no inspection performed.')
            release.check_parser(root)
            config=release.read_config(root/'panelstock-requests.json')[0]
            evidence=release.observed_registration_evidence(root,identifier)
            before=release.protected_state(root)
            try:
                request_raw=release.private_read(root/'nexvia-requests'/identifier/'request.json',8388608,'Saved request is unavailable.')
                expected={'format':'nexvia-native-policy-compatibility','version':1,'requestId':identifier,
                          'requestFileSha256':hashlib.sha256(request_raw).hexdigest(),
                          'sourceSha256':{name[:-3]:hashlib.sha256(raw).hexdigest() for name,raw in files.items()},
                          'readOnly':True,'fileSelected':False,'policyRequested':False,'fileUploaded':False,'poCreated':False,'poChanged':False,'emailSent':False}
                payload={'requestId':identifier,'requestFileSha256':expected['requestFileSha256'],
                         'sources':{name[:-3]:base64.b64encode(raw).decode() for name,raw in files.items()}}
                environment=dict(os.environ)
                for name in ('DEBUG','PWDEBUG','DEBUG_FILE'):environment.pop(name,None)
                result=subprocess.run([str(root/'nexvia-tools/bin/python'),'-I','-B','-c',diagnostic_preflight(release.NATIVE_PREFLIGHT),str(root),str(descriptor)],
                    input=json.dumps(payload,separators=(',',':')).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                    pass_fds=(descriptor,),timeout=120,check=False,env=environment)
                require(result.returncode==0 and len(result.stdout)<=MAX_OUTPUT_BYTES,
                        'Read-only renderer inspection stopped; no uploader action was invoked.')
                return project_result(json.loads(result.stdout),expected,release.registration_failure_codes(files['nexvia_quote_registration.py']))
            finally:
                require(release.snapshot(root)==originals and release.read_config(root/'panelstock-requests.json')[0]==config
                        and release.observed_registration_evidence(root,identifier)==evidence and release.protected_state(root)==before,
                        'Original module or request evidence changed during inspection; stop and report this message.')
    except InspectionError:
        raise
    except Exception:
        raise InspectionError('Read-only renderer inspection stopped safely; no uploader action or installation was invoked.') from None


def main(argv=None):
    class FixedParser(argparse.ArgumentParser):
        def error(self,message):raise InspectionError('Use --request with the exact saved request UUID.')
    parser=FixedParser(description=__doc__)
    parser.add_argument('--request',required=True)
    args=parser.parse_args(argv)
    sys.dont_write_bytecode=True
    result=inspect(Path('/config'),args.request,release_namespace())
    query=result['query']
    checks={'stage':result['stage'],'reason':result['reason'],'calls':result['calls'],'query':
            {key:query[key] for key in ('suffixSha256','suffixLength','firstFailure','checks','pairCount','original')} if query else None}
    print('Renderer query checks:',json.dumps(checks,separators=(',',':')))
    print('Renderer parameters:',json.dumps(query['parameters'] if query else None,separators=(',',':')))
    print('Read-only check only. Nothing installed; no file selected/uploaded, registration, PO, email or request retry.')
    return 0


if __name__=='__main__':
    try:raise SystemExit(main())
    except InspectionError as error:raise SystemExit(str(error)) from None
