#!/usr/bin/env python3
"""Prewarm the real global graph socket; no credentials or model API calls."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import socket
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--graph', required=True)
    parser.add_argument('--processes', type=int, choices=range(1, 21), default=4)
    args = parser.parse_args()
    graph = str(Path(args.graph).resolve())
    digest = hashlib.sha256(graph.encode()).hexdigest()[:24]
    sock = graph + '.worker.json' if os.name == 'nt' else f'/tmp/codex-graph-{os.getuid()}/{digest}.sock'
    until = time.monotonic() + 150

    def query(number):
        while True:
            try:
                endpoint = json.loads(Path(sock).read_text(encoding='utf-8')) if os.name == 'nt' else None
                if endpoint and endpoint.get('host') != '127.0.0.1':
                    raise RuntimeError('worker must use loopback')
                with socket.socket(socket.AF_INET if endpoint else socket.AF_UNIX) as connection:
                    connection.settimeout(max(1, until - time.monotonic()))
                    connection.connect((endpoint['host'], endpoint['port']) if endpoint else sock)
                    payload = {'query': f'prewarm {number} search files debugging performance skills',
                               'deadline': time.time() * 1000 + max(1, until - time.monotonic()) * 1000}
                    if endpoint:
                        payload['token'] = endpoint['token']
                    connection.sendall((json.dumps(payload) + '\n').encode())
                    line = connection.makefile('rb').readline()
                    if not line:
                        raise ConnectionResetError('worker retired during prewarm')
                    result = json.loads(line)
                    if not result.get('ok') or not result.get('results'):
                        raise RuntimeError(result.get('error', 'empty warmup result'))
                    if set(result.get('readyLanguages', [])) != {'en', 'zh'}:
                        raise RuntimeError('worker has not initialized both English and Chinese retrieval')
                    return result
            except (FileNotFoundError, ConnectionRefusedError, ConnectionResetError, BrokenPipeError):
                if time.monotonic() >= until:
                    raise
                time.sleep(.1)

    with ThreadPoolExecutor(max_workers=args.processes) as pool:
        rows = list(pool.map(query, range(args.processes)))
    print(json.dumps({'ready': True, 'socket': sock, 'requests': len(rows),
                      'queryProcesses': len({row['queryPid'] for row in rows}),
                      'readyLanguages': sorted(set.intersection(*(set(row['readyLanguages']) for row in rows))),
                      'prefilter': all(row.get('prefilter') for row in rows)}))


if __name__ == '__main__':
    main()
