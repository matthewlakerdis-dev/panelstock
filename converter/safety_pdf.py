"""Find text-based SWMS sign-off tables; never guess placements in unreadable PDFs."""
import io
import re
import pdfplumber


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
                mid=(cards[0]['top']+cards[0]['bottom'])/2
                vertical=[e for e in p.edges if abs(e['x0']-e['x1'])<.6 and e['top']<mid<e['bottom']]
                xs=_group([e['x0'] for e in vertical])
                columns={}
                for key,w in headings.items():
                    centre=(w['x0']+w['x1'])/2
                    pair=next(((a,b) for a,b in zip(xs,xs[1:]) if a<centre<b),None)
                    if not pair: break
                    columns[key]=[round(pair[0],2),round(pair[1]-pair[0],2)]
                if len(columns)!=7 or len({tuple(v) for v in columns.values()})!=7: continue
                anchors=[]
                for card in cards:
                    centre=(card['top']+card['bottom'])/2
                    edges=[e for e in p.edges if abs(e['x0']-e['x1'])<.6 and abs(e['x0']-columns['name'][0])<2 and e['top']<centre<e['bottom'] and 24<e['bottom']-e['top']<80]
                    if edges:
                        edge=min(edges,key=lambda e:e['bottom']-e['top']);anchors.append((card['top']-edge['top'],edge['bottom']-edge['top']))
                if not anchors: continue
                offset,height=anchors[0]
                # Alternating shaded/white merged cells omit some vertical strokes.
                # Repeated Construction Card labels identify those rows; validate the
                # same measured cell offset/height and row spacing throughout.
                if any(abs(a-offset)>1 or abs(b-height)>1 for a,b in anchors): continue
                if any(abs((b['top']-a['top'])-height)>2 for a,b in zip(cards,cards[1:])): continue
                rows=[{'top':round(card['top']-offset,2),'height':round(height,2)} for card in cards]
                if rows and len(rows)<=50:
                    pages.append({'page':index+1,'width':float(p.width),'height':float(p.height),'columns':columns,'rows':rows});break
        return {'status':'detected' if pages else 'manual','pages':pages,'candidatePages':candidates[:200],
                'message':'Review the detected sign-off tables before enabling.' if pages else 'No supported text-based sign-off table was found. Read the PDF and use manual setup. Image-only PDFs need manual setup.'}
