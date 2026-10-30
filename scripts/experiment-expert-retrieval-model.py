#!/usr/bin/env python3
"""Test a retrieval-trained multilingual encoder against saved expert evidence."""
import argparse
import json
import os
from pathlib import Path
import statistics
import time

for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):os.environ[key]='1'
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--model',type=Path,required=True)
    ap.add_argument('--descriptions',type=Path,required=True)
    ap.add_argument('--traces',type=Path,nargs='+',required=True)
    ap.add_argument('--report',type=Path,required=True)
    args=ap.parse_args()
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(1)
    experts=json.loads(args.descriptions.read_text())
    names=[x['name'] for x in experts]
    identity={x['name']:x['metadata']['skill_name'] for x in experts}
    began=time.perf_counter()
    model=SentenceTransformer(str(args.model),device='cpu',local_files_only=True)
    model.max_seq_length=512
    matrix=model.encode(['passage: '+x['description'] for x in experts],batch_size=16,
        normalize_embeddings=True,show_progress_bar=False)
    build_ms=(time.perf_counter()-began)*1000
    rows=[]
    for file in args.traces:
        trace=json.loads(file.read_text())
        for item in trace['rows']:
            if item['mode']!='baseline' or item['kind']!='expert':continue
            began=time.perf_counter()
            vector=model.encode('query: '+item['query'],normalize_embeddings=True)
            scores=matrix@vector
            order=sorted(range(len(names)),key=lambda i:(-float(scores[i]),names[i]))
            elapsed=(time.perf_counter()-began)*1000
            targets={t['id'] for t in item['raw']['dense']['targets']}
            rank=next((i+1 for i,p in enumerate(order) if names[p] in targets),None)
            old=min((x['expertRank'] for x in item['raw']['dense']['targets'] if x['expertRank']),default=None)
            rows.append({'set':item['set'],'case':item['case'],'language':item['language'],
                'baselineRank':item['categoryRank'],'oldDenseRank':old,'rank':rank,'ms':elapsed,
                'returned':[{'id':names[p],'name':identity[names[p]],'score':float(scores[p])} for p in order[:8]]})
            print(json.dumps({k:rows[-1][k] for k in ('case','language','oldDenseRank','rank','ms')}),flush=True)
    summary=[]
    for file_set in sorted({x['set'] for x in rows}):
        chosen=[x for x in rows if x['set']==file_set]
        summary.append({'set':file_set,'n':len(chosen),'denseTop2':sum(x['rank'] is not None and x['rank']<=2 for x in chosen),
            'oldDenseTop2':sum(x['oldDenseRank'] is not None and x['oldDenseRank']<=2 for x in chosen),
            'denseTop5':sum(x['rank'] is not None and x['rank']<=5 for x in chosen),
            'baselinePipelineTop2':sum(x['baselineRank'] is not None for x in chosen),
            'medianEncodeAndRankMs':statistics.median(x['ms'] for x in chosen)})
    args.report.write_text(json.dumps({'schema':'expert-retrieval-model/v1','model':str(args.model),
        'buildMs':build_ms,'summary':summary,'rows':rows,'productionChanged':False,
        'limitations':['Expert-only dense diagnostic; not the full graph fusion pipeline.',
                      'Observed validation cases are now development data for subsequent model changes.',
                      'Identity recall, not task success or independently graded precision.']},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary))


if __name__=='__main__':main()
