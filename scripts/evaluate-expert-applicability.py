#!/usr/bin/env python3
"""Aggregate evidence-grounded seat judgments, never target-name membership.

Semantic judgments come from an explicitly identified reviewer. This program
validates provenance and coverage; it does not pretend to infer relevance.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

LABELS = {'direct', 'support', 'irrelevant', 'unknown'}


def hydrate(document, catalog_path):
    """Resolve portable module IDs through the global catalog, never a name map."""
    catalog = {row['id']: row for row in json.loads(catalog_path.read_text())['modules']}
    for packet in document['packets']:
        module = catalog[packet['moduleId']]
        if module['kind'] != 'expert' or module['name'] != packet['name']:
            raise ValueError('Packet identity differs from the original expert module')
        entry = Path(module['path']).read_text()
        source = re.search(r'^Original primary role: (.+)$', entry, re.M)
        if not source:
            raise ValueError('Original expert entry not loaded')
        role = Path(source[1]).read_bytes().decode('utf-8')
        if 'role' in packet and packet['role'] != role:
            raise ValueError('Supplied role differs from the original expert module')
        packet['role'] = role
    return document


def verify_run(document, run_path):
    content = run_path.read_bytes()
    if hashlib.sha256(content).hexdigest() != document['runSha256']:
        raise ValueError('Routing run hash mismatch')
    source_rows = json.loads(content)['rows']
    run = {row['id']: row for row in source_rows}
    if len(run) != len(source_rows):
        raise ValueError('Duplicate routing run cases')
    packets = {packet['id']: packet for packet in document['packets']}
    for binding in document['packetBindings']:
        case, mode, seat = binding['seatKey']
        packet = packets[binding['packet']]
        row = run[case]
        experts = [item for item in row[mode]['candidates'] if item['kind'] == 'Complete expert module']
        if seat not in (1, 2) or len(experts) != 2:
            raise ValueError('Routing run must contain both expert seats')
        if (packet['name'] != experts[seat - 1]['name']
                or packet['moduleId'] != experts[seat - 1]['moduleId']
                or packet['task'] != '\n'.join([*row['history'], row['prompt']])):
            raise ValueError('Review does not match actual routed expert or task')


def summarize(document):
    if document.get('schema') != 'expert-applicability-review/v1':
        raise ValueError('Unsupported review schema')
    reviewer = document.get('reviewer', {})
    if not all(reviewer.get(key) for key in ('identity', 'method', 'limitations')):
        raise ValueError('Reviewer identity, method and limitations required')
    packets = {row['id']: row for row in document['packets']}
    if not packets or len(packets) != len(document['packets']):
        raise ValueError('Empty or duplicate packets')
    seen = set()
    modes = {}
    task_specs = {}
    for row in document['judgments']:
        identity = (row['case'], row['mode'], row['seat'])
        if identity in seen:
            raise ValueError('Duplicate seat judgment')
        seen.add(identity)
        packet = packets[row['packet']]
        role = packet['role']
        if hashlib.sha256(role.encode()).hexdigest() != packet['roleSha256']:
            raise ValueError('Original role hash mismatch')
        if row['label'] not in LABELS:
            raise ValueError('Unknown semantic label')
        if not row.get('reason'):
            raise ValueError('Every judgment needs a reason')
        citations = row.get('citations', [])
        if row['label'] != 'unknown' and not citations:
            raise ValueError('Semantic judgments need original-role evidence')
        if any(not quote.strip() or quote not in role for quote in citations):
            raise ValueError('Citation absent from original role')
        requirements = packet['requirements']
        if not requirements or any(not isinstance(value, str) or not value.strip() for value in requirements.values()):
            raise ValueError('Task requirements must not be empty')
        if not isinstance(packet.get('task'), str) or not packet['task'].strip():
            raise ValueError('Task text must not be empty')
        task_spec = (packet['task'], requirements)
        if row['case'] in task_specs and task_specs[row['case']] != task_spec:
            raise ValueError('Task or requirement meanings differ between seats or modes')
        task_specs[row['case']] = task_spec
        coverage = row['coverage']
        if set(coverage) != set(requirements):
            raise ValueError('Missing or unexpected requirement judgment')
        if any(value not in ('yes', 'no', 'unknown') for value in coverage.values()):
            raise ValueError('Invalid requirement coverage')
        support = row.get('coverageEvidence', {})
        if set(support) != {key for key, value in coverage.items() if value == 'yes'}:
            raise ValueError('Every supported requirement needs its own original-role evidence')
        if any(not quotes or any(not quote.strip() or quote not in role for quote in quotes) for quotes in support.values()):
            raise ValueError('Requirement citation absent from original role')
        if row['label'] == 'direct' and any(value != 'yes' for value in coverage.values()):
            raise ValueError('Direct applicability requires every necessary capability')
        if row['label'] == 'irrelevant' and any(value == 'yes' for value in coverage.values()):
            raise ValueError('Useful partial capability must not be labeled irrelevant')
        if row['label'] == 'support' and not any(value == 'yes' for value in coverage.values()):
            raise ValueError('Support requires an identified useful capability')
        if row['label'] == 'support' and all(value == 'yes' for value in coverage.values()):
            raise ValueError('Support must leave a necessary capability uncovered')
        state = row.get('runtime', 'unknown')
        if state not in ('ready', 'blocked', 'unknown'):
            raise ValueError('Invalid runtime state')
        if state != 'unknown' and not row.get('runtimeEvidence'):
            raise ValueError('Runtime assertion needs independent evidence')
        execution = row.get('execution', 'not-run')
        if execution not in ('not-run', 'failed', 'passed'):
            raise ValueError('Invalid execution outcome')
        if execution != 'not-run' and not row.get('artifactEvidence'):
            raise ValueError('Execution assertion needs artifact evidence')
        if execution == 'passed' and state != 'ready':
            raise ValueError('Task success requires verified runtime readiness')
        if execution == 'passed' and row['label'] != 'direct':
            raise ValueError('Whole-task success requires all necessary capabilities')
        modes.setdefault(row['mode'], []).append((row, packet))
    expected = {tuple(item) for item in document['expectedSeats']}
    if len(expected) != len(document['expectedSeats']) or seen != expected:
        raise ValueError('Incomplete or unexpected reviewed seats')
    bindings = document['packetBindings']
    if len(bindings) != len(seen) or {tuple(item['seatKey']) for item in bindings} != seen:
        raise ValueError('Incomplete packet bindings')
    bound = {tuple(item['seatKey']): item['packet'] for item in bindings}
    if any(row['packet'] != bound[(row['case'], row['mode'], row['seat'])] for row in document['judgments']):
        raise ValueError('Judgment evaluated a different returned expert')
    summary = {}
    for mode, rows in modes.items():
        labels = Counter(row['label'] for row, _ in rows)
        cases = {}
        for row, packet in rows:
            cases.setdefault(row['case'], []).append((row, packet))
        if any({row['seat'] for row, _ in seats} != {1, 2} for seats in cases.values()):
            raise ValueError('Both expert seats must be reviewed')
        coverage = []
        for case, seats in cases.items():
            requirements = set(seats[0][1]['requirements'])
            if any(set(packet['requirements']) != requirements for _, packet in seats):
                raise ValueError('Task requirements differ between seats')
            coverage.append(all(any(row['coverage'][req] == 'yes' for row, _ in seats) for req in requirements))
        summary[mode] = {
            'tasks': len(cases), 'seats': len(rows), 'labels': dict(labels),
            'tasksWithDirectExpert': sum(any(row['label'] == 'direct' for row, _ in seats) for seats in cases.values()),
            'tasksWithAllCapabilitiesCovered': sum(coverage),
            'irrelevantSeats': labels['irrelevant'], 'unjudgedSeats': labels['unknown'],
            'verifiedRuntimeReadySeats': sum(row.get('runtime') == 'ready' for row, _ in rows),
            'verifiedTaskPasses': sum(any(row.get('execution') == 'passed' for row, _ in seats) for seats in cases.values()),
            'allSeatsSemanticallyJudged': not labels['unknown'],
        }
    return {'schema': 'expert-applicability-summary/v1', 'summary': summary,
            'reviewer': reviewer,
            'limitations': ['Directed development sample, not population accuracy or independent blind evaluation.',
                'Quoted evidence is checked mechanically; semantic truth still depends on reviewer quality.',
                'No composite score or arbitrary pass threshold. Runtime unknown and not-run never count as success.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--run', required=True, type=Path)
    parser.add_argument('--catalog', type=Path, default=Path.home()/'.codex/skill-registry/resource-modules.json')
    args = parser.parse_args()
    content = args.review.read_bytes()
    document = json.loads(content)
    verify_run(document, args.run)
    result = summarize(hydrate(document, args.catalog))
    result['reviewSha256'] = hashlib.sha256(content).hexdigest()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
