#!/usr/bin/env python3
"""Patch only the router's SSE reads; preserve bootstrap retry and route semantics."""
import argparse
import ast
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

MARKER = 'LOW_LATENCY_SSE_READ1_V1'
ITERATOR_SOURCE = '''# LOW_LATENCY_SSE_READ1_V1
from urllib3.response import HTTPResponse as _StreamingHTTPResponse
if not hasattr(_StreamingHTTPResponse, "read1"):
    raise RuntimeError("SSE streaming requires urllib3 with HTTPResponse.read1; install the pinned router requirements")


def iter_low_latency_content(response, chunk_size, is_event_stream):
    """Yield available decoded SSE bytes without waiting to fill a read buffer."""
    if not is_event_stream or not isinstance(response, requests.Response):
        yield from response.iter_content(chunk_size=chunk_size)
        return
    from urllib3.exceptions import DecodeError, ProtocolError, ReadTimeoutError, SSLError
    try:
        while True:
            chunk = response.raw.read1(chunk_size, decode_content=True)
            if not chunk:
                break
            yield chunk
    except ProtocolError as exc:
        raise requests.exceptions.ChunkedEncodingError(exc) from exc
    except DecodeError as exc:
        raise requests.exceptions.ContentDecodingError(exc) from exc
    except ReadTimeoutError as exc:
        raise requests.exceptions.ConnectionError(exc) from exc
    except SSLError as exc:
        raise requests.exceptions.SSLError(exc) from exc
    response._content_consumed = True


'''


def patch_router(source):
    if MARKER in source:
        if source.count('iter_low_latency_content(response, chunk_size, is_event_stream)') != 3:
            raise ValueError('Streaming patch marker exists but call sites differ')
        return source, False
    tree = ast.parse(source)
    owners = [(node, method) for node in tree.body if isinstance(node, ast.ClassDef)
              for method in node.body if isinstance(method, ast.FunctionDef) and method.name == 'relay_response']
    if len(owners) != 1:
        raise ValueError('Expected exactly one relay_response owner')
    owner, method = owners[0]
    lines = source.splitlines(keepends=True)
    start, end = method.lineno - 1, method.end_lineno
    relay = ''.join(lines[start:end])
    old = 'response.iter_content(chunk_size=chunk_size)'
    if relay.count(old) != 2:
        raise ValueError('Expected two relay iterator call sites; source changed')
    relay = relay.replace(old, 'iter_low_latency_content(response, chunk_size, is_event_stream)')
    start_anchor = '        try:\n            prefetched_chunks = []'
    end_anchor = '            self.end_headers()\n'
    if relay.count(start_anchor) != 1 or relay.count(end_anchor) != 1:
        raise ValueError('Expected relay timing anchors; source changed')
    relay = relay.replace(start_anchor, '        relay_started = time.monotonic()\n' + start_anchor)
    relay = relay.replace(end_anchor, end_anchor + '''            if is_event_stream:
                bootstrap_seconds = time.monotonic() - relay_started
                prefetched_bytes = sum(len(chunk) for chunk in prefetched_chunks)
                chunked = "chunked" in response.headers.get("Transfer-Encoding", "").lower()
                sys.stderr.write(
                    f"upstream stream: route={served_route} bootstrap_seconds={bootstrap_seconds:.3f} "
                    f"prefetched_bytes={prefetched_bytes} chunked={int(chunked)}\\n"
                )
''')
    lines[start:end] = [relay]
    lines.insert(owner.lineno - 1, ITERATOR_SOURCE)
    patched = ''.join(lines)
    compile(patched, '<patched-router>', 'exec')
    return patched, True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--router', required=True)
    parser.add_argument('--check', action='store_true', help='Validate anchors without writing')
    args = parser.parse_args()
    path = Path(args.router).resolve()
    source = path.read_text()
    patched, changed = patch_router(source)
    result = {'changed': changed, 'checkOnly': args.check}
    if changed and not args.check:
        backup = path.parent / 'backups' / ('router-streaming-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        backup.mkdir(parents=True, mode=0o700)
        shutil.copy2(path, backup / path.name)
        fd, temporary = tempfile.mkstemp(prefix='.router-streaming-', dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as handle:
                handle.write(patched)
            os.chmod(temporary, path.stat().st_mode & 0o777)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        result['backup'] = str(backup)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
