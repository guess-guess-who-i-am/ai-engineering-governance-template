#!/usr/bin/env python3
"""Resource catalog -> real GraphToolCall -> serialized result -> Hook contract."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from contextlib import redirect_stdout
from io import StringIO
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / 'codex-profile/mac/hooks/graph_skill_index.py'
spec = importlib.util.spec_from_file_location('resource_indexer', ENTRY)
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


class ResourceGraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='resource-graph-')
        self.root = Path(self.temp.name)
        self.catalog = self.root / 'catalog.json'
        self.catalog.write_text('{"skills": []}')
        self.resources = self.root / 'resources.json'
        self.output = self.root / 'graph.json'
        self.modules = []
        for kind in ('expert', 'skill', 'mcp-service'):
            entry = self.root / (kind + '.md')
            entry.write_text('Complete workflow, roles and artifacts retained.')
            self.modules.append(dict(id='fixture-' + kind, name=kind + '-fixture', kind=kind,
                description='研究团队完整工作流' if kind == 'expert' else kind + ' distinct fixture',
                original_description='Original module description', path=str(entry),
                package_root=str(self.root), source='fixture', availability={'status': 'not-execution-tested'},
                dependencies=['native_search'] if kind == 'expert' else [], members=['agents/lead.md']))
        self.publish()

    def tearDown(self):
        self.temp.cleanup()

    def publish(self):
        self.resources.write_text(json.dumps({'schemaVersion': 'codex-resource-modules/1', 'modules': self.modules}))

    def args(self, resources=True):
        return SimpleNamespace(root=str(self.root), catalog=str(self.catalog), output=str(self.output),
            owned_root='', mcp_catalog='', resource_catalog=str(self.resources) if resources else None, embedding=False)

    def test_missing_optional_catalog_preserves_existing_build(self):
        self.assertEqual(indexer.load_resource_modules(None), [])
        with redirect_stdout(StringIO()):
            indexer.build(self.args(resources=False))
        self.assertTrue(self.output.is_file())

    def test_build_publishes_module_counts_and_stable_input_hash(self):
        with redirect_stdout(StringIO()):
            indexer.build(self.args())
        manifest = json.loads(self.output.with_suffix('.manifest.json').read_text())
        self.assertEqual(manifest['resourceModuleCount'], 3)
        self.assertEqual(manifest['resourceModuleCounts'], {'expert': 1, 'skill': 1, 'mcp-service': 1})
        node = shutil.which('node') or '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'
        module_uri = (ROOT / 'codex-profile/mac/hooks/registry-inputs.mjs').as_uri()
        script = f'''import {{graphInputsHash}} from {json.dumps(module_uri)};
            import {{writeFile}} from 'node:fs/promises';
            const root = process.argv[1], catalog = process.argv[2];
            const before = await graphInputsHash(root, []);
            const absent = await graphInputsHash(root, [], catalog);
            await writeFile(catalog, '{{"modules":[]}}');
            const present = await graphInputsHash(root, [], catalog);
            await writeFile(catalog, '{{"modules":[{{"entry_hash":"changed"}}]}}');
            const changed = await graphInputsHash(root, [], catalog);
            console.log(JSON.stringify({{before, absent, present, changed}}));'''
        response = subprocess.run([node, '--input-type=module', '-e', script,
            str(self.root / 'owned'), str(self.root / 'hash-fixture.json')],
            text=True, capture_output=True, check=True)
        hashes = json.loads(response.stdout)
        self.assertEqual(hashes['before'], hashes['absent'])
        self.assertNotEqual(hashes['absent'], hashes['present'])
        self.assertNotEqual(hashes['present'], hashes['changed'])

    def test_ambiguous_dependency_does_not_invent_edge(self):
        records = indexer.load_resource_modules(self.resources)
        records[0]['dependencies'] = ['ambiguous-search', 'nonexistent']
        native = [dict(tool_name=f'fixture_search_{n}', name='ambiguous-search',
                       server=f'fixture{n}', description='search documents') for n in (1, 2)]
        graph = indexer.graph_from_records([], native, records)
        for target in ('fixture_search_1', 'fixture_search_2'):
            self.assertFalse(graph._graph.has_edge(records[0]['tool_name'], target))

    def test_complete_modules_kinds_metadata_dependencies_and_real_retrieval(self):
        from graph_tool_call import ToolGraph
        records = indexer.load_resource_modules(self.resources)
        graph = indexer.graph_from_records([], [dict(tool_name='native_search', name='search',
            server='fixture', description='search documents')], records)
        self.assertEqual(len(graph.tools), 4)  # Roles were not split into nodes.
        graph.set_tokenizer(indexer.chinese_tokenize)
        graph.save(self.output)
        restored = ToolGraph.load(self.output)
        nodes = [restored.tools[record['tool_name']] for record in records]
        results = indexer.result_records([SimpleNamespace(tool=node, score=1, confidence='HIGH',
            keyword_score=1, graph_score=1, embedding_score=0) for node in nodes])
        self.assertEqual({r['kind'] for r in results}, {'expert', 'skill', 'mcp-service'})
        for result in results:
            self.assertTrue(result['module_id'].startswith('fixture-'))
            self.assertEqual(result['members'], ['agents/lead.md'])
            self.assertEqual(result['availability'], {'status': 'not-execution-tested'})
            self.assertEqual(result['source'], 'fixture')
        expert = records[0]['tool_name']
        self.assertTrue(restored._graph.has_edge(expert, 'native_search'))
        graph.set_tokenizer(indexer.chinese_tokenize)
        actual = graph.retrieve_with_scores('研究团队完整工作流', top_k=1)
        self.assertEqual(indexer.result_records(actual)[0]['module_id'], 'fixture-expert')

    def test_category_slots_select_each_kind_before_global_top_k(self):
        class Engine:
            def __init__(self):
                self._tools = {
                    **{f'expert-{i}': SimpleNamespace(metadata={'kind': 'expert'}) for i in range(3)},
                    **{f'skill-{i}': SimpleNamespace(metadata={'kind': 'skill'}) for i in range(5)},
                    **{f'mcp-{i}': SimpleNamespace(metadata={'kind': 'mcp-service'}) for i in range(3)},
                }

            def _build_candidates(self, final_scores, keyword_scores, graph_scores,
                                  embedding_scores, annotation_scores, semantic_scores, top_k):
                from graph_tool_call.retrieval.ranking import stable_score_items
                return [name for name, _ in stable_score_items(final_scores)[:top_k]]

        engine = Engine()
        slots = indexer.prepare_category_slot_retrieval(engine)
        scores = {name: 100 - i for i, name in enumerate(engine._tools)}
        args = (scores, {}, {}, {}, {}, {})

        baseline = engine._build_candidates(*args, 8)
        self.assertEqual(len(baseline), 8)
        self.assertEqual(sum(engine._tools[name].metadata['kind'] == 'expert' for name in baseline), 3)

        token = slots.set({'expert': 2, 'skill': 4, 'mcp': 2})
        try:
            selected = engine._build_candidates(*args, 8)
        finally:
            slots.reset(token)
        categories = [engine._tools[name].metadata['kind'] for name in selected]
        self.assertEqual(len(selected), 8)
        self.assertEqual(categories.count('expert'), 2)
        self.assertEqual(categories.count('skill'), 4)
        self.assertEqual(categories.count('mcp-service'), 2)
        self.assertEqual(selected, ['expert-0', 'expert-1', 'skill-0', 'skill-1', 'skill-2', 'skill-3', 'mcp-0', 'mcp-1'])

    def test_category_semantic_leaders_enter_fixed_prefilter_cap(self):
        import numpy as np

        names = [f'skill-{i}' for i in range(10)] + ['expert-a', 'expert-b', 'mcp-a', 'mcp-b']
        values = [0.99 - i * 0.01 for i in range(10)] + [0.30, 0.29, 0.20, 0.19]
        tools = {
            name: SimpleNamespace(metadata={'kind': 'expert' if name.startswith('expert') else
                'mcp-service' if name.startswith('mcp') else 'skill'})
            for name in names
        }

        class Index:
            size = len(names)

            def __init__(self):
                self._names = names
                self._matrix = np.asarray(values, dtype=np.float32).reshape(-1, 1)

            def _ensure_matrix(self):
                pass

            def encode(self, query):
                return [1.0]

            def search(self, query_vector, top_k):
                return [(name, score) for name, score in zip(names, values)][:top_k]

        class Prefilter:
            _max_pool = 8
            _embedding_index = Index()
            _tools = tools

            def candidate_pool(self, query, intent, bm25_top, *, resource_scored=None):
                return set(names[:8])

        class Engine:
            _tools = tools

            def __init__(self):
                self.prefilter = Prefilter()

            def _get_prefilter(self):
                return self.prefilter

            def _build_candidates(self, *args):
                return []

            def _compute_embedding_scores(self, query, top_k, restrict=None):
                return {}

        engine = Engine()
        slots = indexer.prepare_category_slot_retrieval(engine)
        indexer.prepare_semantic_candidate_guard(engine)
        token = slots.set({'expert': 2, 'skill': 4, 'mcp': 2})
        try:
            pool = engine._get_prefilter().candidate_pool('fixture query', None, [])
            semantic = engine._compute_embedding_scores('fixture query', 8, pool)
        finally:
            slots.reset(token)
        self.assertEqual(len(pool), 8)
        self.assertEqual(pool, {'expert-a', 'expert-b', 'skill-0', 'skill-1', 'skill-2', 'skill-3', 'mcp-a', 'mcp-b'})
        self.assertEqual(set(semantic), pool, 'category leaders past the global embedding cutoff must still reach fusion')
        self.assertEqual(engine._compute_embedding_scores('fixture query', 8), {},
            'category-scoped scores must not leak into a later unscoped request')

    def test_invalid_catalog_never_replaces_previous_graph(self):
        self.output.write_bytes(b'last-good-graph')
        for mutation in ('duplicate', 'missing-entry', 'invalid-kind'):
            original = [dict(m) for m in self.modules]
            if mutation == 'duplicate':
                self.modules.append(dict(self.modules[0]))
            elif mutation == 'missing-entry':
                self.modules[0]['path'] = str(self.root / 'missing.md')
            else:
                self.modules[0]['kind'] = 'unknown'
            self.publish()
            with self.assertRaises(ValueError):
                indexer.build(self.args())
            self.assertEqual(self.output.read_bytes(), b'last-good-graph')
            self.modules = original

    def test_refresh_waits_for_the_shared_lock_before_rebuilding(self):
        lock = self.root / 'refresh.lock'
        attempts = iter((False, False, True))
        args = SimpleNamespace(lock=lock, wait_timeout=1, node='node', script='refresh.mjs')
        with mock.patch.object(indexer, 'acquire_process_lock', side_effect=lambda _lock: next(attempts)) as acquire, \
             mock.patch.object(indexer.subprocess, 'run') as run:
            started = time.monotonic()
            indexer.refresh(args)
        self.assertEqual(acquire.call_count, 3)
        self.assertGreaterEqual(time.monotonic() - started, 0.15)
        run.assert_called_once()

    @unittest.skipIf(os.name == 'nt', 'Unix socket Hook fixture')
    def test_router_preserves_complete_module_and_availability(self):
        node = shutil.which('node') or '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'
        registry = self.root / 'skill-registry'
        hooks = self.root / 'hooks'
        registry.mkdir()
        hooks.mkdir()
        (hooks / 'graph_skill_index.py').write_text('# fixture')
        self.output.write_text('{}')
        (registry / 'skills-index.json').write_text(json.dumps({'skills': [], 'externalGraphPath': str(self.output)}))
        (registry / 'routing-rules.json').write_text('{}')
        digest = hashlib.sha256(str(self.output.resolve()).encode()).hexdigest()[:24]
        directory = Path('/tmp') / f'codex-graph-{os.getuid()}'
        directory.mkdir(mode=0o700, exist_ok=True)
        address = directory / (digest + '.sock')
        server = socket.socket(socket.AF_UNIX)
        server.bind(str(address))
        server.listen(1)
        module = self.modules[0]
        def reply():
            conn, _ = server.accept()
            with conn:
                conn.makefile('rb').readline()
                conn.sendall((json.dumps({'ok': True, 'results': [{**module, 'module_id': module['id'],
                    'score': 1, 'confidence': 'HIGH'}]}) + '\n').encode())
        thread = threading.Thread(target=reply, daemon=True)
        thread.start()
        try:
            response = subprocess.run([node, str(ROOT / 'codex-profile/.codex/hooks/skill-router.mjs')],
                input=json.dumps({'hook_event_name': 'UserPromptSubmit', 'prompt': '研究团队完整工作流'}),
                env={**os.environ, 'CODEX_HOME': str(self.root), 'CODEX_GRAPH_TOOL_PYTHON': sys.executable},
                text=True, capture_output=True, timeout=10, check=True)
            context = json.loads(response.stdout)['hookSpecificOutput']['additionalContext']
            for expected in ('Complete expert module', 'original primary role verbatim',
                             'not-execution-tested', 'members: 1', str(module['path'])):
                self.assertIn(expected, context)
        finally:
            server.close()
            address.unlink(missing_ok=True)
            thread.join(timeout=1)


if __name__ == '__main__':
    unittest.main()
