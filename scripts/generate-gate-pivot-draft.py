#!/usr/bin/env python3
"""Build the synthetic PivotTable comparison. Requires openpyxl, lxml and soffice.
The published artifact contains no macros, external connections or production data.
"""
from pathlib import Path
import subprocess,tempfile
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='gate-pivot-') as folder:
 work=Path(folder)
 sample=subprocess.check_output(['node','--input-type=module','-e',"import {gateProgressSample} from './worker/src/gate-progress-sample.js'; process.stdout.write(JSON.stringify(gateProgressSample().orders));"],cwd=ROOT)
 (work/'sample.json').write_bytes(sample)
 import json
 from openpyxl import Workbook
 from openpyxl.pivot.table import TableDefinition,Location,PivotField,FieldItem,RowColField,RowColItem,DataField
 from openpyxl.pivot.cache import CacheDefinition,CacheSource,WorksheetSource,CacheField,SharedItems
 from openpyxl.pivot.record import Record,RecordList
 from openpyxl.pivot.fields import Text,Number,Index
 from openpyxl.styles import Font,PatternFill,Alignment
 from openpyxl.formatting.rule import CellIsRule
 orders=json.load(open(work/'sample.json'))
 stages=['Drawn','Scheduled for production','Fabricated/QA','Ready for dispatch','Dispatched','Delivered'];headers=['Project','Villa','Order','Set','Component']+[s+' value' for s in stages];rows=[]
 for o in orders:
  for c in o['components']:
   rows.append([o['project'],'Villa '+o['villa'],f"Order {o['orderNumber']} — {o['orderType']} · {o['areaM2']} m²",f"Set {c['set']}",c['label'],1,int(o['scheduledForProduction']),int(c['qaStatus']=='approved'),int(c['qaStatus']=='approved' and bool(c['ready'] or c['shipment'])),int(bool(c['shipment'])),int(bool(c['delivery']))])
 wb=Workbook();out=wb.active;out.title='Gate Progress Pivot';data=wb.create_sheet('Component Data');data.append(headers)
 for row in rows:data.append(row)
 items=[];cachefields=[]
 for i,name in enumerate(headers):
  values=list(dict.fromkeys(row[i] for row in rows));items.append(values)
  cachefields.append(CacheField(name=name,sharedItems=SharedItems(_fields=[Text(v=v) if isinstance(v,str) else Number(v=v) for v in values],containsString=i<5,containsNumber=i>=5,containsInteger=i>=5,containsNonDate=True,containsSemiMixedTypes=False)))
 cache=CacheDefinition(cacheSource=CacheSource(type='worksheet',worksheetSource=WorksheetSource(ref=f'A1:K{len(rows)+1}',sheet=data.title)),cacheFields=cachefields,recordCount=len(rows),saveData=True,refreshOnLoad=True,enableRefresh=True,createdVersion=6,refreshedVersion=6,minRefreshableVersion=3)
 cache.records=RecordList(r=[Record(_fields=[Index(v=items[i].index(value)) for i,value in enumerate(row)]) for row in rows])
 fmt='[=1]"✓";[=0]"-";General';out['F5'].number_format=fmt
 fields=[PivotField(axis='axisRow',items=[FieldItem(x=j,sd=True) for j in range(len(items[i]))]+([FieldItem(t='default')] if i in [2,3] else []),compact=False,outline=True,subtotalTop=True,defaultSubtotal=i in [2,3],showAll=False) for i in range(5)]+[PivotField(dataField=True,showAll=False) for i in range(5,11)]
 pivot=TableDefinition(name='GateProgressPivot',cacheId=1,dataCaption='Stages',rowHeaderCaption='Gate / component',compact=False,outline=True,compactData=False,indent=0,showDrill=True,enableDrill=True,rowGrandTotals=False,colGrandTotals=False,showHeaders=True,preserveFormatting=True,applyNumberFormats=True,location=Location(ref='A4:K5',firstHeaderRow=1,firstDataRow=1,firstDataCol=5),pivotFields=fields,rowFields=[RowColField(x=i) for i in range(5)],colFields=[RowColField(x=-2)],colItems=[RowColItem(i=i,x=[Index(v=i)]) for i in range(6)],dataFields=[DataField(name=name,fld=i+5,subtotal='min',numFmtId=164) for i,name in enumerate(stages)])
 pivot.cache=cache;out.add_pivot(pivot)
 out['A1']='GATE PROGRESS · PIVOTTABLE DRAFT';out['A2']='SAMPLE DATA · Use the +/− buttons beside labels to collapse groups.'
 for cell in out[4]:cell.font=Font(bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='176078')
 for col,width in [('A',28),('B',16),('C',48),('D',12),('E',22)]:out.column_dimensions[col].width=width
 for col in 'FGHIJK':out.column_dimensions[col].width=12
 for row in out.iter_rows(min_row=5,max_row=100,min_col=6,max_col=11):
  for cell in row:cell.number_format=fmt;cell.alignment=Alignment(horizontal='center')
 out.conditional_formatting.add('F5:K100',CellIsRule(operator='equal',formula=['1'],fill=PatternFill('solid',fgColor='8CE28C')))
 out.conditional_formatting.add('F5:K100',CellIsRule(operator='equal',formula=['0'],fill=PatternFill('solid',fgColor='FFFF99')))
 out.freeze_panes='F5';wb.save(work/'input.xlsx')

 (work/'converted').mkdir()
 subprocess.run(['soffice','--headless','--convert-to','xlsx','--outdir',str(work/'converted'),str(work/'input.xlsx')],check=True,timeout=60)
 from pathlib import Path
 import json,re
 from zipfile import ZipFile,ZIP_DEFLATED
 from lxml import etree as E
 from openpyxl import load_workbook
 base=ROOT;reference=work/'converted/input.xlsx';dest=base/'artifacts/GATE_PROGRESS_PIVOT_DRAFT.xlsx';ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';pkg='http://schemas.openxmlformats.org/package/2006/relationships';types='http://schemas.openxmlformats.org/package/2006/content-types'
 orders=json.loads((work/'sample.json').read_text());w=load_workbook(reference,data_only=True);main=[list(row[:11]) for row in w.worksheets[0].values][:int(re.search(r'[A-Z]+(\d+)$',w.worksheets[0]._pivots[0].location.ref).group(1))];main[0][0]='GATE PROGRESS · PIVOTTABLE DRAFT';main[1][0]='SAMPLE DATA · Use the +/− controls beside the row labels to collapse groups.';main[3][5]='Stages'
 source=[list(row[:11]) for row in w.worksheets[1].values]
 with ZipFile(reference) as z:parts={name:z.read(name) for name in z.namelist() if name.startswith('xl/pivot')}
 with ZipFile(base/'artifacts/GATE_PROGRESS_DRAFT.xlsx') as z:style=E.fromstring(z.read('xl/styles.xml'))
 q=lambda tag:'{'+ns+'}'+tag
 num=style.find(q('numFmts'));E.SubElement(num,q('numFmt'),numFmtId='165',formatCode='[=1]"✓";[=0]"-";General');num.set('count',str(len(num)))
 xfs=style.find(q('cellXfs'));xf=E.SubElement(xfs,q('xf'),numFmtId='165',fontId='0',fillId='0',borderId='0',xfId='0',applyAlignment='1',applyNumberFormat='1');E.SubElement(xf,q('alignment'),horizontal='center',vertical='center',wrapText='0');xfs.set('count',str(len(xfs)))
 dx=E.SubElement(style,q('dxfs'),count='2')
 for color in ['FF8CE28C','FFFFFF99']:
  d=E.SubElement(dx,q('dxf'));f=E.SubElement(d,q('fill'));p=E.SubElement(f,q('patternFill'),patternType='solid');E.SubElement(p,q('fgColor'),rgb=color);E.SubElement(p,q('bgColor'),rgb=color)
 parts['xl/styles.xml']=E.tostring(style)
 root=E.fromstring(parts['xl/pivotTables/pivotTable1.xml']);root.set('dataCaption','Stages');root.set('preserveFormatting','1');root.set('applyNumberFormats','1');root.set('enableDrill','1');root.set('rowGrandTotals','0');root.set('colGrandTotals','0');root.set('showDrill','1');root.set('indent','0')
 for datafield in root.find(q('dataFields')):datafield.set('numFmtId','165')
 parts['xl/pivotTables/pivotTable1.xml']=E.tostring(root)
 cache=E.fromstring(parts['xl/pivotCache/pivotCacheDefinition1.xml']);[field.set('numFmtId','165') for field in list(cache.find(q('cacheFields')))[5:]];cache.set('saveData','1');cache.set('refreshOnLoad','0');cache.set('enableRefresh','1');parts['xl/pivotCache/pivotCacheDefinition1.xml']=E.tostring(cache)
 def letter(index):
  result=''
  while index:index,remainder=divmod(index-1,26);result=chr(65+remainder)+result
  return result
 def sheet(rows,widths,main=False,componentData=False):
  r=E.Element(q('worksheet'),nsmap={None:ns});pr=E.SubElement(r,q('sheetPr'));E.SubElement(pr,q('pageSetUpPr'),fitToPage='1');E.SubElement(r,q('dimension'),ref=f'A1:{letter(len(widths))}{len(rows)}');sv=E.SubElement(r,q('sheetViews'));v=E.SubElement(sv,q('sheetView'),workbookViewId='0',showGridLines='0')
  if main:E.SubElement(v,q('pane'),ySplit='5',topLeftCell='A6',activePane='bottomLeft',state='frozen')
  E.SubElement(r,q('sheetFormatPr'),defaultRowHeight='23');cols=E.SubElement(r,q('cols'))
  for i,width in enumerate(widths,1):E.SubElement(cols,q('col'),min=str(i),max=str(i),width=str(width),customWidth='1')
  body=E.SubElement(r,q('sheetData'))
  for ri,values in enumerate(rows,1):
   height=44 if main and ri==5 else 32 if ri==1 else 25 if ri==2 else 24
   row=E.SubElement(body,q('row'),r=str(ri),ht=str(height),customHeight='1')
   role=''
   if main and ri>=6:role='project' if values[0] else 'villa' if values[1] else 'order' if values[2] else 'set' if values[3] else 'component'
   for ci,value in enumerate(values,1):
    if main:
     st=1 if ri==1 or ri==5 else 3 if ri==2 or ri==4 else 2 if role in ['project','villa'] else 3 if role=='order' else 4 if role=='set' else 0
     if ri==5 and ci>=6:st=1
     if ri>=6 and ci>=6 and isinstance(value,(int,float)):st=14
    else:st=1 if ri==1 else 14 if componentData and ci>=6 and isinstance(value,(int,float)) else 5 if isinstance(value,(int,float)) else 0
    if value is None:continue
    c=E.SubElement(row,q('c'),r=f'{letter(ci)}{ri}',s=str(st),t='n' if isinstance(value,(int,float)) else 'inlineStr')
    if isinstance(value,(int,float)):E.SubElement(c,q('v')).text=str(value)
    else:E.SubElement(E.SubElement(c,q('is')),q('t')).text=str(value)
  if main:
   merges=E.SubElement(r,q('mergeCells'),count='2')
   for ref in ['A1:K1','A2:K2']:E.SubElement(merges,q('mergeCell'),ref=ref)
   cf=E.SubElement(r,q('conditionalFormatting'),sqref=f'F6:K{len(rows)}')
   for index,val in enumerate([1,0]):rule=E.SubElement(cf,q('cfRule'),type='expression',dxfId=str(index),priority=str(index+1));E.SubElement(rule,q('formula')).text=f'AND(ISNUMBER(F6),F6={val})'
  E.SubElement(r,q('pageMargins'),left='0.25',right='0.25',top='0.5',bottom='0.5',header='0.25',footer='0.25');E.SubElement(r,q('pageSetup'),orientation='landscape',paperSize='9',fitToWidth='1',fitToHeight='0')
  return E.tostring(r)
 parts['xl/worksheets/sheet1.xml']=sheet(main,[24,14,46,12,20,12,22,16,20,12,12],True)
 parts['xl/worksheets/sheet2.xml']=sheet(source,[28,16,48,12,22]+[20]*6,componentData=True)
 areas=[['Project','Villa','Order','Gate type','Order area (m²)']]+[[o['project'],o['villa'],str(o['orderNumber']),o['orderType'],o['areaM2']] for o in orders]+[['Total order area','','','',sum(o['areaM2'] for o in orders)]]
 parts['xl/worksheets/sheet3.xml']=sheet(areas,[28,16,12,24,22])
 guide=[['Gate Progress · PivotTable comparison draft'],['This workbook contains synthetic sample data only.'],['Use the native +/− buttons beside Project, Villa, Order and Set labels to expand or collapse inside the sheet.'],['If Excel opens in Protected View, enable editing to try the PivotTable controls. No macros are included or required.'],['Project and Villa headings have no stage totals. Orders and sets show a tick only when every required component is complete.'],['Stages use the minimum of per-component 0/1 completion values; a pending part keeps its parent pending.'],['m² remains on the whole order. It is shown in the order label and once in the Order Areas tab; it is never divided among parts.'],['The Component Data tab is the internal PivotTable cache source. It is hidden for this layout preview and can be unhidden in Excel.'],['This is a static comparison draft. Refresh in Excel only rereads the included sample data, not PanelStockHQ.'],['Your current Gate Progress workbook and the live website are unchanged by this comparison download.']]
 parts['xl/worksheets/sheet4.xml']=sheet(guide,[145])
 parts['xl/worksheets/_rels/sheet1.xml.rels']=f'<Relationships xmlns="{pkg}"><Relationship Id="rIdPivot" Type="{rel}/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>'.encode()
 parts['xl/workbook.xml']=f'<workbook xmlns="{ns}" xmlns:r="{rel}"><bookViews><workbookView/></bookViews><sheets><sheet name="Gate Progress Pivot" sheetId="1" r:id="rId1"/><sheet name="Component Data" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Order Areas" sheetId="3" r:id="rId3"/><sheet name="Read Me" sheetId="4" r:id="rId4"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">&apos;Gate Progress Pivot&apos;!$A$1:$K${len(main)}</definedName></definedNames><pivotCaches><pivotCache cacheId="1" r:id="rIdCache"/></pivotCaches></workbook>'.encode()
 parts['xl/_rels/workbook.xml.rels']=(f'<Relationships xmlns="{pkg}">'+''.join(f'<Relationship Id="rId{i}" Type="{rel}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,5))+f'<Relationship Id="rIdStyle" Type="{rel}/styles" Target="styles.xml"/><Relationship Id="rIdCache" Type="{rel}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>').encode()
 parts['_rels/.rels']=f'<Relationships xmlns="{pkg}"><Relationship Id="rIdWorkbook" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>'.encode()
 overrides={'/xl/workbook.xml':'sheet.main','/xl/styles.xml':'styles','/xl/pivotTables/pivotTable1.xml':'pivotTable','/xl/pivotCache/pivotCacheDefinition1.xml':'pivotCacheDefinition','/xl/pivotCache/pivotCacheRecords1.xml':'pivotCacheRecords',**{f'/xl/worksheets/sheet{i}.xml':'worksheet' for i in range(1,5)}}
 parts['[Content_Types].xml']=(f'<Types xmlns="{types}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join(f'<Override PartName="{name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.{typ}+xml"/>' for name,typ in overrides.items())+'</Types>').encode()
 with ZipFile(dest,'w',ZIP_DEFLATED) as z:
  for name,data in parts.items():z.writestr(name,data)
 print(dest)
