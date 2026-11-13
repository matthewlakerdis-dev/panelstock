#!/usr/bin/env python3
"""Capture bounded, read-only Nexvia integration metadata from the NAS browser.

No cookies, headers, form values, full HTML or customer records are exported.
Newly opened inspection pages block every HTTP method except GET/HEAD/OPTIONS.
"""

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlencode, urlsplit


ORIGIN = "https://lennox.nexvia.com.au"
DEFAULT_OUTPUT = Path("/config/nexvia-live-discovery.json")
MAX_REPORT_BYTES = 512 * 1024
ALLOWED_METHODS = {"GET", "HEAD", "OPTIONS"}
SENSITIVE = re.compile(r"password|passwd|secret|token|csrf|cookie|authorization|session", re.I)


def safe_path(value):
    if not isinstance(value, str) or len(value) > 2000:
        return None
    parsed = urlsplit(value)
    if parsed.scheme and (parsed.scheme != "https" or parsed.netloc != "lennox.nexvia.com.au"):
        return None
    if parsed.netloc and parsed.netloc != "lennox.nexvia.com.au":
        return None
    path = parsed.path
    if not path.startswith("/staff/") or len(path) > 320 or SENSITIVE.search(path):
        return None
    if any(len(part) > 80 for part in path.split("/")):
        return None
    return path


METADATA_JS = r"""() => {
 const sensitive = /password|passwd|secret|token|csrf|cookie|authorization|session/i;
 const cleanName = value => typeof value === 'string' && value.length <= 160 && !sensitive.test(value) ? value : null;
 const route = value => {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
   const url = new URL(value, location.origin);
   if (url.origin !== location.origin || !url.pathname.startsWith('/staff/') || url.pathname.length > 320 || sensitive.test(url.pathname) || url.pathname.split('/').some(part => part.length > 80)) return null;
   return url.pathname;
  } catch { return null; }
 };
 const routeHints = source => [...new Set((String(source || '').match(/\/staff\/[A-Za-z0-9_./-]+/g) || []).map(route).filter(Boolean))].slice(0, 120);
 const navigation = [],navigationPaths=[];
 for (const a of document.querySelectorAll('a[href]')) {
  const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
  const path = route(a.getAttribute('href'));
  if(path&&!/\/(?:add|delete|remove|save|modify)(?:\/|$)|\/[0-9]+(?:\/|$)/i.test(path)&&!navigationPaths.includes(path)&&navigationPaths.length<100)navigationPaths.push(path);
  const kind = /^(?:all |active )?projects?$/i.test(label) ? 'projects'
   : /^(?:all )?(?:suppliers?|contractors?)$/i.test(label) ? 'suppliers'
   : /^(?:chart of |general ledger )?accounts?$/i.test(label) ? 'accounts'
   : /^tax(?:es| rates?)?$/i.test(label) ? 'taxes' : null;
  if (kind && path && !navigation.some(value => value.kind === kind && value.path === path)) navigation.push({kind, path});
 }
 const describe = value => typeof value === 'string' ? cleanName(value) : typeof value;
 const records = [];
 const jq = window.jQuery || window.$;
 if (typeof jq === 'function') {
  const seen = new Set();
  for (const element of document.querySelectorAll('[data-role],select,input,.k-grid')) {
   let data;
   try { data = jq(element).data() || {}; } catch { continue; }
   for (const kind of ['kendoGrid','kendoDropDownList','kendoComboBox','kendoMultiSelect','kendoAutoComplete']) {
    const widget = data[kind];
    if (!widget || seen.has(widget) || !widget.dataSource) continue;
    seen.add(widget);
    const options = widget.options || {}, ds = widget.dataSource;
    const name = cleanName(element.getAttribute('name'));
    const id = cleanName(element.id);
    if ((!name && !id) || sensitive.test(name || '') || sensitive.test(id || '')) continue;
    const dso = ds.options || {}, schema = dso.schema || {};
    const transports = dso.transport || ds.transport?.options || {};
    const read = transports.read;
    const item = {kind, id, name, dataTextField: describe(options.dataTextField), dataValueField: describe(options.dataValueField), serverPaging: dso.serverPaging === true, serverFiltering: dso.serverFiltering === true, schema:{data:describe(schema.data), total:describe(schema.total), modelId:describe(schema.model?.id)}};
    if (typeof read === 'string') item.read = {path:route(read), method:'GET'};
    else if (read && typeof read === 'object') item.read = {path:route(read.url), method:typeof read.type === 'string' ? read.type.toUpperCase() : 'GET', parameterNames:typeof read.data === 'object' && read.data ? Object.keys(read.data).map(cleanName).filter(Boolean).slice(0,30) : [], dataType:describe(read.dataType)};
    else if (typeof read === 'function') item.read = {function:true, routeHints:routeHints(read.toString())};
    try { const total=Number(ds.total()); if(Number.isSafeInteger(total)&&total>=0)item.total=total; } catch {}
    try { const size=Number(ds.pageSize()); if(Number.isSafeInteger(size)&&size>=0)item.pageSize=size; } catch {}
    try { const rows=Array.from(ds.data()); item.loaded=rows.length; item.recordFields=rows.length&&rows[0]&&typeof rows[0]==='object'?Object.keys(rows[0]).map(cleanName).filter(Boolean).slice(0,100):[]; } catch {}
    item.modelFields = schema.model?.fields && typeof schema.model.fields === 'object' ? Object.entries(schema.model.fields).filter(([key])=>cleanName(key)).slice(0,100).map(([key,value])=>({name:key,type:describe(value?.type),nullable:value?.nullable===true})) : [];
    records.push(item);
    if(records.length>=120)break;
   }
   if(records.length>=120)break;
  }
 }
 const selects=[];
 for(const el of document.querySelectorAll('select')) {
  const id=cleanName(el.id),name=cleanName(el.name);
  if(!id&&!name)continue;
  const purpose=String(id||'')+' '+String(name||'');
  if(!/project|service|breakdown|account|chart|tax/i.test(purpose))continue;
  const identifiers=[...el.options].map(option=>option.value).filter(value=>/^(?:\d+|(?:b|ew|eow|boq)_[0-9]+)$/.test(value)).slice(0,200);
  selects.push({id,name,count:el.options.length,identifiers});
  if(selects.length>=40)break;
 }
 const scriptRoutes = [...new Set([...document.scripts].filter(script=>!script.src).flatMap(script=>routeHints(script.textContent)))].slice(0,120);
 return {path:route(location.pathname), navigation:navigation.slice(0,20), navigationPaths, widgets:records, selects, routeHints:scriptRoutes};
}"""


