#!/usr/bin/env python3
"""Real installed MCP, source-grounded body/range checks and token proxy.

Run with Serena's installed Python. No model/API usage claimed.
"""
import asyncio
import json
import os
import re
from pathlib import Path
import statistics
import time
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import tiktoken

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    'codex-profile/.codex/hooks/skill-router.mjs': ['scoreSkill', 'exactName', 'queryTokens', 'graphCandidates', 'promptSkillExclusions'],
    'codex-profile/mac/hooks/graph_skill_index.py': ['_GraphWorker', '_load_if_stale', '_prepare_keyword_index', '_ProcessGraphWorker', 'result_records', 'build', 'serve'],
}


async def main():
    node = os.environ.get('CODEX_NODE', '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node')
    entry = Path.home() / '.codex/tools/serena-mcp.mjs'
    token = tiktoken.get_encoding('o200k_base')
    rows = []
    params = StdioServerParameters(command=node, args=[str(entry)], cwd=str(ROOT))
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listed = await session.list_tools()
            assert {t.name for t in listed.tools} == {'initial_instructions', 'activate_project', 'get_current_config',
                'get_symbols_overview', 'find_symbol', 'find_referencing_symbols', 'search_for_pattern'}
            manual = await session.call_tool('initial_instructions', {})
            assert not manual.is_error
            manual_text = '\n'.join(c.text for c in manual.content if hasattr(c, 'text'))
            manual_tokens = len(token.encode(manual_text))
            assert manual_tokens < 1000, 'Unexpected navigation prompt expansion'
            session_id = re.search(r'session id is `([^`]+)`', manual_text)
            assert session_id, 'Navigation instructions must establish a session'
            activated = await session.call_tool('activate_project', {'project': str(ROOT), 'session': session_id.group(1)})
            assert not activated.is_error, 'Workspace activation failed'
            for relative, names in TARGETS.items():
                source = (ROOT / relative).read_text()
                lines = source.splitlines()
                for name in names:
                    begun = time.perf_counter()
                    result = await session.call_tool('find_symbol', {'name_path_pattern': name, 'relative_path': relative, 'include_body': True, 'max_answer_chars': 20000})
                    elapsed = (time.perf_counter() - begun) * 1000
                    assert not result.is_error, str(result)
                    text = '\n'.join(c.text for c in result.content if hasattr(c, 'text'))
                    items = json.loads(text)
                    assert items, (relative, name, text)
                    correct = []
                    for item in items:
                        body = item.get('body', '')
                        loc = item['body_location']
                        # Serena uses zero-based inclusive source positions.
                        actual = '\n'.join(lines[loc['start_line']:loc['end_line'] + 1])
                        valid = bool(body) and body.strip() == actual.strip() and body in source and item['relative_path'] == relative
                        correct.append(valid)
                    assert all(correct), (relative, name, items)
                    rows.append({'path': relative, 'symbol': name, 'matches': len(items), 'sourceExact': True, 'ms': round(elapsed, 3),
                                 'serenaTokensProxy': len(token.encode(text)), 'fullFileTokensProxy': len(token.encode(source))})
            missing = await session.call_tool('find_symbol', {'name_path_pattern': '__not_a_real_symbol_271828', 'relative_path': next(iter(TARGETS))})
            assert not missing.is_error
            assert json.loads('\n'.join(c.text for c in missing.content if hasattr(c, 'text'))) == []
    report = {'schema': 'serena-navigation-evidence/1', 'passed': len(rows), 'total': sum(map(len, TARGETS.values())),
              'navigationToolCount': len(listed.tools), 'initialInstructionsTokensProxy': manual_tokens,
              'missingSymbolReturnsEmpty': True, 'medianMs': round(statistics.median(r['ms'] for r in rows), 3),
              'serenaTokensProxy': sum(r['serenaTokensProxy'] for r in rows), 'fullFileTokensProxy': sum(r['fullFileTokensProxy'] for r in rows),
              'limitations': ['o200k proxy, not billed model usage', 'whole-file baseline, not optimized rg + bounded reads', 'symbol extraction accuracy, not agent task-success accuracy'], 'rows': rows}
    out = ROOT / '.reports/serena-navigation.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'rows'}, ensure_ascii=False))


asyncio.run(main())
