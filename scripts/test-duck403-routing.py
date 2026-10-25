#!/usr/bin/env python3
"""Exercise the installed router; all upstreams are mocks, never real providers."""
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import sys
import threading
from types import MethodType, SimpleNamespace
import unittest
from urllib.parse import urlsplit

import requests


def load_router(path):
    sys.path.insert(0, str(path.parent))
    return runpy.run_path(str(path), run_name="duck403_regression_test")


def behavior_suite(module):
    handler = module["APIHandler"]

    class RoutingTests(unittest.TestCase):
        def make_handler(self, outcomes, provider_body=False):
            cfg = SimpleNamespace(
                private_default_route="duckduckport",
                private_fallback_order=["kpoce"],
                private_fallbacks_by_route={"duckduckport": ["kpoce"], "kpoce": ["duckduckport"]},
                upstream_retry_count=1, upstream_retry_backoff=0,
            )
            h = SimpleNamespace(cfg=cfg, server=SimpleNamespace(cfg=cfg), calls=[], responses=[])
            for name in ["private_fallback_routes_for", "should_fallback_status", "should_retry_upstream_status", "request_upstream_with_retries", "request_with_fallbacks"]:
                setattr(h, name, MethodType(getattr(handler, name), h))

            def upstream(kind, route, parsed, body):
                h.calls.append(route)
                value = outcomes[route]
                if isinstance(value, list):
                    value = value.pop(0)
                if isinstance(value, Exception):
                    raise value
                response = requests.Response()
                response.status_code = value
                response.headers["Content-Type"] = "application/json"
                response._content = json.dumps({"error": {"type": "server_error" if provider_body else "permission_error", "message": "test refusal"}}).encode()
                response.closed_for_test = False
                response.close = lambda: setattr(response, "closed_for_test", True)
                h.responses.append(response)
                return response

            h.request_upstream = upstream
            h.promote_private_route = lambda *args: self.fail("must not promote a route")
            return h

        def invoke(self, h, route="duckduckport", kind="private"):
            with contextlib.redirect_stderr(io.StringIO()):
                return h.request_with_fallbacks(kind, route, urlsplit("/v1/responses"), b"{}", None)

        def check_forbidden(self, provider_body=False):
            h = self.make_handler({"duckduckport": 403, "kpoce": 200}, provider_body)
            response, route = self.invoke(h)
            self.assertEqual(h.calls, ["duckduckport"])
            self.assertEqual(route, "duckduckport")
            self.assertIs(response, h.responses[0])
            self.assertEqual(response.status_code, 403)
            self.assertFalse(response.closed_for_test)
            if provider_body:
                self.assertTrue(module["retryable_provider_http_error"](response))

        def test_duck_403_is_terminal(self):
            self.check_forbidden()

        def test_duck_403_provider_error_cannot_override_policy(self):
            self.check_forbidden(provider_body=True)

        def test_next_request_starts_at_duck(self):
            h = self.make_handler({"duckduckport": [403, 200], "kpoce": 200})
            self.invoke(h)
            response, route = self.invoke(h)
            self.assertEqual(h.calls, ["duckduckport", "duckduckport"])
            self.assertEqual((response.status_code, route), (200, "duckduckport"))
            self.assertEqual(h.cfg.private_default_route, "duckduckport")

        def test_timeout_retries_duck_before_fallback(self):
            h = self.make_handler({"duckduckport": [requests.ReadTimeout("test"), 200], "kpoce": 200})
            response, route = self.invoke(h)
            self.assertEqual(h.calls, ["duckduckport", "duckduckport"])
            self.assertEqual((response.status_code, route), (200, "duckduckport"))

        def test_exhausted_timeout_still_falls_back(self):
            h = self.make_handler({"duckduckport": requests.ReadTimeout("test"), "kpoce": 200})
            response, route = self.invoke(h)
            self.assertEqual(h.calls, ["duckduckport", "duckduckport", "kpoce"])
            self.assertEqual((response.status_code, route), (200, "kpoce"))

        def test_other_status_policies_are_unchanged(self):
            for status in [401, 402, 408, 429, 500, 503, 524]:
                with self.subTest(status=status):
                    h = self.make_handler({"duckduckport": status, "kpoce": 200})
                    response, route = self.invoke(h)
                    self.assertEqual((response.status_code, route), (200, "kpoce"))

        def test_ordinary_400_does_not_fall_back(self):
            h = self.make_handler({"duckduckport": 400, "kpoce": 200})
            response, route = self.invoke(h)
            self.assertEqual(h.calls, ["duckduckport"])
            self.assertEqual((response.status_code, route), (400, "duckduckport"))

        def test_kpoce_policy_is_unchanged(self):
            h = self.make_handler({"duckduckport": 200, "kpoce": 403})
            response, route = self.invoke(h, route="kpoce")
            self.assertEqual(h.calls, ["kpoce", "duckduckport"])
            self.assertEqual((response.status_code, route), (200, "duckduckport"))

        def test_public_request_does_not_fall_back(self):
            h = self.make_handler({"duckduckport": 403, "kpoce": 200})
            response, route = self.invoke(h, kind="public")
            self.assertEqual(h.calls, ["duckduckport"])
            self.assertEqual((response.status_code, route), (403, "duckduckport"))

    return unittest.defaultTestLoader.loadTestsFromTestCase(RoutingTests)


