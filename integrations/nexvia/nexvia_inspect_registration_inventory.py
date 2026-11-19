"""Inspect a rejected uploader source guard without invoking or installing it."""
import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import types
from urllib.request import Request, urlopen
import uuid

RELEASE_URL = 'https://raw.githubusercontent.com/matthewlakerdis-dev/panelstock/b220daf083197abff3f508d7893d87933d5d1ceb/integrations/nexvia/releases/install_nexvia_quote_registration_update_v5.py'
RELEASE_SHA256 = '50083a30e502a36d547bf1771d9094cda38e1f79b375d130cb5a168933ace9c6'
RELEASE_BYTES = 344346
MAX_OUTPUT_BYTES = 8192

# The same pure helper text runs in the isolated native preflight and in tests.
# Unknown identifiers, literals and neighboring tokens are never projected.
PROBE_CODE = r'''
import types
INVENTORY_NAMES = frozenset({'fetch','XMLHttpRequest','WebSocket','EventSource','sendBeacon','send','sendAsBinary','load','eval','Function','execScript','importScripts','import','require','getScript','getJSON','open','setAttribute','defineProperty','__proto__','prototype','constructor'})
def inventory_summary(tokens, spans, registration):
    forbidden=[]; ajax=[]; members=[]; forbidden_count=0; ajax_count=0; member_count=0
    ajax_valid=True; members_valid=True; first_shape=None
    def event(index, name, kind):
        previous=tokens[index-1:index]; following=tokens[index+1:index+2]
        return {'name':name,'kind':kind,'tokenIndex':index,
                'depth':max(-1,min(64,registration._depth(index,spans))),
                'call':following==[('punct','(')],'dot':previous==[('punct','.')],
                'colon':following==[('punct',':')],
                'computed':previous==[('punct','[')] and following==[('punct',']')]}
    for index,(kind,value) in enumerate(tokens):
        if kind in {'id','string'} and value in INVENTORY_NAMES:
            forbidden_count+=1
            if len(forbidden)<8:forbidden.append(event(index,value,kind))
        if (kind,value)==('id','ajax'):
            ajax_count+=1
            valid=(index>=2 and tokens[index-2:index]==[('id','$'),('punct','.')]
                   and tokens[index+1:index+3]==[('punct','('),('punct','{')]
                   and registration._depth(index,spans)==0)
            ajax_valid=ajax_valid and valid
            if not valid and first_shape is None:first_shape='ajax_shape'
            if len(ajax)<2:ajax.append({'tokenIndex':index,'valid':valid,'jqueryReceiver':tokens[index-2:index]==[('id','$'),('punct','.')],
                                       'objectArgument':tokens[index+1:index+3]==[('punct','('),('punct','{')],
                                       'depth':max(-1,min(64,registration._depth(index,spans)))})
        if kind in {'id','string'} and value in {'get','post','send','submit'} and tokens[index-1:index]==[('punct','.')]:
            member_count+=1
            valid=(value=='submit' and tokens[index-2:index]==[('id','data'),('punct','.')]
                   and tokens[index+1:index+3]==[('punct','('),('punct',')')]
                   and registration._depth(index,spans)==1)
            members_valid=members_valid and valid
            if not valid and first_shape is None:first_shape='member_shape'
            if len(members)<2:members.append({'name':value,'tokenIndex':index,'valid':valid,
                'dataReceiver':tokens[index-2:index]==[('id','data'),('punct','.')],
                'emptyArguments':tokens[index+1:index+3]==[('punct','('),('punct',')')],
                'depth':max(-1,min(64,registration._depth(index,spans)))})
    counts_valid=ajax_count==member_count==1
    clause='forbidden_token' if forbidden_count else first_shape if first_shape is not None else 'call_count' if not counts_valid else 'none'
    return {'firstClause':clause,'tokenCount':min(40000,len(tokens)),
            'forbiddenClear':forbidden_count==0,'ajaxShapesValid':ajax_valid,'memberShapesValid':members_valid,'countsValid':counts_valid,
            'forbiddenCount':min(1000,forbidden_count),'ajaxCount':min(1000,ajax_count),'memberCount':min(1000,member_count),
            'forbidden':forbidden,'ajax':ajax,'members':members}

def install_inventory_probe(registration, checkpoint):
    original_inventory=registration._done_inventory
    original_source=registration._source_contract
    def measured(tokens,spans):
        checkpoint['inventory']=inventory_summary(tokens,spans,registration)
        return original_inventory(tokens,spans)
    registration._done_inventory=measured
    def pure_stop(page,done,send):
        try:
            original_source(done,send)
        except registration.RegistrationError as error:
            reason=error.args[0] if len(error.args)==1 and type(error.args[0]) is str else None
            checkpoint['originalInventoryFailure']=reason=='registration_network_inventory'
            if reason=='registration_network_inventory':
                # This clone cannot access read_contract/controller/browser work.
                # The live candidate module's rejecting inventory is never removed.
                copied=dict(original_source.__globals__)
                copied['_done_inventory']=lambda *args:None
                pure=types.FunctionType(original_source.__code__,copied,original_source.__name__,original_source.__defaults__,original_source.__closure__)
                try:
                    pure(done,send)
                except registration.RegistrationError as after:
                    code=after.args[0] if len(after.args)==1 and type(after.args[0]) is str else None
                    checkpoint['sourceAfterInventory']={'status':'pure_source_blocked','reason':code if code in registration.PUBLIC_FAILURE_CODES else None}
                except Exception:
                    checkpoint['sourceAfterInventory']={'status':'pure_source_error','reason':None}
                else:
                    checkpoint['sourceAfterInventory']={'status':'pure_source_pass','reason':None}
            raise
        checkpoint['sourceAfterInventory']={'status':'original_source_pass','reason':None}
        raise RuntimeError('Read-only inventory inspection stopped before browser contract work')
    registration.read_contract=pure_stop
'''
_helpers = {}
exec(compile(PROBE_CODE, 'readonly_inventory_helpers.py', 'exec'), _helpers)
inventory_summary = _helpers['inventory_summary']
install_inventory_probe = _helpers['install_inventory_probe']
INVENTORY_NAMES = _helpers['INVENTORY_NAMES']


