import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
const referenceIds = text => text === null ? [] : [...new Set([...text.matchAll(/【(turn\d+(?:search|view|fetch)\d+)】/g)].map(match=>match[1]))];
function excerptEvidence(text) {
  const rendered = typeof text === 'string' && text.includes('Web results. Excerpts are retrieved source text.');
  const sourceUrls = rendered ? [...new Set([...text.matchAll(/^Source URL: (https?:\/\/\S+)\s*$/gm)].map(match=>match[1]))] : [];
  const omitted = rendered && text.includes('Some source text was unavailable or omitted by policy/output limits.');
  return { contentForm: rendered ? 'source-excerpts' : 'unknown', listedSourceUrls: sourceUrls,
    listedSourceCount: sourceUrls.length || null, upstreamContentOmitted: omitted ? true : 'unknown',
    omissionNotice: omitted ? 'Some source text was unavailable or omitted by policy/output limits.' : null };
}
const rawItem = event => event.method === 'rawResponseItem/completed' ? event.params?.item : null;
const isWebCall = item => ['function_call', 'custom_tool_call'].includes(item?.type) &&
  ((item.namespace === 'web' && item.name === 'run') || ['web.run', 'web_run'].includes(item.name));

function outputText(output) {
  if (typeof output === 'string') return output;
  const blocks = Array.isArray(output) ? output : output?.content;
  if (!Array.isArray(blocks)) return null;
  const text = blocks.filter(block => ['input_text', 'output_text', 'text'].includes(block?.type));
  if (!text.length && blocks.length) return null;
  if (text.some(block => typeof block.text !== 'string')) return null;
  return text.map(block => block.text).join('');
}

