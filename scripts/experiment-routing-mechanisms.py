#!/usr/bin/env python3
"""Isolated mechanism experiments: no global writes, training or paid calls.

BM25F implements field normalization BEFORE term saturation (Robertson 2009).
Usage prototypes adapt Tool2Vec's mean-query representation using pre-existing
package examples, NOT Tool2Vec's trained E5/ToolRefiner. Clause xQuAD is an
engineering adaptation: deterministic clauses and cosine proxies, not the
paper's subquery miner or calibrated relevance probabilities.
"""
import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import statistics
import time
import unittest

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
ROOT = Path(__file__).resolve().parents[1]
FIELD_CONFIG = {'name': (2., 0.), 'capability': (1., .75),
                'examples': (.5, .75), 'generated': (.05, .75)}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_tokens(text):
    # Preserve Han-bigram boundaries; never keep punctuation-only tokens.
    tokens = []
    for part in re.findall(r'[\u3400-\u4dbf\u4e00-\u9fff]+|[A-Za-z0-9]+', text.lower()):
        if re.search(r'[\u3400-\u4dbf\u4e00-\u9fff]', part):
            tokens.extend([part] if len(part) == 1 else [part[i:i+2] for i in range(len(part)-1)])
        else:
            tokens.append(part)
    return tokens


def clauses(query):
    return list(dict.fromkeys(x.strip() for x in re.split(
        r'[;；。.!?！？]|(?:,|，)\s*|\b(?:then|finally)\b|(?:最后|然后|再由)', query)
        if len(clean_tokens(x)) >= 2)) or [query]


class BM25F:
    def __init__(self, documents, config=FIELD_CONFIG, k1=1.5):
        import numpy as np
        self.n, self.postings = len(documents), {}
        # One document frequency across fields; add normalized weighted TF
        # across fields, then apply ONE saturation per term and document.
        weighted = defaultdict(lambda: defaultdict(float))
        for field, (weight, b) in config.items():
            counters = [Counter(clean_tokens(doc.get(field, ''))) for doc in documents]
            avg = sum(sum(c.values()) for c in counters) / max(self.n, 1) or 1.
            for i, tf in enumerate(counters):
                norm = 1 - b + b * sum(tf.values()) / avg
                for term, count in tf.items():
                    weighted[term][i] += weight * count / norm
        for term, values in weighted.items():
            df = len(values)
            idf = math.log(1 + (self.n - df + .5) / (df + .5))
            self.postings[term] = (np.asarray(list(values), dtype=np.int32),
                np.asarray([idf * (k1 + 1) * tf / (k1 + tf) for tf in values.values()]))

    def score(self, query):
        import numpy as np
        values = np.zeros(self.n)
        for term in clean_tokens(query):
            if term in self.postings:
                positions, contributions = self.postings[term]
                values[positions] += contributions
        return values


def normalized(matrix):
    import numpy as np
    matrix = np.asarray(matrix, dtype=np.float32)
    return matrix / np.maximum(np.linalg.norm(matrix, axis=-1, keepdims=True), 1e-12)


def order(values, positive=False):
    import numpy as np
    result = np.argsort(-values, kind='stable')
    return result[values[result] > 0] if positive else result


def fused_scores(sources, n):
    import numpy as np
    values = np.zeros(n)
    for source in sources:
        source = list(source)[:64]
        values[source] += 1 / (60 + np.arange(1, len(source) + 1))
    return values


def dedup(ranking, keys, k=8):
    if k <= 0:
        return []
    seen, result = set(), []
    for i in ranking:
        if keys[i] not in seen:
            result.append(i)
            seen.add(keys[i])
        if len(result) == k:
            break
    return result


def xquad(ranking, scores, aspect_scores, keys, k=8, lambda_=.3):
    """Explicit aspect coverage product, NOT pairwise dissimilarity MMR."""
    import numpy as np
    remaining = list(ranking[:64])
    selected, seen = [], set()
    novelty = np.ones(aspect_scores.shape[1])
    rel = scores / max(float(scores.max()), 1e-12)
    while remaining and len(selected) < k:
        best = max(remaining, key=lambda i: ((1-lambda_) * rel[i] + lambda_ *
            float((aspect_scores[i] * novelty).mean()), -i))
        remaining.remove(best)
        if keys[best] in seen:
            continue
        selected.append(best)
        seen.add(keys[best])
        novelty *= 1 - aspect_scores[best]
    return selected


