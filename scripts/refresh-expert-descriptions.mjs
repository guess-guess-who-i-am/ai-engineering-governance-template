#!/usr/bin/env node
// Compile facts from complete packages; never edit an original or production file.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {expertRetrievalProfile} from './import-resource-modules.mjs';

export async function compileExpertDescriptions({catalog,output}) {
  if(path.resolve(catalog)===path.resolve(output)) throw new Error('Output must be separate from the live catalog');
  const bytes=await readFile(catalog),data=JSON.parse(bytes);
  if(data.schemaVersion!=='codex-resource-modules/1'||!Array.isArray(data.modules)) throw new Error('Invalid resource catalog');
  let cursor=0;
  const modules=new Array(data.modules.length);
  await Promise.all(Array.from({length:8},async()=>{
    while(cursor<data.modules.length){
      const index=cursor++,module=data.modules[index];
      modules[index]=module.kind==='expert'?{...module,...await expertRetrievalProfile(module)}:module;
    }
  }));
  if(!(await readFile(catalog)).equals(bytes)) throw new Error('Catalog changed while compiling descriptions');
  const result={...data,modules};
  await mkdir(path.dirname(path.resolve(output)),{recursive:true});
  const temporary=output+'.'+process.pid+'.tmp';
  await writeFile(temporary,JSON.stringify(result,null,2)+'\n',{mode:0o600});await rename(temporary,output);
  const experts=modules.filter(m=>m.kind==='expert');
  return {experts:experts.length,sourceGrounded:experts.filter(m=>m.retrieval_provenance.state==='source-grounded').length,
    blocked:experts.filter(m=>m.retrieval_provenance.state==='blocked').map(m=>({name:m.name,reason:m.retrieval_provenance.reason})),
    sourceCatalogSha256:createHash('sha256').update(bytes).digest('hex'),originalPackagesWritten:false,productionChanged:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
  if(!args.includes('--catalog')||!args.includes('--output')) throw new Error('--catalog and --output are required');
  console.log(JSON.stringify(await compileExpertDescriptions({catalog:value('--catalog'),output:value('--output')})));
}
