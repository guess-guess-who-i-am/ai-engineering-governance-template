#!/usr/bin/env python3
"""Stage source scopes only; prove every scored document/vector is unchanged."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time

ROOT = Path(__file__).resolve().parents[1]


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex-root', type=Path, default=Path.home()/'.codex')
    parser.add_argument('--resource-catalog', type=Path, required=True)
    parser.add_argument('--stage', type=Path, required=True)
    args = parser.parse_args()
    registry = args.codex_root/'skill-registry'
    stage = args.stage.resolve()
    if stage == registry.resolve():
        parser.error('Stage must be separate from production')
    stage.mkdir(parents=True, exist_ok=True)
    (stage/'hooks').mkdir(exist_ok=True)
    config = json.loads((registry/'external-library-config.json').read_text())
    catalog = Path(config.get('catalog', str(Path(config['root'])/'_catalog_cn.json')))
    inputs = [catalog, args.resource_catalog, registry/'resource-modules.json', registry/'mcp-tools.json', registry/'skills.graph.json',
        registry/'skills.graph.manifest.json', *sorted((Path.home()/'.agents/skills').glob('*/SKILL.md'))]
    inputs.extend(ROOT/'scripts'/name for name in ['import-resource-modules.mjs', 'expert-entry.mjs',
        'refresh-expert-descriptions.mjs', 'stage-expert-scopes.py'])
    hook_names = ['graph_skill_index.py', 'skill-retrieval.zh.json', 'mcp-retrieval.zh.json',
        'registry-inputs.mjs', 'refresh-skill-registry.mjs']
    for name in hook_names:
        inputs.append(ROOT/'codex-profile/mac/hooks'/name)
    inputs.append(ROOT/'codex-profile/.codex/hooks/skill-router.mjs')
    modules = json.loads(args.resource_catalog.read_text())['modules']
    current = json.loads((registry/'resource-modules.json').read_text())['modules']
    if len(modules) != len(current) or {m['id'] for m in modules} != {m['id'] for m in current}:
        raise ValueError('Resource identity changed')
    allowed = {'description', 'original_description', 'retrieval_document',
        'retrieval_original_document', 'retrieval_provenance'}
    current_by_id = {m['id']:m for m in current}
    for module in modules:
        old = current_by_id[module['id']]
        if module['kind'] != 'expert':
            if module != old:
                raise ValueError('Non-expert module changed')
        elif {k:v for k,v in module.items() if k not in allowed} != {k:v for k,v in old.items() if k not in allowed}:
            raise ValueError('Expert package or execution metadata changed')
    experts = {m['id']: m for m in modules if m['kind'] == 'expert'}
    # Freeze the original scope bytes too, not merely the generated catalog.
    for module in experts.values():
        provenance = module['retrieval_provenance']
        if provenance['state'] == 'source-grounded':
            file = (Path(module['package_root'])/provenance['primary_path']).resolve()
            if sha(file) != provenance['primary_sha256']:
                raise ValueError('Original role changed: '+module['name'])
            inputs.append(file)
    before = {str(file.resolve()): sha(file) for file in inputs}
    started = time.perf_counter()
    graph = json.loads((registry/'skills.graph.json').read_text())
    changed = []
    for tool in graph['tools'].values():
        metadata = tool['metadata']
        module = experts.get(metadata.get('module_id'))
        if module is None:
            continue
        if tool['description'] != module['retrieval_document'] or metadata['retrieval_original_description'] != module['retrieval_original_document']:
            raise ValueError('Scored retrieval document changed: '+module['name'])
        metadata['capability_description'] = module['description']
        metadata['retrieval_provenance'] = module['retrieval_provenance']
        changed.append(module['id'])
    if set(changed) != set(experts):
        raise ValueError('Expert coverage mismatch')
    (stage/'skills.graph.json').write_text(json.dumps(graph, ensure_ascii=False))
    manifest = json.loads((registry/'skills.graph.manifest.json').read_text())
    manifest.update(resourceCatalogPath=str(args.resource_catalog.resolve()),graphPath=str(stage/'skills.graph.json'))
    (stage/'skills.graph.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    publish = [stage/'skills.graph.json', stage/'skills.graph.manifest.json']
    sidecars = [graph['metadata']['chinese_embedding'], *graph['metadata']['description_embeddings'].values()]
    for config in sidecars:
        file = registry/config['file']
        if sha(file) != config['sha256']:
            raise ValueError('Embedding sidecar changed')
        shutil.copy2(file, stage/file.name)
        publish.append(stage/file.name)
    for file in inputs:
        if file.name in hook_names or file.name == 'skill-router.mjs':
            target = stage/'hooks'/file.name
            shutil.copy2(file, target)
            publish.append(target)
    after = {str(file.resolve()): sha(file) for file in inputs}
    if before != after:
        raise ValueError('Inputs changed while staging')
    report = {'schemaVersion':'resource-graph-candidate/1', 'resourceModuleCount':len(modules),
        'graphNodeCount':len(graph['tools']), 'inputsSha256':before,
        'publishFiles':{str(file):sha(file) for file in publish},'sourceScopeOnly':True,
        'unchangedRetrievalDocumentsAndVectors':True,'experts':len(experts),
        'seconds':time.perf_counter()-started,'productionChanged':False}
    (stage/'build-report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({key:value for key,value in report.items() if key not in ('inputsSha256','publishFiles')}))


if __name__ == '__main__':
    main()
