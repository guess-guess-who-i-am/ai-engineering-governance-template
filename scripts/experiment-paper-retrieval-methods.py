#!/usr/bin/env python3
"""Offline RM3-style feedback and MaxSim late-interaction retrieval experiment."""
import argparse
from collections import Counter, defaultdict
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['OMP_NUM_THREADS'] = '1'
ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=Path.home() / '.codex/skill-registry/skills.graph.json')
    parser.add_argument('--model', type=Path, required=True, help='Local multilingual sentence-transformer snapshot')
    parser.add_argument('--cases', type=Path, nargs='+', default=[
        ROOT / 'scripts/resource-retrieval-holdout.json',
        ROOT / 'scripts/resource-retrieval-validation.json',
        ROOT / 'scripts/resource-retrieval-unseen.json',
        ROOT / 'scripts/resource-expert-routing-challenge.json'])
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--candidate-depth', type=int, default=64)
    parser.add_argument('--feedback-docs', type=int, default=10)
    parser.add_argument('--feedback-terms', type=int, default=10)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()

    import numpy as np
    import torch
    from transformers import AutoModel, AutoTokenizer
    torch.set_num_threads(1)
    torch.set_grad_enabled(False)
    spec = importlib.util.spec_from_file_location('paper_methods_indexer', ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)

    tasks = []
    for file in args.cases:
        for case in json.loads(file.read_text())['cases']:
            if args.limit and sum(row['set'] == file.name for row in tasks) >= args.limit:
                break
            kind = case.get('kind') or {'expert-required': 'expert', 'bounded-skill': 'skill', 'bounded-tool': 'mcp-service'}[case['split']]
            for language in ('en', 'zh'):
                tasks.append({'set': file.name, 'case': case['id'], 'kind': kind,
                    'language': language, 'query': case[language], 'targets': case['targets']})

    started = time.perf_counter()
    worker = indexer._GraphWorker(args.graph)
    worker._load_if_stale()
    channels = {'en': worker._english_graph, 'zh': worker._graph}
    tools = worker._graph.tools
    ids = sorted(tools)
    metadata = {}
    for name in ids:
        node = tools[name]
        metadata[name] = {'name': node.metadata.get('skill_name', node.metadata.get('mcp_original_name', name)),
                          'kind': node.metadata.get('kind', 'skill')}
    dense_ids = {lang: list(channel._get_retrieval_engine()._embedding_index._embeddings) for lang, channel in channels.items()}
    dense_matrices = {}
    for lang, channel in channels.items():
        engine = channel._get_retrieval_engine()
        matrix = np.asarray([engine._embedding_index._embeddings[name] for name in dense_ids[lang]], dtype=np.float32)
        matrix /= np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
        dense_matrices[lang] = matrix

    # RM3-style query-model interpolation; fixed feedback parameters are not tuned on these cases.
    def raw_bm25(engine, query):
        bm25 = engine._get_bm25()
        terms = bm25._tokenize_fn(query)
        terms = [term for term in terms if term not in bm25._stopwords] or terms
        scores = defaultdict(float)
        for term in terms:
            for name, tf in bm25._tf_maps.items():
                if not tf.get(term):
                    continue
                df = bm25._doc_freqs[term]
                idf = math.log((bm25._n_docs - df + .5) / (df + .5) + 1.0)
                length = bm25._doc_lens[name]
                scores[name] += idf * tf[term] * (bm25._k1 + 1) / (tf[term] + bm25._k1 * (1 - bm25._b + bm25._b * length / bm25._avg_dl))
        return terms, scores

    def rm3_rank(engine, query):
        query_terms, first = raw_bm25(engine, query)
        feedback = sorted(first, key=lambda name: (-first[name], name))[:args.feedback_docs]
        if not feedback:
            return sorted(first, key=lambda name: (-first[name], name))
        peak = max(first[name] for name in feedback)
        posteriors = {name: math.exp(first[name] - peak) for name in feedback}
        total = sum(posteriors.values())
        posteriors = {name: value / total for name, value in posteriors.items()}
        expanded = defaultdict(float)
        bm25 = engine._get_bm25()
        for name in feedback:
            doc_terms = bm25._tf_maps[name]
            length = max(bm25._doc_lens[name], 1)
            for term, frequency in doc_terms.items():
                if term not in query_terms and term not in bm25._stopwords:
                    expanded[term] += posteriors[name] * frequency / length
        additions = sorted(expanded, key=lambda term: (-expanded[term], term))[:args.feedback_terms]
        mass = sum(expanded[term] for term in additions)
        if not mass:
            return sorted(first, key=lambda name: (-first[name], name))
        weights = Counter()
        for term in query_terms:
            weights[term] += .5 / max(len(query_terms), 1)
        for term in additions:
            weights[term] += .5 * expanded[term] / mass
        scores = defaultdict(float)
        for term, weight in weights.items():
            if term not in bm25._doc_freqs:
                continue
            df = bm25._doc_freqs[term]
            idf = math.log((bm25._n_docs - df + .5) / (df + .5) + 1.0)
            for name, tf in bm25._tf_maps.items():
                frequency = tf.get(term, 0)
                if frequency:
                    length = bm25._doc_lens[name]
                    scores[name] += weight * idf * frequency * (bm25._k1 + 1) / (frequency + bm25._k1 * (1 - bm25._b + bm25._b * length / bm25._avg_dl))
        return sorted(scores, key=lambda name: (-scores[name], name))

    # Form a broad candidate pool with the two inexpensive first-stage signals.
    candidate_map = {}
    base_rows = {}
    for task in tasks:
        lang, query = task['language'], task['query']
        engine = channels[lang]._get_retrieval_engine()
        started_bm25 = time.perf_counter()
        query_terms, lexical_scores = raw_bm25(engine, query)
        lexical = sorted(lexical_scores, key=lambda name: (-lexical_scores[name], name))[:args.candidate_depth]
        bm25_ms = (time.perf_counter() - started_bm25) * 1000
        started_rm3 = time.perf_counter()
        rm3 = rm3_rank(engine, query)
        rm3_ms = (time.perf_counter() - started_rm3) * 1000
        started_dense = time.perf_counter()
        vector = np.asarray(engine._embedding_index.encode(query), dtype=np.float32)
        vector /= max(float(np.linalg.norm(vector)), 1e-12)
        semantic_idx = np.argsort(-(dense_matrices[lang] @ vector), kind='stable')[:args.candidate_depth]
        semantic = [dense_ids[lang][int(i)] for i in semantic_idx]
        pool = list(dict.fromkeys(lexical + semantic))
        dense_ms = (time.perf_counter() - started_dense) * 1000
        candidate_map[(task['set'], task['case'], lang)] = pool
        base_rows[(task['set'], task['case'], lang)] = {
            'bm25': lexical, 'rm3': rm3,
            'hybrid': sorted(set(lexical + semantic), key=lambda name: (
                -(sum(1 / (60 + rank) for source in (lexical, semantic) for rank, item in enumerate(source, 1) if item == name)), name)),
            'bm25Ms': bm25_ms, 'rm3Ms': rm3_ms, 'candidateBuildMs': bm25_ms + dense_ms}

    doc_text = {}
    for pool in candidate_map.values():
        for name in pool:
            node = tools[name]
            doc_text[name] = (metadata[name]['name'] + '. ' + node.description[:1200]).strip()

    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    tokenizer = AutoTokenizer.from_pretrained(str(args.model), local_files_only=True)
    model = AutoModel.from_pretrained(str(args.model), local_files_only=True).to(device).eval()
    special_ids = set(tokenizer.all_special_ids)
    encoded = {}
    started_doc_encoding = time.perf_counter()
    texts = list(doc_text.items())
    for start in range(0, len(texts), 32):
        batch = texts[start:start + 32]
        inputs = tokenizer([text for _, text in batch], padding=True, truncation=True, max_length=128,
                           return_tensors='pt', return_special_tokens_mask=True)
        special_mask = inputs.pop('special_tokens_mask')
        inputs = {key: value.to(device) for key, value in inputs.items()}
        outputs = model(**inputs).last_hidden_state
        outputs = torch.nn.functional.normalize(outputs, p=2, dim=-1).cpu().numpy()
        masks = inputs['attention_mask'].cpu().numpy().astype(bool) & ~special_mask.numpy().astype(bool)
        for i, (name, _) in enumerate(batch):
            encoded[name] = outputs[i][masks[i]].astype(np.float32)
    documentEncodingSeconds = time.perf_counter() - started_doc_encoding
    query_cache = {}
    query_encoding_ms = {}
    def query_tokens(query):
        if query not in query_cache:
            started_query = time.perf_counter()
            inputs = tokenizer(query, truncation=True, max_length=64, return_tensors='pt', return_special_tokens_mask=True)
            special_mask = inputs.pop('special_tokens_mask')
            mask = inputs['attention_mask'][0].bool() & ~special_mask[0].bool()
            inputs = {key: value.to(device) for key, value in inputs.items()}
            vector = model(**inputs).last_hidden_state[0].cpu().numpy()[mask.numpy()].astype(np.float32)
            norms = np.linalg.norm(vector, axis=1, keepdims=True)
            query_cache[query] = vector / np.maximum(norms, 1e-12)
            query_encoding_ms[query] = (time.perf_counter() - started_query) * 1000
        return query_cache[query]

    rows = []
    for task in tasks:
        key = (task['set'], task['case'], task['language'])
        pool = candidate_map[key]
        query = query_tokens(task['query'])
        started_rank = time.perf_counter()
        maxsim_scores = {}
        for name in pool:
            doc = encoded[name]
            if len(query) and len(doc):
                maxsim_scores[name] = float((query @ doc.T).max(axis=1).mean())
            else:
                maxsim_scores[name] = 0.0
        maxsim = sorted(pool, key=lambda name: (-maxsim_scores[name], name))
        rank_ms = (time.perf_counter() - started_rank) * 1000
        expected_kind = task['kind']
        def relevant(name):
            return metadata[name]['kind'] == expected_kind and metadata[name]['name'] in task['targets']
        methods = {
            'bm25': base_rows[key]['bm25'],
            'rm3': base_rows[key]['rm3'],
            'hybrid': base_rows[key]['hybrid'],
            'maxsim': maxsim,
        }
        result = {'set': task['set'], 'case': task['case'], 'kind': expected_kind,
                  'language': task['language'], 'targets': task['targets'], 'candidateCount': len(pool),
                  'candidateHit': any(relevant(name) for name in pool),
                  'bm25Ms': round(base_rows[key]['bm25Ms'], 3), 'rm3Ms': round(base_rows[key]['rm3Ms'], 3),
                  'candidateBuildMs': round(base_rows[key]['candidateBuildMs'], 3),
                  'queryEncodeMs': round(query_encoding_ms[task['query']], 3),
                  'maxsimScoreMs': round(rank_ms, 3)}
        for method, ranking in methods.items():
            rank = next((i + 1 for i, name in enumerate(ranking) if relevant(name)), None)
            result[method] = rank
            result[method + 'Top8'] = [metadata[name]['name'] for name in ranking[:8]]
        rows.append(result)

    summary = []
    for file in args.cases:
        subset = [row for row in rows if row['set'] == file.name]
        for method in ('bm25', 'rm3', 'hybrid', 'maxsim'):
            ranks = [row[method] for row in subset]
            summary.append({'set': file.name, 'method': method, 'n': len(subset),
                'top4': sum(rank is not None and rank <= 4 for rank in ranks),
                'top8': sum(rank is not None and rank <= 8 for rank in ranks),
                'candidateRecall': sum(row['candidateHit'] for row in subset),
                'medianMs': round(statistics.median({
                    'bm25': [row['bm25Ms'] for row in subset],
                    'rm3': [row['rm3Ms'] for row in subset],
                    'hybrid': [row['candidateBuildMs'] for row in subset],
                    'maxsim': [row['queryEncodeMs'] + row['maxsimScoreMs'] for row in subset]
                }[method]), 3),
                'medianMaxsimScoreMs': round(statistics.median(row['maxsimScoreMs'] for row in subset), 3)})
    report = {'schemaVersion': 'paper-retrieval-methods-experiment/1',
              'graphSha256': digest(args.graph), 'caseSha256': {str(file): digest(file) for file in args.cases},
              'model': str(args.model), 'device': device, 'candidateDepthPerSource': args.candidate_depth,
              'feedback': {'docs': args.feedback_docs, 'terms': args.feedback_terms, 'originalQueryWeight': .5},
              'candidateTextLimitChars': 1200, 'candidateUnionMax': args.candidate_depth * 2,
              'candidateDocumentsEncoded': len(encoded), 'documentEncodingSeconds': round(documentEncodingSeconds, 3),
              'startupAndPreparationSeconds': round(time.perf_counter() - started, 3),
              'rows': rows, 'summary': summary, 'productionChanged': False, 'paidCalls': 0,
              'limitations': [
                  'RM3 uses fixed RM3-style query-model interpolation over BM25 pseudo-feedback; not a library reproduction.',
                  'MaxSim is ColBERT-style late interaction using an existing multilingual sentence encoder, not ColBERT-trained weights.',
                  'Identity Top-k is a proxy for task success; equivalent resources and downstream execution quality are not scored.',
                  'MaxSim ranking is limited to the union of BM25 and dense top-k candidates; candidateRecall is reported separately.',
                  'One controlled offline run; no production routing or files outside the report were changed.']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(args.report), 'device': device, 'encodedDocs': len(encoded), 'summary': summary}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
