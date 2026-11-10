#!/usr/bin/env python3
"""Build and query the user's external Skill catalog with GraphToolCall."""

from __future__ import annotations

import argparse
import ast
import inspect
import textwrap
from collections import OrderedDict
from contextvars import ContextVar
from concurrent.futures import Future, ProcessPoolExecutor, ThreadPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from copy import copy, deepcopy
import os
if os.name == 'nt':
    import msvcrt
else:
    import fcntl
from functools import lru_cache
import gc
import hashlib
import json
import multiprocessing
from pathlib import Path
from types import SimpleNamespace
import re
import secrets
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import warnings

# Also support importlib-based consumers outside this directory. Keep the
# embedding dependency lazy so keyword-only graphs need no torch installation.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Import GraphToolCall only after the worker owns the inter-process lock.
QUERY_EXECUTION_MAX_MS = 55_000

RETRIEVAL_CONTENT = 'declared-name-capability-only/v1'


def retrieval_name(tool):
    metadata = tool.metadata or {}
    return metadata.get('skill_name', metadata.get('mcp_original_name', tool.name))


def retrieval_tool_text(tool):
    return ' '.join(part for part in (retrieval_name(tool), tool.description) if part)


def prepare_content_retrieval(engine):
    """Keep transport keys out of every lexical document and name heuristic."""
    if getattr(engine, '_codex_content_retrieval', False):
        return
    from graph_tool_call.retrieval.keyword import BM25Scorer
    projected = {}
    for identifier, tool in engine._tools.items():
        document = copy(tool)
        document.name = retrieval_name(tool)
        document.tags, document.parameters, document.metadata = [], [], {}
        projected[identifier] = document
    scorer = BM25Scorer(projected, tokenizer=engine._tokenize)
    for identifier, tool in projected.items():
        tokens = scorer._tokenize_fn(tool.name)
        scorer._name_tokens[identifier] = tokens
        scorer._name_token_counts[identifier] = len(tokens)
    scorer._semantic_phrase_boost = lambda query, identifier, tool: BM25Scorer._semantic_phrase_multiplier(
        query, projected[identifier].name, projected[identifier])
    engine._bm25 = scorer
    # Generated server/kind groups are structural, not capability descriptions.
    # Upstream reverse-indexes neighbor IDs into these categories; an empty
    # semantic category index prevents those hidden identifier matches. Explicit
    # requires/precedes graph traversal and metadata-based quotas remain active.
    engine._searcher._category_index = {}
    phrase = type(engine)._boost_semantic_phrase_matches
    def boost_phrases(query, scores):
        # Let the library keep its phrase rules, with readable names as data.
        # Process separately so duplicate public names retain distinct results.
        for identifier in scores:
            tool = projected[identifier]
            view = SimpleNamespace(_tools={tool.name: tool})
            value = {tool.name: scores[identifier]}
            phrase(view, query, value)
            scores[identifier] = value[tool.name]
    engine._boost_semantic_phrase_matches = boost_phrases
    signature = engine._tool_signature
    engine._tool_signature = lambda identifier: signature(projected[identifier].name)
    engine._codex_content_retrieval = True


def chinese_tokenize(text: str) -> list[str]:
    """Keep upstream Latin/Korean behavior; index Han spans symmetrically.

    Character bigrams need no model, dictionary, translation request, or network.
    Never emit bigrams across punctuation/Latin boundaries.
    """
    from graph_tool_call.retrieval.keyword import BM25Scorer
    tokens = []
    for part in re.split(r"([\u3400-\u4dbf\u4e00-\u9fff]+)", text):
        if not part:
            continue
        if re.fullmatch(r"[\u3400-\u4dbf\u4e00-\u9fff]+", part):
            tokens.extend([part] if len(part) == 1 else
                          [part[i:i + 2] for i in range(len(part) - 1)])
        else:
            tokens.extend(BM25Scorer._tokenize(part))
    return tokens


def english_retrieval_description(tool):
    """Keep server capabilities; only undo actual Skill/tool translations.

    An imported service's original_description can describe its parent plugin.
    It is provenance, not the service schema. Both lexical and embedding builds
    must use the capability assembled from the audited service/tool inventory.
    """
    metadata = tool.metadata or {}
    if metadata.get('kind') == 'mcp-service':
        return tool.description
    original = metadata.get('retrieval_original_description')
    return tool.description if original is None else original


def english_retrieval_graph(graph):
    """Share immutable ontology/vectors; keep the prior Latin lexical channel.

    Only translated tool schemas are shallow-copied, not the 248 MB graph or
    embedding model. Each channel owns its BM25/prefilter caches.
    """
    english = copy(graph)
    english._tools = dict(graph.tools)
    for name, tool in graph.tools.items():
        description = english_retrieval_description(tool)
        if description != tool.description:
            english._tools[name] = copy(tool)
            english._tools[name].description = description
    english._retrieval = None
    english._tokenizer = None
    english.tune_for_scale()
    source_engine = graph._get_retrieval_engine()
    target_engine = english._get_retrieval_engine()
    if graph.metadata.get('retrieval_content') == RETRIEVAL_CONTENT:
        prepare_content_retrieval(target_engine)
    target_engine.set_embedding_index(source_engine._embedding_index)
    if source_engine._weights_manual:
        target_engine.set_weights(keyword=source_engine._keyword_weight, graph=source_engine._graph_weight,
                                  embedding=source_engine._embedding_weight, annotation=source_engine._annotation_weight)
    _prepare_keyword_index(english._get_retrieval_engine())
    return english


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
    directory_path = (resolved_root / relative).resolve()
    if not directory_path.is_relative_to(resolved_root) or not directory_path.is_dir():
        return None
    skill_path = directory_path / "SKILL.md"
    # macOS commonly ignores case; Linux does not. Preserve original upstream
    # filenames and return the exact path rather than creating duplicate files.
    entries = list(directory_path.iterdir())
    if not any(entry.name == "SKILL.md" for entry in entries):
        matches = [entry for entry in entries if entry.name.casefold() == "skill.md"]
        if len(matches) != 1:
            return None
        skill_path = matches[0]
    skill_path = skill_path.resolve()
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
        ]
        description = " ".join(str(value).strip() for value in fields if value)
        records.append({
            "name": name,
            "tool_name": tool_name,
            "description": description,
            "path": str(target),
            "categories": [],
            "tags": [],
        })
    return records, missing, invalid


def load_owned_skills(root: Path):
    records = []
    if not root.is_dir():
        return records
    translation_file = Path(__file__).with_name('skill-retrieval.zh.json')
    translations = json.loads(translation_file.read_text(encoding='utf-8'))['descriptions'] if translation_file.is_file() else {}
    for target in sorted(root.glob("*/SKILL.md")):
        text = target.read_text(encoding="utf-8")
        block = re.search(r"^---\s*\n([\s\S]*?)\n---", text, re.M)
        frontmatter = block.group(1) if block else ""
        name_match = re.search(r"^name:\s*(.+)$", frontmatter, re.M)
        description_match = re.search(r"^description:\s*(.+)$", frontmatter, re.M)
        name = name_match.group(1).strip().strip("'\"") if name_match else target.parent.name
        description = description_match.group(1).strip().strip("'\"") if description_match else ""
        original_description = description
        if name in translations:
            description += '\n' + translations[name]
        digest = hashlib.sha1(str(target).encode()).hexdigest()[:8]
        records.append({"name": name, "tool_name": f"skill_{re.sub(r'[^a-zA-Z0-9_-]+', '_', name).strip('_')[:60]}_{digest}",
                        "description": description, "original_description": original_description, "path": str(target), "categories": [], "tags": [], "source": "owned"})
    return records


