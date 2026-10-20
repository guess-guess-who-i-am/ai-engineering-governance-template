#!/usr/bin/env python3
"""Build and query the user's external Skill catalog with GraphToolCall."""

from __future__ import annotations

import argparse
from collections import OrderedDict
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from copy import deepcopy
import fcntl
from functools import lru_cache
import gc
import hashlib
import json
import math
import multiprocessing
import os
from pathlib import Path
import re
import signal
import socket
import socketserver
import sqlite3
import struct
import subprocess
import sys
import threading
import time
import warnings

# Import GraphToolCall only after the worker owns the inter-process lock.
EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
RUNTIME_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def attach_embedding_index(graph, previous=None, previous_model=""):
    """Re-encode only changed canonical tool text; never mix model spaces."""
    from graph_tool_call.retrieval.embedding import EmbeddingIndex, SentenceTransformerProvider
    old_index = previous._get_retrieval_engine()._embedding_index if previous is not None else None
    can_reuse = previous_model == EMBEDDING_MODEL and old_index is not None and getattr(old_index._provider, 'model_name', None) == EMBEDDING_MODEL
    provider = old_index._provider if can_reuse else SentenceTransformerProvider(EMBEDDING_MODEL)
    index = EmbeddingIndex(provider=provider)
    changed_names, changed_texts = [], []
    reused = 0
    for name, tool in graph.tools.items():
        text = index._tool_text(tool)
        old_tool = previous.tools.get(name) if can_reuse else None
        if old_tool is not None and name in old_index._embeddings and old_index._tool_text(old_tool) == text:
            index.add(name, old_index._embeddings[name])
            reused += 1
        else:
            changed_names.append(name)
            changed_texts.append(text)
    if changed_texts:
        vectors = provider.encode_batch(changed_texts)
        if len(vectors) != len(changed_names):
            raise ValueError("Embedding provider returned an incomplete rebuild")
        for name, vector in zip(changed_names, vectors):
            index.add(name, vector)
    graph._get_retrieval_engine().set_embedding_index(index)
    graph.tune_for_scale()
    return {"reusedVectors": reused, "encodedVectors": len(changed_names)}


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
            node.metadata.update({"skill_name": record["name"], "skill_path": record["path"]})
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
    root, catalog, output = Path(args.root), Path(args.catalog), Path(args.output)
    records, missing, invalid = load_skills(root, catalog)
    owned_records = load_owned_skills(Path(args.owned_root)) if args.owned_root else []
    records.extend(owned_records)
    mcp_records = []
    if args.mcp_catalog and Path(args.mcp_catalog).is_file():
        data = json.loads(Path(args.mcp_catalog).read_text(encoding="utf-8"))
        mcp_records = data.get("tools", []) if isinstance(data, dict) else []
    graph = graph_from_records(records, mcp_records)
    embedding = "disabled"
    embedding_work = {}
    if args.embedding:
        previous = None
        previous_model = ""
        previous_manifest = output.with_suffix(".manifest.json")
        if output.is_file() and previous_manifest.is_file():
            from graph_tool_call import ToolGraph
            previous_model = json.loads(previous_manifest.read_text(encoding="utf-8")).get("embedding", "")
            if previous_model == EMBEDDING_MODEL:
                previous = ToolGraph.load(output)
        embedding_work = attach_embedding_index(graph, previous, previous_model)
        embedding = EMBEDDING_MODEL
    output.parent.mkdir(parents=True, exist_ok=True)
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
        **embedding_work,
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

    def __init__(self, provider, *, cache_path=None, descriptions=()):
        self._provider = provider
        self._lock = threading.Lock()
        self._vectors = OrderedDict()
        self._descriptions = frozenset(descriptions)
        self._persistent = _DescriptionVectorCache(cache_path, model=getattr(provider, 'model_name', EMBEDDING_MODEL)) if cache_path is not None else None

    def encode(self, text):
        return self.encode_batch([text])[0]

    def encode_batch(self, texts):
        with self._lock:
            missing = list(dict.fromkeys(text for text in texts if text not in self._vectors))
            static = [text for text in missing if text in self._descriptions]
            persisted = self._persistent.get_many(static) if self._persistent and static else {}
            self._vectors.update(persisted)
            missing = [text for text in missing if text not in persisted]
            if missing:
                vectors = self._provider.encode_batch(missing)
                if len(vectors) != len(missing):
                    raise ValueError('embedding provider returned an incomplete batch')
                static_vectors = {}
                for text, vector in zip(missing, vectors):
                    self._vectors[text] = tuple(vector)
                    if text in self._descriptions:
                        static_vectors[text] = vector
                if self._persistent and static_vectors:
                    self._persistent.put_many(static_vectors)
            result = [list(self._vectors[text]) for text in texts]
            for text in texts:
                self._vectors.move_to_end(text)
            while len(self._vectors) > 4096:
                self._vectors.popitem(last=False)
            return result

    def __getattr__(self, name):
        return getattr(self._provider, name)

    def close(self):
        if self._persistent is not None:
            self._persistent.close()


