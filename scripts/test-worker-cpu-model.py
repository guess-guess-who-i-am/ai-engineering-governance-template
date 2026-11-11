#!/usr/bin/env python3
"""CPU transfers must release unused MPS buffers without changing model loading."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'codex-profile/mac/hooks'))
import graph_skill_index as indexer

class CpuModelTests(unittest.TestCase):
    def fixture(self, available):
        events=[]
        model=Mock()
        model.to.side_effect=lambda device: events.append(('to',device)) or model
        provider=SimpleNamespace(_get_model=lambda: events.append(('load',)) or model)
        torch=SimpleNamespace(backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: available)),
                              mps=SimpleNamespace(empty_cache=lambda: events.append(('release',))))
        return model,provider,torch,events

    def test_keeps_original_model_then_releases_after_cpu_transfer(self):
        model,provider,torch,events=self.fixture(True)
        with patch.dict(sys.modules,{'torch':torch}):
            self.assertIs(indexer.prepare_cpu_embedding_model(provider),model)
        self.assertEqual(events,[('load',),('to','cpu'),('release',)])

    def test_cpu_only_platform_never_calls_mps(self):
        model,provider,torch,events=self.fixture(False)
        with patch.dict(sys.modules,{'torch':torch}):
            self.assertIs(indexer.prepare_cpu_embedding_model(provider),model)
        self.assertEqual(events,[('load',),('to','cpu')])

    def test_failed_transfer_is_not_hidden(self):
        model,provider,torch,events=self.fixture(True)
        model.to.side_effect=RuntimeError('fixture transfer failure')
        with patch.dict(sys.modules,{'torch':torch}):
            with self.assertRaisesRegex(RuntimeError,'transfer failure'):
                indexer.prepare_cpu_embedding_model(provider)
        self.assertEqual(events,[('load',)])

if __name__=='__main__':
    unittest.main()
