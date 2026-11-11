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

    def test_hundred_requests_burst_and_stagger(self):
        self.start()
        self.assertTrue(self.request()['ok'])
        for stagger in (False, True):
            def invoke(number):
                if stagger:
                    time.sleep((number // 20) * .05)
                return self.request({'query': f'search alpha documents independent {number}'})
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
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
        self.assertEqual((second['pid'], second['generation']), (first['pid'], 2))
        self.assertEqual(second['loads'], 1)
        self.assertEqual(second['results'][0]['name'], 'beta')
        self.graph.write_text('{bad')
        self.assertFalse(self.request()['ok'])
        self.make_graph('gamma')
        self.assertEqual(self.request()['results'][0]['name'], 'gamma')
        self.assertFalse(self.request({'query': 'alpha', 'deadline': 0})['ok'])
        self.assertFalse(self.request({'query': 'alpha', 'top_k': 'bad'})['ok'])
        self.assertTrue(self.request()['ok'])

    def test_publish_prewarms_new_generation_before_visible_switch(self):
        self.start()
        first = self.request()
        from graph_tool_call import ToolGraph
        candidate = self.root/'candidate.json'
        graph = indexer.graph_from_records([], [{'tool_name':'beta','name':'beta',
            'server':'fixture','description':'search alpha documents'}])
        graph.save(candidate)
        original = self.graph.read_bytes()
        # Invalid candidates fail without publishing or poisoning active queries.
        bad = self.root/'bad.json'
        bad.write_text('{bad')
        failed = self.request({'operation':'publish','candidate':str(bad)})
        self.assertFalse(failed['ok'], failed)
        self.assertEqual(self.graph.read_bytes(), original)
        self.assertEqual(self.request()['results'][0]['name'], 'alpha')
        invalid_vectors = self.root/'invalid-vectors.json'
        graph.save(invalid_vectors, metadata={'chinese_embedding':{
            'file':'broken.npz', 'representation':'wrong'}})
        (self.root/'broken.npz').write_bytes(b'broken')
        self.assertFalse(self.request({'operation':'publish','candidate':str(invalid_vectors)})['ok'])
        self.assertEqual(self.graph.read_bytes(), original)
        self.assertEqual(self.request()['results'][0]['name'], 'alpha')
        published = self.request({'operation':'publish','candidate':str(candidate)})
        self.assertTrue(published['ok'], published)
        self.assertTrue(published.get('prewarmed'), published)
        self.assertEqual(self.graph.read_bytes(), candidate.read_bytes())
        second = self.request()
        self.assertEqual(second['results'][0]['name'], 'beta')
        self.assertEqual(second['pid'], first['pid'])
        self.assertNotEqual(second['queryPid'], first['queryPid'])

    def test_build_publishes_through_ready_service(self):
        import hashlib
        self.sock = Path('/tmp')/f'codex-graph-{os.getuid()}'/(hashlib.sha256(str(self.graph.resolve()).encode()).hexdigest()[:24]+'.sock')
        self.start()
        first = self.request()
        skills = self.root/'skills'
        (skills/'beta').mkdir(parents=True)
        (skills/'beta/SKILL.md').write_text('---\nname: beta\n---\nSearch alpha documents')
        catalog = self.root/'catalog.json'
        catalog.write_text(json.dumps({'skills':[{'name':'beta','dir':'beta','description':'search alpha documents'}]}))
        result = subprocess.run([sys.executable,str(ENTRY),'build','--root',str(skills),
            '--catalog',str(catalog),'--output',str(self.graph)],capture_output=True,text=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr)
        second = self.request()
        self.assertEqual(second['pid'],first['pid'])
        self.assertEqual(second['generation'],2)
        self.assertEqual(second['results'][0]['name'],'beta')
        candidate = self.root/'cli-candidate.json'
        candidate.write_bytes(self.graph.read_bytes())
        published = subprocess.run([sys.executable,str(ENTRY),'publish','--candidate',str(candidate),
            '--graph',str(self.graph)],capture_output=True,text=True,timeout=20)
        self.assertEqual(published.returncode,0,published.stderr)
        self.assertFalse(candidate.exists())
        self.assertEqual(self.request()['generation'],3)

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

    def test_last_waiter_timeout_abandons_running_query_without_caching(self):
        worker = indexer._GraphWorker(self.graph)
        worker.query({'query': 'warm'})
        graph = worker._english_graph
        original = graph.retrieve_with_scores
        started = threading.Event()
        release = threading.Event()
        calls = []

        def blocked(query, **kwargs):
            calls.append(query)
            started.set()
            release.wait(timeout=5)
            return original(query, **kwargs)

        with patch.object(graph, 'retrieve_with_scores', blocked):
            def invoke():
                return worker.query({'query': 'abandon me',
                                     'deadline': time.time() * 1000 + 40})

            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                futures = [pool.submit(invoke) for _ in range(8)]
                self.assertTrue(started.wait(timeout=2))
                for future in futures:
                    with self.assertRaises(TimeoutError):
                        future.result(timeout=2)
            release.set()
            until = time.monotonic() + 3
            while worker._pending and time.monotonic() < until:
                time.sleep(.01)
            self.assertFalse(worker._pending)
            self.assertEqual(worker.abandoned_running, 1)
            self.assertNotIn(('abandon me', 8, None), worker._results)
            worker.query({'query': 'abandon me'})
            self.assertEqual(calls.count('abandon me'), 2)

    def test_retry_does_not_join_abandoned_running_computation(self):
        worker = indexer._GraphWorker(self.graph)
        worker.query({'query':'warm'})
        graph = worker._english_graph
        original = graph.retrieve_with_scores
        started, release = threading.Event(), threading.Event()
        calls = []
        def first_blocks(query, **kwargs):
            calls.append(query)
            if len(calls) == 1:
                started.set()
                release.wait(timeout=5)
            return original(query, **kwargs)
        try:
            with patch.object(graph, 'retrieve_with_scores', first_blocks):
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as callers:
                    timed = callers.submit(worker.query, {'query':'alpha retry same query', 'deadline':time.time()*1000+50})
                    self.assertTrue(started.wait(timeout=2))
                    with self.assertRaises(TimeoutError): timed.result(timeout=2)
                    retried = worker.query({'query':'alpha retry same query', 'deadline':time.time()*1000+1500})
                    self.assertTrue(retried)
                    self.assertEqual(len(calls),2)
                    release.set()
                until = time.monotonic()+2
                while worker._inflight and time.monotonic()<until: time.sleep(.005)
                self.assertEqual(worker._inflight,0)
                self.assertFalse(worker._pending)
                self.assertEqual(worker.query({'query':'alpha retry same query'}),retried)
        finally:
            release.set()
            worker.close()

    def test_process_callers_keep_independent_deadlines(self):
        class Pool:
            def __init__(self):
                self.calls = []
                self.future = concurrent.futures.Future()
                self.future.set_running_or_notify_cancel()
            def submit(self, fn, payload):
                self.calls.append(payload)
                return self.future
        pool = Pool()
        with patch.object(indexer._ProcessGraphWorker, '_new_pool', return_value=pool):
            worker = indexer._ProcessGraphWorker(self.graph)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as callers:
            short = callers.submit(worker.query, {'query':'shared deadline', 'deadline':time.time()*1000+80})
            until = time.monotonic()+2
            while not pool.calls and time.monotonic()<until:
                time.sleep(.002)
            long = callers.submit(worker.query, {'query':'shared deadline', 'deadline':time.time()*1000+2000})
            with self.assertRaises(TimeoutError):
                short.result(timeout=2)
            pool.future.set_result(([{'name':'shared-success'}], {'queryPid':123}))
            self.assertEqual(long.result(timeout=2)[0]['name'], 'shared-success')
        self.assertEqual(len(pool.calls),1)
        self.assertGreater(pool.calls[0]['execution_deadline'], time.time()*1000+50000)
        self.assertEqual(worker.coalesced,1)
        self.assertEqual(next(iter(worker._results.values()))[0][0]['name'],'shared-success')

    def test_process_last_waiter_cancels_queued_future(self):
        class Pool:
            def __init__(self): self.future = concurrent.futures.Future()
            def submit(self, *_): return self.future
        pool = Pool()
        with patch.object(indexer._ProcessGraphWorker, '_new_pool', return_value=pool):
            worker = indexer._ProcessGraphWorker(self.graph)
        with self.assertRaises(TimeoutError):
            worker.query({'query':'queued', 'deadline':time.time()*1000+10})
        self.assertTrue(pool.future.cancelled())
        self.assertEqual(worker.cancelled_pending,1)
        self.assertFalse(worker._pending)
        self.assertFalse(worker._results)

    def test_process_computation_drops_first_caller_deadline(self):
        from types import SimpleNamespace
        seen = []
        fake = SimpleNamespace(query=lambda payload: seen.append(payload) or [], loads=1,
            _ready_languages=set(), _english_graph=SimpleNamespace(_get_retrieval_engine=lambda: SimpleNamespace(_embedding_index=None)),
            _graph=SimpleNamespace(_get_retrieval_engine=lambda: SimpleNamespace(_embedding_index=None, _prefilter_enabled=True)),
            cache_hits=0, coalesced=0, peak_queries=0)
        with patch.object(indexer, '_process_worker', fake):
            indexer._query_process({'query':'shared', 'deadline':0,
                'execution_deadline':time.time()*1000+55000})
        self.assertGreater(seen[0]['deadline'],time.time()*1000+50000)

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
