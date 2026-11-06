#!/usr/bin/env python3
"""Grounded declarations, portable identities and real native graph consumers."""
import importlib.util
import json
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import time
import threading
import shutil
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'codex-profile/mac/hooks'))
import semantic_relations as semantic
spec=importlib.util.spec_from_file_location('semantic_builder',ROOT/'scripts/build-semantic-relations.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
spec=importlib.util.spec_from_file_location('semantic_indexer',ROOT/'codex-profile/mac/hooks/graph_skill_index.py')
indexer=importlib.util.module_from_spec(spec);spec.loader.exec_module(indexer)
spec=importlib.util.spec_from_file_location('semantic_client',ROOT/'scripts/semantic_model_client.py')
client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)


class SemanticTests(unittest.TestCase):
    def setUp(self):
        home=tempfile.TemporaryDirectory(prefix='semantic-test-config-');self.addCleanup(home.cleanup)
        Path(home.name,'config.toml').write_text('model="fixture-model"\nmodel_provider="fixture"\n[model_providers.fixture]\nbase_url="https://fixture.invalid/v1"\n')
        env=patch.dict(os.environ,{'CODEX_HOME':home.name});env.start();self.addCleanup(env.stop)

    def test_responses_stream_contract_and_incomplete_or_http_failure(self):
        import httpx
        original=httpx.Client;requests=[]
        with tempfile.TemporaryDirectory() as d:
            Path(d,'config.toml').write_text('model="fixture-model"\nmodel_provider="fixture"\n[model_providers.fixture]\nbase_url="https://fixture.invalid/v1"\nenv_key="SEMANTIC_TEST_KEY"\n')
            def run(events,status=200):
                def handle(request):
                    requests.append(request)
                    body=''.join('data: '+json.dumps(event)+'\n\n' for event in events)
                    return httpx.Response(status,text=body)
                with original(transport=httpx.MockTransport(handle)) as connection,patch.dict(os.environ,{'CODEX_HOME':d,'SEMANTIC_TEST_KEY':'fixture-not-a-real-key'}),patch.object(client,'http_client',lambda:connection):
                    return client.generate('fixture evidence',{'type':'object'},10)
            output,usage=run([{'type':'response.output_text.delta','delta':'{}'},
                {'type':'response.completed','response':{'usage':{'input_tokens':3}}}])
            self.assertEqual((output,usage),('{}',{'input_tokens':3}))
            payload=json.loads(requests[0].content)
            self.assertFalse(payload['store']);self.assertNotIn('tools',payload)
            self.assertEqual(str(requests[0].url),'https://fixture.invalid/v1/responses')
            with self.assertRaisesRegex(RuntimeError,'without completion'):run([])
            with self.assertRaisesRegex(RuntimeError,'stream failed'):run([{'type':'response.incomplete'}])
            with self.assertRaises(client.ModelHTTPError) as caught:run([],429)
            self.assertTrue(caught.exception.retryable)
            with self.assertRaises(client.ModelHTTPError) as caught:run([],401)
            self.assertFalse(caught.exception.retryable)

    def test_wave_overlap_transport_backpressure_and_retry(self):
        import httpx
        attempts={};active=0;peak=0;lock=threading.Lock()
        def review(batch,*_):
            nonlocal active,peak
            i=batch[0]
            with lock:
                attempts[i]=attempts.get(i,0)+1;active+=1;peak=max(peak,active)
            time.sleep(.02)
            with lock:active-=1
            if i==0 and attempts[i]==1:raise httpx.ReadError('test transport failure')
            return {'results':[{'id':str(i)}]},{'cacheHit':False,'start':0,'end':1}
        with tempfile.TemporaryDirectory() as d:
            results=builder.run_reviews([[i] for i in range(8)],[],Path(d)/'reviews',6,10,review)
            log=json.loads((Path(d)/'review-timing.json').read_text())
            waves=[e for e in log['events'] if 'members' in e]
            self.assertEqual([w['width'] for w in waves[:2]],[4,2])
            self.assertEqual(len(results),8);self.assertEqual(attempts[0],2)
            self.assertGreaterEqual(peak,4);self.assertLessEqual(peak,6)

    def test_semantic_failure_stops_new_consumers(self):
        calls=[]
        def review(batch,*_):
            calls.append(batch[0]);raise ValueError('Invalid evidence')
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RuntimeError):
                builder.run_reviews([[i] for i in range(9)],[],Path(d)/'reviews',6,10,review)
            self.assertEqual(set(calls),set(range(4)))
            self.assertEqual(json.loads((Path(d)/'review-timing.json').read_text())['skipped'],5)

    def review_fixture(self):
        records=[{'name':'extract','description':'Extract invoice CSV','inputs':[],
                  'outputs':[{'line':2,'text':'Invoice rows'}]},
                 {'name':'audit','description':'Audit invoice CSV','inputs':[{'line':4,'text':'Invoice rows'}],'outputs':[]}]
        pairs=[{'id':'one','source':0,'target':1,'proposal':'precedes'}]
        return records,pairs

    def test_review_uses_source_evidence_and_verified_cache(self):
        records,pairs=self.review_fixture();calls=[]
        def generate(prompt,schema,timeout):
            calls.append(prompt)
            return json.dumps({'results':['one|P|1|1|Possible invoice handoff; format unverified.']}),{}
        with tempfile.TemporaryDirectory() as d:
            result,timing=builder.review_batch(pairs,records,Path(d),30,generate)
            self.assertEqual(result['results'][0]['sourceQuote'],'Invoice rows')
            self.assertFalse(timing['cacheHit'])
            _,timing=builder.review_batch(pairs,records,Path(d),30,generate)
            self.assertTrue(timing['cacheHit']);self.assertEqual(len(calls),1)
            records[0]['description']='Different source'
            builder.review_batch(pairs,records,Path(d),30,generate)
            self.assertEqual(len(calls),2)

    def test_review_rejects_missing_duplicate_unknown_and_invalid_evidence(self):
        records,pairs=self.review_fixture()
        base='one|P|1|1|handoff'
        cases=[[],[base,base],['unknown|P|1|1|handoff'],['one|R|1|1|handoff'],
               ['one|P|1|True|handoff'],['one|N|1|1|']]
        for rows in cases:
            with self.subTest(rows=rows),tempfile.TemporaryDirectory() as d:
                with self.assertRaises(ValueError):
                    builder.review_batch(pairs,records,Path(d),30,lambda *_:(json.dumps({'results':rows}),{}))
                self.assertFalse(list(Path(d).rglob('receipt.json')))

    def test_bad_evidence_is_rejected_and_audited_without_losing_valid_peers(self):
        records,pairs=self.review_fixture()
        with tempfile.TemporaryDirectory() as d:
            data,_=builder.review_batch(pairs,records,Path(d),30,lambda *_:(json.dumps({'results':['one|P|1|20|bad citation']}),{}))
            self.assertEqual(data['results'][0]['relation'],'none')
            self.assertEqual(data['invalidEvidenceRejected'][0]['index'],20)
            self.assertEqual(len(list(Path(d).rglob('invalid-evidence.json'))),1)

    def test_review_rejects_corrupted_cache(self):
        records,pairs=self.review_fixture();calls=[]
        def generate(*_):
            calls.append(1)
            return json.dumps({'results':['one|N|-1|-1|']}),{}
        with tempfile.TemporaryDirectory() as d:
            builder.review_batch(pairs,records,Path(d),30,generate)
            next(Path(d).rglob('output.json')).write_text('corrupt')
            builder.review_batch(pairs,records,Path(d),30,generate)
            self.assertEqual(len(calls),2)

    def test_malformed_batch_splits_and_requires_all_child_decisions(self):
        records,pairs=self.review_fixture();pairs=pairs+[{**pairs[0],'id':'two'}];calls=[]
        def review(batch,*args,**kwargs):
            calls.append(len(batch))
            if len(batch)>1:raise ValueError('Missing ID')
            return {'results':[{'id':batch[0]['id'],'relation':'none'}]}, {'signature':batch[0]['id'],'cacheHit':False}
        with tempfile.TemporaryDirectory() as d,patch.object(builder,'review_batch',review):
            data,meta=builder.review_resilient(pairs,records,Path(d),30)
            self.assertEqual([r['id'] for r in data['results']],['one','two'])
            self.assertEqual(calls,[2,1,1]);self.assertEqual(len(meta['splitChildren']),2)
            self.assertEqual(len(list(Path(d).rglob('split-recovery.json'))),1)

    def test_raw_source_change_outside_declarations_is_detected(self):
        with tempfile.TemporaryDirectory() as d:
            file=Path(d)/'SKILL.md';file.write_text('Original body without declarations')
            meta={'kind':'skill','skill_name':'test','skill_path':str(file)}
            graph={'tools':{'test':{'metadata':meta,'description':'Test capability'}}}
            nodes,records=builder.inventory(graph);prepared={'nodes':nodes,'records':records}
            builder.source_check(graph,prepared)
            file.write_text('Changed body without declarations')
            with self.assertRaisesRegex(ValueError,'Complete source changed'):
                builder.source_check(graph,prepared)

    def test_nested_natural_language_tables_and_inline_roles(self):
        text='## Outputs\nAn audited billing ledger.\n### Fields\n| Field | Purpose |\n| --- | --- |\n| amount | Total paid |\n**Input:** invoice rows\n## Other\nnot an output\n'
        rows=semantic.declarations(text)
        self.assertIn('An audited billing ledger.',[r['text'] for r in rows['outputs']])
        self.assertIn('| amount | Total paid |',[r['text'] for r in rows['outputs']])
        self.assertEqual(rows['inputs'],[{'line':7,'text':'**Input:** invoice rows'}])
        self.assertNotIn('not an output',[r['text'] for r in rows['outputs']])

    def test_examples_and_fences_do_not_create_declarations(self):
        text='---\noutputs: fake\n---\n## Outputs\n````txt\n```\nfalse\n````\n### Example\nwrong\n## Inputs\nBilling rows'
        self.assertEqual(semantic.declarations(text),{'inputs':[{'line':12,'text':'Billing rows'}],'outputs':[]})

    def test_identity_rebinds_root_but_distinguishes_distinct_publishers(self):
        a={'kind':'skill','skill_name':'test','skill_path':'/Mac/skills/author-a-test/SKILL.md'}
        b={**a,'skill_path':'/Linux/tools/author-a-test/SKILL.md'}
        c={**a,'skill_path':'/Mac/skills/author-b-test/SKILL.md'}
        self.assertEqual(semantic.identity(a,'hash'),semantic.identity(b,'hash'))
        self.assertNotEqual(semantic.identity(a,'hash'),semantic.identity(c,'hash'))
        self.assertNotEqual(semantic.identity(a,'hash'),semantic.identity(a,'changed'))

    def test_expert_hash_rebinds_only_generated_paths_and_preserves_role_bytes(self):
        meta={'kind':'expert','package_root':'/Mac/expert','retrieval_provenance':{'primary_path':'agents/lead.md'}}
        raw=b'[EXPERT_ENTRY_V1: ORIGINAL_ROLE_LOADED]\nPackage root: /Mac/expert\nOriginal primary role: /Mac/expert/agents/lead.md\nOriginal role bytes'
        moved={**meta,'package_root':'/Linux/expert'}
        self.assertEqual(semantic.source_digest(meta,raw),semantic.source_digest(moved,raw.replace(b'/Mac/',b'/Linux/')))
        self.assertNotEqual(semantic.source_digest(meta,raw),semantic.source_digest(meta,raw+b'changed'))
        with self.assertRaises(ValueError):semantic.source_digest(moved,raw)

    def make_graph(self,root):
        records=[]
        for name,body in [('invoice-parse','## Outputs\nInvoice rows in CSV.'),('billing-audit','## Inputs\nInvoice rows in CSV.')]:
            entry=root/name/'SKILL.md';entry.parent.mkdir();entry.write_text(body)
            records.append({'name':name,'tool_name':name,'description':body,'path':str(entry)})
        graph=indexer.graph_from_records(records)
        keys={name:semantic.identity(tool.metadata,semantic.tool_source(tool)[1]) for name,tool in graph.tools.items()}
        nodes={keys[name]:{'state':'declared-io','contract':semantic.declarations(semantic.tool_source(tool)[0].decode())}
               for name,tool in graph.tools.items()}
        document={'schemaVersion':semantic.REVISION,'verification':{'complete':True},'nodes':nodes,'edges':[{'source':keys['invoice-parse'],
            'target':keys['billing-audit'],'relation':'precedes','sourceQuote':'Invoice rows in CSV.',
            'targetQuote':'Invoice rows in CSV.','reason':'Possible CSV handoff; compatibility unverified.'}]}
        registry=root/'registry.json';registry.write_text(json.dumps(document));return graph,registry,document

    def test_real_graph_edge_persistence_and_result_hint(self):
        from graph_tool_call import ToolGraph
        with tempfile.TemporaryDirectory() as d:
            graph,registry,document=self.make_graph(Path(d))
            report=semantic.apply_semantic_relations(graph,registry)
            self.assertEqual((report['processed'],report['added'],report['unmatched']),(2,1,0))
            file=Path(d)/'graph.json';graph.save(file);restored=ToolGraph.load(file)
            result=SimpleNamespace(tool=restored.tools['invoice-parse'],score=1,confidence='test',keyword_score=1,graph_score=0,embedding_score=0)
            rows=indexer.result_records([result],restored)
            self.assertEqual(rows[0]['semantic_links'][0]['name'],'billing-audit')
            self.assertEqual(rows[0]['semantic_links'][0]['direction'],'downstream')
            self.assertEqual(rows[0]['semantic_links'][0]['evidence']['sourceQuote'],'Invoice rows in CSV.')

    def test_real_socket_to_hook_retains_semantic_link_on_explicit_match(self):
        node=os.environ.get('CODEX_TEST_NODE') or shutil.which('node')
        self.assertTrue(node,'Set CODEX_TEST_NODE to the Node runtime')
        with tempfile.TemporaryDirectory(prefix='semantic-hook-') as d:
            root=Path(d).resolve();graph,registry,_=self.make_graph(root)
            semantic.apply_semantic_relations(graph,registry)
            target=root/'skills.graph.json';graph.save(target)
            home=root/'skill-registry';home.mkdir()
            (home/'skills-index.json').write_text(json.dumps({'externalGraphPath':str(target),'skills':[
                {'name':'invoice-parse','path':str(root/'invoice-parse/SKILL.md'),'description':'invoice parse','source':'owned'}]}))
            (home/'routing-rules.json').write_text('{}');(root/'hooks').mkdir()
            shutil.copy2(ROOT/'codex-profile/mac/hooks/graph_skill_index.py',root/'hooks')
            sock=Path('/tmp')/f'codex-graph-{os.getuid()}'/(hashlib.sha256(str(target).encode()).hexdigest()[:24]+'.sock')
            sock.parent.mkdir(mode=0o700,exist_ok=True)
            env={**os.environ,'CODEX_HOME':str(root),'CODEX_GRAPH_TOOL_PYTHON':sys.executable}
            with tempfile.TemporaryFile() as errors:
                worker=subprocess.Popen([sys.executable,str(ROOT/'codex-profile/mac/hooks/graph_skill_index.py'),
                    'serve','--graph',str(target),'--socket',str(sock)],env=env,stdout=subprocess.DEVNULL,stderr=errors)
                try:
                    deadline=time.monotonic()+15
                    while not sock.exists() and time.monotonic()<deadline and worker.poll() is None:time.sleep(.025)
                    if not sock.exists():errors.seek(0);self.fail(errors.read().decode())
                    result=subprocess.run([node,str(ROOT/'codex-profile/.codex/hooks/skill-router.mjs')],
                        input=json.dumps({'hook_event_name':'UserPromptSubmit','prompt':'Use invoice-parse'}),
                        env=env,capture_output=True,text=True,timeout=20)
                    self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stderr,'')
                    context=json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
                    self.assertIn('Semantic relation (inferred; conditional, no execution authorization)',context)
                    self.assertIn('possible next step: billing-audit; Read:',context)
                finally:
                    worker.terminate();worker.wait(timeout=5);sock.unlink(missing_ok=True)

    def test_modified_source_cannot_reuse_old_semantic_edges(self):
        with tempfile.TemporaryDirectory() as d:
            graph,registry,_=self.make_graph(Path(d))
            Path(graph.tools['invoice-parse'].metadata['skill_path']).write_text('Different source')
            report=semantic.apply_semantic_relations(graph,registry)
            self.assertEqual(report['unmatched'],1);self.assertEqual(report['added'],0)
            self.assertFalse(graph.graph.has_edge('invoice-parse','billing-audit'))

    def test_first_pass_only_registry_cannot_publish(self):
        with tempfile.TemporaryDirectory() as d:
            graph,registry,document=self.make_graph(Path(d));document.pop('verification')
            registry.write_text(json.dumps(document))
            with self.assertRaisesRegex(ValueError,'complete blind verification'):
                semantic.apply_semantic_relations(graph,registry)

    def test_existing_requires_not_overwritten(self):
        with tempfile.TemporaryDirectory() as d:
            graph,registry,_=self.make_graph(Path(d));graph.add_relation('invoice-parse','billing-audit','requires')
            semantic.apply_semantic_relations(graph,registry)
            self.assertEqual(graph.graph.get_edge_attrs('invoice-parse','billing-audit')['relation'],'requires')

    def test_missing_registry_explicitly_reports_not_built(self):
        from graph_tool_call import ToolGraph
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(semantic.apply_semantic_relations(ToolGraph(),Path(d)/'missing.json')['state'],'not-built')


if __name__=='__main__':unittest.main()
