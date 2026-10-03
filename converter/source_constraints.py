"""Solve written vertex constraints without using sketch scale or pixel angles.

Exact dimensions are never relaxed to produce a drawing. Ambiguous, incomplete,
or inconsistent systems remain blocked. This solver returns nominal geometry;
manufacturing allowances are applied by the existing measured-outline path.
"""
import math
import numpy as np
from shapely.geometry import Polygon
from outline_geometry import GeometryError


def solve_vertices(count, constraints):
    if type(count) is not int or not 3<=count<=16:
        raise GeometryError('Connected measurements support 3 to 16 perimeter corners.')
    if not isinstance(constraints,list) or not 1<=len(constraints)<=100:
        raise GeometryError('Supply the written corner measurements and relationships.')
    records=[];lengths=[]
    for raw in constraints:
        if not isinstance(raw,dict):
            raise GeometryError('Each source measurement must be a relationship record.')
        kind=raw.get('kind');corners=raw.get('corners');value=raw.get('value')
        expected=4 if kind in ('parallel','perpendicular') else 2
        if kind not in ('dx','dy','length','parallel','perpendicular','above','rightOf'):
            raise GeometryError('Unknown source measurement relationship.')
        if not isinstance(corners,list) or len(corners)!=expected or any(type(i) is not int or not 0<=i<count for i in corners):
            raise GeometryError('A source measurement references an invalid corner.')
        if corners[0]==corners[1] or (expected==4 and corners[2]==corners[3]):
            raise GeometryError('A source measurement has identical endpoints.')
        if kind in ('dx','dy','length'):
            if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or abs(value)>10000 or (kind=='length' and value<=0):
                raise GeometryError('Invalid written source measurement.')
            if value:lengths.append(abs(value))
        records.append((kind,corners,value))
    scale=max(lengths,default=1000)
    equations=[r for r in records if r[0] not in ('above','rightOf')]
    if len(equations)<2*count-2:raise GeometryError('More written measurements are needed to determine this panel.')

    def points(x):return np.vstack((np.zeros(2),x.reshape((-1,2))))
    def residual(x):
        p=points(x);out=[]
        for kind,ids,value in equations:
            u=p[ids[1]]-p[ids[0]]
            if kind=='dx':out.append(u[0]-value/scale)
            elif kind=='dy':out.append(u[1]-value/scale)
            elif kind=='length':out.append(np.linalg.norm(u)-value/scale)
            else:
                v=p[ids[3]]-p[ids[2]]
                denominator=max(np.linalg.norm(u)*np.linalg.norm(v),1e-12)
                out.append((np.dot(u,v) if kind=='perpendicular' else u[0]*v[1]-u[1]*v[0])/denominator)
        for kind,ids,_ in records:
            if kind in ('above','rightOf'):
                out.append(max(0.,.002/scale-(p[ids[1]][1 if kind=='above' else 0]-p[ids[0]][1 if kind=='above' else 0])))
        return np.array(out)
    def jacobian(x,r):
        columns=[]
        for i in range(len(x)):
            step=1e-6;other=x.copy();other[i]+=step
            columns.append((residual(other)-r)/step)
        return np.array(columns).T
    solutions=[];rank_deficient=False
    # Independent numerical seeds; no sketch coordinates are accepted here.
    rng=np.random.default_rng(425)
    for attempt in range(16):
        angles=np.arange(count)*2*math.pi/count-math.pi/2
        seed=np.column_stack((np.cos(angles),np.sin(angles)))
        if attempt:seed+=rng.normal(0,.6,size=seed.shape)
        seed-=seed[0];x=seed[1:].reshape(-1);damping=1e-3
        for _ in range(180):
            r=residual(x)
            if np.max(np.abs(r))<1e-9:break
            j=jacobian(x,r)
            delta=np.linalg.lstsq(np.vstack((j,math.sqrt(damping)*np.eye(len(x)))),np.concatenate((-r,np.zeros(len(x)))),rcond=None)[0]
            candidate=x+delta
            if np.dot(residual(candidate),residual(candidate))<np.dot(r,r):
                x=candidate;damping=max(damping/3,1e-10)
            else:damping=min(damping*10,1e8)
            if damping>=1e8:break
        r=residual(x)
        if np.max(np.abs(r))>1e-8:continue
        p=points(x)*scale;poly=Polygon(p)
        if not poly.is_valid or not poly.exterior.is_ccw or poly.area<1:continue
        if max(abs(v) for v in p.reshape(-1))>10000:continue
        if any((p[ids[1]][1 if kind=='above' else 0]-p[ids[0]][1 if kind=='above' else 0])<=.001 for kind,ids,_ in records if kind in ('above','rightOf')):continue
        singular=np.linalg.svd(jacobian(x,r),compute_uv=False)
        if sum(singular>max(singular)*1e-7)<len(x):
            rank_deficient=True;continue
        if not any(np.max(np.abs(p-other))<.001 for other in solutions):solutions.append(p)
        if len(solutions)>1:raise GeometryError('Written measurements allow more than one panel shape; add a controlling measurement.')
    if not solutions:
        if rank_deficient:raise GeometryError('Written measurements leave the panel shape underdetermined.')
        raise GeometryError('Written measurements could not be solved consistently; review their endpoints.')
    return [tuple(float(v) for v in p) for p in solutions[0]]
