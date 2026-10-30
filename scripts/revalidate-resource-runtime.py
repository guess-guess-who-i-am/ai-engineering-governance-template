#!/usr/bin/env python3
"""Stage declared runtime helpers only, preserving graph builders and vectors."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import shutil
import time

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_HELPERS = frozenset({'prepare_semantic_candidate_guard', 'prepare_sparse_bm25',
                             'prepare_service_identity_routing', 'prepare_candidate_pool_fusion',
                             'prepare_resource_name_evidence'})


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def normalized_ast(file):
    tree = ast.parse(file.read_text())
    tree.body = [node for node in tree.body if not isinstance(node, ast.FunctionDef)
        or node.name not in RUNTIME_HELPERS]
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == '_GraphWorker':
            for method in node.body:
                if isinstance(method, ast.FunctionDef) and method.name == '_load_if_stale':
                    method.body = [statement for statement in method.body
                        if not (isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call)
                            and isinstance(statement.value.func, ast.Name)
                            and statement.value.func.id in RUNTIME_HELPERS)]
                    # Guard calls are nested in the load-if-stale conditional.
                    for nested in ast.walk(method):
                        if hasattr(nested, 'body') and isinstance(nested.body, list):
                            nested.body = [statement for statement in nested.body
                                if not (isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call)
                                    and isinstance(statement.value.func, ast.Name)
                                    and statement.value.func.id in RUNTIME_HELPERS)]
                    # The sparse helper reuses an engine alias in initialization.
                    # Normalize only this exact, side-effect-equivalent spelling;
                    # any other assignment/use still changes the protected AST.
                    expression = ast.parse('self._english_graph._get_retrieval_engine()', mode='eval').body
                    signature = ast.dump(expression, include_attributes=False)
                    for nested in ast.walk(method):
                        if hasattr(nested, 'body') and isinstance(nested.body, list):
                            nested.body = [statement for statement in nested.body
                                if not (isinstance(statement, ast.Assign) and len(statement.targets) == 1
                                    and isinstance(statement.targets[0], ast.Name) and statement.targets[0].id == 'english_engine'
                                    and ast.dump(statement.value, include_attributes=False) == signature)]
                        if isinstance(nested, ast.Assign) and len(nested.targets) == 1 and isinstance(nested.targets[0], ast.Name) \
                                and nested.targets[0].id == 'english_provider' and isinstance(nested.value, ast.Attribute) \
                                and nested.value.attr == '_embedding_index' and isinstance(nested.value.value, ast.Name) \
                                and nested.value.value.id == 'english_engine':
                            nested.value.value = ast.parse('self._english_graph._get_retrieval_engine()', mode='eval').body
    return hashlib.sha256(ast.dump(tree, include_attributes=False).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    stage = args.stage.resolve()
    if stage == (Path.home() / '.codex/skill-registry').resolve():
        parser.error('Production registry refused')
    original_report = stage / 'build-report.json'
    base = json.loads(original_report.read_text())
    staged = stage / 'hooks/graph_skill_index.py'
    source = ROOT / 'codex-profile/mac/hooks/graph_skill_index.py'
    router_source = ROOT / 'codex-profile/.codex/hooks/skill-router.mjs'
    router_staged = stage / 'hooks/skill-router.mjs'
    runtime_report = stage / 'runtime-revalidation.json'
    original_runtime_hash = base['publishFiles'][str(staged)]
    previous = json.loads(runtime_report.read_text()) if runtime_report.is_file() else {}
    if digest(staged) == original_runtime_hash:
        base_ast = normalized_ast(staged)
    elif previous.get('baseBuildReportSha256') == digest(original_report) and \
            previous.get('workerSha256') == digest(staged):
        base_ast = previous['baseAstSha256']
    else:
        raise ValueError('Candidate runtime differs from both original build and recorded revalidation')
    if normalized_ast(source) != base_ast or normalized_ast(staged) != base_ast:
        raise ValueError('Change exceeds declared runtime helpers and worker initialization calls')
    source_key = str(source)
    router_key = str(router_source)
    for file, expected in base['inputsSha256'].items():
        if file not in (source_key, router_key) and digest(Path(file)) != expected:
            raise ValueError(f'Non-runtime input changed since frozen build: {file}')
    for file, expected in base['publishFiles'].items():
        if file not in (str(staged), str(router_staged)) and digest(Path(file)) != expected:
            raise ValueError(f'Graph, vector, manifest or other staged file changed: {file}')
    shutil.copy2(source, staged)
    shutil.copy2(router_source, router_staged)
    report = {'schemaVersion': 'resource-runtime-revalidation/1', 'createdAt': time.time(),
        'baseBuildReportPath': str(original_report), 'baseBuildReportSha256': digest(original_report),
        'baseAstSha256': base_ast, 'runtimeOnlyAstVerified': True,
        'indexerRuntimeOnlyAstVerified': True,
        'runtimeHelpers': sorted(RUNTIME_HELPERS),
        'initializationAliasNormalized': 'english_engine = self._english_graph._get_retrieval_engine(); english_provider = english_engine._embedding_index',
        'graphAndVectorsUnchanged': True, 'workerSha256': digest(staged),
        'routerSha256': digest(router_staged),
        'routerChange': 'Task-action guidance; four recommendations, per-kind audit evidence and complete-module boundaries retained',
        'productionChanged': False,
        'inputsSha256': {**base['inputsSha256'], source_key: digest(source), router_key: digest(router_source)},
        'publishFiles': {**base['publishFiles'], str(staged): digest(staged), str(router_staged): digest(router_staged)},
        'limitations': ['Integrity revalidation only; original build record remains unchanged',
            'Fixture, retrieval and Hook verification must be rerun with this worker version']}
    runtime_report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'workerSha256': report['workerSha256'], 'graphAndVectorsUnchanged': True,
        'runtimeOnlyAstVerified': True, 'productionChanged': False, 'report': str(args.report)}))


if __name__ == '__main__':
    main()
