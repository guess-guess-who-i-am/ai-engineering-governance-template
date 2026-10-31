import os from 'node:os';
import path from 'node:path';

export function resourcePlan({ cpus = os.availableParallelism(), memory = os.totalmem() } = {}) {
  const processes = Math.max(1, Math.min(8, cpus, Math.floor(memory * 0.45 / (3 * 1024 ** 3))));
  const memoryMax = Math.max(6, processes * 3);
  return { processes, memoryHigh: memoryMax - 2, memoryMax, maxRequests: 128, backlog: 256 };
}

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const systemdQuote = value => '"' + String(value).replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
export function serviceDocument({ platform, home, node = process.execPath, resources = resourcePlan() }) {
  const entry = path.join(home, '.codex/hooks/graph-worker-supervisor.mjs');
  const args = [node, entry, '--processes', String(resources.processes)];
  if (platform === 'darwin') return { file: path.join(home, 'Library/LaunchAgents/com.codex.global-graph.plist'),
    text: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.codex.global-graph</string><key>ProgramArguments</key><array>${args.map(x => `<string>${xml(x)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>3</integer><key>EnvironmentVariables</key><dict><key>CODEX_HOME</key><string>${xml(path.join(home, '.codex'))}</string><key>HOME</key><string>${xml(home)}</string></dict></dict></plist>\n` };
  if (platform === 'linux') return { file: path.join(home, '.config/systemd/user/codex-graph-worker.service'),
    text: `[Unit]\nDescription=Global Codex GraphToolCall worker\nStartLimitIntervalSec=0\n[Service]\nType=simple\nUMask=0077\nExecStart=${args.map(systemdQuote).join(' ')}\nEnvironment=CODEX_HOME=${systemdQuote(path.join(home, '.codex'))}\nRestart=always\nRestartSec=3\nTimeoutStopSec=70\nCPUQuota=${resources.processes * 100}%\nMemoryHigh=${resources.memoryHigh}G\nMemoryMax=${resources.memoryMax}G\nTasksMax=512\n[Install]\nWantedBy=default.target\n` };
  if (platform === 'win32') return { file: path.join(home, '.codex/hooks/graph-worker-task.xml'),
    text: `<?xml version="1.0" encoding="UTF-8"?>\n<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure></Settings><Actions><Exec><Command>${xml(node)}</Command><Arguments>${xml(`"${entry}" --processes ${resources.processes}`)}</Arguments><WorkingDirectory>${xml(home)}</WorkingDirectory></Exec></Actions></Task>\n` };
  throw new Error('Unsupported platform: ' + platform);
}