NATIVE_ROW_JS = r"""() => {
 const jq=window.jQuery||window.$;
 if(typeof jq!=='function')throw Error('Native grid unavailable');
 const flatten=columns=>columns.flatMap(column=>column.columns?flatten(column.columns):[column]);
 const grids=[...new Set([...document.querySelectorAll('[data-role="grid"],.k-grid')].map(el=>jq(el).data('kendoGrid')).filter(Boolean))].filter(grid=>flatten(grid.columns||[]).some(column=>column.field==='item_description')||Object.hasOwn(grid.dataSource?.options?.schema?.model?.fields||{},'item_description'));
 if(grids.length!==1)throw Error('Native line grid is missing or ambiguous');
 const grid=grids[0],rows=Array.from(grid.dataSource.data()||[]);
 if(rows.length!==1)throw Error('One native draft row is required');
 const row=typeof rows[0].toJSON==='function'?rows[0].toJSON():rows[0];
 const draftText=typeof row.id==='string'&&row.id.length<=160&&!/[\x00-\x1f\x7f]/.test(row.id)&&
  !(row.id.trim()&&Number.isFinite(Number(row.id)));
 if((row.id!==null&&row.id!==undefined&&!draftText)||row.is_new!==true||String(row.item_description||'').trim())throw Error('Native row is not a blank new line');
 const sensitive=/password|passwd|secret|token|csrf|cookie|authorization|session/i;
 const allocation={};
 for(const [name,value] of Object.entries(row)){
  if(sensitive.test(name))continue;
  const id=/(?:breakdown|budget|estimate|work|eow|assembly|category|job|chart_of_account|tax_rate|measure|currency)/i.test(name)&&/(?:_id|Id)$/.test(name);
  if(!id&&!['breakdown_type','is_new','currency_id','curr_alpha3','curr_rate'].includes(name))continue;
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^[A-Za-z0-9_.-]{0,80}$/.test(value))allocation[name]=value;
 }
 const formIdentities=[];
 for(const el of document.querySelectorAll('select,input')){
  const name=el.name||el.id||'';const value=String(el.value||'');
  if(!sensitive.test(name)&&/breakdown|element.?of.?work|eow/i.test(name)&&/^(?:[A-Za-z][A-Za-z0-9]*_)?[0-9]{1,20}$/.test(value))formIdentities.push({name:name.slice(0,160),value});
  if(formIdentities.length>=40)break;
 }
 return {blankNewLine:true,rowCount:1,draftId:{kind:row.id===null?'null':row.id===undefined?'missing':row.id===''?'empty_text':'native_draft_text',length:typeof row.id==='string'?row.id.length:null},fieldNames:Object.keys(row).filter(name=>!sensitive.test(name)).slice(0,180),allocationDefaults:allocation,formIdentities,columns:flatten(grid.columns||[]).filter(column=>typeof column.field==='string'&&!sensitive.test(column.field)).map(column=>({field:column.field,hidden:column.hidden===true,editable:typeof column.editable==='boolean'?column.editable:null,...(/breakdown|element|eow|budget|assembly|category/i.test(column.field)&&typeof column.title==='string'?{allocationTitle:column.title.replace(/<[^>]*>/g,'').trim().slice(0,120)}:{})})).slice(0,120)};
}"""

