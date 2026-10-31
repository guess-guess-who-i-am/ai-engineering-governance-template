#!/usr/bin/env node
// Install complete source packages globally; metadata/adapters live outside them.
import { createHash } from 'node:crypto';
import { access, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExpertEntry, blockedExpertEntry } from './expert-entry.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
async function exists(p) { try { await access(p); return true; } catch { return false; } }
export function scalar(text, key) {
  const block = text.replace(/^\uFEFF/, '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
  const lines = block.split(/\r?\n/), index = lines.findIndex(line => line.startsWith(key + ':'));
  if (index < 0) return '';
  const first = lines[index].slice(key.length + 1).trim();
  const parts = [];
  for (let i = index + 1; i < lines.length && (/^\s/.test(lines[i]) || !lines[i]); i++) parts.push(lines[i].trim());
  const blockStyle = /^[>|][+-]?(?:\s+#.*)?$/.test(first);
  return (blockStyle ? parts : [first,...parts]).join(blockStyle && first[0]==='|' ? '\n' : ' ')
    .trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
}
function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}
const excluded = name => /^(?:\.git|node_modules|__pycache__|\.venv|venv|\.DS_Store|\.env(?:\..*)?|\.npmrc|\.netrc|auth\.json|credentials(?:\.json)?|id_(?:rsa|ed25519)(?:\.pub)?)$/i.test(name) || /\.(?:key|p12|pfx)$/i.test(name);
async function copyPackage(source, target) {
  const root = await realpath(source), files = [], omitted = [], visited = new Set();
  async function visit(from, to, relative) {
    let resolved;
    try { resolved = await realpath(from); }
    catch(error) {
      if(error.code==='ENOENT' && (await lstat(from)).isSymbolicLink()) {
        omitted.push({path:relative,reason:'broken-source-symlink'}); return;
      }
      throw error;
    }
    if (resolved !== root && !resolved.startsWith(root + path.sep)) { omitted.push({path:relative, reason:'external-symlink'}); return; }
    const info = await stat(resolved);
    if (info.isDirectory()) {
      if (visited.has(resolved)) { omitted.push({path:relative, reason:'directory-cycle'}); return; }
      visited.add(resolved); await mkdir(to, {recursive:true, mode:0o700});
      const entries = await readdir(resolved, {withFileTypes:true});
      for (const entry of entries) {
        const rel = path.join(relative, entry.name);
        if (excluded(entry.name)) { omitted.push({path:rel, reason:'machine-state-or-sensitive-file'}); continue; }
        await visit(path.join(resolved, entry.name), path.join(to, entry.name), rel);
      }
      visited.delete(resolved);
    } else if (info.isFile()) {
      await copyFile(resolved, to);
      // Refresh even same-size content. No textual transformation is applied.
      files.push({path:relative, bytes:info.size});
    } else omitted.push({path:relative, reason:'non-regular-file'});
  }
  await visit(root, target, '');
  return {files:files.length, bytes:files.reduce((n,f)=>n+f.bytes,0), omitted};
}
async function mapLimit(rows, width, run) {
  let next = 0;
  const output = new Array(rows.length);
  await Promise.all(Array.from({length:Math.min(width, rows.length)}, async () => {
    while (next < rows.length) { const index = next++; output[index] = await run(rows[index], index); }
  }));
  return output;
}
async function atomic(file, value) {
  await mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const temp = file + '.' + process.pid + '.tmp';
  await writeFile(temp, value, {mode:0o600}); await rename(temp, file);
}
async function manifestAt(root) {
  for (const directory of ['.codebuddy-plugin','.workbuddy-plugin']) {
    try { return JSON.parse(await readFile(path.join(root,directory,'plugin.json'),'utf8')); } catch { /* Optional. */ }
  }
  return {};
}

export async function expertRetrievalProfile(module, manifest) {
  manifest ||= await manifestAt(module.package_root);
  // Only capability descriptions are retrieval content. Initial prompts,
  // examples, tags and transport identifiers are execution/manifest metadata.
  const hints = [...new Set(strings([manifest.description, manifest.displayDescription,
    manifest.profession]).map(value=>value.trim()).filter(Boolean))].join(' ');
  let scope, provenance;
  try {
    const primary = await buildExpertEntry(module);
    const original = await readFile(primary.originalPath, 'utf8');
    scope = scalar(original, 'description');
    const field = scope ? 'frontmatter.description' : 'original-role-body';
    if (!scope) scope = original.replace(/^\uFEFF/, '').replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/, '').trim();
    provenance = {state:'source-grounded',primary_path:path.relative(await realpath(module.package_root),primary.originalPath),
      primary_sha256:primary.primarySha256,field};
  } catch (error) {
    const blocked = blockedExpertEntry(module,error);
    scope = `Unavailable complete expert: ${blocked.reason}. No original primary role can be loaded.`;
    provenance = {state:'blocked',reason:blocked.reason};
  }
  return {description:`${module.name} ${scope}`,original_description:scope,
    retrieval_document:`${module.name} ${hints || scope}`,
    retrieval_original_document:hints || scope,retrieval_provenance:provenance};
}

