const path=require('node:path');
module.exports={
  content:['cnc-sticker-parser.js','cnc-sticker-review.js','cnc-order-qa-reset.js','cnc-order-id-reupload.js','index.html','qa-panel-area-import.js','reports-page.js','panelstock-client.js','panelstock-app.modern.js','panelstock-legacy-ui.js','panelstock-client.modern.js','panelstock-client.legacy.js'].map(file=>path.join(__dirname,file)),
  theme:{extend:{}},
  plugins:[]
};

