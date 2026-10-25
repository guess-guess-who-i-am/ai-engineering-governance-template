import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportResourcePackages } from './export-resource-packages.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'resource-export-'));
try {
  const source = path.join(root, 'resource-packages');
  const output = path.join(root, 'export');
  await mkdir(path.join(source, 'expert', 'complete-role'), { recursive: true });
  await mkdir(path.join(source, 'skill', 'complete-skill'), { recursive: true });
  await mkdir(path.join(source, 'mcp-service', 'complete-service'), { recursive: true });
  await writeFile(path.join(source, 'expert', 'complete-role', 'agents.md'), 'Original complete role\n');
  await writeFile(path.join(source, 'skill', 'complete-skill', 'SKILL.md'), 'Original complete Skill\n');
  await writeFile(path.join(source, 'mcp-service', 'complete-service', 'MODULE.md'), 'Original MCP descriptor\n');
  const result = await exportResourcePackages({ source, output, revision: 'fixture' });
  assert.equal(result.files, 3);
  assert.equal(result.verifiedListing, true);
  const manifest = JSON.parse(await readFile(path.join(output, 'resource-packages.manifest.json'), 'utf8'));
  assert.equal(manifest.sourceRevision, 'fixture');
  assert.equal(manifest.files.length, 3);
  await writeFile(path.join(source, 'skill', 'complete-skill', 'auth.json'), '{}');
  await assert.rejects(exportResourcePackages({ source, output }), /Credential\/cache path/);
  console.log('PASS private resource export: complete files inventoried, archive listing verified, credential-like path blocks export.');
} finally { await rm(root, { recursive: true, force: true }); }
