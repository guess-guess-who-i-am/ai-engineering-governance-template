#!/usr/bin/env node
// Independent read-only integrity verification. Never loads MCP credential files.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const args=process.argv.slice(2);
const opt=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
const catalogFile=opt('--catalog');
const expertAuditFile=opt('--expert-audit');
const sourceAuditDir=opt('--source-audit');
const out=opt('--out');
if(!catalogFile||!expertAuditFile||!sourceAuditDir) throw new Error('Required: --catalog <json> --expert-audit <json> --source-audit <directory> [--out <json>]');
const start=performance.now();
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const catalog=json(catalogFile);
const expertAudit=json(expertAuditFile);
const sourceExperts=json(path.join(sourceAuditDir,'experts.json'));
const sourceSkills=json(path.join(sourceAuditDir,'skills-all.json'));
const expertByName=new Map(expertAudit.records.map(r=>[r.name,r]));
const sourceExpertByName=new Map(sourceExperts.map(r=>[r.name,r]));
const sourceSkillByHash=new Map(sourceSkills.map(r=>[r.package_hash,r]));
const hashCache=new Map();
const checks=[];const differences=[];const omissions=[];const moduleRecords=[];
let active=0,maxInFlight=0;
function hashFile(file) {
  if(hashCache.has(file)) return hashCache.get(file);
  const work=(async()=>{active++;maxInFlight=Math.max(maxInFlight,active);try{
    const h=crypto.createHash('sha256');
    for await(const chunk of fs.createReadStream(file)) h.update(chunk);
    return h.digest('hex');
  }finally{active--;}})();
  hashCache.set(file,work);return work;
}
function checkHash(module,scope,file,expected,relative) {
  checks.push(async()=>{try{
    const actual=await hashFile(file);
    if(actual!==expected) differences.push({module:module.id,scope,path:relative??file,issue:'hash-mismatch',expected,actual});
  }catch(e){differences.push({module:module.id,scope,path:relative??file,issue:e.code??e.message});}});
}
function safeJoin(root,rel) {
  const dest=path.resolve(root,rel);
  if(dest!==path.resolve(root)&&!dest.startsWith(path.resolve(root)+path.sep))throw new Error('Path escapes root: '+rel);
  return dest;
}
for(const m of catalog.modules) {
  const rec={id:m.id,kind:m.kind,hashChecks:0,omissions:0};moduleRecords.push(rec);
  if(m.kind==='expert') {
    const a=expertByName.get(m.name),source=sourceExpertByName.get(m.name);
    if(!a||!source){differences.push({module:m.id,issue:'source-audit-missing'});continue;}
    const omit=new Map((m.install_receipt?.omitted??[]).map(x=>[x.path,x.reason]));
    for(const [rel,expected] of Object.entries(a.hashes)) {
      checkHash(m,'original-source',safeJoin(source.path,rel),expected,rel);rec.hashChecks++;
      if(omit.has(rel)) {
        const reason=omit.get(rel);
        omissions.push({module:m.id,path:rel,reason,scope:'installed-original-file'});rec.omissions++;
        if(!reason)differences.push({module:m.id,path:rel,issue:'omission-reason-missing'});
      }else{checkHash(m,'installed-expert',safeJoin(m.package_root,rel),expected,rel);rec.hashChecks++;}
    }
    for(const [rel]of omit)if(!(rel in a.hashes))differences.push({module:m.id,path:rel,issue:'omission-not-in-source-audit'});
  }else if(m.kind==='skill') {
    for(const omission of m.install_receipt?.omitted??[]) {
      omissions.push({module:m.id,path:omission.path,reason:omission.reason,scope:'skill-install-receipt'});rec.omissions++;
      if(!omission.reason)differences.push({module:m.id,path:omission.path,issue:'omission-reason-missing'});
    }
    if(!m.entry_hash){differences.push({module:m.id,issue:'entry-hash-missing'});continue;}
    // A nested skill's package_root can be its enclosing expert. Entry lives at m.path.
    checkHash(m,'installed-skill-entry',m.path,m.entry_hash);rec.hashChecks++;
    const source=sourceSkillByHash.get(m.package_hash);
    if(source){checkHash(m,'original-skill-entry',source.path,m.entry_hash);rec.hashChecks++;}
    else differences.push({module:m.id,issue:'source-skill-audit-missing'});
  }else if(m.kind==='mcp-service') {
    // Own generated descriptors only. Do not open m.source_definition or credentials.
    checks.push(async()=>{try{const s=await fsp.stat(m.path);if(!s.isFile()||!s.size)differences.push({module:m.id,scope:'mcp-descriptor',issue:'empty-or-not-file'});}catch(e){differences.push({module:m.id,scope:'mcp-descriptor',issue:e.code??e.message});}});
  }
}
let cursor=0;
await Promise.all(Array.from({length:20},async()=>{while(cursor<checks.length){const i=cursor++;await checks[i]();}}));
const summarize=(kind)=>moduleRecords.filter(r=>r.kind===kind);
const result={schemaVersion:1,generatedAt:new Date().toISOString(),catalog:catalogFile,
  scope:'Full source/installed expert file hashes excluding explicit reasoned omissions; skill entry hashes at actual module.path; own MCP descriptors exist/nonempty only. No functional/credential validation.',
  summary:{modules:catalog.modules.length,experts:summarize('expert').length,skills:summarize('skill').length,mcpDescriptors:summarize('mcp-service').length,
    scheduledChecks:checks.length,uniqueHashedFiles:hashCache.size,concurrencyLimit:20,maxInFlightFileReads:maxInFlight,
    differences:differences.length,explicitOmissions:omissions.length,
    verifiedHashesMatch:differences.length===0,completeOriginalPackagePreservation:differences.length===0&&omissions.length===0,
    status:differences.length?'FAIL':omissions.length?'MATCH_WITH_EXPLICIT_OMISSIONS':'EXACT_MATCH',elapsedMs:performance.now()-start},
  omissions,differences,moduleRecords};
if(out){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify(result.summary,null,2));
if(differences.length)process.exitCode=1;
