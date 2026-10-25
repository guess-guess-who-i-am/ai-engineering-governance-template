import assert from 'node:assert/strict';
import { assessReactUpdaterEvidence } from './resource-docs-evidence.mjs';
const source = 'Source: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useState.md\n';
const code = body => '```js\n' + body + '\n```';
const examples = [
  ['number/setNumber actual style', source + code('const [number, setNumber] = useState(0); setNumber(n => n + 1);'), true],
  ['age/setAge actual style', source + code('const [age, setAge] = useState(42); setAge(a => a + 1);'), true],
  ['counter variant', source + code('const [count, setCount] = useState(0); setCount(previous => previous + 1);'), true],
  ['parenthesized parameter', source + code('const [score, setScore] = useState(2); setScore((previous) => previous + 1);'), true],
  ['only keywords', source + 'useState setCount updater previous =>', false],
  ['wrong setter', source + code('const [count, setCount] = useState(0); setOther(n => n + 1);'), false],
  ['non-updater next state', source + code('const [count, setCount] = useState(0); setCount(count + 1);'), false],
  ['constant updater ignores previous', source + code('const [count, setCount] = useState(0); setCount(n => count + 1);'), false],
  ['no source', code('const [count, setCount] = useState(0); setCount(n => n + 1);'), false],
  ['nonofficial source', 'Source: https://example.com/react\n' + code('const [count, setCount] = useState(0); setCount(n => n + 1);'), false],
  ['source hostname spoof', 'Source: https://react.dev.evil.test/hooks\n' + code('const [count, setCount] = useState(0); setCount(n => n + 1);'), false],
  ['string initial state', source + code('const [count, setCount] = useState("0"); setCount(n => n + 1);'), false],
  ['wrong updater increment', source + code('const [count, setCount] = useState(0); setCount(n => n + 2);'), false],
  ['split unrelated code blocks', source + code('const [count, setCount] = useState(0);') + '\n' + code('setCount(n => n + 1);'), false],
  ['unrelated source section', source + 'A real React source.\n---\nSource: https://example.com\n' + code('const [count, setCount] = useState(0); setCount(n => n + 1);'), false],
  ['comment-only updater', source + code('const [count, setCount] = useState(0); // setCount(n => n + 1);'), false]
];
const rows = examples.map(([name, text, expected]) => ({ name, expected, actual: assessReactUpdaterEvidence(text).passed }));
console.log(JSON.stringify(rows));
assert.ok(rows.every(row => row.expected === row.actual), rows.filter(row => row.expected !== row.actual).map(row => row.name).join(', '));
console.log(`PASS: ${rows.length} React updater evidence positive/negative fixtures`);
