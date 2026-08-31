import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildCncTrackerHtml} from '../src/cnc-tracker.js';
test('shared CNC view renders responsive controls and safely embeds its read-only token',()=>{
 const html=buildCncTrackerHtml('</script><script>bad()</script>');
 assert.ok(!html.includes('<script>bad()'));
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);new vm.Script(scripts[0][1]);
 assert.match(html,/name="viewport"/);assert.match(html,/@media\(max-width:480px\)/);
 assert.match(html,/Expand all/);assert.match(html,/Collapse all/);
 assert.match(html,/type="search"/);assert.match(html,/Read-only live view/);
 assert.doesNotMatch(html,/innerHTML|method:\s*['"]POST/);
});
