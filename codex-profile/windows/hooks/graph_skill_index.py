#!/usr/bin/env python3
"""Build and query the user's external Skill catalog with GraphToolCall."""

from __future__ import annotations

import argparse
from collections import OrderedDict
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from copy import deepcopy
import secrets
import hmac
import portalocker
from functools import lru_cache
import gc
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import re
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import warnings
import sqlite3
import faulthandler
faulthandler.enable()

# Import GraphToolCall only after the worker owns the inter-process lock.


def catalog_rows(catalog: Path):
    data = json.loads(catalog.read_text(encoding="utf-8"))
    skills = data.get("skills") if isinstance(data, dict) else None
    if not isinstance(skills, list):
        raise ValueError(f"Catalog has no skills array: {catalog}")
    for skill in skills:
        if isinstance(skill, dict):
            yield skill


def safe_path(root: Path, directory: str) -> Path | None:
    relative = Path(directory)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    resolved_root = root.resolve()
    skill_path = (resolved_root / relative / "SKILL.md").resolve()
    if not skill_path.is_relative_to(resolved_root) or not skill_path.is_file():
        return None
    return skill_path


def load_skills(root: Path, catalog: Path):
    records = []
    missing = invalid = 0
    for raw in catalog_rows(catalog):
        name = str(raw.get("name") or "").strip()
        directory = raw.get("dir")
        if not name or not isinstance(directory, str) or not directory:
            invalid += 1
            continue
        target = safe_path(root, directory)
        if target is None:
            missing += 1
            continue
        identifier = re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("_")[:60] or "skill"
        digest = hashlib.sha1(str(target).encode()).hexdigest()[:8]
        tool_name = f"skill_{identifier}_{digest}"
        fields = [
            raw.get("description"), raw.get("problem_cn"), raw.get("when_cn"),
            raw.get("c1"), raw.get("c2"), raw.get("key"), raw.get("traits_cn"), raw.get("diff_cn"),
        ]
        description = " ".join(str(value).strip() for value in fields if value)
        categories = [str(value).strip() for value in (raw.get("c1"), raw.get("c2")) if value]
        tags = raw.get("traits_cn", [])
        if isinstance(tags, str):
            tags = [tags]
        records.append({
            "name": name,
            "tool_name": tool_name,
            "description": description[:4000],
            "path": str(target),
            "categories": categories,
            "tags": [str(value) for value in tags if value] if isinstance(tags, list) else [],
        })
    return records, missing, invalid


def load_owned_skills(root: Path):
    records = []
    if not root.is_dir():
        return records
    for target in sorted(root.glob("*/SKILL.md")):
        text = target.read_text(encoding="utf-8")
        block = re.search(r"^---\s*\n([\s\S]*?)\n---", text, re.M)
        frontmatter = block.group(1) if block else ""
        name_match = re.search(r"^name:\s*(.+)$", frontmatter, re.M)
        description_match = re.search(r"^description:\s*(.+)$", frontmatter, re.M)
        name = name_match.group(1).strip().strip("'\"") if name_match else target.parent.name
        description = description_match.group(1).strip().strip("'\"") if description_match else ""
        digest = hashlib.sha1(str(target).encode()).hexdigest()[:8]
        records.append({"name": name, "tool_name": f"skill_{re.sub(r'[^a-zA-Z0-9_-]+', '_', name).strip('_')[:60]}_{digest}",
                        "description": description, "path": str(target), "categories": ["global-owned"], "tags": [], "source": "owned"})
    return records


