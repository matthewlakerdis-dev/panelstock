import io
import ezdxf
from panel_cad import finish_extracted_spec,generate
for direction in ['right','left','up','down','none']:
 p={'panelId':'C501a','panelDirection':direction,'edges':[{'direction':d,'code':c,'site':s} for d,c,s in zip(['right','up','left','down'],['NT','RE','B','S'],[1280,835,1280,835])],'siteFolds':[300,570],'unsupported':False}
 p=finish_extracted_spec(p);p['reviewed']=True;r=generate(p);m=ezdxf.read(io.StringIO(r['dxf'])).modelspace()
 lengths=[round(e.get_measurement(),3) for e in m.query('DIMENSION') if e.dimtype in (0,1)]
 assert all(n in lengths for n in [263,268,298]),lengths
 arrows=list(m.query('LINE[layer=="LABELS"]'));assert len(arrows)==(0 if direction=='none' else 3)
 if arrows:
  shaft=arrows[0];delta=shaft.dxf.end-shaft.dxf.start
  assert (delta.x>0 if direction=='right' else delta.x<0 if direction=='left' else delta.y>0 if direction=='up' else delta.y<0)
  assert max(shaft.dxf.start.y,shaft.dxf.end.y)<829/2
 assert r['validation']['stiffener'] is None and r['validation']['fixingHoles']==0
 print('PASS: chained DXF dimensions and arrow',direction)
