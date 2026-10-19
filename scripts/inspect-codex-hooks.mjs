import {spawn} from 'node:child_process';
const child=spawn('codex',['app-server','--stdio'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
let buffer='',stderr='',finished=false;
const finish=(code)=>{if(finished)return;finished=true;clearTimeout(timer);child.kill();process.exitCode=code;};
const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
const timer=setTimeout(()=>{console.error('Hook state query timed out');finish(1);},60000);
child.stderr.on('data',data=>stderr+=data);
child.on('error',error=>{console.error(error.message);finish(1);});
child.stdout.on('data',data=>{buffer+=data;let newline;while((newline=buffer.indexOf('\n'))>=0){const raw=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let msg;try{msg=JSON.parse(raw);}catch{continue;}
 if(msg.id===1){if(msg.error){console.error(JSON.stringify(msg.error));finish(1);return;}send({method:'initialized'});send({id:2,method:'hooks/list',params:{cwds:[process.cwd()]}});}
 if(msg.id===2){if(msg.error){console.error(JSON.stringify(msg.error));finish(1);return;}const result=msg.result?.data||[];console.log(JSON.stringify(result.map(x=>({cwd:x.cwd,errors:x.errors,warnings:x.warnings,hooks:x.hooks.map(h=>({eventName:h.eventName,enabled:h.enabled,trustStatus:h.trustStatus,source:h.source,timeoutSec:h.timeoutSec}))})),null,2));finish(0);}
}});
send({id:1,method:'initialize',params:{clientInfo:{name:'hook-state-audit',version:'1.0.0'},capabilities:{experimentalApi:true}}});