def http_check(module, env_file):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    module["load_env"](env_file)
    cfg = module["RouterConfig"]()
    seen = []
    state = {"status": 403, "provider_error": False}

    class MockProvider(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            route = self.path.split("/")[1]
            seen.append(route)
            status = state["status"] if route == "duckduckport" else 200
            body = json.dumps({"error": {"type": "server_error" if state["provider_error"] else "permission_error", "message": "isolated test"}}).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    mock = ThreadingHTTPServer(("127.0.0.1", 0), MockProvider)
    cfg.private_default_route = "duckduckport"
    cfg.private_balanced_routes = ["duckduckport"]
    cfg.private_fallbacks_by_route = {"duckduckport": ["kpoce"], "kpoce": []}
    cfg.upstream_retry_count = 0
    # No real provider URL or key is used in the isolated router.
    cfg.routes = {route: {"base_url": f"http://127.0.0.1:{mock.server_port}/{route}/v1", "api_key": "isolated-test", "proxy_url": ""} for route in ["duckduckport", "kpoce"]}
    server = module["RouterServer"](("127.0.0.1", 0), module["APIHandler"], cfg)
    session = requests.Session()
    session.trust_env = False
    reports = []
    with contextlib.redirect_stderr(io.StringIO()):
        threading.Thread(target=mock.serve_forever, daemon=True).start()
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            for status, provider_error in [(403, False), (403, True), (200, False), (503, False)]:
                state.update(status=status, provider_error=provider_error)
                seen.clear()
                response = session.post(f"http://127.0.0.1:{server.server_port}/v1/responses", headers={"Authorization": "Bearer " + os.environ["PRIVATE_CLIENT_KEY"]}, json={"model": "gpt-6.1-sol", "input": "isolated test", "stream": False, "store": False}, timeout=(3, 10))
                expected_route = "kpoce" if status == 503 else "duckduckport"
                expected_status = 200 if status == 503 else status
                expected_calls = ["duckduckport", "kpoce"] if status == 503 else ["duckduckport"]
                assert response.status_code == expected_status, (status, response.status_code)
                assert response.headers.get("X-Cockpit-Served-Route") == expected_route
                assert response.headers.get("X-Cockpit-Fallback") == ("yes" if status == 503 else "no")
                assert seen == expected_calls, seen
                if status == 403:
                    expected_body = json.dumps({"error": {"type": "server_error" if provider_error else "permission_error", "message": "isolated test"}}).encode()
                    assert response.content == expected_body, "403 body must be preserved verbatim"
                reports.append({"upstream_status": status, "provider_error": provider_error, "client_status": response.status_code, "served_route": expected_route, "upstream_calls": list(seen)})
        finally:
            session.close()
            server.shutdown()
            mock.shutdown()
            server.server_close()
            mock.server_close()
    print(json.dumps({"isolated_http_tests_passed": len(reports), "cases": reports}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--router", required=True, type=Path)
    parser.add_argument("--env", type=Path, help="Enable isolated HTTP tests using existing config in memory")
    args = parser.parse_args()
    module = load_router(args.router.resolve())
    result = unittest.TextTestRunner(verbosity=2).run(behavior_suite(module))
    if not result.wasSuccessful():
        sys.exit(1)
    if args.env:
        http_check(module, args.env)


if __name__ == "__main__":
    main()