def ecir2010_mass(ranking, scores, aspect_scores, keys, k=8, omega=.3):
    """ECIR 2010 Algorithm 1 selection formula; proxy relevance, mass prior 1.

    rel(d,q) * (sum_i importance_i * rel(d,q_i)/mass_i)**omega.
    Mass is incremented by each selected document's relevance per aspect.
    Deterministic clause aspects/cosines are our adaptation, not paper mining.
    """
    import numpy as np
    remaining = list(ranking[:64])
    mass = np.ones(aspect_scores.shape[1])
    selected, seen = [], set()
    while remaining and len(selected) < k:
        best = max(remaining,key=lambda i:(scores[i] *
            float((aspect_scores[i]/mass).mean())**omega,-i))
        remaining.remove(best)
        if keys[best] in seen:
            continue
        selected.append(best); seen.add(keys[best])
        mass += aspect_scores[best]
    return selected


def read_fields(tools, catalog):
    """Read only explicit catalog and plugin.json capability/example fields."""
    by_dir = {row['dir']: row for row in catalog['skills']}
    documents, origins, coverage = [], [], Counter()
    for node in tools:
        meta = node.metadata or {}
        name = meta.get('skill_name', meta.get('mcp_original_name', node.name))
        original = meta.get('retrieval_original_description', node.description)
        doc = {'name': name, 'capability': original, 'examples': '', 'generated': ''}
        examples = []
        path = Path(meta.get('skill_path') or '.')
        row = by_dir.get(path.parent.name)
        if row and not meta.get('module_id'):
            doc['capability'] = str(row.get('description') or '')
            doc['generated'] = ' '.join(str(row.get(f) or '') for f in
                ('problem_cn', 'when_cn', 'c1', 'c2', 'key', 'traits_cn', 'diff_cn'))
            coverage['originalCatalogDescriptions'] += 1
        package = meta.get('package_root')
        if package:
            manifest = Path(package) / '.codebuddy-plugin/plugin.json'
            if manifest.is_file():
                data = json.loads(manifest.read_text())
                def strings(obj):
                    if isinstance(obj, str):
                        return [obj]
                    if isinstance(obj, dict):
                        return [s for v in obj.values() for s in strings(v)]
                    if isinstance(obj, list):
                        return [s for v in obj for s in strings(v)]
                    return []
                # Never open env, auth, settings, or endpoints.
                examples = list(dict.fromkeys(strings(data.get('quickPrompts', [])) +
                                              strings(data.get('defaultInitPrompt', {}))))
                description = list(dict.fromkeys(strings(data.get('description', '')) +
                                                strings(data.get('displayDescription', {}))))
                if description and meta.get('kind') != 'mcp-service':
                    doc['capability'] = ' '.join(description)
                coverage['manifestsRead'] += 1
        # For MCPs the own discovered capability is authoritative, not the
        # containing plugin description. Descriptions/examples stay separate.
        doc['examples'] = ' '.join(examples)
        documents.append(doc)
        origins.append(examples)
    return documents, origins, dict(coverage)


@contextmanager
def patch(obj, name, replacement):
    original = getattr(obj, name)
    setattr(obj, name, replacement)
    try:
        yield original
    finally:
        setattr(obj, name, original)


