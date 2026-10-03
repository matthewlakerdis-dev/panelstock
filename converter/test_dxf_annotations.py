import unittest
import io
import ezdxf
from panel_cad import finish_extracted_spec,generate

class DxfAnnotations(unittest.TestCase):
 def test_chains_and_rotated_direction_arrows(self):
  for direction in ['right','left','up','down','none']:
   p={'panelId':'C501a','panelDirection':direction,'edges':[{'direction':d,'code':c,'site':s} for d,c,s in zip(['right','up','left','down'],['NT','RE','B','S'],[1280,835,1280,835])],'siteFolds':[300,570],'unsupported':False}
   p=finish_extracted_spec(p);p['reviewed']=True;r=generate(p);m=ezdxf.read(io.StringIO(r['dxf'])).modelspace()
   lengths=[round(e.get_measurement(),3) for e in m.query('DIMENSION') if e.dimtype in (0,1)]
   assert all(n in lengths for n in [263,268,298]),lengths
   arrows=list(m.query('LINE[layer=="LABELS"]'));assert len(arrows)==(0 if direction=='none' else 3)
   if arrows:
    shaft=arrows[0];delta=shaft.dxf.end-shaft.dxf.start
    assert (delta.x>0 if direction=='right' else delta.x<0 if direction=='left' else delta.y>0 if direction=='up' else delta.y<0)
    # The arrow rotates with the ID; 'below' is relative to text orientation.
    label=next(e for e in m.query('MTEXT[layer=="LABELS"]') if e.text=='C501a')
    ux,uy={'right':(1,0),'left':(-1,0),'up':(0,1),'down':(0,-1)}[direction]
    centre=(shaft.dxf.start+shaft.dxf.end)/2
    offset=centre-label.dxf.insert
    assert abs(offset.x*(-uy)+offset.y*ux+55)<1e-6
   assert r['validation']['stiffener'] is None and r['validation']['fixingHoles']==0
