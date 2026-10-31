#!/usr/bin/env python3
"""Paired, case-clustered evidence; never uses labels to change any ranking."""
from collections import Counter,defaultdict
import hashlib
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]


def hit(row):
    return row['rank'] is not None and row['rank']<=4


def paired(rows,base,method_key,seed=20261025):
    grouped=defaultdict(list);wins=losses=0
    for row in rows:
        key=(row['set'],row['case'],row['language']);old=base[key]
        value=int(hit(row))-int(hit(old))
        wins+=value>0;losses+=value<0
        grouped[row['set'],row['case']].append(value)
    values=np.array([np.mean(g) for g in grouped.values()])
    rng=np.random.default_rng(seed)
    samples=values[rng.integers(0,len(values),size=(10000,len(values)))].mean(axis=1)
    return {'variant':method_key,'n':len(rows),'wins':int(wins),'losses':int(losses),
        'delta':float(values.mean()),'clusterBootstrap95Percentile':np.quantile(samples,[.025,.975]).tolist(),
        'limitations':'Resamples task pairs, not independent languages; exploratory, no multiple-testing correction.'}


def main():
    paths={name:ROOT/f'.reports/{name}.json' for name in
        ['routing-mechanisms','hook-alias-policy','routing-complement','routing-diversity']}
    data={name:json.loads(p.read_text()) for name,p in paths.items()}
    mechanisms=data['routing-mechanisms']['rows'];hook=data['hook-alias-policy']['rows'];ce=data['routing-complement']['rows']
    key=lambda r:(r['set'],r['case'],r['language'])
    base={key(r):r for r in mechanisms if r['method']=='worker'}
    baseline_hook={key(r):r for r in hook if r['policy']=='current'}
    comparisons=[]
    for method in sorted({r['method'] for r in mechanisms}-{'worker'}):
        comparisons.append(paired([r for r in mechanisms if r['method']==method],base,method))
    for variant in sorted({r['variant'] for r in ce}):
        comparisons.append(paired([r for r in ce if r['variant']==variant],base,variant))
    for policy in ['boundary_alias','name_only_priority']:
        comparisons.append(paired([r for r in hook if r['policy']==policy],baseline_hook,'hook/'+policy))
    summary=[]
    for source,rows,field in [('mechanisms',mechanisms,'method'),('hook',hook,'policy'),('crossencoder',ce,'variant')]:
        for variant in sorted({r[field] for r in rows}):
            for split in ['old94','new24']:
                subset=[r for r in rows if r[field]==variant and
                    ((r['set']=='resource-routing-mechanism-challenge.json')==(split=='new24'))]
                summary.append({'source':source,'variant':variant,'split':split,'n':len(subset),'hit4':sum(hit(r) for r in subset)})
    # A union's coverage is an upper bound, not a usable selector. Inspect
    # oracle coverage separately so complementary failures do not get hidden.
    unions={}
    for method in ['usage_prototypes','bm25f_dense','bm25f_usage']:
        bykey={key(r):r for r in mechanisms if r['method']==method}
        unions[method]=sum(any(n['kind']==row['kind'] and n['name'] in row['targets']
            for n in row['returned']+bykey[k]['returned']) for k,row in base.items())
    report={'schemaVersion':'routing-experiment-summary/1',
        'inputsSha256':{name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in paths.items()},
        'comparisons':comparisons,'splitSummary':summary,'unionTop8Plus8TargetCoverage':unions,
        'baselineTop8Coverage':sum(r['rank'] is not None for r in base.values()),
        'productionFilesStillUnchanged':all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==sha
            for p,sha in data['routing-mechanisms']['frozenSha256'].items()),
        'paidCalls':0}
    output=ROOT/'.reports/routing-experiment-summary.json'
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'output':str(output),'unionCoverage':unions,'unchanged':report['productionFilesStillUnchanged']}))


if __name__=='__main__':main()
