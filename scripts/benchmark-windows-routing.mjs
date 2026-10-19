import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
const root=process.argv[2];if(!root)throw new Error('Pass candidate or installed .codex root');
const queryCases=[
 ['root-hypothesis','请先猜测 3 到 5 个可能的根因，给出可证伪预测，再做最小实验',['systematic-debugging']],
 ['failure','为什么失败',['systematic-debugging','root-cause-analysis']],
 ['project','我有一个模糊的产品想法，请帮我建立一个全新的项目和仓库',['start-new-project']],
 ['api','修改一个被多个消费者使用的 HTTP API 和共享 schema',['evolve-contracts']],
 ['paper','为论文选择高引用 baseline 和权威 benchmark，并核查证据',['method-research-evidence']],
 ['frontend','Build a responsive frontend landing page for an AI product',['build-designed-interface']],
 ['gesture','Design a draggable bottom sheet with spring physics and interruption',['apple-design']],
 ['github','提交并推送这些改动到 GitHub',['method-github-delivery']],
 ['methodology','修改全局方法论提示词并发布中英文版本',['manage-global-methodology']],
 ['external','请使用根因分析方法，先提出可证伪的假设，再决定最小诊断实验',['systematic-debugging','root-cause-analysis']],
 ['semantic-debug','程序运行结果突然不对，先列出几种能被实验推翻的解释，分别验证再找出原因',['systematic-debugging','root-cause-analysis','diagnosing-bugs','diagnose']],
 ['semantic-contract','Several consumers rely on this shared HTTP schema. Plan the producer and consumer changes together.',['evolve-contracts']],
 ['semantic-research','Select highly cited scientific baselines and reliable benchmarks for this study.',['method-research-evidence']],
 ['negative-greeting','你好',[]],['negative-summary','把这一句话精简一下',[]],['negative-math','计算 17 乘以 23',[]]
];
const results=[];
for(const [id,query,gold]of queryCases){
 const started=performance.now();
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'hooks/skill-router.mjs')],{env:{...process.env,CODEX_HOME:root},windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>resolve({stdout,stderr,code}));child.stdin.end(JSON.stringify({hook_event_name:'UserPromptSubmit',prompt:query,cwd:process.cwd()}));});
 const context=JSON.parse(result.stdout).hookSpecificOutput?.additionalContext||'';
 const names=[...context.matchAll(/^- ([^ ]+) \[/gm)].map(x=>x[1]);
 const entry={id,gold,names,pass:result.code===0&&(gold.length?gold.some(x=>names.includes(x)):names.length===0),milliseconds:Math.round(performance.now()-started),stderr:result.stderr};
 results.push(entry);console.log(JSON.stringify(entry));
}
await writeFile('.reports/windows-routing-benchmark.json',JSON.stringify({root,results},null,2)+'\n');
if(results.some(x=>!x.pass))process.exitCode=1;
