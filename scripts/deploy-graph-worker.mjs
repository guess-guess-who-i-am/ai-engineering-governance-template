/** Deploy only the tested graph adapter; preserve all methodology/config files. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const hash=data=>createHash('sha256').update(data).digest('hex');
const files=[];
// Publish the dependency first so a restarting service never sees a missing import.
for(const name of ['complete_embedding.py','graph_skill_index.py']){
 const source=path.join(root,'codex-profile/mac/hooks',name);
 const destination=path.join(os.homedir(),'.codex/hooks',name);
 const content=await readFile(source);
 let previous;
 try{previous=await readFile(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
 files.push({name,source,destination,content,previous});
}
if(files.every(file=>file.previous?.equals(file.content)))console.log(JSON.stringify({changed:false,files:files.map(file=>({name:file.name,sha256:hash(file.content)}))}));
else{
 const id=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=path.join(os.homedir(),'.codex/backups/graph-worker',id);
 await mkdir(backup,{recursive:true,mode:0o700});
 const receipt=files.map(file=>({source:file.source,destination:file.destination,before:file.previous?hash(file.previous):null,after:hash(file.content)}));
 for(const file of files)if(file.previous)await writeFile(path.join(backup,file.name),file.previous,{mode:0o600});
 await writeFile(path.join(backup,'receipt.json'),JSON.stringify({files:receipt,time:new Date().toISOString()},null,2)+'\n',{mode:0o600});
 for(const {destination,content} of files){
  const temporary=destination+`.deployment-${process.pid}.tmp`;
  await writeFile(temporary,content,{mode:0o700});
  await rename(temporary,destination);
  if(!content.equals(await readFile(destination)))throw Error('installed bytes differ');
 }
 console.log(JSON.stringify({changed:true,backup,files:receipt,restart:'service drains existing requests and retires on source revision change'}));
}
