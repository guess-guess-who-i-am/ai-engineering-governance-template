/** Deploy only the tested graph adapter; preserve all methodology/config files. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const source=path.join(root,'codex-profile/mac/hooks/graph_skill_index.py');
const destination=path.join(os.homedir(),'.codex/hooks/graph_skill_index.py');
const content=await readFile(source);
const previous=await readFile(destination);
const hash=data=>createHash('sha256').update(data).digest('hex');
if(content.equals(previous))console.log(JSON.stringify({changed:false,sha256:hash(content)}));
else{
 const id=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=path.join(os.homedir(),'.codex/backups/graph-worker',id);
 await mkdir(backup,{recursive:true,mode:0o700});
 await writeFile(path.join(backup,'graph_skill_index.py'),previous,{mode:0o600});
 await writeFile(path.join(backup,'receipt.json'),JSON.stringify({source,destination,before:hash(previous),after:hash(content),time:new Date().toISOString()},null,2)+'\n',{mode:0o600});
 const temporary=destination+`.deployment-${process.pid}.tmp`;
 await writeFile(temporary,content,{mode:0o700});
 await rename(temporary,destination);
 if(!content.equals(await readFile(destination)))throw Error('installed bytes differ');
 console.log(JSON.stringify({changed:true,backup,sha256:hash(content),restart:'service drains existing requests and retires on source revision change'}));
}
