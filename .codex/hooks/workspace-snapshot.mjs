import {execFile} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
const execute=promisify(execFile);

// The Git file inventory is the owner of project membership. Ignored reports,
// mirrors and model caches are not project edits and must not be walked.
export async function snapshotWorkspace(root){
 const {stdout}=await execute('git',['--no-optional-locks','ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,windowsHide:true,maxBuffer:32*1024*1024,encoding:'utf8'});
 const names=[...new Set(stdout.split('\0').filter(Boolean))].filter(name=>!name.startsWith('versions/')&&!name.startsWith('.task-tree-maintenance/'));
 const files={};
 for(let offset=0;offset<names.length;offset+=32){
  await Promise.all(names.slice(offset,offset+32).map(async name=>{
   try{const info=await stat(path.join(root,name));if(info.isFile())files[name]={mtimeMs:Math.round(info.mtimeMs),size:info.size};}
   catch(error){if(error.code!=='ENOENT')throw error;}
  }));
 }
 return {files,truncated:false,count:Object.keys(files).length};
}
