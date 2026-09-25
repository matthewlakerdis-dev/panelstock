import unittest
from shapely.geometry import box, LineString
from panel_cad import annotation_position

class AnnotationPlacement(unittest.TestCase):
    def test_avoids_fold_and_stiffener(self):
        face=box(0,0,1000,800)
        obstacles=[LineString([(0,400),(1000,400)]).buffer(10),LineString([(500,0),(500,800)]).buffer(10)]
        (x,y),external=annotation_position(face,'C501a','right',obstacles)
        envelope=box(x-87,y-95,x+87,y+25)
        self.assertFalse(external)
        self.assertTrue(face.covers(envelope))
        self.assertTrue(all(not envelope.intersects(o) for o in obstacles))
    def test_crowded_panel_uses_clear_external_position(self):
        face=box(0,0,80,60)
        obstacle=box(-50,-80,150,100)
        (x,y),external=annotation_position(face,'LONG-PANEL-ID','down',[obstacle])
        self.assertTrue(external)
        self.assertLess(y+25,obstacle.bounds[1])