def graph_from_records(records, mcp_records=None):
    from graph_tool_call import ToolGraph
    graph = ToolGraph()
    mcp_tools = [{
        "name": record["tool_name"],
        "description": record["description"],
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True},
    } for record in records]
    graph.ingest_mcp_tools(mcp_tools, server_name="global-skills", detect_dependencies=False)
    for record in records:
        node = graph.tools.get(record["tool_name"])
        if node is not None:
            node.metadata.update({"skill_name": record["name"], "skill_path": record["path"],
                                  "skill_sha256":record.get('sha256','')})
            node.tags.extend(tag for tag in record["tags"] if tag not in node.tags)
        for index, category in enumerate(record["categories"]):
            label = f"{index + 1}:{category[:76]}"
            if not label:
                continue
            category_name = f"skills:{label}"
            graph.add_category(category_name)
            graph.assign_category(record["tool_name"], category_name)
    for record in mcp_records or []:
        tool_name = record.get("tool_name")
        if not tool_name:
            continue
        graph.ingest_mcp_tools([{
            "name": tool_name,
            "description": record.get("description", ""),
            "inputSchema": record.get("inputSchema", {"type": "object"}),
            "annotations": record.get("annotations", {})
        }], server_name=record.get("server", "global-mcp"), detect_dependencies=False)
        node = graph.tools.get(tool_name)
        if node is not None:
            node.metadata.update({"kind": "mcp", "mcp_server": record.get("server", ""), "mcp_original_name": record.get("name", tool_name)})
    return graph


def build(args):
    print('Graph build: loading metadata',file=sys.stderr,flush=True)
    import torch
    torch.set_num_threads(4)
    root, catalog, output = Path(args.root), Path(args.catalog), Path(args.output)
    records, missing, invalid = load_skills(root, catalog)
    owned_records = []
    if getattr(args, "records", ""):
        owned_records.extend(json.loads(Path(args.records).read_text(encoding="utf-8")))
    if args.owned_root:
        owned_records.extend(load_owned_skills(Path(args.owned_root)))
    records.extend(owned_records)
    mcp_records = []
    if args.mcp_catalog and Path(args.mcp_catalog).is_file():
        data = json.loads(Path(args.mcp_catalog).read_text(encoding="utf-8"))
        mcp_records = data.get("tools", []) if isinstance(data, dict) else []
    graph = graph_from_records(records, mcp_records)
    print(f'Graph build: {len(records)} tools ingested',file=sys.stderr,flush=True)
    embedding = "disabled"
    if args.embedding:
        from graph_tool_call.retrieval.embedding import SentenceTransformerProvider
        class BuildProvider(SentenceTransformerProvider):
            def encode_batch(self, texts):
                cache = sqlite3.connect(str(output.with_suffix('.vectors.sqlite')))
                cache.execute('CREATE TABLE IF NOT EXISTS vectors (model TEXT, digest TEXT, value TEXT, PRIMARY KEY(model,digest))')
                encoded = {}
                missing = []
                for text in dict.fromkeys(texts):
                    digest = hashlib.sha256(text.encode()).hexdigest()
                    row = cache.execute('SELECT value FROM vectors WHERE model=? AND digest=?',(self.model_name,digest)).fetchone()
                    if row: encoded[text] = json.loads(row[0])
                    else: missing.append(text)
                for offset in range(0,len(missing),32):
                    batch = missing[offset:offset+32]
                    values = super().encode_batch(batch)
                    for text,value in zip(batch,values):
                        encoded[text] = value
                        cache.execute('INSERT OR REPLACE INTO vectors VALUES (?,?,?)',(self.model_name,hashlib.sha256(text.encode()).hexdigest(),json.dumps(value)))
                    cache.commit()
                    print(f'Graph embedding {min(offset+32,len(missing))}/{len(missing)}; cached={len(texts)-len(missing)}',file=sys.stderr,flush=True)
                cache.close()
                return [encoded[text] for text in texts]
        graph.enable_embedding(BuildProvider(args.model.removeprefix('sentence-transformers/')))
        graph.tune_for_scale()
        embedding = args.model
    output.parent.mkdir(parents=True, exist_ok=True)
    print('Graph build: writing graph',file=sys.stderr,flush=True)
    temporary = output.with_suffix(output.suffix + f".{os.getpid()}.tmp")
    graph.save(temporary, metadata={"skill_count": len(records), "catalog": str(catalog)})
    temporary.replace(output)
    digest = hashlib.sha256()
    with catalog.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    manifest = {
        "schemaVersion": "graph-tool-call-skills/1",
        "graphToolCallVersion": "0.46.0",
        "embedding": embedding,
        "generatedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
        "rootPath": str(root.resolve()),
        "catalogPath": str(catalog.resolve()),
        "catalogSha256": digest.hexdigest(),
        "catalogSkillCount": len(records) + missing + invalid,
        "skillCount": len(records),
        "externalSkillCount": len(records) - len(owned_records),
        "ownedSkillCount": len(owned_records),
        "mcpToolCount": len(mcp_records),
        "missingSkillCount": missing,
        "invalidSkillCount": invalid,
        "graphPath": str(output),
    }
    manifest_path = output.with_suffix(".manifest.json")
    temp_manifest = manifest_path.with_suffix(manifest_path.suffix + f".{os.getpid()}.tmp")
    temp_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_manifest.replace(manifest_path)
    print(json.dumps(manifest, ensure_ascii=False))


