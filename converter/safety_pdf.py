"""Find text-based SWMS sign-off tables; never guess placements in unreadable PDFs."""
import io
import re
from statistics import median
import pdfplumber
from pdfplumber.utils import rect_to_edges

SCANNER_VERSION="shaded-signoff-v3"


def _group(values, tolerance=1):
    result=[]
    for value in sorted(values):
        if not result or value-result[-1]>tolerance: result.append(round(value,2))
    return result


def _columns(rules, headings, mid):
    xs=_group(e['x0'] for e in rules if abs(e['x0']-e['x1'])<.6 and e['top']<mid<e['bottom'])
    columns={}
    for key,word in headings.items():
        centre=(word['x0']+word['x1'])/2
        pair=next(((a,b) for a,b in zip(xs,xs[1:]) if a<centre<b),None)
        if not pair: return None
        columns[key]=[round(pair[0],2),round(pair[1]-pair[0],2)]
    values=list(columns.values())
    if len({tuple(v) for v in values})!=7 or any(abs(a[0]+a[1]-b[0])>1 for a,b in zip(values,values[1:])): return None
    return columns


def _boundaries(rules, column):
    mid=column[0]+column[1]/2
    return _group(e['top'] for e in rules if abs(e['top']-e['bottom'])<.6 and e['x0']<mid<e['x1'])


def _licences(rules, columns, top, bottom):
    internal=[[y for y in _boundaries(rules,columns[key]) if top+1<y<bottom-1] for key in ('type','class','number')]
    if any(len(v)!=2 for v in internal) or any(abs(a-b)>1 for values in internal[1:] for a,b in zip(internal[0],values)): return None
    edges=[top,*internal[0],bottom]
    if min(b-a for a,b in zip(edges,edges[1:]))<5: return None
    return [{'top':round(a,2),'height':round(b-a,2)} for a,b in zip(edges,edges[1:])]


def _table(rules, headings, cards):
    header_bottom=max(w['bottom'] for w in headings.values())
    if cards:
        samples=[(cards[0]['top']+cards[0]['bottom'])/2]
    else:
        # Blank modern forms have no Construction Card text. Find complete rows
        # below all seven headings; thin/thick header rules are not worker rows.
        boundaries=_boundaries(rules,[headings['name']['x0'],headings['name']['x1']-headings['name']['x0']])
        samples=[(a+b)/2 for a,b in zip(boundaries,boundaries[1:]) if a>header_bottom and 24<=round(b-a,2)<80]
    for mid in samples:
        columns=_columns(rules,headings,mid)
        if not columns: continue
        boundaries=_boundaries(rules,columns['name']);rows=[]
        if cards:
            for card in cards:
                top=next((y for y in reversed(boundaries) if header_bottom<y<card['top']),None)
                bottom=next((y for y in boundaries if y>card['bottom']),None)
                if top is None or bottom is None or not 24<=round(bottom-top,2)<80 or rows and top<rows[-1]['top']+rows[-1]['height']-.1: rows=[];break
                row={'top':round(top,2),'height':round(bottom-top,2)}
                licence_rows=_licences(rules,columns,top,bottom)
                if licence_rows: row['licenceRows']=licence_rows
                rows.append(row)
        else:
            start=next((a for a,b in zip(boundaries,boundaries[1:]) if a<mid<b),None)
            if start is None: continue
            signature_edges=_boundaries(rules,columns['signature'])
            for top,bottom in zip(boundaries,boundaries[1:]):
                if top<start-.1: continue
                if not 24<=round(bottom-top,2)<80 or rows and abs(top-rows[-1]['top']-rows[-1]['height'])>1: break
                if not all(any(abs(edge-y)<1 for y in signature_edges) for edge in (top,bottom)): break
                # Require matching three-part licence cells in all three columns.
                licence_rows=_licences(rules,columns,top,bottom)
                if not licence_rows or _columns(rules,headings,(top+bottom)/2)!=columns: break
                rows.append({'top':round(top,2),'height':round(bottom-top,2),'licenceRows':licence_rows,'needsConstructionCardLabel':True})
        if len(rows)>50: return None
        if rows: return {'columns':columns,'rows':rows}
    return None


