import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {compileExpertDescriptions} from './refresh-expert-descriptions.mjs';

test('global scope compilation preserves originals, all non-experts and searchable hints',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'expert-scope-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'.codebuddy-plugin'));
  await mkdir(path.join(root,'agents'));
  const role='---\nname: lead\ndescription: NCRE exam preparation for levels one to four.\n---\n# Lead\nOriginal exam team workflow.\n';
  await writeFile(path.join(root,'agents/lead.md'),role);
  await writeFile(path.join(root,'.codebuddy-plugin/plugin.json'),JSON.stringify({description:'General database programming security',agentName:'lead',agents:['agents/lead.md']}));
  const catalog=path.join(root,'input.json'),output=path.join(root,'candidate.json');
  const skill={id:'skill:test',kind:'skill',description:'keep exact skill metadata',arbitrary:{kept:true}};
  const expert={id:'expert:test',name:'exam-team',kind:'expert',package_root:root,description:'old general scope',original_description:'old general scope',members:['agents/lead.md']};
  const original=JSON.stringify({schemaVersion:'codex-resource-modules/1',modules:[expert,skill]});
  await writeFile(catalog,original);
  const result=await compileExpertDescriptions({catalog,output});
  assert.equal(result.sourceGrounded,1);
  assert.equal(result.productionChanged,false);
  const compiled=JSON.parse(await readFile(output,'utf8'));
  assert.equal(compiled.modules[0].description,'exam-team NCRE exam preparation for levels one to four.');
  assert.equal(compiled.modules[0].retrieval_document,'exam-team General database programming security');
  assert.equal(compiled.modules[0].retrieval_provenance.primary_sha256,createHash('sha256').update(role).digest('hex'));
  assert.deepEqual(compiled.modules[1],skill);
  assert.equal(await readFile(catalog,'utf8'),original);
  assert.equal(await readFile(path.join(root,'agents/lead.md'),'utf8'),role);
  await assert.rejects(compileExpertDescriptions({catalog,output:catalog}),/separate/);
});

test('an ambiguous original team gets an explicit blocked scope, never invented capability',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'expert-scope-blocked-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'.codebuddy-plugin'));
  await writeFile(path.join(root,'.codebuddy-plugin/plugin.json'),JSON.stringify({description:'Can do everything',agents:['agents/a.md','agents/b.md']}));
  const catalog=path.join(root,'input.json'),output=path.join(root,'candidate.json');
  await writeFile(catalog,JSON.stringify({schemaVersion:'codex-resource-modules/1',modules:[{id:'expert:ambiguous',name:'team',kind:'expert',package_root:root}]}));
  const result=await compileExpertDescriptions({catalog,output});
  assert.equal(result.sourceGrounded,0);
  assert.equal(result.blocked.length,1);
  const module=JSON.parse(await readFile(output,'utf8')).modules[0];
  assert.equal(module.retrieval_provenance.state,'blocked');
  assert.match(module.description,/No unambiguous original primary role/);
  assert.doesNotMatch(module.description,/Can do everything/);
});