def load_resource_modules(catalog):
    """Validate a published module catalog; never crawl packages during routing."""
    if not catalog:
        return []
    data = json.loads(Path(catalog).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schemaVersion") != "codex-resource-modules/1" or not isinstance(data.get("modules"), list):
        raise ValueError("Invalid resource module catalog schema")
    records, seen = [], set()
    for module in data["modules"]:
        if not isinstance(module, dict):
            raise ValueError("Resource module must be an object")
        for field in ("id", "name", "description", "path", "package_root"):
            if not isinstance(module.get(field), str) or not module[field].strip():
                raise ValueError(f"Resource module requires nonempty {field}")
        identifier = module["id"]
        if identifier in seen:
            raise ValueError(f"Duplicate resource module id: {identifier}")
        seen.add(identifier)
        if module.get("kind") not in ("expert", "skill", "mcp-service"):
            raise ValueError(f"Invalid resource module kind: {identifier}")
        target, package_root = Path(module["path"]), Path(module["package_root"])
        if not target.is_absolute() or not target.is_file() or not package_root.is_absolute() or not package_root.is_dir():
            raise ValueError(f"Resource module entry/package path missing or not absolute: {identifier}")
        for field in ("dependencies", "members"):
            if not isinstance(module.get(field, []), list):
                raise ValueError(f"Resource module {field} must be an array: {identifier}")
        if not isinstance(module.get("availability"), (str, dict)):
            raise ValueError(f"Resource module requires availability: {identifier}")
        slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", identifier).strip("_")[:48] or "module"
        records.append({**module, "module_id": identifier,
                        "tool_name": f"resource_{slug}_{hashlib.sha256(identifier.encode()).hexdigest()[:12]}",
                        "tags": [], "categories": [],
                        "dependencies": module.get("dependencies", []), "members": module.get("members", [])})
    return records


RESOURCE_METADATA_FIELDS = ("kind", "module_id", "package_root", "availability", "dependencies",
                            "members", "source", "license", "entry_hash", "package_hash", "retrieval_provenance")


def graph_from_records(records, mcp_records=None, resource_records=None):
    from graph_tool_call import ToolGraph
    graph = ToolGraph()
    all_records = [*records, *(resource_records or [])]
    mcp_tools = [{
        "name": record["tool_name"],
        "description": record.get("retrieval_document", record["description"]),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True},
    } for record in all_records]
    graph.ingest_mcp_tools(mcp_tools, server_name="global-skills", detect_dependencies=False)
    for record in all_records:
        node = graph.tools.get(record["tool_name"])
        if node is not None:
            node.metadata.update({"skill_name": record["name"], "skill_path": record["path"]})
            node.metadata.update({key: record[key] for key in RESOURCE_METADATA_FIELDS if key in record})
            if record.get('kind') == 'expert':
                node.metadata['capability_description'] = record['description']
            if 'original_description' in record:
                node.metadata['retrieval_original_description'] = record.get('retrieval_original_document', record['original_description'])
    mcp_translations_file = Path(__file__).with_name('mcp-retrieval.zh.json')
    mcp_translations = json.loads(mcp_translations_file.read_text(encoding='utf-8'))['descriptions'] if mcp_translations_file.is_file() else {}
    for record in mcp_records or []:
        tool_name = record.get("tool_name")
        if not tool_name:
            continue
        description = record.get('description', '')
        translation = mcp_translations.get(f"{record.get('server', '')}/{record.get('name', '')}")
        if translation:
            description += '\n' + translation
        graph.ingest_mcp_tools([{
            "name": tool_name,
            "description": description,
            "inputSchema": record.get("inputSchema", {"type": "object"}),
            **({"outputSchema": record["outputSchema"]} if record.get("outputSchema") else {}),
            "annotations": record.get("annotations", {})
        }], server_name=record.get("server", "global-mcp"), detect_dependencies=False)
        node = graph.tools.get(tool_name)
        if node is not None:
            node.metadata.update({"kind": "mcp", "mcp_server": record.get("server", ""), "mcp_original_name": record.get("name", tool_name)})
            if translation:
                node.metadata['retrieval_original_description'] = record.get('description', '')
    # Resolve only explicit, unique identifiers. A package member is metadata,
    # not an independently routable role or an inferred dependency.
    aliases = {}
    for tool_name, node in graph.tools.items():
        for alias in {tool_name, node.metadata.get("module_id"), node.metadata.get("skill_name"), node.metadata.get("mcp_original_name")} - {None, ""}:
            aliases.setdefault(alias, set()).add(tool_name)
        if node.metadata.get("mcp_server") and node.metadata.get("mcp_original_name"):
            aliases.setdefault(f"{node.metadata['mcp_server']}/{node.metadata['mcp_original_name']}", set()).add(tool_name)
    for record in resource_records or []:
        for dependency in record["dependencies"]:
            if isinstance(dependency, str):
                key = dependency
            elif isinstance(dependency, dict):
                key = dependency.get("tool_name") or dependency.get("module_id") or dependency.get("name")
                if dependency.get("server") and dependency.get("name") and not dependency.get("tool_name") and not dependency.get("module_id"):
                    key = f"{dependency['server']}/{dependency['name']}"
            else:
                continue
            targets = aliases.get(key, set()) if isinstance(key, str) else set()
            if len(targets) == 1:
                target = next(iter(targets))
                if target != record["tool_name"]:
                    graph.add_relation(record["tool_name"], target, "requires", confidence="EXTRACTED", conf_score=1.0, layer=1, evidence="Explicit resource catalog dependency, exact unique identifier match")
    from artifact_relations import enrich_artifact_relations
    enrich_artifact_relations(graph)
    from semantic_relations import apply_semantic_relations
    graph.metadata['semantic_relations'] = apply_semantic_relations(graph)
    graph.metadata['retrieval_content'] = RETRIEVAL_CONTENT
    return graph