def result_records(results):
    output = []
    for result in results:
        tool = result.tool
        metadata = tool.metadata or {}
        output.append({
            "name": metadata.get("skill_name", metadata.get("mcp_original_name", tool.name)),
            "description": tool.description,
            "path": metadata.get("skill_path", ""),
            "score": result.score,
            "confidence": str(result.confidence),
            "keyword_score": result.keyword_score,
            "graph_score": result.graph_score,
            "embedding_score": result.embedding_score,
            "kind": metadata.get("kind", "skill"),
            "mcp_server": metadata.get("mcp_server", ""),
        })
    return output


def retrieve(args):
    from graph_tool_call import ToolGraph
    warnings.filterwarnings("ignore", message="Retrieving over .* without an embedding index")
    graph = ToolGraph.load(args.graph)
    graph.tune_for_scale()
    results = graph.retrieve_with_scores(args.query, top_k=args.top_k, max_graph_depth=2)
    print(json.dumps(result_records(results), ensure_ascii=False))


def _cache_query_interpretation():
    from graph_tool_call.retrieval import semantic_scorer
    # Query intent is pure and repeated for thousands of candidates per request.
    # Keep 256 recent queries, not candidate metadata or graph retrieval results.
    for name in ("infer_query_result_shape", "infer_query_action"):
        function = getattr(semantic_scorer, name)
        if not hasattr(function, "cache_info"):
            setattr(semantic_scorer, name, lru_cache(maxsize=256)(function))
    if not hasattr(semantic_scorer.semantic_terms, 'cache_info'):
        original = semantic_scorer.semantic_terms
        # Tool metadata is immutable for a graph version; never expose mutable
        # shared token sets to callers. Query text is retained only in RAM.
        semantic_scorer.semantic_terms = lru_cache(maxsize=65536)(
            lambda text: frozenset(original(text)))


def _prepare_keyword_index(engine):
    """Exact equivalent of the library fallback, indexed once per graph."""
    postings = {}
    for name, tool in engine._tools.items():
        tokens = set(engine._tokenize(tool.name)) | set(engine._tokenize(tool.description))
        for tag in tool.tags:
            tokens.update(engine._tokenize(tag))
        for token in tokens:
            postings.setdefault(token, []).append(name)

    def keyword_match(query):
        tokens = set(engine._tokenize(query))
        counts = {}
        for token in tokens:
            for name in postings.get(token, ()):
                counts[name] = counts.get(name, 0) + 1
        return {name: min(count / max(len(tokens), 1), 1.0) for name, count in counts.items()}

    engine._keyword_match = keyword_match


class _CachedEmbeddingProvider:
    """Cache query/description vectors across all library embedding stages."""

    def __init__(self, provider):
        self._provider = provider
        self._lock = threading.Lock()
        self._vectors = OrderedDict()

    def encode(self, text):
        return self.encode_batch([text])[0]

    def encode_batch(self, texts):
        with self._lock:
            missing = list(dict.fromkeys(text for text in texts if text not in self._vectors))
            if missing:
                vectors = self._provider.encode_batch(missing)
                if len(vectors) != len(missing):
                    raise ValueError('embedding provider returned an incomplete batch')
                for text, vector in zip(missing, vectors):
                    self._vectors[text] = tuple(vector)
            result = [list(self._vectors[text]) for text in texts]
            for text in texts:
                self._vectors.move_to_end(text)
            while len(self._vectors) > 4096:
                self._vectors.popitem(last=False)
            return result

    def __getattr__(self, name):
        return getattr(self._provider, name)


