"""Measured outline geometry, independent of the machining allowance policy.

Coordinates are reconstructed from explicit mm components, never sketch pixels.
Angle constraints refer to a particular side at a particular fold endpoint.
"""
import copy
import math
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import split, unary_union, linemerge
from shapely.affinity import translate

class GeometryError(ValueError):
    pass

def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise GeometryError(f'{label} must be a finite measurement in mm.')
    if abs(value)>10000:
        raise GeometryError(f'{label} exceeds 10000 mm.')
    return float(value)

def measured_outline(edges):
    if not isinstance(edges,list) or not 3<=len(edges)<=64:
        raise GeometryError('An outline needs 3 to 64 measured edges.')
    points=[];x=y=0.
    for i,edge in enumerate(edges):
        dx=finite(edge.get('dx'),f'Edge {i+1} horizontal distance')
        dy=finite(edge.get('dy'),f'Edge {i+1} vertical distance')
        if math.hypot(dx,dy)<.001:
            raise GeometryError(f'Edge {i+1} has no length.')
        points.append((x,y));x+=dx;y+=dy
    if math.hypot(x,y)>.001:
        raise GeometryError(f'Outline does not close: {x:g} mm horizontal, {y:g} mm vertical.')
    face=Polygon(points)
    if not face.is_valid or face.area<1 or not face.exterior.is_ccw:
        raise GeometryError('Outline must be simple and counterclockwise.')
    return points,face

def index(value,size,label):
    if isinstance(value,bool) or not isinstance(value,int) or not 0<=value<size:
        raise GeometryError(f'{label} is not a valid reference.')
    return value

def validate_measured_draft(draft):
    result=copy.deepcopy(draft)
    points,face=measured_outline(result['measuredEdges'])
    if not isinstance(result.get('measuredFolds',[]),list) or len(result.get('measuredFolds',[]))>12:
        raise GeometryError('Use at most 12 marked internal folds.')
    for key in ['rightAngles','reliefEnds']:
        if not isinstance(result.get(key,[]),list) or len(result.get(key,[]))>24:
            raise GeometryError('Use at most one constraint of each kind per fold endpoint.')
    lines=[]
    for i,fold in enumerate(result.get('measuredFolds',[])):
        ends=[]
        for label in ['start','end']:
            p=fold.get(label,{})
            ends.append((finite(p.get('x'),f'Fold {i+1} {label} x'),finite(p.get('y'),f'Fold {i+1} {label} y')))
        line=LineString(ends)
        if line.length<.001 or not face.buffer(1e-7).covers(line):
            raise GeometryError(f'Fold {i+1} must stay inside the panel.')
        if any(face.boundary.distance(Point(p))>.001 for p in ends):
            raise GeometryError(f'Fold {i+1} endpoints must meet the outline.')
        # A line on the perimeter is an edge, not an internal fold.
        if not face.contains(line.interpolate(.5,normalized=True)):
            raise GeometryError(f'Fold {i+1} must cross the interior.')
        for j,other in enumerate(lines):
            if line.equals(other):raise GeometryError(f'Fold {i+1} duplicates fold {j+1}.')
        lines.append(line)
    for constraint in result.get('rightAngles',[]):
        fi=index(constraint.get('fold'),len(lines),'Fold')
        endpoint=index(constraint.get('end'),2,'Fold endpoint')
        ei=index(constraint.get('edge'),len(points),'Side edge')
        line=lines[fi];a,b=points[ei],points[(ei+1)%len(points)]
        if LineString([a,b]).distance(Point(line.coords[endpoint]))>.001:
            raise GeometryError(f'Fold {fi+1} does not meet the selected side.')
        u=(b[0]-a[0],b[1]-a[1]);p,q=line.coords
        v=(q[0]-p[0],q[1]-p[1])
        cosine=abs(u[0]*v[0]+u[1]*v[1])/(math.hypot(*u)*math.hypot(*v))
        if cosine>1e-8:
            raise GeometryError(f'Fold {fi+1} must meet edge {ei+1} at 90 degrees.')
    result['sitePoints']=[{'x':x,'y':y} for x,y in points]
    for edge in result['measuredEdges']:
        edge['siteLength']=math.hypot(edge['dx'],edge['dy'])
    return result

def offset_perimeter(draft):
    """Intersect inward-offset lines; does not apply internal fold deductions.

    Each tagged perimeter line moves inward exactly 1 mm perpendicular to
    itself. FE and CR retain their original face line. Reject collapsed or
    inverted results rather than adjusting measurements to force closure.
    """
    result=validate_measured_draft(draft)
    points=[(p['x'],p['y']) for p in result['sitePoints']]
    face=Polygon(points);lines=[]
    for i,e in enumerate(result['measuredEdges']):
        if e.get('code') not in {'B','S','NT','RE','FE','CR'}:
            raise GeometryError(f'Edge {i+1} needs a valid tag type.')
        a,b=points[i],points[(i+1)%len(points)]
        length=math.dist(a,b);u=((b[0]-a[0])/length,(b[1]-a[1])/length)
        allowance=1. if e['code'] in {'B','S','NT','RE'} else 0.
        lines.append(((a[0]-u[1]*allowance,a[1]+u[0]*allowance),u,allowance))
    cross=lambda a,b:a[0]*b[1]-a[1]*b[0]
    shifted=[]
    for i,(q,v,_) in enumerate(lines):
        p,u,_=lines[i-1];det=cross(u,v)
        if abs(det)<1e-10:
            if u[0]*v[0]+u[1]*v[1]>0 and abs(cross((q[0]-p[0],q[1]-p[1]),u))<1e-7:
                shifted.append(q)
                continue
            raise GeometryError(f'Corner {i+1} needs an explicit collinear transition.')
        t=cross((q[0]-p[0],q[1]-p[1]),v)/det
        shifted.append((p[0]+t*u[0],p[1]+t*u[1]))
    inner=Polygon(shifted)
    if not inner.is_valid or not inner.exterior.is_ccw or inner.area<.001 or not face.buffer(1e-7).covers(inner):
        raise GeometryError('Perimeter deductions collapse or cross the panel outline.')
    for i,(_,u,_) in enumerate(lines):
        a,b=shifted[i],shifted[(i+1)%len(shifted)]
        if (b[0]-a[0])*u[0]+(b[1]-a[1])*u[1]<.001:
            raise GeometryError(f'Perimeter deductions reverse edge {i+1}.')
    result['perimeterOffsetPoints']=[{'x':x,'y':y} for x,y in shifted]
    result['calculationStage']='perimeter-only; internal fold deductions pending'
    return result

