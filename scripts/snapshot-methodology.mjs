import {readFile,readdir,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const repository=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
for(const name of await readdir(path.join(root,'prompts'))){
 if(!/^global-.*\.(md|json)$/.test(name))continue;
 await copyFile(path.join(root,'prompts',name),path.join(repository,'codex-profile/.codex/prompts',name));
}
for(const name of ['methodology-state.json','methodology-translation-cache.en.md'])await copyFile(path.join(root,'prompt-publisher',name),path.join(repository,'codex-profile/.codex/prompt-publisher',name));
const config=JSON.parse(await readFile(path.join(root,'prompt-publisher/methodology-targets.json'),'utf8'));
for(const route of config.routes){if(!route.skillFile)continue;
 const source=path.isAbsolute(route.skillFile)?route.skillFile:path.resolve(root,'prompt-publisher',route.skillFile);
 const destination=path.join(repository,'codex-profile/.agents/routed-skills',route.id,'SKILL.md');
 await mkdir(path.dirname(destination),{recursive:true});await copyFile(source,destination);
}
console.log('Snapshotted generated methodology only; no machine runtime paths, tokens, indexes, or platform handlers copied.');
