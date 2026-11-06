#!/usr/bin/env python3
"""Real HTTP framing regression; no provider credentials or prompt data needed."""
import ast
import concurrent.futures
import gzip
import importlib.util
import json
import io
import os
import random
import textwrap
from itertools import chain
from types import SimpleNamespace
import re
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import requests

PATCH = Path(__file__).with_name('patch-codex-router-streaming.py')
FRAME = b'event: response.output_text.delta\ndata: {"delta":"hello"}\n\n'
FINAL = b'event: response.completed\ndata: {"response":{"status":"completed"}}\n\n'


def iterator(response):
    if not PATCH.exists():
        return response.iter_content(chunk_size=65536)
    spec = importlib.util.spec_from_file_location('stream_patch', PATCH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    namespace = {'requests': requests}
    exec(module.ITERATOR_SOURCE, namespace)
    return namespace['iter_low_latency_content'](response, 65536, True)


class StreamingTests(unittest.TestCase):
    def exchange(self, framing, consume):
        release = threading.Event()
        first_sent = threading.Event()
        payload = FRAME + FINAL
        wire = gzip.compress(payload) if framing == 'gzip' else payload

        class Upstream(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                if framing == 'chunked':
                    self.send_header('Transfer-Encoding', 'chunked')
                elif framing == 'close':
                    self.send_header('Connection', 'close')
                    self.close_connection = True
                else:
                    self.send_header('Content-Length', str(len(wire)))
                if framing == 'gzip':
                    self.send_header('Content-Encoding', 'gzip')
                self.end_headers()
                if framing == 'gzip':
                    self.wfile.write(wire)
                    self.wfile.flush()
                    return
                for frame in (FRAME, FINAL):
                    if framing == 'chunked':
                        self.wfile.write(f'{len(frame):x}\r\n'.encode() + frame + b'\r\n')
                    else:
                        self.wfile.write(frame)
                    self.wfile.flush()
                    if frame == FRAME:
                        first_sent.set()
                        release.wait(3)
                if framing == 'chunked':
                    self.wfile.write(b'0\r\n\r\n')
                    self.wfile.flush()

        server = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        response = requests.get(f'http://127.0.0.1:{server.server_port}', stream=True, timeout=4)
        try:
            consume(response, release, first_sent, payload)
        finally:
            release.set()
            response.close()
            server.shutdown()
            server.server_close()
            thread.join()

    def assert_early_frame(self, framing):
        def consume(response, release, first_sent, payload):
            chunks = iterator(response)
            self.assertTrue(first_sent.wait(1))
            with concurrent.futures.ThreadPoolExecutor(1) as pool:
                first = pool.submit(next, chunks)
                try:
                    received = first.result(timeout=0.5)
                except concurrent.futures.TimeoutError:
                    release.set()
                    first.result(timeout=4)
                    self.fail(f'{framing}: already-flushed SSE frame withheld until next frame/EOF')
                self.assertEqual(received, FRAME)
                self.assertFalse(release.is_set())
                release.set()
                self.assertEqual(received + b''.join(chunks), payload)
        self.exchange(framing, consume)

    def test_content_length_frame_arrives_before_completion(self):
        self.assert_early_frame('length')

    def test_connection_close_frame_arrives_before_completion(self):
        self.assert_early_frame('close')

    def test_chunked_frame_arrives_before_completion(self):
        self.assert_early_frame('chunked')

    def test_gzip_decoding_preserves_bytes(self):
        self.exchange('gzip', lambda response, release, first_sent, payload:
                      self.assertEqual(b''.join(iterator(response)), payload))

    def test_real_relay_forwards_first_frame_before_upstream_completion(self):
        def consume(response, release, first_sent, payload):
            emitted = threading.Event()
            class Sink(io.BytesIO):
                def write(self, data):
                    result = super().write(data)
                    emitted.set()
                    return result
            sink = Sink()
            with concurrent.futures.ThreadPoolExecutor(1) as pool:
                task = pool.submit(PatchTests().relay, [], lambda *args: self.fail('unexpected retry'), response, sink)
                try:
                    self.assertTrue(emitted.wait(0.5), 'relay withheld a meaningful frame')
                    self.assertEqual(sink.getvalue(), FRAME)
                finally:
                    release.set()
                output, _ = task.result(timeout=4)
                self.assertEqual(output, payload)
        self.exchange('length', consume)


class PatchTests(unittest.TestCase):
    def module(self):
        spec = importlib.util.spec_from_file_location('stream_patch', PATCH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_patch_idempotence_and_missing_anchor(self):
        source = 'class Handler:\n' + textwrap.indent(self.relay_source(), '    ')
        patched, changed = self.module().patch_router(source)
        self.assertTrue(changed)
        self.assertEqual(self.module().patch_router(patched), (patched, False))
        with self.assertRaisesRegex(ValueError, 'two relay iterator'):
            self.module().patch_router(source.replace('response.iter_content', 'response.changed'))

    def relay_source(self):
        source_path = os.environ.get('ROUTER_TEST_SOURCE')
        if source_path:
            source = Path(source_path).read_text()
            names = {'relay_response', 'SSEProgressTracker', 'incomplete_sse_terminal_frame'}
            self.definitions = {n.name: ast.get_source_segment(source, n) for n in ast.walk(ast.parse(source))
                                if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names}
        else:
            self.skipTest('Set ROUTER_TEST_SOURCE to the unpatched router source for relay integration tests')
        return textwrap.dedent('    ' + self.definitions['relay_response'])

    def relay(self, chunks, retry=None, upstream_response=None, sink=None):
        source = 'class Handler:\n' + textwrap.indent(self.relay_source(), '    ')
        patched, _ = self.module().patch_router(source)
        ns = dict(requests=requests, time=time, re=re, json=json, chain=chain,
                  random=random, sys=sys, safe_header_value=str, RESPONSE_SKIP_HEADERS=set())
        exec(self.definitions['SSEProgressTracker'], ns)
        exec(self.definitions['incomplete_sse_terminal_frame'], ns)
        exec(patched, ns)
        handler = ns['Handler']()
        handler.server = SimpleNamespace(cfg=SimpleNamespace(stream_bootstrap_retries=2,
            k12_shared_stream_delay_max=0, stream_progress_timeout=0))
        handler.wfile = sink if sink is not None else io.BytesIO()
        handler.send_response = lambda status: None
        handler.send_header = lambda *args: None
        handler.end_headers = lambda: None
        handler.private_fallback_routes_for = lambda *args: ['backup']
        response = upstream_response if upstream_response is not None else self.response(chunks)
        handler.relay_response(response, 'kpoce', 'kpoce', 'test', 'private', retry_stream=retry)
        return handler.wfile.getvalue(), response

    @staticmethod
    def response(chunks):
        response = SimpleNamespace(status_code=200, headers={'Content-Type':'text/event-stream'},
                                   closed=False)
        response.iter_content = lambda **kwargs: iter(chunks)
        response.close = lambda: setattr(response, 'closed', True)
        return response

    def test_relay_never_retries_after_meaningful_output(self):
        calls = []
        output, response = self.relay([FRAME, FINAL], lambda *args: calls.append(args))
        self.assertEqual(output, FRAME + FINAL)
        self.assertEqual(calls, [])
        self.assertTrue(response.closed)

    def test_relay_retries_only_before_meaningful_output(self):
        calls = []
        backup = self.response([FRAME, FINAL])
        def retry(excluded):
            calls.append(excluded)
            return backup, 'backup'
        error = b'event: error\ndata: {"error":{"code":"server_error"}}\n\n'
        output, original = self.relay([error], retry)
        self.assertEqual(output, FRAME + FINAL)
        self.assertEqual(calls, [{'kpoce'}])
        self.assertTrue(original.closed)
        self.assertTrue(backup.closed)

    def test_permanent_error_is_not_replayed(self):
        calls = []
        error = b'event: error\ndata: {"error":{"code":"insufficient_quota"}}\n\n'
        output, _ = self.relay([error], lambda *args: calls.append(args))
        self.assertEqual(output, error)
        self.assertEqual(calls, [])

    def test_timeout_exception_keeps_requests_contract(self):
        from urllib3.exceptions import ReadTimeoutError
        ns = {'requests': requests}
        exec(self.module().ITERATOR_SOURCE, ns)
        response = requests.Response()
        class Raw:
            def read1(self, *args, **kwargs):
                raise ReadTimeoutError(None, '/', 'timeout')
        response.raw = Raw()
        with self.assertRaises(requests.ConnectionError):
            next(ns['iter_low_latency_content'](response, 65536, True))

    def test_non_sse_uses_original_iterator(self):
        ns = {'requests': requests}
        exec(self.module().ITERATOR_SOURCE, ns)
        response = self.response([b'plain'])
        self.assertEqual(list(ns['iter_low_latency_content'](response, 65536, False)), [b'plain'])


if __name__ == '__main__':
    unittest.main()
