#!/usr/bin/env python3
"""Audit target-name Hit@2; never infer task relevance from missing labels."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def audit(evidence, case_files):
    labels = {}
    for path, data in case_files:
        for case in data['cases']:
            key = (path.name, case['id'])
            if key in labels:
                raise ValueError(f'Duplicate label: {key}')
            labels[key] = case
    rows = [row for row in evidence['pairedRows'] if row['kind'] == 'expert']
    if not rows:
        raise ValueError('No expert observations')
    seen = set()
    observations = []
    for row in rows:
        key = (row['set'], row['case'])
        identity = (*key, row['language'])
        if identity in seen:
            raise ValueError(f'Duplicate observation: {identity}')
        seen.add(identity)
        if key not in labels:
            raise ValueError(f'Missing labels: {key}')
        case = labels[key]
        if case[row['language']] != row['query']:
            raise ValueError(f'Query differs from label fixture: {identity}')
        targets = set(case['targets'])
        experts = [item for item in row['candidateReturned'] if item['kind'] == 'expert']
        if len(experts) != 2:
            raise ValueError(f'Expected exactly two expert seats: {identity}')
        hit = lambda items: any(item['name'] in targets for item in items)
        observed = hit(experts)
        if observed != row['candidateTargetHit']:
            raise ValueError(f'Stored hit disagrees with recomputed labels: {identity}')
        # Deliberately destroy the partner recommendation, retaining one label hit.
        # This is a synthetic metric-sensitivity test, not a new routing result.
        counterfactual = [next((item for item in experts if item['name'] in targets), experts[0]),
                          {'name': '__explicitly_incompatible_negative_control__'}]
        blocked = [dict(item, executionState='blocked') for item in experts]
        observations.append({
            'set': key[0], 'case': key[1], 'language': row['language'],
            'query': row['query'], 'experts': [item['name'] for item in experts],
            'targetNames': sorted(targets),
            'targetMembers': sum(item['name'] in targets for item in experts),
            'targetHit': observed,
            'syntheticBadPartnerHit': hit(counterfactual),
            'syntheticBlockedHit': hit(blocked),
        })
    pairs = Counter((row['set'], row['case']) for row in observations)
    return {
        'schema': 'expert-metric-audit/v1',
        'observations': len(rows), 'scenarios': len(pairs),
        'scenarioObservationCounts': dict(sorted(Counter(pairs.values()).items())),
        'targetHitCount': sum(row['targetHit'] for row in observations),
        'targetMemberHistogram': dict(sorted(Counter(row['targetMembers'] for row in observations).items())),
        'byLanguage': {lang: {'n': sum(row['language'] == lang for row in observations),
                            'targetHits': sum(row['targetHit'] for row in observations if row['language'] == lang)}
                       for lang in sorted({row['language'] for row in observations})},
        'negativeControls': {
            'badPartnerHitCount': sum(row['syntheticBadPartnerHit'] for row in observations),
            'allExpertsBlockedHitCount': sum(row['syntheticBlockedHit'] for row in observations),
            'allRowScoresUnchanged': all(row['targetHit'] == row['syntheticBadPartnerHit'] == row['syntheticBlockedHit'] for row in observations),
        },
        'rows': observations,
        'limitations': [
            'Name membership measures a diagnostic target hit, not expert relevance, usability or task success.',
            'Unlisted experts are unjudged, not automatically irrelevant. No semantic precision or recall is estimated.',
            'Counterfactuals intentionally test metric blindness; they are not actual worker outputs or observed runtime failures.',
            'Language pairs share a scenario; these are development observations, not an independent held-out estimate.',
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, default=ROOT/'docs/evidence/expert-ranking-20261030.json')
    parser.add_argument('--cases', type=Path, nargs='+', default=[ROOT/'scripts'/name for name in (
        'resource-expert-routing-challenge.json', 'expert-relevance-unseen-20261030.json',
        'expert-description-domain-cases.json', 'expert-ranking-heldout-20261030.json')])
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    paths = [args.evidence, *args.cases]
    before = {path: path.read_bytes() for path in paths}
    result = audit(json.loads(before[args.evidence]), [(path, json.loads(before[path])) for path in args.cases])
    if any(path.read_bytes() != content for path, content in before.items()):
        raise ValueError('Audit inputs changed while reading')
    result['inputs'] = [{'file': str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name,
                         'sha256': hashlib.sha256(content).hexdigest()} for path, content in before.items()]
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({key: value for key, value in result.items() if key not in ('rows', 'inputs', 'limitations')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
