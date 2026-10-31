"""Real GraphToolCall, spawn process pool and authenticated Windows transport.

Also runs on POSIX so Windows-only code is never left completely unexercised.
"""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

indexer = Path(__file__).resolve().parents[1] / 'codex-profile/mac/hooks/graph_skill_index.py'
spec = importlib.util.spec_from_file_location('portable_indexer', indexer)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    with tempfile.TemporaryDirectory(prefix='portable-graph-') as temporary:
        root = Path(temporary)
        graph_path = root / 'graph.json'
        graph = module.graph_from_records([{'name': 'root-cause', 'tool_name': 'skill_root_cause',
            'description': 'debugging root cause investigation', 'path': str(root / 'SKILL.md'), 'categories': [], 'tags': []}])
        graph.save(graph_path)
        endpoint_file = root / 'endpoint.json'
        process = subprocess.Popen([sys.executable, str(indexer), 'serve', '--graph', str(graph_path),
            '--socket', str(endpoint_file), '--tcp', '--processes', '2', '--idle-timeout', '3'],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            until = time.monotonic() + 60
            while not endpoint_file.exists():
                if process.poll() is not None:
                    raise AssertionError(process.stderr.read().decode())
                if time.monotonic() > until:
                    raise TimeoutError('endpoint not created')
                time.sleep(.05)
            endpoint = json.loads(endpoint_file.read_text())
            assert endpoint['host'] == '127.0.0.1'

            def request(number, valid=True):
                with socket.create_connection((endpoint['host'], endpoint['port']), timeout=55) as connection:
                    payload = {'query': f'debugging root cause {number}', 'deadline': time.time() * 1000 + 50000,
                               'token': endpoint['token'] if valid else 'wrong-key'}
                    connection.sendall((json.dumps(payload) + '\n').encode())
                    return json.loads(connection.makefile('rb').readline())

            assert request(0, False) == {'ok': False, 'error': 'worker authentication failed'}
            with ThreadPoolExecutor(max_workers=8) as pool:
                rows = list(pool.map(request, range(8)))
            assert all(row['ok'] and row['results'] and row['prefilter'] for row in rows), rows
            assert len({row['queryPid'] for row in rows}) == 2, 'two real spawn processes required'
            # Competing startup must not replace a live endpoint or create another pool.
            contender = subprocess.run([sys.executable, str(indexer), 'serve', '--graph', str(graph_path),
                '--socket', str(endpoint_file), '--tcp', '--processes', '2'], capture_output=True, timeout=15)
            assert contender.returncode == 0, contender.stderr.decode()
            assert json.loads(endpoint_file.read_text()) == endpoint
            print('PASS real portable worker: loopback-only, unauthorized request rejected, 8/8 retrievals, 2 spawn PIDs, prefilter, OS single-instance lock.')
        finally:
            # Only the isolated fixture worker is stopped; production is untouched.
            if os.name == 'nt':
                process.wait(timeout=15)
            else:
                process.terminate()
                process.wait(timeout=15)
            process.stderr.close()


if __name__ == '__main__':
    main()
