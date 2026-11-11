#!/usr/bin/env python3
"""Exact score reuse must retain isolation, restrictions and a finite footprint."""
import sys,unittest,threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'codex-profile/mac/hooks'))
import graph_skill_index as indexer
class ScoreCacheTests(unittest.TestCase):
 def fixture(self):
  calls=[]
  def score(query,*,restrict=None):
   calls.append((query,restrict))
   return {name:float(len(query)+n) for n,name in enumerate(['alpha','beta']) if restrict is None or name in restrict}
  bm25=SimpleNamespace(score=score);engine=SimpleNamespace(_get_bm25=lambda:bm25)
  indexer.prepare_bm25_score_cache(engine)
  return bm25,calls
 def test_repeated_clauses_reuse_exact_scores_without_mutable_aliases(self):
  bm25,calls=self.fixture();first=bm25.score('same clause');expected=first.copy();first['alpha']=-1
  self.assertEqual(bm25.score('same clause'),expected);self.assertEqual(len(calls),1)
  self.assertEqual(bm25.score('same clause',restrict={'beta'}),{'beta':12.0});self.assertEqual(len(calls),2)
  self.assertEqual(bm25.score('same clause',restrict=frozenset({'beta'})),{'beta':12.0});self.assertEqual(len(calls),2)
  self.assertEqual(bm25.score('same clause',restrict=set()),{})
 def test_cache_is_bounded_and_old_queries_are_recomputed(self):
  bm25,calls=self.fixture()
  for i in range(80):bm25.score('query-'+str(i))
  info=bm25.score.cache_info();self.assertLessEqual(info['entries'],64);self.assertLessEqual(info['scoreCells'],524288)
  before=len(calls);bm25.score('query-0');self.assertEqual(len(calls),before+1)
 def test_oversized_scores_are_returned_in_full_without_caching(self):
  calls=[]
  def score(query,*,restrict=None):calls.append(query);return dict.fromkeys(range(524289),1.0)
  bm25=SimpleNamespace(score=score);indexer.prepare_bm25_score_cache(SimpleNamespace(_get_bm25=lambda:bm25))
  self.assertEqual(len(bm25.score('large')),524289);self.assertEqual(len(bm25.score('large')),524289)
  self.assertEqual(len(calls),2);self.assertEqual(bm25.score.cache_info()['scoreCells'],0)
 def test_concurrent_misses_do_not_double_count_cells(self):
  barrier=threading.Barrier(4)
  def score(query,*,restrict=None):
   barrier.wait(timeout=5)
   return {'alpha':1.0,'beta':2.0}
  bm25=SimpleNamespace(score=score);indexer.prepare_bm25_score_cache(SimpleNamespace(_get_bm25=lambda:bm25))
  with ThreadPoolExecutor(max_workers=4) as pool:
   results=list(pool.map(bm25.score,['same']*4))
  self.assertTrue(all(row=={'alpha':1.0,'beta':2.0} for row in results))
  self.assertEqual(bm25.score.cache_info()['scoreCells'],2)
  self.assertEqual(bm25.score.cache_info()['entries'],1)
 def test_score_cell_budget_evicts_before_entry_limit(self):
  def score(query,*,restrict=None):return dict.fromkeys(range(200000),1.0)
  bm25=SimpleNamespace(score=score);indexer.prepare_bm25_score_cache(SimpleNamespace(_get_bm25=lambda:bm25))
  for query in ['one','two','three']:bm25.score(query)
  self.assertEqual(bm25.score.cache_info()['entries'],2)
  self.assertEqual(bm25.score.cache_info()['scoreCells'],400000)
 def test_real_scorer_results_and_insertion_order_are_exact(self):
  from graph_tool_call.retrieval.keyword import BM25Scorer
  graph=indexer.graph_from_records([], [
   {'tool_name':'search_alpha','name':'search_alpha','server':'test','description':'search alpha documents'},
   {'tool_name':'debug_beta','name':'debug_beta','server':'test','description':'搜索文件，调试根因，性能分析'},
  ])
  for tokenizer in (None,indexer.chinese_tokenize):
   scorer=BM25Scorer(graph.tools,tokenizer=tokenizer)
   queries=['alpha documents','搜索文件调试根因','hypotenuse distance','', 'search alpha search']
   restrictions=[None,set(),set(graph.tools),{'search_alpha'}]
   expected=[list(scorer.score(query,restrict=restrict).items()) for query in queries for restrict in restrictions]
   indexer.prepare_bm25_score_cache(SimpleNamespace(_get_bm25=lambda:scorer))
   for _ in range(2):
    actual=[list(scorer.score(query,restrict=restrict).items()) for query in queries for restrict in restrictions]
    self.assertEqual(actual,expected)
if __name__=='__main__':unittest.main()
