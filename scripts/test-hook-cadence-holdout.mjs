#!/usr/bin/env node
// Independent specification-based checks for saved Agent workspaces.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const checks = {
  port(module) {
    for (const [value, expected] of [['0', 0], ['1', 1], ['80', 80], ['65535', 65535]]) {
      assert.equal(module.parsePort(value), expected, `parsePort(${JSON.stringify(value)})`);
    }
    for (const value of ['', '-1', '+2', ' 80', '80 ', '1.5', '65536', '0x10', '1e2', '01x']) {
      assert.throws(() => module.parsePort(value), RangeError, `parsePort(${JSON.stringify(value)})`);
    }
  },
  ttl(module) {
    const cache = module.makeCache();
    assert.equal(cache.get('missing', 0), undefined);
    cache.set('a', 10, 5);
    cache.set('b', 20, 8);
    assert.equal(cache.get('a', 4), 10);
    assert.equal(cache.get('a', 5), undefined);
    assert.equal(cache.get('b', 5), 20);
    cache.set('a', 30, 12);
    assert.equal(cache.get('a', 11), 30);
    assert.equal(cache.get('a', 12), undefined);
    assert.equal(cache.get('b', 8), undefined);
  },
  csv(module) {
    for (const [value, expected] of [
      ['a,b', ['a', 'b']], [',', ['', '']], ['"",x', ['', 'x']],
      ['a,"b,c"', ['a', 'b,c']], ['"a""b",c', ['a"b', 'c']],
      ['"a,b","c""d"', ['a,b', 'c"d']]
    ]) assert.deepEqual(module.parseRow(value), expected, `parseRow(${JSON.stringify(value)})`);
    for (const value of ['"a,b', 'a,"b', 'a', 'a,b,c']) {
      assert.throws(() => module.parseRow(value), undefined, `parseRow(${JSON.stringify(value)})`);
    }
    for (const value of ['"a,b', 'a,"b']) {
      assert.throws(() => module.parseRow(value), SyntaxError, `parseRow(${JSON.stringify(value)})`);
    }
  }
};

const reportFiles = process.argv.slice(2);
if (!reportFiles.length) throw new Error('Pass one or more saved Agent JSON reports.');
let failed = 0;
for (const reportFile of reportFiles) {
  const report = JSON.parse(await readFile(reportFile, 'utf8'));
  for (const [index, item] of report.cases.entries()) {
    const name = item.name || (path.basename(reportFile).startsWith('hook-cadence-codex-') ? 'ttl' : '');
    const label = `${path.basename(reportFile)} ${name} k=${item.interval} r=${item.repeat || 1}`;
    try {
      const source = path.join(item.workspace || item.cwd, 'src.mjs');
      const module = await import(`${pathToFileURL(source).href}?holdout=${index}`);
      if (!checks[name]) throw new Error(`Unsupported task: ${name}`);
      checks[name](module);
      process.stdout.write(`PASS ${label}\n`);
    } catch (error) {
      failed++;
      process.stdout.write(`FAIL ${label}: ${error.message}\n`);
    }
  }
}
process.stdout.write(`Holdout failures: ${failed}\n`);
if (failed) process.exitCode = 1;
