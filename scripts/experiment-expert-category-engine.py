#!/usr/bin/env python3
"""Compare true expert-scoped graph ranking with final-result category quotas."""
import argparse
from copy import copy
import importlib.util
import json
import os
from pathlib import Path
import time

for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):
    os.environ[key]='1'
for key in ('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS'):
    os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--trace',type=Path,required=True)
    ap.add_argument('--graph',type=Path,default=Path.home()/'.codex/skill-registry/skills.graph.json')
    ap.add_argument('--report',type=Path,required=True)
    args=ap.parse_args()
    from graph_tool_call.retrieval.embedding import EmbeddingIndex
    from graph_tool_call.retrieval.ranking import stable_score_items
    root=Path(__file__).resolve().parents[1]
    spec=importlib.util.spec_from_file_location('category_probe_indexer',root/'codex-profile/mac/hooks/graph_skill_index.py')
    indexer=importlib.util.module_from_spec(spec);spec.loader.exec_module(indexer)
    worker=indexer._GraphWorker(args.graph);worker._load_if_stale()
    channels={}
    for language,source in [('zh',worker._graph),('en',worker._english_graph)]:
        graph=copy(source)
        graph._tools={n:t for n,t in source.tools.items() if t.metadata.get('kind')=='expert'}
        graph._retrieval=None
        engine=graph._get_retrieval_engine()
        source_engine=source._get_retrieval_engine()
        dense=EmbeddingIndex(provider=source_engine._embedding_index._provider)
        dense._embeddings={n:source_engine._embedding_index._embeddings[n] for n in graph.tools}
        engine.set_embedding_index(dense)
        # This intervention changes corpus scope, not source graph edges.
        engine.set_diversity(None)
        indexer._prepare_keyword_index(engine)
        indexer.prepare_sparse_bm25(engine)
        if language=='zh':indexer.prepare_chinese_retrieval(engine)
        channels[language]=graph
    rows=[]
    for case in json.loads(args.trace.read_text())['rows']:
        if case['kind']!='expert':continue
        graph=channels[case['language']];engine=graph._get_retrieval_engine()
        targets={x['id'] for x in case['raw']['dense']['targets']}
        for mode in ('category','category-full-dense','category-original-weights'):
            original=engine._compute_embedding_scores
            if mode=='category-full-dense':
                def all_scores(query,top_k,restrict=None):
                    return dict(engine._embedding_index.search(engine._embedding_index.encode(query),top_k=len(graph.tools)))
                engine._compute_embedding_scores=all_scores
            if mode=='category-original-weights':
                source=worker._graph if case['language']=='zh' else worker._english_graph
                k,g,e,a=source._get_retrieval_engine()._get_adaptive_weights()
                engine.set_weights(keyword=k,graph=g,embedding=e,annotation=a)
            start=time.perf_counter()
            try:result=graph.retrieve_with_scores(case['query'],top_k=2,max_graph_depth=2)
            finally:
                engine._compute_embedding_scores=original
                engine._weights_manual=False
            row={'case':case['case'],'language':case['language'],'set':case['set'],'mode':mode,
                'hit':any(x.tool.name in targets for x in result),'ms':(time.perf_counter()-start)*1000,
                'returned':[{'id':x.tool.name,'name':x.tool.metadata['skill_name'],'score':x.score} for x in result]}
            rows.append(row)
            print(json.dumps({k:row[k] for k in ('case','language','mode','hit','ms')}),flush=True)
    summary=[{'mode':mode,'n':sum(r['mode']==mode for r in rows),
        'hits':sum(r['mode']==mode and r['hit'] for r in rows)} for mode in sorted({r['mode'] for r in rows})]
    args.report.write_text(json.dumps({'schema':'expert-category-engine/v1','summary':summary,'rows':rows,
        'productionChanged':False,'limitation':'Expert-only diagnostic, not final task relevance or candidate-pool proposal.'},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary))


if __name__=='__main__':main()
