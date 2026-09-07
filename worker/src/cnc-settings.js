export const DEFAULT_CNC_SETTINGS=Object.freeze({
  minimumOffcutSizeMm:1,
  wasteGreenMax:5,
  wasteYellowMax:10,
  cutEdgeAllowanceMm:10
});

export function normalizeCncSettings(value={}) {
  const integer=(key,min,max)=>{
    const number=Number(value?.[key]);
    return Number.isInteger(number)&&number>=min&&number<=max?number:DEFAULT_CNC_SETTINGS[key];
  };
  const settings={
    minimumOffcutSizeMm:integer('minimumOffcutSizeMm',1,10000),
    wasteGreenMax:integer('wasteGreenMax',0,100),
    wasteYellowMax:integer('wasteYellowMax',0,100),
    cutEdgeAllowanceMm:integer('cutEdgeAllowanceMm',0,1000)
  };
  if(!(settings.wasteGreenMax<settings.wasteYellowMax)) {
    settings.wasteGreenMax=DEFAULT_CNC_SETTINGS.wasteGreenMax;
    settings.wasteYellowMax=DEFAULT_CNC_SETTINGS.wasteYellowMax;
  }
  return settings;
}