class _SerializedEmbeddingIndex:
    """Share one index, but never run its native model concurrently on Metal."""

    def __init__(self, index):
        self._index = index
        self._encode_lock = threading.Lock()
        self._cached_encode = lru_cache(maxsize=256)(lambda query: tuple(index.encode(query)))

    def encode(self, query):
        with self._encode_lock:
            return self._cached_encode(query)

    def __getattr__(self, name):
        return getattr(self._index, name)


class _GraphWorker:
    """Keep one graph and its retrieval caches alive across Hook requests."""

    def __init__(self, graph_path: Path):
        self.graph_path = graph_path
        self._graph: ToolGraph | None = None
        self._signature: tuple[int, int, int] | None = None
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._inflight = 0
        self._ready = False
        self._results = OrderedDict()
        self._pending = {}
        self.cache_hits = 0
        self.coalesced = 0
        self.peak_queries = 0
        self._last_request = time.monotonic()
        self.loads = 0

    def _load_if_stale(self) -> ToolGraph:
        from graph_tool_call import ToolGraph
        stat = self.graph_path.stat()
        signature = (stat.st_ino, stat.st_size, stat.st_mtime_ns)
        if self._graph is None or signature != self._signature:
            # Do not keep two 15k graphs live while old queries finish.
            while self._inflight:
                self._condition.wait()
            # Drop old caches first: a reload must not hold two 15k graphs.
            self._graph = None
            self._signature = None
            self._ready = False
            self._results.clear()
            gc.collect()
            graph = ToolGraph.load(self.graph_path)
            # The serialized retrieval state does not persist this scale hook.
            graph.tune_for_scale()
            engine = graph._get_retrieval_engine()
            if engine._embedding_index is not None:
                provider = engine._embedding_index._provider
                if provider is not None and hasattr(provider, '_get_model'):
                    # Shared MPS inference crashes when independent requests
                    # overlap, even with a lock around encode. Use CPU for
                    # this small query model; graph scoring still overlaps.
                    provider._get_model().to('cpu')
                    import torch
                    torch.set_num_threads(1)
                if provider is not None:
                    engine._embedding_index._provider = _CachedEmbeddingProvider(provider)
                engine.set_embedding_index(_SerializedEmbeddingIndex(engine._embedding_index))
            self._graph = graph
            self._signature = signature
            self.loads += 1
        return self._graph

    def query(self, payload: dict) -> list[dict]:
        query = str(payload.get("query") or "").strip()
        if not query:
            return []
        top_k = max(1, min(int(payload.get("top_k", 8)), 50))
        with self._condition:
            self._last_request = time.monotonic()
            graph = self._load_if_stale()
            key = (query, top_k)
            if key in self._results:
                self.cache_hits += 1
                self._results.move_to_end(key)
                return deepcopy(self._results[key])
            if not self._ready:
                # GraphToolCall lazily creates BM25, prefilter and model state.
                # Complete one real query before sharing those structures.
                results = graph.retrieve_with_scores(query, top_k=top_k, max_graph_depth=2)
                self._ready = True
                records = result_records(results)
                self._results[key] = records
                return deepcopy(records)
            future = self._pending.get(key)
            owner = future is None
            if owner:
                future = Future()
                self._pending[key] = future
                def finish(completed):
                    with self._lock:
                        if self._pending.get(key) is completed:
                            self._pending.pop(key, None)
                future.add_done_callback(finish)
                self._inflight += 1
                self.peak_queries = max(self.peak_queries, self._inflight)
            else:
                self.coalesced += 1
        if not owner:
            timeout = max(0, (payload['deadline'] - time.time() * 1000) / 1000) if 'deadline' in payload else None
            return deepcopy(future.result(timeout=timeout))
        try:
            results = graph.retrieve_with_scores(query, top_k=top_k, max_graph_depth=2)
            records = result_records(results)
            with self._condition:
                self._results[key] = records
                while len(self._results) > 128:
                    self._results.popitem(last=False)
            future.set_result(records)
            return deepcopy(records)
        except BaseException as error:
            future.set_exception(error)
            raise
        finally:
            with self._condition:
                self._inflight -= 1
                self._pending.pop(key, None)
                self._condition.notify_all()



# Windows transport is authenticated loopback TCP. The installer restricts this
# directory to the current user and SYSTEM; no unprotected Unix permission test.
def atomic_json(target, data):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + f".{os.getpid()}.{secrets.token_hex(4)}.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temporary, target)


class WindowsHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(3)
        try:
            line = self.rfile.readline(1048577)
            if not line.endswith(b"\n") or len(line) > 1048576:
                raise ValueError("invalid or oversized request")
            payload = json.loads(line)
            if not hmac.compare_digest(str(payload.pop("token", "")), self.server.token):
                raise PermissionError("authentication failed")
            if payload.get("op") == "health":
                response = {"ok": True, "pid": os.getpid(), "processes": self.server.worker._processes}
            elif payload.get("op") == "stop":
                self.server.stopping.set()
                response = {"ok": True}
            else:
                if payload.get("deadline", 0) < time.time() * 1000:
                    raise TimeoutError("request expired")
                response = {"ok": True, **self.server.worker.query(payload)}
        except Exception as error:
            response = {"ok": False, "error": str(error)}
        try:
            self.wfile.write((json.dumps(response, ensure_ascii=False) + "\n").encode())
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


class WindowsServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    request_queue_size = 128
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, *args, **kwargs):
        self._slots = threading.BoundedSemaphore(32)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        self._slots.acquire()
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


_process_worker = None


def init_process(graph_path):
    global _process_worker
    _process_worker = _GraphWorker(Path(graph_path))


def query_process(payload):
    import numpy as np
    if payload.get("deadline", 0) < time.time() * 1000:
        raise TimeoutError("request expired in queue")
    # The graph and embedding provider persist in each bounded CPU process.
    graph = _process_worker._load_if_stale()
    engine = graph._get_retrieval_engine()
    provider = engine._embedding_index._provider
    if not hasattr(_process_worker,'_paths') or _process_worker._paths[0] is not graph:
        _process_worker._paths=(graph,{t.metadata.get('skill_path'):(name,t.metadata.get('skill_sha256')) for name,t in graph.tools.items() if t.metadata.get('skill_path')})
    by_path = {}
    # Protect semantic recall across the entire graph; graph/category expansion
    # must not exclude the nearest semantic seeds before final ranking.
    query_vector = engine._embedding_index.encode(payload['query'])
    semantic_seeds = engine._embedding_index.search(query_vector, top_k=24)
    for name, similarity in semantic_seeds:
        tool = graph.tools[name]
        metadata = tool.metadata or {}
        record = {'name':metadata.get('skill_name',name),'description':tool.description,
                  'path':metadata.get('skill_path',''),'kind':metadata.get('kind','skill'),
                  'source':'graph-tool-call','rank':50,'semanticScore':float(similarity)}
        by_path[record.get('path') or record['name']] = record
    for record in payload.get("candidates", []):
        if not isinstance(record, dict) or not record.get("path"):
            continue
        entry={**record, "kind": "skill"}
        existing=_process_worker._paths[1].get(record['path'])
        if existing and existing[1] and existing[1]==record.get('sha256'):
            vector=np.asarray(engine._embedding_index._embeddings[existing[0]],dtype=np.float32)
            q=np.asarray(query_vector,dtype=np.float32)
            entry['semanticScore']=float(vector@q/max(float(np.linalg.norm(vector)*np.linalg.norm(q)),1e-12))
        by_path[record["path"]] = entry
    candidates = [r for r in by_path.values() if 'semanticScore' not in r]
    descriptions = []
    spans = []
    for record in candidates:
        start = len(descriptions)
        descriptions.append(f"{record['name']} {record.get('description', '')}")
        descriptions.extend(record.get('aliases', []))
        spans.append((start,len(descriptions)))
    vectors = np.asarray(provider.encode_batch([payload['query'], *descriptions]), dtype=np.float32)
    norm = np.linalg.norm(vectors, axis=1)
    similarities = (vectors[1:] @ vectors[0]) / np.maximum(norm[1:] * norm[0], 1e-12)
    for record, (start,end) in zip(candidates, spans):
        record['semanticScore'] = float(max(similarities[start:end]))
    combined = list(by_path.values())
    combined.sort(key=lambda r: r['semanticScore'], reverse=True)
    return {"results": combined, "queryPid": os.getpid(), "loads": _process_worker.loads}


