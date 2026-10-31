#!/usr/bin/env python3
"""Build and query the user's external Skill catalog with GraphToolCall."""

from __future__ import annotations

import argparse
import ast
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from copy import deepcopy
import fcntl
from functools import lru_cache
import gc
import hashlib
import inspect
import json
import multiprocessing
import math
import os
from pathlib import Path
import re
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import textwrap
import time
import warnings

QUERY_EXECUTION_MAX_MS = 55_000

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
    if args.embedding:
        graph.enable_embedding("sentence-transformers/all-MiniLM-L6-v2")
        graph.tune_for_scale()
        embedding = "sentence-transformers/all-MiniLM-L6-v2"
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
    _accelerate_term_matching()


def _accelerate_term_matching():
    """Only Korean terms need substring matching; classify immutable sets once."""
    from graph_tool_call.retrieval import semantic_scorer
    if hasattr(semantic_scorer._matching_terms, 'korean_cache'):
        return
    original = semantic_scorer._matching_terms
    if hashlib.sha256(inspect.getsource(original).encode()).hexdigest() != 'a22287df10d4af2974d8c6270bcfc03ade932f94500b15c85f05ecb9816ef193':
        warnings.warn('Unsupported semantic matcher revision; retaining upstream matching')
        return
    @lru_cache(maxsize=65536)
    def korean_terms(terms):
        return frozenset(term for term in terms if len(term) >= 2 and re.fullmatch(r'[가-힣]+', term))
    def matching_terms(left, right):
        # The old wrapper exposes frozensets, but upstream mutates the
        # intersection on Korean partial matches. Keep the return a fresh set.
        matches = set(left & right)
        korean_left = korean_terms(frozenset(left)) - matches
        if korean_left:
            korean_right = korean_terms(frozenset(right))
            for term in korean_left:
                if any(term in other or other in term for other in korean_right):
                    matches.add(term)
        return matches
    matching_terms.__wrapped__ = original
    matching_terms.korean_cache = korean_terms
    semantic_scorer._matching_terms = matching_terms


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


_KEYWORD_ORIGINALS = {}


