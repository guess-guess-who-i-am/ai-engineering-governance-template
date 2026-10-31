#!/usr/bin/env python3
"""Rerank a frozen expert pool with Qwen's official yes/no protocol on MLX.

Original packages, production graph and labels are never inputs to mutation.
The full role is an optional document view, never a renamed or split expert.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model', type=Path, required=True)
    p.add_argument('--run', type=Path, required=True)
    p.add_argument('--documents', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--depth', type=int, default=16)
    p.add_argument('--max-length', type=int, default=512)
    p.add_argument('--batch-size', type=int, default=4)
    a = p.parse_args()
    if min(a.depth, a.batch_size) < 1:
        p.error('depth and batch size must be positive')
    import mlx.core as mx
    import numpy as np
    from mlx_lm import load
    from transformers import AutoTokenizer
    model, _ = load(str(a.model))
    tokenizer = AutoTokenizer.from_pretrained(str(a.model), local_files_only=True)
    token_ids = [tokenizer.convert_tokens_to_ids(t) for t in ('no', 'yes')]
    assert all(isinstance(i, int) and i >= 0 for i in token_ids)
    prefix = tokenizer.encode('<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n', add_special_tokens=False)
    suffix = tokenizer.encode('<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n', add_special_tokens=False)
    instruction = ('Given a user task, retrieve an expert whose original role explicitly '
        'supports performing the requested work in the requested domain. Shared '
        'incidental words alone do not establish that the expert can perform the task.')
    budget = a.max_length - len(prefix) - len(suffix)
    if budget <= 0:
        p.error('max length cannot hold the official template')

    def tokens(query, doc):
        body = f'<Instruct>: {instruction}\n<Query>: {query}\n<Document>: {doc}'
        return prefix + tokenizer.encode(body, add_special_tokens=False)[:budget] + suffix

    def logits(sequences):
        width = max(map(len, sequences))
        ids = mx.array([s + [tokenizer.pad_token_id] * (width-len(s)) for s in sequences])
        hidden = model.model(ids)
        last = hidden[mx.arange(len(sequences)), mx.array([len(s)-1 for s in sequences]), :]
        # Only the true final position is needed. Right padding is causally
        # after it, so neither the answer suffix nor any real token is masked.
        values = (model.model.embed_tokens.as_linear(last) if model.model.args.tie_word_embeddings
                  else model.lm_head(last))[:, token_ids].astype(mx.float32)
        mx.eval(values)
        return np.array(values)

    probe = tokens('Optimize PostgreSQL queries', 'Database query plans and indexes')
    compact = logits([probe])[0]
    reference = model(mx.array([probe]))[0, -1, token_ids].astype(mx.float32)
    mx.eval(reference)
    projection_error = float(np.max(np.abs(compact-np.array(reference))))
    assert projection_error < .01, ('Final-position projection disagrees with model', projection_error)
    short = tokens('Find papers', 'Monitor recent arXiv papers')
    mixed = logits([probe, short])
    separate = np.concatenate([logits([probe]), logits([short])])
    padding_error = float(np.max(np.abs(mixed-separate)))
    assert padding_error < .1, ('Padding changed yes/no logits', padding_error)
    source_bytes = a.run.read_bytes()
    doc_bytes = a.documents.read_bytes()
    source = json.loads(source_bytes)
    documents = {d['name']: d['description'] for d in json.loads(doc_bytes)}
    rows = []
    for case in source['rows']:
        candidates = case['returned'][:a.depth]
        query = case['query']
        sequences = [tokens(query, documents[d['id']]) for d in candidates]
        start = time.perf_counter()
        output = np.concatenate([logits(sequences[i:i+a.batch_size])
                                 for i in range(0, len(sequences), a.batch_size)])
        # Official two-token softmax, evaluated stably; not a calibrated
        # probability of successful expert execution.
        scores = np.exp(output[:, 1]-np.logaddexp(output[:, 0], output[:, 1]))
        ordered = sorted(zip(candidates, map(float, scores)), key=lambda r: (-r[1], r[0]['id']))
        row = {'case': case['case'], 'query': query, 'candidates': len(candidates),
            'ms': (time.perf_counter()-start)*1000,
            'returned': [{'id': d['id'], 'name': d['name'], 'score': score,
                          'recallScore': d['score']} for d, score in ordered]}
        rows.append(row)
        assert a.run.read_bytes() == source_bytes and a.documents.read_bytes() == doc_bytes
        a.report.write_text(json.dumps({'schema': 'expert-mlx-rerank/v1',
            'model': str(a.model), 'runSha256': hashlib.sha256(source_bytes).hexdigest(),
            'documentsSha256': hashlib.sha256(doc_bytes).hexdigest(),
            'depth': a.depth, 'maxLength': a.max_length, 'batchSize': a.batch_size,
            'instruction': instruction, 'projectionMaxError': projection_error,
            'paddingLogitsMaxError': padding_error,
            'medianQueryMs': statistics.median(r['ms'] for r in rows),
            'peakMetalBytes': mx.get_peak_memory(), 'rows': rows,
            'productionChanged': False, 'paidCalls': 0,
            'limitations': ['Frozen directed cases; not an independent accuracy benchmark.',
                'Cannot recover experts outside the frozen first-stage pool.',
                'Scores are relevance scores, not execution success probabilities.',
                'Quantized community conversion; original expert packages are unchanged.']},
            ensure_ascii=False, indent=2)+'\n')
        print(json.dumps({'case': row['case'], 'ms': row['ms'],
            'top': [(d['name'], round(d['score'], 4)) for d in row['returned'][:4]]}), flush=True)


if __name__ == '__main__':
    main()
