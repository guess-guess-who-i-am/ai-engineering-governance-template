// Diagnose observed boundaries; never infer a provider's internal root cause.
export function retestDiagnostics(events, stderr = '') {
  const retryEvents = events.filter(e => e.method === 'error').map(e => ({
    at: e.at, willRetry: e.params?.willRetry === true,
    message: e.params?.error?.message || '', details: e.params?.error?.additionalDetails || '',
    info: e.params?.error?.codexErrorInfo ?? null
  }));
  const mcp = events.filter(e => e.method === 'mcpServer/startupStatus/updated').map(e => ({
    at: e.at, name: e.params?.name, status: e.params?.status,
    error: e.params?.error ?? null, failureReason: e.params?.failureReason ?? null
  }));
  const completed = events.filter(e => e.method === 'item/completed').map(e => e.params?.item).filter(Boolean);
  const finalMessages = completed.filter(i => i.type === 'agentMessage' && i.phase === 'final_answer');
  const commentary = completed.filter(i => i.type === 'agentMessage' && i.phase !== 'final_answer');
  const searchCalls = completed.filter(i => i.type === 'webSearch');
  const researchCalls = completed.filter(i => i.type === 'mcpToolCall' && i.server === 'technical_research');
  const researchErrors=researchCalls.filter(i=>i.status==='failed').map(i=>({id:i.id,arguments:i.arguments,
    result:i.result??null,error:i.error??null}));
  const streamFailure = retryEvents.some(e => e.info?.responseStreamDisconnected || /stream disconnected|timed out/i.test(e.details)) ||
    /stream disconnected before completion|retrying sampling request/.test(stderr);
  return { retryEvents, mcpStartup: mcp, finalMessageCount: finalMessages.length,
    commentaryOnly: finalMessages.length === 0 && commentary.length > 0,
    webSearchCalls: searchCalls.length, technicalResearchCalls: researchCalls.length,
    technicalResearchErrors:researchErrors,
    routeAdoption:researchCalls.length?'technical-research-called':searchCalls.length?'web-search-used-without-technical-research':'no-search-call-observed',
    observedFailureBoundary: streamFailure ? 'model-response-stream' :
      mcp.some(e => e.status === 'failed') ? 'mcp-startup' : 'not-established',
    limits: 'A response-stream failure does not identify which upstream proxy, network hop, model backend or payload caused it. No search call is not evidence of slow search execution.' };
}

export function retestFailures({ runtimeError, markers, final, hooks, requireTechnicalResearch = false, technicalResearchCalls = [] }) {
  const failures = runtimeError ? [runtimeError] : [];
  // A router may legitimately return zero candidates. No candidate block is
  // not evidence that the Hook failed; required tool behavior is tested below.
  if (!markers.ADAPTIVE_TOOL_SCHEDULING_CONTRACT_V4 || !markers.GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3) failures.push('Missing automatic reminder input markers');
  if (!final) failures.push('No final answer');
  if (hooks.filter(h => h.source === 'user' && ['sessionStart', 'userPromptSubmit'].includes(h.eventName) && h.status === 'completed').length !== 2) failures.push('Both user Hook lifecycle events must complete');
  if (requireTechnicalResearch && !technicalResearchCalls.some(call => call.status === 'completed' && call.returnedCount > 0)) failures.push('No completed technical-research call with returned candidates');
  return failures;
}