class InspectionError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InspectionError(message)


def release_namespace():
    try:
        raw = urlopen(Request(RELEASE_URL, headers={'User-Agent':'PanelStock-Nexvia-Bridge/1.0'}), timeout=30).read(1048577)
        require(len(raw) == RELEASE_BYTES and hashlib.sha256(raw).hexdigest() == RELEASE_SHA256,
                'Frozen quote updater verification failed; no inspection performed.')
        namespace = {'__name__':'verified_readonly_inventory_release'}
        exec(compile(raw, 'verified_readonly_inventory_release.py', 'exec'), namespace)
        return types.SimpleNamespace(**namespace)
    except InspectionError:
        raise
    except Exception:
        raise InspectionError('Frozen quote updater could not be read; no inspection performed.') from None


@contextmanager
def work_lock(root):
    folder = os.open(root / 'panelstock-request-journal', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        descriptor = os.open('.bridge.lock', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=folder)
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
                'Existing Nexvia work lock is unsafe; no inspection performed.')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise InspectionError('The bridge is handling work. Let it finish, then run this read-only check again.') from None
        yield descriptor
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(folder)


def diagnostic_preflight(source):
    replacements = (
        ('def blocked(*args, **kwargs):', PROBE_CODE + '\ndef blocked(*args, **kwargs):'),
        ("        quote = sys.modules['nexvia_quote_attachment']", "        install_inventory_probe(sys.modules['nexvia_quote_registration'], checkpoint)\n        quote = sys.modules['nexvia_quote_attachment']"),
        ("    report.update(passed=checkpoint['passed'], stage=checkpoint['stage'])", "    report['inventoryDiagnostic'] = {key:checkpoint.get(key) for key in ('inventory','originalInventoryFailure','sourceAfterInventory')}\n    report.update(passed=checkpoint['passed'], stage=checkpoint['stage'])"),
    )
    for marker, replacement in replacements:
        require(source.count(marker) == 1, 'Frozen inspection markers changed; no inspection performed.')
        source = source.replace(marker, replacement)
    compile(source, 'readonly_inventory_preflight.py', 'exec')
    return source


