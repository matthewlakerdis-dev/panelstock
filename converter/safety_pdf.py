"""Find text-based SWMS sign-off tables; never guess placements in unreadable PDFs."""
import io
import re
import pdfplumber
from pdfplumber.utils import rect_to_edges


def _group(values, tolerance=1):
    result=[]
    for value in sorted(values):
        if not result or value-result[-1]>tolerance: result.append(round(value,2))
    return result


def scan_signoff_pdf(payload):
    pages=[];candidates=[]
    with pdfplumber.open(io.BytesIO(payload)) as pdf:
        if len(pdf.pages)>200: raise ValueError('PDF has more than 200 pages. Use manual sign-off setup.')
        for index,p in enumerate(pdf.pages):
            words=p.extract_words();text=' '.join(w['text'] for w in words)
            if not re.search(r'sign[\s-]*off|acknowledg|signature',text,re.I): continue
            candidates.append(index+1)
            for signature in [w for w in words if w['text'].upper()=='SIGNATURE']:
                header=[w for w in words if abs(w['top']-signature['top'])<20]
                keys={'name':'NAME','role':'ROLE','type':'TYPE','class':'CLASS','number':'NUMBER','date':'DATE','signature':'SIGNATURE'}
                headings={key:next((w for w in header if w['text'].upper()==label),None) for key,label in keys.items()}
                if not all(headings.values()): continue
                cards=[w for w in words if w['text'].lower()=='construction' and w['top']>signature['bottom'] and abs(w['x0']-headings['type']['x0'])<20]
                if not cards: continue
                # Word exports include shaded paragraph rectangles inside cells.
                # Use drawn rules and narrow border rectangles, not those fills.
                rules=p.lines+[e for r in p.rects if r.get('stroke') or min(r['width'],r['height'])<=3 for e in rect_to_edges(r)]
                mid=(cards[0]['top']+cards[0]['bottom'])/2
                vertical=[e for e in rules if abs(e['x0']-e['x1'])<.6 and e['top']<mid<e['bottom']]
                xs=_group([e['x0'] for e in vertical])
                columns={}
                for key,w in headings.items():
                    centre=(w['x0']+w['x1'])/2
                    pair=next(((a,b) for a,b in zip(xs,xs[1:]) if a<centre<b),None)
                    if not pair: break
                    columns[key]=[round(pair[0],2),round(pair[1]-pair[0],2)]
                if len(columns)!=7 or len({tuple(v) for v in columns.values()})!=7: continue
                name_mid=columns['name'][0]+columns['name'][1]/2
                boundaries=_group([e['top'] for e in rules if abs(e['top']-e['bottom'])<.6 and e['x0']<name_mid<e['x1']])
                type_mid=columns['type'][0]+columns['type'][1]/2
                licence_boundaries=_group([e['top'] for e in rules if abs(e['top']-e['bottom'])<.6 and e['x0']<type_mid<e['x1']])
                rows=[]
                for card in cards:
                    top=next((y for y in reversed(boundaries) if signature['bottom']<y<card['top']),None)
                    bottom=next((y for y in boundaries if y>card['bottom']),None)
                    if top is None or bottom is None or not 24<=round(bottom-top,2)<80: rows=[];break
                    if rows and top<rows[-1]['top']+rows[-1]['height']-.1: rows=[];break
                    row={'top':round(top,2),'height':round(bottom-top,2)}
                    internal=[y for y in licence_boundaries if top+1<y<bottom-1]
                    if len(internal)==2:
                        slots=[top,*internal,bottom]
                        row['licenceRows']=[{'top':round(x,2),'height':round(y-x,2)} for x,y in zip(slots,slots[1:])]
                    rows.append(row)
                if rows and len(rows)<=50:
                    pages.append({'page':index+1,'width':float(p.width),'height':float(p.height),'columns':columns,'rows':rows});break
        return {'status':'detected' if pages else 'manual','pages':pages,'candidatePages':candidates[:200],
                'message':'Review the detected sign-off tables before enabling.' if pages else 'No supported text-based sign-off table was found. Read the PDF and use manual setup. Image-only PDFs need manual setup.'}
