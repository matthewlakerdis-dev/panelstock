"""Find text-based SWMS sign-off tables; never guess placements in unreadable PDFs."""
import io
import re
import pdfplumber
from pdfplumber.utils import rect_to_edges

SCANNER_VERSION="blank-licence-grid-v2"


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
                table=_table(rules,headings,cards)
                if table:
                    pages.append({'page':index+1,'width':float(p.width),'height':float(p.height),**table});break
        return {'status':'detected' if pages else 'manual','pages':pages,'candidatePages':candidates[:200],
                'message':'Review the detected sign-off tables before enabling.' if pages else 'No supported text-based sign-off table was found. Read the PDF and use manual setup. Image-only PDFs need manual setup.'}
