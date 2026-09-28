"""Read-only sheet layout: fixed grain orientation, conservative cut-box packing."""
import copy, io, math
import ezdxf
from ezdxf import xref
from ezdxf.math import Matrix44
from shapely.geometry import Polygon, box
from shapely.affinity import translate

GAP = 10.0
ANGLES = {'right': 0, 'up': -90, 'left': -180, 'down': -270}

def number(value, name, maximum=20000):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= maximum:
        raise ValueError('Invalid '+name)
    return float(value)

def split_free(free, used):
    x,y,w,h=used; result=[]
    for a,b,c,d in free:
        if x>=a+c-1e-7 or x+w<=a+1e-7 or y>=b+d-1e-7 or y+h<=b+1e-7:
            result.append((a,b,c,d));continue
        if x>a:result.append((a,b,x-a,d))
        if x+w<a+c:result.append((x+w,b,a+c-x-w,d))
        if y>b:result.append((a,b,c,y-b))
        if y+h<b+d:result.append((a,y+h,c,b+d-y-h))
    unique=list(dict.fromkeys(r for r in result if min(r[2:])>1e-7))
    return [r for i,r in enumerate(unique) if not any(i!=j and r[0]>=s[0]-1e-7 and r[1]>=s[1]-1e-7 and r[0]+r[2]<=s[0]+s[2]+1e-7 and r[1]+r[3]<=s[1]+s[3]+1e-7 for j,s in enumerate(unique))]

def contain_panel_identity(source, polygon):
    """Keep panel identity inside the cut and clear of edge annotations."""
    from ezdxf import bbox
    model=source.modelspace()
    for label in list(model.query('MTEXT[layer=="LABELS"]')):
        if abs(label.dxf.char_height-42)>1e-6:
            continue
        anchor=label.dxf.insert
        expected=[((anchor.x-67.5,anchor.y-55),(anchor.x+67.5,anchor.y-55))]
        expected += [((anchor.x+40.5,anchor.y-55+side*15),(anchor.x+67.5,anchor.y-55)) for side in (-1,1)]
        group=[label]
        for line in model.query('LINE[layer=="LABELS"]'):
            if any(math.dist(tuple(line.dxf.start)[:2],a)<1e-5 and math.dist(tuple(line.dxf.end)[:2],b)<1e-5 for a,b in expected):
                group.append(line)
        bounds=bbox.extents(group)
        if not bounds.has_data:
            continue
        rect=box(bounds.extmin.x,bounds.extmin.y,bounds.extmax.x,bounds.extmax.y)
        obstacles=[]
        for entity in model.query('MTEXT TEXT[layer=="LABELS"]'):
            if entity in group:
                continue
            extent=bbox.extents([entity])
            if extent.has_data:
                obstacles.append(box(extent.extmin.x,extent.extmin.y,extent.extmax.x,extent.extmax.y).buffer(8))
        def clear(target):
            return polygon.buffer(-4).covers(target) and not any(target.intersects(obstacle) for obstacle in obstacles)
        if clear(rect):
            continue
        centre=polygon.representative_point()
        cx=(bounds.extmin.x+bounds.extmax.x)/2
        cy=(bounds.extmin.y+bounds.extmax.y)/2
        scale=1.0
        for _ in range(30):
            from shapely.affinity import scale as scale_shape
            scaled=scale_shape(rect,xfact=scale,yfact=scale,origin=(cx,cy))
            xmin,ymin,xmax,ymax=polygon.bounds
            candidates=[(centre.x,centre.y)]
            candidates += [(xmin+(xmax-xmin)*fraction,centre.y) for fraction in (.35,.65,.2,.8,.1,.9)]
            placed=False
            for px,py in candidates:
                target=translate(scaled,px-cx,py-cy)
                if clear(target):
                    matrix=Matrix44.chain(Matrix44.translate(-cx,-cy,0),Matrix44.scale(scale),Matrix44.translate(px,py,0))
                    for entity in group:
                        entity.transform(matrix)
                    placed=True
                    break
            if placed:
                break
            scale*=0.8


