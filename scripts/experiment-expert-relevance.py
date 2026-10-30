#!/usr/bin/env python3
"""Trace and ablate the real installed full graph without editing its resources."""
import argparse
import hashlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import statistics
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
ROOT = Path(__file__).resolve().parents[1]
MUTATIONS = ('_inject_graph_candidates', '_boost_name_overlap',
             '_boost_semantic_phrase_matches', '_inject_clause_candidates',
             '_boost_method_intent', '_boost_embedding_rerank',
             '_preserve_dominant_keyword_candidates', '_boost_structured_semantics')


def intervention(engine, mode, category):
    """Reversible experimental changes; no corpus or production writes."""
    from graph_tool_call.retrieval.ranking import stable_score_items
    changed = {}
    old_index = engine._embedding_index
    def replace(name, value):
        changed[name] = getattr(engine, name)
        setattr(engine, name, value)
    flags = set(mode.split('+'))
    if 'descriptions' in flags:
        from graph_tool_call.retrieval.embedding import EmbeddingIndex
        provider = old_index._provider
        values = provider._precomputed
        new_index = EmbeddingIndex(provider=provider)
        new_index._embeddings = {name:values[tool.description]
            for name, tool in engine._tools.items() if tool.description in values}
        if len(new_index._embeddings) != len(engine._tools):
            raise ValueError('Description cache must cover the entire corpus')
        engine.set_embedding_index(new_index)
    if 'fullpool' in flags:
        old = engine._compute_embedding_scores
        def embedding(query, top_k, restrict=None):
            state = engine._codex_category_embedding_scores_context.get()
            if state is None or state[0] != query:
                return old(query, top_k, restrict)
            _, names, values, _ = state
            return {name:float(value) for name,value in zip(names, values)
                    if restrict is None or name in restrict}
        replace('_compute_embedding_scores', embedding)
    if 'localfusion' in flags:
        old_fuse = engine._fuse_and_filter
        def fuse(sources):
            scores = {}
            for group in ('expert', 'skill', 'mcp'):
                scores.update(old_fuse([({n:v for n,v in values.items()
                    if category(n)==group},w) for values,w in sources]))
            return scores
        replace('_fuse_and_filter', fuse)
    if 'localguard' in flags:
        old_guard = engine._preserve_dominant_keyword_candidates
        def guard(keyword_scores, final_scores, top_k, **kw):
            for group, count in engine._codex_category_slots.get().items():
                scores = {n:v for n,v in final_scores.items() if category(n)==group}
                old_guard({n:v for n,v in keyword_scores.items() if category(n)==group},
                          scores, count, **kw)
                final_scores.update(scores)
        replace('_preserve_dominant_keyword_candidates', guard)
    if 'categorypool' in flags:
        old_pool = engine._maybe_prefilter
        def pool(query, intent, keyword_scores, resource_scores):
            original = old_pool(query, intent, keyword_scores, resource_scores)
            state = engine._codex_category_embedding_scores_context.get()
            if original is None or state is None:
                return original
            _, names, values, _ = state
            cap = engine._get_prefilter()._max_pool
            quotas = engine._codex_category_slots.get()
            selected = set()
            for group, count in quotas.items():
                combined = {}
                for scores in (keyword_scores, dict(zip(names, map(float, values)))):
                    ranked = [(n,v) for n,v in stable_score_items(scores) if category(n)==group]
                    for rank,(name,value) in enumerate(ranked,1):
                        combined[name] = combined.get(name,0) + 1/(60+rank)
                take = cap*count//sum(quotas.values())
                selected.update(n for n,_ in stable_score_items(combined)[:take])
            return selected
        replace('_maybe_prefilter', pool)
    cc = next((float(flag.split(':')[1]) for flag in flags if flag.startswith('expertcc:')), None)
    if cc is not None or 'expertrrf' in flags:
        old_build = engine._build_candidates
        def build(final_scores, keyword_scores, graph_scores, embedding_scores,
                  annotation_scores, semantic_scores, top_k):
            state = engine._codex_category_embedding_scores_context.get()
            if state is None:
                raise ValueError('Full semantic evidence is required')
            _, names, values, _ = state
            dense = {n:float(v) for n,v in zip(names, values) if category(n)=='expert'}
            lexical = {n:keyword_scores.get(n,0.0) for n in dense}
            if cc is not None:
                def normalize(scores):
                    lo,hi=min(scores.values()),max(scores.values())
                    return {n:(v-lo)/(hi-lo) if hi>lo else 0.0 for n,v in scores.items()}
                ds,ls=normalize(dense),normalize(lexical)
                ranked={n:cc*ds[n]+(1-cc)*ls[n] for n in dense}
            else:
                ranked={}
                for scores in (dense,lexical):
                    for rank,(n,v) in enumerate(stable_score_items(scores),1):
                        if v>0:ranked[n]=ranked.get(n,0)+1/(60+rank)
            count=engine._codex_category_slots.get()['expert']
            chosen=dict(stable_score_items(ranked)[:count])
            final={n:v for n,v in final_scores.items() if category(n)!='expert'}
            # Other categories retain their actual scoring and selection.
            final.update(chosen)
            return old_build(final,keyword_scores,graph_scores,embedding_scores,
                             annotation_scores,semantic_scores,top_k)
        replace('_build_candidates',build)
    def restore():
        for name, value in changed.items():setattr(engine,name,value)
        if engine._embedding_index is not old_index:engine.set_embedding_index(old_index)
    return restore


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--graph', type=Path, default=Path.home()/'.codex/skill-registry/skills.graph.json')
    ap.add_argument('--indexer', type=Path, default=ROOT/'codex-profile/mac/hooks/graph_skill_index.py')
    ap.add_argument('--cases', nargs='+', type=Path, default=[ROOT/'scripts/resource-expert-routing-challenge.json'])
    ap.add_argument('--modes', nargs='+', default=['baseline'])
    ap.add_argument('--report', required=True, type=Path)
    args = ap.parse_args()
    frozen_files = [args.graph, args.indexer, *args.cases]
    frozen = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in frozen_files}
    import numpy as np
    from graph_tool_call.retrieval.ranking import stable_score_items
    spec = importlib.util.spec_from_file_location('expert_relevance_indexer', args.indexer)
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    started = time.perf_counter()
    worker = indexer._GraphWorker(args.graph)
    worker._load_if_stale()
    startup = time.perf_counter()-started
    tools = worker._graph.tools

    def identity(name):
        node = tools[name]
        return {'id': name, 'name': node.metadata.get('skill_name', name),
                'kind': node.metadata.get('kind', 'skill')}

    def category(name):
        kind = identity(name)['kind']
        return 'expert' if kind == 'expert' else 'mcp' if kind in ('mcp', 'mcp-service') else 'skill'

    def snapshot(scores, targets):
        ranked = stable_score_items(scores)
        positions = {name:i+1 for i,(name,_) in enumerate(ranked)}
        experts = [(name,value) for name,value in ranked if category(name)=='expert']
        eranks = {name:i+1 for i,(name,_) in enumerate(experts)}
        return {'count':len(scores), 'targets':[{**identity(name), 'rank':positions.get(name),
            'expertRank':eranks.get(name), 'score':scores.get(name)} for name in targets],
            'experts':[{**identity(name),'score':float(value)} for name,value in experts[:5]]}

    rows=[]
    for file in args.cases:
        for case in json.loads(file.read_text())['cases']:
            kind=case.get('kind') or {'expert-required':'expert','bounded-skill':'skill','bounded-tool':'mcp-service'}[case['split']]
            targets={name for name in tools if identity(name)['name'] in case['targets'] and identity(name)['kind']==kind}
            for lang in ('zh','en'):
                query=case[lang]
                engine=(worker._graph if lang=='zh' else worker._english_graph)._get_retrieval_engine()
                index=engine._embedding_index
                index._ensure_matrix()
                vector=np.asarray(index.encode(query),dtype=np.float32)
                vector/=max(float(np.linalg.norm(vector)),1e-12)
                dense=dict(zip(index._names,map(float,index._matrix@vector)))
                lexical=engine._get_bm25().score(query)
                raw={'dense':snapshot(dense,targets),'lexical':snapshot(lexical,targets)}
                for mode in args.modes:
                    restore_intervention = intervention(engine, mode, category)
                    stages={};saved={}
                    for name in ('_maybe_prefilter','_compute_keyword_scores','_compute_embedding_scores','_fuse_and_filter',*MUTATIONS,'_build_candidates'):
                        original=getattr(engine,name);saved[name]=original;signature=inspect.signature(original)
                        def wrapped(*pos,_name=name,_original=original,_signature=signature,**kw):
                            bound=_signature.bind(*pos,**kw).arguments
                            if mode=='without:'+_name:
                                result={} if _name=='_boost_structured_semantics' else None
                            else:
                                result=_original(*pos,**kw)
                            if _name=='_maybe_prefilter':
                                stages['pool']={'size':len(result) if result is not None else len(tools),
                                    'targets':{name:result is None or name in result for name in targets}}
                            elif _name in ('_compute_keyword_scores','_compute_embedding_scores','_fuse_and_filter'):
                                stages[_name]=snapshot(result,targets)
                            else:
                                scores=bound.get('scores',bound.get('final_scores'))
                                if scores is not None:stages[_name]=snapshot(scores,targets)
                            return result
                        setattr(engine,name,wrapped)
                    slots=engine._codex_category_slots.set({'expert':2,'skill':4,'mcp':2})
                    semantic=engine._codex_category_embedding_scores_context.set(None)
                    began=time.perf_counter()
                    try:results=engine.retrieve_with_scores(query,top_k=8,max_graph_depth=0 if mode=='depth0' else 2)
                    finally:
                        for name,original in saved.items():setattr(engine,name,original)
                        engine._codex_category_slots.reset(slots)
                        engine._codex_category_embedding_scores_context.reset(semantic)
                        restore_intervention()
                    elapsed=(time.perf_counter()-began)*1000
                    ids=[x.tool.name for x in results]
                    relevant=[name for name in ids if category(name)==category(next(iter(targets)))] if targets else []
                    row={'set':file.name,'case':case['id'],'kind':kind,'language':lang,'mode':mode,
                         'query':query,'ms':round(elapsed,3),'rank':next((i+1 for i,name in enumerate(ids) if name in targets),None),
                         'categoryRank':next((i+1 for i,name in enumerate(relevant) if name in targets),None),
                         'returned':[{**identity(name),'score':float(result.score),'description':tools[name].description[:400]}
                                     for name,result in zip(ids,results)],'stages':stages,'raw':raw}
                    rows.append(row)
                    print(json.dumps({k:row[k] for k in ('set','case','language','mode','categoryRank','ms')}),flush=True)
    summary=[]
    for mode in args.modes:
        for kind in sorted(set(row['kind'] for row in rows)):
            chosen=[row for row in rows if row['mode']==mode and row['kind']==kind]
            summary.append({'mode':mode,'kind':kind,'n':len(chosen),'hits':sum(row['rank'] is not None for row in chosen),
                            'medianMs':round(statistics.median(row['ms'] for row in chosen),3)})
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==frozen[str(p)] for p in frozen_files), 'Experiment inputs changed during execution'
    report={'schema':'expert-relevance-trace/v1','graphSha256':frozen[str(args.graph)],
            'indexerSha256':frozen[str(args.indexer)],'frozenInputSha256':frozen,'startupSeconds':startup,
            'weights':engine._get_adaptive_weights(),'reranker':type(engine._reranker).__name__,
            'summary':summary,'rows':rows,'productionChanged':False,
            'limitations':['Target-name hits are diagnostic, not task success. Existing sets are development data.',
                           'Omitting one stage is a causal intervention; timings include trace overhead.',
                           'No model, resource package, graph file, installed hook, or service is modified.']}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'report':str(args.report),'summary':summary}),flush=True)


if __name__=='__main__':main()
