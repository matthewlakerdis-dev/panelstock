"""Inspect a rejected uploader source guard without invoking or installing it."""
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

RELEASE_URL = 'https://raw.githubusercontent.com/matthewlakerdis-dev/panelstock/b220daf083197abff3f508d7893d87933d5d1ceb/integrations/nexvia/releases/install_nexvia_quote_registration_update_v5.py'
RELEASE_SHA256 = '50083a30e502a36d547bf1771d9094cda38e1f79b375d130cb5a168933ace9c6'
RELEASE_BYTES = 344346
MAX_OUTPUT_BYTES = 16384

# The same pure helper text runs in the isolated native preflight and in tests.
# Unknown identifiers, literals and neighboring tokens are never projected.
PROBE_CODE = r'''
import hashlib
import json
import re
import sys
import types
INVENTORY_NAMES = frozenset({'fetch','XMLHttpRequest','WebSocket','EventSource','sendBeacon','send','sendAsBinary','load','eval','Function','execScript','importScripts','import','require','getScript','getJSON','open','setAttribute','defineProperty','__proto__','prototype','constructor'})
NAMESPACE_EQUALITY_LINE = 327  # Exact require in the hash-verified frozen V5 helper.

def eval_roles(tokens, spans, registration):
    rows=[]
    def scopes(position):
        stack=[]
        for index,token in enumerate(tokens[:position]):
            if token==('punct','{'):stack.append(index)
            elif token==('punct','}') and stack:stack.pop()
        return stack
    def initial(name,position):
        found=None; enclosing=scopes(position)
        for index in range(1,position-2):
            if tokens[index]==('id',name) and tokens[index-1] in {('id','var'),('id','let'),('id','const')} and tokens[index+1]==('punct','='):
                scope=scopes(index)
                if enclosing[:len(scope)]==scope and registration._depth(index,spans)==registration._depth(position,spans):
                    found=(index,tokens[index+2:index+3],tokens[index+3:index+4])
        return found
    for index,token in enumerate(tokens):
        if token!=('id','eval') or tokens[index+1:index+2]!=[('punct','(')]:continue
        if len(rows)>=8:break
        close=registration._balanced(tokens,index+1)
        argument=tokens[index+2:close]
        shape=(len(argument)==3 and argument[0][0]=='string' and argument[1]==('punct','+') and argument[2][0]=='id')
        assigned=re.fullmatch(r'\s*(?:(?:var|let|const)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*',argument[0][1]) if shape else None
        local=assigned.group(1) if assigned else None
        declaration=initial(local,index) if local else None
        bool_local=bool(declaration and declaration[1] in ([('id','true')],[('id','false')]) and declaration[2]==[('punct',';')])
        following=close+1
        if tokens[following:following+1]==[('punct',';')]:following+=1
        target=tokens[following:following+11]
        file_assignment=bool(local and len(target)==11 and target[:4]==[('id','data'),('punct','.'),('id','files'),('punct','[')]
            and target[4][0]=='id' and target[5:7]==[('punct',']'),('punct','.')]
            and target[7][0]=='id' and target[8:]==[('punct','='),('id',local),('punct',';')])
        argument_name=argument[2][1] if shape else None
        start=initial(argument_name,index) if shape else None
        boolean_string=bool(start and start[1] in ([('string','true')],[('string','false')]) and start[2]==[('punct',';')])
        writes={key:0 for key in ('boolstring','emptystring','otherstring','normalizer','other')}
        if argument_name:
            for cursor in range(1,len(tokens)-1):
                if tokens[cursor]!=('id',argument_name) or tokens[cursor+1][1] not in {'=','+=','-='} or tokens[cursor-1]==('punct','.') or start and cursor==start[0]:continue
                value=registration._statement(tokens,cursor+2)
                category='other'
                if tokens[cursor+1]==('punct','='):
                    if len(value)==1 and value[0][0]=='string':category='boolstring' if value[0][1] in {'true','false'} else 'emptystring' if value[0][1]=='' else 'otherstring'
                    else:
                        opening=next((j for j,item in enumerate(value) if item==('punct','(')),None)
                        if opening is not None and registration._member(value[:opening]) and registration._balanced(value,opening)==len(value)-1:
                            arguments=registration._split(value[opening+1:-1],',')
                            # Role shape only; this never approves the callable or its output.
                            if arguments and arguments[0]==[('id',argument_name)]:category='normalizer'
                writes[category]=min(40000,writes[category]+1)
        rows.append({'tokenIndex':index,'depth':max(-1,min(64,registration._depth(index,spans))),
                     'argumentStringPlusIdentifier':shape,'assignmentPrefixValid':assigned is not None,
                     'precedingLocalBooleanDeclaration':bool_local,'followingFileBooleanAssignment':file_assignment,
                     'argumentInitiallyBooleanString':boolean_string,'otherWriteCount':sum(writes.values()),'otherWrites':writes})
    return rows

def route_summary(error, original_source, registration):
    frame=None; line=None; traceback=error.__traceback__
    while traceback is not None:
        if traceback.tb_frame.f_code is original_source.__code__:frame=traceback.tb_frame;line=traceback.tb_lineno
        traceback=traceback.tb_next
    if frame is None:return None
    values=frame.f_locals
    namespaces=values.get('namespaces',[]);branches=values.get('branches',[])
    predicates=registration._namespace_predicates(values['dt'],values['df']) if 'dt' in values and 'df' in values else []
    def sha(value):return hashlib.sha256(value.encode()).hexdigest()
    def predicate(row):
        return {'selectorSha256':sha(row[0]),'acceptedCount':min(40000,len(row[1])),
                'acceptedSetSha256':hashlib.sha256(json.dumps(sorted(set(row[1])),sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()).hexdigest()}
    done=branches[0][:2] if len(branches)==1 else predicates[0] if len(predicates)==1 else None
    send=namespaces[0] if len(namespaces)==1 else None
    prefix=values.get('prefix')
    return {'helperSourceLine':line,'sendNamespaceCount':min(40000,len(namespaces)),
            'doneBranchCount':min(40000,len(branches)),'donePredicateCount':min(40000,len(predicates)),
            'sendPredicates':[predicate(row) for row in namespaces[:8]],'donePredicates':[predicate(row) for row in predicates[:8]],
            'selectorEqual':done[0]==send[0] if done is not None and send is not None else None,
            'acceptedOrderEqual':done[1]==send[1] if done is not None and send is not None else None,
            'acceptedSetEqual':set(done[1])==set(send[1]) if done is not None and send is not None else None,
            'prefixSha256':sha(prefix) if type(prefix) is str else None,
            'prefixLength':len(prefix) if type(prefix) is str else None,
            'prefixAscii':prefix.isascii() if type(prefix) is str else None,
            'prefixStartsSlash':prefix.startswith('/') if type(prefix) is str else None,
            'prefixEndsSlash':prefix.endswith('/') if type(prefix) is str else None,
            'prefixNoDoubleSlash':'//' not in prefix if type(prefix) is str else None,
            'prefixSegmentsSafe':all(re.fullmatch(r'[A-Za-z0-9_-]+',part) is not None for part in prefix.split('/')[1:-1]) if type(prefix) is str else None,
            'prefixPinMatch':sha(prefix)==registration.PREFIX_SHA256 if type(prefix) is str else None}

def namespace_equality_only(frame, original_source):
    if frame.f_code is not original_source.__code__ or frame.f_lineno!=NAMESPACE_EQUALITY_LINE:return False
    values=frame.f_locals;namespaces=values.get('namespaces');branches=values.get('branches')
    return (type(namespaces) is list and len(namespaces)==1 and type(branches) is list and len(branches)==1
            and 'controller' in values and 'accepted' in values and values['accepted'] is branches[0][1]
            and values['controller']==branches[0][0] and (values['controller'],values['accepted'])!=namespaces[0])

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
            'forbidden':forbidden,'ajax':ajax,'members':members,'evalRoles':eval_roles(tokens,spans,registration)}

def install_inventory_probe(registration, checkpoint):
    original_inventory=registration._done_inventory
    original_source=registration._source_contract
    def measured(tokens,spans):
        try:checkpoint['inventory']=inventory_summary(tokens,spans,registration)
        except Exception:checkpoint['inventory']=None
        return original_inventory(tokens,spans)
    registration._done_inventory=measured
    def pure_stop(page,done,send):
        try:
            original_source(done,send)
        except registration.RegistrationError as error:
            reason=error.args[0] if len(error.args)==1 and type(error.args[0]) is str else None
            checkpoint['originalInventoryFailure']=reason=='registration_network_inventory'
            if reason=='registration_network_inventory':
                try:
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
                        if code=='registration_route_branch':
                            checkpoint['routeDiagnostic']=route_summary(after,original_source,registration)
                            original_require=original_source.__globals__['require'];skipped=[]
                            def measured_require(value,code):
                                caller=sys._getframe(1)
                                if value is False and code=='registration_route_branch' and not skipped and namespace_equality_only(caller,original_source):
                                    skipped.append(caller.f_lineno);return
                                return original_require(value,code)
                            # The second clone changes only its own global lookups.
                            copied_again=dict(copied);copied_again['require']=measured_require
                            additional=types.FunctionType(original_source.__code__,copied_again,original_source.__name__,original_source.__defaults__,original_source.__closure__)
                            result={'status':'pure_source_pass','reason':None}
                            try:additional(done,send)
                            except registration.RegistrationError as downstream:
                                finite=downstream.args[0] if len(downstream.args)==1 and type(downstream.args[0]) is str else None
                                result={'status':'pure_source_blocked','reason':finite if finite in registration.PUBLIC_FAILURE_CODES else None}
                            except Exception:result={'status':'pure_source_error','reason':None}
                            result['namespaceEqualitySkipped']=bool(skipped)
                            checkpoint['sourceAfterNamespaceEquality']=result
                    except Exception:
                        checkpoint['sourceAfterInventory']={'status':'pure_source_error','reason':None}
                    else:
                        checkpoint['sourceAfterInventory']={'status':'pure_source_pass','reason':None}
                except Exception:
                    checkpoint['sourceAfterInventory']={'status':'pure_source_error','reason':None}
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
        ("    report.update(passed=checkpoint['passed'], stage=checkpoint['stage'])", "    report['inventoryDiagnostic'] = {key:checkpoint.get(key) for key in ('inventory','originalInventoryFailure','sourceAfterInventory','routeDiagnostic','sourceAfterNamespaceEquality')}\n    report.update(passed=checkpoint['passed'], stage=checkpoint['stage'])"),
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
        require(type(inventory) is dict and len(json.dumps(inventory)) <= 6500,
                'Read-only inventory metadata exceeded its bound.')
        # Only the helper's fixed schema is allowed, independent of child output.
        require(set(inventory) == {'firstClause','tokenCount','forbiddenClear','ajaxShapesValid','memberShapesValid','countsValid','forbiddenCount','ajaxCount','memberCount','forbidden','ajax','members','evalRoles'},
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
        roles=inventory['evalRoles']
        require(type(roles) is list and len(roles)<=8, 'Eval roles exceeded their bound.')
        flags={'argumentStringPlusIdentifier','assignmentPrefixValid','precedingLocalBooleanDeclaration','followingFileBooleanAssignment','argumentInitiallyBooleanString'}
        for row in roles:
            require(type(row) is dict and set(row)==flags|{'tokenIndex','depth','otherWriteCount','otherWrites'}, 'Eval role fields changed.')
            require(type(row['tokenIndex']) is int and 0<=row['tokenIndex']<40000
                    and type(row['depth']) is int and -1<=row['depth']<=64, 'Eval position is invalid.')
            require(all(type(row[key]) is bool for key in flags), 'Eval flag is invalid.')
            counts=row['otherWrites']
            require(type(counts) is dict and set(counts)=={'boolstring','emptystring','otherstring','normalizer','other'}
                    and all(type(item) is int and 0<=item<=40000 for item in counts.values())
                    and type(row['otherWriteCount']) is int and 0<=row['otherWriteCount']<=40000
                    and row['otherWriteCount']==sum(counts.values()), 'Eval write counts are invalid.')
    after = detail.get('sourceAfterInventory')
    if after is not None:
        require(type(after) is dict and set(after)=={'status','reason'}
                and after['status'] in {'pure_source_pass','pure_source_blocked','pure_source_error','original_source_pass'}
                and (after['reason'] is None or type(after['reason']) is str and after['reason'] in failure_codes),
                'Pure source metadata is invalid.')
    route=detail.get('routeDiagnostic')
    if route is not None:
        counts={'sendNamespaceCount','doneBranchCount','donePredicateCount'}
        flags={'selectorEqual','acceptedOrderEqual','acceptedSetEqual','prefixPinMatch','prefixAscii','prefixStartsSlash','prefixEndsSlash','prefixNoDoubleSlash','prefixSegmentsSafe'}
        require(type(route) is dict and set(route)==counts|flags|{'helperSourceLine','sendPredicates','donePredicates','prefixSha256','prefixLength'}
                and len(json.dumps(route))<=4500, 'Route metadata fields changed.')
        require(type(route['helperSourceLine']) is int and 1<=route['helperSourceLine']<=10000
                and all(type(route[key]) is int and 0<=route[key]<=40000 for key in counts), 'Route counts are invalid.')
        require(all(route[key] is None or type(route[key]) is bool for key in flags), 'Route flags are invalid.')
        require(route['prefixLength'] is None or type(route['prefixLength']) is int and 0<=route['prefixLength']<=65536, 'Route prefix length is invalid.')
        def valid_hash(item):return type(item) is str and re.fullmatch(r'[a-f0-9]{64}',item) is not None
        require(route['prefixSha256'] is None or valid_hash(route['prefixSha256']), 'Route prefix hash is invalid.')
        for name in ('sendPredicates','donePredicates'):
            rows=route[name]
            require(type(rows) is list and len(rows)<=8, 'Route predicate rows exceeded their bound.')
            for row in rows:
                require(type(row) is dict and set(row)=={'selectorSha256','acceptedCount','acceptedSetSha256'}
                        and valid_hash(row['selectorSha256']) and valid_hash(row['acceptedSetSha256'])
                        and type(row['acceptedCount']) is int and 0<=row['acceptedCount']<=40000, 'Route predicate metadata is invalid.')
    additional=detail.get('sourceAfterNamespaceEquality')
    if additional is not None:
        require(type(additional) is dict and set(additional)=={'status','reason','namespaceEqualitySkipped'}
                and additional['status'] in {'pure_source_pass','pure_source_blocked','pure_source_error'}
                and (additional['reason'] is None or type(additional['reason']) is str and additional['reason'] in failure_codes)
                and type(additional['namespaceEqualitySkipped']) is bool, 'Additional pure source metadata is invalid.')
    return {'stage':value['stage'],'reason':reason,'originalInventoryFailure':detail.get('originalInventoryFailure') is True,
            'inventory':inventory,'sourceAfterInventory':after,'routeDiagnostic':route,
            'sourceAfterNamespaceEquality':additional,'readOnly':True,'compatibilityApproved':False}


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
    print('Route roles:',json.dumps(result['routeDiagnostic'],separators=(',',':')))
    print('Pure namespace-equality check:',json.dumps(result['sourceAfterNamespaceEquality'],separators=(',',':')))
    print('Read-only inspection only. No file selected/uploaded, registration, PO, email, installation or request retry. Compatibility was not approved.')
    return 0


if __name__=='__main__':
    try:
        raise SystemExit(main())
    except InspectionError as error:
        raise SystemExit(str(error)) from None