class _DescriptionVectorCache:
    """Shared exact-description memoization; never persist user queries."""

    def __init__(self, file, model=EMBEDDING_MODEL, revision='e8f8c211226b894fcb81acc59f3b34ba3efd5f42'):
        Path(file).parent.mkdir(parents=True, exist_ok=True)
        self._namespace = f'description-f32-v1\0{model}\0{revision}\0'
        self._connection = sqlite3.connect(str(file), timeout=5, check_same_thread=False)
        self._connection.execute('PRAGMA journal_mode=WAL')
        # Derived cache only: preserve consistency without fsync on every miss.
        self._connection.execute('PRAGMA synchronous=NORMAL')
        self._connection.execute('CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, vector BLOB NOT NULL, created REAL NOT NULL)')
        self._connection.commit()

    def _key(self, text):
        return hashlib.sha256((self._namespace + text).encode('utf-8')).hexdigest()

    def get_many(self, texts):
        if not texts:
            return {}
        keys = {self._key(text): text for text in texts}
        placeholders = ','.join('?' for _ in keys)
        rows = self._connection.execute(f'SELECT key,vector FROM vectors WHERE key IN ({placeholders})', list(keys))
        result = {}
        for key, raw in rows:
            if not raw or len(raw) % 4:
                raise RuntimeError('corrupt description vector cache')
            vector = struct.unpack(f'<{len(raw) // 4}f', raw)
            if not all(math.isfinite(value) for value in vector):
                raise RuntimeError('non-finite description vector cache')
            result[keys[key]] = vector
        return result

    def put_many(self, vectors):
        rows = []
        for text, vector in vectors.items():
            if not vector or not all(math.isfinite(value) for value in vector):
                raise RuntimeError('invalid description vector')
            rows.append((self._key(text), struct.pack(f'<{len(vector)}f', *vector), time.time()))
        with self._connection:
            self._connection.executemany('INSERT OR IGNORE INTO vectors VALUES (?,?,?)', rows)
            count = self._connection.execute('SELECT COUNT(*) FROM vectors').fetchone()[0]
            if count > 32768:
                self._connection.execute('DELETE FROM vectors WHERE key IN (SELECT key FROM vectors ORDER BY created LIMIT ?)', (count - 32768,))

    def close(self):
        self._connection.close()


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
        _cache_query_interpretation()
        stat = self.graph_path.stat()
        signature = (stat.st_ino, stat.st_size, stat.st_mtime_ns)
        if self._graph is None or signature != self._signature:
            # Do not keep two 15k graphs live while old queries finish.
            while self._inflight:
                self._condition.wait()
            # Drop old caches first: a reload must not hold two 15k graphs.
            if self._graph is not None:
                old_index = self._graph._get_retrieval_engine()._embedding_index
                if old_index is not None and isinstance(old_index._provider, _CachedEmbeddingProvider):
                    old_index._provider.close()
            self._graph = None
            self._signature = None
            self._ready = False
            self._results.clear()
            gc.collect()
            graph = ToolGraph.load(self.graph_path)
            # The serialized retrieval state does not persist this scale hook.
            graph.tune_for_scale()
            engine = graph._get_retrieval_engine()
            _prepare_keyword_index(engine)
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
                    engine._embedding_index._provider = _CachedEmbeddingProvider(provider,
                        cache_path=self.graph_path.with_suffix('.rerank.sqlite3'),
                        descriptions=(tool.description for tool in graph.tools.values() if tool.description))
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


