"""Read the exact v3 native uploader conditions; never install or retry."""
import hashlib
import json
import sys
from urllib.request import Request, urlopen
from pathlib import Path

EXPECTED = 'e210cba07777ffb9b812ea63d54fffe98595e5aa9014e831731ec57373f8cb4c'
REQUEST = '56d29505-f653-45fe-9dbd-f3bc9f5d4654'
RELEASE_URL = 'https://raw.githubusercontent.com/matthewlakerdis-dev/panelstock/2f248b0abbe9843c897d44ec443a07ba4d2bb7fa/integrations/nexvia/releases/install_nexvia_quote_registration_update_v3.py'
MAX_RELEASE_BYTES = 1048576

FACTS_SOURCE = '''def uploader_checks(state, quote):
    widgets = state.get('widgets') if isinstance(state, dict) else None
    single = isinstance(widgets, list) and len(widgets) == 1
    w = widgets[0] if single and isinstance(widgets[0], dict) else {}
    done, send = w.get('doneSource'), w.get('sendSource')
    dh = hashlib.sha256(done.encode()).hexdigest() if isinstance(done, str) and len(done)<=131072 else None
    sh = hashlib.sha256(send.encode()).hexdigest() if isinstance(send, str) and len(send)<=131072 else None
    return {'widgetList':isinstance(widgets,list),'singleWidget':single,'widgetObject':single and isinstance(widgets[0],dict),
        'firstInput':w.get('index')==0,'postMethod':w.get('method')=='POST','autoUpload':w.get('autoUpload') is True,
        'enabled':w.get('disabled') is False,'noChunks':w.get('chunkSize')==0,
        'policyFields':quote.POLICY_FIELDS<=set(state.get('policyNames',[])),'fileBinding':state.get('binding') is True,
        'donePresent':isinstance(done,str),'doneMatches':dh==quote.REGISTRATION_DONE_SHA256,
        'sendPresent':isinstance(send,str),'sendMatches':sh==quote.POLICY_SEND_SHA256,
        'doneSha256':dh,'expectedDoneSha256':quote.REGISTRATION_DONE_SHA256,'sendSha256':sh,'expectedSendSha256':quote.POLICY_SEND_SHA256}
'''
CHECK_KEYS = ('widgetList','singleWidget','widgetObject','firstInput','postMethod','autoUpload','enabled','noChunks','policyFields','fileBinding','donePresent','doneMatches','sendPresent','sendMatches')
HASH_KEYS = ('doneSha256','expectedDoneSha256','sendSha256','expectedSendSha256')


def load_release():
    request = Request(RELEASE_URL, headers={'User-Agent':'PanelStock-Nexvia-Bridge/1.0'})
    data = urlopen(request, timeout=30).read(MAX_RELEASE_BYTES + 1)
    if len(data)>MAX_RELEASE_BYTES or hashlib.sha256(data).hexdigest()!=EXPECTED:
        raise SystemExit('Verification failed; no check performed.')
    ns={'__name__':'verified_contract_diagnostic','__file__':'/config/contract_diagnostic.py'}
    exec(compile(data,ns['__file__'],'exec'),ns)
    return ns


def safe_projection(value):
    if not isinstance(value,dict) or set(value)!=set(CHECK_KEYS+HASH_KEYS):
        raise ValueError('Diagnostic shape changed; no details printed.')
    if any(type(value[k]) is not bool for k in CHECK_KEYS):
        raise ValueError('Diagnostic flags changed; no details printed.')
    if any(value[k] is not None and (type(value[k]) is not str or len(value[k])!=64 or any(c not in '0123456789abcdef' for c in value[k])) for k in HASH_KEYS):
        raise ValueError('Diagnostic hashes changed; no details printed.')
    return {k:value[k] for k in CHECK_KEYS+HASH_KEYS}


def prepare(ns):
    original_source=ns['NATIVE_PREFLIGHT']
    marker="            quote.validate_native_draft(state, request, editor['createPath'], native_snapshot=editor)"
    end="    print(json.dumps(report, separators=(',', ':')))"
    assert original_source.count(marker)==original_source.count(end)==1
    source=FACTS_SOURCE+'\n'+original_source
    source=source.replace(marker,"            checkpoint['uploaderChecks'] = uploader_checks(state, quote)\n"+marker)
    source=source.replace(end,"    report['uploaderChecks'] = checkpoint.get('uploaderChecks')\n"+end)
    compile(source,'<read-only-contract-check>','exec')
    ns['NATIVE_PREFLIGHT']=source
    original_run=ns['subprocess'].run
    def observe(*args,**kwargs):
        result=original_run(*args,**kwargs)
        command=args[0] if args else kwargs.get('args')
        if isinstance(command,list) and len(command)==7 and command[4]==source and result.returncode==0 and len(result.stdout)<=4096:
            report=json.loads(result.stdout)
            facts=report.pop('uploaderChecks',None)
            if facts is not None:
                facts=safe_projection(facts)
                print('Failed checks:',','.join(k for k in CHECK_KEYS if not facts[k]) or 'none')
                print('DONE source:',facts['doneSha256'],'expected:',facts['expectedDoneSha256'])
                print('SEND source:',facts['sendSha256'],'expected:',facts['expectedSendSha256'])
            result.stdout=json.dumps(report,separators=(',',':')).encode()
        return result
    ns['subprocess'].run=observe
    return ns['decoded_payload'](),original_run


def diagnose(ns,root=Path('/config')):
    files,original_run=prepare(ns)
    try:
        with ns['lock_file'](root/'panelstock-request-journal/.bridge.lock','Bridge busy; run this check again.',30) as fd:
            ns['native_policy_preflight'](root,root/'nexvia-tools/bin/python',files,REQUEST,bridge_lock_fd=fd)
        print('Read-only compatibility: PASS. Nothing installed.')
    except ns['QuotePolicyUpdateError'] as error:
        print(str(error))
    finally:
        ns['subprocess'].run=original_run
    print('No file selected or uploaded; no PO submitted or request retried.')


if __name__=='__main__':
    sys.dont_write_bytecode = True
    diagnose(load_release())
