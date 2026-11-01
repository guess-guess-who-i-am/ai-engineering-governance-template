#!/usr/bin/env node
// Rebind generated metadata after a verified package transfer. Original roles/Skills stay byte-identical.
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,realpath,lstat,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildExpertEntry,blockedExpertEntry} from './expert-entry.mjs';
import {expertRetrievalProfile} from './import-resource-modules.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const inside=(root,file)=>file.startsWith(root+path.sep);
async function atomic(file,bytes){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,bytes,{mode:0o600});await rename(tmp,file);}
export async function installPortableResources({codexRoot,catalog,manifest,sourceCodexRoot}){
 codexRoot=await realpath(codexRoot);sourceCodexRoot=path.resolve(sourceCodexRoot);
 const source=JSON.parse(await readFile(catalog,'utf8')),inventory=JSON.parse(await readFile(manifest,'utf8'));
 if(source.schemaVersion!=='codex-resource-modules/1'||!Array.isArray(source.modules)||inventory.schemaVersion!=='private-resource-packages/1'||!inventory.files?.length)throw new Error('Invalid portable catalog/manifest');
 const packageRoot=await realpath(path.join(codexRoot,'resource-packages'));
 if(packageRoot!==path.join(codexRoot,'resource-packages'))throw new Error('Package root must not redirect');
 const hashes=new Map(),seen=new Set();let bytes=0,cursor=0;
 // Complete file integrity precedes publication and any generated entry mutation.
 await Promise.all(Array.from({length:8},async()=>{while(cursor<inventory.files.length){
  const row=inventory.files[cursor++],file=path.resolve(packageRoot,row.path);
  if(!inside(packageRoot,file)||seen.has(file)||!['expert','skill','mcp-service'].includes(row.path.split('/')[0]))throw new Error('Invalid or duplicate package manifest path');seen.add(file);
  if((await lstat(file)).isSymbolicLink()||!inside(packageRoot,await realpath(file)))throw new Error('Package symlink outside allowed original layout');
  const content=await readFile(file);if(content.length!==row.bytes||sha(content)!==row.sha256)throw new Error('Package checksum mismatch: '+row.path);
  hashes.set(file,row.sha256);bytes+=content.length;
 }}));
 const rebind=(file,area)=>{
  if(typeof file!=='string'||!inside(path.join(sourceCodexRoot,area),path.resolve(file)))throw new Error('Catalog path outside '+area);
  return path.join(codexRoot,path.relative(sourceCodexRoot,file));
 };
 const modules=source.modules.map(module=>{
  if(!['expert','skill','mcp-service'].includes(module.kind))throw new Error('Unknown resource kind');
  const package_root=rebind(module.package_root,'resource-packages');
  const entry=rebind(module.path,module.kind==='expert'?'resource-adapters':'resource-packages');
  if(module.kind!=='expert'&&(!inside(package_root,entry)||!hashes.has(entry)))throw new Error('Entry absent from verified package manifest');
  return {...module,package_root,path:entry};
 });
 const ids=modules.map(m=>m.id);if(new Set(ids).size!==ids.length)throw new Error('Duplicate module id');
 const prepared=[];let ready=0,blocked=0;
 for(const module of modules){
  if(module.kind==='expert'){
   Object.assign(module,await expertRetrievalProfile(module));
   if(path.basename(module.path)!=='MODULE.md')throw new Error('Invalid expert entry filename');
   let entry;try{entry=await buildExpertEntry(module);if(!hashes.has(entry.originalPath))throw new Error('Original role absent from verified package manifest');ready++;}
   catch(error){if(error.message.includes('verified package manifest'))throw error;entry=blockedExpertEntry(module,error);blocked++;}
   prepared.push([module.path,entry.bytes]);
  }
 }
 const registry=path.join(codexRoot,'skill-registry/resource-modules.json'),backup=path.join(codexRoot,'resource-evidence/portable-backups',new Date().toISOString().replaceAll(':','-'));
 try{await readFile(registry);await mkdir(backup,{recursive:true,mode:0o700});await copyFile(registry,path.join(backup,'resource-modules.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const [file,content]of prepared){await mkdir(path.dirname(file),{recursive:true,mode:0o700});if(!inside(codexRoot,await realpath(path.dirname(file))))throw new Error('Generated entry directory escapes target');await atomic(file,content);}
 const result={schemaVersion:'portable-resource-install/1',modules:modules.length,verifiedFiles:hashes.size,verifiedBytes:bytes,experts:{ready,blocked},originalRolesTransformed:false};
 await atomic(registry,JSON.stringify({...source,generatedAt:new Date().toISOString(),modules},null,2)+'\n');
 await atomic(path.join(codexRoot,'resource-evidence/portable-install.json'),JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
 installPortableResources({codexRoot:value('--codex-root'),catalog:value('--catalog'),manifest:value('--manifest'),sourceCodexRoot:value('--source-codex-root')}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.stack);process.exitCode=1;});
}
