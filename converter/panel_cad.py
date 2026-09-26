"""Deterministic millimetre CAD engine. AI never writes executable drawing code."""
import io, math, re
import ezdxf
from ezdxf import bbox
from shapely.geometry import Polygon, Point, LineString, box
from shapely.ops import unary_union
from ezdxf.addons.drawing import RenderContext, Frontend, svg, layout
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy, ColorPolicy

RULE_VERSION = '2026-09-25.3'
TAGS = {'B', 'S', 'NT', 'RE'}
CODES = TAGS | {'FE', 'CR'}
VECTORS = {'right': (1, 0), 'up': (0, 1), 'left': (-1, 0), 'down': (0, -1)}
class CadError(ValueError): pass


def section_stiffeners(site_regions, finished_regions, fold_lines, plain_edges=()):
    plans=[]
    for site,region in zip(site_regions,finished_regions):
        sx0,sy0,sx1,sy1=site.bounds
        if sx1-sx0<=900 or sy1-sy0<=900:continue
        x0,y0,x1,y1=region.bounds;wide=(x1-x0)>(y1-y0)
        axis=LineString([((x0+x1)/2,y0-1),((x0+x1)/2,y1+1)]) if wide else LineString([(x0-1,(y0+y1)/2),(x1+1,(y0+y1)/2)])
        span=axis.intersection(region)
        if span.geom_type!='LineString':raise CadError('Stiffener placement in this section needs review.')
        a,b=span.coords[0],span.coords[-1];length=span.length
        inset_a=50 if any(Point(a).distance(f)<.001 for f in [*fold_lines,*plain_edges]) else 0
        inset_b=50 if any(Point(b).distance(f)<.001 for f in [*fold_lines,*plain_edges]) else 0
        if length-inset_a-inset_b<=100:raise CadError('Insufficient stiffener span after edge and fold clearances.')
        start=span.interpolate(inset_a);end=span.interpolate(length-inset_b)
        plans.append({'start':(start.x,start.y),'end':(end.x,end.y),'wide':wide,'section':[y0,y1],'placement':(x1-x0)/2 if wide else (y1-y0)/2,'length':start.distance(end)})
    return plans

def stiffener_label(plan):
    def number(value):return f'{value:.2f}'.rstrip('0').rstrip('.')
    return number(plan['placement'])+' · '+number(plan['length'])+r'\PSTIFFENER'

def hole_end_spans(drilling, cut, routes, direction):
    """Hole edges stay 20 mm from end cuts/routes; parallel tag sides are exempt."""
    obstacles=[]
    for line in [cut.exterior, *[LineString(r) for r in routes]]:
        coords=list(line.coords)
        for a,b in zip(coords,coords[1:]):
            dx,dy=b[0]-a[0],b[1]-a[1]
            if abs(dx*direction[1]-dy*direction[0])<=1e-7*max(1,math.hypot(dx,dy)):continue
            # Circumscribed buffer avoids undershooting clearance between arc vertices.
            obstacles.append(LineString([a,b]).buffer(21.5/math.cos(math.pi/64),quad_segs=16))
    safe=drilling.intersection(cut.buffer(-3))
    for obstacle in obstacles:safe=safe.difference(obstacle)
    parts=list(safe.geoms) if hasattr(safe,'geoms') else [safe]
    return [part for part in parts if part.geom_type=='LineString' and part.length>.001]

PANEL_ID_HEIGHT = 42
PANEL_ROTATION = {'right': 0, 'up': 90, 'left': 180, 'down': 270}


def annotation_shape(panel, direction):
    from shapely.affinity import rotate
    half=max(50,len(panel)*PANEL_ID_HEIGHT*.55+15)
    area=box(-half,-140 if direction in VECTORS else -35,half,35)
    return rotate(area,PANEL_ROTATION.get(direction,0),origin=(0,0))


