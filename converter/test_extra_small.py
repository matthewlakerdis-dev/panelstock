import io
import unittest
import ezdxf
from panel_cad import finish_extracted_spec, generate
from cad_ai import SCHEMA


def machining(result):
    model = ezdxf.read(io.StringIO(result['dxf'])).modelspace()
    rows = []
    for e in model:
        if e.dxf.layer not in {'CUT', 'ROUTE', 'CAP ROUTE', 'HOLES'}:
            continue
        if e.dxftype() == 'LWPOLYLINE':
            value = (e.closed, tuple(tuple(round(float(v), 6) for v in p) for p in e.get_points()))
        elif e.dxftype() == 'CIRCLE':
            value = (tuple(round(v, 6) for v in e.dxf.center), round(e.dxf.radius, 6))
        elif e.dxftype() == 'LINE':
            value = (tuple(e.dxf.start), tuple(e.dxf.end))
        else:
            raise AssertionError(e.dxftype())
        rows.append((e.dxf.layer, e.dxftype(), value))
    return sorted(rows)


class ExtraSmallTests(unittest.TestCase):
    def test_reader_accepts_exact_hardware_code(self):
        self.assertIn('ES', SCHEMA['properties']['edges']['items']['properties']['code']['enum'])

    def test_rectangular_and_measured_geometry_match_s_but_keep_es_schedule(self):
        for measured in (False, True):
            results = []
            for code in ('S', 'ES'):
                spec = {'panelId': 'Hardware', 'panelDirection': 'right', 'reviewed': True}
                if measured:
                    spec['measuredEdges'] = [dict(dx=x, dy=y, code=code) for x,y in [(1000,0),(0,600),(-1000,0),(0,-600)]]
                    spec['measuredFolds'] = []
                else:
                    spec['edges'] = [dict(direction=d, code=code, site=n) for d,n in [('right',1000),('up',600),('left',1000),('down',600)]]
                    spec = finish_extracted_spec(spec)
                spec['reviewed'] = True
                results.append(generate(spec))
            self.assertEqual(machining(results[0]), machining(results[1]))
            self.assertTrue(results[1]['validation']['fabricationTags'])
            self.assertIn('ES', str(results[1]['validation']['fabricationTags']))
            self.assertNotIn("'code': 'S'", str(results[1]['validation']['fabricationTags']))


if __name__ == '__main__':
    unittest.main()
