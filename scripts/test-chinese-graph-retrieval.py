#!/usr/bin/env python3
"""Frozen paired queries; evaluate target-skill recall, NOT task success accuracy.

Uses one isolated graph; resets the engine between ablations. No shared worker
mutation. Translation text never comes from queries at request time.
"""
import argparse
from collections import Counter
import importlib.util
import json
import os
from pathlib import Path
import statistics
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('retrieval_indexer', ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)

CASES = [
    ('systematic-debugging', 'Investigate a software test failure by tracing information flow to its first divergence. Verify root-cause hypotheses before code changes.', '分析软件测试失败，沿信息流找首次偏离，先验证根因假设再改代码。'),
    ('method-engineering-execution', 'Implement a code change after inspecting the project and tests, then run focused verification.', '先检查项目和测试，再实现代码变更并运行针对性验证。'),
    ('method-evaluation-gates', 'Define falsifiable quality, token-cost, and latency gates to compare two implementations.', '为两种实现制定可证伪的质量、token成本和时延门槛。'),
    ('method-research-evidence', 'Research papers and verify original methods and implementations rather than trusting reported results.', '研究论文并核实原始方法和实现，不轻信自报结果。'),
    ('fix-regression-with-tdd', 'Reproduce a regression, add a failing test first, apply the smallest fix, and rerun.', '复现回归问题，先写失败测试，再做最小修复并重跑。'),
    ('evolve-contracts', 'Change an HTTP API schema and verify producer, consumer, and failure semantics together.', '修改HTTP接口schema，并一起验证生产者、消费者和失败语义。'),
    ('verify-before-completion', 'Validate a cross-module change through real user paths and report remaining gaps.', '按真实用户路径验证跨模块改动并报告剩余缺口。'),
    ('review-project-diff', 'Review a branch diff for behavioral defects and missing tests without implementing fixes.', '审查分支diff中的行为缺陷和缺失测试，不直接修复。'),
    ('manage-global-methodology', 'Change global methodology: revise an always-on reminder and update its Skill trigger.', '修改全局方法：更新一条常驻提醒并同步对应Skill的触发条件。'),
    ('model-project-domain', 'Map core business concepts, state transitions, invariants, consumers and ownership; resolve conflicting terminology.', '梳理业务概念、状态迁移、不变量、消费者与责任归属，解决术语冲突。'),
    ('clarify-before-build', 'Before building a new product, clarify its audience, scope, constraints and evidence of success.', '构建新产品之前，先澄清用户、范围、约束和成功证据。'),
    ('review-governance-framework', 'Audit the agent governance template for duplicate instructions, routing gaps and unenforced rules.', '审计Agent治理模板中的重复指令、路由缺口和无法机械执行的规则。'),
]

