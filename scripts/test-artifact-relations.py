#!/usr/bin/env python3
"""Artifact declarations -> real GraphToolCall edges -> retrieval and persistence."""
import importlib.util
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'codex-profile/mac/hooks'))
import artifact_relations as artifacts
spec = importlib.util.spec_from_file_location('artifact_indexer', ROOT/'codex-profile/mac/hooks/graph_skill_index.py')
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


class ArtifactTests(unittest.TestCase):
    def test_explicit_sections_and_provenance(self):
        text = '## Outputs\n- `outline/table_schema.md`\n## Inputs\n- `results/evidence_matrix.tsv`\n'
        rows = artifacts.document_contracts(text, '/fixture/SKILL.md')
        self.assertEqual(rows['produces'][0]['field_name'], 'outline/table_schema.md')
        self.assertEqual(rows['consumes'][0]['field_name'], 'results/evidence_matrix.tsv')
        self.assertEqual(rows['produces'][0]['evidence']['line'], 2)
        self.assertEqual(len(rows['produces'][0]['evidence']['sha256']), 64)

    def test_bilingual_inline_and_roles_are_not_inherited(self):
        rows = artifacts.document_contracts('## Outputs\n**输入：** `outline/source_notes.md`\n**输出：** `outline/final_draft.md`', 'fixture')
        self.assertEqual([x['field_name'] for x in rows['consumes']], ['outline/source_notes.md'])
        self.assertEqual([x['field_name'] for x in rows['produces']], ['outline/final_draft.md'])

    def test_no_edges_from_incidental_examples_negation_or_generic_names(self):
        text = '''## Output
Read `package-lock.json` before writing.
- Return a report based on `input_notes.md`.
- Do not write `rejected_plan.md`.
- `report.json`
- `plan.md`
| parameter | `plugin.json` |
### Example
- `false_output.md`
## Workflow
- `not_an_output.md`
'''
        self.assertEqual(artifacts.document_contracts(text, 'fixture'), {'produces': [], 'consumes': []})

    def test_code_fences_frontmatter_references_and_parent_paths_excluded(self):
        text = '---\noutputs: hallucinated.md\n---\n## Outputs\n```md\n- `example_output.md`\n```\n- `references/source_notes.md`\n- `../outside.md`\n- `/absolute.md`\n'
        self.assertEqual(artifacts.document_contracts(text, 'fixture')['produces'], [])

    def graph(self, directory, extra=False):
        records = []
        for name, body in [('quartz-producer', '## Outputs\n- `outline/quartz_evidence.tsv`'),
                           ('zephyr-consumer', '## Inputs\n- `outline/quartz_evidence.tsv`'),
                           ('other-producer', '## Outputs\n- `other/quartz_evidence.tsv`')]:
            file = Path(directory)/name/'SKILL.md';file.parent.mkdir();file.write_text(body)
            records.append({'name': name, 'tool_name': name, 'description': name+' workflow', 'path': str(file)})
        if extra:
            file = Path(directory)/'duplicate.md';file.write_text('## Outputs\n- `outline/quartz_evidence.tsv`')
            records.append({'name':'duplicate','tool_name':'duplicate','description':'different producer','path':str(file)})
        return indexer.graph_from_records(records)

    def test_native_edges_retrieval_and_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            graph = self.graph(directory)
            edge = graph.graph.get_edge_attrs('quartz-producer', 'zephyr-consumer')
            self.assertEqual(edge['relation'], 'precedes')
            self.assertEqual(edge['confidence'], 'INFERRED')
            self.assertEqual(edge['artifact_evidence']['artifact'], 'outline/quartz_evidence.tsv')
            self.assertFalse(graph.graph.has_edge('other-producer', 'zephyr-consumer'))
            # GraphToolCall's actual seed expansion must consume the new edge.
            from graph_tool_call.retrieval.graph_search import GraphSearcher
            hits = dict(GraphSearcher(graph.graph).expand_from_seeds(['quartz-producer'], max_depth=1))
            self.assertIn('zephyr-consumer', hits)
            target = Path(directory)/'graph.json';graph.save(target)
            from graph_tool_call import ToolGraph
            restored = ToolGraph.load(target)
            self.assertEqual(restored.graph.get_edge_attrs('quartz-producer','zephyr-consumer'), edge)

    def test_ambiguous_producer_held_without_dense_links(self):
        with tempfile.TemporaryDirectory() as directory:
            graph = self.graph(directory, extra=True)
            self.assertFalse(graph.graph.has_edge('quartz-producer', 'zephyr-consumer'))
            self.assertEqual(len(graph.metadata['artifact_relations']['ambiguousArtifacts']), 1)

    def test_native_mcp_output_schema_is_retained(self):
        records = [{'tool_name':'mcp_one', 'name':'one','server':'fixture','description':'one',
                    'inputSchema':{'type':'object'},'outputSchema':{'type':'object','properties':{'order_id':{'type':'string'}}}}]
        graph = indexer.graph_from_records([], records)
        self.assertEqual(graph.tools['mcp_one'].metadata['mcp']['output_schema'], records[0]['outputSchema'])

    def test_mcp_typed_identifier_flow_stays_within_service_and_type(self):
        records = [dict(tool_name='create', name='create', server='orders', description='Create order',
                        inputSchema={'type':'object'}, outputSchema={'type':'object','properties':{'order_id':{'type':'string'}}})]
        for name, server, kind in [('read','orders','string'),('wrong-server','users','string'),('wrong-type','orders','integer')]:
            records.append(dict(tool_name=name,name=name,server=server,description=name,
                                inputSchema={'type':'object','properties':{'order_id':{'type':kind}},'required':['order_id']}))
        graph=indexer.graph_from_records([],records)
        self.assertTrue(graph.graph.has_edge('create','read'))
        self.assertFalse(graph.graph.has_edge('create','wrong-server'))
        self.assertFalse(graph.graph.has_edge('create','wrong-type'))

    def test_bom_hash_matches_exact_source_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            graph=self.graph(directory)
            path=Path(directory)/'quartz-producer/SKILL.md'
            raw=b'\xef\xbb\xbf'+path.read_bytes();path.write_bytes(raw)
            # Use a new graph because the first edge already exists.
            from graph_tool_call import ToolGraph
            fresh=ToolGraph()
            fresh.ingest_mcp_tools([{'name':'bom','description':'bom'}],detect_dependencies=False)
            fresh.tools['bom'].metadata['skill_path']=str(path)
            artifacts.enrich_artifact_relations(fresh)
            import hashlib
            self.assertEqual(fresh.metadata['artifact_relation_sources'][str(path.resolve())],hashlib.sha256(raw).hexdigest())
            self.assertEqual(fresh.tools['bom'].metadata['artifact_contract']['produces'][0]['evidence']['sha256'],hashlib.sha256(raw).hexdigest())

    def test_existing_required_dependency_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            graph = self.graph(directory)
            graph.add_relation('quartz-producer','zephyr-consumer','requires',evidence='existing')
            artifacts.enrich_artifact_relations(graph)
            self.assertEqual(graph.graph.get_edge_attrs('quartz-producer','zephyr-consumer')['relation'], 'requires')

    def test_links_are_bidirectional_bounded_and_do_not_change_primary_results(self):
        with tempfile.TemporaryDirectory() as directory:
            graph = self.graph(directory)
            rows = [{'name': 'quartz-producer', 'score': 9}, {'name': 'zephyr-consumer', 'score': 8}]
            artifacts.attach_artifact_links(rows, ['quartz-producer', 'zephyr-consumer'], graph)
            self.assertEqual([(r['name'], r['score']) for r in rows], [('quartz-producer', 9), ('zephyr-consumer', 8)])
            self.assertEqual([r['artifact_links'][0]['direction'] for r in rows], ['downstream', 'upstream'])
            self.assertEqual(rows[0]['artifact_links'][0]['evidence']['producer']['line'], 2)
            self.assertLessEqual(sum(len(r['artifact_links']) for r in rows), len(rows))
            plain = [{'name': 'other-producer'}]
            artifacts.attach_artifact_links(plain, ['other-producer'], graph)
            self.assertEqual(plain, [{'name': 'other-producer'}])

    def test_real_socket_worker_to_hook_keeps_handoff_on_explicit_match(self):
        node = os.environ.get('CODEX_TEST_NODE') or shutil.which('node')
        self.assertTrue(node, 'Set CODEX_TEST_NODE to the installed Node runtime')
        with tempfile.TemporaryDirectory(prefix='artifact-hook-') as directory:
            root = Path(directory).resolve()
            graph = self.graph(root)
            target = root/'skills.graph.json'; graph.save(target)
            registry = root/'skill-registry'; registry.mkdir()
            (registry/'skills-index.json').write_text(json.dumps({'externalGraphPath':str(target), 'skills':[
                {'name':'quartz-producer','path':str(root/'quartz-producer/SKILL.md'),
                 'description':'quartz producer workflow','source':'owned'}]}))
            (registry/'routing-rules.json').write_text('{}')
            hooks = root/'hooks'; hooks.mkdir()
            shutil.copy2(ROOT/'codex-profile/mac/hooks/graph_skill_index.py', hooks)
            sock = Path('/tmp')/f'codex-graph-{os.getuid()}'/(hashlib.sha256(str(target).encode()).hexdigest()[:24]+'.sock')
            sock.parent.mkdir(mode=0o700, exist_ok=True)
            env = {**os.environ, 'CODEX_HOME':str(root), 'CODEX_GRAPH_TOOL_PYTHON':sys.executable}
            with tempfile.TemporaryFile() as errors:
                worker = subprocess.Popen([sys.executable,str(ROOT/'codex-profile/mac/hooks/graph_skill_index.py'),
                    'serve','--graph',str(target),'--socket',str(sock)], env=env,
                    stdout=subprocess.DEVNULL, stderr=errors)
                try:
                    deadline = time.monotonic()+15
                    while not sock.exists() and time.monotonic() < deadline and worker.poll() is None:
                        time.sleep(.025)
                    if not sock.exists():
                        errors.seek(0); self.fail(errors.read().decode())
                    result = subprocess.run([node,str(ROOT/'codex-profile/.codex/hooks/skill-router.mjs')],
                        input=json.dumps({'hook_event_name':'UserPromptSubmit','prompt':'Use quartz-producer'}),
                        capture_output=True,text=True,env=env,timeout=20)
                    self.assertEqual(result.returncode,0,result.stderr)
                    self.assertEqual(result.stderr,'')
                    context=json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
                    self.assertIn('Artifact handoff (inferred; consider only if selecting this entry)',context)
                    self.assertIn('produces for zephyr-consumer; Read:',context)
                    self.assertIn('artifact=outline/quartz_evidence.tsv',context)
                finally:
                    worker.terminate(); worker.wait(timeout=5)
                    sock.unlink(missing_ok=True)


if __name__ == '__main__':
    unittest.main()
