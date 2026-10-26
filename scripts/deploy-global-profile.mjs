#!/usr/bin/env node
// One deterministic installation path. No model API, no Agent delegation.
import { spawn } from 'node:child_process';
import { copyFile, cp, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSkillLibrary } from './ensure-global-skill-library.mjs';
import { install } from './install-codex-profile-mac.mjs';
import { serviceDocument, resourcePlan } from './global-profile-service.mjs';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scripts = ['deploy-global-profile.mjs', 'global-profile-service.mjs', 'graph-worker-supervisor.mjs',
  'install-global-profile-service.ps1', 'ensure-global-skill-library.mjs', 'install-codex-profile-mac.mjs',
  'install-task-tree-mcp-mac.mjs', 'retire-serena-mcp.mjs', 'parallel-run.mjs', 'warm-global-graph.py',
  'deploy-codex-profile-mac.sh', 'install-codex-profile-mac.sh', 'install-codex-profile-service-mac.sh',
  'run-codex-profile-service-mac.sh', 'test-codex-profile-mac.mjs', 'launch-global-profile.sh'];

async function run(command, args, { env = process.env, timeout = 180000, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (capture) { child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', () => {}); }
    const timer = setTimeout(() => { child.kill(); reject(new Error(path.basename(command) + ' timed out')); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${path.basename(command)} exited ${code}`)); });
  });
}

async function writeManaged(file, body, home, check) {
  let previous;
  try {
    if ((await lstat(file)).isSymbolicLink()) throw new Error('Refusing symbolic link: ' + file);
    previous = await readFile(file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.equals(body)) return;
  if (check) throw new Error('Missing or stale global file: ' + file);
  if (previous) {
    const backup = path.join(home, '.codex/backups/one-click', new Date().toISOString().replaceAll(':', '-'), path.relative(home, file));
    await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
    await copyFile(file, backup);
  }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + `.${process.pid}.tmp`;
  await writeFile(temporary, body, { mode: 0o600 });
  await rename(temporary, file);
}

async function service({ home, check, resources }) {
  const root = path.join(home, '.codex');
  const spec = serviceDocument({ platform: process.platform, home, resources });
  await writeManaged(spec.file, Buffer.from(spec.text), home, check);
  if (process.platform === 'linux') {
    if (!check) {
      await run('systemctl', ['--user', 'daemon-reload']);
      await run('systemctl', ['--user', 'enable', '--now', 'codex-graph-worker.service']);
      const linger = (await run('loginctl', ['show-user', String(process.getuid()), '--property=Linger', '--value'], { capture: true })).trim();
      if (linger !== 'yes') {
        console.log('Linux开机无需登录：请在系统授权窗口允许启用当前用户的linger。');
        await run('loginctl', ['enable-linger', os.userInfo().username]);
      }
    }
    await run('systemctl', ['--user', 'is-enabled', 'codex-graph-worker.service']);
    await run('systemctl', ['--user', 'is-active', 'codex-graph-worker.service']);
    if ((await run('loginctl', ['show-user', String(process.getuid()), '--property=Linger', '--value'], { capture: true })).trim() !== 'yes') throw new Error('Linux linger is not enabled');
  } else if (process.platform === 'darwin') {
    const target = `gui/${process.getuid()}/com.codex.global-graph`;
    let loaded = true;
    try { await run('/bin/launchctl', ['print', target], { capture: true }); } catch { loaded = false; }
    if (!loaded && !check) await run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, spec.file]);
    await run('/bin/launchctl', ['print', target], { capture: true });
  } else {
    await run('powershell.exe', ['-NoProfile', '-File', path.join(root, 'hooks/install-global-profile-service.ps1'), '-CodexRoot', root, ...(check ? ['-Check'] : [])]);
  }
}

export async function deploy({ home = os.homedir(), check = false, noService = false, noTaskTree = false } = {}) {
  home = path.resolve(home);
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('Unsupported operating system');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('请用图形安装器安装Node.js 20或更新LTS版本。');
  const root = path.join(home, '.codex');
  const resources = resourcePlan();
  console.log(`全局安装：${process.platform}；检索池 ${resources.processes} 进程；Agent硬上限20（不强制创建Agent）。`);
  await run('git', ['--version'], { capture: true }).catch(() => { throw new Error('请用图形安装器安装Git：https://git-scm.com/downloads'); });
  let python;
  for (const candidate of [process.env.CODEX_PYTHON, ...(process.platform === 'win32' ? ['py', 'python'] : ['/opt/homebrew/bin/python3', 'python3'])].filter(Boolean)) {
    try {
      await run(candidate, ['-c', 'import sys; assert sys.version_info >= (3,10)'], { capture: true });
      python = candidate; break;
    } catch { /* Try the next actual runtime, not a Windows Store alias. */ }
  }
  if (!python) throw new Error('需要Python 3.10或更新版本（含venv/pip），请图形安装：https://www.python.org/downloads/');
  process.env.CODEX_PYTHON = python;
  let library;
  try { library = await ensureSkillLibrary({ home, check }); }
  catch (error) {
    if (check || process.env.CODEX_PROFILE_INTERACTIVE !== '1') throw error;
    console.log('无法恢复私有Skill库。接下来通过GitHub浏览器授权，不读取或复制其他电脑的凭据。');
    await run('gh', ['auth', 'login', '--web', '--git-protocol', 'https']);
    await run('gh', ['auth', 'setup-git']);
    library = await ensureSkillLibrary({ home });
  }
  process.env.CODEX_PROFILE_SKILL_SOURCE = library.root;
  process.env.CODEX_PROFILE_REQUIRE_COMPLETE = '1';
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: root, CODEX_SKILL_REGISTRY_FOREGROUND: '1' };
  // Remove the rejected integration before normal profile backups run.
  await run(process.execPath, [path.join(repository, 'scripts/retire-serena-mcp.mjs'), '--home', home, ...(check ? ['--check'] : [])], { env });
  const result = await install({ home, check });
  for (const [source, destination] of [['graph-worker-supervisor.mjs', 'hooks/graph-worker-supervisor.mjs'],
    ['warm-global-graph.py', 'hooks/warm-global-graph.py'], ['parallel-run.mjs', 'tools/parallel-run.mjs'],
    ['install-global-profile-service.ps1', 'hooks/install-global-profile-service.ps1']]) {
    await writeManaged(path.join(root, destination), await readFile(path.join(repository, 'scripts', source)), home, check);
  }
  if (!noTaskTree) await run(process.execPath, [path.join(repository, 'scripts/install-task-tree-mcp-mac.mjs'), '--home', home, ...(check ? ['--check'] : [])], { env });
  // Windows endpoint ACL is established before any worker can create its token.
  if (!noService && process.platform === 'win32') await service({ home, check, resources });
  const graphPython = process.env.CODEX_GRAPH_TOOL_PYTHON || path.join(root, 'tools/graph-tool-call-venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
  await run(graphPython, [path.join(root, 'hooks/graph_skill_index.py'), 'refresh',
    '--lock', path.join(root, 'skill-registry/refresh.lock'), '--node', process.execPath,
    '--script', path.join(root, 'hooks/refresh-skill-registry.mjs'), '--wait-timeout', '1200'],
  { env, timeout: 1200000 });
  const manifest = JSON.parse(await readFile(path.join(root, 'skill-registry/external-skills-manifest.json'), 'utf8'));
  if (manifest.missingSkillCount || manifest.invalidSkillCount || manifest.ownedSkillCount < 22 || manifest.embedding !== 'sentence-transformers/all-MiniLM-L6-v2') {
    throw new Error('全量图验收失败；没有宣称安装完成。');
  }
  if (!noService && process.platform !== 'win32') await service({ home, check, resources });
  if (!noService) {
    await run(graphPython, [path.join(root, 'hooks/warm-global-graph.py'), '--graph', path.join(root, 'skill-registry/skills.graph.json'), '--processes', String(resources.processes)], { env, timeout: 180000 });
  }
  if (!check) {
    const stable = path.join(root, 'tools/ai-engineering-governance-template');
    if (repository !== stable) {
      await mkdir(path.join(stable, 'scripts'), { recursive: true, mode: 0o700 });
      await cp(path.join(repository, 'codex-profile'), path.join(stable, 'codex-profile'), { recursive: true });
      for (const name of scripts) await copyFile(path.join(repository, 'scripts', name), path.join(stable, 'scripts', name));
    }
  }
  const report = { schema: 'global-profile-install/v1', platform: process.platform, status: check ? 'current' : 'installed',
    resources, ownedSkillCount: manifest.ownedSkillCount, externalSkillCount: manifest.externalSkillCount,
    mcpToolCount: manifest.mcpToolCount, embedding: manifest.embedding, trust: result.trust,
    service: noService ? 'not-tested' : 'verified', taskTree: noTaskTree ? 'not-tested' : 'verified',
    startup: process.platform === 'linux' ? 'boot-without-login' : 'after-user-login',
    verificationScope: noService || noTaskTree ? 'partial-test-only' : 'full-installation' };
  if (!check) await writeManaged(path.join(root, 'install-report.json'), Buffer.from(JSON.stringify(report, null, 2) + '\n'), home, false);
  console.log(JSON.stringify(report, null, 2));
  console.log('所有工作区共享同一份全局配置。已有会话的静态工具列表可能需要新建会话。首次Hook信任请在Codex中确认；安装器不会伪造信任。');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === '--home') { options.home = process.argv[++index]; if (!options.home) throw new Error('--home requires a path'); }
    else if (arg === '--check') options.check = true;
    else if (arg === '--no-service') options.noService = true;
    else if (arg === '--no-task-tree') options.noTaskTree = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  deploy(options).catch(error => { console.error('安装未完成：' + error.message); process.exitCode = 1; });
}