def _shaded_row(rects, headings, card):
    """Measure one complete shaded worker row, never a paragraph highlight."""
    mid=(card['top']+card['bottom'])/2
    selected={}
    for key,heading in headings.items():
        x=(heading['x0']+heading['x1'])/2
        cells=[r for r in rects if r['x0']<x<r['x1'] and r['top']<mid<r['bottom']]
        if len(cells)!=1: return None
        selected[key]=cells[0]
    columns={key:[r['x0'],r['x1']-r['x0']] for key,r in selected.items()}
    values=list(columns.values())
    if any(width<15 for _,width in values) or any(abs(a[0]+a[1]-b[0])>.6 for a,b in zip(values,values[1:])): return None
    top,bottom=selected['name']['top'],selected['name']['bottom']
    if not 24<=bottom-top<80: return None
    if any(abs(selected[key]['top']-top)>.5 or abs(selected[key]['bottom']-bottom)>.5 for key in ('role','date','signature')): return None
    subdivisions=[]
    for key in ('type','class','number'):
        x,width=columns[key]
        cells=sorted((r for r in rects if abs(r['x0']-x)<.5 and abs(r['x1']-x-width)<.5 and r['top']>=top-.5 and r['bottom']<=bottom+.5),key=lambda r:r['top'])
        if len(cells)!=3 or abs(cells[0]['top']-top)>.5 or abs(cells[-1]['bottom']-bottom)>.5: return None
        if any(r['bottom']-r['top']<5 for r in cells) or any(not -.1<=b['top']-a['bottom']<=.6 for a,b in zip(cells,cells[1:])): return None
        subdivisions.append([(r['top'],r['bottom']) for r in cells])
    if any(abs(a-c)>.5 or abs(b-d)>.5 for cells in subdivisions[1:] for (a,b),(c,d) in zip(subdivisions[0],cells)): return None
    return {'columns':columns,'top':top,'bottom':bottom,'licences':subdivisions[0]}


