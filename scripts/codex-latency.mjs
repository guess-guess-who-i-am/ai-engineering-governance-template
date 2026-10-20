// Observable client-side spans, not an attribution of hidden model/backend work.
export function summarizeCodexLatency(events, startedAt, endedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) throw new Error('Invalid observation window');
  const spans = [], active = new Map(), missingStarts = [];
  for (const event of events) {
    const item = event.params?.item;
    const hook = event.params?.run;
    const kind = item?.type === 'webSearch' ? 'web' : item?.type === 'commandExecution' ? 'command' : hook ? 'hook' : '';
    if (!kind) continue;
    const key = `${kind}:${item?.id || hook?.id}`;
    if (event.method === 'item/started' || event.method === 'hook/started') active.set(key, event.at);
    if (event.method !== 'item/completed' && event.method !== 'hook/completed') continue;
    if (!active.has(key)) { missingStarts.push(key); continue; }
    const start = active.get(key); active.delete(key);
    if (!Number.isFinite(start) || !Number.isFinite(event.at) || event.at < start) { missingStarts.push(key); continue; }
    spans.push({ kind, id: item?.id || hook?.id, event: hook?.eventName,
      action: item?.action?.type, startMs: Math.max(startedAt, start) - startedAt,
      endMs: Math.min(endedAt, event.at) - startedAt, durationMs: event.at - start });
  }
  function union(selected) {
    const ranges = selected.filter(s => s.endMs >= s.startMs).map(s => [s.startMs, s.endMs]).sort((a,b)=>a[0]-b[0]);
    let total=0, from=0, to=0;
    for (const [start,end] of ranges) { if (start>to) { total+=to-from;from=start;to=end; } else to=Math.max(to,end); }
    return total + to - from;
  }
  const totalMs = endedAt - startedAt;
  return { totalMs, hookMs: union(spans.filter(s=>s.kind==='hook')),
    searchMs: union(spans.filter(s=>s.kind==='web' && s.action==='search')),
    pageAndFindMs: union(spans.filter(s=>s.kind==='web' && ['openPage','findInPage'].includes(s.action))),
    allWebMs: union(spans.filter(s=>s.kind==='web')), measuredToolAndHookMs: union(spans),
    unattributedMs: totalMs-union(spans), spans, missingStarts, unfinished: [...active.keys()],
    limits: 'Client event spans include platform overhead. Unattributed time includes startup, model/provider waits and output; it is not proven reasoning time. Zero-duration events may be coalesced. HTTP concurrency is not observed.' };
}