NATIVE_ADD_JS = r"""() => {
 const jq=window.jQuery||window.$;
 if(typeof jq!=='function')throw Error('Native grid unavailable');
 const flatten=columns=>columns.flatMap(column=>column.columns?flatten(column.columns):[column]);
 const grids=[...new Set([...document.querySelectorAll('[data-role="grid"],.k-grid')].map(el=>jq(el).data('kendoGrid')).filter(Boolean))].filter(grid=>flatten(grid.columns||[]).some(column=>column.field==='item_description')||Object.hasOwn(grid.dataSource?.options?.schema?.model?.fields||{},'item_description'));
 if(grids.length!==1||Array.from(grids[0].dataSource.data()||[]).length!==0)throw Error('New native grid must be empty');
 const field=document.querySelector('[name="form[Lines]"]');
 const raw=field?field.value.trim():null;
 let serialized;try{serialized=raw?JSON.parse(raw):null;}catch{throw Error('New form must contain no saved lines');}
 if(!field||(serialized!==null&&(!Array.isArray(serialized)||serialized.length!==0)))throw Error('New form must contain no saved lines');
 const candidates=[...document.querySelectorAll('a,button,td,div,span')].filter(el=>el.getClientRects().length&&/Click\s+To\s+Add\s+New\s+Row\s*$/i.test((el.textContent||'').replace(/\s+/g,' ').trim())).sort((a,b)=>(a.textContent||'').length-(b.textContent||'').length);
 if(!candidates.length)throw Error('Native Add row control unavailable');
 const target=candidates[0].closest('td')||candidates[0];
 target.scrollIntoView({block:'center'});
 target.click();
 return true;
}"""

NATIVE_CONTROLS_JS = r"""() => {
 const jq=window.jQuery||window.$;
 const sensitive=/password|passwd|secret|token|csrf|cookie|authorization|session/i;
 const flatten=columns=>columns.flatMap(column=>column.columns?flatten(column.columns):[column]);
 const grids=typeof jq==='function'?[...new Set([...document.querySelectorAll('[data-role="grid"],.k-grid')].map(el=>jq(el).data('kendoGrid')).filter(Boolean))]:[];
 const fields=[...document.querySelectorAll('[name="form[Lines]"]')];
 const shape=field=>{if(!field.value.trim())return 'empty_string';try{const v=JSON.parse(field.value);return Array.isArray(v)?v.length?'nonempty_array':'empty_array':v===null?'null':'nonarray';}catch{return 'invalid_json';}};
 const candidates=[...document.querySelectorAll('a,button,td,div,span')].filter(el=>/Click\s+To\s+Add\s+New\s+Row\s*$/i.test((el.textContent||'').replace(/\s+/g,' ').trim()));
 return {linesFields:fields.map(field=>({shape:shape(field),inForm:!!field.form})),
  nativeAddMatches:candidates.length,visibleNativeAddMatches:candidates.filter(el=>el.getClientRects().length).length,
  grids:grids.map(grid=>{const rows=Array.from(grid.dataSource?.data()||[]),model=grid.dataSource?.options?.schema?.model;
   return {id:typeof grid.element?.attr==='function'?grid.element.attr('id'):null,
    hasItemDescriptionModel:!!model?.fields&&Object.hasOwn(model.fields,'item_description'),
    rowCount:rows.length,columns:flatten(grid.columns||[]).filter(c=>typeof c.field==='string'&&!sensitive.test(c.field)).map(c=>({field:c.field,hidden:c.hidden===true,locked:c.locked===true})).slice(0,100),
    blankRowStates:rows.slice(0,2).map(row=>({idKind:row.id===null?'null':/^\d+$/.test(String(row.id))?'numeric':typeof row.id,isNewType:typeof row.is_new,isNew:row.is_new===true,descriptionBlank:!String(row.item_description||'').trim()}))};}).slice(0,8)};
}"""

