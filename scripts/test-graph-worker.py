#!/usr/bin/env python3
"""Run with the installed GraphToolCall Python; real sockets and library, no shim."""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

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

    def start(self, idle=0, processes=4):
        p = subprocess.Popen([sys.executable, str(ENTRY), 'serve', '--graph', str(self.graph),
                              '--socket', str(self.sock), '--idle-timeout', str(idle), '--processes', str(processes)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.processes.append(p)
        return p

    def test_configurable_pool_bounds(self):
        invalid = subprocess.run([sys.executable, str(ENTRY), 'serve', '--graph', str(self.graph),
                                  '--socket', str(self.sock), '--processes', '21'], capture_output=True)
        self.assertNotEqual(invalid.returncode, 0)
        self.start(processes=2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            rows = list(pool.map(lambda n: self.request({'query': f'alpha search independent {n}'}), range(20)))
        self.assertTrue(all(row['ok'] for row in rows))
        self.assertEqual(len({row['queryPid'] for row in rows}), 2)
        self.assertTrue(all(row['readyLanguages'] == ['en', 'zh'] for row in rows))

    def test_incomplete_catalog_never_replaces_last_good_graph(self):
        catalog = self.root / 'catalog.json'
        catalog.write_text(json.dumps({'skills': [{'name': 'missing', 'dir': 'not-transferred'}]}))
        before = self.graph.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Catalog incomplete'):
            indexer.build(SimpleNamespace(root=str(self.root), catalog=str(catalog), output=str(self.graph), require_complete=True))
        self.assertEqual(self.graph.read_bytes(), before)

    def test_existing_non_strict_catalog_contract_is_preserved(self):
        catalog = self.root / 'catalog.json'
        catalog.write_text(json.dumps({'skills': [{'name': 'missing', 'dir': 'not-transferred'}]}))
        # Existing macOS callers explicitly accept reported missing entries;
        # completeness enforcement belongs to the new Linux deployment policy.
        with patch.object(indexer, 'graph_from_records', side_effect=RuntimeError('build reached')):
            with self.assertRaisesRegex(RuntimeError, 'build reached'):
                indexer.build(SimpleNamespace(root=str(self.root), catalog=str(catalog), output=str(self.graph),
                                              owned_root='', mcp_catalog=''))

    def test_linux_lowercase_skill_and_escape_protection(self):
        folder = self.root / 'lowercase'
        folder.mkdir()
        target = folder / 'skill.md'
        target.write_text('source skill')
        self.assertEqual(indexer.safe_path(self.root, 'lowercase'), target.resolve())
        self.assertIsNone(indexer.safe_path(self.root, '../outside'))
        outside = self.root.parent / f'outside-{os.getpid()}.md'
        try:
            outside.write_text('not a skill in the library')
            target.unlink()
            target.symlink_to(outside)
            self.assertIsNone(indexer.safe_path(self.root, 'lowercase'))
        finally:
            outside.unlink(missing_ok=True)

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

    def test_hundred_requests_burst_and_stagger(self):
        self.start()
        self.assertTrue(self.request()['ok'])
        for stagger in (False, True):
            def invoke(number):
                if stagger:
                    time.sleep((number // 20) * .05)
                return self.request({'query': f'search alpha documents independent {number}'})
            with concurrent.futures.ThreadPoolExecutor(max_workers=100) as pool:
                results = list(pool.map(invoke, range(100)))
            self.assertTrue(all(result['ok'] and result['results'] for result in results), results)
            self.assertEqual(len({result['pid'] for result in results}), 1)
            self.assertTrue(all(result['queryPid'] != result['pid'] for result in results))

    def test_provider_cache_covers_rerank_and_is_bounded(self):
        class Provider:
            calls = []
            def encode_batch(self, texts):
                self.calls.append(texts)
                return [[len(text)] for text in texts]
        provider = Provider()
        cached = indexer._CachedEmbeddingProvider(provider)
        self.assertEqual(cached.encode_batch(['query', 'description']), [[5], [11]])
        self.assertEqual(cached.encode_batch(['query', 'description', 'second']), [[5], [11], [6]])
        self.assertEqual(provider.calls, [['query', 'description'], ['second']])
        cached.encode_batch([str(number) for number in range(4100)])
        self.assertEqual(len(cached._vectors), 4096)

    def test_precomputed_descriptions_never_encode_or_evict(self):
        class Provider:
            calls = []
            def encode_batch(self, texts):
                self.calls.append(texts)
                return [[len(text)] for text in texts]
        provider = Provider()
        cached = indexer._CachedEmbeddingProvider(provider, {'static description': [123]})
        self.assertEqual(cached.encode_batch(['new query', 'static description']), [[9], [123]])
        self.assertEqual(provider.calls, [['new query']])
        cached.encode_batch([str(n) for n in range(4100)])
        result = cached.encode_batch(['static description'])
        result[0][0] = -1
        self.assertEqual(cached.encode('static description'), [123])
        self.assertNotIn('static description', cached._vectors)

    def test_pool_recovers_after_query_process_crash(self):
        self.start()
        first = self.request({'query': 'alpha search'})
        self.assertTrue(first['ok'])
        os.kill(first['queryPid'], signal.SIGKILL)
        time.sleep(.2)
        recovered = self.request({'query': 'alpha independent after crash'})
        self.assertTrue(recovered['ok'], recovered)
        self.assertEqual(first['pid'], recovered['pid'])
        self.assertNotEqual(first['queryPid'], recovered['queryPid'])

    def test_independent_requests_overlap_in_one_worker(self):
        worker = indexer._GraphWorker(self.graph)
        active = 0
        peak = 0
        mutex = threading.Lock()

        def slow_query(_payload):
            nonlocal active, peak
            with mutex:
                active += 1
                peak = max(peak, active)
            time.sleep(.15)
            with mutex:
                active -= 1
            return []

        worker.query = slow_query
        server = indexer._WorkerServer(str(self.sock), worker)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
                replies = list(pool.map(lambda _: self.request(), range(20)))
            self.assertTrue(all(reply['ok'] for reply in replies), replies)
            self.assertGreaterEqual(peak, 2, 'one shared worker must process independent queries concurrently')
            self.assertLessEqual(peak, server.max_concurrent_requests, 'worker concurrency must stay bounded')
        finally:
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=5)

    def test_reload_failure_recovery_and_expired_request(self):
        self.start()
        first = self.request()
        self.assertEqual(first['results'][0]['name'], 'alpha')
        self.make_graph('beta')
        second = self.request()
        self.assertEqual((second['pid'], second['loads']), (first['pid'], 2))
        self.assertEqual(second['results'][0]['name'], 'beta')
        self.assertEqual(second['readyLanguages'], ['en', 'zh'])
        self.graph.write_text('{bad')
        self.assertFalse(self.request()['ok'])
        self.make_graph('gamma')
        self.assertEqual(self.request()['results'][0]['name'], 'gamma')
        self.assertFalse(self.request({'query': 'alpha', 'deadline': 0})['ok'])
        self.assertFalse(self.request({'query': 'alpha', 'top_k': 'bad'})['ok'])
        self.assertTrue(self.request()['ok'])

    def test_keyword_index_preserves_library_scores(self):
        worker = indexer._GraphWorker(self.graph)
        engine = worker._load_if_stale()._get_retrieval_engine()
        from graph_tool_call.retrieval.engine import RetrievalEngine
        for query in ('search alpha documents', '中文没有关键词', 'alpha alpha search', 'documents unknown'):
            self.assertEqual(engine._keyword_match(query), RetrievalEngine._keyword_match(engine, query))

    def test_repeated_queries_coalesce_and_reload_invalidates_cache(self):
        worker = indexer._GraphWorker(self.graph)
        worker.query({'query': 'warm'})
        graph = worker._english_graph
        original = graph.retrieve_with_scores
        calls = []
        def slow(query, **kwargs):
            calls.append(query)
            time.sleep(.15)
            return original(query, **kwargs)
        with patch.object(graph, 'retrieve_with_scores', slow):
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
                replies = list(pool.map(lambda _: worker.query({'query': 'alpha search'}), range(20)))
            self.assertEqual(len(calls), 1)
            self.assertTrue(all(result == replies[0] for result in replies))
            replies[0][0]['name'] = 'caller-mutated'
            self.assertNotEqual(worker.query({'query': 'alpha search'})[0]['name'], 'caller-mutated')
        self.make_graph('beta')
        self.assertEqual(worker.query({'query': 'alpha search'})[0]['name'], 'beta')
        self.assertEqual(worker.loads, 2)

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
        engine = worker._english_graph._get_retrieval_engine()
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
                          'assert os.environ["HF_HUB_OFFLINE"] == "1"\n'
                          'assert 1 <= int(os.environ["OMP_NUM_THREADS"]) <= 20\n'
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