def build(args):
    root, catalog, output = Path(args.root), Path(args.catalog), Path(args.output)
    records, missing, invalid = load_skills(root, catalog)
    if getattr(args, 'require_complete', False) and (missing or invalid):
        raise ValueError(f"Catalog incomplete: {missing} missing and {invalid} invalid Skills; keeping the previous graph")
    owned_records = load_owned_skills(Path(args.owned_root)) if args.owned_root else []
    records.extend(owned_records)
    mcp_records = []
    if args.mcp_catalog and Path(args.mcp_catalog).is_file():
        data = json.loads(Path(args.mcp_catalog).read_text(encoding="utf-8"))
        mcp_records = data.get("tools", []) if isinstance(data, dict) else []
    resource_catalog = getattr(args, "resource_catalog", None)
    resource_records = load_resource_modules(resource_catalog)
    graph = graph_from_records(records, mcp_records, resource_records) if resource_records else graph_from_records(records, mcp_records)
    graph.set_tokenizer(chinese_tokenize)
    embedding = "disabled"
    if args.embedding:
        from complete_embedding import complete_provider
        from graph_tool_call.retrieval.embedding import EmbeddingIndex, SentenceTransformerProvider
        english = english_retrieval_graph(graph)
        index = EmbeddingIndex(provider=complete_provider(
            SentenceTransformerProvider("sentence-transformers/all-MiniLM-L6-v2")))
        index._embeddings = dict(zip(english.tools, index._provider.encode_batch(
            [retrieval_tool_text(tool) for tool in english.tools.values()])))
        english._get_retrieval_engine().set_embedding_index(index)
        graph._get_retrieval_engine().set_embedding_index(english._get_retrieval_engine()._embedding_index)
        graph.tune_for_scale()
        embedding = "sentence-transformers/all-MiniLM-L6-v2"
    output.parent.mkdir(parents=True, exist_ok=True)
    metadata = {"skill_count": len(records), "catalog": str(catalog), "resource_module_count": len(resource_records)}
    metadata['artifact_relations'] = graph.metadata['artifact_relations']
    metadata['artifact_relation_sources'] = graph.metadata['artifact_relation_sources']
    metadata['semantic_relations'] = graph.metadata['semantic_relations']
    if getattr(args, 'require_complete', False) and metadata['artifact_relations']['readErrors']:
        raise ValueError('Artifact declaration files could not be read; keeping the previous graph')
    metadata['retrieval_content'] = RETRIEVAL_CONTENT
    if args.embedding:
        from complete_embedding import REPRESENTATION
        metadata['embedding_representation'] = REPRESENTATION
    chinese_model = getattr(args, 'chinese_embedding', '')
    if chinese_model:
        if not args.embedding:
            raise ValueError('Chinese embedding requires the English embedding channel')
        metadata['chinese_embedding'] = build_chinese_embedding(graph, output, chinese_model)
    if args.embedding:
        metadata['description_embeddings'] = {
            'en': build_description_embeddings(english, output, embedding),
            **({'zh': build_description_embeddings(graph, output, chinese_model)} if chinese_model else {}),
        }
    temporary = output.with_suffix(output.suffix + f".{os.getpid()}.tmp")
    graph.save(temporary, metadata=metadata)
    temporary.replace(output)
    digest = hashlib.sha256()
    with catalog.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    manifest = {
        "schemaVersion": "graph-tool-call-skills/1",
        "graphToolCallVersion": "0.46.0",
        "embedding": embedding,
        "embeddingRepresentation": metadata.get('embedding_representation', ''),
        "chineseEmbedding": chinese_model,
        "retrievalProfile": "bilingual-cjk-language-routed/1",
        "retrievalContent": RETRIEVAL_CONTENT,
        "generatedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
        "rootPath": str(root.resolve()),
        "catalogPath": str(catalog.resolve()),
        "catalogSha256": digest.hexdigest(),
        "catalogSkillCount": len(records) + missing + invalid,
        "skillCount": len(records),
        "externalSkillCount": len(records) - len(owned_records),
        "ownedSkillCount": len(owned_records),
        "mcpToolCount": len(mcp_records),
        "resourceModuleCount": len(resource_records),
        "artifactRelations": graph.metadata.get("artifact_relations", {}),
        "semanticRelations": graph.metadata.get("semantic_relations", {}),
        "resourceModuleCounts": {kind: sum(record["kind"] == kind for record in resource_records) for kind in ("expert", "skill", "mcp-service")},
        "resourceCatalogPath": str(Path(resource_catalog).resolve()) if resource_catalog else "",
        "missingSkillCount": missing,
        "invalidSkillCount": invalid,
        "graphPath": str(output),
    }
    manifest_path = output.with_suffix(".manifest.json")
    temp_manifest = manifest_path.with_suffix(manifest_path.suffix + f".{os.getpid()}.tmp")
    temp_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_manifest.replace(manifest_path)
    print(json.dumps(manifest, ensure_ascii=False))


