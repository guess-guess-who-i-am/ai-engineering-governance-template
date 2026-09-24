#!/usr/bin/env python3
"""Build and query the user's external Skill catalog with GraphToolCall."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import warnings

from graph_tool_call import ToolGraph


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


def retrieve(args):
    warnings.filterwarnings("ignore", message="Retrieving over .* without an embedding index")
    graph = ToolGraph.load(args.graph)
    results = graph.retrieve_with_scores(args.query, top_k=args.top_k, max_graph_depth=2)
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
    print(json.dumps(output, ensure_ascii=False))


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
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"graph_skill_index: {error}", file=sys.stderr)
        raise