def finish_regions(draft):
    """Deduct each horizontal internal fold on both adjoining sheet regions.

    Regions are offset independently, then translated by the removed bend
    allowances. This avoids treating a sloping edge's length as a horizontal
    dimension and supports folds ending at a change in perimeter direction.
    """
    result=validate_measured_draft(draft)
    points=[(p['x'],p['y']) for p in result['sitePoints']]
    face=Polygon(points);regions=[face]
    fold_lines=[LineString([(f['start']['x'],f['start']['y']),(f['end']['x'],f['end']['y'])]) for f in result.get('measuredFolds',[])]
    if any(abs(f.coords[0][1]-f.coords[1][1])>.001 for f in fold_lines):
        raise GeometryError('This measured-outline calculation currently requires horizontal internal folds.')
    levels=sorted(set(f.coords[0][1] for f in fold_lines))
    for line in fold_lines:
        y=line.coords[0][1]
        full=face.intersection(LineString([(face.bounds[0]-1,y),(face.bounds[2]+1,y)]))
        # Perimeter-coincident portions are not internal folds; compare only
        # the user's segment and ensure it actually partitions material.
        new=[];count=0
        for region in regions:
            pieces=list(split(region,line).geoms)
            count+=len(pieces)-1;new.extend(pieces)
        if count!=1:raise GeometryError('Each marked fold must divide one panel region into two.')
        regions=new
    finished=[];outer_segments=[]
    for region in regions:
        if not region.exterior.is_ccw:region=Polygon(list(region.exterior.coords)[::-1])
        coords=list(region.exterior.coords)[:-1]
        # Keep collinear vertices: one portion can be a fold and the next an
        # exposed tagged shoulder, even though they share a straight line.
        edges=[];sources=[]
        for i,a in enumerate(coords):
            b=coords[(i+1)%len(coords)];mid=LineString([a,b]).interpolate(.5,normalized=True)
            original=next((j for j,p in enumerate(points) if LineString([p,points[(j+1)%len(points)]]).distance(mid)<.001),None)
            code=result['measuredEdges'][original]['code'] if original is not None else 'B'
            edges.append({'dx':b[0]-a[0],'dy':b[1]-a[1],'code':code})
            sources.append(original)
        # offset_perimeter works from a zero origin; restore region placement.
        inset=offset_perimeter({'measuredEdges':edges})
        shift=2*sum(region.representative_point().y>y for y in levels)
        poly=Polygon([(p['x']+coords[0][0],p['y']+coords[0][1]-shift) for p in inset['perimeterOffsetPoints']])
        finished.append(poly)
        finished_coords=list(poly.exterior.coords)[:-1]
        for i,source in enumerate(sources):
            if source is not None:
                outer_segments.append({'start':finished_coords[i],'end':finished_coords[(i+1)%len(finished_coords)],
                                       'edge':source,'code':edges[i]['code']})
    united=unary_union(finished)
    if united.geom_type!='Polygon' or not united.is_valid or united.interiors:
        raise GeometryError('Fold deductions do not join into one continuous finished face.')
    routes=[]
    for fold in fold_lines:
        y=fold.coords[0][1];line_y=y-1-2*levels.index(y)
        probe=LineString([(united.bounds[0]-1,line_y),(united.bounds[2]+1,line_y)])
        shared=[]
        for j,a in enumerate(regions):
            for k in range(j+1,len(regions)):
                # Match each fold to its own adjoining regions, not every
                # segment at that height. Never bridge an opening.
                if sum(abs(other.coords[0][1]-y)<.001 for other in fold_lines)>1 and a.boundary.intersection(regions[k].boundary).intersection(fold).length<.001:continue
                intersection=finished[j].boundary.intersection(finished[k].boundary).intersection(probe)
                if intersection.length>.001:shared.append(intersection)
        cut=unary_union(shared)
        if cut.geom_type=='MultiLineString':cut=linemerge(cut)
        if cut.geom_type!='LineString' or cut.length<.001:
            raise GeometryError('A finished fold does not cross the finished face.')
        routes.append(sorted(cut.coords) if sum(abs(other.coords[0][1]-y)<.001 for other in fold_lines)>1 else list(cut.coords))
    result['siteRegions']=[list(p.exterior.coords)[:-1] for p in regions]
    result['finishedRegions']=[list(p.exterior.coords)[:-1] for p in finished]
    result['finishedFace']=list(united.exterior.coords)[:-1]
    result['finishedFoldLines']=routes
    result['finishedOuterSegments']=outer_segments
    result['calculationStage']='finished face; tag machining pending'
    return result

