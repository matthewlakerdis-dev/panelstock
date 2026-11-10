import fs from 'node:fs';
import {buildXlsxBytes} from '../worker/src/reports.js';
import {CNC_COLUMNS} from '../worker/src/cnc-excel.js';
import {gateProgressSample} from '../worker/src/gate-progress-sample.js';
const output=process.argv[2];
if(!output)throw Error('Provide an output workbook path');
fs.writeFileSync(output,await buildXlsxBytes([],CNC_COLUMNS,'https://example.test/cnc-tracker/excel-data?token=synthetic-validation',undefined,[],[],gateProgressSample().orders));
console.log('Generated seven-sheet Production Tracker using synthetic data.');
