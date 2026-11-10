import fs from 'node:fs';
const input=new URL('../artifacts/GATE_PROGRESS_PIVOT_DRAFT.xlsx',import.meta.url),output=new URL('../worker/generated/gate-progress-pivot-draft.js',import.meta.url);
const bytes=fs.readFileSync(input);
if(bytes.readUInt32LE(0)!==0x04034b50)throw Error('The PivotTable preview must be a valid XLSX archive.');
const built='// Generated from the validated synthetic PivotTable comparison workbook.\nexport const gateProgressPivotDraft='+JSON.stringify(bytes.toString('base64'))+';\n';
if(process.argv.includes('--check')){if(!fs.existsSync(output)||fs.readFileSync(output,'utf8')!==built)throw Error('PivotTable preview is out of date. Run node scripts/build-gate-pivot-preview.mjs.');}
else fs.writeFileSync(output,built);