class WindowsWorker:
    def __init__(self, graph_path, processes):
        self._path = Path(graph_path)
        self._processes = processes
        self._pool = self.new_pool()
        self._signature = None
        self._lock = threading.RLock()
        self._results = OrderedDict()
        self._pending = {}

    def new_pool(self):
        return ProcessPoolExecutor(max_workers=self._processes,
            mp_context=multiprocessing.get_context('spawn'),
            initializer=init_process, initargs=(str(self._path),))

    def query(self, payload):
        info = self._path.stat()
        signature = (info.st_size, info.st_mtime_ns)
        key = (signature, json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str))
        # Volatile deadlines and credentials are not result cache keys.
        stable = {k:v for k,v in payload.items() if k not in ('deadline','token')}
        key = (signature, json.dumps(stable, sort_keys=True, ensure_ascii=False))
        with self._lock:
            if signature != self._signature:
                self._signature = signature
                self._results.clear()
            if key in self._results:
                return {**deepcopy(self._results[key]), "cacheHit": True}
            future = self._pending.get(key)
            if future is None:
                try:
                    future = self._pool.submit(query_process, payload)
                except BrokenProcessPool:
                    self._pool.shutdown(wait=False, cancel_futures=True)
                    self._pool = self.new_pool()
                    self._pending.clear()
                    future = self._pool.submit(query_process, payload)
                self._pending[key] = future
        try:
            result = future.result(timeout=max(0, (payload['deadline'] - time.time()*1000)/1000))
            with self._lock:
                if signature == self._signature:
                    self._results[key] = result
                    while len(self._results) > 128:
                        self._results.popitem(last=False)
            return {**deepcopy(result), "cacheHit": False}
        finally:
            with self._lock:
                if future.done():
                    self._pending.pop(key, None)


def serve(args):
    for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
        os.environ[name] = '1'
    endpoint = Path(args.endpoint)
    endpoint.parent.mkdir(parents=True, exist_ok=True)
    with portalocker.Lock(str(endpoint) + '.lock', timeout=0):
        worker = WindowsWorker(args.graph, args.processes)
        stopping = threading.Event()
        server = WindowsServer(('127.0.0.1', 0), WindowsHandler)
        server.token = secrets.token_hex(32)
        server.worker = worker
        server.stopping = stopping
        server.timeout = 0.5
        atomic_json(endpoint, {"schemaVersion":"codex-graph-endpoint/1", "host":"127.0.0.1",
                    "port":server.server_address[1], "token":server.token, "pid":os.getpid(),
                    "graph":str(Path(args.graph).resolve())})
        revision = Path(__file__).stat().st_mtime_ns
        try:
            while not stopping.is_set() and revision == Path(__file__).stat().st_mtime_ns:
                server.handle_request()
        finally:
            server.server_close()
            worker._pool.shutdown(wait=True, cancel_futures=True)
            endpoint.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    builder = commands.add_parser('build')
    for name in ('root','catalog','output'):
        builder.add_argument('--'+name, required=True)
    builder.add_argument('--records', default='')
    builder.add_argument('--owned-root', default='')
    builder.add_argument('--mcp-catalog', default='')
    builder.add_argument('--embedding', action='store_true')
    builder.add_argument('--model', default='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
    builder.set_defaults(func=build)
    server = commands.add_parser('serve')
    server.add_argument('--graph', required=True)
    server.add_argument('--endpoint', required=True)
    server.add_argument('--processes', type=int, default=2, choices=range(1,5))
    server.set_defaults(func=serve)
    refresher = commands.add_parser('refresh')
    refresher.add_argument('--lock', required=True)
    refresher.add_argument('--node', required=True)
    refresher.add_argument('--script', required=True)
    refresher.add_argument('--wait', type=float, default=0)
    refresher.set_defaults(func=refresh)
    args = parser.parse_args()
    args.func(args)


def refresh(args):
    with portalocker.Lock(args.lock, timeout=args.wait):
        subprocess.run([args.node,args.script],check=True,env={**os.environ,'CODEX_SKILL_REGISTRY_FOREGROUND':'1'},stdin=subprocess.DEVNULL)


if __name__ == '__main__':
    try:
        main()
    except portalocker.exceptions.LockException:
        pass  # A live owner holds the operating-system lock, not a stale PID.

