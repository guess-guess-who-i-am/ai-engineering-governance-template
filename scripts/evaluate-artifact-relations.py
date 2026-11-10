#!/usr/bin/env python3
"""Frozen targeted A/B plus existing holdouts; identical text, encoders and budgets."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):
    os.environ[key] = '1'
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('relation_eval_indexer', ROOT/'codex-profile/mac/hooks/graph_skill_index.py')
indexer = importlib.util.module_from_spec(spec);spec.loader.exec_module(indexer)
CASES = [
    ('concept-to-strategy', 'edge-concept-synthesizer', 'edge-strategy-designer'),
    ('schema-to-appendix', 'table-schema', 'appendix-table-writer'),
    ('outline-to-evidence', 'outline-builder', 'claim-evidence-matrix'),
    ('modules-to-slides', 'module-planner', 'beamer-scaffold'),
    ('finance-to-explanation', 'finance-core-analysis', 'finance-beginner-explainer'),
    ('control-to-qa', 'create-control-manifest', 'qa-plan'),
]


def evaluate(path):
    worker = indexer._GraphWorker(path)
    began = time.monotonic();worker._load_if_stale();load_seconds = time.monotonic()-began
    rows = []
    for label, query, partner in CASES:
        began = time.monotonic();results = worker.query({'query': query,'top_k':8})
        names = [r['name'] for r in results]
        rows.append({'id':label,'query':query,'target':partner,'names':names,
                     'partnerRank':names.index(partner)+1 if partner in names else None,
                     'primaryFound':query in names,'seconds':round(time.monotonic()-began,3),
                     'graphScores':{r['name']:r['graph_score'] for r in results},
                     'linkedPartners':[link['name'] for r in results if r['name']==query for link in r.get('artifact_links', [])],
                     'assistedHit':partner in names or any(link['name']==partner for r in results if r['name']==query for link in r.get('artifact_links', []))})
    holdout = json.loads((ROOT/'scripts/resource-retrieval-holdout.json').read_text())['cases']
    general = []
    for case in holdout:
        for language in ('en','zh'):
            results = worker.query({'query':case[language], 'top_k':8,
                                    'category_slots':{'expert':3,'skill':3,'mcp':2}})
            names = [r['name'] for r in results]
            general.append({'id':case['id'],'language':language,'hit':any(t in names for t in case['targets']),
                            'names':names})
    worker.close()
    return {'loadSeconds':round(load_seconds,3),'targeted':rows,'holdout':general}


def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True)
    p.add_argument('--candidate',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    baseline=evaluate(a.baseline);candidate=evaluate(a.candidate)
    regressions=[{'id':b['id'],'language':b['language']} for b,c in zip(baseline['holdout'],candidate['holdout']) if b['hit'] and not c['hit']]
    report={'schemaVersion':'artifact-relations-eval/1','baseline':baseline,'candidate':candidate,
            'baselinePartnerHits':sum(r['partnerRank'] is not None for r in baseline['targeted']),
            'candidatePartnerHits':sum(r['partnerRank'] is not None for r in candidate['targeted']),
            'baselineAssistedHits':sum(r['assistedHit'] for r in baseline['targeted']),
            'candidateAssistedHits':sum(r['assistedHit'] for r in candidate['targeted']),
            'holdoutRegressions':regressions,
            'limitations':['Targeted queries name the producer; measures complementary recommendation, not general task completion.',
                           'One pass per condition; no latency confidence interval or broad accuracy claim.']}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('baseline','candidate')},ensure_ascii=False))
    if regressions: raise SystemExit(1)

if __name__=='__main__':main()
