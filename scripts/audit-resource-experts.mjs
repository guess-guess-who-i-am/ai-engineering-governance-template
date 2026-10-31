#!/usr/bin/env node
// Read-only package audit. Does not execute bundled scripts or call external tools.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name) => { const i=args.indexOf(name); return i<0 ? undefined : args[i+1]; };
const source=opt('--source');
if (!source) throw new Error('Usage: node scripts/audit-resource-experts.mjs --source <experts-directory> [--out <json>]');
const start=performance.now();
const safeText=(file)=>fs.readFileSync(file,'utf8');
function filesAt(root) {
  const files=[];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,ent.name);
      if (ent.isDirectory()) walk(file);
      else if(ent.isFile()) files.push(path.relative(root,file));
    }
  }
  walk(root); return files.sort();
}
function unique(values) { return [...new Set(values)]; }
const records=[];
for (const name of fs.readdirSync(source).sort()) {
  const root=path.join(source,name);
  if (!fs.statSync(root).isDirectory()) continue;
  const files=filesAt(root);
  const manifestPath=['.codebuddy-plugin/plugin.json','.workbuddy-plugin/plugin.json'].find(x=>files.includes(x));
  let manifest={},manifestError;
  if(manifestPath) { try { manifest=JSON.parse(safeText(path.join(root,manifestPath))); } catch(e) { manifestError=e.message; } }
  const declared=Array.isArray(manifest.agents)?manifest.agents:typeof manifest.agents==='string'?[manifest.agents]:[];
  const declaredPaths=declared.map(x=> typeof x==='string' ? x.replace(/^\.\//,'') : x?.path).filter(Boolean);
  const expandedAgents=unique(declaredPaths.flatMap(rel=> {
    const full=path.join(root,rel);
    if(fs.existsSync(full)&&fs.statSync(full).isDirectory()) return files.filter(x=>x.startsWith(rel.replace(/\/$/,'')+'/')&&/\.md$/i.test(x));
    return [rel];
  }));
  const agents=files.filter(x=>/^agents\/.*\.md$/i.test(x));
  const skills=files.filter(x=>/(^|\/)SKILL\.md$/.test(x));
  const textFiles=files.filter(x=>/\.(md|json|py|mjs|js|sh|yaml|yml|toml|ps1)$/i.test(x));
  const texts=textFiles.map(x=>[x,safeText(path.join(root,x))]);
  const all=texts.map(x=>x[1]).join('\n');
  const toolHints=unique((all.match(/\b(?:TeamCreate|TeamDelete|SendMessage|AskUserQuestion|WebSearch|WebFetch|TaskCreate|TaskUpdate|workbuddy_[a-z_]+|mcp__[a-zA-Z0-9_]+)\b/g)||[]));
  const referencedPaths=[];
  for(const [file,body] of texts.filter(x=>/\.md$/i.test(x[0]))) {
    for(const match of body.matchAll(/(?:\]\(|@)((?:\.\.?\/)?(?:agents|skills|references?|templates|bin|\.workbuddy-plugin|\.codebuddy-plugin)\/[\w./-]+)(?:[)#\s]|$)/g)) {
      const rel=match[1];
      const found=[path.resolve(root,rel),path.resolve(root,path.dirname(file),rel)].some(p=>p.startsWith(path.resolve(root)+path.sep)&&fs.existsSync(p));
      referencedPaths.push({file,reference:rel,exists:found});
    }
  }
  const hashes=Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
  records.push({name,manifestPath:manifestPath??null,manifestError:manifestError??null,
    description:manifest.description??'',displayDescription:manifest.displayDescription??{},
    category:manifest.categoryId??null,tags:manifest.tags??[],agentName:manifest.agentName??null,expertType:manifest.expertType??null,
    teamInfo:manifest.teamInfo??null,declaredAgentPaths:declaredPaths,declaredAgents:expandedAgents,
    missingDeclaredAgents:declaredPaths.filter(x=>!fs.existsSync(path.join(root,x))),
    agentFiles:agents,skillFiles:skills,scriptFiles:files.filter(x=>/\.(py|mjs|js|sh|ps1)$/i.test(x)),
    licenseDeclared:manifest.license??null,licenseFiles:files.filter(x=>/(^|\/)(license|copying|notice)([.\/-]|$)/i.test(x)),
    hostHints:unique((all.match(/\b(?:WorkBuddy|CodeBuddy|TeamCreate|SendMessage|AskUserQuestion|Claude|Codex)\b/g)||[])),
    hostManifestPathMismatch:/\.workbuddy-plugin\/plugin\.json/.test(all)&&!files.includes('.workbuddy-plugin/plugin.json'),
    toolHints,referencedPaths,
    forcedPassClause:/(?:第\s*3\s*轮[\s\S]{0,100}(?:必须|强制)[\s\S]{0,60}PASS|超时[\s\S]{0,30}视[\s\S]{0,20}PASS)/i.test(all),
    hashes,files:files.length,bytes:files.reduce((n,file)=>n+fs.statSync(path.join(root,file)).size,0)});
}
const sum=(fn)=>records.reduce((n,r)=>n+fn(r),0);
const report={schemaVersion:1,generatedAt:new Date().toISOString(),source,
  scope:'Static full-package file/hash and manifest/reference scan; no bundled code executed; regex hints are not compatibility proof.',
  summary:{packages:records.length,agentFiles:sum(r=>r.agentFiles.length),declaredAgentEntries:sum(r=>r.declaredAgents.length),skillEntrypoints:sum(r=>r.skillFiles.length),
    files:sum(r=>r.files),bytes:sum(r=>r.bytes),manifestMissing:sum(r=>!r.manifestPath?1:0),
    missingDeclaredAgents:sum(r=>r.missingDeclaredAgents.length),referenceSuspicions:sum(r=>r.referencedPaths.filter(x=>!x.exists).length),
    packagesWithScript:sum(r=>r.scriptFiles.length?1:0),packagesWithTeamToolHints:sum(r=>r.toolHints.some(x=>['TeamCreate','SendMessage'].includes(x))?1:0),
    packagesWithHostManifestPathMismatch:sum(r=>r.hostManifestPathMismatch?1:0),
    packagesWithForcedPassHint:sum(r=>r.forcedPassClause?1:0),elapsedMs:performance.now()-start},records};
const out=opt('--out');
if(out) { fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n'); }
console.log(JSON.stringify(report.summary,null,2));
