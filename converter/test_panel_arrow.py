import io
import unittest
import ezdxf
from approved_dxf import import_approved
from panel_cad import generate, CadError
from test_approved_dxf import drawing


class PanelArrowTests(unittest.TestCase):
    def test_direction_changes_preserve_all_existing_entities(self):
        original=import_approved(drawing())['panels'][0]
        dxf=original['result']['dxf']
        source=ezdxf.read(io.StringIO(dxf))
        baseline=[(e.dxf.handle,e.dxftype(),str(e.dxf.all_existing_dxf_attribs()),list(e.get_points()) if e.dxftype()=='LWPOLYLINE' else None) for e in source.modelspace()]
        for direction,vector in [('up',(0,1)),('down',(0,-1)),('left',(-1,0)),('right',(1,0)),('none',None)]:
            result=generate({'panelArrow':True,'dxf':dxf,'panelId':original['name'],'panelDirection':direction})
            doc=ezdxf.read(io.StringIO(result['dxf']));model=doc.modelspace()
            retained=[(e.dxf.handle,e.dxftype(),str(e.dxf.all_existing_dxf_attribs()),list(e.get_points()) if e.dxftype()=='LWPOLYLINE' else None) for e in model if e.dxf.layer!='PANEL ARROW']
            self.assertEqual(retained,baseline)
            arrows=list(model.query('LINE[layer=="PANEL ARROW"]'))
            self.assertEqual(len(arrows),3 if vector else 0)
            if vector:
                shaft=arrows[0];dx=shaft.dxf.end.x-shaft.dxf.start.x;dy=shaft.dxf.end.y-shaft.dxf.start.y
                self.assertAlmostEqual(dx,vector[0]*135);self.assertAlmostEqual(dy,vector[1]*135)
            self.assertFalse(doc.audit().errors);self.assertIn('<svg',result['svg'])
            dxf=result['dxf']

    def test_invalid_direction_and_multi_panel_input_are_rejected(self):
        original=import_approved(drawing())['panels'][0]
        with self.assertRaises(CadError):generate({'panelArrow':True,'dxf':original['result']['dxf'],'panelId':original['name'],'panelDirection':'diagonal'})
        doc=ezdxf.read(io.StringIO(original['result']['dxf']))
        doc.modelspace().add_lwpolyline([(900,0),(1000,0),(1000,100)],close=True,dxfattribs={'layer':'CUT'})
        out=io.StringIO();doc.write(out)
        with self.assertRaises(CadError):generate({'panelArrow':True,'dxf':out.getvalue(),'panelId':original['name'],'panelDirection':'up'})

if __name__=='__main__':unittest.main()
