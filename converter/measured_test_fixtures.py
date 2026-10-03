"""Synthetic regression geometry, not an approved order or source reading."""
def shoulder_panel():
    points=[(0,0),(1500,0),(1500,1200),(1450,1200),(1450,2350),(0,2350)]
    return {'panelId':'SYNTHETIC-SHOULDER','reviewed':False,'panelDirection':'right',
        'measuredEdges':[{'dx':points[(i+1)%len(points)][0]-x,
                          'dy':points[(i+1)%len(points)][1]-y,'code':'B'}
                         for i,(x,y) in enumerate(points)],
        'measuredFolds':[{'start':{'x':0,'y':y},'end':{'x':w,'y':y}}
                         for y,w in [(100,1500),(1150,1500),(1200,1450),(2250,1450)]],
        'rightAngles':[{'fold':i,'end':end,'edge':edge}
                       for i in range(4) for end,edge in [(0,5),(1,1 if i<2 else 3)]],
        'reliefEnds':[{'fold':2,'end':1,'edge':2}]}