def project_result(value, expected, failure_codes):
    require(type(value) is dict and all(value.get(key) == item for key,item in expected.items())
            and value.get('passed') is False and value.get('stage') in {'open_draft','native_guard','source_normalizer','upload_fields','registration_source'},
            'Read-only inventory inspection returned an invalid result.')
    reason = value.get('reason')
    reason = reason if type(reason) is str and reason in failure_codes else None
    detail = value.get('inventoryDiagnostic') or {}
    require(type(detail) is dict, 'Read-only inventory metadata is invalid.')
    inventory = detail.get('inventory')
    if inventory is not None:
        require(type(inventory) is dict and len(json.dumps(inventory)) <= 3500,
                'Read-only inventory metadata exceeded its bound.')
        # Only the helper's fixed schema is allowed, independent of child output.
        require(set(inventory) == {'firstClause','tokenCount','forbiddenClear','ajaxShapesValid','memberShapesValid','countsValid','forbiddenCount','ajaxCount','memberCount','forbidden','ajax','members'},
                'Read-only inventory metadata fields changed.')
        require(inventory['firstClause'] in {'none','forbidden_token','ajax_shape','member_shape','call_count'}, 'Inventory clause is invalid.')
        for name in ('tokenCount','forbiddenCount','ajaxCount','memberCount'):
            require(type(inventory[name]) is int and 0 <= inventory[name] <= 40000, 'Inventory count is invalid.')
        for name in ('forbiddenClear','ajaxShapesValid','memberShapesValid','countsValid'):
            require(type(inventory[name]) is bool, 'Inventory check is invalid.')
        schemas = {'forbidden':({'name','kind','tokenIndex','depth','call','dot','colon','computed'},8),
                   'ajax':({'tokenIndex','valid','jqueryReceiver','objectArgument','depth'},2),
                   'members':({'name','tokenIndex','valid','dataReceiver','emptyArguments','depth'},2)}
        for name,(keys,maximum) in schemas.items():
            rows=inventory[name]
            require(type(rows) is list and len(rows)<=maximum, 'Inventory rows exceeded their bound.')
            for row in rows:
                require(type(row) is dict and set(row)==keys, 'Inventory row fields changed.')
                require(type(row['tokenIndex']) is int and 0<=row['tokenIndex']<40000
                        and type(row['depth']) is int and -1<=row['depth']<=64, 'Inventory position is invalid.')
                for key in keys-{'name','kind','tokenIndex','depth'}:
                    require(type(row[key]) is bool, 'Inventory flag is invalid.')
                if 'kind' in keys:
                    require(row['kind'] in {'id','string'}, 'Inventory token kind is invalid.')
                if 'name' in keys:
                    require(type(row['name']) is str and row['name'] in (INVENTORY_NAMES if name=='forbidden' else {'get','post','send','submit'}), 'Inventory token name is invalid.')
    after = detail.get('sourceAfterInventory')
    if after is not None:
        require(type(after) is dict and set(after)=={'status','reason'}
                and after['status'] in {'pure_source_pass','pure_source_blocked','pure_source_error','original_source_pass'}
                and (after['reason'] is None or type(after['reason']) is str and after['reason'] in failure_codes),
                'Pure source metadata is invalid.')
    return {'stage':value['stage'],'reason':reason,'originalInventoryFailure':detail.get('originalInventoryFailure') is True,
            'inventory':inventory,'sourceAfterInventory':after,'readOnly':True,'compatibilityApproved':False}


def inspect(root, identifier, release):
    root=Path(root)
    try:
        require(str(uuid.UUID(identifier)) == identifier, 'Use the exact saved request UUID.')
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
                for name in ('DEBUG','PWDEBUG','DEBUG_FILE'):
                    environment.pop(name,None)
                result=subprocess.run([str(root/'nexvia-tools/bin/python'),'-I','-B','-c',diagnostic_preflight(release.NATIVE_PREFLIGHT),str(root),str(descriptor)],
                    input=json.dumps(payload,separators=(',',':')).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                    pass_fds=(descriptor,),timeout=120,check=False,env=environment)
                require(result.returncode==0 and len(result.stdout)<=MAX_OUTPUT_BYTES,
                        'Read-only inventory inspection stopped; no source or callback was invoked.')
                value=json.loads(result.stdout)
                return project_result(value,expected,release.registration_failure_codes(files['nexvia_quote_registration.py']))
            finally:
                require(release.snapshot(root)==originals and release.read_config(root/'panelstock-requests.json')[0]==config
                        and release.observed_registration_evidence(root,identifier)==evidence and release.protected_state(root)==before,
                        'Original module or request evidence changed during inspection; stop and report this message.')
    except InspectionError:
        raise
    except Exception:
        raise InspectionError('Read-only inventory inspection stopped safely; no uploader action or installation was invoked.') from None


def main(argv=None):
    class FixedParser(argparse.ArgumentParser):
        def error(self, message):
            raise InspectionError('Use --request with the exact saved request UUID.')
    parser=FixedParser(description=__doc__)
    parser.add_argument('--request',required=True)
    args=parser.parse_args(argv)
    sys.dont_write_bytecode=True
    result=inspect(Path('/config'),args.request,release_namespace())
    print('Original guard:',json.dumps({key:result[key] for key in ('stage','reason','originalInventoryFailure')},separators=(',',':')))
    print('Inventory:',json.dumps(result['inventory'],separators=(',',':')))
    print('Pure source check:',json.dumps(result['sourceAfterInventory'],separators=(',',':')))
    print('Read-only inspection only. No file selected/uploaded, registration, PO, email, installation or request retry. Compatibility was not approved.')
    return 0


if __name__=='__main__':
    try:
        raise SystemExit(main())
    except InspectionError as error:
        raise SystemExit(str(error)) from None
