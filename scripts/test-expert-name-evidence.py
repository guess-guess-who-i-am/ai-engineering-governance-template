#!/usr/bin/env python3
"""Opaque graph identities must not become expert-name relevance evidence."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

from graph_tool_call.retrieval.engine import RetrievalEngine

SPEC=importlib.util.spec_from_file_location('name_evidence_indexer',
    Path(__file__).resolve().parents[1]/'codex-profile/mac/hooks/graph_skill_index.py')
INDEXER=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(INDEXER)


class NameEvidenceTests(unittest.TestCase):
    def engine(self, tools):
        engine=SimpleNamespace(_tools={n:SimpleNamespace(metadata=m) for n,m in tools.items()},
            _boost_name_overlap=lambda query,scores:RetrievalEngine._boost_name_overlap(None,query,scores))
        prepare=getattr(INDEXER,'prepare_resource_name_evidence',lambda e:None)
        prepare(engine)
        return engine

    def test_incidental_worker_count_does_not_match_a_package_hash(self):
        tools={'resource_expert_alpha_4abc':{'kind':'expert','skill_name':'alpha'},
               'resource_expert_beta_8bcd':{'kind':'expert','skill_name':'beta'}}
        engine=self.engine(tools);scores={n:1.0 for n in tools}
        engine._boost_name_overlap('4',scores)
        self.assertEqual(list(scores.values()),[1.0,1.0])

    def test_explicit_real_name_still_has_library_identity_priority(self):
        tools={'resource_expert_actual_a23f':{'kind':'expert','skill_name':'performance-testing-expert'},
               'resource_expert_other_9fff':{'kind':'expert','skill_name':'invoice-checker'}}
        engine=self.engine(tools);scores={n:1.0 for n in tools}
        engine._boost_name_overlap('performance testing expert',scores)
        self.assertGreater(scores['resource_expert_actual_a23f'],scores['resource_expert_other_9fff'])

    def test_pure_chinese_does_not_count_as_empty_exact_name_match(self):
        tools={'opaque_abcd':{'kind':'expert','skill_name':'alpha'}}
        engine=self.engine(tools);scores={n:1.0 for n in tools}
        engine._boost_name_overlap('分析请求变慢的根因',scores)
        self.assertEqual(scores,{'opaque_abcd':1.0})

    def test_real_chinese_expert_name_is_preserved(self):
        tools={'opaque_abcd':{'kind':'expert','skill_name':'数据分析'},
               'opaque_efgh':{'kind':'expert','skill_name':'财务审计'}}
        engine=self.engine(tools);scores={n:1.0 for n in tools}
        engine._boost_name_overlap('请使用数据分析',scores)
        self.assertGreater(scores['opaque_abcd'],scores['opaque_efgh'])

    def test_native_tool_name_behavior_is_preserved(self):
        engine=self.engine({'get_pod':{'kind':'mcp'}});scores={'get_pod':1.0}
        expected=dict(scores);RetrievalEngine._boost_name_overlap(None,'get pod',expected)
        engine._boost_name_overlap('get pod',scores)
        self.assertEqual(scores,expected)

    def test_duplicate_declared_names_do_not_collapse_graph_identities(self):
        tools={'opaque_a':{'kind':'expert','skill_name':'performance-expert'},
               'opaque_b':{'kind':'expert','skill_name':'performance-expert'}}
        engine=self.engine(tools);scores={'opaque_a':1.0,'opaque_b':0.5}
        engine._boost_name_overlap('unrelated task',scores)
        self.assertEqual(scores,{'opaque_a':1.0,'opaque_b':0.5})
        engine._boost_name_overlap('performance expert',scores)
        self.assertEqual(scores,{'opaque_a':1.5,'opaque_b':1.5})

    def test_mixed_language_names_share_one_explicit_identity_floor(self):
        tools={'opaque_a':{'kind':'expert','skill_name':'performance-expert'},
               'opaque_b':{'kind':'expert','skill_name':'数据分析'}}
        engine=self.engine(tools);scores={n:1.0 for n in tools}
        engine._boost_name_overlap('performance expert 和 数据分析',scores)
        self.assertEqual(scores,dict.fromkeys(tools,1.5))

    def test_other_resource_kinds_also_use_declared_names(self):
        for metadata in ({'kind':'skill','skill_name':'spreadsheet-author'},
                         {'kind':'mcp-service','skill_name':'context7'},
                         {'kind':'mcp','mcp_original_name':'search_documentation'}):
            engine=self.engine({'opaque_4abc':metadata});scores={'opaque_4abc':1.0}
            engine._boost_name_overlap('4',scores)
            self.assertEqual(scores,{'opaque_4abc':1.0})
            alias=metadata.get('skill_name',metadata.get('mcp_original_name'))
            engine._boost_name_overlap(alias,scores)
            self.assertEqual(scores,{'opaque_4abc':1.5})


if __name__=='__main__':unittest.main()
