#!/usr/bin/env python3
import copy
import json
import hashlib
import importlib.util
from pathlib import Path
import unittest
import tempfile

spec = importlib.util.spec_from_file_location('applicability', Path(__file__).with_name('evaluate-expert-applicability.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    role = 'Owns production incident containment, recovery, timeline and postmortem.'
    quote = 'production incident containment, recovery, timeline and postmortem'
    return {'schema': 'expert-applicability-review/v1',
        'reviewer': {'identity': 'test fixture, not an LLM', 'method': 'test', 'limitations': ['Synthetic contract only']},
        'packets': [{'id': 'p', 'task': 'Coordinate an incident and deliver a postmortem', 'role': role, 'roleSha256': hashlib.sha256(role.encode()).hexdigest(),
                     'requirements': {'recovery': 'Coordinate recovery', 'postmortem': 'Deliver postmortem'}}],
        'expectedSeats': [['incident', 'baseline', 1], ['incident', 'baseline', 2]],
        'packetBindings': [{'seatKey': ['incident', 'baseline', seat], 'packet': 'p'} for seat in (1, 2)],
        'judgments': [{'case': 'incident', 'mode': 'baseline', 'seat': seat, 'packet': 'p', 'label': 'direct',
            'coverage': {'recovery': 'yes', 'postmortem': 'yes'}, 'coverageEvidence': {'recovery': [quote], 'postmortem': [quote]},
            'citations': [quote], 'reason': 'Explicit duties'} for seat in (1, 2)]}


class ApplicabilityTests(unittest.TestCase):
    def test_name_hit_cannot_hide_bad_partner(self):
        data = fixture()
        old = module.summarize(data)['summary']['baseline']
        data['judgments'][1].update(label='irrelevant', coverage={'recovery': 'no', 'postmortem': 'no'}, coverageEvidence={})
        new = module.summarize(data)['summary']['baseline']
        self.assertEqual(old['irrelevantSeats'], 0)
        self.assertEqual(new['irrelevantSeats'], 1)
        self.assertEqual(new['tasksWithDirectExpert'], 1)

    def test_equivalent_role_not_penalized_by_name(self):
        data = fixture()
        data['packets'][0]['name'] = 'not-in-old-target-list'
        self.assertEqual(module.summarize(data)['summary']['baseline']['tasksWithDirectExpert'], 1)

    def test_blocked_role_not_execution_success(self):
        data = fixture()
        data['judgments'][0].update(runtime='blocked', runtimeEvidence='Required original tool absent')
        result = module.summarize(data)['summary']['baseline']
        self.assertEqual(result['tasksWithDirectExpert'], 1)
        self.assertEqual(result['verifiedTaskPasses'], 0)

    def test_partial_not_direct(self):
        data = fixture()
        data['judgments'][0]['coverage']['postmortem'] = 'no'
        data['judgments'][0]['coverageEvidence'].pop('postmortem')
        with self.assertRaisesRegex(ValueError, 'every necessary'): module.summarize(data)
        data['judgments'][0]['label'] = 'support'
        self.assertEqual(module.summarize(data)['summary']['baseline']['labels']['support'], 1)

    def test_unknown_stays_unknown(self):
        data = fixture()
        data['judgments'][0].update(label='unknown', coverage={'recovery': 'unknown', 'postmortem': 'unknown'}, citations=[], coverageEvidence={})
        result = module.summarize(data)['summary']['baseline']
        self.assertEqual(result['unjudgedSeats'], 1)
        self.assertEqual(result['irrelevantSeats'], 0)
        self.assertFalse(result['allSeatsSemanticallyJudged'])

    def test_complementary_support_is_coverage_not_execution(self):
        data = fixture()
        for i, missing in enumerate(('recovery', 'postmortem')):
            row = data['judgments'][i]
            row['label'] = 'support'
            row['coverage'][missing] = 'unknown'
            row['coverageEvidence'].pop(missing)
        result = module.summarize(data)['summary']['baseline']
        self.assertEqual(result['tasksWithAllCapabilitiesCovered'], 1)
        self.assertEqual(result['tasksWithDirectExpert'], 0)
        self.assertEqual(result['verifiedTaskPasses'], 0)
        data['judgments'][0].update(runtime='ready', runtimeEvidence='Local fixture', execution='passed', artifactEvidence='Only a partial output')
        with self.assertRaisesRegex(ValueError, 'Whole-task'): module.summarize(data)

    def test_frozen_run_binds_task_module_and_both_seats(self):
        data = fixture()
        data['packets'][0].update(name='incident-expert', moduleId='expert:incident', task='Incident\nContinue')
        run = {'rows': [{'id': 'incident', 'history': ['Incident'], 'prompt': 'Continue', 'baseline': {
            'candidates': [{'name': 'incident-expert', 'kind': 'Complete expert module', 'moduleId': 'expert:incident'}] * 2}}]}
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory)/'run.json'
            file.write_text(json.dumps(run))
            data['runSha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
            module.verify_run(data, file)
            for key, value in [('name', 'wrong'), ('moduleId', 'expert:wrong'), ('task', 'unrelated')]:
                altered = copy.deepcopy(data); altered['packets'][0][key] = value
                with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'actual routed'):
                    module.verify_run(altered, file)
            file.write_text('{}')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): module.verify_run(data, file)

    def test_hydration_uses_original_catalog_not_embedded_role(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            role = root/'ROLE.md'; role.write_text('Original scope\r\n', newline='')
            entry = root/'MODULE.md'; entry.write_text('Original primary role: ' + str(role))
            catalog = root/'catalog.json'
            catalog.write_text(json.dumps({'modules': [{'id': 'expert:one', 'kind': 'expert', 'name': 'one', 'path': str(entry)}]}))
            document = {'packets': [{'moduleId': 'expert:one', 'name': 'one'}]}
            self.assertEqual(module.hydrate(document, catalog)['packets'][0]['role'], 'Original scope\r\n')
            document['packets'][0]['role'] = 'Fabricated scope'
            with self.assertRaisesRegex(ValueError, 'Supplied role'): module.hydrate(document, catalog)

    def test_same_requirement_keys_cannot_hide_changed_meaning(self):
        data = fixture()
        packet = copy.deepcopy(data['packets'][0]); packet['id'] = 'other'
        packet['requirements']['postmortem'] = 'Unrelated output using the same key'
        data['packets'].append(packet)
        data['judgments'][1]['packet'] = 'other'
        data['packetBindings'][1]['packet'] = 'other'
        with self.assertRaisesRegex(ValueError, 'meanings differ'): module.summarize(data)

    def test_reject_missing_duplicate_fabricated_and_unexecuted_claims(self):
        mutations = [
            lambda d: d['judgments'].pop(),
            lambda d: d['judgments'].append(copy.deepcopy(d['judgments'][0])),
            lambda d: d['judgments'][0].update(citations=['invented quote']),
            lambda d: d['packets'][0].update(role='changed role'),
            lambda d: d['judgments'][0]['coverage'].pop('postmortem'),
            lambda d: d['judgments'][0].update(execution='passed'),
            lambda d: d['judgments'][0].update(runtime='ready'),
            lambda d: d['packetBindings'][0].update(packet='wrong-original-expert'),
            lambda d: d['judgments'][0].update(coverageEvidence={}),
            lambda d: d['packets'][0].update(requirements={}),
            lambda d: d['judgments'][0].update(label='support'),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                data = fixture(); mutation(data)
                with self.assertRaises(ValueError): module.summarize(data)


if __name__ == '__main__': unittest.main()
