"""Explicit measured-outline CAD path. Existing cardinal drafts are unchanged."""
import io,math,re,copy
import ezdxf
from shapely.geometry import Polygon,LineString,Point,box
from shapely.ops import unary_union,linemerge
from ezdxf.addons.drawing import RenderContext,Frontend,svg,layout
from ezdxf.addons.drawing.config import Configuration,BackgroundPolicy,ColorPolicy
from outline_geometry import finish_regions,GeometryError

TAGS={'B','S','NT','RE'}
def generate_measured(spec):
    if spec.get('reviewed') is not True:raise GeometryError('Review and confirm the measured outline first.')
    if spec.get('unsupported'):raise GeometryError('Resolve the draft review flags before generating.')
    spec=copy.deepcopy(spec)
    folds=spec.get('measuredFolds',[])
    vertical=bool(folds) and all(abs(f['start']['x']-f['end']['x'])<.001 and abs(f['start']['y']-f['end']['y'])>.001 for f in folds)
    if vertical:
        # Rotate the whole manufacturing problem, keeping edge/endpoint references.
        for edge in spec['measuredEdges']:edge['dx'],edge['dy']=-edge['dy'],edge['dx']
        for fold in folds:
            for end in ['start','end']:
                p=fold[end];p['x'],p['y']=-p['y'],p['x']
        spec['panelDirection']={'up':'left','left':'down','down':'right','right':'up'}.get(spec.get('panelDirection'),spec.get('panelDirection','none'))
        result=generate_measured(spec)
        doc=ezdxf.read(io.StringIO(result['dxf']))
        matrix=ezdxf.math.Matrix44.z_rotate(-math.pi/2)
        for entity in doc.modelspace():entity.transform(matrix)
        stream=io.StringIO();doc.write(stream)
        saved=ezdxf.read(io.StringIO(stream.getvalue()));audit=saved.audit()
        if audit.errors or audit.fixes:raise GeometryError('Vertical fold DXF validation failed.')
        backend=svg.SVGBackend()
        Frontend(RenderContext(saved),backend,config=Configuration(background_policy=BackgroundPolicy.WHITE,color_policy=ColorPolicy.COLOR)).draw_layout(saved.modelspace(),finalize=True)
        result['dxf']=stream.getvalue();result['svg']=backend.get_string(layout.Page(360,300))
        g=result['geometry']
        for edge in g['measuredEdges']:edge['dx'],edge['dy']=edge['dy'],-edge['dx']
        for p in g['sitePoints']:p['x'],p['y']=p['y'],-p['x']
        for fold in g.get('measuredFolds',[]):
            for end in ['start','end']:
                p=fold[end];p['x'],p['y']=p['y'],-p['x']
        g['finishedFace']=[(y,-x) for x,y in g['finishedFace']]
        g['finishedFoldLines']=[[(y,-x) for x,y in line] for line in g['finishedFoldLines']]
        for segment in g['finishedOuterSegments']:
            for key in ['start','end','u','n']:
                if key in segment:x,y=segment[key];segment[key]=(y,-x)
        g['panelDirection']={'up':'right','right':'down','down':'left','left':'up'}.get(g.get('panelDirection'),g.get('panelDirection','none'))
        return result
    original=spec.get('measuredFolds',[])
    # UI endpoint order and fold creation order do not change the meaning of
    # a marked corner or relief selection.
    for i,f in enumerate(original):
        if f.get('start',{}).get('x',0)>f.get('end',{}).get('x',0):
            f['start'],f['end']=f['end'],f['start']
            for key in ['rightAngles','reliefEnds']:
                for c in spec.get(key,[]):
                    if c.get('fold')==i:c['end']=1-c['end']
    order=sorted(range(len(original)),key=lambda i:original[i].get('start',{}).get('y',0))
    spec['measuredFolds']=[original[i] for i in order]
    for key in ['rightAngles','reliefEnds']:
        for c in spec.get(key,[]):
            if c.get('fold') not in order:raise GeometryError('A fold constraint has an invalid reference.')
            c['fold']=order.index(c['fold'])
    panel=str(spec.get('panelId','')).strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}',panel):raise GeometryError('Enter a valid panel ID.')
    geometry=finish_regions(spec)
    face=Polygon(geometry['finishedFace']);segments=geometry['finishedOuterSegments']
    if not geometry['finishedFoldLines'] and face.bounds[2]-face.bounds[0]>900 and face.bounds[3]-face.bounds[1]>900:
        raise GeometryError('This unfolded shape requires a reviewed stiffener layout.')
    def unit(a,b):
        length=math.dist(a,b);return ((b[0]-a[0])/length,(b[1]-a[1])/length)
    def move(p,u,t):return (p[0]+u[0]*t,p[1]+u[1]*t)
    strips=[];caps=[]
    for s in segments:
        a,b=s['start'],s['end'];u=unit(a,b);n=(u[1],-u[0]);s['u']=u;s['n']=n
        if s['code'] in TAGS:strips.append(Polygon([a,b,move(b,n,20),move(a,n,20)]))
        elif s['code']=='CR':caps.append([move(a,n,.4),move(b,n,.4)])
    cut=unary_union([face]+strips)
    tag_envelope=cut
    run=20*math.tan(math.radians(47))
    relief_boundaries=[]
    shoulder_routes=[]
    joined_route_ends=[]
    for fi,fold in enumerate(geometry['finishedFoldLines']):
        left,right=sorted([fold[0],fold[-1]])
        for endpoint,(p,sign) in enumerate([(left,-1),(right,1)]):
            chosen=[r for r in spec.get('reliefEnds',[]) if r.get('fold')==fi and r.get('end')==endpoint]
            if len(chosen)>1:raise GeometryError('A fold endpoint has more than one relief selection.')
            if not chosen:
                cross=face.intersection(LineString([(face.bounds[0]-1,p[1]),(face.bounds[2]+1,p[1])]))
                target=cross.bounds[0 if endpoint==0 else 2]
                if abs(target-p[0])>2:
                    options=[]
                    for candidate in segments:
                        if candidate['code'] not in TAGS:continue
                        a,b=candidate['start'],candidate['end']
                        origin=min([a,b],key=lambda q:math.dist(p,q))
                        if math.dist(p,origin)>2 or math.dist(a,b)<2*run:continue
                        along=candidate['u'] if origin==a else tuple(-v for v in candidate['u'])
                        first=move(move(origin,along,run),candidate['n'],20)
                        last=move(move(origin,along,2*run),candidate['n'],20)
                        trial=Polygon([p,first,last])
                        result=cut.difference(trial)
                        if trial.intersection(face).area<=1e-6 and result.geom_type=='Polygon' and result.is_valid and not result.interiors:
                            options.append((abs(along[1]),candidate['edge']))
                    if options:chosen=[{'edge':min(options)[1]}]
            if chosen:
                edge=chosen[0].get('edge')
                candidates=[s for s in segments if s['edge']==edge and s['code'] in TAGS]
                if not candidates:raise GeometryError('The selected relief needs a tagged shoulder.')
                s=min(candidates,key=lambda s:min(math.dist(p,s['start']),math.dist(p,s['end'])))
                if min(math.dist(p,s['start']),math.dist(p,s['end']))>2:
                    raise GeometryError('The selected relief tag does not meet this fold endpoint.')
                a,b=s['start'],s['end'];origin=a if math.dist(p,a)<math.dist(p,b) else b
                along=s['u'] if origin==a else (-s['u'][0],-s['u'][1])
                # At a concave tagged shoulder, retain the material and route
                # from the fold corner to the intersection of the outer tag sides.
                joins=[]
                for other in segments:
                    if other is s or other['code'] not in TAGS:continue
                    if min(math.dist(origin,other['start']),math.dist(origin,other['end']))>2:continue
                    u,v=s['u'],other['u'];det=u[0]*v[1]-u[1]*v[0]
                    if abs(det)<1e-8:continue
                    q=move(origin,s['n'],20)
                    r=move(min([other['start'],other['end']],key=lambda x:math.dist(origin,x)),other['n'],20)
                    t=((r[0]-q[0])*v[1]-(r[1]-q[1])*v[0])/det
                    tip=move(q,u,t);route=LineString([p,tip])
                    if route.length>60 or route.length<.001:continue
                    if cut.buffer(1e-7).covers(route) and route.intersection(face).length<1e-6 and Point(tip).distance(cut.boundary)<1e-6:
                        joins.append(route)
                if len(joins)==1:
                    shoulder_routes.append(joins[0])
                    joined_route_ends.append(origin)
                    continue
                if math.dist(a,b)<2*run:raise GeometryError('The shoulder is too short for the selected relief.')
                relief=Polygon([p,move(move(origin,along,run),s['n'],20),move(move(origin,along,2*run),s['n'],20)])
            else:
                # At a convex transition, the adjoining regions can end a
                # fraction apart after their perpendicular offsets. Extend
                # the fold across that short boundary join to the outer side.
                y=p[1]
                cross=face.intersection(LineString([(face.bounds[0]-1,y),(face.bounds[2]+1,y)]))
                target=cross.bounds[0 if endpoint==0 else 2]
                if abs(target-p[0])>2:raise GeometryError('Select a relief tag for the fold at this shoulder.')
                p=(target,y)
                fold[0 if endpoint==0 else -1]=p
                x,y=p
                adjacent=[s for s in segments if LineString([s['start'],s['end']]).distance(Point(p))<.001 and s['code'] in TAGS]
                # A square tag is only 20 mm deep. Do not extend its notch
                # far enough to intersect a separate arm of a stepped panel.
                reach=20 if adjacent and all(abs(s['u'][0])<1e-8 for s in adjacent) else max(cut.bounds[2]-cut.bounds[0],cut.bounds[3]-cut.bounds[1])+40
                relief=Polygon([p,(x+sign*reach,y-run*reach/20),(x+sign*reach,y+run*reach/20)])
            if relief.intersection(face).area>1e-6:
                raise GeometryError('A fold relief enters the finished face. Select the adjoining tag for this junction.')
            relief_boundaries.append(relief.boundary)
            cut=cut.difference(relief)
    if cut.geom_type!='Polygon' or not cut.is_valid or cut.interiors:
        raise GeometryError('The angled tags and fold reliefs do not form one closed cut.')
    # Trim short square protrusions where a relief diagonal meets a tag side.
    # Stay within the original tags and preserve the finished face and one cut.
    relief_corners=[]
    changed=True
    while changed:
        changed=False;coords=list(cut.exterior.coords)[:-1]
        for i,b in enumerate(coords):
            a=coords[i-1];c=coords[(i+1)%len(coords)];d=coords[(i+2)%len(coords)]
            if math.dist(b,c)>20:continue
            u=(b[0]-a[0],b[1]-a[1]);v=(d[0]-c[0],d[1]-c[1])
            def relief_edge(start,end):
                if abs(start[0]-end[0])<1e-7 or abs(start[1]-end[1])<1e-7:return False
                line=LineString([start,end])
                return any(boundary.buffer(1e-6).covers(line) for boundary in relief_boundaries)
            if not (relief_edge(a,b) or relief_edge(c,d)):continue
            det=u[0]*v[1]-u[1]*v[0]
            if abs(det)<1e-8:continue
            t=((c[0]-a[0])*v[1]-(c[1]-a[1])*v[0])/det
            meet=(a[0]+t*u[0],a[1]+t*u[1])
            if max(math.dist(meet,b),math.dist(meet,c))>20:continue
            rotated=coords[i:]+coords[:i]
            candidate=Polygon([meet]+rotated[2:])
            if candidate.is_valid and not candidate.interiors and abs(cut.area-candidate.area)>1e-6 and candidate.difference(tag_envelope).area<1e-7 and face.difference(candidate).area<1e-7:
                cut=candidate;relief_corners.append(meet);changed=True;break
    routes=[LineString([f[0],f[-1]]) for f in geometry['finishedFoldLines']]+shoulder_routes
    # Connect a cleaned relief to the adjoining concave tagged corner.
    # This is a machining route through the tag, never through the face.
    for tip in relief_corners:
        options=[]
        for first in segments:
            if first['code'] not in TAGS:continue
            for second in segments:
                if second['code'] not in TAGS or math.dist(first['end'],second['start'])>.001:continue
                u,v=first['u'],second['u']
                if u[0]*v[1]-u[1]*v[0]>=-1e-8:continue
                corner=first['end'];route=LineString([corner,tip])
                if .001<route.length<=30 and cut.buffer(1e-7).covers(route) and route.intersection(face).length<1e-7:
                    options.append((route.length,route))
        if options:routes.append(min(options,key=lambda item:item[0])[1])
    holes=[];labels=[];dimensions=[]
    from panel_cad import hole_end_spans
    for s in segments:
        a,b,u,n=s['start'],s['end'],s['u'],s['n'];length=math.dist(a,b)
        if s['code'] in TAGS:
            start=a if any(math.dist(a,p)<2 for p in joined_route_ends) or face.contains(Point(move(a,u,-.01))) else move(a,u,-20)
            end=b if any(math.dist(b,p)<2 for p in joined_route_ends) or face.contains(Point(move(b,u,.01))) else move(b,u,20)
            path=LineString([start,end]).intersection(cut)
            parts=list(path.geoms) if hasattr(path,'geoms') else [path]
            wanted=[p for p in parts if p.geom_type=='LineString' and p.buffer(1e-7).covers(LineString([a,b]))]
            if len(wanted)!=1:raise GeometryError('An angled edge route is interrupted by a relief cut.')
            routes.append(wanted[0])
        labels.append((s['code'],move(move(a,u,length/2),n,-18)))
        dimensions.append((a,b,move(move(a,u,length/2),n,65),math.degrees(math.atan2(u[1],u[0]))%180))
    for s in segments:
        a,b,u,n=s['start'],s['end'],s['u'],s['n']
        if s['code'] not in {'B','S'}:continue
        # Determine usable drilling spans from the actual tag polygon after
        # reliefs, keeping the full hole and clearance inside the material.
        drilling=LineString([move(a,n,12),move(b,n,12)])
        spans=hole_end_spans(drilling,cut,routes,u)
        for span in spans:
            # Do not squeeze a pair of end holes into a short remaining span.
            if span.length<40:continue
            first,last=0.,span.length
            count=max(1,math.ceil((last-first)/300))
            for j in range(count+1):
                p=span.interpolate(first+(last-first)*j/count)
                if all(p.distance(r)>=3 for r in routes):holes.append((p.x,p.y))
    # Union overlapping fold/perimeter routes so a machining path is not cut twice.
    route_union=unary_union(routes)
    routes=list(route_union.geoms) if hasattr(route_union,'geoms') else [route_union]
    for r in routes:
        if r.geom_type!='LineString' or not cut.buffer(1e-7).covers(r):raise GeometryError('An angled route leaves the cut outline.')
    holes=list(dict.fromkeys((round(x,8),round(y,8)) for x,y in holes))
    for h in holes:
        p=Point(h)
        if not cut.contains(p.buffer(1.5)) or any(p.distance(r)<1.5 for r in routes):
            raise GeometryError('A hole intersects a route or cut boundary.')
    doc=ezdxf.new('R2010');doc.units=4;m=doc.modelspace()
    doc.styles.new('Arial',dxfattribs={'font':'arial.ttf'})
    for name,col in [('CUT',3),('ROUTE',1),('CAP ROUTE',5),('HOLES',4),('LABELS',7),('DIMENSIONS',7)]:doc.layers.new(name,dxfattribs={'color':col})
    m.add_lwpolyline(list(cut.exterior.coords)[:-1],close=True,dxfattribs={'layer':'CUT'})
    for r in routes:m.add_lwpolyline(list(r.coords),dxfattribs={'layer':'ROUTE'})
    for r in caps:m.add_lwpolyline(r,dxfattribs={'layer':'CAP ROUTE'})
    for p in holes:m.add_circle(p,1.5,dxfattribs={'layer':'HOLES'})
    for text,p in labels:m.add_mtext(text,dxfattribs={'layer':'LABELS','style':'Arial','char_height':18,'insert':p,'attachment_point':5})
    for a,b,base,angle in dimensions:
        m.add_linear_dim(base=base,p1=a,p2=b,angle=angle,override={'dimtxt':22,'dimtxsty':'Arial','dimasz':6,'dimdec':2},dxfattribs={'layer':'DIMENSIONS'}).render()
    from panel_cad import annotation_position,VECTORS
    direction=spec.get('panelDirection','none')
    if direction not in {'none',*VECTORS}:raise GeometryError('Choose a valid direction arrow.')
    from ezdxf import bbox
    obstacles=[r.buffer(10) for r in routes]+[Point(h).buffer(8) for h in holes]
    for e in m.query('MTEXT DIMENSION'):
        bounds=bbox.extents([e])
        if bounds.has_data:obstacles.append(box(bounds.extmin.x,bounds.extmin.y,bounds.extmax.x,bounds.extmax.y).buffer(10))
    anchor,_=annotation_position(face,panel,direction,obstacles)
    m.add_mtext(panel,dxfattribs={'layer':'LABELS','style':'Arial','char_height':28,'insert':anchor,'attachment_point':5})
    if direction in VECTORS:
        u=VECTORS[direction];n=(-u[1],u[0]);centre=(anchor[0],anchor[1]-55);tip=move(centre,u,30)
        for a,b in [(move(centre,u,-30),tip)]+[(move(move(tip,u,-12),n,s*7),tip) for s in (-1,1)]:m.add_line(a,b,dxfattribs={'layer':'LABELS'})
    # Keep machining lines visible where dimension extension lines overlap.
    ordered=sorted(m,key=lambda e:e.dxf.layer=='ROUTE')
    m.set_redraw_order((e.dxf.handle,format(i+1,'X')) for i,e in enumerate(ordered))
    stream=io.StringIO();doc.write(stream);saved=ezdxf.read(io.StringIO(stream.getvalue()));audit=saved.audit()
    if audit.errors or audit.fixes:raise GeometryError('Angled DXF validation failed.')
    backend=svg.SVGBackend();Frontend(RenderContext(saved),backend,config=Configuration(background_policy=BackgroundPolicy.WHITE,color_policy=ColorPolicy.COLOR)).draw_layout(saved.modelspace(),finalize=True)
    return {'ok':True,'filename':panel+'.dxf','dxf':stream.getvalue(),'svg':backend.get_string(layout.Page(360,300)),
            'geometry':geometry,'validation':{'closedCut':True,'holes':len(holes),'routes':len(routes),'stiffener':None,
            'ruleVersion':'measured-outline-2026-09-26','warnings':[]}}


