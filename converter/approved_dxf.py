"""Import explicitly approved developed CAD without reapplying allowances."""
import base64
import hashlib
import io
import math
import re
import tempfile
from pathlib import Path
import ezdxf
from ezdxf.math import Matrix44
from ezdxf.addons.drawing import RenderContext, Frontend, svg, layout
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy, ColorPolicy
from shapely.geometry import Polygon, LineString, Point
from panel_cad import CadError


def path_points(entity):
    if entity.dxftype() == 'LINE':
        return [tuple(entity.dxf.start)[:2], tuple(entity.dxf.end)[:2]]
    if entity.dxftype() == 'LWPOLYLINE':
        if any(abs(p[4])>1e-9 for p in entity.get_points()):
            raise CadError('Approved CAD contains curved segments; this import currently requires straight cut and route lines.')
        points=list(entity.get_points('xy'))
        return points+[points[0]] if entity.closed else points
    raise CadError('Unsupported machining entity in approved CAD: '+entity.dxftype())


def import_approved(body):
    if body.get('approved') is not True:
        raise CadError('Confirm this DXF is the approved developed drawing.')
    if body.get('nonDirectional') is not True:
        raise CadError('Approved DXF import currently requires confirmed non-directional stock.')
    try:
        raw=base64.b64decode(body.get('data',''),validate=True)
        if not 1<=len(raw)<=6*1024*1024:raise ValueError()
        with tempfile.TemporaryDirectory(prefix='approved-cad-') as folder:
            path=Path(folder,'source.dxf');path.write_bytes(raw)
            source=ezdxf.readfile(path)
    except (ValueError,TypeError,UnicodeError,ezdxf.DXFError):
        raise CadError('Upload a valid DXF no larger than 6 MB.') from None
    if source.units!=4:raise CadError('The approved DXF must explicitly use millimetres.')
    model=source.modelspace()
    if len(model)>20000:raise CadError('Approved CAD has too many entities.')
    allowed={'0','CUT','ROUTE','CAP ROUTE','HOLES','LABELS','LABLES','DIMS','DIMENSIONS'}
    if any(e.dxf.layer.upper() not in allowed for e in model):
        raise CadError('Approved CAD contains an unrecognised layer. Map machining layers to CUT, ROUTE or HOLES before importing.')
    cuts=[]
    for entity in model:
        if entity.dxf.layer.upper()!='CUT':continue
        if entity.dxftype()!='LWPOLYLINE' or not entity.closed:raise CadError('Every CUT entity must be one closed straight polyline.')
        points=path_points(entity)
        if len(points)>2000 or any(not math.isfinite(v) for p in points for v in p):raise CadError('Invalid approved cut coordinates.')
        shape=Polygon(points)
        if not shape.is_valid or shape.area<1:raise CadError('An approved cut outline is invalid.')
        if any(shape.intersects(other[1]) for other in cuts):raise CadError('Approved cut outlines overlap or touch.')
        cuts.append((entity,shape))
    if not 1<=len(cuts)<=30:raise CadError('Approved CAD must contain 1 to 30 separate CUT outlines.')
    assigned=[[] for _ in cuts]
    for entity in model:
        layer=entity.dxf.layer.upper()
        if layer not in ('ROUTE','CAP ROUTE','HOLES'):continue
        if entity.dxftype()=='CIRCLE' and layer=='HOLES':
            if not 0<entity.dxf.radius<=100:raise CadError('Invalid approved hole diameter.')
            geometry=Point(entity.dxf.center.x,entity.dxf.center.y).buffer(entity.dxf.radius)
        else:geometry=LineString(path_points(entity))
        owners=[i for i,(_,shape) in enumerate(cuts) if shape.buffer(.01).covers(geometry)]
        if len(owners)!=1:raise CadError('An approved route or hole leaves its cut outline or cannot be assigned to one panel.')
        assigned[owners[0]].append(entity)
    panels=[];names=set();source_hash=hashlib.sha256(raw).hexdigest()
    for i,(cut,shape) in enumerate(cuts):
        labels=[e for e in model if e.dxftype() in ('TEXT','MTEXT') and e.dxf.layer.upper() in ('LABELS','LABLES') and shape.covers(Point(e.dxf.insert.x,e.dxf.insert.y))]
        # Ignore fabrication edge-code annotations when locating the panel name.
        labels=[e for e in labels if (e.plain_text() if e.dxftype()=='MTEXT' else e.dxf.text).strip().upper() not in {'B','S','ES','NT','RE','FE','CR'}]
        if len(labels)!=1:raise CadError('Each approved panel needs exactly one name on the LABELS layer inside its cut outline.')
        name=(labels[0].plain_text() if labels[0].dxftype()=='MTEXT' else labels[0].dxf.text).strip()
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}',name) or name.casefold() in names:raise CadError('Approved panel names must be unique and valid.')
        names.add(name.casefold())
        if not assigned[i]:raise CadError(name+': no approved routes or holes were found.')
        doc=ezdxf.new('R2010');doc.units=4;m=doc.modelspace()
        for layer,color in [('CUT',3),('ROUTE',1),('CAP ROUTE',5),('HOLES',4),('LABELS',7)]:doc.layers.new(layer,dxfattribs={'color':color})
        x,y,x1,y1=shape.bounds
        if max(x1-x,y1-y)>20000:raise CadError('Approved panel dimensions exceed 20 metres.')
        for entity in [cut,*assigned[i]]:
            copy=entity.copy();copy.dxf.layer=entity.dxf.layer.upper();m.add_entity(copy);copy.transform(Matrix44.translate(-x,-y,0))
        anchor=shape.representative_point()
        m.add_mtext(name,dxfattribs={'layer':'LABELS','insert':(anchor.x-x,anchor.y-y),'char_height':25,'attachment_point':5})
        stream=io.StringIO();doc.write(stream);drawing=stream.getvalue()
        backend=svg.SVGBackend();Frontend(RenderContext(doc),backend,config=Configuration(background_policy=BackgroundPolicy.WHITE,color_policy=ColorPolicy.COLOR)).draw_layout(m,finalize=True)
        preview=backend.get_string(layout.Page(360,300))
        validation={'closedCut':True,'checks':['Approved cut outline and route containment checked','Existing developed geometry retained without extra allowance'],
                    'measurements':[{'label':'Approved DXF geometry','status':'pass'}],'warnings':[], 'fabricationTags':[], 'stiffeners':[],
                    'source':'approved-dxf','sourceSha256':source_hash,'allowanceApplied':False,'tagTreatment':'Retained exactly from approved DXF; no added tags or drilling.'}
        spec={'panelId':name,'panelDirection':'right','approvedDxfSha256':source_hash,'reviewed':True}
        panels.append({'name':name,'quantity':1,'spec':spec,'result':{'ok':True,'filename':name+'.dxf','dxf':drawing,'svg':preview,'validation':validation},'reviewed':True})
    return {'ok':True,'panels':panels,'sourceSha256':source_hash}
