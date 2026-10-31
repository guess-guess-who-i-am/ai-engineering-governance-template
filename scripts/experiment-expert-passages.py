#!/usr/bin/env python3
"""Isolated full-role passage evidence experiment, not a ColBERT reproduction.

Each expert remains one result. MaxP/mean and untuned RRF compare passage
evidence with the exact existing candidate pool; no package or service writes.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import statistics
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--graph', type=Path, required=True)
    ap.add_argument('--trace', type=Path, required=True)
    ap.add_argument('--documents', type=Path, required=True)
    ap.add_argument('--report', type=Path, required=True)
    args = ap.parse_args()
    import numpy as np
    import torch
    torch.set_num_threads(1)
    root = Path(__file__).resolve().parents[1]
    indexer_path = root/'codex-profile/mac/hooks/graph_skill_index.py'
    frozen = {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in (args.graph, args.trace, args.documents, indexer_path, Path(__file__))}
    trace = json.loads(args.trace.read_text())
    assert trace['graphSha256'] == frozen[str(args.graph)]
    assert trace['indexerSha256'] == frozen[str(indexer_path)]
    spec = importlib.util.spec_from_file_location('passage_indexer', indexer_path)
    indexer = importlib.util.module_from_spec(spec); spec.loader.exec_module(indexer)
    worker = indexer._GraphWorker(args.graph); worker._load_if_stale()
    model = worker._graph._get_retrieval_engine()._embedding_index._provider._provider._get_model()
    docs = json.loads(args.documents.read_text())
    names = [d['name'] for d in docs]
    assert len(set(names)) == len(names)
    assert set(names) == {n for n,t in worker._graph.tools.items() if t.metadata.get('kind') == 'expert'}
    cases = [r for r in trace['rows'] if r['kind'] == 'expert']
    # PARADE's MaxP baseline uses 225-token windows with 25-token overlap.
    # This installed encoder accepts fewer tokens; avoid silent truncation.
    width = min(225, model.max_seq_length - model.tokenizer.num_special_tokens_to_add(pair=False))
    overlap = 25
    assert width > overlap
    passages = []; owners = []; lengths = []; shortened = 0
    for i,doc in enumerate(docs):
        tokens = model.tokenizer.encode(doc['description'], add_special_tokens=False, truncation=False)
        start = 0
        while True:
            end = min(start+width, len(tokens))
            while True:
                text = model.tokenizer.decode(tokens[start:end], skip_special_tokens=True)
                actual = len(model.tokenizer.encode(text, add_special_tokens=True, truncation=False))
                if actual <= model.max_seq_length: break
                end -= 1
                assert end > start, 'Cannot represent even one source token'
            shortened += int(end < min(start+width, len(tokens)))
            passages.append(text); lengths.append(actual)
            owners.append(i)
            if end >= len(tokens): break
            # Advance from the actual retained end, covering every source
            # token even when decode/encode expands a partial WordPiece.
            assert end-start > overlap
            start = end-overlap
    print(json.dumps({'phase':'index','experts':len(names),'passages':len(passages),
        'windowTokens':width,'overlapTokens':overlap,'shortenedPassages':shortened,
        'maxActualTokens':max(lengths)}),flush=True)
    model.to('mps')
    began = time.perf_counter()
    matrix = model.encode(passages, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
    build_seconds = time.perf_counter()-began
    q = model.encode([c['query'] for c in cases], batch_size=16, normalize_embeddings=True, show_progress_bar=False)
    np.savez_compressed(args.report.with_suffix('.npz'), matrix=matrix, owners=np.asarray(owners),
        names=np.asarray(names), query_vectors=q, queries=np.asarray([c['query'] for c in cases]))
    query_timings=[]
    for case in cases[:8]:
        start=time.perf_counter();model.encode(case['query'],normalize_embeddings=True,show_progress_bar=False)
        query_timings.append((time.perf_counter()-start)*1000)
    model.to('cpu')
    owner=np.asarray(owners);counts=np.bincount(owner,minlength=len(names))
    rows=[]
    for pos,case in enumerate(cases):
        engine=(worker._graph if case['language']=='zh' else worker._english_graph)._get_retrieval_engine()
        saved=engine._build_candidates;captured={}
        def capture(scores,*a,**kw):
            captured.update({n:v for n,v in scores.items() if n in names})
            return saved(scores,*a,**kw)
        engine._build_candidates=capture
        try:worker.query({'query':case['query'],'top_k':8,'category_slots':{'expert':2,'skill':4,'mcp':2}})
        finally:engine._build_candidates=saved
        started=time.perf_counter();scores=matrix@q[pos]
        maxima=np.full(len(names),-np.inf);np.maximum.at(maxima,owner,scores)
        means=np.bincount(owner,weights=scores,minlength=len(names))/counts
        maxp=dict(zip(names,map(float,maxima)));mean=dict(zip(names,map(float,means)))
        aggregation_ms=(time.perf_counter()-started)*1000
        def rank(values):return sorted(values,key=lambda n:(-values[n],n.casefold(),n))
        def rrf(*sources):
            fused={}
            for values in sources:
                for i,n in enumerate(rank(values),1):
                    if values[n]>0:fused[n]=fused.get(n,0)+1/(60+i)
            return fused
        raw=engine._get_bm25().score(case['query'])
        lexical={n:raw.get(n,0.0) for n in names}
        scoped={n:maxp[n] for n in captured}
        modes={'maxp-global':maxp,'mean-global':mean,'maxp-pool':scoped,
               'rrf-pool':rrf(captured,scoped),'rrf-global':rrf(lexical,maxp)}
        targets={t['id'] for t in case['raw']['dense']['targets']}
        for mode,values in modes.items():
            ordered=rank(values)
            rows.append({k:case[k] for k in ('case','set','language','query')}|{
                'mode':mode,'hit':any(n in targets for n in ordered[:2]),
                'baselineHit':case['rank'] is not None,'aggregationMs':aggregation_ms,
                'candidateExperts':len(captured),'returned':[{'id':n,
                    'name':worker._graph.tools[n].metadata['skill_name'],'score':values[n]}
                    for n in ordered[:8]]})
    assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in frozen.items())
    summary=[]
    for mode in modes:
        for group in ('development','heldout'):
            chosen=[r for r in rows if r['mode']==mode and (('heldout' in r['set'])==(group=='heldout'))]
            summary.append({'mode':mode,'split':group,'n':len(chosen),'hits':sum(r['hit'] for r in chosen),
                'baselineHits':sum(r['baselineHit'] for r in chosen)})
    report={'schema':'expert-passages/v1','summary':summary,'rows':rows,'frozenInputSha256':frozen,
        'experts':len(names),'passages':len(passages),'windowTokens':width,'overlapTokens':overlap,
        'shortenedPassages':shortened,'maxActualTokens':max(lengths),
        'buildSeconds':build_seconds,'matrixBytes':matrix.nbytes,'queryMedianMpsMs':statistics.median(query_timings),
        'productionChanged':False,'paidCalls':0,'limitations':[
            'MaxP/mean cosine diagnostics, not trained ColBERT or PARADE models.',
            'Global variants diagnose representation; only pool variants retain the original candidates.',
            'Untuned RRF k=60; identity hits are not task success or two-seat relevance.']}
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
