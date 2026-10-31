#!/usr/bin/env python3
"""Rerank category-local expert evidence; preserve complete original packages."""
import argparse
import hashlib
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


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--traces', type=Path, nargs='+', required=True)
    ap.add_argument('--descriptions', type=Path, required=True)
    ap.add_argument('--model', type=Path, required=True)
    ap.add_argument('--documents', nargs='+', choices=['graph','role'], default=['graph','role'])
    ap.add_argument('--report', type=Path, required=True)
    args = ap.parse_args()
    from sentence_transformers import CrossEncoder
    import torch
    torch.set_num_threads(1)
    experts = {x['name']:x for x in json.loads(args.descriptions.read_text())}
    roles, unavailable = {}, []
    marker = '## Original primary role — verbatim from this point to EOF'
    for name, expert in experts.items():
        text = Path(expert['metadata']['skill_path']).read_text()
        if marker not in text:
            unavailable.append({'id':name,'name':expert['metadata']['skill_name'],
                                'reason':'Entry contains no original primary role'})
            continue
        roles[name] = text.split(marker, 1)[1].strip()
    model = CrossEncoder(str(args.model), max_length=512, device='cpu', local_files_only=True)
    model.predict([['find relevant documents', 'Retrieve documentation']], show_progress_bar=False)
    rows = []
    for file in args.traces:
        report = json.loads(file.read_text())
        for row in report['rows']:
            if row['mode'] != 'baseline' or row['kind'] != 'expert':continue
            targets = {x['id'] for x in row['raw']['dense']['targets']}
            for depth in (4, 5):
                candidates = sorted({x['id'] for scores in row['raw'].values()
                                     for x in scores['experts'][:depth]})
                for document in args.documents:
                    missing = [name for name in candidates if name not in roles]
                    if document == 'role' and missing:
                        raise ValueError('A rerank candidate lacks an original role: ' + ', '.join(missing))
                    texts = [experts[name]['description'] if document=='graph' else roles[name]
                             for name in candidates]
                    begun = time.perf_counter()
                    scores = model.predict([[row['query'], text] for text in texts],
                                           batch_size=4, show_progress_bar=False)
                    elapsed = (time.perf_counter()-begun)*1000
                    ordered = sorted(zip(candidates,map(float,scores)),key=lambda x:(-x[1],x[0]))
                    rank = next((i+1 for i,(n,_) in enumerate(ordered) if n in targets), None)
                    result = {'set':row['set'],'case':row['case'],'language':row['language'],
                        'depth':depth,'document':document,'ms':elapsed,'poolRecall':bool(targets & set(candidates)),
                        'rank':rank,'baselineRank':row['categoryRank'],
                        'returned':[{'id':n,'name':experts[n]['metadata']['skill_name'],'score':s}
                                    for n,s in ordered]}
                    rows.append(result)
                    print(json.dumps({k:result[k] for k in ('case','language','depth','document','rank','ms')}),flush=True)
    summary=[]
    for file_set in sorted({x['set'] for x in rows}):
        for depth in (4,5):
            for document in args.documents:
                chosen=[x for x in rows if x['set']==file_set and x['depth']==depth and x['document']==document]
                summary.append({'set':file_set,'depth':depth,'document':document,'n':len(chosen),
                    'hits':sum(x['rank'] is not None and x['rank']<=2 for x in chosen),
                    'baselineHits':sum(x['baselineRank'] is not None for x in chosen),
                    'poolRecall':sum(x['poolRecall'] for x in chosen),
                    'medianMs':statistics.median(x['ms'] for x in chosen)})
    output={'schema':'expert-category-crossencoder/v1','model':str(args.model),'rows':rows,'summary':summary,
        'traceSha256':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in args.traces},
        'productionChanged':False,'paidCalls':0,'unavailableRoles':unavailable,
        'limitations':['Identity coverage, not independently graded relevance or completed expert execution.',
                      'Depths are limited by saved trace top-five. Timings are reranking only.']}
    args.report.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
