#!/usr/bin/env python3
"""Read Codex JSONL locally; emit numeric timing evidence without chat or tool text."""
import argparse
import collections
import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import statistics


def stamp(value):
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, TypeError, ValueError):
        return None


def distribution(values):
    values = sorted(v for v in values if isinstance(v, (int, float)) and math.isfinite(v) and v >= 0)
    return {"count": len(values), "p50": round(statistics.median(values), 3) if values else None,
            "p95": round(values[max(0, math.ceil(len(values) * .95) - 1)], 3) if values else None}


def peak_overlap(intervals):
    points = sorted((at, change) for a, b in intervals if b > a
                    for at, change in [(a, 1), (b, -1)])
    active = peak = 0
    for _, change in points:
        active += change
        peak = max(active, peak)
    return peak


def profile(rows):
    pending, calls, compactions, command_intervals = {}, [], [], []
    usage, cached, last_end = None, None, None
    models, types = collections.Counter(), collections.Counter()
    output_bytes = []
    for row in rows:
        payload = row.get("payload") or {}
        if not isinstance(payload, dict):
            continue
        kind, sub, at = row.get("type"), payload.get("type"), stamp(row.get("timestamp"))
        types[str(kind)] += 1
        if kind == "turn_context":
            models[(str(payload.get("model", "unknown")), str(payload.get("effort", "unknown")))] += 1
        if kind == "event_msg" and sub == "token_count":
            value = (payload.get("info") or {}).get("last_token_usage") or {}
            usage = value.get("input_tokens") or None
            cached = value.get("cached_input_tokens")
        # User think time must not be counted as model/tool scheduling latency.
        if kind == "response_item" and sub == "message" and payload.get("role") == "user":
            last_end = None
        if kind == "response_item" and sub in ("custom_tool_call", "function_call") and at is not None:
            text = payload.get("input", payload.get("arguments", ""))
            text = text if isinstance(text, str) else json.dumps(text)
            pending[payload.get("call_id")] = {
                "at": at, "tokens": usage, "cached": cached,
                "gap": at - last_end if last_end is not None and at >= last_end else None,
                "gapStart": last_end,
                "batchSyntax": bool(re.search(r"Promise\.all(?:Settled)?\s*\(", text)),
                "nestedExecCount": text.count("tools.exec_command("),
            }
        if kind == "response_item" and sub in ("custom_tool_call_output", "function_call_output") and at is not None:
            call = pending.pop(payload.get("call_id"), None)
            if call and at >= call["at"]:
                call["duration"] = at - call["at"]
                calls.append(call)
            value = payload.get("output", "")
            output_bytes.append(len((value if isinstance(value, str) else json.dumps(value)).encode()))
            last_end = at
        if kind == "event_msg" and sub == "item_completed":
            item = payload.get("item") or {}
            a, b = payload.get("started_at_ms"), payload.get("completed_at_ms")
            if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b > a:
                if item.get("type") == "ContextCompaction":
                    compactions.append((a / 1000, b / 1000))
                if item.get("type") == "CommandExecution":
                    command_intervals.append((a / 1000, b / 1000))
    bins = []
    for lo, hi in [(0, 100000), (100000, 180000), (180000, 260000), (260000, None)]:
        selected = [c for c in calls if c["tokens"] is not None and lo <= c["tokens"] and (hi is None or c["tokens"] < hi)]
        gaps = [c["gap"] for c in selected if c["gap"] is not None]
        without_compaction = [max(0, c["gap"] - sum(max(0, min(c["at"], b) - max(c["gapStart"], a))
                                                  for a, b in compactions))
                              for c in selected if c["gap"] is not None]
        ratios = [c["cached"] / c["tokens"] for c in selected
                  if isinstance(c["cached"], (int, float)) and c["tokens"] > 0]
        bins.append({"inputTokensMin": lo, "inputTokensMaxExclusive": hi, "calls": len(selected),
                     "interToolGapSeconds": distribution(gaps),
                     "gapExcludingCompactionSeconds": distribution(without_compaction),
                     "toolWrapperSeconds": distribution([c["duration"] for c in selected]),
                     "medianCachedInputRatio": round(statistics.median(ratios), 4) if ratios else None})
    return {"schema": "codex-session-performance/1", "rows": sum(types.values()),
            "models": [{"model": m, "effort": e, "turnContexts": n} for (m, e), n in models.items()],
            "completedToolWrappers": len(calls), "unmatchedToolCalls": len(pending),
            "promiseBatchSyntaxCalls": sum(c["batchSyntax"] for c in calls),
            "multiExecWithoutPromiseBatchSyntax": sum(c["nestedExecCount"] > 1 and not c["batchSyntax"] for c in calls),
            "toolOutputBytes": distribution(output_bytes),
            "commandCallIntervals": len(command_intervals), "peakOverlappingCommandCalls": peak_overlap(command_intervals),
            "compactionSeconds": [round(b - a, 3) for a, b in compactions],
            "contextBins": bins,
            "limitations": ["Observational bins do not establish context length as a sole cause",
                            "Inter-tool gaps include model generation, host overhead and unclassified waits",
                            "Promise syntax is a batching indicator, not proof of safe independent work or execution overlap",
                            "Command intervals describe tool calls; yielded background processes can outlive them",
                            "No prompts, commands, tool outputs, reasoning or credentials are emitted"]}


def read_profile(path):
    raw = Path(path).read_bytes()
    rows, invalid = [], 0
    for line in raw.splitlines():
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                rows.append(value)
            else:
                invalid += 1
        except (json.JSONDecodeError, UnicodeDecodeError):
            invalid += 1
    return {**profile(rows), "snapshotSha256": hashlib.sha256(raw).hexdigest(),
            "snapshotBytes": len(raw), "invalidLines": invalid}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sessions", nargs="+")
    parser.add_argument("--output")
    args = parser.parse_args()
    report = {"sessions": [read_profile(p) for p in args.sessions]}
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(rendered)
    else:
        print(rendered, end="")