class _WorkerHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(2)
        try:
            line = self.rfile.readline(262145)
            if not line:
                return
            if len(line) > 262144 or not line.endswith(b"\n"):
                raise ValueError("request exceeds 256 KiB")
            payload = json.loads(line.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("request must be an object")
            if payload.get("deadline", time.time() * 1000 + 1) < time.time() * 1000:
                raise ValueError("request expired in queue")
            results = self.server.worker.query(payload)
            graph = self.server.worker._graph
            response = {"ok": True, "results": results, "pid": os.getpid(),
                        "loads": self.server.worker.loads,
                        "metrics": {"cacheHits": self.server.worker.cache_hits,
                                    "coalesced": self.server.worker.coalesced,
                                    "peakQueries": self.server.worker.peak_queries},
                        "prefilter": bool(graph and graph._get_retrieval_engine()._prefilter_enabled)}
            if isinstance(self.server.worker, _ProcessGraphWorker):
                response.update(self.server.worker._local.report)
        except Exception as error:
            response = {"ok": False, "error": str(error)}
        finally:
            self.server.worker._last_request = time.monotonic()
        try:
            self.wfile.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass


class _WorkerServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    # One graph per user; independent warm queries can overlap, with bounded
    # per-query memory and no unbounded thread fan-out from many Agents.
    request_queue_size = 256
    daemon_threads = False
    block_on_close = True
    max_concurrent_requests = 128

    def __init__(self, socket_path: str, worker: _GraphWorker):
        self.worker = worker
        self._slots = threading.BoundedSemaphore(self.max_concurrent_requests)
        super().__init__(socket_path, _WorkerHandler)

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


_process_worker = None


def _initialize_query_process(graph_path):
    global _process_worker
    _process_worker = _GraphWorker(Path(graph_path))


def _query_process(payload):
    if payload.get('deadline', time.time() * 1000 + 1) < time.time() * 1000:
        raise TimeoutError('request expired before retrieval')
    records = _process_worker.query(payload)
    return records, {'queryPid': os.getpid(), 'loads': _process_worker.loads,
                     'prefilter': bool(_process_worker._graph and _process_worker._graph._get_retrieval_engine()._prefilter_enabled),
                     'metrics': {'cacheHits': _process_worker.cache_hits,
                     'coalesced': _process_worker.coalesced, 'peakQueries': _process_worker.peak_queries}}


class _ProcessGraphWorker:
    """One socket supervisor with a bounded persistent CPU retrieval pool."""

    def __init__(self, graph_path, processes=4):
        self._graph = None
        self._local = threading.local()
        self._last_request = time.monotonic()
        self.loads = self.cache_hits = self.coalesced = self.peak_queries = 0
        self._path = Path(graph_path)
        self._signature = None
        self._lock = threading.RLock()
        self._results = OrderedDict()
        self._pending = {}
        self._processes = processes
        self._pool = self._new_pool()

    def _new_pool(self):
        return ProcessPoolExecutor(max_workers=self._processes,
            mp_context=multiprocessing.get_context('spawn'),
            initializer=_initialize_query_process, initargs=(str(self._path),))

    def _finished(self, key, future):
        with self._lock:
            if self._pending.get(key) is future:
                self._pending.pop(key, None)
            if not future.cancelled() and future.exception() is None and self._signature == key[0]:
                self._results[key] = future.result()
                while len(self._results) > 128:
                    self._results.popitem(last=False)

    def query(self, payload):
        remaining = max(0, (payload['deadline'] - time.time() * 1000) / 1000) if 'deadline' in payload else 50
        info = self._path.stat()
        signature = (info.st_ino, info.st_size, info.st_mtime_ns)
        key = (signature, str(payload.get('query') or '').strip(), max(1, min(int(payload.get('top_k', 8)), 50)))
        with self._lock:
            if self._signature != signature:
                self._results.clear()
                self._signature = signature
            if key in self._results:
                self.cache_hits += 1
                self._results.move_to_end(key)
                records, report = self._results[key]
                self._local.report = report
                return deepcopy(records)
            future = self._pending.get(key)
            if future is None:
                try:
                    future = self._pool.submit(_query_process, payload)
                except BrokenProcessPool:
                    self._pool.shutdown(wait=False, cancel_futures=True)
                    self._pool = self._new_pool()
                    self._pending.clear()
                    future = self._pool.submit(_query_process, payload)
                self._pending[key] = future
            else:
                self.coalesced += 1
        future.add_done_callback(lambda completed: self._finished(key, completed))
        records, report = future.result(timeout=remaining)
        self._local.report = report
        return deepcopy(records)

    def close(self):
        self._pool.shutdown(wait=True, cancel_futures=True)


def serve(args):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
        os.environ[name] = '1'
    socket_path = Path(args.socket)
    socket_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Never unlink the lock: all contenders must lock the same inode.
    with open(str(socket_path) + ".lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        _serve_locked(args, socket_path)


def _serve_locked(args, socket_path):
    socket_path.unlink(missing_ok=True)
    worker = _ProcessGraphWorker(Path(args.graph))
    server = _WorkerServer(str(socket_path), worker)
    server.timeout = 1.0
    os.chmod(socket_path, 0o600)
    source = Path(__file__)
    revision = source.stat().st_mtime_ns
    stopping = threading.Event()
    previous_handler = signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    try:
        try:
            while not stopping.is_set():
                server.handle_request()
                if args.idle_timeout > 0 and time.monotonic() - worker._last_request >= args.idle_timeout:
                    break
                # A deployment replaces this file atomically. Retire the old
                # code on the next loop; the next Hook starts the updated code.
                if source.stat().st_mtime_ns != revision:
                    break
        except KeyboardInterrupt:
            pass
    finally:
        server.server_close()
        worker.close()
        signal.signal(signal.SIGTERM, previous_handler)
        try:
            socket_path.unlink()
        except FileNotFoundError:
            pass


def refresh(args):
    """Run one background registry rebuild per user, independent of Hook timeouts."""
    lock_path = Path(args.lock)
    lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(lock_path, "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        subprocess.run([args.node, args.script], check=True,
                       env={**os.environ, "CODEX_SKILL_REGISTRY_FOREGROUND": "1"},
                       stdin=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--root", required=True)
    build_parser.add_argument("--catalog", required=True)
    build_parser.add_argument("--output", required=True)
    build_parser.add_argument("--embedding", action="store_true")
    build_parser.add_argument("--mcp-catalog")
    build_parser.add_argument("--owned-root", default="")
    build_parser.set_defaults(func=build)
    retrieve_parser = subparsers.add_parser("retrieve")
    retrieve_parser.add_argument("--graph", required=True)
    retrieve_parser.add_argument("--query", required=True)
    retrieve_parser.add_argument("--top-k", type=int, default=8)
    retrieve_parser.set_defaults(func=retrieve)
    serve_parser = subparsers.add_parser("serve")
    serve_parser.add_argument("--graph", required=True)
    serve_parser.add_argument("--socket", required=True)
    serve_parser.add_argument("--idle-timeout", type=float, default=0.0)
    serve_parser.set_defaults(func=serve)
    refresh_parser = subparsers.add_parser("refresh")
    refresh_parser.add_argument("--lock", required=True)
    refresh_parser.add_argument("--node", required=True)
    refresh_parser.add_argument("--script", required=True)
    refresh_parser.set_defaults(func=refresh)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"graph_skill_index: {error}", file=sys.stderr)
        raise
