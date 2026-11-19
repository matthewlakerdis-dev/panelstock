import os,json,time
from urllib.request import Request,urlopen
from urllib.error import HTTPError
token=os.environ.get('CLOUDFLARE_SECURITY_TOKEN') or os.environ['CLOUDFLARE_API_TOKEN']
def call(path,body=None):
    req=Request('https://api.cloudflare.com/client/v4/'+path,data=None if body is None else json.dumps(body).encode(),method='GET' if body is None else 'PATCH',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=25) as response: data=json.load(response)
    except HTTPError as error:
        try:data=json.load(error)
        except Exception:data={}
        print('ACCESS_BLOCKED',path.split('?')[0],error.code,[{'code':e.get('code'),'message':e.get('message')} for e in data.get('errors',[])],flush=True);return None
    if not data.get('success'): print('API_ERROR',path,data.get('errors'),flush=True);return None
    return data.get('result')
zones=call('zones?name=panelstockhq.com')
if not zones: raise SystemExit('No zone access. No changes made.')
zone=next((row for row in zones if row.get('name')=='panelstockhq.com'),None)
if not zone: raise SystemExit('Exact zone not found. No changes made.')
base='zones/'+zone['id']
# Verify trusted HTTPS before HSTS. An auth rejection is still a successful TLS handshake.
for host in ['app.panelstockhq.com','web.panelstockhq.com','safety.panelstockhq.com','site.panelstockhq.com','tv.panelstockhq.com']:
    try:
        with urlopen(Request('https://'+host+'/',headers={'User-Agent':'PanelStock-security-verifier/1.0'}),timeout=25) as response: status=response.status
    except HTTPError as error:
        if error.code!=401: raise
        status=401
    print('TLS_VERIFIED',host,status,flush=True)
settings=call(base+'/settings/security_header')
if settings is not None:
    previous=settings['value']
    print('HSTS_BEFORE',json.dumps(previous),flush=True)
    updated=dict(previous);sts=dict(updated.get('strict_transport_security',{}))
    # Keep a longer existing policy; do not opt other subdomains or browsers into preload.
    if not sts.get('enabled') or not sts.get('max_age'):
        sts.update(enabled=True,max_age=86400);updated['strict_transport_security']=sts
        result=call(base+'/settings/security_header',{'value':updated})
        if result is not None: print('HSTS_APPLIED',json.dumps(result['value']),flush=True)
    else: print('HSTS_ALREADY_ENABLED',flush=True)
https=call(base+'/settings/always_use_https')
if https is not None and https.get('value')=='off':
    result=call(base+'/settings/always_use_https',{'value':'on'})
    if result is not None: print('HTTPS_REDIRECT_APPLIED',result['value'],flush=True)
for host in ['app.panelstockhq.com','web.panelstockhq.com','safety.panelstockhq.com','site.panelstockhq.com']:
    try:
        with urlopen(Request('https://'+host+'/?security-check='+str(time.time_ns()),headers={'Cache-Control':'no-cache'}),timeout=25) as response: print('LIVE_HEADERS',host,response.status,'hsts',response.headers.get('Strict-Transport-Security'),flush=True)
    except Exception as error: print('LIVE_CHECK',host,type(error).__name__,str(error)[:200],flush=True)
print('DNS_AND_BOT_PENDING: scoped permissions required; no DNS or bot changes attempted.',flush=True)