def build_chinese_embedding(graph, output, model_name):
    """Content-addressed portable sidecar; publish before the graph pointer."""
    import numpy as np
    from complete_embedding import encode_complete, REPRESENTATION
    from graph_tool_call.retrieval.embedding import SentenceTransformerProvider
    names = list(graph.tools)
    texts = [retrieval_tool_text(graph.tools[n]) for n in names]
    signature = hashlib.sha256(json.dumps([REPRESENTATION, model_name, names, texts], ensure_ascii=False).encode()).hexdigest()
    target = output.parent / f'{output.stem}.zh.{signature[:20]}.npz'
    if not target.exists():
        provider = SentenceTransformerProvider(model_name)
        model = provider._get_model()
        vectors = encode_complete(model, texts)
        temporary = target.with_suffix(f'.{os.getpid()}.tmp')
        with temporary.open('wb') as stream:
            np.savez_compressed(stream, names=np.asarray(names), vectors=vectors, signature=signature)
        temporary.replace(target)
    return {'file': target.name, 'model': model_name, 'representation': REPRESENTATION, 'signature': signature,
            'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


def load_chinese_embedding(graph, graph_path):
    from graph_tool_call.retrieval.embedding import EmbeddingIndex, SentenceTransformerProvider
    from complete_embedding import complete_provider, REPRESENTATION
    import numpy as np
    config = graph.metadata.get('chinese_embedding')
    if not config:
        return None
    if config.get('representation') != REPRESENTATION:
        raise ValueError('Chinese embedding representation is obsolete; rebuild the graph')
    relative = Path(config['file'])
    if relative.is_absolute() or len(relative.parts) != 1:
        raise ValueError('Invalid Chinese embedding sidecar path')
    target = graph_path.parent / relative
    if hashlib.sha256(target.read_bytes()).hexdigest() != config['sha256']:
        raise ValueError('Chinese embedding sidecar checksum mismatch')
    with np.load(target, allow_pickle=False) as data:
        names, vectors = list(data['names']), data['vectors']
        if names != list(graph.tools) or str(data['signature']) != config['signature']:
            raise ValueError('Chinese embedding sidecar does not match the graph')
    if vectors.shape != (len(names), 384) or not np.isfinite(vectors).all():
        raise ValueError('Invalid Chinese embedding vectors')
    index = EmbeddingIndex(provider=complete_provider(SentenceTransformerProvider(config['model'])))
    # Keep float32 array views instead of 6 million boxed Python floats.
    index._embeddings = dict(zip(names, vectors))
    return index


def _description_cache_inputs(graph, output, model_name):
    from complete_embedding import REPRESENTATION
    texts = list(dict.fromkeys(tool.description for tool in graph.tools.values() if tool.description))
    signature = hashlib.sha256(json.dumps([REPRESENTATION, model_name, texts], ensure_ascii=False).encode()).hexdigest()
    return texts, signature, output.parent / f'{output.stem}.rerank.{signature[:20]}.npz'


def build_description_embeddings(graph, output, model_name):
    """Persist description-only reranking vectors, separately from tool vectors."""
    import numpy as np
    from complete_embedding import encode_complete, REPRESENTATION
    from graph_tool_call.retrieval.embedding import SentenceTransformerProvider
    texts, signature, target = _description_cache_inputs(graph, output, model_name)
    if not target.exists():
        model = SentenceTransformerProvider(model_name)._get_model()
        vectors = encode_complete(model, texts)
        temporary = target.with_suffix(f'.{os.getpid()}.tmp')
        with temporary.open('wb') as stream:
            np.savez_compressed(stream, texts=np.asarray(texts), vectors=vectors, signature=signature)
        temporary.chmod(0o600)
        temporary.replace(target)
    return {'file': target.name, 'model': model_name, 'representation': REPRESENTATION, 'signature': signature,
            'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


def load_description_embeddings(graph, graph_path, language):
    import numpy as np
    from complete_embedding import REPRESENTATION
    config = graph.metadata.get('description_embeddings', {}).get(language)
    if not config:
        return {}
    if config.get('representation') != REPRESENTATION:
        raise ValueError('Description embedding representation is obsolete; rebuild the graph')
    texts, signature, expected = _description_cache_inputs(graph, graph_path, config['model'])
    if config['file'] != expected.name or config['signature'] != signature:
        raise ValueError('Description embedding identity/path mismatch')
    if hashlib.sha256(expected.read_bytes()).hexdigest() != config['sha256']:
        raise ValueError('Description embedding checksum mismatch')
    with np.load(expected, allow_pickle=False) as data:
        if list(data['texts']) != texts or str(data['signature']) != signature:
            raise ValueError('Description embedding text identity mismatch')
        vectors = data['vectors']
    if vectors.shape != (len(texts), 384) or not np.isfinite(vectors).all():
        raise ValueError('Invalid description embedding vectors')
    vectors.flags.writeable = False
    return dict(zip(texts, vectors))


def result_records(results, graph=None):
    output = []
    for result in results:
        tool = result.tool
        metadata = tool.metadata or {}
        output.append({
            "name": metadata.get("skill_name", metadata.get("mcp_original_name", tool.name)),
            "description": metadata['capability_description'] if metadata.get('kind') == 'expert' else tool.description,
            "path": metadata.get("skill_path", ""),
            "score": result.score,
            "confidence": str(result.confidence),
            "keyword_score": result.keyword_score,
            "graph_score": result.graph_score,
            "embedding_score": result.embedding_score,
            "kind": metadata.get("kind", "skill"),
            "mcp_server": metadata.get("mcp_server", ""),
            **{key: metadata[key] for key in RESOURCE_METADATA_FIELDS if key in metadata},
        })
    if graph is not None:
        from artifact_relations import attach_artifact_links
        attach_artifact_links(output, [result.tool.name for result in results], graph)
        from semantic_relations import attach_semantic_links
        attach_semantic_links(output, [result.tool.name for result in results], graph)
    return output


def retrieve(args):
    warnings.filterwarnings("ignore", message="Retrieving over .* without an embedding index")
    worker = _GraphWorker(Path(args.graph))
    print(json.dumps(worker.query({'query': args.query, 'top_k': args.top_k}), ensure_ascii=False))


def _cache_query_interpretation():
    from graph_tool_call.retrieval import semantic_scorer
    from graph_tool_call.retrieval.keyword import BM25Scorer
    for name in dir(BM25Scorer):
        if name.startswith('_has_') and name.endswith('_intent'):
            function = getattr(BM25Scorer, name)
            if not hasattr(function, 'cache_info'):
                setattr(BM25Scorer, name, staticmethod(lru_cache(maxsize=256)(function)))
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
    prepare_sparse_bm25(engine)


def _prepare_keyword_index(engine):
    """Exact equivalent of the library fallback, indexed once per graph."""
    postings = {}
    for name, tool in engine._tools.items():
        tokens = set(engine._tokenize(retrieval_tool_text(tool)))
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


def prepare_graph_read_cache(engine):
    """Reuse immutable adjacency/attributes within one loaded graph version.

    Only GraphSearcher's read view is wrapped. The owning graph retains its
    original mutation API, and every graph reload creates a new view/cache.
    Cache cardinality is bounded by the finite nodes/directions of that graph.
    GraphSearcher only reads these returned records; no scoring is replaced.
    """
    source = engine._searcher._graph
    if getattr(source, '_codex_read_cache', False):
        return
    view = copy(source)
    view.get_edges_from = lru_cache(maxsize=None)(
        lambda node_id, direction='both': tuple(source.get_edges_from(node_id, direction)))
    view.get_node_attrs = lru_cache(maxsize=None)(source.get_node_attrs)
    view._codex_read_cache = True
    engine._searcher._graph = view


def prepare_sparse_bm25(engine):
    """Replace only BM25.score with exact, precomputed sparse contributions."""
    import math
    import numpy as np
    bm25 = engine._get_bm25()
    if getattr(bm25, '_codex_exact_sparse_bm25', False):
        return
    names = tuple(bm25._tool_tokens)
    postings = {}
    for index, name in enumerate(names):
        length = bm25._doc_lens[name]
        for term, frequency in bm25._tf_maps[name].items():
            df = bm25._doc_freqs[term]
            idf = math.log((bm25._n_docs - df + 0.5) / (df + 0.5) + 1.0)
            numerator = frequency * (bm25._k1 + 1.0)
            denominator = frequency + bm25._k1 * (1.0 - bm25._b + bm25._b * length / bm25._avg_dl)
            # Match upstream's multiplication parentheses and addition order.
            postings.setdefault(term, []).append((index, idf * numerator / denominator))
    postings = {term: (np.fromiter((i for i, _ in rows), dtype=np.int32),
                       np.fromiter((value for _, value in rows), dtype=np.float64))
                for term, rows in postings.items()}
    for indices, values in postings.values():
        indices.flags.writeable = False
        values.flags.writeable = False

    def score(query, *, restrict=None):
        raw = bm25._tokenize_fn(query)
        if not raw:
            return {}
        filtered = [term for term in raw if term not in bm25._stopwords]
        terms = bm25._expand_query_tokens(filtered or raw, query)
        values = np.zeros(len(names), dtype=np.float64)
        for term in terms:
            entry = postings.get(term)
            if entry is not None:
                indices, contribution = entry
                values[indices] += contribution
        scores = {}
        for index in np.flatnonzero(values > 0):
            name = names[index]
            if restrict is not None and name not in restrict:
                continue
            value = float(values[index])
            length = bm25._name_token_counts.get(name, 0)
            if length > 6:
                value *= 1.0 / (1.0 + 0.15 * (length - 6))
            value *= bm25._name_subsequence_boost(terms, name)
            value *= bm25._semantic_phrase_boost(query, name, bm25._tools[name])
            scores[name] = value
        return scores

    bm25.score = score
    bm25._codex_exact_sparse_bm25 = True


def prepare_semantic_candidate_guard(engine):
    """Keep category-local semantic leaders alongside global recall guards.

    One shared embedding matrix is scored once, then independently partitioned
    by resource kind. This prevents a dominant kind from occupying every
    semantic slot without growing the upstream candidate pool.
    """
    from graph_tool_call.retrieval.ranking import stable_score_items
    prefilter = engine._get_prefilter()
    if getattr(prefilter, '_codex_semantic_guard', False):
        return
    original = prefilter.candidate_pool
    category_scores_context = ContextVar('category_semantic_scores', default=None)
    original_embedding_scores = engine._compute_embedding_scores

    def compute_embedding_scores(query, top_k, restrict=None):
        scoped = category_scores_context.get()
        slots_context = getattr(engine, '_codex_category_slots', None)
        if not slots_context or not slots_context.get() or scoped is None or scoped[0] != query or scoped[1] is None:
            return original_embedding_scores(query, top_k, restrict)
        _query, names, similarities, category_scores = scoped
        # The matrix pass already scored every tool. Global top-depth BEFORE
        # intersecting the recalled pool discards real evidence for lexical
        # experts below that global cutoff, even when they are category leaders.
        # Preserve each recalled candidate's cosine; output quotas are applied
        # at _build_candidates, not at this scoring boundary. No extra model
        # inference or larger pool is needed.
        return {name: float(score) for name, score in zip(names, similarities)
                if restrict is None or name in restrict}

    engine._compute_embedding_scores = compute_embedding_scores

    def semantic_hits(index, query, quotas, global_limit):
        """Return global and category-local cosine scores from one matrix pass."""
        import numpy as np

        if index is None or getattr(index, 'size', 0) <= 0:
            return None, {}, {}
        try:
            index._ensure_matrix()
            names = index._names
            if not names or index._matrix is None:
                return None, {}, {}
            query_vector = np.asarray(index.encode(query), dtype=np.float32)
            norm = float(np.linalg.norm(query_vector))
            if norm == 0:
                return None, {}, {}
            similarities = index._matrix @ (query_vector / norm)
            global_take = min(global_limit, len(names))
            if global_take < len(names):
                global_positions = np.argpartition(-similarities, global_take - 1)[:global_take].tolist()
            else:
                global_positions = list(range(len(names)))
            global_positions.sort(key=lambda i: (-float(similarities[i]), names[i].casefold(), names[i]))
            groups = {'expert': [], 'skill': [], 'mcp': []}
            for position, name in enumerate(names):
                tool = prefilter._tools.get(name)
                if tool is None:
                    continue
                kind = str((tool.metadata or {}).get('kind', 'skill')).casefold()
                group = 'expert' if kind == 'expert' else 'mcp' if kind in ('mcp', 'mcp-service') else 'skill'
                groups[group].append(position)
            selected = set()
            for group, limit in quotas.items():
                positions = groups[group]
                if not positions or limit <= 0:
                    continue
                values = similarities[positions]
                take = min(limit, len(positions))
                if take < len(positions):
                    local = np.argpartition(-values, take - 1)[:take]
                    positions = [positions[int(i)] for i in local]
                positions.sort(key=lambda i: (-float(similarities[i]), names[i].casefold(), names[i]))
                selected.update(names[i] for i in positions[:take])
            category_scores = {name: float(similarities[names.index(name)]) for name in selected}
            return (names, similarities), {names[i] for i in global_positions}, category_scores
        except (AttributeError, ImportError, TypeError, ValueError):
            return None, {}, {}

    def candidate_pool(query, intent, bm25_top, *, resource_scored=None):
        pool = original(query, intent, bm25_top, resource_scored=resource_scored)
        index = prefilter._embedding_index
        slots_context = getattr(engine, '_codex_category_slots', None)
        quotas = slots_context.get() if slots_context is not None else None
        if not quotas or index is None or getattr(index, 'size', 0) <= 0:
            return pool
        global_quota = sum(quotas.values())
        cap = prefilter._max_pool
        lexical = {name for name in (bm25_top or []) if name in prefilter._tools}
        slots = max(0, min(50, cap - len(lexical) - global_quota))
        matrix_state, semantic, category_scores = semantic_hits(index, query, quotas, slots)
        category_scores_context.set((query, *matrix_state, category_scores) if matrix_state else None)
        category_hits = set(category_scores)
        if not semantic and not category_hits:
            return pool
        # Upstream None means weak CATEGORY evidence, not absent semantic
        # evidence. We have already scored the embedding matrix above; use
        # those actual leaders rather than scoring the entire catalog again.
        # Keep the library's unrestricted behavior if no usable vector exists.
        if pool is None:
            pool = set()
        if slots == 0:
            protected = lexical | category_hits
            if protected.issubset(pool):
                return pool
            keep = set(protected)
            priority = [name for name, _ in stable_score_items(resource_scored or {}) if name in pool]
            priority.extend(sorted(pool, key=lambda name: (name.casefold(), name)))
            for name in priority:
                if len(keep) >= cap:
                    break
                keep.add(name)
            return keep
        semantic = {name for name in semantic if name in prefilter._tools}
        protected = lexical | semantic | category_hits
        if protected.issubset(pool):
            return pool
        keep = set(protected)
        # Preserve upstream category priorities; use its deterministic name
        # order only for the unprotected remainder. Never grow beyond the cap.
        priority = [name for name, _ in stable_score_items(resource_scored or {}) if name in pool]
        priority.extend(sorted(pool, key=lambda name: (name.casefold(), name)))
        for name in priority:
            if len(keep) >= cap:
                break
            keep.add(name)
        return keep

    prefilter.candidate_pool = candidate_pool
    prefilter._codex_semantic_guard = True
    engine._codex_category_embedding_scores_context = category_scores_context


def prepare_resource_name_evidence(engine):
    """Use declared resource names, never transport IDs, for identity boosts.

    GraphToolCall 0.46 strips Han characters before exact-name matching. An
    all-Chinese query then becomes the empty substring of every tool ID.
    Keep its mature Latin-name scoring, but require nonempty evidence and
    handle literal Han names before applying the same explicit-name floor.
    The tool graph and original expert packages retain their identities.
    """
    if getattr(engine, '_codex_resource_name_evidence', False):
        return
    aliases = {}
    for name, tool in engine._tools.items():
        metadata = tool.metadata or {}
        alias = metadata.get('skill_name', metadata.get('mcp_original_name', name))
        if not isinstance(alias, str) or not alias.strip():
            raise ValueError(f'Resource is missing its declared name: {name}')
        aliases[name] = alias
    separators = re.compile(r"[\s_\-/.,;:!?()'\"`\[\]{}]+")

    def boost(query, scores):
        # Keep GraphToolCall 0.46's overlap weights and explicit-name floor,
        # but separate readable names from the graph IDs used as score keys.
        query_tokens = set(separators.split(query.lower())) - {''}
        latin_query = re.sub(r'[^a-z0-9가-힣]+', '', query.lower())
        unicode_query = re.sub(r'[\W_]+', '', query.casefold())
        explicit = []
        for identifier in scores:
            alias = aliases[identifier]
            latin_name = re.sub(r'[^a-z0-9가-힣]+', '', alias.lower())
            han_name = bool(re.search(r'[\u3400-\u4dbf\u4e00-\u9fff]', alias))
            if ((latin_query and len(latin_name) >= 5 and latin_name in latin_query)
                    or (han_name and re.sub(r'[\W_]+', '', alias.casefold()) in unicode_query)):
                explicit.append(identifier)
                continue
            if not latin_query:
                continue
            if latin_name == latin_query or latin_query in latin_name:
                scores[identifier] *= 2.0
                continue
            overlap = len(query_tokens & set(separators.split(alias.lower())))
            if overlap >= 2:
                scores[identifier] *= 1.25 + 0.15 * (overlap - 2)
            elif overlap == 1:
                scores[identifier] *= 1.1
        if explicit:
            floor = max(scores.values()) * 1.5
            for identifier in explicit:
                scores[identifier] = max(scores[identifier], floor)

    engine._boost_name_overlap = boost
    engine._codex_resource_name_evidence = True


def prepare_category_slot_retrieval(engine):
    """Select category quotas at GraphToolCall's final candidate boundary.

    Scores still come from one shared graph pass. A request-local ContextVar
    prevents concurrent Hook requests from leaking category limits.
    """
    if getattr(engine, '_codex_category_slots', None) is not None:
        return engine._codex_category_slots
    from graph_tool_call.retrieval.ranking import stable_score_items
    slots_context = ContextVar('graph_category_slots', default=None)
    original = engine._build_candidates

    def category(name):
        kind = str((engine._tools.get(name).metadata or {}).get('kind', 'skill')
                   if engine._tools.get(name) is not None else 'skill').casefold()
        if kind == 'expert':
            return 'expert'
        if kind in ('mcp', 'mcp-service'):
            return 'mcp'
        return 'skill'

    def build(final_scores, keyword_scores, graph_scores, embedding_scores,
              annotation_scores, semantic_scores, top_k):
        limits = slots_context.get()
        if not limits or sum(limits.values()) != top_k:
            return original(final_scores, keyword_scores, graph_scores,
                            embedding_scores, annotation_scores, semantic_scores, top_k)
        remaining = dict(limits)
        selected = {}
        for name, score in stable_score_items(final_scores):
            kind = category(name)
            if remaining.get(kind, 0) <= 0:
                continue
            selected[name] = score
            remaining[kind] -= 1
            if not any(remaining.values()):
                break
        return original(selected, keyword_scores, graph_scores, embedding_scores,
                        annotation_scores, semantic_scores, top_k)

    engine._build_candidates = build
    engine._codex_category_slots = slots_context
    return slots_context


def normalize_category_slots(value, top_k):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {'expert', 'skill', 'mcp'}:
        raise ValueError('category_slots must contain expert, skill, and mcp')
    if any(type(count) is not int or count < 0 for count in value.values()):
        raise ValueError('category_slots values must be non-negative integers')
    if sum(value.values()) != top_k:
        raise ValueError('category_slots must sum to top_k')
    return dict(value)


def prepare_service_identity_routing(engine):
    """Preserve a uniquely and explicitly requested service after MMR.

    Service identity is a constraint, not a semantic relevance score. Names
    come only from graph metadata, never benchmark labels or a brand list.
    Ambiguous versions, negations, comparisons and implementation requests
    retain the ordinary graph ranking. Complete modules/relations are intact.
    """
    if getattr(engine, '_codex_service_identity', False):
        return
    from graph_tool_call.retrieval.engine import RetrievalResult
    aliases = {}
    generic = {'mcp', 'service', 'server', 'plugin', 'connector', 'search', 'fetch',
               'read', 'write', 'list', 'tool', 'tools', 'query', 'docs',
               'documentation', 'test', 'testing', 'browser', 'filesystem',
               'memory', 'notes', 'task'}
    for identifier, tool in engine._tools.items():
        metadata = tool.metadata or {}
        alias = str(metadata.get('skill_name', '')).casefold()
        if metadata.get('kind') == 'mcp-service' and alias not in generic and re.fullmatch(r'[a-z0-9][a-z0-9_.-]{2,63}', alias):
            aliases.setdefault(alias, set()).add(identifier)
    unique = {alias: next(iter(ids)) for alias, ids in aliases.items() if len(ids) == 1}
    names = re.compile(r'(?<![a-z0-9_.-])(?:' + '|'.join(re.escape(alias) for alias in sorted(aliases, key=lambda value: (-len(value), value))) + r')(?![a-z0-9_.-])', re.I) if aliases else None
    connector = re.compile(r'(?<![a-z0-9_])(?:mcp|connector|integration)(?![a-z0-9_])|连接器|服务连接|服务API', re.I)
    # Fail open to the original ranker for linguistically uncertain requests.
    # False negatives here do not exclude any ordinary retrieval candidate.
    uncertain = re.compile(r"(?<![a-z])(?:not|no|without|avoid|except|instead|rather|alternative\w*|compar\w*|implement\w*|develop\w*|build|debug\w*|fix|benchmark\w*|test\w*|mock\w*|emulat\w*|audit\w*|profil\w*)(?![a-z])|don't|不要|不用|不使用|禁止|排除|不需要|无需|别用|除了|代替|替代|相比|比较|对比|代码|源码|实现|开发|测试|压测|审计|根因|排查|性能", re.I)

    @lru_cache(maxsize=256)
    def match(query):
        if names is None or not connector.search(query) or uncertain.search(query):
            return None
        mentioned = {hit.group().casefold() for hit in names.finditer(query)}
        if len(mentioned) != 1:
            return None
        return unique.get(next(iter(mentioned)))

    original = engine._post_process

    def post_process(candidates, query, final_scores, top_k):
        selected = original(candidates, query, final_scores, top_k)
        identifier = match(query)
        if identifier is None or top_k < 1:
            return selected
        target = next((row for row in candidates if row.tool.name == identifier), None)
        if target is None:
            target = RetrievalResult(tool=engine._tools[identifier], score=final_scores.get(identifier, 0.0))
        return [target, *(row for row in selected if row.tool.name != identifier)][:top_k]

    engine._post_process = post_process
    engine._codex_service_identity_match = match
    engine._codex_service_identity = True


def prepare_candidate_pool_fusion(engine):
    """Honor the existing guarded prefilter before post-fusion scoring.

    The upstream prefilter restricts graph/embedding scores but leaves all BM25
    hits in fusion. Broad words can therefore reintroduce the full corpus. Use
    the same query-local fusion boundary already used by the Chinese channel;
    do not invent another candidate budget or remove the weak-signal fallback.
    """
    if getattr(engine, '_codex_candidate_pool_fusion', False):
        return
    pool_context = ContextVar('candidate_pool_fusion', default=None)
    original_pool, original_fuse = engine._maybe_prefilter, engine._fuse_and_filter

    def maybe_pool(*args, **kwargs):
        pool = original_pool(*args, **kwargs)
        pool_context.set(pool)
        return pool

    def fuse(sources):
        pool = pool_context.get()
        if pool is not None:
            sources = [({name: score for name, score in scores.items() if name in pool}, weight)
                for scores, weight in sources]
        return original_fuse(sources)

    engine._maybe_prefilter, engine._fuse_and_filter = maybe_pool, fuse
    engine._codex_candidate_pool_fusion = True


def prepare_chinese_retrieval(engine):
    """Keep exact BM25 arithmetic; bound post-fusion work to the real pool."""
    import math
    import numpy as np
    bm25 = engine._get_bm25()
    names = list(bm25._tool_tokens)
    postings = {}
    for i, name in enumerate(names):
        length = bm25._doc_lens[name]
        for term, frequency in bm25._tf_maps[name].items():
            df = bm25._doc_freqs[term]
            idf = math.log((bm25._n_docs - df + .5) / (df + .5) + 1.0)
            # Match upstream parentheses: floating-point multiplication is
            # not associative, even though the algebraic formulas agree.
            numerator = frequency * (bm25._k1 + 1.0)
            denominator = frequency + bm25._k1 * (1.0 - bm25._b + bm25._b * length / bm25._avg_dl)
            contribution = idf * numerator / denominator
            postings.setdefault(term, []).append((i, contribution))
    postings = {term: (np.fromiter((i for i, _ in rows), dtype=np.int32),
                       np.fromiter((v for _, v in rows), dtype=np.float64)) for term, rows in postings.items()}

    def score(query, *, restrict=None):
        raw = bm25._tokenize_fn(query)
        filtered = [t for t in raw if t not in bm25._stopwords]
        terms = bm25._expand_query_tokens(filtered or raw, query)
        values = np.zeros(len(names), dtype=np.float64)
        # Iterate in the upstream query order (including repeats) to preserve
        # floating-point accumulation and all downstream phrase boosts.
        for term in terms:
            entry = postings.get(term)
            if entry is not None:
                ids, contribution = entry
                values[ids] += contribution
        # 0.46.0's phrase rules inspect only Latin/Korean literals and regexes;
        # Han spans are barriers with Unicode word semantics, never operands.
        # Preserve one Han character per span and every separator, so the same
        # rules need not scan a long Chinese paragraph once per corpus tool.
        # This projection is ONLY for upstream phrase boosts: BM25 tokens,
        # candidate selection and embedding still receive the complete query.
        phrase_query = re.sub(r'[\u3400-\u4dbf\u4e00-\u9fff]+', '中', query)
        out = {}
        for i in np.flatnonzero(values > 0):
            name = names[i]
            if restrict is not None and name not in restrict:
                continue
            value = float(values[i])
            length = bm25._name_token_counts.get(name, 0)
            if length > 6:
                value *= 1.0 / (1.0 + .15 * (length - 6))
            value *= bm25._name_subsequence_boost(terms, name)
            value *= bm25._semantic_phrase_boost(phrase_query, name, bm25._tools[name])
            out[name] = value
        return out

    bm25.score = score
    # GraphToolCall only applies its pool to embedding/graph/annotations; all
    # BM25 hits otherwise escape into post-fusion boosts (15k on long Chinese).
    # ContextVar keeps independent threaded requests from sharing pool state.
    pool_context = ContextVar('chinese_candidate_pool', default=None)
    original_pool, original_fuse = engine._maybe_prefilter, engine._fuse_and_filter
    def maybe_pool(*args, **kwargs):
        pool = original_pool(*args, **kwargs)
        pool_context.set(pool)
        return pool
    def fuse(sources):
        pool = pool_context.get()
        if pool is not None:
            sources = [({n: v for n, v in values.items() if n in pool}, weight) for values, weight in sources]
        return original_fuse(sources)
    engine._maybe_prefilter, engine._fuse_and_filter = maybe_pool, fuse
    # Expansion depends only on immutable graph, ordered seeds and depth, not
    # query text. Reuse exact results across unrelated queries with those seeds.
    expand = engine._searcher.expand_from_seeds
    @lru_cache(maxsize=256)
    def cached_expand(seeds, max_depth, max_results):
        return tuple(expand(list(seeds), max_depth=max_depth, max_results=max_results))
    engine._searcher.expand_from_seeds = lambda seeds, max_depth=2, max_results=20: list(cached_expand(tuple(seeds), max_depth, max_results))


class _CachedEmbeddingProvider:
    """Cache query/description vectors across all library embedding stages."""

    def __init__(self, provider, precomputed=None):
        self._provider = provider
        self._lock = threading.Lock()
        self._vectors = OrderedDict()
        self._precomputed = precomputed or {}

    def encode(self, text):
        return self.encode_batch([text])[0]

    def encode_batch(self, texts):
        with self._lock:
            missing = list(dict.fromkeys(text for text in texts if text not in self._vectors and text not in self._precomputed))
            if missing:
                vectors = self._provider.encode_batch(missing)
                if len(vectors) != len(missing):
                    raise ValueError('embedding provider returned an incomplete batch')
                for text, vector in zip(missing, vectors):
                    self._vectors[text] = tuple(vector)
            result = [(self._precomputed[text].tolist() if hasattr(self._precomputed[text], 'tolist') else list(self._precomputed[text]))
                      if text in self._precomputed else list(self._vectors[text]) for text in texts]
            for text in texts:
                if text in self._vectors:
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
        self._english_graph = None
        self._ready_languages = set()
        self._signature: tuple[int, int, int] | None = None
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._inflight = 0
        self._ready = False
        self._results = OrderedDict()
        self._pending = {}
        self._executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="graph-query")
        self.cancelled_pending = self.abandoned_running = 0
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
            self._graph = None
            self._english_graph = None
            self._ready_languages.clear()
            self._signature = None
            self._ready = False
            self._results.clear()
            gc.collect()
            graph = ToolGraph.load(self.graph_path)
            graph.set_tokenizer(chinese_tokenize)
            # The serialized retrieval state does not persist this scale hook.
            graph.tune_for_scale()
            engine = graph._get_retrieval_engine()
            engine._tokenize = chinese_tokenize
            if engine._embedding_index is not None and graph.metadata.get('retrieval_content') != RETRIEVAL_CONTENT:
                raise ValueError('Retrieval content is obsolete; rebuild the graph')
            if graph.metadata.get('retrieval_content') == RETRIEVAL_CONTENT:
                prepare_content_retrieval(engine)
            _prepare_keyword_index(engine)
            if engine._embedding_index is not None:
                from complete_embedding import REPRESENTATION
                if graph.metadata.get('embedding_representation') != REPRESENTATION:
                    raise ValueError('Tool embedding representation is obsolete; rebuild the graph')
                provider = engine._embedding_index._provider
                if provider is not None and hasattr(provider, '_get_model'):
                    from complete_embedding import complete_provider
                    # Shared MPS inference crashes when independent requests
                    # overlap, even with a lock around encode. Use CPU for
                    # this small query model; graph scoring still overlaps.
                    provider._get_model().to('cpu')
                    import torch
                    torch.set_num_threads(1)
                    complete_provider(provider)
                if provider is not None:
                    engine._embedding_index._provider = _CachedEmbeddingProvider(provider)
                engine.set_embedding_index(_SerializedEmbeddingIndex(engine._embedding_index))
            self._graph = graph
            self._english_graph = english_retrieval_graph(graph)
            english_engine = self._english_graph._get_retrieval_engine()
            prepare_graph_read_cache(engine)
            # Both language channels traverse the same immutable ontology.
            english_engine._searcher._graph = engine._searcher._graph
            _accelerate_keyword_scoring(english_engine)
            english_provider = english_engine._embedding_index
            if english_provider is not None:
                english_provider._provider._precomputed = load_description_embeddings(self._english_graph, self.graph_path, 'en')
            chinese_index = load_chinese_embedding(graph, self.graph_path)
            if chinese_index is not None:
                # The English graph keeps its original model and vectors.
                chinese_index._provider._get_model().to('cpu')
                chinese_index._provider = _CachedEmbeddingProvider(chinese_index._provider,
                    load_description_embeddings(graph, self.graph_path, 'zh'))
                engine.set_embedding_index(_SerializedEmbeddingIndex(chinese_index))
            prepare_semantic_candidate_guard(self._english_graph._get_retrieval_engine())
            prepare_semantic_candidate_guard(engine)
            prepare_category_slot_retrieval(self._english_graph._get_retrieval_engine())
            prepare_category_slot_retrieval(engine)
            prepare_resource_name_evidence(english_engine)
            prepare_resource_name_evidence(engine)
            prepare_chinese_retrieval(engine)
            prepare_service_identity_routing(english_engine)
            prepare_service_identity_routing(engine)
            prepare_candidate_pool_fusion(english_engine)
            # Finish both lazy retrieval channels before publishing this load.
            # An English-only startup query must not leave the first Chinese
            # user request paying for BM25/prefilter/model initialization.
            for language, channel, prompt in (
                ('en', self._english_graph, 'search files debugging performance skills'),
                ('zh', graph, '搜索文件，调试根因，性能分析与工具检索'),
            ):
                channel.retrieve_with_scores(prompt, top_k=1, max_graph_depth=2)
                self._ready_languages.add(language)
            self._ready = True
            self._signature = signature
            self.loads += 1
        return self._graph

    def query(self, payload: dict) -> list[dict]:
        query = str(payload.get("query") or "").strip()
        if not query:
            return []
        top_k = max(1, min(int(payload.get("top_k", 8)), 50))
        category_slots = normalize_category_slots(payload.get('category_slots'), top_k)
        slots_key = tuple(sorted(category_slots.items())) if category_slots is not None else None
        with self._condition:
            self._last_request = time.monotonic()
            graph = self._load_if_stale()
            if not re.search(r'[\u3400-\u4dbf\u4e00-\u9fff]', query):
                graph = self._english_graph
            key = (query, top_k, slots_key)
            if key in self._results:
                self.cache_hits += 1
                self._results.move_to_end(key)
                return deepcopy(self._results[key])
            shared = self._pending.get(key)
            if shared is None or shared.abandoned:
                shared = _SharedQuery(self._executor.submit(
                    self._retrieve, graph, query, top_k, category_slots))
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
        finally:
            self._release_waiter(key, shared)

    @staticmethod
    def _retrieve(graph, query, top_k, category_slots):
        # ContextVars belong to the execution thread, not the socket thread.
        engine = graph._get_retrieval_engine()
        semantic_context = engine._codex_category_embedding_scores_context
        semantic_token = semantic_context.set(None)
        token = engine._codex_category_slots.set(category_slots)
        try:
            return result_records(graph.retrieve_with_scores(query, top_k=top_k, max_graph_depth=2), graph)
        finally:
            engine._codex_category_slots.reset(token)
            semantic_context.reset(semantic_token)

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
            current = self._pending.get(key) is shared
            if current and not future.cancelled() and future.exception() is None and not shared.abandoned:
                self._results[key] = future.result()
                while len(self._results) > 128:
                    self._results.popitem(last=False)
            if current:
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
            if getattr(self.server, 'auth_token', None) and not secrets.compare_digest(
                    str(payload.get('token', '')), self.server.auth_token):
                raise ValueError('worker authentication failed')
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
            response = {"ok": False, "error": str(error) or type(error).__name__}
        finally:
            self.server.worker._last_request = time.monotonic()
        try:
            self.wfile.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass


class _WorkerServer(socketserver.ThreadingMixIn, getattr(socketserver, 'UnixStreamServer', socketserver.TCPServer)):
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


class _TcpWorkerServer(_WorkerServer):
    address_family = socket.AF_INET


def acquire_process_lock(lock):
    """Hold one OS lock for the entire worker/refresh lifetime, including Windows."""
    try:
        if os.name == 'nt':
            lock.seek(0)
            if not lock.read(1):
                lock.write('\0')
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except (BlockingIOError, OSError):
        return False


_process_worker = None


def _initialize_query_process(graph_path, startup_barrier):
    global _process_worker
    _process_worker = _GraphWorker(Path(graph_path))
    _process_worker._load_if_stale()
    # Do not call the pool ready while other processes are still loading.
    startup_barrier.wait(timeout=150)


def _query_process(payload):
    if payload.get('execution_deadline', time.time() * 1000 + QUERY_EXECUTION_MAX_MS) < time.time() * 1000:
        raise TimeoutError('request expired before retrieval')
    computation = dict(payload)
    computation.pop('deadline', None)
    if 'execution_deadline' in payload:
        computation['deadline'] = payload['execution_deadline']
    records = _process_worker.query(computation)
    return records, {'queryPid': os.getpid(), 'loads': _process_worker.loads,
                     'readyLanguages': sorted(_process_worker._ready_languages),
                     'staticDescriptions': {
                         language: len(channel._get_retrieval_engine()._embedding_index._provider._precomputed)
                         if channel._get_retrieval_engine()._embedding_index is not None else 0
                         for language, channel in [('en', _process_worker._english_graph), ('zh', _process_worker._graph)]},
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
        self.cancelled_pending = self.abandoned_running = 0
        self._path = Path(graph_path)
        self._signature = None
        self._lock = threading.RLock()
        self._results = OrderedDict()
        self._pending = {}
        self._processes = processes
        self._pool = self._new_pool()

    def _new_pool(self):
        context = multiprocessing.get_context('spawn')
        pool = ProcessPoolExecutor(max_workers=self._processes,
            mp_context=context, initializer=_initialize_query_process,
            initargs=(str(self._path), context.Barrier(self._processes)))
        # ProcessPoolExecutor is otherwise lazy: start all initializers while
        # the service is starting, rather than on the first user request.
        for _ in range(self._processes):
            pool.submit(_query_process, {'query': ''})
        return pool

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
        top_k = max(1, min(int(payload.get('top_k', 8)), 50))
        category_slots = normalize_category_slots(payload.get('category_slots'), top_k)
        slots_key = tuple(sorted(category_slots.items())) if category_slots is not None else None
        key = (signature, str(payload.get('query') or '').strip(), top_k, slots_key)
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
            if shared is None or shared.abandoned:
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
        finally:
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
    with open(str(socket_path) + ".lock", "a+") as lock:
        if not acquire_process_lock(lock):
            return
        _serve_locked(args, socket_path)


def _serve_locked(args, socket_path):
    socket_path.unlink(missing_ok=True)
    worker = _ProcessGraphWorker(Path(args.graph), processes=args.processes)
    if os.name == 'nt' or getattr(args, 'tcp', False):
        server = _TcpWorkerServer(('127.0.0.1', 0), worker)
        server.auth_token = secrets.token_hex(32)
        temporary = Path(str(socket_path) + '.tmp')
        temporary.write_text(json.dumps({'host': '127.0.0.1', 'port': server.server_address[1],
                                        'token': server.auth_token}), encoding='utf-8')
        os.chmod(temporary, 0o600)
        temporary.replace(socket_path)
    else:
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
    with open(lock_path, "a+") as lock:
        deadline = time.monotonic() + args.wait_timeout
        while not acquire_process_lock(lock):
            if args.wait_timeout <= 0:
                return
            if time.monotonic() >= deadline:
                raise TimeoutError("Timed out waiting for the global Skill index refresh lock")
            time.sleep(0.1)
        index_threads = int(os.environ.get("CODEX_GRAPH_INDEX_THREADS", min(8, os.cpu_count() or 1)))
        if not 1 <= index_threads <= 20:
            raise ValueError("CODEX_GRAPH_INDEX_THREADS must be 1-20")
        subprocess.run([args.node, args.script], check=True,
                       env={**os.environ, "CODEX_SKILL_REGISTRY_FOREGROUND": "1",
                            "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                            "TOKENIZERS_PARALLELISM": "false",
                            "OMP_NUM_THREADS": str(index_threads),
                            "MKL_NUM_THREADS": str(index_threads), "OPENBLAS_NUM_THREADS": "1"},
                       stdin=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--root", required=True)
    build_parser.add_argument("--catalog", required=True)
    build_parser.add_argument("--output", required=True)
    build_parser.add_argument("--embedding", action="store_true")
    build_parser.add_argument("--chinese-embedding", default='', help='Offline-built multilingual model for the Chinese channel')
    build_parser.add_argument("--require-complete", action="store_true",
                              help="Reject incomplete catalogs without replacing the previous graph")
    build_parser.add_argument("--mcp-catalog")
    build_parser.add_argument("--resource-catalog", help="Optional validated complete expert, Skill and MCP service modules")
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
    serve_parser.add_argument("--tcp", action="store_true", help="Authenticated loopback transport (automatic on Windows)")
    serve_parser.add_argument("--idle-timeout", type=float, default=0.0)
    serve_parser.add_argument("--processes", type=int, choices=range(1, 21), default=4,
                              help="Persistent CPU retrieval processes (1-20; default: 4)")
    serve_parser.set_defaults(func=serve)
    refresh_parser = subparsers.add_parser("refresh")
    refresh_parser.add_argument("--lock", required=True)
    refresh_parser.add_argument("--node", required=True)
    refresh_parser.add_argument("--script", required=True)
    refresh_parser.add_argument("--wait-timeout", type=float, default=0,
                                help="Wait up to this many seconds for an existing refresh before rebuilding")
    refresh_parser.set_defaults(func=refresh)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"graph_skill_index: {error}", file=sys.stderr)
        raise
