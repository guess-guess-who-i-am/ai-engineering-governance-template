#!/usr/bin/env python3
"""Run with the installed GraphToolCall Python; real sockets and library, no shim."""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / 'codex-profile/mac/hooks/graph_skill_index.py'
spec = importlib.util.spec_from_file_location('indexer', ENTRY)
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gtc-test-', dir='/tmp')
        self.root = Path(self.temp.name)
        self.graph = self.root / 'graph.json'
        self.sock = self.root / 'worker.sock'
        self.processes = []
        self.make_graph('alpha')

    def tearDown(self):
        for p in self.processes:
            if p.poll() is None:
                p.terminate()
            p.wait(timeout=5)
        self.temp.cleanup()

    def make_graph(self, name):
        g = indexer.graph_from_records([], [{'tool_name': name, 'name': name,
             'server': 'fixture', 'description': 'search alpha documents'}])
        tmp = self.graph.with_suffix('.new')
        g.save(tmp)
        tmp.replace(self.graph)

    def start(self, idle=0):
        p = subprocess.Popen([sys.executable, str(ENTRY), 'serve', '--graph', str(self.graph),
                              '--socket', str(self.sock), '--idle-timeout', str(idle)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.processes.append(p)
        return p

    def request(self, payload=None):
        until = time.monotonic() + 10
        while True:
            try:
                with socket.socket(socket.AF_UNIX) as s:
                    s.settimeout(10)
                    s.connect(str(self.sock))
                    s.sendall((json.dumps(payload or {'query': 'search alpha documents'})+'\n').encode())
                    return json.loads(s.makefile('rb').readline())
            except (FileNotFoundError, ConnectionRefusedError):
                if time.monotonic() > until:
                    raise
                time.sleep(.025)

    def test_twenty_cold_starters_share_one_graph_and_pid(self):
        for _ in range(20):
            self.start()
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(lambda _: self.request(), range(20)))
        self.assertTrue(all(r['ok'] and r['loads'] == 1 and r['prefilter'] for r in results))
        self.assertEqual(len({r['pid'] for r in results}), 1)
        self.assertEqual(self.sock.stat().st_mode & 0o777, 0o600)
        time.sleep(.2)
        self.assertEqual(sum(p.poll() is None for p in self.processes), 1)

    def test_reload_failure_recovery_and_expired_request(self):
        self.start()
        first = self.request()
        self.assertEqual(first['results'][0]['name'], 'alpha')
        self.make_graph('beta')
        second = self.request()
        self.assertEqual((second['pid'], second['loads']), (first['pid'], 2))
        self.assertEqual(second['results'][0]['name'], 'beta')
        self.graph.write_text('{bad')
        self.assertFalse(self.request()['ok'])
        self.make_graph('gamma')
        self.assertEqual(self.request()['results'][0]['name'], 'gamma')
        self.assertFalse(self.request({'query': 'alpha', 'deadline': 0})['ok'])
        self.assertFalse(self.request({'query': 'alpha', 'top_k': 'bad'})['ok'])
        self.assertTrue(self.request()['ok'])

    def test_crash_and_idle_restart(self):
        p = self.start()
        first = self.request()
        p.kill(); p.wait(timeout=5)
        restarted = self.start(idle=.2)
        second = self.request()
        self.assertNotEqual(first['pid'], second['pid'])
        restarted.wait(timeout=5)
        self.assertFalse(self.sock.exists())
        self.start()
        self.assertTrue(self.request()['ok'])

    def test_real_prefilter_pool(self):
        records = [{'name': f'tool-{i}', 'tool_name': f'tool_{i}',
                    'description': f'search alpha documents {i}', 'path': '',
                    'tags': [], 'categories': [f'group-{i // 100}']} for i in range(600)]
        graph = indexer.graph_from_records(records)
        graph.save(self.graph)
        worker = indexer._GraphWorker(self.graph)
        loaded = worker._load_if_stale()
        engine = loaded._get_retrieval_engine()
        self.assertTrue(engine._prefilter_enabled)
        pools = []
        original = engine._maybe_prefilter
        def tracked(*args, **kwargs):
            result = original(*args, **kwargs)
            pools.append(result)
            return result
        engine._maybe_prefilter = tracked
        self.assertTrue(worker.query({'query': 'group-1 search alpha'}))
        self.assertIsNotNone(pools[0])
        self.assertLessEqual(len(pools[0]), 500)

    def test_background_refresh_is_single_instance(self):
        script = self.root / 'refresh-fixture.py'
        marker = self.root / 'refresh-calls.txt'
        script.write_text('import os,time\nfrom pathlib import Path\n'
                          'assert os.environ["CODEX_SKILL_REGISTRY_FOREGROUND"] == "1"\n'
                          f'with Path({str(marker)!r}).open("a") as f: f.write("refresh\\n")\n'
                          'time.sleep(2)\n')
        for _ in range(20):
            self.processes.append(subprocess.Popen([sys.executable, str(ENTRY), 'refresh',
                '--lock', str(self.root / 'refresh.lock'), '--node', sys.executable,
                '--script', str(script)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        for p in self.processes:
            self.assertEqual(p.wait(timeout=5), 0)
        self.assertEqual(marker.read_text(), 'refresh\n')


if __name__ == '__main__':
    unittest.main(verbosity=2)
