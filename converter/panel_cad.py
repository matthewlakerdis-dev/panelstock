"""Deterministic millimetre CAD engine. AI never writes executable drawing code."""
import io, math, re
import ezdxf
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union
from ezdxf.addons.drawing import RenderContext, Frontend, svg, layout
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy, ColorPolicy

RULE_VERSION = '2026-09-25.1'
TAGS = {'B', 'S', 'NT', 'RE'}
CODES = TAGS | {'FE', 'CR'}
VECTORS = {'right': (1, 0), 'up': (0, 1), 'left': (-1, 0), 'down': (0, -1)}
class CadError(ValueError): pass

def number(value, label, minimum=0.001, maximum=10000):
    if isinstance(value, bool) or not isinstance(value, (int,float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise CadError(f'{label} must be between {minimum:g} and {maximum:g} mm.')
    return float(value)

def vertices(edges, key):
    points=[]; x=y=0
    for i,e in enumerate(edges):
        if e.get('direction') not in VECTORS or e.get('code') not in CODES: raise CadError(f'Check direction and type of edge {i+1}.')
        length=number(e.get(key),f'Edge {i+1} {key}')
        points.append((x,y));u=VECTORS[e['direction']];x+=u[0]*length;y+=u[1]*length
    if math.hypot(x,y)>0.001: raise CadError(f'{key} dimensions do not close: horizontal difference {x:g}, vertical difference {y:g} mm. Resolve these dimensions first.')
    p=Polygon(points)
    if not p.is_valid or p.area<1 or not p.exterior.is_ccw: raise CadError('Outline must be simple and listed counterclockwise, starting along the bottom to the right.')
    for i in range(len(points)):
        a=VECTORS[edges[i-1]['direction']];b=VECTORS[edges[i]['direction']]
        if a[0]*b[0]+a[1]*b[1]!=0: raise CadError('Each perimeter corner must be 90 degrees in this version. Merge collinear edges or review other angles separately.')
    return points,p

def finish_extracted_spec(spec):
    """Apply established allowances to a validated site outline, never AI lengths."""
    import copy
    result = copy.deepcopy(spec)
    result['reviewed'] = False
    edges = result['edges']
    for edge in edges:
        edge['finished'] = None
    if result.get('unsupported'):
        return result
    points, site = vertices(edges, 'site')
    # Intersect adjacent parallel-offset lines. For a CCW edge the left
    # normal points inside; concave corners must use the same construction.
    shifted = []
    for i, point in enumerate(points):
        previous = edges[i-1]
        current = edges[i]
        a = VECTORS[previous['direction']]
        b = VECTORS[current['direction']]
        da = 1 if previous['code'] in TAGS else 0
        db = 1 if current['code'] in TAGS else 0
        x = point[0] - (a[1]*da if a[1] else b[1]*db)
        y = point[1] + (a[0]*da if a[0] else b[0]*db)
        shifted.append((x, y))
    folds = result.get('siteFolds', result.get('folds', []))
    result['siteFolds'] = list(folds)
    result['folds'] = []
    if folds:
        if len(edges) != 4 or not site.equals(site.envelope) or any(e['code'] not in TAGS for e in edges):
            raise CadError('Automatic internal fold deductions require a rectangular panel with four tagged edges.')
        height = site.bounds[3] - site.bounds[1]
        ordered = sorted(number(f, 'Site fold height', .001, height-.001) for f in folds)
        if len(ordered)>12 or len(set(ordered)) != len(ordered):
            raise CadError('Use at most 12 distinct internal fold heights.')
        # One millimetre on each side of every fold, plus the perimeter tags.
        result['folds'] = [value-2*(i+1) for i,value in enumerate(ordered)]
    for i, edge in enumerate(edges):
        a, b = shifted[i], shifted[(i+1) % len(edges)]
        u = VECTORS[edge['direction']]
        length = (b[0]-a[0])*u[0] + (b[1]-a[1])*u[1]
        if folds and u[1]:
            length -= 2*len(folds)
        edge['finished'] = round(number(length, 'Finished edge %s' % (i+1)), 6)
        if edge['code'] == 'FE' and abs(length-edge['site']) > .001:
            raise CadError('Fold deductions would change a factory-edge length; this detail needs review.')
    vertices(edges, 'finished')
    if folds:
        finished_height = max(e['finished'] for e in edges if VECTORS[e['direction']][1])
        levels = [0]+result['folds']+[finished_height]
        if any(b-a <= .001 for a,b in zip(levels, levels[1:])):
            raise CadError('Fold deductions leave an empty or reversed panel section.')
    result['dimensionSource'] = 'site-outline-1mm-fold-allowance'
    return result

def generate(spec):
    if not isinstance(spec,dict): raise CadError('Panel details are required.')
    if spec.get('unsupported'):
        raise CadError('Sketch reading needs review: '+str(next(iter(spec.get('questions') or []), 'unsupported or uncertain outline.'))[:400])
    if spec.get('reviewed') is not True: raise CadError('Review and confirm the dimensions and edge types first.')
    panel=str(spec.get('panelId','')).strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}',panel): raise CadError('Enter a panel ID using letters, numbers, spaces or hyphens.')
    edges=spec.get('edges',[])
    if not isinstance(edges,list) or not 4<=len(edges)<=32: raise CadError('Use 4 to 32 perimeter edges.')
    points,face=vertices(edges,'finished');_,site=vertices(edges,'site')
    if spec.get('unsupported'): raise CadError('This sketch contains unsupported details. Resolve them before generation.')
    x0,y0,x1,y1=face.bounds; width=x1-x0;height=y1-y0
    fold_values=spec.get('folds',[])
    if not isinstance(fold_values,list) or len(fold_values)>12: raise CadError('At most 12 internal folds are supported.')
    folds=sorted(number(v,'Fold height',0.001,height-0.001)+y0 for v in fold_values)
    if len(set(folds))!=len(folds): raise CadError('Internal fold positions must be distinct.')
    if folds and (len(edges)!=4 or not face.equals(face.envelope) or any(e['code'] not in TAGS for e in edges)):
        raise CadError('Internal folds currently require a rectangular face with tags on all four edges.')
    t=20;run=t*math.tan(math.radians(47));strips=[];segments=[];routes=[];diagonals=[];caps=[]
    def add(a,b): return (a[0]+b[0],a[1]+b[1])
    def offset(p,v,k): return (p[0]+v[0]*k,p[1]+v[1]*k)
    def concave(i):
        prev=VECTORS[edges[i-1]['direction']];nxt=VECTORS[edges[i]['direction']]
        return prev[0]*nxt[1]-prev[1]*nxt[0]<0
    for i,e in enumerate(edges):
        p=points[i];q=points[(i+1)%len(edges)];u=VECTORS[e['direction']];n=(u[1],-u[0]);L=math.dist(p,q)
        if e['code']=='CR': caps.append([offset(p,n,.4),offset(q,n,.4)])
        if e['code'] not in TAGS: continue
        start_plain=edges[i-1]['code'] not in TAGS;end_plain=edges[(i+1)%len(edges)]['code'] not in TAGS
        os=offset(offset(p,n,t),u,t if start_plain else 0);oe=offset(offset(q,n,t),u,-t if end_plain else 0)
        if L<=t*(start_plain+end_plain): raise CadError('Tag is too short for its end cuts.')
        strips.append(Polygon([p,q,oe,os]))
        a=offset(p,u,-t) if not concave(i) and not start_plain else p
        b=offset(q,u,t) if not concave((i+1)%len(edges)) and not end_plain else q
        routes.append([a,b])
        # Split side tag drilling regions at internal folds; remove the 94 degree V below.
        splits=[0,L]
        if u[1]: splits+= [(y-p[1])/u[1] for y in folds]
        splits=sorted(splits)
        for j,(lo,hi) in enumerate(zip(splits,splits[1:])):
            inset_start=run if j>0 else (t if start_plain or concave(i) else 0)
            inset_end=run if j<len(splits)-2 else (t if end_plain or concave((i+1)%len(edges)) else 0)
            segments.append((i,p,u,n,lo,hi,inset_start,inset_end))
        if concave(i) and not start_plain:
            prev=VECTORS[edges[i-1]['direction']];pn=(prev[1],-prev[0])
            diagonals.append([p,offset(offset(p,n,t),pn,t)])
    cut=unary_union([face]+strips)
    for y in folds:
        for x,sign in [(x0,-1),(x1,1)]: cut=cut.difference(Polygon([(x,y),(x+sign*t,y-run),(x+sign*t,y+run)]))
        routes.append([(x0,y),(x1,y)])
    routes+=diagonals
    if cut.geom_type!='Polygon' or not cut.is_valid or cut.interiors: raise CadError('Tag geometry does not produce one valid closed outline.')
    for route in routes:
        if not cut.buffer(1e-7).covers(LineString(route)): raise CadError('A route leaves the panel. Review the corner or fold spacing.')
    holes=[];hole_edges=[]
    for i,p,u,n,lo,hi,a,b in segments:
        if edges[i]['code'] in {'NT','RE'} or hi-lo-a-b<40: continue
        first=lo+a+(30 if a else 20);last=hi-b-(30 if b else 20)
        if last<first: continue
        count=max(1,math.ceil((last-first)/300))
        for j in range(count+1 if last>first else 1):
            along=first+(last-first)*j/count;point=offset(offset(p,u,along),n,12)
            holes.append(point);hole_edges.append(i)
    site_span=max(site.bounds[2]-site.bounds[0],site.bounds[3]-site.bounds[1]);stiffener=None;fixings=[]
    # Internal folds provide the required stiffening; no stiffener or attachment holes.
    if site_span>900 and not folds:
        if len(edges)!=4 or not face.equals(face.envelope): raise CadError('Stiffener placement on this shape needs review; automatic placement currently supports rectangular panels.')
        bounds=[y0]+folds+[y1];sections=list(zip(bounds,bounds[1:]))
        low,high=max(sections,key=lambda s:s[1]-s[0]);wide=width>high-low
        if abs(width-(high-low))<1e-7: raise CadError('Equal longest sides: choose stiffener orientation before generation.')
        if folds and not wide: raise CadError('This folded-panel stiffener orientation needs review.')
        start,end=(((x0+x1)/2,low+(50 if low!=y0 else 0)),((x0+x1)/2,high-(50 if high!=y1 else 0))) if wide else ((x0,(y0+y1)/2),(x1,(y0+y1)/2))
        if math.dist(start,end)<=100: raise CadError('Insufficient stiffener span after fold clearances.')
        stiffener={'start':start,'end':end,'wide':wide,'section':[low,high]}
        for endpoint in (start,end):
            candidates=[i for i,e in enumerate(edges) if LineString([points[i],points[(i+1)%len(edges)]]).distance(Point(endpoint))<1e-7]
            if not candidates: continue
            i=candidates[0]
            # NT and RE remain hole-free, including stiffener attachments.
            if edges[i]['code'] not in {'B','S'}: continue
            u=VECTORS[edges[i]['direction']];n=(u[1],-u[0]);centre=offset(endpoint,n,12)
            keep=[j for j,p in enumerate(holes) if not (hole_edges[j]==i and abs((p[0]-centre[0])*u[0]+(p[1]-centre[1])*u[1])<=30)]
            holes=[holes[j] for j in keep];hole_edges=[hole_edges[j] for j in keep]
            for sign in (-1,1):fixings.append(offset(centre,u,sign*25));holes.append(fixings[-1]);hole_edges.append(i)
    # Replacing a normal hole with a fixing pair must not create a gap over 300 mm.
    for i,p,u,n,lo,hi,a,b in segments:
        if edges[i]['code'] not in {'B','S'}: continue
        positions=sorted((h[0]-p[0])*u[0]+(h[1]-p[1])*u[1] for h,j in zip(holes,hole_edges) if j==i and lo <= (h[0]-p[0])*u[0]+(h[1]-p[1])*u[1] <= hi)
        for start,end in zip(positions,positions[1:]):
            intervals=math.ceil((end-start)/300)
            for k in range(1,intervals):
                holes.append(offset(offset(p,u,start+(end-start)*k/intervals),n,12));hole_edges.append(i)
    if len(set(holes))!=len(holes):raise CadError('Duplicate hole positions need review.')
    for p in holes:
        if not cut.contains(Point(p).buffer(1.5)):raise CadError('A hole is too close to the panel cut.')
        if any(LineString(r).distance(Point(p))<1.5 for r in routes):raise CadError('A hole crosses a route line.')
    doc=ezdxf.new('R2010');doc.units=4;m=doc.modelspace()
    doc.styles.new('Arial',dxfattribs={'font':'arial.ttf'}).set_extended_font_data('Arial')
    for name,col in [('CUT',3),('ROUTE',1),('CAP ROUTE',5),('LABELS',7),('DIMENSIONS',7),('HOLES',4)]:doc.layers.new(name,dxfattribs={'color':col})
    doc.layers.get('HOLES').dxf.true_color=ezdxf.colors.rgb2int((135,206,250));doc.layers.get('CAP ROUTE').dxf.true_color=ezdxf.colors.rgb2int((0,0,139))
    m.add_lwpolyline(list(cut.exterior.coords)[:-1],close=True,dxfattribs={'layer':'CUT'})
    for r in routes:m.add_lwpolyline(r,dxfattribs={'layer':'ROUTE'})
    for r in caps:m.add_lwpolyline(r,dxfattribs={'layer':'CAP ROUTE'})
    for p in holes:m.add_circle(p,1.5,dxfattribs={'layer':'HOLES'})
    def text(value,p,size=18,rotation=0):m.add_mtext(value,dxfattribs={'layer':'LABELS','style':'Arial','char_height':size,'insert':p,'attachment_point':5,'rotation':rotation})
    def dim(p,q,base,angle):m.add_linear_dim(base=base,p1=p,p2=q,angle=angle,override={'dimtxt':22,'dimtxsty':'Arial','dimasz':6,'dimgap':3,'dimtad':1,'dimdec':2,'dimzin':8},dxfattribs={'layer':'DIMENSIONS'}).render()
    for i,e in enumerate(edges):
        p=points[i];q=points[(i+1)%len(edges)];u=VECTORS[e['direction']];n=(u[1],-u[0]);mid=((p[0]+q[0])/2,(p[1]+q[1])/2)
        label_point=offset(mid,n,-18)
        if stiffener and LineString([stiffener['start'],stiffener['end']]).distance(Point(label_point))<35:label_point=offset(label_point,u,60)
        text(e['code'],label_point);dim(p,q,offset(mid,n,65),0 if u[0] else 90)
    text(panel,(face.centroid.x,face.centroid.y),28)
    # Consecutive finished section heights, matching the sketch's dimension chain.
    if folds:
        levels=[y0]+folds+[y1]
        for low,high in zip(levels,levels[1:]):
            dim((x1,low),(x1,high),(x1+110,(low+high)/2),90)
    direction=spec.get('panelDirection')
    if direction not in (None,'none','right','left','up','down'):
        raise CadError('Review the panel direction arrow.')
    if direction in VECTORS:
        u=VECTORS[direction];n=(-u[1],u[0]);centre=(face.centroid.x,face.centroid.y-55)
        start=offset(centre,u,-30);tip=offset(centre,u,30)
        arrow=[(start,tip)]+[(offset(offset(tip,u,-12),n,side*7),tip) for side in (-1,1)]
        if not all(face.covers(LineString(segment)) for segment in arrow):
            raise CadError('Panel is too small to place the direction arrow below its ID.')
        for a,b in arrow:m.add_line(a,b,dxfattribs={'layer':'LABELS'})
    if stiffener:
        a=stiffener['start'];b=stiffener['end'];wide=stiffener['wide'];mid=((a[0]+b[0])/2,(a[1]+b[1])/2);u=(0,1) if wide else (1,0)
        text('STIFFENER',mid,12,90 if wide else 0)
        for sign,p in [(-1,a),(1,b)]:
            m.add_line(offset(mid,u,sign*55),p,dxfattribs={'layer':'LABELS'})
            for side in (-1,1):m.add_line(offset(offset(p,u,-sign*10),(-u[1],u[0]),side*4),p,dxfattribs={'layer':'LABELS'})
        if wide:dim((x0,y1),(a[0],y1),(x0,y1+105),0)
        else:dim((x1,y0),(x1,a[1]),(x1+105,y0),90)
        low,high=stiffener['section']
        if low!=y0:dim((a[0],low),a,(a[0]+65,a[1]),90)
        if high!=y1:dim((b[0],high),b,(b[0]+65,b[1]),90)
    angles=[90]+([94] if folds else [])+([45] if diagonals or any(e['code'] not in TAGS for e in edges) else [])
    for i,angle in enumerate(angles):
        centre=(x1+240,y1-100-i*180);p1=(centre[0]+80,centre[1]);rad=math.radians(angle);p2=(centre[0]+80*math.cos(rad),centre[1]+80*math.sin(rad))
        for p in (p1,p2):m.add_line(centre,p,dxfattribs={'layer':'DIMENSIONS'})
        base=(centre[0]+60*math.cos(rad/2),centre[1]+60*math.sin(rad/2))
        m.add_angular_dim_3p(base=base,center=centre,p1=p1,p2=p2,override={'dimtxt':22,'dimtxsty':'Arial','dimasz':5},dxfattribs={'layer':'DIMENSIONS'}).render()
    for e in doc.entitydb.values():
        if e.is_alive and e.dxftype() in ('TEXT','MTEXT'):e.dxf.style='Arial'
    stream=io.StringIO();doc.write(stream);dxf=stream.getvalue();saved=ezdxf.read(io.StringIO(dxf));audit=saved.audit()
    if audit.errors or audit.fixes:raise CadError('DXF validation failed.')
    saved_cut=list(saved.modelspace().query('LWPOLYLINE[layer=="CUT"]'))
    if len(saved_cut)!=1 or not saved_cut[0].closed:raise CadError('CUT outline failed validation.')
    backend=svg.SVGBackend();Frontend(RenderContext(saved),backend,config=Configuration(background_policy=BackgroundPolicy.WHITE,color_policy=ColorPolicy.COLOR)).draw_layout(saved.modelspace(),finalize=True)
    preview=backend.get_string(layout.Page(360,300),render_box=ezdxf.math.BoundingBox2d([(x0-140,y0-140),(x1+400,y1+180)]))
    return {'ok':True,'filename':panel+'.dxf','dxf':dxf,'svg':preview,'validation':{'ruleVersion':RULE_VERSION,'closedCut':True,'holes':len(holes),'routes':len(routes),'capRoutes':len(caps),'stiffener':stiffener,'fixingHoles':len(fixings),'warnings':['Test drawing: tooling width and depth remain unspecified.']}}
