// Secrets remain in process memory and the user's existing credential store.
import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const capture=(command,args)=>new Promise((resolve,reject)=>{
  execFile(command,args,{timeout:1500,maxBuffer:16384,encoding:'utf8'},(error,stdout)=>{
    // Never propagate child stdout/stderr through errors: they can contain tokens.
    if(error)reject(Object.assign(new Error('Credential lookup failed'),{exitCode:error.code}));else resolve(stdout.trim());
  });
});
export function createCredentialProvider({env=process.env,home=os.homedir(),platform=process.platform,run=capture}={}){
  const memo=new Map();
  return async source=>{
    const names={github:['GH_TOKEN','GITHUB_TOKEN'],stackoverflow:['STACKEXCHANGE_ACCESS_TOKEN','STACKEXCHANGE_KEY'],openalex:['OPENALEX_API_KEY']}[source]||[];
    for(const name of names)if(env[name]?.trim())return {token:env[name].trim(),kind:'environment'};
    if(!names.length)return {kind:'public'};
    const saved=memo.get(source);if(saved&&saved.until>Date.now())return saved.work;
    const work=(async()=>{
      if(source==='github'){
        const candidates=[path.join(home,'bin/gh'),'/opt/homebrew/bin/gh','/usr/local/bin/gh','/usr/bin/gh'];
        for(const command of candidates){
          try{await access(command);}catch{continue;}
          try{const token=await run(command,['auth','token','--hostname','github.com']);if(token)return {token,kind:'github-cli'};}
          catch{return {kind:'anonymous',diagnostic:'GitHub CLI credential unavailable; run gh auth login through the official GitHub flow.'};}
        }
        return {kind:'anonymous',diagnostic:'GitHub CLI is not installed or logged in.'};
      }
      if(platform==='darwin'){
        try{
          const token=await run('/usr/bin/security',['find-generic-password','-s','com.codex.research.'+source,'-a',os.userInfo().username,'-w']);
          if(token)return {token,kind:'keychain'};
        }catch{}
      }
      return {kind:'anonymous',diagnostic:'No official API credential configured; public quota only.'};
    })();
    memo.set(source,{work,until:Date.now()+60000});return work;
  };
}
