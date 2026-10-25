#!/usr/bin/env python3
"""Verify the current global bilingual worker and the retired Serena consumer."""
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import sys
import time
import tomllib

ROOT = Path(__file__).resolve().parents[1]
HOME = Path.home()
CODEX = HOME / '.codex'
GRAPH = CODEX / 'skill-registry/skills.graph.json'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', type=Path, default=ROOT / f'.reports/retrieval-prewarm-retirement-{time.time_ns()}.json')
args = parser.parse_args()
sock = f'/tmp/codex-graph-{os.getuid()}/{hashlib.sha256(str(GRAPH).encode()).hexdigest()[:24]}.sock'
manifest = json.loads((CODEX / 'skill-registry/external-skills-manifest.json').read_text())
assert manifest['ownedSkillCount'] == 22, manifest['ownedSkillCount']
mcp = json.loads((CODEX / 'skill-registry/mcp-tools.json').read_text())['tools']
assert mcp and all(tool['server'] != 'serena' for tool in mcp)
assert not (HOME / '.agents/skills/navigate-code-with-serena/SKILL.md').exists()
config = tomllib.loads((CODEX / 'config.toml').read_text())
assert 'serena' not in config.get('mcp_servers', {})
for relative in ['tools/serena-mcp.mjs', 'tools/serena-runtime.json', 'tools/serena-navigation']:
    assert not (CODEX / relative).exists(), relative
registry = json.loads((CODEX / 'skill-registry/skills-index.json').read_text())
assert all(row['name'] != 'navigate-code-with-serena' for row in registry['skills'])

def request(query):
    begun = time.perf_counter()
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(55)
        connection.connect(sock)
        connection.sendall((json.dumps({'query': query, 'deadline': time.time() * 1000 + 55000}) + '\n').encode())
        result = json.loads(connection.makefile('rb').readline())
    assert result['ok'] and result['results'], result.get('error')
    assert result['readyLanguages'] == ['en', 'zh'] and result['loads'] >= 1, result
    assert all(result['staticDescriptions'][lang] > 10000 for lang in ['en', 'zh']), result['staticDescriptions']
    assert all(row.get('mcp_server') != 'serena' and row['name'] != 'navigate-code-with-serena' for row in result['results'])
    return {'queryPid': result['queryPid'], 'loads': result['loads'], 'languages': result['readyLanguages'],
            'staticDescriptions': result['staticDescriptions'],
            'ms': round((time.perf_counter() - begun) * 1000, 3), 'names': [row['name'] for row in result['results']]}

# New queries in both languages; two rounds must reuse the same loaded graph.
rows = []
for round_number in range(2):
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows.extend(pool.map(request, [
            (f'分析测试失败，沿信息流定位根因并逐个验证假设；独立验收{os.getpid()}-{round_number}-{n}' if n % 2 else
             f'Investigate a software test failure by tracing information flow; independent probe {os.getpid()}-{round_number}-{n}')
            for n in range(8)]))
assert len({row['queryPid'] for row in rows}) == 4
loads_by_process = {}
for row in rows:
    loads_by_process.setdefault(row['queryPid'], set()).add(row['loads'])
assert all(len(loads) == 1 for loads in loads_by_process.values()), loads_by_process

node = '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'
hook_rows = []
for number, cwd in enumerate([str(ROOT), '/tmp']):
    begun = time.perf_counter()
    result = subprocess.run([node, str(CODEX / 'hooks/hook-dispatch.mjs')], input=json.dumps({
        'hook_event_name': 'UserPromptSubmit', 'cwd': cwd, 'session_id': f'retirement-{os.getpid()}-{number}',
        'turn_id': '1', 'prompt': f'分析软件测试失败，沿信息流找首次偏离，先验证根因假设再改代码。独立验收{os.getpid()}-{number}'
    }), capture_output=True, text=True, timeout=65)
    assert result.returncode == 0 and 'routing failed' not in result.stderr.lower()
    context = json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
    assert 'CODEX_SKILL_ROUTER_V2' in context and 'systematic-debugging' in context
    assert 'navigate-code-with-serena' not in context and 'mcp_serena_' not in context
    hook_rows.append({'otherWorkspace': cwd == '/tmp', 'correct': True, 'ms': round((time.perf_counter() - begun) * 1000, 3)})

report = {'schema': 'bilingual-prewarm-serena-retirement/2',
          'graphSha256': hashlib.sha256(GRAPH.read_bytes()).hexdigest(),
          'workerSha256': hashlib.sha256((CODEX / 'hooks/graph_skill_index.py').read_bytes()).hexdigest(),
          'ownedSkills': manifest['ownedSkillCount'], 'externalSkills': manifest['externalSkillCount'],
          'mcpTools': len(mcp), 'serenaRemoved': True, 'queryProcesses': len({row['queryPid'] for row in rows}),
          'readyLanguages': ['en', 'zh'], 'queries': len(rows), 'medianMs': statistics.median(row['ms'] for row in rows),
          'loadsStable': True, 'loadsByProcess': {pid: list(loads)[0] for pid, loads in loads_by_process.items()},
          'hookRows': hook_rows, 'rows': rows,
          'limitations': ['16 mixed-language probes after warmup, not a task-accuracy benchmark',
                          'startup work is moved ahead of requests, not eliminated',
                          'no controlled before/after total-token or speedup claim']}
args.report.parent.mkdir(parents=True, exist_ok=True)
with args.report.open('x', encoding='utf-8') as output:
    output.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'rows'}, ensure_ascii=False))
