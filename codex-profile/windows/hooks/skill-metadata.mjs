import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export async function metadataUnder(root,source,rank){
  let entries;try{entries=await readdir(root,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const result=await Promise.all(entries.filter(e=>e.isDirectory()).map(async entry=>{
    const file=path.join(root,entry.name,'SKILL.md');
    let text;try{text=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
    const block=text.replace(/^\uFEFF/,'').match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1]||'';
    const field=name=>block.match(new RegExp(`^${name}:\s*(.+)$`,'m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'')||'';
    const name=field('name'),description=field('description');
    if(!name||!description)return null;
    return {name,description,path:file,source,rank,sha256:createHash('sha256').update(text).digest('hex')};
  }));return result.filter(Boolean);
}
export async function projectMetadata(cwd){
  const result=[],seen=new Set();let current=path.resolve(cwd);
  while(true){
    for(const directory of ['.agents/routed-skills','.agents/skills','.codex/skills']){
      for(const item of await metadataUnder(path.join(current,directory),'project',0)){
        if(!seen.has(item.name)){seen.add(item.name);result.push(item);}
      }
    }
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }return result;
}
export function withAliases(records,aliases){return records.map(r=>({...r,aliases:Array.isArray(aliases[r.name])?aliases[r.name]:[]}));}
export async function userMetadata(root){
  const home=path.dirname(root);
  return (await Promise.all([
    metadataUnder(path.join(home,'.agents/routed-skills'),'user',10),
    metadataUnder(path.join(home,'.agents/skills'),'user',11),
    metadataUnder(path.join(home,'.agents/deferred-skills'),'deferred',20),
    metadataUnder(path.join(root,'skills'),'system',20),
    metadataUnder(path.join(root,'skills/.system'),'system',20),
    metadataUnder(path.join(root,'deferred-skills/codex'),'deferred',30)
  ])).flat();
}
