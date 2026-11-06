import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function skillFiles(root) {
  const result = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await Promise.all(entries.map(async entry => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name === 'SKILL.md') result.push(target);
    }));
  }
  await visit(root);
  return result.sort();
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
  return value;
}

export async function graphInputsHash(ownedRoot, mcpTools, resourceCatalog) {
  const hash = createHash('sha256');
  for (const name of ['graph_skill_index.py', 'artifact_relations.py', 'complete_embedding.py', 'skill-retrieval.zh.json', 'mcp-retrieval.zh.json']) {
    hash.update(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), name)));
  }
  for (const file of await skillFiles(ownedRoot)) {
    hash.update(path.relative(ownedRoot, file)); hash.update('\0');
    hash.update(await readFile(file)); hash.update('\0');
  }
  hash.update(JSON.stringify(mcpTools.map(tool => JSON.stringify(stableJson(tool))).sort()));
  // Importers publish content hashes in this small manifest. Do not walk every
  // complete third-party package from a Hook or query worker.
  if (resourceCatalog) {
    try { const content = await readFile(resourceCatalog); hash.update('\0resource-modules\0'); hash.update(content); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return hash.digest('hex');
}

// The generatedAt field is observation metadata. Unchanged capabilities must not
// invalidate a graph candidate while a concurrent Hook rediscovers its servers.
export async function publishMcpCatalog(file,data){
  const identity=value=>JSON.stringify(value.map(tool=>JSON.stringify(stableJson(tool))).sort());
  try{
    const previous=JSON.parse(await readFile(file,'utf8'));
    if(previous.schemaVersion===data.schemaVersion&&Array.isArray(previous.tools)&&identity(previous.tools)===identity(data.tools))return previous;
  }catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(temporary,file);}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return data;
}
