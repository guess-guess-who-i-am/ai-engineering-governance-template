#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MODEL = "text-embedding-3-large";
const DEFAULT_BASE_URL = "https://api.agicto.cn/v1";
const MAX_QUERY_CACHE = 128;
const BATCH_SIZE = 4;
const BUILD_CONCURRENCY = 2;

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

function hash(value) { return crypto.createHash("sha256").update(String(value), "utf8").digest("hex"); }
function documentText(document) { return String(document?.text || "").replace(/\s+/g, " ").trim(); }
function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) return 0;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]) || 0; const b = Number(right[index]) || 0;
    dot += a * b; leftNorm += a * a; rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

async function loadCache(cachePath, model) {
  try {
    const value = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (value.schemaVersion !== "codex-semantic-index/1" || value.model !== model) return { records: {}, queries: {} };
    return { records: value.records || {}, queries: value.queries || {} };
  } catch { return { records: {}, queries: {} }; }
}

async function saveCache(cachePath, model, cache) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const entries = Object.entries(cache.queries)
    .sort((left, right) => Number(right[1].createdAt || 0) - Number(left[1].createdAt || 0))
    .slice(0, MAX_QUERY_CACHE);
  const payload = JSON.stringify({ schemaVersion: "codex-semantic-index/1", model, generatedAt: new Date().toISOString(), records: cache.records, queries: Object.fromEntries(entries) });
  const tempPath = `${cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, payload, "utf8");
  await fs.rename(tempPath, cachePath);
}

async function requestEmbeddings(inputs, baseUrl, apiKey, model) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: inputs }),
    signal: AbortSignal.timeout(input.buildMissing === true ? 60000 : 8000),
  });
  if (!response.ok) throw new Error(`embedding request failed (${response.status})`);
  const body = await response.json();
  const data = Array.isArray(body?.data) ? body.data : [];
  return data.sort((left, right) => Number(left.index || 0) - Number(right.index || 0)).map(item => item.embedding);
}

async function embedMissing(inputs, baseUrl, apiKey, model) {
  const batches = [];
  for (let index = 0; index < inputs.length; index += BATCH_SIZE) batches.push({ offset: index, values: inputs.slice(index, index + BATCH_SIZE) });
  const vectors = new Array(inputs.length);
  for (let index = 0; index < batches.length; index += BUILD_CONCURRENCY) {
    const results = await Promise.all(batches.slice(index, index + BUILD_CONCURRENCY).map(batch => requestEmbeddings(batch.values, baseUrl, apiKey, model).then(values => ({ offset: batch.offset, values }))));
    for (const result of results) result.values.forEach((value, offset) => { vectors[result.offset + offset] = value; });
  }
  if (vectors.some(value => !Array.isArray(value))) throw new Error("embedding response count mismatch");
  return vectors;
}

const input = await readInput();
const query = String(input.query || "").trim();
const buildOnly = input.buildOnly === true;
const documents = Array.isArray(input.documents) ? input.documents.filter(item => item && item.id && documentText(item)) : [];
if ((!query && !buildOnly) || !documents.length) { process.stdout.write(JSON.stringify({ available: false, reason: "missing query or documents", results: [] })); process.exit(0); }

const baseUrl = String(process.env.CODEX_EMBEDDING_BASE_URL || process.env.AGICTO_EMBEDDING_BASE_URL || DEFAULT_BASE_URL).trim();
const apiKey = String(process.env.CODEX_EMBEDDING_API_KEY || process.env.AGICTO_API_KEY || "").trim();
const model = String(process.env.CODEX_EMBEDDING_MODEL || DEFAULT_MODEL).trim();
if (!apiKey) { process.stdout.write(JSON.stringify({ available: false, reason: "missing CODEX_EMBEDDING_API_KEY", results: [] })); process.exit(0); }

const cachePath = String(input.cachePath || process.env.CODEX_EMBEDDING_CACHE || path.join(process.env.CODEX_HOME || ".", "semantic-index.json"));
const cache = await loadCache(cachePath, model);
let changed = false;
const missing = [];
const missingKeys = [];
for (const document of input.buildMissing === true ? documents : []) {
  const text = documentText(document); const key = hash(`${document.id}\n${text}`);
  if (!cache.records[key]) { missing.push(text); missingKeys.push({ key, document }); }
}
try {
  if (missing.length) {
    const vectors = await embedMissing(missing, baseUrl, apiKey, model);
    vectors.forEach((embedding, index) => { cache.records[missingKeys[index].key] = { id: missingKeys[index].document.id, embedding, createdAt: Date.now() }; });
    changed = true;
  }
  if (buildOnly) {
    if (changed) await saveCache(cachePath, model, cache);
    const indexedCount = documents.filter(document => cache.records[hash(`${document.id}\n${documentText(document)}`)]).length;
    process.stdout.write(JSON.stringify({ available: true, model, indexedCount, results: [] }));
    process.exit(0);
  }
  const indexedDocuments = documents.filter(document => cache.records[hash(`${document.id}\n${documentText(document)}`)]);
  if (!indexedDocuments.length) {
    process.stdout.write(JSON.stringify({ available: false, reason: "semantic index has no matching documents", results: [] }));
    process.exit(0);
  }
  const queryKey = hash(query);
  let queryEmbedding = cache.queries[queryKey]?.embedding;
  if (!Array.isArray(queryEmbedding)) {
    queryEmbedding = (await requestEmbeddings([query], baseUrl, apiKey, model))[0];
    cache.queries[queryKey] = { embedding: queryEmbedding, createdAt: Date.now() }; changed = true;
  }
  const results = indexedDocuments.map(document => {
    const key = hash(`${document.id}\n${documentText(document)}`);
    return { id: String(document.id), score: cosine(queryEmbedding, cache.records[key]?.embedding) };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, Math.min(32, Math.max(1, Number(input.topK) || 4)));
  if (changed) await saveCache(cachePath, model, cache);
  process.stdout.write(JSON.stringify({ available: true, model, results }));
} catch (error) {
  process.stderr.write(`semantic ranker skipped: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stdout.write(JSON.stringify({ available: false, reason: "embedding request failed", results: [] }));
}
