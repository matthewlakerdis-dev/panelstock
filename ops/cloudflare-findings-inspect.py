import os,json,socket,subprocess
from urllib.request import Request,urlopen
from urllib.error import HTTPError
TOKEN=os.environ.get('CLOUDFLARE_API_TOKEN','')
def cf(path):
    req=Request('https://api.cloudflare.com/client/v4/'+path,headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=25) as response: data=json.load(response)
    except HTTPError as error:
        try:data=json.load(error)
        except Exception:data={}
        print('CF_ACCESS',path.split('?')[0],error.code,[{'code':e.get('code'),'message':e.get('message')} for e in data.get('errors',[])],flush=True)
        return None
    if not data.get('success'):
        print('CF_ACCESS',path.split('?')[0],'unsuccessful',data.get('errors'),flush=True);return None
    return data.get('result')
for host in ['app.panelstockhq.com','web.panelstockhq.com','safety.panelstockhq.com','site.panelstockhq.com','tv.panelstockhq.com']:
    try:
        req=Request('https://'+host+'/',headers={'User-Agent':'PanelStock-security-verifier/1.0','Cache-Control':'no-cache'})
        with urlopen(req,timeout=25) as response:
            print('HTTPS',host,'status',response.status,'url',response.url,'hsts',response.headers.get('Strict-Transport-Security'),'server',response.headers.get('Server'),'cf_ray',bool(response.headers.get('CF-Ray')),flush=True)
        cname=subprocess.check_output(['dig','+short','CNAME',host],text=True,timeout=15).strip()
        print('DNS_CNAME',host,cname,flush=True)
    except Exception as error: print('PUBLIC_CHECK',host,type(error).__name__,str(error)[:200],flush=True)
zones=cf('zones?name=panelstockhq.com')
if not zones: raise SystemExit('No accessible panelstockhq.com zone. No settings changed.')
zone=next((z for z in zones if z.get('name')=='panelstockhq.com'),None)
if not zone: raise SystemExit('Exact zone not found. No settings changed.')
print('ZONE','panelstockhq.com','status',zone.get('status'),'plan',zone.get('plan',{}).get('name'),flush=True)
base='zones/'+zone['id']
for name in ['app.panelstockhq.com','web.panelstockhq.com']:
    records=cf(base+'/dns_records?name='+name)
    if records is not None: print('DNS_RECORDS',name,[{k:r.get(k) for k in ['type','name','content','proxied','proxiable','ttl']} for r in records],flush=True)
for setting in ['ssl','always_use_https','security_header']:
    result=cf(base+'/settings/'+setting)
    if result is not None: print('SETTING',setting,{k:result.get(k) for k in ['value','editable']},flush=True)
bots=cf(base+'/bot_management')
if bots is not None: print('BOT_SETTINGS',{k:bots.get(k) for k in ['fight_mode','enable_js','using_latest_model','sbfm_definitely_automated','sbfm_likely_automated','sbfm_verified_bots']},flush=True)