HOLDOUT = [
    ('systematic-debugging', 'A service intermittently hangs. Find the earliest bad state and test competing explanations before repairing it.', '服务偶尔卡住，先定位最早的异常状态，再逐个排除原因，查清之后才动手修。'),
    ('method-engineering-execution', 'Select and integrate a dependency into existing software after examining its real consumers.', '要在现有软件里选择并接入一个依赖，先看真实调用方，再完成实现。'),
    ('method-evaluation-gates', 'Choose justified acceptance thresholds for accuracy, cost and response time; make success falsifiable.', '这次比较要看正确率、花费和响应时间，验收数值要有依据，也要能证伪。'),
    ('method-research-evidence', 'Choose a defensible baseline from original publications and reproduce the released implementation.', '从原始论文选择可靠基线，并复跑作者公开实现，核对结论是否可信。'),
    ('fix-regression-with-tdd', 'A previously working parser broke after an upgrade. Demonstrate the failure in a test before the minimal repair.', '解析器升级前一直正常，升级后坏了；先让测试稳定重现，再做最小修改。'),
    ('evolve-contracts', 'Version a shared event payload while keeping publishers, subscribers and error behavior consistent.', '给共享事件消息换版本，发布方、订阅方和异常处理必须一起验证。'),
    ('verify-before-completion', 'Before announcing a multi-component delivery, prove the user journey works and identify untested boundaries.', '几个组件都改完了，宣布交付之前要从用户入口走通，明确还有哪些地方没有验证。'),
    ('review-project-diff', 'Inspect proposed patch behavior and test omissions; provide findings only.', '只检查这份补丁有没有行为错误、漏测的情况，给出审查意见，不要直接改。'),
    ('manage-global-methodology', 'Publish a revision of a global routed instruction and its reminder.', '我要调整全局路由规则和提醒，再把新的方法论发布出去。'),
    ('model-project-domain', 'Resolve contradictory business terms and define who owns each state transition and invariant.', '业务里同一个词有两种解释，先统一概念，再明确状态变化由谁负责、哪些条件始终成立。'),
    ('clarify-before-build', 'We have a vague new product idea; establish who it serves, what is excluded and how acceptance is proved.', '准备做一个新产品但想法很模糊，先弄清给谁用、哪些不做、凭什么算成功。'),
    ('review-governance-framework', 'Check instructions, hooks, skill routing and CI for duplicate policies and gaps in enforcement.', '把指令、钩子、技能路由和持续集成整体审一遍，找重复要求和没有落地的约束。'),
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--graph', default=str(Path.home() / '.codex/skill-registry/skills.graph.json'))
    p.add_argument('--output', default=str(ROOT / '.reports/chinese-retrieval.json'))
    p.add_argument('--holdout', action='store_true')
    p.add_argument('--variants', nargs='+', default=['baseline', 'cjk', 'bilingual', 'bilingual-cjk', 'bilingual-cjk-no-prefilter'])
    args = p.parse_args()
    worker = indexer._GraphWorker(Path(args.graph))
    graph = worker._load_if_stale()
    embedding_index = graph._get_retrieval_engine()._embedding_index
    source_engine = graph._get_retrieval_engine()
    weights = dict(keyword=source_engine._keyword_weight, graph=source_engine._graph_weight,
                   embedding=source_engine._embedding_weight, annotation=source_engine._annotation_weight)
    assert embedding_index is not None, 'Ablations require the same production embedding index'
    descriptions = {name: tool.description for name, tool in graph.tools.items()}
    translations = json.loads((ROOT / 'codex-profile/mac/hooks/skill-retrieval.zh.json').read_text())['descriptions']
    # The baseline is the production-equivalent retrieval pipeline, without the
    # candidate language change under test; no mutable weight carry-over.
    report = {'schema': 'chinese-retrieval-ablation/1', 'tools': len(graph.tools),
              'split': 'additional frozen paraphrases' if args.holdout else 'development',
              'limitations': ['small hand-labeled set; not an independent public benchmark', 'target identity recall, not general relevance or end-to-end accuracy', 'existing embedding vectors held fixed across ablations; do not compare cold/warm latency as speedup'], 'variants': {}}
    for variant in args.variants:
        english_graph = None
        for name, tool in graph.tools.items():
            tool.description = descriptions[name]
            skill = (tool.metadata or {}).get('skill_name')
            if 'bilingual' in variant and skill in translations:
                tool.description += '\n' + translations[skill]
        graph._retrieval = None
        graph._tokenizer = None
        graph.tune_for_scale()
        engine = graph._get_retrieval_engine()
        engine.set_embedding_index(embedding_index)
        engine.set_weights(**weights)
        if '-routed' in variant:
            # Restore the exact original descriptions in a separate graph view.
            for name, tool in graph.tools.items():
                tool.metadata['retrieval_original_description'] = descriptions[name]
            english_graph = indexer.english_retrieval_graph(graph)
        if 'cjk' in variant:
            graph.set_tokenizer(indexer.chinese_tokenize)
            engine._tokenize = indexer.chinese_tokenize
        if variant.endswith('no-prefilter'):
            engine.enable_prefilter(False)
        indexer._prepare_keyword_index(engine)
        if variant.endswith('bounded'):
            indexer.prepare_chinese_retrieval(engine)
        rows = []
        for target, en, zh in (HOLDOUT if args.holdout else CASES):
            for language, query in [('en', en), ('zh', zh)]:
                before = time.perf_counter()
                active = english_graph if english_graph is not None and language == 'en' else graph
                raw = active.retrieve_with_scores(query, top_k=8, max_graph_depth=2)
                elapsed = (time.perf_counter() - before) * 1000
                results = indexer.result_records(raw)
                names = [r['name'] for r in results]
                active_engine = active._get_retrieval_engine()
                keyword = active_engine._compute_keyword_scores(query, query)
                # Capture actual candidate-pool membership in _run_pipeline.
                from graph_tool_call.retrieval.intent import classify_intent
                intent = classify_intent(query)
                resources = active_engine._searcher.resource_first_search(query, intent=intent, max_results=500, tools=active_engine._tools)
                pool = active_engine._maybe_prefilter(query, intent, keyword, resources or {})
                target_names = [n for n, t in graph.tools.items() if (t.metadata or {}).get('skill_name') == target]
                rows.append({'target': target, 'language': language, 'query': query, 'rank': names.index(target) + 1 if target in names else None,
                             'names': names, 'ms': round(elapsed, 3), 'keywordHitCount': len(keyword), 'poolSize': len(pool) if pool is not None else len(graph.tools),
                             'targetInPool': pool is None or any(n in pool for n in target_names)})
        totals = {}
        for language in ('en', 'zh'):
            selected = [r for r in rows if r['language'] == language]
            totals[language] = {'n': len(selected), 'top1': sum(r['rank'] == 1 for r in selected), 'top4': sum(r['rank'] is not None and r['rank'] <= 4 for r in selected),
                                'top8': sum(r['rank'] is not None for r in selected), 'medianMs': round(statistics.median(r['ms'] for r in selected), 3)}
        report['variants'][variant] = {'summary': totals, 'rows': rows}
        print(variant, json.dumps(totals), flush=True)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
