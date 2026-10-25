#!/usr/bin/env python3
"""Build an offline full-corpus module candidate without touching production."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
HOOKS = ROOT / 'codex-profile/mac/hooks'


def digest(file):
    result = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex-root', type=Path, default=Path.home() / '.codex')
    parser.add_argument('--stage', type=Path)
    parser.add_argument('--resource-catalog', type=Path)
    parser.add_argument('--owned-root', type=Path, default=Path.home() / '.agents/skills')
    args = parser.parse_args()
    registry = args.codex_root / 'skill-registry'
    stage = args.stage or registry / 'resource-candidate'
    resources = args.resource_catalog or registry / 'resource-modules.json'
    config = json.loads((registry / 'external-library-config.json').read_text())
    source_root = Path(config['root'])
    catalog = Path(config.get('catalog', source_root / '_catalog_cn.json'))
    if not resources.is_file():
        parser.error(f'Publish the resource catalog first: {resources}')
    if stage.resolve() == registry.resolve():
        parser.error('Candidate must not be the production registry directory')
    stage.mkdir(parents=True, exist_ok=True)
    (stage / 'hooks').mkdir(exist_ok=True)
    inputs = [catalog, resources, registry / 'mcp-tools.json', *sorted(args.owned_root.glob('*/SKILL.md'))]
    for name in ('graph_skill_index.py', 'skill-retrieval.zh.json', 'mcp-retrieval.zh.json', 'registry-inputs.mjs', 'refresh-skill-registry.mjs'):
        source = HOOKS / name
        inputs.append(source)
        shutil.copy2(source, stage / 'hooks' / name)
    router = ROOT / 'codex-profile/.codex/hooks/skill-router.mjs'
    inputs.append(router)
    shutil.copy2(router, stage / 'hooks/skill-router.mjs')
    before = {str(file): digest(file) for file in inputs}
    output = stage / 'skills.graph.json'
    command = [sys.executable, str(stage / 'hooks/graph_skill_index.py'), 'build',
        '--root', str(source_root), '--catalog', str(catalog), '--output', str(output),
        '--owned-root', str(args.owned_root), '--mcp-catalog', str(registry / 'mcp-tools.json'),
        '--resource-catalog', str(resources), '--embedding']
    if config.get('chineseEmbedding'):
        command += ['--chinese-embedding', config['chineseEmbedding']]
    env = {**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
        'TOKENIZERS_PARALLELISM': 'false', 'OMP_NUM_THREADS': '4', 'MKL_NUM_THREADS': '4'}
    began = time.perf_counter()
    subprocess.run(command, env=env, check=True)
    after = {str(file): digest(file) for file in inputs}
    if before != after:
        raise RuntimeError('Input changed during candidate build; candidate is not publishable')
    graph = json.loads(output.read_text())
    modules = json.loads(resources.read_text())['modules']
    expected = {module['id'] for module in modules}
    actual = {node.get('metadata', {}).get('module_id') for node in graph['tools'].values()} - {None}
    if actual != expected:
        raise RuntimeError(f'Resource coverage mismatch: missing={len(expected - actual)}, extra={len(actual - expected)}')
    files = [output, output.with_suffix('.manifest.json'), *sorted((stage / 'hooks').iterdir())]
    for field in ('chinese_embedding',):
        if graph['metadata'].get(field):
            files.append(stage / graph['metadata'][field]['file'])
    for sidecar in graph['metadata'].get('description_embeddings', {}).values():
        files.append(stage / sidecar['file'])
    report = {'schemaVersion': 'resource-graph-candidate/1', 'createdAt': time.time(),
        'buildSeconds': round(time.perf_counter() - began, 3), 'productionChanged': False,
        'graphPath': str(output), 'resourceModuleCount': len(expected), 'graphNodeCount': len(graph['tools']),
        'inputsSha256': before, 'publishFiles': {str(file): digest(file) for file in files if file.is_file()},
        'limitations': ['Graph build and coverage only; retrieval evaluation is separate',
            'Package functional readiness is not established by successful indexing']}
    (stage / 'build-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key not in ('inputsSha256', 'publishFiles')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
