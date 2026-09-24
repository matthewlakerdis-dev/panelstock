const path=require('node:path');
module.exports={
  content:['index.html','panelstock-client.js','panelstock-app.modern.js','panelstock-legacy-ui.js','panelstock-client.modern.js','panelstock-client.legacy.js'].map(file=>path.join(__dirname,file)),
  theme:{extend:{}},
  plugins:[]
};