def _shaded_table(rectangles, rules, headings, cards, words):
    """Recover a damaged grid from repeated cell fills and surviving rule heights.

    Some Word exports collapse border x coordinates to a point. Their y values
    still measure the licence boundaries. Accept those values only when repeated
    complete shaded rows establish every column and verify the same row pattern.
    Unshaded rows need their own printed card label and all four measured rules;
    the last row is not extrapolated from the preceding rows.
    """
    if not 3<=len(cards)<=50: return None
    cards=sorted(cards,key=lambda w:w['top'])
    if any(not any(w['text'].lower()=='card' and abs(w['top']-card['top'])<1 and 0<=w['x0']-card['x1']<10 for w in words) for card in cards): return None
    header_bottom=max(w['bottom'] for w in headings.values())
    # Duplicate paint operations are common in exported Word documents.
    unique={tuple(round(r[k],2) for k in ('x0','x1','top','bottom')):r for r in rectangles if r.get('fill') and r['width']>=15 and r['height']>=5 and r['top']>=header_bottom-.5}
    rects=list(unique.values());anchors={};columns=None
    for index,card in enumerate(cards):
        mid=(card['top']+card['bottom'])/2
        shading=[r for r in rects if r['top']<mid<r['bottom'] and r['x0']<headings['signature']['x1'] and r['x1']>headings['name']['x0']]
        if not shading: continue
        row=_shaded_row(rects,headings,card)
        if not row: return None
        if columns is not None and any(abs(a-b)>.5 for key in columns for a,b in zip(columns[key],row['columns'][key])): return None
        columns=row['columns'];anchors[index]=row
    if len(anchors)<2: return None
    boundaries=_group(e['top'] for e in rules if abs(e['top']-e['bottom'])<.6 and e['top']>header_bottom)
    rows=[]
    expected=[median(row['licences'][i][1]-row['licences'][i][0] for row in anchors.values()) for i in range(3)]
    for index,card in enumerate(cards):
        prior=[i for i,y in enumerate(boundaries) if y<card['top']]
        if not prior: return None
        edges=boundaries[prior[-1]:prior[-1]+4]
        if len(edges)!=4 or not edges[0]<card['top']<card['bottom']<=edges[1]+.5: return None
        if not 24<=edges[-1]-edges[0]<80 or any(b-a<5 or abs(b-a-height)>2 for a,b,height in zip(edges,edges[1:],expected)): return None
        if rows and abs(edges[0]-rows[-1]['top']-rows[-1]['height'])>.1: return None
        # Surviving real borders outrank the repeated shading pattern. A rule
        # through a merged worker field means it is not one full-height cell.
        for key in ('name','role','date','signature'):
            x,width=columns[key];mid=x+width/2
            if any(abs(e['top']-e['bottom'])<.6 and edges[0]+.6<e['top']<edges[-1]-.6 and e['x0']<mid<e['x1'] for e in rules): return None
        # Likewise, a surviving vertical divider cannot split a field whose
        # width was recovered from a fill rectangle.
        for x,width in columns.values():
            if any(abs(e['x0']-e['x1'])<.6 and x+.6<e['x0']<x+width-.6 and min(e['bottom'],edges[-1])-max(e['top'],edges[0])>.6 for e in rules): return None
        if index in anchors:
            anchor=anchors[index]
            # Thick header rules can sit just inside the first shaded row.
            if abs(edges[0]-anchor['top'])>(1.5 if index==0 else .6) or abs(edges[-1]-anchor['bottom'])>.6: return None
            if any(abs(edge-cell[1])>.6 for edge,cell in zip(edges[1:],anchor['licences'])): return None
        rows.append({'top':round(edges[0],2),'height':round(edges[-1]-edges[0],2),
                     'licenceRows':[{'top':round(a,2),'height':round(b-a,2)} for a,b in zip(edges,edges[1:])]})
    return {'columns':{key:[round(x,2),round(width,2)] for key,(x,width) in columns.items()},'rows':rows}


def scan_signoff_pdf(payload):
    pages=[];candidates=[]
    with pdfplumber.open(io.BytesIO(payload)) as pdf:
        if len(pdf.pages)>200: raise ValueError('PDF has more than 200 pages. Use manual sign-off setup.')
        for index,p in enumerate(pdf.pages):
            words=p.extract_words();text=' '.join(w['text'] for w in words)
            if not re.search(r'sign[\s-]*off|acknowledg|signature',text,re.I): continue
            candidates.append(index+1)
            # Shaded paragraph fills are not cell borders.
            rules=p.lines+[e for r in p.rects if r.get('stroke') or min(r['width'],r['height'])<=3 for e in rect_to_edges(r)]
            for signature in [w for w in words if w['text'].upper()=='SIGNATURE']:
                header=[w for w in words if abs(w['top']-signature['top'])<20]
                keys={'name':'NAME','role':'ROLE','type':'TYPE','class':'CLASS','number':'NUMBER','date':'DATE','signature':'SIGNATURE'}
                headings={key:next((w for w in header if w['text'].upper()==label),None) for key,label in keys.items()}
                if not all(headings.values()): continue
                cards=[w for w in words if w['text'].lower()=='construction' and w['top']>signature['bottom'] and abs(w['x0']-headings['type']['x0'])<20]
                table=_table(rules,headings,cards) or _shaded_table(p.rects,rules,headings,cards,words)
                if table:
                    pages.append({'page':index+1,'width':float(p.width),'height':float(p.height),**table});break
        return {'status':'detected' if pages else 'manual','pages':pages,'candidatePages':candidates[:200],
                'message':'Review the detected sign-off tables before enabling.' if pages else 'No supported text-based sign-off table was found. Read the PDF and use manual setup. Image-only PDFs need manual setup.'}