def draw_panel_annotation(m, panel, direction, anchor):
    angle=PANEL_ROTATION.get(direction,0)
    m.add_mtext(panel,dxfattribs={'layer':'LABELS','style':'Arial','char_height':PANEL_ID_HEIGHT,'insert':anchor,'attachment_point':5,'rotation':angle})
    if direction in VECTORS:
        u=VECTORS[direction];n=(-u[1],u[0])
        centre=(anchor[0]-n[0]*85,anchor[1]-n[1]*85)
        tip=(centre[0]+u[0]*45,centre[1]+u[1]*45)
        start=(centre[0]-u[0]*45,centre[1]-u[1]*45)
        lines=[(start,tip)]+[((tip[0]-u[0]*18+n[0]*side*10,tip[1]-u[1]*18+n[1]*side*10),tip) for side in (-1,1)]
        for a,b in lines:m.add_line(a,b,dxfattribs={'layer':'LABELS'})


def annotation_position(face,panel,direction,obstacles):
    from shapely.affinity import translate
    shape=annotation_shape(panel,direction)
    x0,y0,x1,y1=face.bounds
    centre=face.centroid
    candidates=[(centre.x,centre.y)]
    candidates += [(x0+(x1-x0)*i/24,y0+(y1-y0)*j/24) for i in range(1,24) for j in range(1,24)]
    candidates.sort(key=lambda p:(p[0]-centre.x)**2+(p[1]-centre.y)**2)
    for x,y in candidates:
        area=translate(shape,x,y)
        if face.covers(area) and not any(area.intersects(o) for o in obstacles):
            return (x,y),False
    low=min([y0]+[o.bounds[1] for o in obstacles])
    return ((x0+x1)/2,low-shape.bounds[3]-25),True


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

def fold_spans(face, points, edges, heights):
    """Clip horizontal folds to material; every endpoint must meet a tagged side."""
    spans=[]
    for y in heights:
        if any(abs(p[1]-y)<.001 for p in points):
            raise CadError('A fold meets an outline corner; review its height.')
        cut=face.intersection(LineString([(face.bounds[0]-1,y),(face.bounds[2]+1,y)]))
        lines=list(cut.geoms) if cut.geom_type=='MultiLineString' else [cut]
        if not lines or any(line.geom_type!='LineString' or line.length<.001 for line in lines):
            raise CadError('A fold must cross panel material.')
        for line in lines:
            ends=sorted([tuple(line.coords[0]),tuple(line.coords[-1])])
            sides=[]
            for end in ends:
                matches=[i for i,e in enumerate(edges) if VECTORS[e['direction']][1] and LineString([points[i],points[(i+1)%len(points)]]).distance(Point(end))<.001]
                if len(matches)!=1 or edges[matches[0]]['code'] not in TAGS:
                    raise CadError('Internal folds must end at tagged vertical sides.')
                sides.append(matches[0])
            spans.append((ends,sides))
    return spans

ROTATE_CCW={'right':'up','up':'left','left':'down','down':'right'}

def vertical_spec(spec):
    import copy
    lines=spec.get('foldLines') or []
    vertical=[f for f in lines if abs(f['start']['x']-f['end']['x'])<.001 and abs(f['start']['y']-f['end']['y'])>.001]
    if not vertical:return None
    if len(vertical)!=len(lines) or spec.get('siteFolds'):
        raise CadError('Combined fold orientations need review; use parallel vertical folds in this version.')
    points,face=vertices(spec['edges'],'site')
    levels=[]
    for f in vertical:
        x=number(f['start']['x'],'Vertical fold position')
        expected=face.intersection(LineString([(x,face.bounds[1]-1),(x,face.bounds[3]+1)]))
        actual=LineString([(f['start']['x'],f['start']['y']),(f['end']['x'],f['end']['y'])])
        if expected.geom_type!='LineString' or expected.hausdorff_distance(actual)>.001:
            raise CadError('Vertical folds must span the panel between their marked outline endpoints.')
        levels.append(x)
    result=copy.deepcopy(spec)
    result.pop('foldLines',None)
    result['siteFolds']=sorted(set(levels));result['folds']=spec.get('verticalFolds',[])
    for e in result['edges']:e['direction']=ROTATE_CCW[e['direction']]
    if result.get('panelDirection') in ROTATE_CCW:result['panelDirection']=ROTATE_CCW[result['panelDirection']]
    return result

