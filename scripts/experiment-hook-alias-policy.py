#!/usr/bin/env python3
"""Replay actual Hook entry concurrently with in-memory policy changes only."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
NODE = Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
HOOK = Path.home()/'.codex/hooks/skill-router.mjs'
HELPER = r'''
function aliasMatch(query, alias) {
  if (!alias) return false;
  if (/^[a-z0-9_. -]+$/i.test(alias)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(query);
  }
  return query.includes(alias.toLocaleLowerCase());
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report',type=Path,default=ROOT/'.reports/hook-alias-policy.json')
    parser.add_argument('--workers',type=int,default=8)
    parser.add_argument('--limit',type=int,default=0)
    args=parser.parse_args()
    source=HOOK.read_text()
    # An interpreter directive must stay at byte zero; eval needs no shebang.
    if source.startswith('#!'):
        source=source.split('\n',1)[1]
    sha=hashlib.sha256(HOOK.read_bytes()).hexdigest()
    assert source.count('query.includes(alias.toLocaleLowerCase())')==1
    assert source.count('.some(alias => query.includes(alias))')==1
    boundary=HELPER+source.replace('query.includes(alias.toLocaleLowerCase())','aliasMatch(query, alias)').replace(
        '.some(alias => query.includes(alias))','.some(alias => aliasMatch(query, alias))')
    explicit=boundary.replace('.some(alias => aliasMatch(query, alias))','.some(() => false)')
    # Both match-positive and substring-negative controls, independently of
    # noisy retrieval labels. Topic mention is NOT necessarily explicit intent.
    controls=[('official','ci',False),('specialists','ci',False),('scientific','ci',False),
        ('decision','ci',False),('specify','ci',False),('distinguish','ui',False),
        ('requirements','ui',False),('acquisition','ui',False),('required','ui',False),
        ('build','ui',False),('run CI checks','ci',True),('fix UI focus','ui',True),
        ('ci: tests','ci',True),('(UI)','ui',True),('civil','ci',False),
        ('beautiful','ui',False),('CI/CD pipeline','ci',True),('组件UI布局','ui',True)]
    test_source=HELPER+'\nconst cases='+json.dumps(controls)+';process.stdout.write(JSON.stringify(cases.map(([q,a,e])=>({q,a,expected:e,actual:aliasMatch(q,a)}))));'
    tested=subprocess.run([str(NODE),'--input-type=module','--eval',test_source],text=True,capture_output=True,check=True)
    tests=json.loads(tested.stdout)
    assert all(t['actual']==t['expected'] for t in tests),tests
    tasks=[]
    for name in ['resource-retrieval-holdout.json','resource-retrieval-validation.json',
                 'resource-retrieval-unseen.json','resource-expert-routing-challenge.json',
                 'resource-routing-mechanism-challenge.json']:
        for case in json.loads((ROOT/'scripts'/name).read_text())['cases']:
            for lang in ['en','zh']:
                tasks.append({'set':name,'case':case['id'],'query':case[lang],
                              'language':lang,'targets':case['targets']})
    if args.limit:tasks=tasks[:args.limit]
    def run(item):
        task,policy,code=item
        before=time.perf_counter()
        result=subprocess.run([str(NODE),'--input-type=module','--eval',code],
            input=json.dumps({'hook_event_name':'UserPromptSubmit','prompt':task['query'],'cwd':str(ROOT)}),
            text=True,capture_output=True,timeout=65)
        if result.returncode:
            raise RuntimeError(f'Hook process failed: {result.returncode} {result.stderr[:2000]}')
        output=json.loads(result.stdout)
        context=output.get('hookSpecificOutput',{}).get('additionalContext','')
        returned=re.findall(r'^- (.+?) \[',context,re.M)
        if result.returncode or not returned or result.stderr:
            raise RuntimeError(f'Hook failed: {result.returncode} {result.stderr} {result.stdout[:150]}')
        return {**task,'policy':policy,'ms':(time.perf_counter()-before)*1000,
                'returned':returned,'rank':next((i+1 for i,n in enumerate(returned) if n in task['targets']),None),
                'contextChars':len(context)}
    began=time.perf_counter()
    jobs=[(task,policy,code) for task in tasks for policy,code in
        [('current',source),('boundary_alias',boundary),('name_only_priority',explicit)]]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows=list(pool.map(run,jobs))
    summary=[]
    for policy in ['current','boundary_alias','name_only_priority']:
        selected=[r for r in rows if r['policy']==policy]
        summary.append({'policy':policy,'n':len(selected),'hit4':sum(r['rank'] is not None for r in selected),
            'top1':dict(__import__('collections').Counter(r['returned'][0] for r in selected).most_common(10))})
    assert hashlib.sha256(HOOK.read_bytes()).hexdigest()==sha
    report={'schemaVersion':'hook-alias-policy/1','hookSha256':sha,'concurrency':args.workers,
        'seconds':time.perf_counter()-began,'controls':tests,'rows':rows,'summary':summary,
        'productionChanged':False,'paidCalls':0,'limitations':[
            'Hook replays use real live worker; shared request coalescing/cache changes wall time.',
            'Identity hits do not establish task success, availability or semantic accuracy.',
            'Boundary controls do not test negation; exact names in forbidden clauses still need handling.',
            'ASCII boundaries deliberately allow adjacent Han; not a universal Unicode-word tokenizer.']}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'report':str(args.report),'summary':summary,'controlsPassed':len(tests),'seconds':report['seconds']}))


if __name__=='__main__':main()
