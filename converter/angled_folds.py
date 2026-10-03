"""Develop non-crossing, differently angled folds from measured coordinates."""
import math
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import split, unary_union, snap, linemerge
from outline_geometry import GeometryError, offset_perimeter


def finish_angled_regions(result):
    if result.get('measurementConstraints'):
        raise GeometryError('Finished projection constraints need review for differently angled folds.')
    points=[(p['x'],p['y']) for p in result['sitePoints']]
    face=Polygon(points)
    folds=[LineString([(f['start']['x'],f['start']['y']),(f['end']['x'],f['end']['y'])]) for f in result['measuredFolds']]
    folds=[snap(fold,face,1e-7) for fold in folds]
    for i,fold in enumerate(folds):
        for other in folds[:i]:
            if not fold.intersection(other).is_empty:
                raise GeometryError('Intersecting folds need an explicit junction design.')
    regions=[face]
    for fold in folds:
        pieces=[piece for region in regions for piece in split(region,fold).geoms]
        if len(pieces)!=len(regions)+1:
            raise GeometryError('Each marked fold must divide one panel region into two.')
        regions=pieces
    graph={i:[] for i in range(len(regions))};owners=[]
    for fi,fold in enumerate(folds):
        adjacent=[i for i,p in enumerate(regions) if p.boundary.intersection(fold).length>.001]
        if len(adjacent)!=2:raise GeometryError('A fold must have exactly two adjoining regions.')
        a,b=adjacent;owners.append((a,b))
        graph[a].append((b,fi));graph[b].append((a,fi))
    anchor=min(graph,key=lambda i:(regions[i].centroid.y,regions[i].centroid.x))
    shifts={anchor:(0.,0.)};pending=[anchor]
    while pending:
        a=pending.pop()
        for b,fi in graph[a]:
            if b in shifts:continue
            p,q=folds[fi].coords;length=math.dist(p,q)
            normal=(-(q[1]-p[1])/length,(q[0]-p[0])/length)
            centre=regions[b].representative_point()
            side=1 if (centre.x-p[0])*normal[0]+(centre.y-p[1])*normal[1]>0 else -1
            shifts[b]=(shifts[a][0]-2*side*normal[0],shifts[a][1]-2*side*normal[1]);pending.append(b)
    if len(shifts)!=len(regions):raise GeometryError('Fold regions are disconnected.')
    finished=[];segments=[]
    for ri,region in enumerate(regions):
        coords=list(region.exterior.coords)[:-1]
        if not region.exterior.is_ccw:coords.reverse()
        edges=[];sources=[]
        for i,p in enumerate(coords):
            q=coords[(i+1)%len(coords)];mid=Point((p[0]+q[0])/2,(p[1]+q[1])/2)
            source=next((j for j,v in enumerate(points) if LineString([v,points[(j+1)%len(points)]]).distance(mid)<.001),None)
            code=result['measuredEdges'][source]['code'] if source is not None else 'B'
            edges.append({'dx':q[0]-p[0],'dy':q[1]-p[1],'code':code});sources.append(source)
        inset=offset_perimeter({'measuredEdges':edges,'_perpendicularOffsets':True})
        dx,dy=shifts[ri]
        vertices=[(p['x']+coords[0][0]+dx,p['y']+coords[0][1]+dy) for p in inset['perimeterOffsetPoints']]
        finished.append(Polygon(vertices))
        for i,source in enumerate(sources):
            if source is not None:segments.append({'start':vertices[i],'end':vertices[(i+1)%len(vertices)],'edge':source,'code':edges[i]['code']})
    # Snap only floating-point noise at shared edges; never bridge a real gap.
    for a,b in owners:
        finished[a]=snap(finished[a],finished[b],1e-7)
        finished[b]=snap(finished[b],finished[a],1e-7)
    united=unary_union(finished)
    if united.geom_type!='Polygon' or not united.is_valid or united.interiors:
        raise GeometryError('Angled fold allowances do not form one continuous finished face.')
    if sum(p.area for p in finished)-united.area>1e-5:
        raise GeometryError('Angled fold allowances overlap finished regions.')
    routes=[]
    for a,b in owners:
        shared=finished[a].boundary.intersection(finished[b].boundary)
        if shared.geom_type=='MultiLineString':shared=linemerge(shared)
        if shared.geom_type!='LineString' or shared.length<.001:
            raise GeometryError('An angled fold has no continuous shared route.')
        routes.append(list(shared.coords))
    result.update(siteRegions=[list(p.exterior.coords)[:-1] for p in regions],
                  finishedRegions=[list(p.exterior.coords)[:-1] for p in finished],
                  finishedFace=list(united.exterior.coords)[:-1],finishedFoldLines=routes,
                  finishedOuterSegments=segments,perpendicularFoldOffsets=True,
                  calculationStage='finished face; tag machining pending')
    return result