def finish_extracted_spec(spec):
    """Apply established allowances to a validated site outline, never AI lengths."""
    import copy
    rotated=vertical_spec(spec)
    if rotated is not None:
        calculated=finish_extracted_spec(rotated)
        result=copy.deepcopy(spec)
        for e,c in zip(result['edges'],calculated['edges']):e['finished']=c['finished']
        result['verticalFolds']=calculated['folds'];result['folds']=[];result['reviewed']=False
        result['dimensionSource']=calculated['dimensionSource']
        return result
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
    bottom_shift=shifted[0][1]-points[0][1]
    ordered=[]
    if folds:
        height=site.bounds[3]-site.bounds[1]
        ordered=sorted(number(f,'Site fold height',.001,height-.001) for f in folds)
        if len(ordered)>12 or len(set(ordered))!=len(ordered):
            raise CadError('Use at most 12 distinct internal fold heights.')
        fold_spans(site,points,edges,[site.bounds[1]+f for f in ordered])
        result['folds']=[round(f-bottom_shift-1-2*i,6) for i,f in enumerate(ordered)]
        shifted=[(q[0],q[1]-2*sum(p[1]>site.bounds[1]+f for f in ordered)) for p,q in zip(points,shifted)]
    for i, edge in enumerate(edges):
        a, b = shifted[i], shifted[(i+1) % len(edges)]
        u = VECTORS[edge['direction']]
        length = (b[0]-a[0])*u[0] + (b[1]-a[1])*u[1]
        edge['finished'] = round(number(length, 'Finished edge %s' % (i+1)), 6)
    finished_points,finished_face=vertices(edges, 'finished')
    if folds:
        finished_height=finished_face.bounds[3]-finished_face.bounds[1]
        fold_spans(finished_face,finished_points,edges,[finished_face.bounds[1]+f for f in result['folds']])
        levels = [0]+result['folds']+[finished_height]
        if any(b-a <= .001 for a,b in zip(levels, levels[1:])):
            raise CadError('Fold deductions leave an empty or reversed panel section.')
    result['dimensionSource'] = 'site-outline-1mm-partial-fold-allowance'
    return result


def draw_clear_dimensions(m,dimensions):
    """Keep dimension lines at their supplied offset; slide crowded text."""
    obstacles=[]
    def text_boxes(entities):
        result=[]
        for e in entities:
            if e.dxftype() not in {'TEXT','MTEXT'}:continue
            bounds=bbox.extents([e])
            if bounds.has_data:result.append(box(bounds.extmin.x,bounds.extmin.y,bounds.extmax.x,bounds.extmax.y).buffer(8))
        return result
    for e in m:
        if e.dxftype()=='DIMENSION':obstacles.extend(text_boxes(e.virtual_entities()))
        elif e.dxftype() in {'TEXT','MTEXT'}:obstacles.extend(text_boxes([e]))
        elif e.dxftype()=='LWPOLYLINE':
            pts=list(e.get_points('xy'))
            if e.closed:pts.append(pts[0])
            obstacles.append(LineString(pts).buffer(5))
        elif e.dxftype()=='LINE':obstacles.append(LineString([tuple(e.dxf.start)[:2],tuple(e.dxf.end)[:2]]).buffer(5))
        elif e.dxftype()=='CIRCLE':obstacles.append(Point(e.dxf.center.x,e.dxf.center.y).buffer(e.dxf.radius+5))
    for a,b,base,angle,code in sorted(dimensions,key=lambda d:-math.dist(d[0],d[1])):
        # Prefer centred text, then only small local moves. Never send a label
        # along a long leader in search of an empty part of the drawing.
        candidates=[(0,0),(20,0),(-20,0),(40,0),(-40,0),(0,28),(0,-28),(20,28),(-20,28)]
        best=None
        def render(shift):
            dim=m.add_linear_dim(base=base,p1=a,p2=b,angle=angle,text='<> · '+code if code else '<>',override={'dimtxt':22,'dimtxsty':'Arial','dimasz':6,'dimdec':2,'dimzin':8,'dimgap':3,'dimtad':1,'dimjust':0,'dimtix':1,'dimtofl':1,'dimtih':1 if math.dist(a,b)<140 else 0,'dimtoh':1 if math.dist(a,b)<140 else 0},dxfattribs={'layer':'DIMENSIONS'})
            if shift!=(0,0):dim.shift_text(*shift)
            dim.render()
            return dim,text_boxes(dim.dimension.virtual_entities())
        for shift in candidates:
            dim,boxes=render(shift)
            score=sum(first.intersection(second).area for first in boxes for second in obstacles)
            if best is None or score<best[0]:best=(score,shift)
            if score<1e-8:break
            block=dim.dimension.dxf.geometry;m.delete_entity(dim.dimension);m.doc.blocks.delete_block(block,safe=False)
        else:dim,boxes=render(best[1])
        obstacles.extend(boxes)


