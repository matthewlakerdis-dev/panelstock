"""User-positioned circular holes, measured from the finished face bounds."""
import math
from shapely.geometry import Point,LineString

def manual_holes(spec,face,cut,routes,automatic,stiffeners=()):
    from panel_cad import CadError
    values=spec.get('manualHoles',[])
    if not isinstance(values,list) or len(values)>200:
        raise CadError('Enter up to 200 manual holes.')
    ox,oy,_,_=face.bounds
    paths=[r if hasattr(r,'geom_type') else LineString(r) for r in routes]
    holes=[]
    for i,value in enumerate(values):
        if not isinstance(value,dict):raise CadError('Invalid manual hole.')
        numbers=[value.get(k) for k in ('x','y','diameter')]
        if any(isinstance(n,bool) or not isinstance(n,(int,float)) or not math.isfinite(n) for n in numbers):
            raise CadError(f'Manual hole {i+1}: enter valid offsets and diameter.')
        x,y,diameter=numbers;r=diameter/2
        if spec.get('_manualHoleRotation'):
            x,y=face.bounds[2]-ox-y,x
        if diameter<=0:raise CadError(f'Manual hole {i+1}: diameter must be greater than zero.')
        centre=(ox+x,oy+y);point=Point(centre)
        if not cut.contains(point) or point.distance(cut.boundary)<=r+1e-6:
            raise CadError(f'Manual hole {i+1} touches or crosses the cut edge.')
        if any(point.distance(path)<=r+1e-6 for path in paths):
            raise CadError(f'Manual hole {i+1} touches or crosses a route line.')
        if any(point.distance(Point(p))<=r+1.5+1e-6 for p in automatic) or any(math.dist(centre,h['centre'])<=r+h['radius']+1e-6 for h in holes):
            raise CadError(f'Manual hole {i+1} overlaps another hole.')
        if any(point.distance(LineString([s['start'],s['end']]))<=r+1e-6 for s in stiffeners):
            raise CadError(f'Manual hole {i+1} crosses a stiffener.')
        holes.append({'centre':centre,'radius':r})
    layout={'origin':[ox,oy],'cut':list(cut.exterior.coords),'face':list(face.exterior.coords),
            'routes':[list(p.coords) for p in paths],
            'automaticHoles':[{'x':p[0],'y':p[1],'diameter':3} for p in automatic],
            'stiffeners':[[s['start'],s['end']] for s in stiffeners]}
    return holes,layout
