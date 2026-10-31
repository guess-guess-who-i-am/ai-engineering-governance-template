#!/usr/bin/env python3
"""Evaluate a local tool-trained encoder on complete expert identities.

No graph or production change: source-grounded and current documents are paired.
Use the checkpoint's last-token pooling, not the upstream generic BOS fallback.
"""
import argparse
import json
import os
from pathlib import Path
import resource
import statistics
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['OMP_NUM_THREADS'] = '1'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--documents', type=Path, nargs='+', required=True)
    parser.add_argument('--trace', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--device', choices=['cpu', 'mps'], default='mps')
    parser.add_argument('--batch-size', type=int, default=8)
    args = parser.parse_args()
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(1)
    began = time.perf_counter()
    model = SentenceTransformer(str(args.model), local_files_only=True, device=args.device,
        model_kwargs={'dtype': torch.float16 if args.device == 'mps' else torch.float32,
                      'attn_implementation': 'sdpa'})
    assert model[1].pooling_mode == 'lasttoken', model[1].get_config_dict()
    model.max_seq_length = 8192
    cases = [row for row in json.loads(args.trace.read_text())['rows'] if row['kind'] == 'expert']
    queries = [row['query'] for row in cases]
    q_vectors = model.encode(queries, batch_size=8, normalize_embeddings=True, prompt='', show_progress_bar=False)
    rows = []
    build = []
    for file in args.documents:
        documents = json.loads(file.read_text())
        texts = [doc['description'] for doc in documents]
        ids = [doc['name'] for doc in documents]
        names = [doc['metadata']['skill_name'] for doc in documents]
        lengths = [len(model.tokenizer(text)['input_ids']) for text in texts]
        started = time.perf_counter()
        matrix = model.encode(texts, batch_size=args.batch_size, normalize_embeddings=True, prompt='', show_progress_bar=False)
        build.append({'file': str(file), 'seconds': time.perf_counter()-started,
            'maxTokens': max(lengths), 'truncated': sum(n > model.max_seq_length for n in lengths)})
        for position, case in enumerate(cases):
            scores = matrix @ q_vectors[position]
            order = np.argsort(-scores, kind='stable')
            targets = {item['id'] for item in case['raw']['dense']['targets']}
            rank = next((i+1 for i, p in enumerate(order) if ids[p] in targets), None)
            rows.append({'documents': file.name, 'set': case['set'], 'case': case['case'],
                'language': case['language'], 'rank': rank, 'baselineHit': case['rank'] is not None,
                'returned': [{'id': ids[p], 'name': names[p], 'score': float(scores[p])} for p in order[:5]]})
        print(json.dumps({'documents': file.name, 'hit2': sum(row['rank'] is not None and row['rank'] <= 2
            for row in rows if row['documents'] == file.name), 'n': len(cases), 'build': build[-1]}), flush=True)
    # Separate, warmed single-request measurements; bulk encoding time is not latency.
    timings = []
    for query in queries[:8]:
        model.encode(query, prompt='', normalize_embeddings=True)
        started = time.perf_counter()
        model.encode(query, prompt='', normalize_embeddings=True)
        timings.append((time.perf_counter()-started)*1000)
    report = {'schema': 'expert-tool-encoder/v1', 'model': str(args.model), 'device': args.device,
        'pooling': 'checkpoint-last-token', 'queryPrompt': 'none-as-upstream-is-inst-false',
        'build': build, 'rows': rows, 'wallSeconds': time.perf_counter()-began,
        'warmEncodeMedianMs': statistics.median(timings),
        'peakRssMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024*1024),
        'productionChanged': False,
        'limitations': ['Expert-only dense diagnostic, not graph fusion or final task success.',
            'MPS single-process timings do not validate multiprocess concurrency.',
            'Targets are investigator-written and may omit valid equivalents.']}
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({key: value for key, value in report.items() if key not in ('rows', 'build')}))


if __name__ == '__main__':
    main()
