import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {installPortableResources} from './install-portable-resources.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'portable-experts-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const home=path.join(root,'target'),source='/different/mac/.codex',pkg='expert/demo';
 const files={ [pkg+'/.codebuddy-plugin/plugin.json']:JSON.stringify({agents:['agents/lead.md']}),[pkg+'/agents/lead.md']:'# Original role\r\nUse skills/helper/SKILL.md', [pkg+'/skills/helper/SKILL.md']:'# Original helper'};
 for(const [p,b]of Object.entries(files)){const f=path.join(home,'resource-packages',p);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,b);}
 const modules=[{id:'expert:demo:abc',kind:'expert',name:'demo',path:source+'/resource-adapters/abc/MODULE.md',package_root:source+'/resource-packages/'+pkg},{id:'skill:helper:abc',kind:'skill',name:'helper',path:source+'/resource-packages/'+pkg+'/skills/helper/SKILL.md',package_root:source+'/resource-packages/'+pkg,dependencies:['expert:demo:abc']}];
 const catalog=path.join(root,'catalog.json'),manifest=path.join(root,'manifest.json');
 await writeFile(catalog,JSON.stringify({schemaVersion:'codex-resource-modules/1',modules}));await writeFile(manifest,JSON.stringify({schemaVersion:'private-resource-packages/1',files:Object.entries(files).map(([p,b])=>({path:p,bytes:Buffer.byteLength(b),sha256:sha(b)}))}));
 return {home:await realpath(home),source,catalog,manifest,files};
}
test('portable install rebinds metadata, regenerates original expert entry and keeps nested Skill bytes',async t=>{
 const f=await fixture(t);const r=await installPortableResources({codexRoot:f.home,catalog:f.catalog,manifest:f.manifest,sourceCodexRoot:f.source});assert.equal(r.experts.ready,1);
 const c=JSON.parse(await readFile(path.join(f.home,'skill-registry/resource-modules.json')));assert.equal(c.modules[0].path,path.join(f.home,'resource-adapters/abc/MODULE.md'));
 const entry=await readFile(c.modules[0].path,'utf8');assert.ok(entry.endsWith(f.files['expert/demo/agents/lead.md']));assert.ok(entry.includes(f.home));assert.ok(!entry.includes(f.source));assert.deepEqual(c.modules[1].dependencies,['expert:demo:abc']);
 assert.equal(await readFile(c.modules[1].path,'utf8'),f.files['expert/demo/skills/helper/SKILL.md']);
});
test('corrupt package and escaping catalog fail before publishing registry',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.home,'resource-packages/expert/demo/agents/lead.md'),'corrupt');
 await assert.rejects(installPortableResources({codexRoot:f.home,catalog:f.catalog,manifest:f.manifest,sourceCodexRoot:f.source}),/checksum/);
 await assert.rejects(readFile(path.join(f.home,'skill-registry/resource-modules.json')),/ENOENT/);
 await writeFile(path.join(f.home,'resource-packages/expert/demo/agents/lead.md'),f.files['expert/demo/agents/lead.md']);
 const c=JSON.parse(await readFile(f.catalog));c.modules[0].path='/outside/MODULE.md';await writeFile(f.catalog,JSON.stringify(c));
 await assert.rejects(installPortableResources({codexRoot:f.home,catalog:f.catalog,manifest:f.manifest,sourceCodexRoot:f.source}),/outside/);
});
