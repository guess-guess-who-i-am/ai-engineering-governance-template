import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const configFile=path.join(root,'config.toml');
const file=fileURLToPath(new URL('./technical-research-mcp.mjs',import.meta.url));
await import('@modelcontextprotocol/sdk/server/index.js');
const original=await readFile(configFile,'utf8');
const header='[mcp_servers.technical_research]';
const block=header+'\ncommand = '+JSON.stringify(process.execPath)+'\nargs = ['+JSON.stringify(file)+']\nstartup_timeout_sec = 10\ntool_timeout_sec = 40\nenabled = true\n';
const pattern=/^\[mcp_servers\.technical_research\][\s\S]*?(?=^\[|$(?![\s\S]))/m;
const match=pattern.exec(original);
const next=match?original.slice(0,match.index)+block+(match.index+match[0].length<original.length?'\n':'')+original.slice(match.index+match[0].length):original.trimEnd()+'\n\n'+block;
if(next===original){console.log(JSON.stringify({status:'current',server:'technical_research',entry:file}));}
else{
 const backup=path.join(root,'backups','technical-research',new Date().toISOString().replace(/[:.]/g,'-'));
 await mkdir(backup,{recursive:true});await copyFile(configFile,path.join(backup,'config.toml'));
 const tmp=configFile+'.technical-research.tmp';await writeFile(tmp,next,{mode:0o600});
 const {rename}=await import('node:fs/promises');await rename(tmp,configFile);
 console.log(JSON.stringify({status:'installed',server:'technical_research',entry:file,backup,otherConfigurationUnchanged:true}));
}