export async function importResources({source, output, install=false, concurrency=12, auditDirectory}) {
  if (!Number.isInteger(concurrency) || concurrency<1 || concurrency>100) throw new Error('concurrency must be 1..100');
  source = await realpath(source); output = path.resolve(output);
  const audit = path.join(source,'审计');
  const read = async name => JSON.parse(await readFile(path.join(audit,name),'utf8'));
  const [preferred, allSkills, experts, services] = await Promise.all(['skills.json','skills-all.json','experts.json','mcp.json'].map(read));
  const reports = auditDirectory || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.reports/resource-integration');
  const optionalAudit = async name => { try { return JSON.parse(await readFile(path.join(reports,`${name}-audit.json`),'utf8')); } catch(error) { if(error.code==='ENOENT') return {}; throw error; } };
  const [skillAudit,expertAudit,mcpAudit]=await Promise.all(['skills','experts','mcp'].map(optionalAudit));
  const skillEvidence=new Map((skillAudit.rows||[]).map(row=>[row.entryHash,row]));
  const expertEvidence=new Map((expertAudit.records||[]).map(row=>[row.name,row]));
  const mcpEvidence=new Map((mcpAudit.records||[]).map(row=>[row.sourceConfigHash,row]));
  const chosen = new Map(preferred.map(row=>[row.package_hash,row]));
  for (const row of allSkills) if (!chosen.has(row.package_hash)) chosen.set(row.package_hash,row);
  const packages = [...chosen.values()];
  const modules = [], failures = [];
  const base = path.join(output,'resource-packages');
  const work = [...experts.map(row=>({kind:'expert',row})), ...packages.map(row=>({kind:'skill',row})), ...services.map(row=>({kind:'mcp-service',row}))];
  const rows = await mapLimit(work, concurrency, async ({kind,row}) => {
    const fingerprint = row.package_hash || row.identity || row.config_hash;
    if (!fingerprint) return {error:{name:row.name,kind,error:'No audited content identity'}};
    const id = `${kind}:${row.name}:${fingerprint.slice(0,16)}`;
    const folder = path.join(base, kind, `${row.name.replace(/[^a-zA-Z0-9\u3400-\u9fff._-]/g,'_').slice(0,75)}--${fingerprint.slice(0,16)}`);
    try {
      if (kind === 'mcp-service') {
        // Do not read credential-bearing MCP definitions. Preserve their source location,
        // and copy only public connection coordinates already present in the audit.
        let connection;
        const evidence=mcpEvidence.get(row.config_hash);
        try {
          const u = new URL(row.url);
          if (u.protocol === 'https:' && !u.username && !u.password && !u.search && !/[{}]|\$/.test(u.href)) connection = {transport:'http',url:u.href};
        } catch { /* Stdio/credential-dependent services remain discoverable. */ }
        const tools=evidence?.tools || [];
        const description = [evidence?.graphDescription || row.name,...(row.aliases||[]),
          tools.length?`Available tool names: ${tools.map(tool=>tool.name).join(', ')}`:''].join(' ');
        const module = {id,name:row.name,kind,description,path:path.join(folder,'MODULE.md'),package_root:folder,
          original_description:evidence?.sourceDescription || row.name,
          source:'workbuddy-resource-library',availability:{state:evidence?.toolDiscovery?.state==='passed'?'tool-discovery-verified':'discovery-required',source_audit:row.status,cost:evidence?.cost||'unknown',authentication:(row.env_keys?.length||row.header_keys?.length||row.placeholders?.length)?'required-or-placeholder':'unknown',tool_count:tools.length,discovery_state:evidence?.toolDiscovery?.state||'not-run',description_quality:evidence?.descriptionQuality||'unknown'},
          dependencies:[],members:[],source_definition:row.path,license:evidence?.manifest?.license||'unknown',...(connection?{connection}:{})};
        if (install) {
          await mkdir(folder,{recursive:true,mode:0o700});
          if(tools.length) await atomic(path.join(folder,'TOOLS.json'),json({source:'live-tools-list',tools}));
          await atomic(module.path,`# MCP service: ${row.name}\n\n${description}\n\nThis registers the complete service. Discover its current tools and use the relevant original schema; tool discovery alone is not task verification.\n\nTransport: ${row.transport}\nAvailability: ${JSON.stringify(module.availability)}\n\nGlobal executor: ${path.join(output,'tools/resource-modules/resource-mcp-cli.mjs')}\nModule ID: ${id}\nActions: describe ID; list-tools ID; call ID --tool NAME --arguments JSON. Run with the host Node executable. Authentication-dependent or host-bound services need their real dependencies; do not guess credentials.\n${connection?`\nPublic endpoint: ${connection.url}\n`:''}`);
        }
        return {module};
      }
      const originalEntry = kind === 'skill' ? row.path : null;
      const root = kind === 'skill' ? path.dirname(row.path) : row.path;
      const manifest = kind === 'expert' ? await manifestAt(root) : {};
      const entryText = originalEntry ? await readFile(originalEntry,'utf8') : '';
      if (originalEntry && row.entry_hash && sha(entryText) !== row.entry_hash) throw new Error('Source entry changed since audit');
      const evidence=kind==='skill'?skillEvidence.get(row.entry_hash):expertEvidence.get(row.name);
      const description = kind === 'skill' ? evidence?.description || scalar(entryText,'description') : '';
      const inferred = !description;
      const originalDescription = description || entryText.match(/^#\s+(.+)$/m)?.[1] || row.name;
      let declared = Array.isArray(manifest.agents) ? manifest.agents.filter(x=>typeof x==='string') : [];
      if(evidence?.declaredAgentPaths?.length) declared=evidence.declaredAgentPaths;
      const agentsDirectory = path.join(root,'agents');
      const members = declared.length ? declared : await exists(agentsDirectory) ? (await readdir(agentsDirectory)).filter(x=>x.endsWith('.md')).map(x=>'agents/'+x) : [];
      const entryName = originalEntry ? path.basename(originalEntry) : 'MODULE.md';
      const module = {id,name:row.name,kind,description:`${row.name} ${originalDescription}`.slice(0,7000),original_description:originalDescription,
        path:path.join(folder,entryName),package_root:folder,source:'workbuddy-resource-library',
        availability:{state:evidence?.helperTrialStatus||'unverified',source_audit:row.status,description_inferred:inferred,
          ...(evidence?{audit_flags:evidence.flags||[],host_hints:evidence.hostHints||[],relative_reference_suspicions:(evidence.missingLinks||evidence.referencedPaths||[]).length,
            ...(kind==='expert'?{forced_pass_clause:!!evidence.forcedPassClause,host_manifest_path_mismatch:!!evidence.hostManifestPathMismatch}:{})}:{})},
        dependencies:kind==='skill'?(row.host_tools||[]):[],members:members.map(member=>({path:member})),
        license:manifest.license || scalar(entryText,'license') || 'unknown',entry_hash:row.entry_hash || '',package_hash:row.package_hash};
      if (kind === 'expert') Object.assign(module, await expertRetrievalProfile({...module,package_root:root},manifest));
      let receipt;
      if (install) {
        receipt = await copyPackage(root,folder);
        if (kind === 'skill') {
          const copied = await readFile(module.path);
          if (row.entry_hash && sha(copied)!==row.entry_hash) throw new Error('Installed entry checksum mismatch');
        } else {
          // Stable external entry loads the original role in one read. No mapping.
          const adapter = path.join(output,'resource-adapters',fingerprint.slice(0,24),'MODULE.md');
          module.path=adapter;
          let entry;
          try { entry = (await buildExpertEntry(module)).bytes; }
          catch (error) { entry = blockedExpertEntry(module, error).bytes; }
          await atomic(adapter,entry);
        }
        module.install_receipt=receipt;
        module.availability.attachment_omissions=receipt.omitted.length;
      }
      return {module};
    } catch(error) { return {error:{id,name:row.name,kind,error:error.message}}; }
  });
  for(const row of rows) row.module?modules.push(row.module):failures.push(row.error);
  // A nested Skill may reference data in its enclosing expert. Prefer the installed
  // complete expert layout when its exact entry bytes match; never rewrite paths.
  if(install) {
    const installedExperts=new Map(modules.filter(m=>m.kind==='expert').map(m=>[m.name,m]));
    for(const module of modules.filter(m=>m.kind==='skill')) {
      const original=packages.find(p=>p.package_hash===module.package_hash)?.path;
      const match=original?.match(/\/experts\/(?:full\/)?([^/]+)\/(.+)$/);
      const parent=match && installedExperts.get(match[1]);
      if(!parent) continue;
      const candidate=path.resolve(parent.package_root,match[2]);
      if(!candidate.startsWith(parent.package_root+path.sep) || !await exists(candidate)) continue;
      if(sha(await readFile(candidate))!==module.entry_hash) continue;
      module.path=candidate; module.package_root=parent.package_root;
      module.dependencies.push(parent.id);
      module.availability.relative_layout='complete-enclosing-expert-package';
    }
  }
  const catalog={schemaVersion:'codex-resource-modules/1',generatedAt:new Date().toISOString(),modules};
  const summary={schemaVersion:'resource-import-evidence/1',source,output,installed:install,
    sourceCounts:{preferredSkills:preferred.length,skillPackageVersions:packages.length,experts:experts.length,mcpServices:services.length},
    moduleCounts:Object.fromEntries(['expert','skill','mcp-service'].map(kind=>[kind,modules.filter(x=>x.kind===kind).length])),failures,
    copiedFiles:modules.reduce((n,m)=>n+(m.install_receipt?.files||0),0),copiedBytes:modules.reduce((n,m)=>n+(m.install_receipt?.bytes||0),0),
    omittedFiles:modules.reduce((n,m)=>n+(m.install_receipt?.omitted?.length||0),0),
    limitations:['Original modules are retained; machine credentials, dependency caches and external symlinks are excluded and recorded.',
      'Discovery and installation do not establish task accuracy or MCP invocation success.','Different content is not proof of a new capability.']};
  if(install) {
    if(failures.length) throw new Error(`Import incomplete (${failures.length}); catalog was not replaced: ${JSON.stringify(failures.slice(0,3))}`);
    await atomic(path.join(output,'skill-registry/resource-modules.json'),json(catalog));
    await atomic(path.join(output,'skill-registry/resource-import.json'),json(summary));
  }
  return {catalog,summary};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), get=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  const result=await importResources({source:get('--source','/Users/pku1727/Desktop/破解workbuddy/统一资源库'),output:get('--output',path.join(os.homedir(),'.codex')),install:args.includes('--install'),concurrency:Number(get('--concurrency','12'))});
  console.log(json(result.summary));
}
