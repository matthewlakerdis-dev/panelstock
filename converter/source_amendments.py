"""Endpoint amendments and already-developed faces; no reference CAD input."""
import math
from shapely.geometry import LineString, Polygon
from shapely.ops import split, snap
from outline_geometry import GeometryError


def amend_vertices(points, amendments):
    if not isinstance(amendments,list) or len(amendments)>32:
        raise GeometryError('Use at most 32 explicit endpoint amendments.')
    result=list(points);audit=[];seen=set()
    for item in amendments:
        if not isinstance(item,dict) or item.get('endpointStatus')!='resolved' or not isinstance(item.get('evidence'),str) or not item['evidence'].strip():
            raise GeometryError('Amendment endpoints need resolved source arrow/witness evidence.')
        corner=item.get('corner')
        if type(corner) is not int or not 0<=corner<len(points):
            raise GeometryError('Amendment refers to an invalid corner.')
        if corner in seen:raise GeometryError('Multiple amendments at one corner require review.')
        seen.add(corner)
        delta=[]
        for axis in ('dx','dy'):
            value=item.get(axis)
            if isinstance(value,bool) or not isinstance(value,(float,int)) or not math.isfinite(value) or abs(value)>10000:
                raise GeometryError('Amendment needs finite signed dx and dy movements.')
            delta.append(float(value))
        if delta==[0.,0.]:raise GeometryError('An amendment must move its endpoint.')
        before=points[corner];after=tuple(before[i]+delta[i] for i in range(2))
        result[corner]=after
        audit.append({'corner':corner,'before':list(before),'movement':delta,'after':list(after),
                      'evidence':item['evidence'].strip(),'coordinateFrame':'unamended-source-origin'})
    return result,sorted(audit,key=lambda row:row['corner'])


def developed_regions(result):
    """Validate and partition a developed face without any second deduction.

    Edge codes still drive the existing standard returns/holes/reliefs. Hence a
    complete CUT outline is deliberately not accepted as a dimensioned face.
    """
    if result.get('developedBoundary')!='face-before-edge-returns':
        raise GeometryError('Confirm the developed face boundary before generated edge returns.')
    if result.get('measurementConstraints'):
        raise GeometryError('Additional finished constraints on a developed face require review.')
    points=[(p['x'],p['y']) for p in result['sitePoints']]
    face=Polygon(points);regions=[face]
    folds=[snap(LineString([(f['start']['x'],f['start']['y']),(f['end']['x'],f['end']['y'])]),face,1e-7)
           for f in result.get('measuredFolds',[])]
    for i,fold in enumerate(folds):
        if any(not fold.intersection(other).is_empty for other in folds[:i]):
            raise GeometryError('Intersecting folds need an explicit junction design.')
        pieces=[piece for region in regions for piece in split(region,fold).geoms]
        if len(pieces)!=len(regions)+1:
            raise GeometryError('Each marked fold must divide one panel region into two.')
        regions=pieces
    outlines=[list(p.exterior.coords)[:-1] for p in regions]
    result.update(siteRegions=outlines,finishedRegions=outlines,
                  finishedFace=points,finishedFoldLines=[list(f.coords) for f in folds],
                  finishedOuterSegments=[{'start':p,'end':points[(i+1)%len(points)],'edge':i,
                                          'code':result['measuredEdges'][i]['code']} for i,p in enumerate(points)],
                  calculationStage='already-developed face; tag machining pending')
    return result
