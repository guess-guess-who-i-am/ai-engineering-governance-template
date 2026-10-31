#!/usr/bin/env node
// Read-only package audit. Scalar extraction is intentionally not a general YAML parser.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
const root = arg('--root') || path.join(os.homedir(), 'Desktop/破解workbuddy/统一资源库');
const output = arg('--output');
const exists = async file => { try { await fs.access(file); return true; } catch { return false; } };
const hash = text => createHash('sha256').update(text).digest('hex');
const scrub = text => text.replace(/(?:sk-[\w-]{16,}|(?:token|api[_-]?key|password)\s*[=:]\s*["']?[\w-]{16,})/gi, '[REDACTED]');

export function scalar(block, key) {
  const lines = block.split(/\r?\n/);
  const i = lines.findIndex(line => new RegExp(`^${key}:`).test(line));
  if (i < 0) return { value: '', style: 'missing' };
  const initial = lines[i].slice(lines[i].indexOf(':') + 1).trim();
  const more = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() && !/^\s/.test(lines[j])) break;
    more.push(lines[j]);
  }
  const blockStyle = /^[>|][+-]?(?:\s+#.*)?$/.test(initial);
  const value = (blockStyle ? more.join(' ') : [initial, ...more].join(' '))
    .replace(/\s+/g, ' ').trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  return { value, style: blockStyle ? 'block' : more.some(x => x.trim()) ? 'continued' : 'single' };
}

async function walk(dir, base = dir, result = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '__pycache__'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file, base, result);
    else if (entry.isFile()) result.push(path.relative(base, file));
  }
  return result;
}

async function audit() {
  const start = performance.now();
  const input = JSON.parse(await fs.readFile(path.join(root, '审计/skills.json'), 'utf8'));
  const rows = [];
  const queue = [...input];
  // Bounded independent filesystem reads; no source mutation and no network calls.
  await Promise.all(Array.from({ length: 20 }, async () => {
    for (let item; (item = queue.shift());) {
      const packageRoot = path.join(root, item.unified_path);
      const entry = path.join(packageRoot, 'SKILL.md');
      try {
        const text = await fs.readFile(entry, 'utf8');
        const frontmatter = text.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '';
        const desc = scalar(frontmatter, 'description');
        const files = await walk(packageRoot);
        const missingLinks = [];
        for (const link of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
          const target = link[1].replace(/^<|>$/g, '').split('#')[0];
          if (!target || /^(?:[a-z]+:|\/|~)/i.test(target) || target.includes('$')) continue;
          if (!await exists(path.resolve(packageRoot, decodeURIComponent(target)))) missingLinks.push(target);
        }
        const hostHints = [...new Set((text.match(/\b(?:workbuddy_cloud_service|TeamCreate|SendMessage|AskUserQuestion|WebSearch|WebFetch|mcp__[A-Za-z0-9_]+|CODEBUDDY[A-Z_]*|WORKBUDDY[A-Z_]*)\b/g) || []))];
        const flags = [];
        if (!frontmatter) flags.push('missing-frontmatter');
        if (!desc.value || /^[>|][+-]?$/.test(desc.value)) flags.push('missing-description');
        if (desc.value.length < 24) flags.push('short-description');
        if (!/[\u3400-\u9fff]/.test(desc.value)) flags.push('no-chinese-description');
        if (/任何.{0,12}(请求|任务)|any (?:task|request)|always (?:use|trigger)|默认第一入口/i.test(desc.value)) flags.push('broad-trigger');
        if (hostHints.length) flags.push('host-tool-hints');
        if (missingLinks.length) flags.push('missing-relative-markdown-link');
        if (/\.workbuddy|\.codebuddy|\.claude|CLAUDE_PLUGIN_ROOT|CODEBUDDY_PLUGIN_ROOT/.test(text)) flags.push('host-path-hints');
        const legacy = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
        if (desc.value.length > legacy.length + 10) flags.push('legacy-parser-loses-description');
        rows.push({ name: item.name, path: packageRoot, entry: 'SKILL.md', entryHash: hash(text),
          description: scrub(desc.value), descriptionStyle: desc.style,
          licenseClaim: scalar(frontmatter, 'license').value || 'not-declared-in-entry',
          files: files.length, scripts: files.filter(f => /^(scripts|bin)\//.test(f) && /\.(py|m?js|sh|ps1)$/.test(f)),
          hostHints, missingLinks, flags, auditStatus: 'static-only-not-execution-proof' });
      } catch (error) { rows.push({ name: item.name, path: packageRoot, flags: ['unreadable'], error: error.code || error.name }); }
    }
  }));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const counts = {};
  for (const r of rows) for (const flag of r.flags) counts[flag] = (counts[flag] || 0) + 1;
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), root, count: rows.length,
    elapsedMs: Math.round(performance.now() - start), counts,
    limitations: ['Scalar extraction supports common scalar/block forms, not all YAML.',
      'Flags identify review candidates; English-only descriptions do not prove failed multilingual retrieval.',
      'Only Markdown relative links checked; code-string paths and transitive dependency closure require execution.',
      'Licenses are claims in frontmatter, not independently verified legal provenance.',
      'Original complete package directories remain unmodified.'], rows };
}

