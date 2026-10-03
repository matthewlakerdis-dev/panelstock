"""Reconstruct sloping pack edges from written dimensions, never pixel scale."""
import copy
import math
from panel_cad import CadError
from outline_geometry import measured_outline


def measured_pack_spec(spec):
    result=copy.deepcopy(spec)
    if result.get('folds') or result.get('foldSectionsTop'):
        raise CadError('Sloping outlines require explicitly located fold endpoints, not an inferred vertical fold chain.')
    result['measuredEdges']=[];result['outlineSections']=[]
    solved=None
    if result.get('sourceConstraints'):
        from source_constraints import solve_vertices
        constraints=copy.deepcopy(result['sourceConstraints'])
        for i,edge in enumerate(result['edges']):
            if edge.get('lengthRole')=='true-length' and edge.get('site') is not None:
                constraints.append({'kind':'length','corners':[i,(i+1)%len(result['edges'])],'value':edge['site']})
        solved=solve_vertices(len(result['edges']),constraints)
    for i,edge in enumerate(result['edges']):
        kind=edge.get('kind')
        if kind not in ('horizontal','vertical','sloping'):
            raise CadError('Identify each edge as horizontal, vertical or sloping before calculating this outline.')
        current=edge['start'];following=result['edges'][(i+1)%len(result['edges'])]['start']
        sx=1 if following['x']>current['x'] else -1
        sy=1 if following['y']<current['y'] else -1
        def dimension(key):
            value=edge.get(key)
            if value is None:return None
            if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 0<value<=10000:
                raise CadError('Invalid written '+key+' on edge '+str(i+1)+'.')
            return float(value)
        length=dimension('site');width=dimension('horizontalSpan');height=dimension('verticalSpan')
        role=edge.get('lengthRole','true-length')
        if role not in ('true-length','horizontal-projection','vertical-projection'):
            raise CadError('Resolve the measurement role on edge '+str(i+1)+'.')
        if (kind=='horizontal' and role=='vertical-projection' or
                kind=='vertical' and role=='horizontal-projection'):
            raise CadError('Measurement projection conflicts with the edge direction.')
        if solved is not None:
            a,b=solved[i],solved[(i+1)%len(solved)];dx=b[0]-a[0];dy=b[1]-a[1]
            if kind=='horizontal' and abs(dy)>.001 or kind=='vertical' and abs(dx)>.001:
                raise CadError('Solved outline conflicts with an explicit edge direction.')
            for stated,actual in [(width,abs(dx)),(height,abs(dy)),(length,math.hypot(dx,dy) if role=='true-length' else abs(dx) if role=='horizontal-projection' else abs(dy) if role=='vertical-projection' else None)]:
                if stated is not None and actual is not None and abs(stated-actual)>.001:
                    raise CadError('Solved outline conflicts with a written edge measurement.')
            result['measuredEdges'].append({'dx':dx,'dy':dy,'code':edge['code']})
            written={key:value for key,value in [('width',width),('height',height),('site',length if role=='true-length' else None)] if value is not None}
            result['outlineSections'].append({'kind':kind,'code':edge['code'],'site':length if role=='true-length' else None,
                                             'manualMeasurements':written,'inferredMeasurements':{'width':abs(dx),'height':abs(dy)}})
            continue
        if kind=='horizontal':
            if height is not None:raise CadError('A horizontal edge has a conflicting vertical span.')
            width=width if width is not None else length;height=0
            if width is None:raise CadError('Missing horizontal length on edge '+str(i+1)+'.')
            if length is not None and abs(length-width)>.01:raise CadError('Horizontal edge dimensions disagree.')
        elif kind=='vertical':
            if width is not None:raise CadError('A vertical edge has a conflicting horizontal span.')
            height=height if height is not None else length;width=0
            if height is None:raise CadError('Missing vertical length on edge '+str(i+1)+'.')
            if length is not None and abs(length-height)>.01:raise CadError('Vertical edge dimensions disagree.')
        else:
            if role=='horizontal-projection':
                if width is not None and length is not None and abs(width-length)>.01:raise CadError('Horizontal projection dimensions disagree.')
                width=width if width is not None else length
            elif role=='vertical-projection':
                if height is not None and length is not None and abs(height-length)>.01:raise CadError('Vertical projection dimensions disagree.')
                height=height if height is not None else length
            elif role=='true-length' and length is not None:
                if width is None and height is not None and length>height:width=math.sqrt(length*length-height*height)
                elif height is None and width is not None and length>width:height=math.sqrt(length*length-width*width)
            if width is None or height is None:
                raise CadError('Edge '+str(i+1)+': a sloping length alone does not determine its angle. A written horizontal or vertical offset is needed.')
            if role=='true-length' and length is not None and abs(math.hypot(width,height)-length)>.01:
                raise CadError('Edge '+str(i+1)+': written slope length conflicts with its horizontal and vertical offsets.')
        dx=sx*width;dy=sy*height
        result['measuredEdges'].append({'dx':dx,'dy':dy,'code':edge['code']})
        result['outlineSections'].append({'kind':kind,'code':edge['code'],'site':length if role=='true-length' else None,
            'width':width,'height':height,'manualMeasurements':{'width':width,'height':height}})
    points,_=measured_outline(result['measuredEdges'])
    from source_amendments import amend_vertices
    amended,audit=amend_vertices(points,result.get('amendments',[]))
    result['amendmentAudit']=audit
    if audit:
        result['unamendedMeasuredEdges']=copy.deepcopy(result['measuredEdges'])
        for i,(a,b) in enumerate(zip(amended,amended[1:]+amended[:1])):
            result['measuredEdges'][i].update(dx=b[0]-a[0],dy=b[1]-a[1])
            # The source transcription remains in edges/unamendedMeasuredEdges.
            # These derived targets explicitly record the requested movements.
            section=result['outlineSections'][i]
            section['sourceSite']=section.get('site')
            section['sourceMeasurements']={key:copy.deepcopy(result['edges'][i].get(key))
                for key in ('site','horizontalSpan','verticalSpan','lengthRole')}
            section['amendedTarget']={'length':math.dist(a,b),
                'width':abs(b[0]-a[0]),'height':abs(b[1]-a[1])}
            if section.get('site') is not None:section['site']=math.dist(a,b)
        measured_outline(result['measuredEdges']) # reject inverted/self-crossing amendments
        points,_=measured_outline(result['measuredEdges'])

    result['measuredFolds']=[]
    for fold in result.get('internalFoldEdges',[]):
        start,end=fold.get('startCorner'),fold.get('endCorner')
        if any(type(v) is not int or not 0<=v<len(points) for v in (start,end)) or start==end:
            raise CadError('A fold refers to invalid perimeter corners.')
        a,b=points[start],points[end]
        result['measuredFolds'].append({'start':{'x':a[0],'y':a[1]},'end':{'x':b[0],'y':b[1]}})
    result['rightAngles']=[];result['reliefEnds']=[]
    return result