class MechanismTests(unittest.TestCase):
    def test_punctuation(self):
        self.assertEqual(clean_tokens('代码，质量。CI/UI'), ['代码', '质量', 'ci', 'ui'])

    def test_bm25f_saturates_after_fields(self):
        import numpy as np
        index = BM25F([{'a': 'term', 'b': 'term'}, {'a': '', 'b': ''}],
                      config={'a': (2., 0.), 'b': (1., 0.)}, k1=1.5)
        expected = math.log(2.) * 2.5 * 3 / 4.5
        self.assertTrue(np.isclose(index.score('term')[0], expected))

    def test_exact_dedup_does_not_reward_unrelatedness(self):
        self.assertEqual(dedup([0, 1, 2, 3], ['a', 'a', 'b', 'c'], 2), [0, 2])

    def test_empty_and_zero_budget(self):
        self.assertEqual(dedup([0], ['a'], 0), [])
        self.assertEqual(list(BM25F([]).score('anything')), [])
        self.assertEqual(list(BM25F([{'name':'example'}]).score('，。！？')), [0.])

    def test_bm25f_symmetric_punctuation(self):
        import numpy as np
        first = BM25F([{'capability':'代码，质量。'}, {'capability':'性能 测试'}])
        second = BM25F([{'capability':'代码 质量'}, {'capability':'性能，测试。'}])
        self.assertTrue(np.allclose(first.score('代码，质量。'),second.score('代码 质量')))

    def test_xquad_covers_aspect(self):
        import numpy as np
        keys = ['a', 'b', 'c']
        result = xquad([0, 1, 2], np.array([1., .99, .98]),
                        np.array([[1., 0.], [1., 0.], [0., 1.]]), keys, k=2)
        self.assertEqual(result, [0, 2])

    def test_ecir_mass_formula(self):
        import numpy as np
        # Equal relevance: after selecting a, new aspect c beats duplicate b.
        self.assertEqual(ecir2010_mass([0,1,2],np.ones(3),
            np.array([[1.,0.],[1.,0.],[0.,1.]]),['a','b','c'],k=2),[0,2])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--report', type=Path, default=ROOT / '.reports/routing-mechanisms.json')
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--batch-size', type=int, default=64)
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(MechanismTests)
        raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
    import numpy as np
    global_root = Path.home() / '.codex'
    indexer_path = global_root / 'hooks/graph_skill_index.py'
    graph_path = global_root / 'skill-registry/skills.graph.json'
    catalog_path = global_root / 'tools/skills/_catalog_cn.json'
    files = [ROOT / f'scripts/resource-retrieval-{s}.json' for s in ('holdout','validation','unseen')]
    files += [ROOT / 'scripts/resource-expert-routing-challenge.json',
              ROOT / 'scripts/resource-routing-mechanism-challenge.json']
    frozen = {str(p): digest(p) for p in [graph_path, indexer_path, catalog_path, *files]}
    tasks = []
    for file in files:
        for case in json.loads(file.read_text())['cases']:
            kind = case.get('kind') or {'expert-required':'expert','bounded-skill':'skill',
                'bounded-tool':'mcp-service'}[case['split']]
            for lang in ('en', 'zh'):
                tasks.append({'set':file.name, 'case':case['id'], 'kind':kind,
                    'language':lang, 'query':case[lang], 'targets':case['targets']})
    if args.limit:
        tasks = tasks[:args.limit]
    spec = importlib.util.spec_from_file_location('mechanism_indexer', indexer_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    started = time.perf_counter()
    worker = module._GraphWorker(graph_path)
    worker._load_if_stale()
    startup = time.perf_counter() - started
    channels = {'en': worker._english_graph, 'zh':worker._graph}
    names = sorted(worker._graph.tools)
    positions = {name:i for i,name in enumerate(names)}
    nodes = [worker._graph.tools[name] for name in names]
    docs, examples, coverage = read_fields(nodes, json.loads(catalog_path.read_text()))
    identities = [{'id':name, 'name':node.metadata.get('skill_name',node.metadata.get('mcp_original_name',name)),
        'kind':node.metadata.get('kind','skill')} for name,node in zip(names,nodes)]
    keys = [(row['kind'], row['name'].casefold(), ' '.join(clean_tokens(doc['capability'])))
            for row,doc in zip(identities,docs)]
    before_index = time.perf_counter()
    lexical = BM25F(docs)
    field_index_seconds = time.perf_counter() - before_index
    engine = channels['zh']._get_retrieval_engine()
    provider = engine._embedding_index._provider
    dense = normalized([provider._precomputed[n.description] for n in nodes])
    model = provider._provider._get_model()
    query_texts = list(dict.fromkeys([t['query'] for t in tasks] +
                                   [c for t in tasks for c in clauses(t['query'])]))
    before_encode = time.perf_counter()
    qmatrix = model.encode(query_texts, batch_size=args.batch_size, show_progress_bar=False,
                           convert_to_numpy=True, normalize_embeddings=True)
    query_vectors = dict(zip(query_texts, qmatrix))
    query_batch_seconds = time.perf_counter() - before_encode
    unique_examples = list(dict.fromkeys(s for rows in examples for s in rows))
    overlaps = sorted(set(unique_examples) & {t['query'] for t in tasks})
    if overlaps:
        raise ValueError('Exact evaluation/example overlap; do not score contaminated prototypes')
    before_encode = time.perf_counter()
    vectors = model.encode(unique_examples, batch_size=args.batch_size, show_progress_bar=False,
                           convert_to_numpy=True, normalize_embeddings=True) if unique_examples else []
    example_vectors = dict(zip(unique_examples, vectors))
    prototypes = dense.copy()
    for i, texts in enumerate(examples):
        if texts:
            prototypes[i] = normalized([np.mean([example_vectors[t] for t in texts], axis=0)])[0]
    prototype_seconds = time.perf_counter() - before_encode
    print(json.dumps({'phase':'prepared', 'nodes':len(nodes), 'queries':len(tasks),
        'startupSeconds':startup, 'bm25fIndexSeconds':field_index_seconds,
        'prototypeNodes':sum(bool(x) for x in examples), 'exampleTexts':len(unique_examples),
        'prototypeSeconds':prototype_seconds}),flush=True)
    rows = []
    for number, task in enumerate(tasks):
        eng = channels[task['language']]._get_retrieval_engine()
        query = task['query']
        observations = {}
        original_post = eng._post_process
        def capture(candidates, query, scores, top_k):
            observations['pre'] = [positions[r.tool.name] for r in candidates]
            return original_post(candidates,query,scores,top_k)
        # Query is warm for every pipeline variant; no false cold/warm speedup.
        eng._embedding_index.encode(query)
        def run_pipeline():
            return [positions[r.tool.name] for r in eng.retrieve_with_scores(query,top_k=8,max_graph_depth=2)]
        methods, times = {}, {}
        def timed(name, fn):
            began = time.perf_counter()
            methods[name] = list(fn())
            times[name] = (time.perf_counter()-began)*1000
        with patch(eng,'_post_process',capture):
            timed('worker',run_pipeline)
        methods['no_mmr'] = observations['pre'][:8]
        methods['exact_dedup'] = dedup(observations['pre'],keys)
        with patch(eng,'_preserve_dominant_keyword_candidates',lambda *a,**kw:None):
            timed('no_keyword_preservation',run_pipeline)
        bm25 = eng._get_bm25()
        original_tokenizer = bm25._tokenize_fn
        filtered_tokenizer = lambda text:[t for t in original_tokenizer(text) if any(c.isalnum() for c in t)]
        with patch(bm25,'_tokenize_fn',filtered_tokenizer):
            timed('punctuation_query_only',run_pipeline)
            with patch(eng,'_preserve_dominant_keyword_candidates',lambda *a,**kw:None):
                def duplicate_only(candidates,query,scores,top_k):
                    return [candidates[[r.tool.name for r in candidates].index(names[i])]
                            for i in dedup([positions[r.tool.name] for r in candidates],keys,top_k)]
                with patch(eng,'_post_process',duplicate_only):
                    timed('bounded_combined',run_pipeline)
        vector = query_vectors[query]
        # Online encoding measured separately: uncached CPU model, no LLM/API.
        began = time.perf_counter()
        model.encode([query],show_progress_bar=False,normalize_embeddings=True)
        encode_ms = (time.perf_counter()-began)*1000
        began = time.perf_counter()
        lexical_values = lexical.score(query)
        lexrank = order(lexical_values,True)
        lexical_ms = (time.perf_counter()-began)*1000
        methods['bm25f'] = list(lexrank[:8]); times['bm25f'] = lexical_ms
        began = time.perf_counter()
        semantic = dense @ vector
        dense_rank = order(semantic)
        dense_ms = (time.perf_counter()-began)*1000
        methods['description_multilingual'] = list(dense_rank[:8])
        times['description_multilingual'] = encode_ms+dense_ms
        began = time.perf_counter()
        fused = fused_scores([lexrank,dense_rank],len(nodes))
        fused_rank = order(fused,True)
        methods['bm25f_dense'] = dedup(fused_rank,keys)
        fusion_ms = (time.perf_counter()-began)*1000
        times['bm25f_dense'] = encode_ms+lexical_ms+dense_ms+fusion_ms
        began = time.perf_counter()
        aspect_vectors = normalized([query_vectors[c] for c in clauses(query)])
        aspects = np.clip(dense @ aspect_vectors.T,0,1)
        methods['clause_xquad'] = xquad(fused_rank,fused,aspects,keys)
        times['clause_xquad'] = times['bm25f_dense']+(time.perf_counter()-began)*1000
        # Clause encoding batch cost is reported separately, excluded here.
        began = time.perf_counter()
        usage_rank = order(prototypes @ vector)
        methods['usage_prototypes'] = list(usage_rank[:8])
        usage_ms = (time.perf_counter()-began)*1000
        times['usage_prototypes'] = encode_ms+usage_ms
        began = time.perf_counter()
        usage_fused = fused_scores([lexrank,usage_rank],len(nodes))
        methods['bm25f_usage'] = dedup(order(usage_fused,True),keys)
        times['bm25f_usage'] = encode_ms+lexical_ms+usage_ms+(time.perf_counter()-began)*1000
        for method,ranking in methods.items():
            returned = [identities[int(i)] for i in ranking[:8]]
            rank = next((i+1 for i,row in enumerate(returned) if row['kind']==task['kind'] and row['name'] in task['targets']),None)
            # Serialized descriptor bytes are an observable context proxy,
            # NOT the chosen model's tokenizer or actually billed tokens.
            chars = sum(len(identities[int(i)]['name'])+len(nodes[int(i)].description) for i in ranking[:4])
            pool_hit = any(identities[int(i)]['kind']==task['kind'] and identities[int(i)]['name'] in task['targets'] for i in fused_rank[:64])
            rows.append({**task,'method':method,'rank':rank,'ms':times.get(method),
                'contextChars':chars,'returned':returned,'hybridPoolHit64':pool_hit,
                'encodeMs':encode_ms,'aspectCount':len(aspect_vectors)})
        if (number+1)%10==0:
            print(json.dumps({'phase':'queries','completed':number+1,'total':len(tasks)}),flush=True)
    summaries = []
    for method in sorted({r['method'] for r in rows}):
        for dataset in ['all',*[f.name for f in files]]:
            subset = [r for r in rows if r['method']==method and (dataset=='all' or r['set']==dataset)]
            if not subset:continue
            times_ = sorted(r['ms'] for r in subset if r['ms'] is not None)
            summaries.append({'method':method,'set':dataset,'n':len(subset),
                'hit4':sum(r['rank'] is not None and r['rank']<=4 for r in subset),
                'hit8':sum(r['rank'] is not None for r in subset),
                'mrr8':sum(1/r['rank'] if r['rank'] else 0 for r in subset)/len(subset),
                'medianMs':statistics.median(times_) if times_ else None,
                'p95Ms':times_[math.ceil(.95*len(times_))-1] if times_ else None,
                'medianContextChars':statistics.median(r['contextChars'] for r in subset)})
    unchanged = all(digest(Path(p))==sha for p,sha in frozen.items())
    report = {'schemaVersion':'routing-mechanisms/1','frozenSha256':frozen,
        'productionFilesUnchanged':unchanged,'nodes':len(nodes),'fieldConfig':FIELD_CONFIG,
        'coverage':coverage,'prototypeNodes':sum(bool(x) for x in examples),
        'uniqueExampleTexts':len(unique_examples),'exactExampleQueryOverlap':overlaps,
        'startupSeconds':startup,'fieldIndexSeconds':field_index_seconds,
        'prototypePreparationSeconds':prototype_seconds,'queryBatchEncodingSeconds':query_batch_seconds,
        'paidCalls':0,'rows':rows,'summary':summaries,
        'limitations':['Identity Hit@K is not task success or semantic accuracy; target alternatives incomplete.',
            'Old 94 prompts are diagnostic; new author-created challenges are not an independent benchmark.',
            'No trained ToolRefiner, trained Tool2Vec E5, or trained single/multi classifier is reproduced.',
            'Clause xQuAD uses uncalibrated cosine proxies; its extra clause encoding is excluded from ms.',
            'Pipeline timings are warm query-vector timings; standalone timings add measured uncached encoding.',
            'One pass; pre-MMR/dedup share a captured run and have no independent latency measurement.',
            'Context characters are descriptor proxies, not actual hook tokens or billed model usage.',
            'Prototype examples are pre-existing; semantic overlap beyond exact matching is possible.']}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    assert unchanged, 'Inputs changed during experiment; invalidate this result'
    print(json.dumps({'report':str(args.report),'summary':[s for s in summaries if s['set']=='all']}),flush=True)


if __name__ == '__main__':
    main()