async function trials() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'resource-skill-trials-'));
  const results = [];
  async function input(name, content) {
    const file = path.join(temp, name);
    await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
  }
  async function run(skill, caseName, args, check) {
    const start = performance.now();
    const processResult = spawnSync(arg('--python') || 'python3', args, { cwd: temp, encoding: 'utf8', timeout: 15000 });
    let observed;
    try { observed = await check(processResult); }
    catch (e) { observed = { passed: false, detail: String(e) }; }
    results.push({ skill, caseName, command: ['python3', ...args], elapsedMs: Math.round(performance.now() - start),
      exitCode: processResult.status, stdout: processResult.stdout?.slice(0,2500), stderr: processResult.stderr?.slice(0,1500),
      ...observed, tokenUsage: 'unknown-no-model-call-metering' });
  }
  const packagePath = name => path.join(root, 'skills', name);
  const citation = path.join(packagePath('citation-management'), 'scripts/format_bibtex.py');
  const simple = await input('simple.bib', '@article{A,\n author={Smith, John; Doe, Jane},\n title={Reliable systems},\n journal={Example},\n year={2024},\n pages={1-10},\n doi={https://doi.org/10.1234/test}\n}\n@article{B,\n title={Reliable systems},\n doi={10.1234/test}\n}\n');
  const simpleOut = path.join(temp, 'simple-out.bib');
  await run('citation-management', 'normalize-and-deduplicate', [citation, simple, '--deduplicate', '--output', simpleOut], async r => {
    const t = await fs.readFile(simpleOut, 'utf8');
    return { passed: r.status === 0 && (t.match(/@article/g)||[]).length === 1 && t.includes('1--10') && t.includes('Smith, John and Doe, Jane'), detail: t };
  });
  const nested = await input('nested.bib', '@article{Nested,\n author={{World Health Organization}},\n title={Learning with {DNA} and {RNA}},\n journal={Example},\n year={2024}\n}\n');
  const nestedOut = path.join(temp, 'nested-out.bib');
  await run('citation-management', 'preserve-nested-braces-and-organization', [citation, nested, '--output', nestedOut], async r => {
    const t = await fs.readFile(nestedOut, 'utf8');
    return { passed: r.status === 0 && t.includes('Learning with {DNA} and {RNA}') && t.includes('{{World Health Organization}}'), detail: t };
  });
  await run('citation-management', 'documented-validate-option', [citation, simple, '--validate', '--output', path.join(temp,'validated.bib')], r => ({ passed: r.status === 0, detail: 'SKILL.md documents --validate; CLI should accept it.' }));

  const scholar = path.join(packagePath('scholar-evaluation'), 'scripts/calculate_scores.py');
  const dimensions = ['problem_formulation', 'literature_review', 'methodology', 'data_collection', 'analysis', 'results', 'writing', 'citations'];
  for (const [name, scores, expected] of [
    ['complete-dimensions', Object.fromEntries(dimensions.map(x=>[x,4])), '4.00'],
    ['partial-dimension-normalization', { methodology:4 }, '4.00']
  ]) {
    const file = await input(name+'.json', scores);
    await run('scholar-evaluation', name, [scholar, '--scores', file], r => ({ passed: r.status === 0 && r.stdout.includes('Overall Score: '+expected+' / 5.00'), detail: 'Expected weighted average '+expected+' within 1–5.' }));
  }
  const invalid = await input('invalid-score.json', { methodology:6 });
  await run('scholar-evaluation', 'reject-out-of-range-score', [scholar,'--scores',invalid], r => ({ passed: r.status !== 0 && r.stdout.includes('between 1 and 5'), detail: 'Invalid score must produce nonzero exit.' }));

  const budget = path.join(packagePath('budget-balance'), 'scripts/balance_budget.py');
  const itin = await input('itinerary.json', {main_city:'FixtureCity',days:[{stops:[{poi:{ticket_price:20}}]}]});
  const transport = await input('transport.json', {outbound:{options:[{price_ref:100}]},return:{options:[{price_ref:100}]}});
  const hotel = await input('hotel.json', [{price_per_night_ref:600}]);
  const bench = await input('bench.json', {cities:{FixtureCity:{hotel:{standard:[400,800]},food:{standard:[50,70]},transport_intra:{subway_avg:5,taxi_avg_per_trip:25}}},default_ratio_by_tier:{standard:{hotel:0.4,food:0.3}}});
  for (const [caseName,budgetPerPerson] of [['within-budget',2000],['overspend-party-four',1000]]) {
    const trip = await input(caseName+'.json',{duration_days:4,party_size:4,budget_tier:'standard',budget_total_per_person:budgetPerPerson});
    const out = path.join(temp,caseName+'-result.json');
    await run('budget-balance',caseName,[budget,'--trip',trip,'--itinerary',itin,'--transport',transport,'--hotel',hotel,'--bench',bench,'--output',out],async r=>{
      const data=JSON.parse(await fs.readFile(out,'utf8'));
      const arithmetic=data.grand_total===4796 && data.per_person_total===1199;
      const savings=data.tradeoffs.find(x=>x.id==='downgrade-hotel')?.savings_per_person;
      const restaurant=data.tradeoffs.find(x=>x.id==='swap-restaurant')?.savings_per_person;
      return {passed:r.status===0&&arithmetic&&(budgetPerPerson===2000?data.tradeoffs.length===0:savings===135&&restaurant===60),
        detail:{expectedTotal:4796,expectedPerPerson:1199,expectedHotelSavingsPerPerson:budgetPerPerson===1000?135:null,expectedFoodSavingsPerPerson:budgetPerPerson===1000?60:null,actual:data}};
    });
  }
  return {generatedAt:new Date().toISOString(),tempDirectory:temp,scope:'Real standard-library helper invocations using synthetic local fixtures; not full skill/model quality or external service acceptance.',results};
}

if (process.argv.includes('--self-test')) {
  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  assert(scalar('description: >-\n  查找论文\n  并核验引用\nlicense: MIT', 'description').value === '查找论文 并核验引用', 'folded description');
  assert(scalar('description: "One task"\nname: x', 'description').value === 'One task', 'quoted scalar');
  assert(scalar('name: x', 'description').style === 'missing', 'missing field');
  console.log('3 scalar extraction checks passed');
} else if (process.argv.includes('--trials')) {
  const report = await trials();
  if (output) {
    const auditReport = JSON.parse(await fs.readFile(output, 'utf8'));
    auditReport.trials = report;
    for (const row of auditReport.rows) {
      const cases = report.results.filter(x => x.skill === row.name);
      if (cases.length) row.helperTrialStatus = cases.every(x => x.passed) ? 'tested-subset-passed' : 'known-helper-failure';
    }
    await fs.writeFile(output, JSON.stringify(auditReport, null, 2)+'\n');
  }
  console.log(JSON.stringify(report, null, 2));
} else {
  const report = await audit();
  if (output) { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ count: report.count, elapsedMs: report.elapsedMs, counts: report.counts, output }, null, 2));
}