export class WebSearchEvidence {
  #calls = new Map();
  #envelopes = new Map();
  #entry(id) {
    if (!this.#calls.has(id)) this.#calls.set(id, { callId: id, queries: [], action: null, results: null, output: undefined, envelopes: new Set() });
    return this.#calls.get(id);
  }
  observe(event) {
    const item = rawItem(event);
    if (['custom_tool_call', 'function_call'].includes(item?.type) && ['exec', 'wait'].includes(item.name)) {
      this.#envelopes.set(item.call_id, { callId: item.call_id, name: item.name, active: true, webCalls: new Set() });
    }
    if (['custom_tool_call_output', 'function_call_output'].includes(item?.type) && this.#envelopes.has(item.call_id)) {
      const envelope = this.#envelopes.get(item.call_id);envelope.output = item.output;envelope.active = false;
    }
    if (['item/started', 'item/completed'].includes(event.method) && event.params?.item?.type === 'webSearch') {
      const call = this.#entry(event.params.item.id);
      for (const envelope of this.#envelopes.values()) if (envelope.active) {
        envelope.webCalls.add(call.callId);call.envelopes.add(envelope.callId);
      }
    }
    if (isWebCall(item)) {
      const call = this.#entry(item.call_id);
      call.rawArguments = item.type === 'custom_tool_call' ? item.input : item.arguments;
      try {
        const args = JSON.parse(call.rawArguments);
        call.queries = (args.search_query || []).map(query => query.q).filter(q => typeof q === 'string');
        call.arguments = args;
      } catch { call.argumentsInvalid = true; }
    } else if (item?.type === 'web_search_call' && item.id) {
      const call = this.#entry(item.id);
      call.action = item.action ?? call.action;
    } else if (['function_call_output', 'custom_tool_call_output'].includes(item?.type) && this.#calls.has(item.call_id)) {
      this.#calls.get(item.call_id).output = item.output;
    }
    const completed = event.method === 'item/completed' && event.params?.item?.type === 'webSearch' ? event.params.item : null;
    if (completed) {
      const call = this.#entry(completed.id);
      call.action = completed.action ?? call.action;
      if (Array.isArray(completed.results)) call.results = completed.results;
      if (Array.isArray(call.action?.queries)) call.queries = call.action.queries;
      else if (!call.queries.length && typeof call.action?.query === 'string') call.queries = [call.action.query];
      call.completedAt = event.at;
    }
  }
  safeEvent(event) {
    const item = rawItem(event);
    if (!item) return event;
    // Search artifacts only: never retain encrypted reasoning or unrelated raw inputs.
    if (isWebCall(item) || item.type === 'web_search_call' ||
        (['function_call_output', 'custom_tool_call_output'].includes(item.type) &&
          (this.#calls.has(item.call_id) || this.#envelopes.get(item.call_id)?.webCalls.size))) {
      const { encrypted_content, internal_chat_message_metadata_passthrough, ...safe } = item;
      return { ...event, params: { ...event.params, item: safe } };
    }
    return { ...event, params: { threadId: event.params.threadId, turnId: event.params.turnId,
      item: { type: item.type, ...(item.id ? { id: item.id } : {}), ...(item.name ? { name: item.name } : {}),
        ...(item.namespace ? { namespace: item.namespace } : {}), ...(item.call_id ? { call_id: item.call_id } : {}),
        omitted: 'not a web evidence item' } } };
  }
  async save(directory) {
    await mkdir(path.join(directory, 'web-artifacts'), { recursive: true });
    const envelopes=[];
    for (const envelope of this.#envelopes.values()) if (envelope.webCalls.size && envelope.output !== undefined) {
      const stem=`web-artifacts/envelope-${digest(envelope.callId).slice(0,24)}`;
      const text=outputText(envelope.output);
      await writeFile(path.join(directory,stem+'.json'),JSON.stringify(envelope.output,null,2)+'\n',{mode:0o600});
      if(text!==null)await writeFile(path.join(directory,stem+'.txt'),text,{mode:0o600});
      envelopes.push({callId:envelope.callId,name:envelope.name,webCallIds:[...envelope.webCalls],
        characters:text===null?null:Array.from(text).length,utf8Bytes:text===null?null:Buffer.byteLength(text),
        sha256:text===null?null:digest(text),artifact:text===null?null:stem+'.txt',jsonArtifact:stem+'.json',
        listedReferenceIds:referenceIds(text),listedReferenceCount:referenceIds(text).length||null,
        ...excerptEvidence(text),
        scope:'shared exec/wait envelope; temporal overlap is not exact inner-call ownership',recorderTruncated:false});
    }
    const calls = [];
    for (const call of this.#calls.values()) {
      const stem = `web-artifacts/${digest(String(call.callId)).slice(0, 24)}`;
      const hasResults = Array.isArray(call.results);
      const hasOutput = call.output !== undefined && call.output !== null;
      const text = hasOutput ? outputText(call.output) : null;
      const resultsJson = hasResults ? JSON.stringify(call.results, null, 2) + '\n' : null;
      const outputJson = hasOutput ? JSON.stringify(call.output, null, 2) + '\n' : null;
      const relatedEnvelopes=envelopes.filter(envelope=>call.envelopes.has(envelope.callId));
      const listedReferenceIds = referenceIds(text);
      if (hasResults) await writeFile(path.join(directory, stem + '.results.json'), resultsJson, { mode: 0o600 });
      if (hasOutput) await writeFile(path.join(directory, stem + '.output.json'), outputJson, { mode: 0o600 });
      if (text !== null) await writeFile(path.join(directory, stem + '.output.txt'), text, { mode: 0o600 });
      const flags = (call.results || []).filter(result => result && typeof result === 'object').map(result => result.truncated);
      const upstreamTruncated = flags.some(flag => flag === true) ? true :
        flags.length && flags.every(flag => flag === false) ? false : 'unknown';
      calls.push({ callId: call.callId, action: call.action, queries: call.queries,
        queryCount: call.queries.length || (call.action?.type === 'search' ? null : 0),
        ...(call.arguments ? { arguments: call.arguments } : {}),
        structuredResultCount: hasResults ? call.results.length : null,
        structuredResultsUtf8Bytes: hasResults ? Buffer.byteLength(resultsJson) : null,
        structuredResultsArtifact: hasResults ? stem + '.results.json' : null,
        uniqueResultUrls: [...new Set((call.results || []).map(result => result?.url).filter(url => typeof url === 'string'))],
        referenceIds: [...new Set((call.results || []).map(result => result?.ref_id).filter(id => typeof id === 'string'))],
        listedReferenceIds, listedReferenceCount: listedReferenceIds.length || null,
        modelFacingEnvelopeIds:relatedEnvelopes.map(envelope=>envelope.callId),
        envelopeCorrelation:relatedEnvelopes.length?'temporal overlap only; inspect shared output before attributing sources':'not observed',
        modelOutput: { observed: hasOutput, characters: text === null ? null : Array.from(text).length,
          utf8Bytes: text === null ? null : Buffer.byteLength(text), sha256: text === null ? null : digest(text),
          artifact: text === null ? null : stem + '.output.txt', jsonArtifact: hasOutput ? stem + '.output.json' : null,
          evidence: hasOutput ? 'raw function_call_output item; not a server-input receipt' : 'not exposed by this event stream' },
        ...excerptEvidence(text),
        coverage: hasResults && hasOutput ? 'complete' : hasResults ? 'structured-only' : hasOutput ? 'output-only' : 'unavailable',
        upstreamTruncated, recorderTruncated: false, modelConsumedAll: 'unknown', completedAt: call.completedAt ?? null });
    }
    const summary = { schemaVersion: 'web-search-evidence/1', calls, envelopes,
      modelFacingOutputArtifactCount: envelopes.length + calls.filter(call=>call.modelOutput.observed).length,
      uniqueListedSourceUrls:[...new Set([...envelopes.flatMap(envelope=>envelope.listedSourceUrls),...calls.flatMap(call=>call.listedSourceUrls)])],
      complete: calls.length > 0 && calls.every(call => call.coverage === 'complete'),
      limits: 'Result entries are not necessarily distinct pages. Missing results are unknown, never zero. Source snippets are not full pages. Recorded tool output does not prove the subsequent model request contained it, or that the model consumed it. Upstream truncation is unknown unless explicitly flagged.' };
    await writeFile(path.join(directory, 'web-search-evidence.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
    return summary;
  }
}
