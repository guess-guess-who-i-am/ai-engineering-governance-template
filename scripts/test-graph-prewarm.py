#!/usr/bin/env python3
"""A retiring worker closes the first connection; the replacement must warm."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading

with tempfile.TemporaryDirectory(prefix='prewarm-restart-') as directory:
    graph = str(Path(directory, 'graph.json').resolve())
    digest = hashlib.sha256(graph.encode()).hexdigest()[:24]
    endpoint = Path(f'/tmp/codex-graph-{os.getuid()}/{digest}.sock')
    endpoint.parent.mkdir(parents=True, exist_ok=True)
    server = socket.socket(socket.AF_UNIX)
    server.bind(str(endpoint)); server.listen(4); server.settimeout(8)
    requests = []
    def serve():
        try:
            for number in range(3):
                connection, _ = server.accept()
                with connection:
                    requests.append(json.loads(connection.makefile('rb').readline()))
                    if number:
                        connection.sendall((json.dumps({'ok':True,'results':[{'name':'ready'}], 'queryPid':os.getpid(),'prefilter':True,'readyLanguages':['en','zh'] if number == 1 else ['en']})+'\n').encode())
        except TimeoutError:
            pass
    thread = threading.Thread(target=serve, daemon=True); thread.start()
    try:
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('warm-global-graph.py')),
            '--graph', graph, '--processes', '1'], capture_output=True, text=True, timeout=6)
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout)['ready'] and len(requests) == 2
        incomplete = subprocess.run([sys.executable, str(Path(__file__).with_name('warm-global-graph.py')),
            '--graph', graph, '--processes', '1'], capture_output=True, text=True, timeout=6)
        assert incomplete.returncode != 0 and 'both English and Chinese' in incomplete.stderr
        print('PASS: prewarm retries retiring-worker EOF and rejects English-only initialization')
    finally:
        server.close(); endpoint.unlink(missing_ok=True)