def generate(spec):
    if isinstance(spec,dict) and spec.get('measuredEdges') is not None:
        from diagonal_cad import generate_measured
        from outline_geometry import GeometryError
        try:return generate_measured(spec)
        except GeometryError as e:raise CadError(str(e)) from e
    rotated=vertical_spec(spec) if isinstance(spec,dict) else None
    if rotated is not None:
        result=generate(rotated)
        doc=ezdxf.read(io.StringIO(result['dxf']))
        matrix=ezdxf.math.Matrix44.z_rotate(-math.pi/2)
        for entity in doc.modelspace():entity.transform(matrix)
        stream=io.StringIO();doc.write(stream);result['dxf']=stream.getvalue()
        backend=svg.SVGBackend()
        Frontend(RenderContext(doc),backend,config=Configuration(background_policy=BackgroundPolicy.WHITE,color_policy=ColorPolicy.COLOR)).draw_layout(doc.modelspace(),finalize=True)
        result['svg']=backend.get_string(layout.Page(360,300))
        for plan in result['validation'].get('stiffeners',[]):
            for key in ['start','end']:
                x,y=plan[key];plan[key]=(y,-x)
            plan['wide']=not plan['wide']
        return result
    if not isinstance(spec,dict): raise CadError('Panel details are required.')
    if spec.get('unsupported'):
        raise CadError('Sketch reading needs review: '+str(next(iter(spec.get('questions') or []), 'unsupported or uncertain outline.'))[:400])
    if spec.get('reviewed') is not True: raise CadError('Review and confirm the dimensions and edge types first.')
    panel=str(spec.get('panelId','')).strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}',panel): raise CadError('Enter a panel ID using letters, numbers, spaces or hyphens.')
    edges=spec.get('edges',[])
    if not isinstance(edges,list) or not 4<=len(edges)<=32: raise CadError('Use 4 to 32 perimeter edges.')
    points,face=vertices(edges,'finished');site_points,site=vertices(edges,'site')
    if spec.get('unsupported'): raise CadError('This sketch contains unsupported details. Resolve them before generation.')
    x0,y0,x1,y1=face.bounds; width=x1-x0;height=y1-y0
    fold_values=spec.get('folds',[])
    if not isinstance(fold_values,list) or len(fold_values)>12: raise CadError('At most 12 internal folds are supported.')
    folds=sorted(number(v,'Fold height',0.001,height-0.001)+y0 for v in fold_values)
    if len(set(folds))!=len(folds): raise CadError('Internal fold positions must be distinct.')
    internal_spans=fold_spans(face,points,edges,folds)
    section_codes={}
    for i,e in enumerate(edges):
        parts=e.get('sections') or []
        if not parts:continue
        if any(p.get('code') not in TAGS for p in parts):
            if any(p.get('code')!=e['code'] for p in parts):
                raise CadError('A change between a tag and FE/CR needs a reviewed cut transition.')
            continue
        if abs(sum(number(p.get('site'),'Section site') for p in parts)-e['site'])>.001:
            raise CadError('Section measurements no longer match the side. Correct the sketch sections.')
        # Horizontal folds already define the exact finished split locations.
        u=VECTORS[e['direction']];length=math.dist(points[i],points[(i+1)%len(edges)])
        boundaries=[0]
        accumulated=0
        for part in parts[:-1]:
            accumulated+=part['site']
            if u[1]:
                level=site_points[i][1]+u[1]*accumulated
                site_levels=sorted(spec.get('siteFolds',[]))
                matches=[k for k,v in enumerate(site_levels) if abs(v-level)<.001]
                if not matches:raise CadError('A tag change on a vertical side must align with a marked horizontal fold.')
                boundary=(folds[matches[0]]-points[i][1])/u[1]
            else:
                # No vertical fold allowance is supported: keep along-edge site positions.
                boundary=accumulated-(e['site']-e['finished'])/2
            boundaries.append(boundary)
        boundaries.append(length)
        if any(b<=a for a,b in zip(boundaries,boundaries[1:])):raise CadError('Tag sections leave no finished material.')
        section_codes[i]=[(a,b,p['code']) for a,b,p in zip(boundaries,boundaries[1:],parts)]
    def section_code(i,along):
        return next((code for lo,hi,code in section_codes.get(i,[]) if lo-.001<=along<=hi+.001),edges[i]['code'])
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
        if u[1]: splits+= [(y-p[1])/u[1] for y in folds if .001<(y-p[1])/u[1]<L-.001]
        splits=sorted(set(splits+[b for a,b,c in section_codes.get(i,[]) if .001<b<L-.001]))
        for j,(lo,hi) in enumerate(zip(splits,splits[1:])):
            inset_start=run if j>0 else (t if start_plain or concave(i) else 0)
            inset_end=run if j<len(splits)-2 else (t if end_plain or concave((i+1)%len(edges)) else 0)
            segments.append((i,p,u,n,lo,hi,inset_start,inset_end))
        if concave(i) and not start_plain:
            prev=VECTORS[edges[i-1]['direction']];pn=(prev[1],-prev[0])
            diagonals.append([p,offset(offset(p,n,t),pn,t)])
    cut=unary_union([face]+strips)
    for ends,sides in internal_spans:
        for (x,y),i in zip(ends,sides):
            sign=VECTORS[edges[i]['direction']][1]
            cut=cut.difference(Polygon([(x,y),(x+sign*t,y-run),(x+sign*t,y+run)]))
        routes.append(ends)
    # At a concave tag junction, connect the outer corner directly to the
    # adjacent fold apex instead of leaving a short return in the cut.
    # Only this junction changes angle; isolated fold reliefs remain 94 degrees.
    if cut.geom_type=='Polygon':
        apexes=[p for ends,_ in internal_spans for p in ends]
        for _,tip in diagonals:
            ring=list(cut.exterior.coords)[:-1]
            for j,a in enumerate(ring):
                if math.dist(a,tip)>.001:continue
                for step in (-1,1):
                    b=ring[(j+step)%len(ring)];c=ring[(j+2*step)%len(ring)]
                    if .001<math.dist(a,b)<t and any(math.dist(c,p)<.001 for p in apexes):
                        patch=Polygon([a,b,c])
                        if patch.area>.001 and patch.intersection(face).area<.001:
                            cut=cut.union(patch)
    # A nearby fold relief can remove the outer tip of a concave corner route.
    # Route only the material that remains, starting at the original corner.
    for diagonal in diagonals:
        remaining=LineString(diagonal).intersection(cut)
        if remaining.geom_type=='GeometryCollection':
            lines=[g for g in remaining.geoms if g.geom_type=='LineString']
            if len(lines)==1:remaining=lines[0]
        if remaining.geom_type!='LineString' or remaining.length<.001 or Point(diagonal[0]).distance(remaining)>.001:
            raise CadError('Corner and fold reliefs leave an invalid corner route.')
        routes.append(list(remaining.coords))
    if cut.geom_type!='Polygon' or not cut.is_valid or cut.interiors: raise CadError('Tag geometry does not produce one valid closed outline.')
    for route in routes:
        if not cut.buffer(1e-7).covers(LineString(route)): raise CadError('A route leaves the panel. Review the corner or fold spacing.')
    holes=[];hole_edges=[]
    for i,p,u,n,lo,hi,a,b in segments:
        if section_code(i,(lo+hi)/2) in {'NT','RE'} or hi-lo-a-b<40: continue
        first=lo+a+(30 if a else 20);last=hi-b-(30 if b else 20)
        if last<first: continue
        drilling=LineString([offset(offset(p,u,first),n,12),offset(offset(p,u,last),n,12)])
        for span in hole_end_spans(drilling,cut,routes,u):
            # Do not squeeze a pair of end holes into a short remaining span.
            if span.length<40:continue
            count=max(1,math.ceil(span.length/300))
            for j in range(count+1):
                point=span.interpolate(span.length*j/count)
                holes.append((point.x,point.y));hole_edges.append(i)
    from shapely.ops import split
    site_regions=[site];finished_regions=[face]
    site_levels=sorted(spec.get('siteFolds',[]))
    if len(site_levels)!=len(folds):site_levels=[y-y0+1+2*i for i,y in enumerate(folds)]
    for region_list,levels in [(site_regions,[site.bounds[1]+y for y in site_levels]),(finished_regions,folds)]:
        for y in levels:
            next_regions=[]
            for region in region_list:
                next_regions.extend(split(region,LineString([(region.bounds[0]-1,y),(region.bounds[2]+1,y)])).geoms)
            region_list[:]=next_regions
    site_regions.sort(key=lambda p:(p.centroid.y,p.centroid.x));finished_regions.sort(key=lambda p:(p.centroid.y,p.centroid.x))
    if len(site_regions)!=len(finished_regions):raise CadError('Section boundaries need review before placing stiffeners.')
    stiffeners=section_stiffeners(site_regions,finished_regions,[LineString(ends) for ends,_ in internal_spans],[LineString([points[i],points[(i+1)%len(points)]]) for i,e in enumerate(edges) if e['code'] in {'FE','CR'}]);stiffener=stiffeners[0] if stiffeners else None;fixings=[]
    for plan in stiffeners:
        start,end=plan['start'],plan['end']
        for endpoint in (start,end):
            candidates=[i for i,e in enumerate(edges) if LineString([points[i],points[(i+1)%len(edges)]]).distance(Point(endpoint))<1e-7]
            if not candidates: continue
            i=candidates[0]
            # NT and RE remain hole-free, including stiffener attachments.
            if section_code(i,0 if math.dist(endpoint,points[i])<.001 else math.dist(points[i],points[(i+1)%len(edges)])) not in {'B','S'}: continue
            u=VECTORS[edges[i]['direction']];n=(u[1],-u[0]);centre=offset(endpoint,n,12)
            keep=[j for j,p in enumerate(holes) if not (hole_edges[j]==i and abs((p[0]-centre[0])*u[0]+(p[1]-centre[1])*u[1])<=30)]
            holes=[holes[j] for j in keep];hole_edges=[hole_edges[j] for j in keep]
            for sign in (-1,1):fixings.append(offset(centre,u,sign*25));holes.append(fixings[-1]);hole_edges.append(i)
    # Replacing a normal hole with a fixing pair must not create a gap over 300 mm.
    for i,p,u,n,lo,hi,a,b in segments:
        if section_code(i,(lo+hi)/2) not in {'B','S'}: continue
        positions=sorted((h[0]-p[0])*u[0]+(h[1]-p[1])*u[1] for h,j in zip(holes,hole_edges) if j==i and lo <= (h[0]-p[0])*u[0]+(h[1]-p[1])*u[1] <= hi)
        for start,end in zip(positions,positions[1:]):
            intervals=math.ceil((end-start)/300)
            for k in range(1,intervals):
                holes.append(offset(offset(p,u,start+(end-start)*k/intervals),n,12));hole_edges.append(i)
    if len(set(holes))!=len(holes):raise CadError('Duplicate hole positions need review.')
    for p,i in zip(holes,hole_edges):
        u=VECTORS[edges[i]['direction']]
        probe=LineString([offset(p,u,-.01),offset(p,u,.01)])
        if not any(span.distance(Point(p))<1e-7 for span in hole_end_spans(probe,cut,routes,u)):
            raise CadError('A fixing hole needs more clearance from a tag end cut or route.')
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
    dimensions=[]
    def dim(p,q,base,angle,code=None):dimensions.append((p,q,base,angle,code))
    for i,e in enumerate(edges):
        p=points[i];q=points[(i+1)%len(edges)];u=VECTORS[e['direction']];n=(u[1],-u[0]);mid=((p[0]+q[0])/2,(p[1]+q[1])/2)
        tag_sections=[(lo,hi) for edge_index,_,_,_,lo,hi,_,_ in segments if edge_index==i]
        for lo,hi in tag_sections or [(0,math.dist(p,q))]:
            label_point=offset(offset(p,u,(lo+hi)/2),n,-18)
            if stiffener and LineString([stiffener['start'],stiffener['end']]).distance(Point(label_point))<35:label_point=offset(label_point,u,60)
            text(section_code(i,(lo+hi)/2),label_point)
        dim(p,q,offset(mid,n,65),0 if u[0] else 90,' / '.join(dict.fromkeys(section_code(i,(lo+hi)/2) for lo,hi in tag_sections)) if tag_sections else e['code'])
    # Consecutive finished section heights, matching the sketch's dimension chain.
    if folds:
        levels=[y0]+folds+[y1]
        for low,high in zip(levels,levels[1:]):
            dim((x1,low),(x1,high),(x1+110,(low+high)/2),90)
    direction=spec.get('panelDirection')
    if direction not in (None,'none','right','left','up','down'):
        raise CadError('Review the panel direction arrow.')
    for stiffener in stiffeners:
        a=stiffener['start'];b=stiffener['end'];wide=stiffener['wide'];mid=((a[0]+b[0])/2,(a[1]+b[1])/2);u=(0,1) if wide else (1,0)
        text(stiffener_label(stiffener),mid,18,90 if wide else 0)
        for sign,p in [(-1,a),(1,b)]:
            m.add_line(offset(mid,u,sign*55),p,dxfattribs={'layer':'LABELS'})
            for side in (-1,1):m.add_line(offset(offset(p,u,-sign*10),(-u[1],u[0]),side*4),p,dxfattribs={'layer':'LABELS'})
    angles=[90]+([94] if folds else [])+([45] if diagonals or any(e['code'] not in TAGS for e in edges) else [])
    for i,angle in enumerate(angles):
        centre=(x1+240,y1-100-i*180);p1=(centre[0]+80,centre[1]);rad=math.radians(angle);p2=(centre[0]+80*math.cos(rad),centre[1]+80*math.sin(rad))
        for p in (p1,p2):m.add_line(centre,p,dxfattribs={'layer':'DIMENSIONS'})
        base=(centre[0]+60*math.cos(rad/2),centre[1]+60*math.sin(rad/2))
        m.add_angular_dim_3p(base=base,center=centre,p1=p1,p2=p2,override={'dimtxt':22,'dimtxsty':'Arial','dimasz':5},dxfattribs={'layer':'DIMENSIONS'}).render()
    draw_clear_dimensions(m,dimensions)
    # Place ID and arrow together only after all other annotations are known.
    obstacles=[]
    for entity in m:
        if entity.dxf.layer in ('LABELS','DIMENSIONS'):
            bounds=bbox.extents([entity])
            if bounds.has_data:
                obstacles.append(box(bounds.extmin.x,bounds.extmin.y,bounds.extmax.x,bounds.extmax.y).buffer(10))
    obstacles.extend(LineString(r).buffer(10) for r in routes+caps)
    obstacles.extend(Point(p).buffer(8) for p in holes)
    anchor,external=annotation_position(face,panel,direction,obstacles)
    draw_panel_annotation(m,panel,direction,anchor)
    for e in doc.entitydb.values():
        if e.is_alive and e.dxftype() in ('TEXT','MTEXT'):e.dxf.style='Arial'
    stream=io.StringIO();doc.write(stream);dxf=stream.getvalue();saved=ezdxf.read(io.StringIO(dxf));audit=saved.audit()
    if audit.errors or audit.fixes:raise CadError('DXF validation failed.')
    saved_cut=list(saved.modelspace().query('LWPOLYLINE[layer=="CUT"]'))
    if len(saved_cut)!=1 or not saved_cut[0].closed:raise CadError('CUT outline failed validation.')
    backend=svg.SVGBackend();Frontend(RenderContext(saved),backend,config=Configuration(background_policy=BackgroundPolicy.WHITE,color_policy=ColorPolicy.COLOR)).draw_layout(saved.modelspace(),finalize=True)
    preview=backend.get_string(layout.Page(360,300))
    return {'ok':True,'filename':panel+'.dxf','dxf':dxf,'svg':preview,'validation':{'ruleVersion':RULE_VERSION,'closedCut':True,'holes':len(holes),'routes':len(routes),'capRoutes':len(caps),'stiffener':stiffeners[0] if stiffeners else None,'stiffeners':stiffeners,'fixingHoles':len(fixings),'warnings':['Test drawing: tooling width and depth remain unspecified.']}}



