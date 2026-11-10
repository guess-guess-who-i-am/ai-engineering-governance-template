#!/usr/bin/env python3
"""Burst/staggered load against real global sockets or independent Hook processes."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import tempfile
import time

PROMPTS = [
    'resolve a git merge conflict safely and verify both branches',
    'debug Python performance regression with function level timings',
    'create a PowerPoint presentation from research evidence',
    'build a responsive accessible interface with keyboard navigation',
    '请实际完善任务树身体活动、睡眠习惯与时间安排节点；保留ROOT和其他分支事实，先读取焦点和现有输入，只有必要时读取协议。完成后检查所有目标、输入输出和验证证据，不编造用户个人情况。',
    '检查子Agent提交的实现是否完成：读取实际diff和测试结果，逐项对照用户原始目标，找到首次偏离并进行根因分析。缺少证据时不能宣称完成，保留其他Agent的并发修改。',
    '分析并发任务的超时和排队原因，测量每个函数，查明worker加载、候选预过滤、embedding和图排序各自耗时。',
    '更新全局Skills和MCP的索引，验证新增、修改和删除的工具都能被正确检索，保持各个工作区共用全局配置。',
    '为缓存过期、CSV解析、端口边界编写隐藏测试，运行真实失败和成功用例，检查无关文件是否保留。',
    '查找CCF-A论文及高star开源仓库，比较并发服务的批处理、常驻缓存、请求合并与截止时间调度方法，给出可验证依据。',
]


def run(args):
    codex = Path(args.codex_home).expanduser()
    graph = Path(json.loads((codex / 'skill-registry/skills-index.json').read_text())['externalGraphPath']).resolve()
    digest = hashlib.sha256(str(graph).encode()).hexdigest()[:24]
    sock = str(Path('/tmp') / f'codex-graph-{os.getuid()}' / f'{digest}.sock')
    process = None
    temporary = None
    if args.worker_entry:
        temporary = tempfile.TemporaryDirectory(prefix='graph-load-', dir='/tmp')
        sock = str(Path(temporary.name) / 'worker.sock')
        import sys
        process = subprocess.Popen([sys.executable, args.worker_entry, 'serve', '--graph', str(graph), '--socket', sock],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        until = time.monotonic() + 10
        while not Path(sock).exists() and time.monotonic() < until:
            time.sleep(.05)
    # Staggered arrivals: first second 10, next 5, next 20, then 25/40.
    groups = [10, 5, 20, 25, 40]
    arrivals = [second for second, size in enumerate(groups) for _ in range(size)]
    if args.warm:
        if not Path(sock).exists() and not args.worker_entry:
            bootstrap = subprocess.run([args.node, str(codex / 'hooks/hook-dispatch.mjs')],
                input=json.dumps({'hook_event_name': 'UserPromptSubmit', 'prompt': PROMPTS[0], 'cwd': '/tmp'}),
                capture_output=True, text=True, timeout=65, env={**os.environ, 'CODEX_HOME': str(codex)})
            if bootstrap.returncode or 'routing failed' in bootstrap.stderr:
                raise RuntimeError(bootstrap.stderr)
        def warm(number):
            with socket.socket(socket.AF_UNIX) as connection:
                connection.settimeout(55)
                connection.connect(sock)
                connection.sendall((json.dumps({'query': PROMPTS[number], 'top_k': 8,
                    'deadline': time.time() * 1000 + 55000}) + '\n').encode())
                response = json.loads(connection.makefile('rb').readline())
                if not response.get('ok'):
                    raise RuntimeError(response)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(warm, range(4)))
    start = time.monotonic()

    def request(number):
        delay = arrivals[number % 100] if args.pattern == 'stagger' else 0
        remaining = start + delay - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)
        query = PROMPTS[number % len(PROMPTS)]
        if args.long:
            query += (' 验证要求：请保留原始目标与所有约束，沿真实输入、处理、输出和实际消费者检查；'
                      '读取真实文件，运行必要测试，核验每个节点的完成状态，保留并发Agent的修改。') * 6
        if not args.repeated:
            query += f' 当前独立任务编号{args.seed}-{number}，输入文件task-{args.seed}-{number}.md。'
        begun = time.monotonic()
        try:
            if args.transport == 'hook':
                p = subprocess.run([args.node, str(codex / 'hooks/hook-dispatch.mjs')],
                    input=json.dumps({'hook_event_name': 'UserPromptSubmit', 'prompt': query,
                                      'session_id': f'load-{os.getpid()}-{number}', 'turn_id': '1', 'cwd': '/tmp'}),
                    capture_output=True, text=True, timeout=args.timeout,
                    env={**os.environ, 'CODEX_HOME': str(codex)})
                context = json.loads(p.stdout).get('hookSpecificOutput', {}).get('additionalContext', '')
                ok = p.returncode == 0 and 'CODEX_SKILL_ROUTER_V2' in context and 'routing failed' not in p.stderr
                response = {'ok': ok, 'error': p.stderr if not ok else '', 'contextBytes': len(context.encode())}
            else:
                with socket.socket(socket.AF_UNIX) as connection:
                    connection.settimeout(args.timeout)
                    connection.connect(sock)
                    connection.sendall((json.dumps({'query': query, 'top_k': 8,
                        'deadline': time.time() * 1000 + args.timeout * 1000}) + '\n').encode())
                    line = connection.makefile('rb').readline()
                    response = json.loads(line)
                ok = response.get('ok') and bool(response.get('results'))
                response = {k: response[k] for k in ('pid', 'queryPid', 'loads', 'error', 'metrics') if k in response} | {'ok': bool(ok)}
        except Exception as error:
            response = {'ok': False, 'error': str(error)}
        return {'number': number, 'arrivalSeconds': delay, 'seconds': round(time.monotonic() - begun, 4), **response}

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.count) as pool:
        rows = list(pool.map(request, range(args.count)))
    times = sorted(row['seconds'] for row in rows)
    report = {'schema': 'graph-load/v1', 'count': args.count, 'pattern': args.pattern,
        'transport': args.transport, 'seed': args.seed, 'warm': args.warm, 'longInputs': args.long, 'uniqueQueries': not args.repeated,
        'success': sum(row['ok'] for row in rows), 'wallSeconds': round(time.monotonic() - start, 4),
        'p50Seconds': statistics.median(times), 'p95Seconds': times[int(.95 * (len(times) - 1))],
        'maxSeconds': max(times), 'rows': rows}
    pids = {row.get('queryPid') for row in rows if row.get('queryPid')}
    report['queryProcesses'] = len(pids)
    if pids:
        rss = subprocess.check_output(['ps', '-o', 'rss=', '-p', ','.join(str(pid) for pid in pids)], text=True)
        report['poolResidentMiB'] = round(sum(int(value) for value in rss.split()) / 1024, 1)
    if args.output:
        destination = Path(args.output)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'rows'}, ensure_ascii=False))
    if process:
        process.terminate()
        process.wait(timeout=10)
        temporary.cleanup()
    return 0 if report['success'] == args.count else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--codex-home', default=str(Path.home() / '.codex'))
    parser.add_argument('--count', type=int, default=100)
    parser.add_argument('--pattern', choices=['burst', 'stagger'], default='burst')
    parser.add_argument('--transport', choices=['socket', 'hook'], default='socket')
    parser.add_argument('--node', default='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node')
    parser.add_argument('--timeout', type=float, default=55)
    parser.add_argument('--long', action='store_true')
    parser.add_argument('--repeated', action='store_true')
    parser.add_argument('--output')
    parser.add_argument('--worker-entry', help='launch an isolated test worker against the existing graph')
    parser.add_argument('--warm', action='store_true')
    parser.add_argument('--seed', default='default', help='change query IDs to force a fresh uncached workload')
    args = parser.parse_args()
    if args.count < 1 or args.count > 1000:
        parser.error('--count must be between 1 and 1000')
    raise SystemExit(run(args))
