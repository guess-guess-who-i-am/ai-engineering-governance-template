// Conservative documentation-content gate, not a JavaScript compiler or a proof
// that retrieved code executes. Match the binding and updater in one sourced block.
function officialSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'react.dev' || (url.hostname === 'github.com' && /^\/reactjs\/react\.dev\//.test(url.pathname)));
  } catch { return false; }
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function executableText(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
}
export function assessReactUpdaterEvidence(text) {
  const evidence = [];
  const assertions = { officialReactSource: false, fencedCode: false, numericStateBinding: false, sameSetterPreviousPlusOne: false };
  const blocks = /```[^\n]*\n([\s\S]*?)```/g;
  for (const block of text.matchAll(blocks)) {
    assertions.fencedCode = true;
    const before = text.slice(0, block.index);
    const sources = [...before.matchAll(/^Source:\s*(https?:\/\/[^\s]+)\s*$/gm)];
    const source = sources.at(-1)?.[1];
    if (!officialSource(source)) continue;
    assertions.officialReactSource = true;
    const code = executableText(block[1]);
    const binding = /\b(?:const|let|var)\s*\[\s*([$A-Z_a-z][$\w]*)\s*,\s*([$A-Z_a-z][$\w]*)\s*\]\s*=\s*(?:React\.)?useState(?:\s*<\s*number\s*>)?\s*\(\s*[-+]?\d+(?:\.\d+)?\s*\)/g;
    for (const match of code.matchAll(binding)) {
      assertions.numericStateBinding = true;
      const setter = match[2];
      const updater = new RegExp('\\b' + escape(setter) + '\\s*\\(\\s*(?:\\(\\s*([$A-Z_a-z][$\\w]*)\\s*\\)|([$A-Z_a-z][$\\w]*))\\s*=>\\s*([^;\\n]+)', 'g');
      for (const update of code.matchAll(updater)) {
        const parameter = update[1] || update[2];
        const expression = new RegExp('^\\s*' + escape(parameter) + '\\s*\\+\\s*1\\s*\\)');
        if (!expression.test(update[3])) continue;
        assertions.sameSetterPreviousPlusOne = true;
        evidence.push({ source, state: match[1], setter, updaterParameter: parameter, numericInitialState: true });
      }
    }
  }
  return { passed: evidence.length > 0, assertions, evidence, limitation: 'Lexical evidence from one official-source code block; not code execution or complete JavaScript semantic verification.' };
}
