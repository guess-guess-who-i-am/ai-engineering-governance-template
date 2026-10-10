#!/usr/bin/env python3
"""Compare the live Codex Skill router with graph-tool-call retrieval.

This is an evaluation harness only. It never changes the live Hook or registry.
Pass --graph-tool-call-source to test a checked-out graph-tool-call revision
without installing or replacing the user's Python package.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


CASES = [
    {"id": "new-project", "query": "我有一个模糊的产品想法，请帮我建立一个全新的项目和仓库", "gold": ["start-new-project"]},
    {"id": "clarify", "query": "这个架构改动有几种解释，先冻结目标、范围、约束和验收证据", "gold": ["clarify-before-build"]},
    {"id": "domain", "query": "梳理业务术语、状态转换、不变量和领域边界", "gold": ["model-project-domain"]},
    {"id": "data-boundary", "query": "设计持久化数据的所有权、schema、索引和并发边界", "gold": ["design-data-boundary"]},
    {"id": "contract", "query": "修改一个被多个消费者使用的 HTTP API 和共享 schema", "gold": ["evolve-contracts"]},
    {"id": "regression", "query": "升级之后原来能工作的功能坏了，请先写失败测试再修复", "gold": ["fix-regression-with-tdd"]},
    {"id": "debug", "query": "线上出现延迟异常，请沿真实信息流找到第一次偏离和根因", "gold": ["systematic-debugging"]},
    {"id": "test-strategy", "query": "为新项目建立完整 CI 测试策略，覆盖安全、性能、可访问性和端到端", "gold": ["establish-test-strategy"]},
    {"id": "api-flow", "query": "针对真实运行入口测试跨服务的多步骤 API 业务流程", "gold": ["test-api-business-flow"]},
    {"id": "verify", "query": "这是高风险跨边界改动，完成前选择并执行足够的验证证据", "gold": ["verify-before-completion"]},
    {"id": "diff-review", "query": "审查当前分支 diff，找出具体行为缺陷和证据不足", "gold": ["review-project-diff"]},
    {"id": "pr", "query": "根据真实 diff、测试、风险和回滚证据写 PR 描述", "gold": ["write-pr-description"]},
    {"id": "github", "query": "提交并推送这些改动到 GitHub", "gold": ["method-github-delivery"]},
    {"id": "research", "query": "为论文选择高引用 baseline 和权威 benchmark，并核查证据", "gold": ["method-research-evidence"]},
    {"id": "methodology", "query": "修改全局方法论提示词并发布中英文版本", "gold": ["manage-global-methodology"]},
    {"id": "task-tree", "query": "检查并修复 llm-task-tree 的节点状态和执行流", "gold": ["method-task-tree"]},
    {"id": "paper-chart", "query": "为学术论文选择图表类型并审查可视化品味", "gold": ["paper-visualization-taste"]},
    {"id": "frontend", "query": "构建一个响应式 AI 产品落地页，保证可访问性和品牌一致性", "gold": ["build-designed-interface"]},
    {"id": "gesture", "query": "设计可拖拽、可打断、带速度接续和弹簧动画的 bottom sheet", "gold": ["apple-design"]},
    {"id": "visual-taste", "query": "给作品集落地页做反模板化的视觉方向，不要通用 AI 风格", "gold": ["design-taste-frontend"]},
    {"id": "migration", "query": "审查数据库迁移的锁、回填、部署顺序、回滚和恢复", "gold": ["review-data-migration"]},
    {"id": "governance", "query": "审计工程治理框架的 Hook、Skills、脚本、CI 和证据流", "gold": ["review-governance-framework"]},
    {"id": "skill-create", "query": "创建一个新的 Codex Skill，并设计渐进式披露结构", "gold": ["skill-creator", "write-a-skill"]},
    {"id": "codex-docs", "query": "查询 Codex Skills 的官方配置和故障排查方法", "gold": ["openai-docs"]},
    {"id": "negative-greeting", "query": "你好", "gold": []},
    {"id": "negative-summary", "query": "把这一句话精简一下", "gold": []},
    {"id": "negative-math", "query": "计算 17 乘以 23", "gold": []},
]


RELATIONS = [
    ("start-new-project", "clarify-before-build", "requires"),
    ("start-new-project", "model-project-domain", "complementary"),
    ("start-new-project", "establish-test-strategy", "complementary"),
    ("model-project-domain", "design-data-boundary", "precedes"),
    ("design-data-boundary", "review-data-migration", "precedes"),
    ("evolve-contracts", "test-api-business-flow", "precedes"),
    ("systematic-debugging", "fix-regression-with-tdd", "precedes"),
    ("fix-regression-with-tdd", "verify-before-completion", "precedes"),
    ("test-api-business-flow", "verify-before-completion", "precedes"),
    ("review-project-diff", "write-pr-description", "precedes"),
    ("write-pr-description", "method-github-delivery", "precedes"),
    ("design-taste-frontend", "build-designed-interface", "complementary"),
    ("apple-design", "build-designed-interface", "complementary"),
    ("manage-global-methodology", "review-governance-framework", "complementary"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--codex-home", type=Path, default=Path.home() / ".codex")
    parser.add_argument("--graph-tool-call-source", type=Path)
    parser.add_argument("--with-embedding", action="store_true")
    parser.add_argument("--skip-live", action="store_true")
    parser.add_argument("--embedding-only", action="store_true")
    parser.add_argument("--live-only", action="store_true")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    match = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    values: dict[str, str] = {}
    if match:
        for line in match.group(1).splitlines():
            key, separator, value = line.partition(":")
            if separator and key.strip() in {"name", "description"}:
                values[key.strip()] = value.strip().strip('"\'')
    values["body_heading"] = next(
        (line.lstrip("# ").strip() for line in text.splitlines() if line.startswith("# ")),
        "",
    )
    return values


def load_skills(repo: Path, codex_home: Path) -> list[dict[str, str]]:
    registry_path = codex_home / "skill-registry" / "skills-index.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8-sig"))
    by_name: dict[str, dict[str, str]] = {}
    for item in registry.get("skills", []):
        name = str(item.get("name") or "").lower()
        if name:
            by_name[name] = {key: str(item.get(key) or "") for key in ("name", "description", "problem", "when", "path", "source")}
    for skill_path in (repo / ".agents" / "routed-skills").glob("*/SKILL.md"):
        metadata = frontmatter(skill_path)
        name = metadata.get("name", skill_path.parent.name).lower()
        by_name[name] = {
            "name": name,
            "description": metadata.get("description", ""),
            "problem": "",
            "when": "",
            "path": str(skill_path),
            "source": "project",
        }
    return list(by_name.values())


def tool_text(skill: dict[str, str]) -> str:
    return " ".join(str(skill.get(key) or "") for key in ("name", "description", "problem", "when"))


def build_graph(skills: list[dict[str, str]], with_relations: bool):
    from graph_tool_call import ToolGraph

    graph = ToolGraph()
    names = {skill["name"] for skill in skills}
    for skill in skills:
        graph.add_tool_simple(skill["name"], tool_text(skill))
    if with_relations:
        for source, target, relation in RELATIONS:
            if source in names and target in names:
                graph.add_relation(source, target, relation)
    return graph


def parse_hook_candidates(stdout: str) -> list[str]:
    try:
        payload = json.loads(stdout or "{}")
        context = str(payload.get("hookSpecificOutput", {}).get("additionalContext", ""))
    except json.JSONDecodeError:
        return []
    return re.findall(r"(?m)^- ([^\s\[]+) \[", context)


def run_live_hook(hook: Path, query: str, repo: Path, *, with_embedding: bool = False) -> tuple[list[str], float]:
    env = os.environ.copy()
    if not with_embedding:
        env.pop("CODEX_EMBEDDING_API_KEY", None)
        env.pop("AGICTO_API_KEY", None)
    payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": query, "cwd": str(repo)}, ensure_ascii=False)
    started = time.perf_counter()
    completed = subprocess.run(
        ["node", str(hook)], input=payload, text=True, encoding="utf-8",
        capture_output=True, env=env, timeout=30, check=False,
    )
    return parse_hook_candidates(completed.stdout), (time.perf_counter() - started) * 1000


def evaluate(name: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    positives = [row for row in rows if row["gold"]]
    negatives = [row for row in rows if not row["gold"]]
    top1 = sum(bool(set(row["candidates"][:1]) & set(row["gold"])) for row in positives)
    top4 = sum(bool(set(row["candidates"][:4]) & set(row["gold"])) for row in positives)
    false_routes = sum(bool(row["candidates"]) for row in negatives)
    latencies = [row["latency_ms"] for row in rows]
    return {
        "name": name,
        "positive_cases": len(positives),
        "recall_at_1": round(top1 / len(positives), 4),
        "recall_at_4": round(top4 / len(positives), 4),
        "negative_false_route_rate": round(false_routes / len(negatives), 4),
        "latency_ms_mean": round(statistics.mean(latencies), 2),
        "latency_ms_max": round(max(latencies), 2),
        "failures": [
            {"id": row["id"], "gold": row["gold"], "candidates": row["candidates"]}
            for row in rows
            if (row["gold"] and not set(row["candidates"][:4]) & set(row["gold"]))
            or (not row["gold"] and row["candidates"])
        ],
    }


def main() -> int:
    args = parse_args()
    if args.graph_tool_call_source:
        sys.path.insert(0, str(args.graph_tool_call_source.resolve()))
    skills = load_skills(args.repo.resolve(), args.codex_home.resolve())
    hook = args.codex_home / "hooks" / "skill-router.mjs"
    if args.live_only:
        name = "live-hybrid" if args.with_embedding else "live-lexical"
        rows = []
        for case in CASES:
            candidates, latency = run_live_hook(hook, case["query"], args.repo.resolve(), with_embedding=args.with_embedding)
            rows.append({**case, "candidates": candidates, "latency_ms": latency})
        report = {
            "schema_version": "skill-routing-benchmark/1",
            "graph_tool_call_version": None,
            "skill_count": len(skills),
            "case_count": len(CASES),
            "relations": len(RELATIONS),
            "summary": [evaluate(name, rows)],
            "cases": {name: rows},
        }
        rendered = json.dumps(report, ensure_ascii=False, indent=2)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered + "\n", encoding="utf-8")
        print(rendered)
        return 0
    systems: dict[str, list[dict[str, Any]]] = {"graph-bm25": [], "graph-bm25-relations": []}
    if not args.skip_live:
        systems["live-lexical"] = []
    plain_graph = build_graph(skills, with_relations=False)
    related_graph = build_graph(skills, with_relations=True)
    hybrid_graph = None
    if args.with_embedding:
        api_key = os.environ.get("CODEX_EMBEDDING_API_KEY") or os.environ.get("AGICTO_API_KEY") or ""
        if not api_key:
            raise SystemExit("--with-embedding requires CODEX_EMBEDDING_API_KEY or AGICTO_API_KEY")
        from graph_tool_call.retrieval.embedding import OpenAIEmbeddingProvider

        class CachingProvider(OpenAIEmbeddingProvider):
            def __init__(self) -> None:
                super().__init__(
                    model=os.environ.get("CODEX_EMBEDDING_MODEL", "text-embedding-3-large"),
                    api_key=api_key,
                    base_url=os.environ.get("CODEX_EMBEDDING_BASE_URL", "https://api.agicto.cn/v1"),
                    batch_size=int(os.environ.get("CODEX_GRAPH_EMBEDDING_BATCH_SIZE", "4")),
                )
                cache_setting = os.environ.get("CODEX_GRAPH_EMBEDDING_CACHE", "").strip()
                self.cache_path = Path(cache_setting) if cache_setting else None
                try:
                    loaded = json.loads(self.cache_path.read_text(encoding="utf-8")) if self.cache_path else {}
                except (OSError, json.JSONDecodeError):
                    loaded = {}
                self.cache: dict[str, list[float]] = {
                    str(text): vector for text, vector in loaded.items() if isinstance(vector, list)
                }

            def encode_batch(self, texts: list[str]) -> list[list[float]]:
                missing = list(dict.fromkeys(text for text in texts if text not in self.cache))
                for offset in range(0, len(missing), self.batch_size):
                    batch = missing[offset : offset + self.batch_size]
                    vectors = super().encode_batch(batch)
                    self.cache.update(zip(batch, vectors))
                    if self.cache_path:
                        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                        temporary = self.cache_path.with_name(f"{self.cache_path.name}.{os.getpid()}.tmp")
                        temporary.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")
                        temporary.replace(self.cache_path)
                return [self.cache[text] for text in texts]

        provider = CachingProvider()
        hybrid_graph = build_graph(skills, with_relations=True)
        hybrid_graph.enable_embedding(provider)
        provider.encode_batch([case["query"] for case in CASES])
        if not args.skip_live:
            systems["live-hybrid"] = []
        systems["graph-hybrid-relations"] = []
        systems["embedding-cosine"] = []

    for case in CASES:
        if not args.skip_live:
            candidates, latency = run_live_hook(hook, case["query"], args.repo.resolve())
            systems["live-lexical"].append({**case, "candidates": candidates, "latency_ms": latency})
        for name, graph in (("graph-bm25", plain_graph), ("graph-bm25-relations", related_graph)):
            started = time.perf_counter()
            results = graph.retrieve_with_scores(case["query"], top_k=4)
            candidates = [result.tool.name for result in results]
            systems[name].append({**case, "candidates": candidates, "candidate_scores": [round(float(result.score), 8) for result in results], "latency_ms": (time.perf_counter() - started) * 1000})
        if hybrid_graph is not None:
            if not args.skip_live:
                candidates, latency = run_live_hook(hook, case["query"], args.repo.resolve(), with_embedding=True)
                systems["live-hybrid"].append({**case, "candidates": candidates, "latency_ms": latency})
            started = time.perf_counter()
            embedding_hits = hybrid_graph._get_retrieval_engine()._embedding_index.search(provider.cache[case["query"]], top_k=4)
            systems["embedding-cosine"].append({**case, "candidates": [name for name, _ in embedding_hits], "candidate_scores": [round(float(score), 8) for _, score in embedding_hits], "latency_ms": (time.perf_counter() - started) * 1000})
            if not args.embedding_only:
                started = time.perf_counter()
                results = hybrid_graph.retrieve_with_scores(case["query"], top_k=4)
                candidates = [result.tool.name for result in results]
                systems["graph-hybrid-relations"].append({**case, "candidates": candidates, "candidate_scores": [round(float(result.score), 8) for result in results], "latency_ms": (time.perf_counter() - started) * 1000})

    if args.embedding_only:
        systems.pop("graph-hybrid-relations", None)

    import graph_tool_call

    report = {
        "schema_version": "skill-routing-benchmark/1",
        "graph_tool_call_version": graph_tool_call.__version__,
        "skill_count": len(skills),
        "case_count": len(CASES),
        "relations": len(RELATIONS),
        "summary": [evaluate(name, rows) for name, rows in systems.items()],
        "cases": systems,
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
