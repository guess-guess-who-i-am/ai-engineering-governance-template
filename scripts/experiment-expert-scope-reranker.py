#!/usr/bin/env python3
"""Replay unchanged graph candidates with original-role applicability reranking.

No production writes; no target names are available to the ranking model.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import resource
import statistics
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--trace', type=Path, required=True)
    ap.add_argument('--documents', type=Path, required=True)
    ap.add_argument('--model', type=Path, required=True)
    ap.add_argument('--report', type=Path, required=True)
    ap.add_argument('--limit', type=int)
    ap.add_argument('--device', default='mps')
    ap.add_argument('--batch-size', type=int, default=8)
    args = ap.parse_args()
    import torch
    from sentence_transformers import CrossEncoder
    torch.set_num_threads(1)
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('scope_probe_indexer', root/'codex-profile/mac/hooks/graph_skill_index.py')
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    worker = indexer._GraphWorker(Path.home()/'.codex/skill-registry/skills.graph.json')
    worker._load_if_stale()
    documents = {x['name']: x for x in json.loads(args.documents.read_text())}
    instruction = ('Given a user task, retrieve an expert whose original role explicitly supports '
                   'performing the requested work in the requested domain. Shared incidental words '
                   'alone do not establish that the expert can perform the task.')
    model = CrossEncoder(str(args.model), device=args.device, local_files_only=True,
        max_length=1024, prompts={'applicability': instruction}, default_prompt_name='applicability',
        model_kwargs={'torch_dtype': torch.float16} if args.device == 'mps' else {})
    model.predict([['compare service throughput', 'Performance testing and load generation']], show_progress_bar=False)
    rows = []
    cases = [r for r in json.loads(args.trace.read_text())['rows'] if r['kind'] == 'expert']
    if args.limit:
        cases = cases[:args.limit]
    for case in cases:
        engine = (worker._graph if case['language'] == 'zh' else worker._english_graph)._get_retrieval_engine()
        original = engine._build_candidates
        captured = {}
        def capture(final_scores, *a, **kw):
            captured.update({n:v for n,v in final_scores.items() if n in documents})
            return original(final_scores, *a, **kw)
        engine._build_candidates = capture
        try:
            baseline = worker.query({'query': case['query'], 'top_k': 8,
                'category_slots': {'expert': 2, 'skill': 4, 'mcp': 2}})
        finally:
            engine._build_candidates = original
        if not captured:
            raise ValueError('No actual candidates captured; cache must not bypass the experiment')
        candidates = sorted(captured)
        started = time.perf_counter()
        scores = model.predict([[case['query'], documents[n]['description']] for n in candidates],
            batch_size=args.batch_size, show_progress_bar=False)
        elapsed = (time.perf_counter()-started)*1000
        ordered = sorted(zip(candidates, map(float, scores)), key=lambda x:(-x[1], x[0]))
        targets = {x['id'] for x in case['raw']['dense']['targets']}
        row = {k:case[k] for k in ('case', 'language', 'set', 'query')}
        row.update({'candidates':len(candidates), 'poolRecall':bool(targets & set(candidates)),
            'baselineHit':any(x['name'] in {documents[n]['metadata']['skill_name'] for n in targets} for x in baseline),
            'hit':any(n in targets for n,s in ordered[:2]), 'rerankMs':elapsed,
            'returned':[{'id':n, 'name':documents[n]['metadata']['skill_name'], 'logit':s,
                         'baselineScore':captured[n]} for n,s in ordered]})
        rows.append(row)
        report = {'schema':'expert-scope-rerank/v1', 'instruction':instruction, 'maxLength':1024,
            'model':str(args.model), 'device':args.device, 'rows':rows,
            'summary':{'n':len(rows), 'baselineHits':sum(r['baselineHit'] for r in rows),
                'hits':sum(r['hit'] for r in rows), 'poolRecall':sum(r['poolRecall'] for r in rows),
                'medianRerankMs':statistics.median(r['rerankMs'] for r in rows)},
            'peakRSSMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024/1024,
            'productionChanged':False, 'paidCalls':0,
            'limitations':['Observed development queries; identity hits are not task-success accuracy.',
                'Candidates are exactly the existing graph final-score experts, without expansion.',
                'Latency excludes graph startup and graph query; memory includes graph and both query models.']}
        args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({k:row[k] for k in ('case','language','candidates','baselineHit','hit','rerankMs')}),flush=True)
    print(json.dumps(report['summary']),flush=True)


if __name__ == '__main__':
    main()
