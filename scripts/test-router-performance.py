"""Offline regression tests: no live router or credentials are accessed."""
import runpy
import unittest
from pathlib import Path

module = runpy.run_path(str(Path(__file__).with_name('patch-codex-router-performance.py')))


class RouterPerformanceTests(unittest.TestCase):
    def test_route_limit_and_idempotence(self):
        update = module['update_route_limit']
        original = 'PRIVATE_ROUTE_CONCURRENCY_LIMITS=a:2,b:3\n'
        result = update(original, 'a', 20)
        self.assertEqual(result, 'PRIVATE_ROUTE_CONCURRENCY_LIMITS=b:3,a:20\n')
        self.assertEqual(update(result, 'a', 20), result)

    def test_invalid_limits(self):
        update = module['update_route_limit']
        for source, route, limit in [('', 'a', 0), ('', 'a,b', 2),
                                     ('PRIVATE_ROUTE_CONCURRENCY_LIMITS=a:no\n', 'a', 2),
                                     ('PRIVATE_ROUTE_CONCURRENCY_LIMITS=a:1\nPRIVATE_ROUTE_CONCURRENCY_LIMITS=b:2\n', 'a', 2)]:
            with self.subTest(source=source, route=route, limit=limit):
                with self.assertRaises(ValueError):
                    update(source, route, limit)

    def test_metrics_patch(self):
        patch = module['patch_queue_metrics']
        source = ('class Handler:\n'
                  '    def acquire_private_route(self):\n'
                  '        route = self.server.acquire_private_route()\n'
                  '        self._balanced_private_route = route\n'
                  '        return route\n')
        result = patch(source)
        compile(result, 'fixture', 'exec')
        self.assertIn('queue_seconds=', result)
        self.assertEqual(patch(result), result)
        with self.assertRaises(RuntimeError):
            patch('unknown source')


if __name__ == '__main__':
    unittest.main()
