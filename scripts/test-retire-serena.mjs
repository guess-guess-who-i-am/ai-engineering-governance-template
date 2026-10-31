import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { retireSerena } from './retire-serena-mcp.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'retire-serena-'));
const absent = async file => assert.rejects(stat(file), { code: 'ENOENT' });
async function put(home, relative, body) {
  const file = path.join(home, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}
try {
  const home = path.join(directory, 'managed home');
  const prefix = 'model = "keep-provider"\n[model_providers.private]\ncredential = "fixture-preserve"\n';
  const suffix = '\n[mcp_servers.other]\ncommand = "keep-other"\n';
  const configFile = path.join(home, '.codex/config.toml');
  const original = prefix + '\n[mcp_servers.serena] # installed by profile\ncommand = "node"\nargs = [\n  "/managed/serena-mcp.mjs",\n]\nenabled = false\n[mcp_servers.serena.env]\nKEEP = "profile-only"\n' + suffix;
  await put(home, '.codex/config.toml', original);
  await put(home, '.codex/skill-registry/routing-rules.json', JSON.stringify({ 'navigate-code-with-serena': ['Serena'], other: ['keep'] }));
  const skills = ['.agents/skills/navigate-code-with-serena', '.codex/tools/ai-engineering-governance-template/codex-profile/global-skills/navigate-code-with-serena'];
  for (const skill of skills) await put(home, skill + '/SKILL.md', '---\nname: navigate-code-with-serena\ndescription: managed fixture\n---\n');
  await put(home, '.codex/tools/serena-mcp.mjs', '// fixture tools/serena-runtime.json --project-from-cwd\n');
  await put(home, '.codex/tools/serena-runtime.json', JSON.stringify({ version: '2.1.0', executable: '/managed/bin/serena', python: '/managed/bin/python' }));
  await put(home, '.codex/tools/serena-navigation/navigation.yml', 'description: Global read-only source navigation for Codex\n');
  await mkdir(path.join(home, '.codex/tools/ai-engineering-governance-template/codex-profile/serena/empty-nested'), { recursive: true });
  await put(home, '.serena/user-data', 'keep original data');
  await put(home, '.codex/tools/unrelated', 'keep other tool');
  await put(home, '.reports/serena-experiment.json', '{"negativeResult":true}');
  await assert.rejects(retireSerena({ home, check: true }), /Managed Serena/);
  assert.equal(await readFile(configFile, 'utf8'), original, 'check mode must not mutate config');
  const result = await retireSerena({ home });
  assert.equal(result.status, 'retired');
  assert.ok(!Object.hasOwn(result, 'backup'), 'retirement must not create a backup');
  const config = await readFile(configFile, 'utf8');
  assert.equal(config, prefix + suffix, 'remove managed table and nested env, preserving other bytes');
  assert.equal((await stat(configFile)).mode & 0o777, 0o644, 'keep config permissions');
  for (const relative of [...skills, '.codex/tools/serena-mcp.mjs', '.codex/tools/serena-runtime.json', '.codex/tools/serena-navigation']) await absent(path.join(home, relative));
  await absent(path.join(home, '.codex/tools/ai-engineering-governance-template/codex-profile/serena'));
  await absent(path.join(home, '.codex/backups'));
  assert.deepEqual(JSON.parse(await readFile(path.join(home, '.codex/skill-registry/routing-rules.json'))), { other: ['keep'] });
  assert.equal(await readFile(path.join(home, '.serena/user-data'), 'utf8'), 'keep original data');
  assert.equal(await readFile(path.join(home, '.reports/serena-experiment.json'), 'utf8'), '{"negativeResult":true}');
  assert.equal(await readFile(path.join(home, '.codex/tools/unrelated'), 'utf8'), 'keep other tool');
  assert.equal((await retireSerena({ home, check: true })).status, 'current');
  assert.equal((await retireSerena({ home })).status, 'current');
  assert.ok(!(await readdir(path.join(home, '.codex'))).some(name => name.endsWith('.tmp')));

  // Independently managed Serena and a wrapper with an unrelated identity are not ours.
  const independent = path.join(directory, 'independent');
  const userConfig = '[mcp_servers.serena]\n# Replaced old serena-mcp.mjs independently\ncommand = "user-managed-serena"\nenabled = true\n[mcp_servers.serena.env]\nKEEP = "yes"\n';
  await put(independent, '.codex/config.toml', userConfig);
  assert.equal((await retireSerena({ home: independent })).status, 'current');
  assert.equal(await readFile(path.join(independent, '.codex/config.toml'), 'utf8'), userConfig);
  await put(independent, '.codex/tools/serena-mcp.mjs', '// user-created unrelated implementation\n');
  await assert.rejects(retireSerena({ home: independent }), /Unexpected.*identity/);
  assert.equal(await readFile(path.join(independent, '.codex/tools/serena-mcp.mjs'), 'utf8'), '// user-created unrelated implementation\n');

  // Preflight every destructive target before applying any edits.
  const unsafe = path.join(directory, 'unsafe');
  await put(unsafe, '.codex/config.toml', original);
  await put(unsafe, skills[0] + '/SKILL.md', '---\nname: unrelated-skill\n---\n');
  await assert.rejects(retireSerena({ home: unsafe }), /Unexpected Skill identity/);
  assert.equal(await readFile(path.join(unsafe, '.codex/config.toml'), 'utf8'), original);
  await absent(path.join(unsafe, '.codex/backups'));

  const quoted = path.join(directory, 'quoted');
  await put(quoted, '.codex/config.toml', '[mcp_servers."serena"]\r\nargs = ["/managed/serena-mcp.mjs"]\r\nenabled = true\r\n[mcp_servers."serena".env]\r\nKEY = "fixture"\r\n[[other]]\r\nname = "keep-array-table"\r\n');
  await retireSerena({ home: quoted });
  assert.equal(await readFile(path.join(quoted, '.codex/config.toml'), 'utf8'), '[[other]]\r\nname = "keep-array-table"\r\n');

  console.log('PASS Serena removal: managed/nested config deleted, files deleted without backups, providers/other MCP/user data/reports preserved, check mode, idempotence, preflight identity protection');
} finally { await rm(directory, { recursive: true, force: true }); }