EDIT_LOOKUP_JS = r"""field => {
 const jq=window.jQuery||window.$;
 const flatten=columns=>columns.flatMap(column=>column.columns?flatten(column.columns):[column]);
 const grids=[...new Set([...document.querySelectorAll('[data-role="grid"],.k-grid')].map(el=>jq(el).data('kendoGrid')).filter(Boolean))].filter(grid=>flatten(grid.columns||[]).some(column=>column.field==='item_description')||Object.hasOwn(grid.dataSource?.options?.schema?.model?.fields||{},'item_description'));
 if(grids.length!==1)return false;
 const grid=grids[0],columns=flatten(grid.columns||[]);
 const exact=columns.findIndex(column=>column.hidden!==true&&column.field===field);
 const index=exact>=0?exact:columns.findIndex(column=>column.hidden!==true&&
  (field==='chart_of_account_id'?/^(?:acct\s*#|account)$/i:field==='tax_rate_id'?/^tax$/i:/^measure$/i).test(String(column.title||'').replace(/<[^>]*>/g,'').trim()));
 if(index<0)return false;
 const rows=Array.from(grid.dataSource.data()||[]);if(rows.length!==1)return false;
 const tr=grid.tbody.find('tr[data-uid]').first(),cell=tr.children('td').eq(index);
 if(!cell.length)return false;
 grid.editCell(cell);return true;
}"""

IDENTITY_CHOICES_JS = r"""field => {
 const jq=window.jQuery||window.$,out=[];
 if(typeof jq!=='function')return out;
 const wanted=field==='job_name'?['job_name','job_id','default_job_id']:['breakdown_type'];
 const id=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0||typeof value==='string'&&/^(?:[A-Za-z][A-Za-z0-9]*_)?[0-9]{1,20}$/.test(value);
 for(const el of document.querySelectorAll('input,select')){
  if(!wanted.includes(el.name))continue;
  const data=jq(el).data()||{};
  for(const kind of ['kendoComboBox','kendoDropDownList','kendoMultiSelect']){
   const widget=data[kind],ds=widget?.dataSource;if(!ds)continue;
   const valueField=widget.options?.dataValueField||'id',rows=Array.from(ds.data()||[]);
   const choices=rows.slice(0,500).map(row=>{
    const raw=typeof row.toJSON==='function'?row.toJSON():row,choice={};
    for(const [key,value] of Object.entries(raw)){
     if((key===valueField&&['id','value','key'].includes(key)||/^(?:id|job_id|default_job_id|project_id|project_page_id|budget_item_id|budget_item_category_id|assembly_id|project_assembly_id|breakdown_type)$/.test(key))&&id(value))choice[key]=value;
    }
    return choice;
   }).filter(row=>Object.keys(row).length);
   out.push({name:el.name,kind,valueField,loaded:rows.length,total:Number.isSafeInteger(ds.total())?ds.total():null,serverPaging:ds.options?.serverPaging===true,serverFiltering:ds.options?.serverFiltering===true,choices});
  }
 }
 return out;
}"""


