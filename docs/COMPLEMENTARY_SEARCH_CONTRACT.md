# Complementary search contract

`technical_research/complementary_search_batch` is the additive search entry.
`technical_research_batch` remains the explicit API-only entry; existing callers keep their contract.

- Input: 1–20 independent `{source, query}` operations. Sources: `web`, `github`, `stackoverflow`, `papers`, `openalex`, `crossref`. Optional `apiQuery` is a caller-supplied English query, not an automatic paid translation. `expectedTitle` / `expectedUrl` express a known target, not a relevance threshold.
- English GitHub / Stack Overflow: API first; errors, empty results, cache misses or a missing explicit target cause one web supplement for that operation only.
- Han-containing queries without `apiQuery`, and `web`: use the existing free web provider directly. `papers` and English scholarly API requests use web and the selected scholarly API in parallel, since successful metadata responses can still miss the paper. `papers` uses Crossref; OpenAlex is opt-in and may require available free quota.
- Independent operations are batched. The entire call has one deadline (default 12 s, range 100–30000 ms); primary API work gets at most half that budget so a supplement can run. No fresh deadline per source or retries of successful operations. Existing API origin backoff remains enforced.
- `cacheMode`: `refresh` bypasses completed caches; `prefer` accepts explicitly dated data; `only` must never make an HTTP request, including to the local web service. Empty / failed web results are not cached. Provider errors and cache misses remain observable even when another source supplies candidates.
- Web transport uses only an HTTP loopback IDE service and verifies its configured provider is enabled keyless Open-WebSearch. It never changes provider, calls a paid fallback or falls back to a paid key. Missing/disabled web is an explicit error. Configure its base URL per machine, not in committed source.
- Output: schema `complementary-search/1`; per-operation route, reasons, API/web branches, warnings, status and source provenance; selected URL-deduplicated candidate cards and an artifact containing the complete pool. Target matches and candidate counts are not semantic correctness or final-answer accuracy. Raw errors and provider artifacts remain local.
- MCP returns usable partial candidates without turning the entire call into an execution error. No-candidate failure/cache-miss is a tool error; a legitimate fully empty search is not a transport failure.
- No global standing-prompt changes. The global `parallel-web-research` Skill explains when to use this entry and when to read original sources or supplement using the session's other web tools. Both Skill and MCP enter the existing global registry/graph.

Evidence must include mixed branches, real MCP calls, no-network cache, shared deadline, free-provider rejection, per-operation fallback, installation idempotence and actual global discovery. Public web results remain untrusted data.