def plan_sheets(request):
    panels=request.get('panels');stock=request.get('stock')
    if not isinstance(panels,list) or not 1<=len(panels)<=30:raise ValueError('Choose 1 to 30 generated panels.')
    if not isinstance(stock,list) or not 1<=len(stock)<=200:raise ValueError('Choose available SOH sheets or offcuts.')
    if any(not isinstance(p,dict) for p in panels) or any(not isinstance(s,dict) for s in stock):raise ValueError('Invalid sheet planning entries.')
    if sum(len(str(p.get('dxf',''))) for p in panels)>8_000_000:raise ValueError('Drawings exceed the sheet planning size limit.')
    sources=[];copies=[]
    for index,p in enumerate(panels):
        direction=p.get('direction')
        if direction not in ANGLES:raise ValueError('Set the direction arrow for every selected panel before planning.')
        qty=number(p.get('quantity'), 'panel quantity',200)
        if not qty.is_integer():raise ValueError('Panel quantities must be whole numbers.')
        if len(copies)+qty>200:raise ValueError('Plan at most 200 panel copies at once.')
        if not isinstance(p.get('dxf'),str):raise ValueError('Generate every selected panel first.')
        source=ezdxf.read(io.StringIO(p['dxf']))
        if source.units!=4:raise ValueError('Panel drawings must use millimetres.')
        if len(source.modelspace())>50000:raise ValueError('Drawing is too complex.')
        cuts=list(source.modelspace().query('LWPOLYLINE[layer=="CUT"]'))
        if len(cuts)!=1 or not cuts[0].closed or any(abs(v[4])>1e-9 for v in cuts[0].get_points()):raise ValueError('Each panel needs one closed straight-sided CUT outline.')
        matrix=Matrix44.z_rotate(math.radians(ANGLES[direction]))
        for entity in source.modelspace():entity.transform(matrix)
        polygon=Polygon(list(cuts[0].get_points('xy')))
        if not polygon.is_valid or polygon.area<=0:raise ValueError('Invalid panel cut outline.')
        x,y,X,Y=polygon.bounds;w,h=X-x,Y-y
        for entity in source.modelspace():entity.transform(Matrix44.translate(-x,-y,0))
        polygon=translate(polygon,-x,-y)
        contain_panel_identity(source,polygon)
        sources.append(source)
        for serial in range(int(qty)):
            copies.append({'source':index,'name':str(p.get('name') or 'Panel')[:100], 'copy':serial+1,'width':w,'height':h,'polygon':polygon,'rotation':ANGLES[direction]})
    material=None;inventory=[];seen=set()
    for item in stock:
        key=(item.get('type'),item.get('id'))
        if key[0] not in ('variant','offcut') or not isinstance(key[1],str) or not key[1] or key in seen:raise ValueError('Invalid or duplicate stock selection.')
        seen.add(key)
        group=(str(item.get('material','')).strip().lower(),str(item.get('color','')).strip().lower(),number(item.get('thickness'),'thickness',100))
        if not all(group):raise ValueError('Stock material, colour and thickness are required.')
        if material is not None and group!=material:raise ValueError('Plan only one material, colour and thickness at a time.')
        material=group
        w=number(item.get('width'),'sheet length');h=number(item.get('height'),'sheet width')
        qty=number(item.get('quantity'),'available stock quantity',100000)
        if not qty.is_integer():raise ValueError('Stock quantities must be whole numbers.')
        inventory.append({**item,'width':w,'height':h,'remaining':int(qty)})
    # Largest panels first, using existing sheets before opening another of each type.
    copies.sort(key=lambda p:(-max(p['width'],p['height']),-p['width']*p['height'],p['source'],p['copy']))
    sheets=[];unplaced=[]
    for panel in copies:
        w,h=panel['width']+GAP,panel['height']+GAP
        choice=None
        for kind in ('offcut','variant'):
            candidates=[]
            for index,sheet in enumerate(sheets):
                if sheet['stock']['type']!=kind:continue
                for rect in sheet['free']:
                    if w<=rect[2]+1e-7 and h<=rect[3]+1e-7:candidates.append((min(rect[2]-w,rect[3]-h),index,rect))
            if candidates:
                _,index,rect=min(candidates);choice=(sheets[index],rect);break
            usable=[s for s in inventory if s['type']==kind and s['remaining'] and w<=s['width']+GAP+1e-7 and h<=s['height']+GAP+1e-7]
            if usable:
                item=min(usable,key=lambda s:(s['width']*s['height'],s['id']));item['remaining']-=1
                sheet={'stock':item,'free':[(0,0,item['width']+GAP,item['height']+GAP)],'panels':[]};sheets.append(sheet);choice=(sheet,sheet['free'][0]);break
        if choice is None:
            unplaced.append({k:panel[k] for k in ('name','copy','width','height')});continue
        sheet,rect=choice;x,y=rect[:2];placed=translate(panel['polygon'],x,y)
        if not box(0,0,sheet['stock']['width'],sheet['stock']['height']).buffer(1e-7).covers(placed):raise ValueError('Sheet containment check failed.')
        if any(placed.distance(p['placed'])<GAP-1e-6 for p in sheet['panels']):raise ValueError('Panel spacing check failed.')
        sheet['panels'].append({**panel,'x':x,'y':y,'placed':placed});sheet['free']=split_free(sheet['free'],(x,y,w,h))
    output=[]
    combined=ezdxf.new("R2010");combined.units=4
    cursor_x=cursor_y=row_height=0
    columns=max(1,math.ceil(math.sqrt(len(sheets))))
    from ezdxf.addons.drawing import RenderContext, Frontend, svg, layout
    from ezdxf.addons.drawing.config import Configuration,BackgroundPolicy,ColorPolicy
    for index,sheet in enumerate(sheets):
        item=sheet['stock'];doc=ezdxf.new('R2010');doc.units=4
        for panel in sheet['panels']:
            source=copy.deepcopy(sources[panel['source']])
            # Fabrication dimensions remain in the individual panel drawings.
            for entity in list(source.modelspace()):
                if entity.dxf.layer=='DIMENSIONS':source.modelspace().delete_entity(entity)
                else:entity.transform(Matrix44.translate(panel['x'],panel['y'],0))
            xref.load_modelspace(source,doc)
        doc.layers.new('SHEET REFERENCE',dxfattribs={'color':8})
        doc.modelspace().add_lwpolyline([(0,0),(item['width'],0),(item['width'],item['height']),(0,item['height'])],close=True,dxfattribs={'layer':'SHEET REFERENCE'})
        stream=io.StringIO();doc.write(stream);dxf=stream.getvalue()
        if ezdxf.read(io.StringIO(dxf)).audit().errors:raise ValueError('Sheet DXF validation failed.')
        if index and index%columns==0:
            cursor_x=0;cursor_y+=row_height+250;row_height=0
        export=copy.deepcopy(doc)
        for entity in export.modelspace():entity.transform(Matrix44.translate(cursor_x,cursor_y,0))
        xref.load_modelspace(export,combined)
        cursor_x+=item['width']+250;row_height=max(row_height,item['height'])
        backend=svg.SVGBackend();Frontend(RenderContext(doc),backend,config=Configuration(background_policy=BackgroundPolicy.WHITE,color_policy=ColorPolicy.COLOR)).draw_layout(doc.modelspace(),finalize=True)
        output.append({'number':index+1,'stock':{k:item.get(k) for k in ('id','type','sku','material','color','thickness','width','height')},'panels':[{**{k:p[k] for k in ('name','copy','x','y','width','height','rotation')},'direction':'right','area':p['placed'].area/1_000_000} for p in sheet['panels']], 'utilisation':round(100*sum(p['placed'].area for p in sheet['panels'])/(item['width']*item['height']),1),'dxf':dxf,'svg':backend.get_string(layout.Page(360,360*item['height']/item['width'], margins=layout.Margins.all(2)))})
    combined_stream=io.StringIO();combined.write(combined_stream)
    combined_dxf=combined_stream.getvalue()
    if ezdxf.read(io.StringIO(combined_dxf)).audit().errors:raise ValueError('Combined sheet DXF validation failed.')
    result={'allSheetsDxf':combined_dxf,'ok':True,'gap':GAP,'margin':0,'stockChanged':False,'sheets':output,'unplaced':unplaced}
    import json
    if len(json.dumps(result))>11_000_000:raise ValueError('Layout is too large. Plan fewer panel copies at once.')
    return result