class ModalServices(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.option = None
        self.identifiers = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "select":
            self.active = attributes.get("id") == "form_Service"
        elif tag == "option" and self.active:
            self.option = attributes.get("value") if "disabled" not in attributes else None

    def handle_endtag(self, tag):
        if tag == "option" and self.option is not None:
            if re.fullmatch(r"[0-9]+", self.option) and int(self.option) > 0:
                self.identifiers.append(self.option)
            self.option = None
        elif tag == "select":
            self.active = False


def modal_identifiers(source):
    parser = ModalServices()
    parser.feed(source)
    target = re.search(
        r'<select\b[^>]*\bid=["\']form_BreakdownType["\'][^>]*>.*?</select>\s*</div>\s*<script\b[^>]*>(.*?)</script>',
        source, re.DOTALL | re.IGNORECASE,
    )
    choices = []
    if target:
        decoder = json.JSONDecoder()
        for match in re.finditer(r"var\s+options\s*=\s*", target.group(1)):
            try:
                options, _ = decoder.raw_decode(target.group(1)[match.end():])
                values = options.get("choices")
                if isinstance(values, list):
                    choices = [str(row["id"]) for row in values
                               if isinstance(row, dict) and row.get("disabled") is not True
                               and re.fullmatch(r"(?:[A-Za-z][A-Za-z0-9]*_)?[0-9]+", str(row.get("id", "")))]
                    if choices:
                        break
            except (ValueError, AttributeError):
                continue
    if not parser.identifiers or not choices:
        raise ValueError("Native service/EOW choices could not be read")
    return list(dict.fromkeys(parser.identifiers)), list(dict.fromkeys(choices))


def representative_choices(identifiers):
    chosen = []
    if "b_70" in identifiers:
        chosen.append("b_70")
    families = set()
    for identifier in identifiers:
        family = identifier.split("_", 1)[0] if "_" in identifier else "numeric"
        if family not in families:
            families.add(family)
            if identifier not in chosen:
                chosen.append(identifier)
    return chosen[:5]


def native_catalog(context, project):
    modal_path = (
        f"/staff/project-purchase-order-new-modal/{project}/Assembly"
        "?force=false&hide_service=false&hide_client=false"
        "&callback=Modals.newPurchaseOrderCallback"
    )
    response = context.request.get(ORIGIN + modal_path,
                                   headers={"X-Requested-With":"XMLHttpRequest", "Accept":"application/json"},
                                   max_redirects=0, timeout=30000)
    if response.status != 200:
        raise ValueError("Native modal is unavailable")
    value = response.json()
    if value.get("_success") is not True or not isinstance(value.get("_html"), str):
        raise ValueError("Native modal did not return expected JSON")
    services, breakdowns = modal_identifiers(value["_html"])
    # This is the existing, demonstrated read-only directory search endpoint.
    # Its POST body contains only an empty search term, never a PO action.
    response = context.request.post(
        ORIGIN + f"/staff/project/contractors/{project}",
        form={"q":""}, headers={"X-Requested-With":"XMLHttpRequest", "Accept":"application/json"},
        max_redirects=0, timeout=30000,
    )
    if response.status != 200:
        raise ValueError("Native supplier lookup is unavailable")
    suppliers = response.json()
    if suppliers.get("_success") is not True or not isinstance(suppliers.get("_resp"), list):
        raise ValueError("Native supplier lookup did not return expected JSON")
    eligible = [str(row["id"]) for row in suppliers["_resp"]
                if isinstance(row, dict) and row.get("can_create_po") is True
                and re.fullmatch(r"[0-9]+", str(row.get("id", ""))) and int(row["id"]) > 0]
    if not eligible:
        raise ValueError("No eligible supplier was returned for this read-only probe")
    return {"serviceIds":services, "breakdownIds":breakdowns,
            "eligibleSupplierId":"225" if "225" in eligible else eligible[0]}


PROJECT_PAGING_JS = r"""() => {
 const ids=new Set(),paging=[];
 for(const a of document.querySelectorAll('a[href]')){
  let url;try{url=new URL(a.getAttribute('href'),location.origin);}catch{continue;}
  if(url.origin!==location.origin)continue;
  const match=url.pathname.match(/^\/staff\/project\/([0-9]+)\/modify\/?$/);
  if(match)ids.add(Number(match[1]));
  if(url.pathname==='/staff/projects'&&url.search){
   const names=[...url.searchParams.keys()].filter(name=>!/token|secret|csrf|password|session/i.test(name));
   const numeric={};for(const name of names){const value=url.searchParams.get(name);if(/^(?:page|p|offset|skip|take|limit|per_page|page_size|pagesize)$/i.test(name)&&/^\d{1,7}$/.test(value))numeric[name]=Number(value);}
   if(paging.length<50)paging.push({path:url.pathname,parameterNames:names.slice(0,20),numericPaging:numeric,rel:a.getAttribute('rel')||'',disabled:a.getAttribute('aria-disabled')==='true'});
  }
 }
 return {loadedProjectIds:[...ids].sort((a,b)=>a-b).slice(0,5000),projectLinkCount:ids.size,pagination:paging,documentScrollable:document.documentElement.scrollHeight>innerHeight+50,hasInfiniteScrollMarker:!!document.querySelector('[data-infinite-scroll],[infinite-scroll],.infinite-scroll,.infinite-loading,.pagination,.pager')};
}"""


def native_samples(context, project, report):
    try:
        catalog = native_catalog(context, project)
    except Exception:
        return {"projectPageId":project, "inspection":"native_catalog_unavailable"}
    service = "8" if "8" in catalog["serviceIds"] else catalog["serviceIds"][0]
    supplier = catalog["eligibleSupplierId"]
    output = {"projectPageId":project, "serviceIds":catalog["serviceIds"],
              "breakdownIds":catalog["breakdownIds"], "samples":[]}
    # Existing demonstrated project/job mapping source. Export only IDs; do
    # not infer a job from a nullable model declaration or an EOW suffix.
    try:
        response = context.request.get(ORIGIN + f"/staff/project/{project}/modify",
                                       max_redirects=0, timeout=30000)
        if response.status == 200:
            source = response.text()
            if len(source) <= 8 * 1024 * 1024:
                output["projectJobIds"] = sorted({int(value) for value in re.findall(
                    r"/staff/log/custom/job/([0-9]+)", source)})
    except Exception:
        output["projectJobMapping"] = "unavailable"
    for breakdown in representative_choices(catalog["breakdownIds"]):
        page = context.new_page()
        path = f"/staff/project-purchase-order-add/{project}"
        sample = {"breakdownType":breakdown, "serviceId":service, "supplierId":supplier,
                  "path":path, "inspection":"unavailable"}
        def guard(route):
            method = route.request.method.upper()
            if method in ALLOWED_METHODS:
                route.continue_()
            else:
                blocked = {"method":method, "path":safe_path(route.request.url)}
                if blocked not in report["blockedMethods"]:
                    report["blockedMethods"].append(blocked)
                route.abort()
        page.route("**/*", guard)
        stage = "open_native_form"
        try:
            response = page.goto(ORIGIN + path + "?" + urlencode({
                "type":"Assembly", "service":service, "client":supplier,
                "breakdown_type":breakdown,
            }), wait_until="domcontentloaded", timeout=45000)
            if not response or response.status != 200 or safe_path(page.url) != path:
                sample["inspection"] = "unavailable_or_redirected"
                continue
            stage = "wait_lines_field"
            page.locator('[name="form[Lines]"]').wait_for(state="attached", timeout=15000)
            stage = "read_initial_metadata"
            sample["initialMetadata"] = page.evaluate(METADATA_JS)
            sample["controlsBeforeAdd"] = page.evaluate(NATIVE_CONTROLS_JS)
            stage = "native_add_guard_and_click"
            page.evaluate(NATIVE_ADD_JS)
            stage = "wait_native_blank_row"
            page.wait_for_function("() => {try{return ("+NATIVE_ROW_JS+")().blankNewLine===true;}catch{return false;}}", timeout=5000)
            stage = "capture_native_blank_row"
            sample["nativeRow"] = page.evaluate(NATIVE_ROW_JS)
            sample["inspection"] = "native_blank_row_captured"
            sample["editorMetadata"] = []
            baseline_widgets = {(item.get("kind"),item.get("id"),item.get("name"))
                                for item in sample["initialMetadata"].get("widgets", [])}
            for field in ["chart_of_account_id", "tax_rate_id", "measure_id", "job_name", "breakdown_type"]:
                stage = "inspect_" + field
                try:
                    if page.evaluate(EDIT_LOOKUP_JS, field):
                        page.wait_for_timeout(500)
                        metadata = page.evaluate(METADATA_JS)
                        widgets = [item for item in metadata.get("widgets", [])
                                   if (item.get("kind"),item.get("id"),item.get("name")) not in baseline_widgets
                                   or field.replace("_", "").lower() in ((item.get("name") or "")+(item.get("id") or "")).replace("_", "").lower()]
                        evidence = {"field":field,"widgets":widgets}
                        if field in ("job_name", "breakdown_type"):
                            evidence["identityChoices"] = page.evaluate(IDENTITY_CHOICES_JS, field)
                        sample["editorMetadata"].append(evidence)
                    else:
                        sample["editorMetadata"].append({"field":field,"inspection":"editable_column_unavailable"})
                except Exception:
                    sample["editorMetadata"].append({"field":field,"inspection":"editor_unavailable"})
        except Exception as error:
            sample["failureStage"] = stage
            # Only fixed messages from our own guards are exported. Playwright
            # exceptions can include page content, so never include raw text.
            known = {"Native grid unavailable":"grid_unavailable",
                     "New native grid must be empty":"grid_not_unique_or_not_empty",
                     "New form must contain no saved lines":"serialized_lines_not_empty_array",
                     "Native Add row control unavailable":"native_add_control_missing"}
            sample["failureCode"] = next((code for message, code in known.items()
                                            if message in str(error)), "native_capture_incomplete")
            sample["inspection"] = ("native_blank_row_captured_editor_unavailable"
                                    if "nativeRow" in sample else "native_blank_row_not_observed")
        finally:
            try:
                sample["controlsAfterAdd"] = page.evaluate(NATIVE_CONTROLS_JS)
            except Exception:
                pass
            output["samples"].append(sample)
            page.close()
    return output


def atomic_report(path, value):
    encoded = json.dumps(value, indent=2, ensure_ascii=True, allow_nan=False).encode()
    if len(encoded) > MAX_REPORT_BYTES:
        raise ValueError("Discovery report exceeds its bounded size; nothing replaced")
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-discovery-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def inspect_browser(browser, project=60, additional_projects=()):
    pages = [page for context in browser.contexts for page in context.pages
             if safe_path(page.url) and "/login" not in urlsplit(page.url).path]
    if not pages:
        raise ValueError("Sign into Nexvia in the existing NAS browser first")
    report = {"format":"nexvia-live-discovery", "version":3,
              "capturedAt":datetime.now(timezone.utc).isoformat(),
              "readOnly":True, "pages":[], "blockedMethods":[]}
    nav = [{"kind":"projects", "path":"/staff/projects"}]
    for page in pages[:6]:
        data = page.evaluate(METADATA_JS)
        if data.get("path") == "/staff/projects":
            data["projectPaging"] = page.evaluate(PROJECT_PAGING_JS)
        report["pages"].append(data)
        nav.extend(data.get("navigation", []))
    inspected = {item.get("path") for item in report["pages"]}
    # Only open paths discovered from the authenticated application's own links.
    for link in nav[:12]:
        path = safe_path(link.get("path"))
        if not path or path in inspected:
            continue
        # Native data grids may need a read-only POST. Capture that endpoint as
        # evidence, but do not allow it until its read contract is established.
        context = pages[0].context
        page = context.new_page()
        def guard(route):
            method = route.request.method.upper()
            if method in ALLOWED_METHODS:
                route.continue_()
            else:
                blocked = {"method":method, "path":safe_path(route.request.url)}
                if blocked not in report["blockedMethods"]:
                    report["blockedMethods"].append(blocked)
                route.abort()
        page.route("**/*", guard)
        try:
            response = page.goto(ORIGIN + path, wait_until="domcontentloaded", timeout=30000)
            if not response or response.status != 200 or safe_path(page.url) != path:
                report["pages"].append({"path":path, "inspection":"unavailable_or_redirected"})
                continue
            page.wait_for_timeout(1000)
            data = page.evaluate(METADATA_JS)
            data["navigationKind"] = link.get("kind")
            if path == "/staff/projects":
                data["projectPaging"] = page.evaluate(PROJECT_PAGING_JS)
            report["pages"].append(data)
            inspected.add(path)
        except Exception:
            report["pages"].append({"path":path, "inspection":"unavailable"})
        finally:
            page.close()
    report["nativeForms"] = native_samples(pages[0].context, project, report)
    if additional_projects:
        report["additionalNativeForms"] = [native_samples(pages[0].context, value, report)
                                          for value in additional_projects if value != project]
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--project", type=int, default=60)
    parser.add_argument("--also-project", type=int, action="append", default=[],
                        help="Inspect another accessible project's native EOWs (maximum two)")
    args = parser.parse_args()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=15000)
        if args.project < 1 or len(args.also_project) > 2 or any(value < 1 for value in args.also_project):
            raise ValueError("Choose a positive project page ID")
        report = inspect_browser(browser, args.project, list(dict.fromkeys(args.also_project)))
    atomic_report(args.output, report)
    print("Read-only Nexvia discovery saved:", args.output)
    print("Page metadata records:", len(report["pages"]))
    print("No PO was created or changed. No credentials or customer records were exported.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Discovery could not finish. Check the NAS Nexvia sign-in; no report was replaced.")