def _specialize_query_facts(function):
    """Hoist only pure query expressions, not tool expressions or global re.

    Compile the installed function itself: no copied library implementation.
    All candidate logic, short-circuiting and scoring remain in that function.
    Cached facts are bounded per function and use the full, unmodified query.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(function)))
    definition = tree.body[0]
    definition.decorator_list = []
    expressions = []
    class QueryFacts(ast.NodeTransformer):
        def visit(self, node):
            if isinstance(node, (ast.Compare, ast.BoolOp, ast.UnaryOp, ast.Call)):
                names = {part.id for part in ast.walk(node) if isinstance(part, ast.Name)}
                if names & {'q', 'query'} and names <= {'q', 'query', 're', 'BM25Scorer'}:
                    # These functions contain only literal comparisons, regex
                    # predicates and pure BM25 intent calls with this signature.
                    expressions.append(compile(ast.Expression(node), '<query-fact>', 'eval'))
                    return ast.copy_location(ast.Subscript(value=ast.Name(id='__facts', ctx=ast.Load()), slice=ast.Constant(len(expressions)-1), ctx=ast.Load()), node)
            return super().visit(node)
    definition = QueryFacts().visit(definition)
    @lru_cache(maxsize=256)
    def facts(query):
        scope = {'query': query, 'q': query.lower()}
        return tuple(eval(expression, function.__globals__, scope) for expression in expressions)
    definition.body.insert(0, ast.parse('__facts = __query_facts(query)').body[0])
    namespace = dict(function.__globals__, __query_facts=facts)
    exec(compile(ast.fix_missing_locations(tree), '<specialized-keyword>', 'exec'), namespace)
    specialized = namespace[function.__name__]
    specialized.__wrapped__ = function
    specialized.query_cache = facts
    return specialized


def _restore_keyword_interpretation():
    """For independent equivalence tests; never used to change a live worker."""
    from graph_tool_call.retrieval.keyword import BM25Scorer
    for name, function in _KEYWORD_ORIGINALS.items():
        setattr(BM25Scorer, name, staticmethod(function))
    _KEYWORD_ORIGINALS.clear()


def _accelerate_keyword_scoring(engine):
    """Exact sparse BM25 and once-per-query interpretation for large catalogs."""
    from graph_tool_call.retrieval.keyword import BM25Scorer
    # This exact-score adapter is pinned to the tested upstream implementation.
    # A library upgrade must pass equivalence tests before using the fast path.
    if hashlib.sha256(inspect.getsource(BM25Scorer.score).encode()).hexdigest() != '63f083a790d7a5abbae5ce970a10c664efe956bd1ff6a81c1e9807c6c81e37c9':
        warnings.warn('Unsupported BM25 scorer revision; retaining upstream scoring')
        return
    if not _KEYWORD_ORIGINALS:
        for name in dir(BM25Scorer):
            if name.startswith('_has_') and name.endswith('_intent'):
                function = getattr(BM25Scorer, name)
                _KEYWORD_ORIGINALS[name] = function
                setattr(BM25Scorer, name, staticmethod(lru_cache(maxsize=256)(function)))
        for name in ('_semantic_phrase_multiplier', '_route_planning_phrase_multiplier', '_korean_business_phrase_multiplier'):
            function = getattr(BM25Scorer, name)
            _KEYWORD_ORIGINALS[name] = function
            setattr(BM25Scorer, name, staticmethod(_specialize_query_facts(function)))
    scorer = engine._get_bm25()
    if getattr(scorer, '_sparse_index_ready', False):
        return
    postings = {}
    order = {name: number for number, name in enumerate(scorer._tool_tokens)}
    for name, terms in scorer._tf_maps.items():
        for term, frequency in terms.items():
            postings.setdefault(term, []).append((name, frequency))
    idfs = {term: math.log((scorer._n_docs-df+0.5)/(df+0.5)+1.0) for term, df in scorer._doc_freqs.items()}
    def score(query, *, restrict=None):
        raw_tokens = scorer._tokenize_fn(query)
        if not raw_tokens:
            return {}
        filtered = [term for term in raw_tokens if term not in scorer._stopwords]
        query_tokens = scorer._expand_query_tokens(filtered or raw_tokens, query)
        scores = {}
        # Preserve repeated query terms and each document's original floating
        # point summation order; skip only contributions whose tf is zero.
        for term in query_tokens:
            for name, tf in postings.get(term, ()):
                if restrict is not None and name not in restrict:
                    continue
                numerator = tf*(scorer._k1+1.0)
                denominator = tf+scorer._k1*(1.0-scorer._b+scorer._b*scorer._doc_lens[name]/scorer._avg_dl)
                scores[name] = scores.get(name, 0.0)+idfs[term]*numerator/denominator
        result = {}
        for name in sorted(scores, key=order.__getitem__):
            value = scores[name]
            name_len = scorer._name_token_counts.get(name, 0)
            if name_len > 6:
                value *= 1.0/(1.0+0.15*(name_len-6))
            value *= scorer._name_subsequence_boost(query_tokens, name)
            value *= scorer._semantic_phrase_boost(query, name, scorer._tools[name])
            result[name] = value
        return result
    scorer.score = score
    scorer._sparse_index_ready = True


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


class _SharedQuery:
    """One computation plus the callers currently waiting for its result."""

    def __init__(self, future):
        self.future = future
        self.waiters = 0
        self.abandoned = False


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
        self._executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="graph-query")
        self.cache_hits = 0
        self.coalesced = 0
        self.cancelled_pending = 0
        self.abandoned_running = 0
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
            _accelerate_keyword_scoring(engine)
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
            shared = self._pending.get(key)
            if shared is None:
                shared = _SharedQuery(self._executor.submit(
                    self._retrieve, graph, query, top_k))
                self._pending[key] = shared
                self._inflight += 1
                self.peak_queries = max(self.peak_queries, self._inflight)
                shared.future.add_done_callback(
                    lambda completed, key=key, shared=shared:
                    self._finished(key, shared, completed))
            else:
                self.coalesced += 1
            shared.waiters += 1
            future = shared.future
        timeout = max(0, (payload['deadline'] - time.time() * 1000) / 1000) if 'deadline' in payload else None
        try:
            return deepcopy(future.result(timeout=timeout))
        except BaseException:
            self._release_waiter(key, shared)
            raise
        finally:
            if not future.cancelled() and future.done():
                self._release_waiter(key, shared)

    @staticmethod
    def _retrieve(graph, query, top_k):
        results = graph.retrieve_with_scores(query, top_k=top_k, max_graph_depth=2)
        return result_records(results)

    def _release_waiter(self, key, shared):
        with self._condition:
            if shared.waiters > 0:
                shared.waiters -= 1
            if shared.waiters == 0 and not shared.future.done() and not shared.abandoned:
                shared.abandoned = True
                if shared.future.cancel():
                    self.cancelled_pending += 1
                else:
                    self.abandoned_running += 1

    def _finished(self, key, shared, future):
        with self._condition:
            if self._pending.get(key) is not shared:
                return
            if not future.cancelled() and future.exception() is None and not shared.abandoned:
                self._results[key] = future.result()
                while len(self._results) > 128:
                    self._results.popitem(last=False)
            self._pending.pop(key, None)
            self._inflight -= 1
            self._condition.notify_all()

    def close(self):
        self._executor.shutdown(wait=True, cancel_futures=True)


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
                                    "peakQueries": self.server.worker.peak_queries,
                                    "cancelledPending": self.server.worker.cancelled_pending,
                                    "abandonedRunning": self.server.worker.abandoned_running},
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
    if payload.get('execution_deadline', time.time() * 1000 + QUERY_EXECUTION_MAX_MS) < time.time() * 1000:
        raise TimeoutError('request expired before retrieval')
    records = _process_worker.query(payload)
    return records, {'queryPid': os.getpid(), 'loads': _process_worker.loads,
                     'prefilter': bool(_process_worker._graph and _process_worker._graph._get_retrieval_engine()._prefilter_enabled),
                     'metrics': {'cacheHits': _process_worker.cache_hits,
                     'coalesced': _process_worker.coalesced, 'peakQueries': _process_worker.peak_queries,
                     'cancelledPending': _process_worker.cancelled_pending,
                     'abandonedRunning': _process_worker.abandoned_running}}


class _ProcessGraphWorker:
    """One socket supervisor with a bounded persistent CPU retrieval pool."""

    def __init__(self, graph_path, processes=4):
        self._graph = None
        self._local = threading.local()
        self._last_request = time.monotonic()
        self.loads = self.cache_hits = self.coalesced = self.peak_queries = 0
        self.cancelled_pending = self.abandoned_running = 0
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

    def _finished(self, key, shared, future):
        with self._lock:
            if self._pending.get(key) is not shared:
                return
            if not future.cancelled() and future.exception() is None and not shared.abandoned and self._signature == key[0]:
                self._results[key] = future.result()
                while len(self._results) > 128:
                    self._results.popitem(last=False)
            self._pending.pop(key, None)

    def _release_waiter(self, key, shared):
        with self._lock:
            if shared.waiters > 0:
                shared.waiters -= 1
            if shared.waiters == 0 and not shared.future.done() and not shared.abandoned:
                shared.abandoned = True
                if shared.future.cancel():
                    self.cancelled_pending += 1
                else:
                    self.abandoned_running += 1

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
            shared = self._pending.get(key)
            if shared is None:
                try:
                    execution_payload = dict(payload)
                    execution_payload['execution_deadline'] = time.time() * 1000 + QUERY_EXECUTION_MAX_MS
                    future = self._pool.submit(_query_process, execution_payload)
                except BrokenProcessPool:
                    self._pool.shutdown(wait=False, cancel_futures=True)
                    self._pool = self._new_pool()
                    self._pending.clear()
                    execution_payload = dict(payload)
                    execution_payload['execution_deadline'] = time.time() * 1000 + QUERY_EXECUTION_MAX_MS
                    future = self._pool.submit(_query_process, execution_payload)
                shared = _SharedQuery(future)
                self._pending[key] = shared
                future.add_done_callback(
                    lambda completed, key=key, shared=shared:
                    self._finished(key, shared, completed))
            else:
                self.coalesced += 1
            shared.waiters += 1
            future = shared.future
        try:
            records, report = future.result(timeout=remaining)
        except BaseException:
            self._release_waiter(key, shared)
            raise
        finally:
            if not future.cancelled() and future.done():
                self._release_waiter(key, shared)
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
