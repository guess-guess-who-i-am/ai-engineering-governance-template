import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("profiler", Path(__file__).with_name("profile-codex-session.py"))
profiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profiler)


def event(second, kind, **payload):
    return {"timestamp": f"2026-11-05T00:00:{second:02d}Z", "type": kind, "payload": payload}


class ProfileTests(unittest.TestCase):
    def test_no_private_text_and_actual_overlap(self):
        rows = [event(0, "event_msg", type="token_count", info={"last_token_usage": {"input_tokens": 200000, "cached_input_tokens": 190000}}),
                event(1, "response_item", type="custom_tool_call", call_id="a", input="PRIVATE Promise.all([tools.exec_command({})])"),
                event(3, "response_item", type="custom_tool_call_output", call_id="a", output=[{"text": "PRIVATE OUTPUT"}])]
        for a, b in [(1000, 3000), (2000, 4000), (4000, 5000)]:
            rows.append(event(5, "event_msg", type="item_completed", item={"type": "CommandExecution", "command": "PRIVATE"}, started_at_ms=a, completed_at_ms=b))
        report = profiler.profile(rows)
        self.assertNotIn("PRIVATE", json.dumps(report))
        self.assertEqual(report["peakOverlappingCommandCalls"], 2)
        self.assertEqual(report["promiseBatchSyntaxCalls"], 1)
        self.assertEqual(report["contextBins"][2]["toolWrapperSeconds"]["p50"], 2)

    def test_user_think_time_reset_and_compaction_subtracted(self):
        rows = [event(0, "event_msg", type="token_count", info={"last_token_usage": {"input_tokens": 50000}}),
                event(1, "response_item", type="function_call_output", call_id="unknown", output=""),
                event(4, "event_msg", type="item_completed", item={"type": "ContextCompaction"}, started_at_ms=1793836802000, completed_at_ms=1793836804000),
                event(6, "response_item", type="function_call", call_id="a", arguments="{}"),
                event(7, "response_item", type="function_call_output", call_id="a", output=""),
                event(8, "response_item", type="message", role="user", content="PRIVATE"),
                event(30, "response_item", type="function_call", call_id="b", arguments="{}"),
                event(31, "response_item", type="function_call_output", call_id="b", output="")]
        bucket = profiler.profile(rows)["contextBins"][0]
        self.assertEqual(bucket["interToolGapSeconds"], {"count": 1, "p50": 5, "p95": 5})
        self.assertEqual(bucket["gapExcludingCompactionSeconds"]["p50"], 3)

    def test_empty_unknown_usage_and_partial_log(self):
        self.assertEqual(profiler.profile([])["completedToolWrappers"], 0)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "test.jsonl"
            p.write_text(json.dumps(event(1, "response_item", type="custom_tool_call", call_id="a", input="")) + "\n{unfinished")
            report = profiler.read_profile(p)
            self.assertEqual(report["invalidLines"], 1)
            self.assertEqual(report["unmatchedToolCalls"], 1)
            self.assertTrue(all(b["calls"] == 0 for b in report["contextBins"]))


if __name__ == "__main__":
    unittest.main()
