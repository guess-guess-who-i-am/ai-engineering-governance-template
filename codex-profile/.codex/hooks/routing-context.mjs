import { open } from 'node:fs/promises';
import path from 'node:path';

// Only semantically incomplete discourse forms inherit a task. This is a
// conservative linguistic resolver, not a claim of general coreference NLP.
function isFollowup(prompt) {
  const words = '并且|然后|并|好的|好|可以|行|那么|那|就|请|嗯|是的|是|对|都|也|再|先|直接|帮我|把|按照|照|按|这样|那样|这个|这些|那个|那些|上述|上面|前面|继续|还是|仍然|执行|修改|改|做|修|统一|部署|测试|验证|完成|一下|吧|啊|呢|了|的|办|开始|用|方案|推荐|现在|目前|已经|能否|能不能|能|不能|还|之前|原来|一点|点|够|么|稳定|耗时|准确率|召回率|精确率|改进|不错|什么|怎么说|比|过|具体|实际|真的|到底|到底是|是不是|是否|变得|变|更|比较|效果|准确|精确|好不好|好|坏|快|慢|有用|可用|能用|正常|成功|失败|怎么样|如何|怎么|为什么|为啥|还有|有没有|没有|遗漏|问题|有|没|不|吗|多|少|多少|变化|提升|改善|提高|降低|消耗|开销|速度|性能|成本|风险|第二个|第一个|第三个|第二种|第一种|第三种|其他|其它|你|说的|修好|看看';
  // Longest lexical token first: a prefix such as 改 must not consume 改进.
  const token = new RegExp(words.split('|').sort((a,b)=>b.length-a.length).join('|')+'|\\s|[，。！!,.?？:：]', 'uy');
  let offset = 0;
  while (offset < prompt.length) {
    token.lastIndex = offset;
    const match = token.exec(prompt);
    if (!match) break;
    offset = token.lastIndex;
  }
  if (offset === prompt.length) return true;
  return /^(?:(?:yes|ok(?:ay)?|please|then|go ahead|continue|do (?:it|that)|proceed)(?:[\s,.!]+(?:please|then|with (?:it|that)|as discussed|continue|do (?:it|that)|proceed))*|(?:is|does|did|will|would|can|could|has) (?:it|that|this|the (?:result|recommendation|approach|method))\b.*|(?:what|how) about (?:it|that|this|the (?:first|second|third) (?:one|option)|performance|accuracy|cost|risks?)|(?:why|how) (?:is|does|did) (?:it|that|this)\b.*|(?:any|anything) (?:else|missing)|(?:what|how) (?:has |did )?(?:changed|improved))[\s,.!?]*$/i.test(prompt);
}

function explicitTopic(prompt) {
  return /^(?:(?:好的|可以|请|好)[，,\s]*)?(?:换个话题|另外[，,]|另一个(?:独立)?(?:问题|任务)|新任务|与(?:前面|上面|之前)无关|new topic\b|unrelated (?:question|task)\b)/i.test(prompt);
}

function needsTaskContext(prompt) {
  const active = prompt.replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|「[^」]*」|"[^"\n]*"/gu, ' ');
  if (explicitTopic(active)) return false;
  if (/(?:这个|以下|如下)(?:问题|需求|任务|结果|方案|方法)[：:]\s*\S|(?:this|following) (?:problem|task|question|result|method)\s*:\s*\S/i.test(active)) return false;
  if (isFollowup(active)) return true;
  return /(?:这样|那样)|(?:这|那)(?:个|些|种)(?:问题|方案|方法|实现|结果|配置|指标|评价|推荐|部分|功能|改动)|(?:上次|刚才|前面|上述|先前)(?:的|提到|说|做|实现|推荐)|你(?:的|认为的)(?:评价|推荐|实现|结果|指标)|(?:第[一二三四五六七八九十]+|第\d+)个(?:方案|选项|方法)?|(?:那就|那么)(?:赶紧|继续|帮我|请|先|直接|把|尽快|\s)*(?:修好|修改|修复|改好|继续)|\b(?:this|that|these|those) (?:problem|issue|result|method|approach|implementation|configuration|recommendation|option)s?\b|\b(?:earlier|previous) (?:method|result|approach|recommendation)s?\b/i.test(active);
}

const HISTORY_CHARS = 3200; // Retrieval context budget, not a confidence threshold.
const TRANSCRIPT_BYTES = 8 * 1024 * 1024; // Hard IO/memory cap; no all-session scan.
function safeHistoryText(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || /^(?:# AGENTS\.md|<environment_context>|<INSTRUCTIONS>|<system_reminder>|<send_user_message_question_reply>)/.test(text)) return '';
  if (/\b(?:sk-[a-z0-9_-]{12,}|(?:api[_-]?key|token|password|authorization)\s*[:=])|[?&](?:token|key)=|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text)) return '';
  return text;
}
function boundedText(text, limit) {
  if (text.length <= limit) return text;
  const head = Math.floor((limit - 5) / 2);
  return `${text.slice(0, head)}\n...\n${text.slice(-(limit - head - 5))}`;
}
function dialogueMessage(message) {
  if (!message || !['user', 'assistant'].includes(message.role)) return null;
  if (message.role === 'assistant' && (message.tool_calls?.length || (message.phase && message.phase !== 'final_answer'))) return null;
  const content = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
    ? message.content.filter(c => ['input_text', 'output_text', 'text'].includes(c.type)).map(c => c.text || '').join('\n') : '';
  const text = safeHistoryText(content);
  return text ? { role: message.role, content: text } : null;
}
async function transcriptDialogue(input) {
  if (!input.transcript_path) return [];
  const file = await open(input.transcript_path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Routing transcript is not a regular file');
    // Check the identity at the beginning even when the task is in the tail.
    const header = Buffer.alloc(Math.min(info.size, 16384));
    const first = await file.read(header, 0, header.length, 0);
    let meta;
    try { meta = JSON.parse(header.subarray(0, first.bytesRead).toString('utf8').split('\n')[0]); } catch { /* legacy fixture has no metadata */ }
    if (meta?.type === 'session_meta' && input.session_id && meta.payload?.id !== input.session_id) throw new Error('Routing transcript session scope mismatch');
    const size = Math.min(info.size, TRANSCRIPT_BYTES), offset = info.size - size;
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await file.read(buffer, 0, size, offset);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (offset) text = text.slice(text.indexOf('\n') + 1);
    const messages = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; } // bounded tail may end mid-record
      if (record.type !== 'response_item' || record.payload?.type !== 'message') continue;
      const message = dialogueMessage(record.payload);
      if (message) messages.push(message);
    }
    return messages;
  } finally { await file.close(); }
}

function resolvedMessages(messages, prompt) {
  // The host may append the current user message before running the Hook.
  // Cut at its latest occurrence; future messages must not affect this turn.
  const current = messages.findLastIndex(m => m.role === 'user' && m.content === prompt);
  if (current >= 0) messages = messages.slice(0, current);
  const users = messages.map((m,i)=>m.role==='user'?i:-1).filter(i=>i>=0);
  if (!users.length) return [];
  let anchor = users.length - 1;
  while (anchor > 0 && needsTaskContext(messages[users[anchor]].content)) anchor--;
  const anchorIndex = users[anchor];
  const task = messages[anchorIndex].content;
  if (needsTaskContext(task)) return []; // The root referent is outside the bounded history.
  const assistantReferent = /(?:方案|方法|选项|第[一二三四五六七八九十]+个|你说|你提到)|\b(?:option|approach|method|suggested|you (?:said|proposed|suggested))\b/i.test(prompt);
  const lastReply = messages.findLastIndex((m,i)=>i>anchorIndex && m.role==='assistant');
  const selected = [{role:'user', content:boundedText(task,1600)}];
  // Preserve recent user corrections before assistant narration. Neither has
  // authority to force a Skill invocation ahead of the actual current prompt.
  let remaining = HISTORY_CHARS - selected[0].content.length;
  const updates = [];
  for (let i=messages.length-1;i>anchorIndex;i--) {
    if (messages[i].role !== 'user' || isFollowup(messages[i].content)) continue;
    const content=boundedText(messages[i].content,Math.min(800,remaining));
    if (content.length > remaining || remaining < 80) break;
    updates.unshift({role:'user',content});remaining-=content.length;
  }
  selected.push(...updates);
  if (assistantReferent && lastReply > anchorIndex && remaining > 0) selected.push({role:'assistant',content:boundedText(messages[lastReply].content,Math.min(1200,remaining))});
  return selected;
}

// IDE transport is deliberately explicit and independently testable. Scanning
// in-memory messages is linear, while only this bounded selection crosses RPC.
export function createRoutingContext({sessionId,cwd,messages,prompt}) {
  if (!sessionId || !cwd || !Array.isArray(messages)) throw new Error('Routing context requires a session and workspace');
  const normalized = needsTaskContext(prompt) ? messages.map(dialogueMessage).filter(Boolean) : [];
  return {schemaVersion:'routing-context/1',sessionId,cwd:path.resolve(cwd),
    messages:needsTaskContext(prompt) ? resolvedMessages(normalized,prompt) : []};
}

// History is request-scoped retrieval data. No prompt cache, cross-session
// state, model call or scan of other conversations is performed here.
export async function routingQuery(input, prompt) {
  const reply = prompt.match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/);
  if (reply) {
    const answers = JSON.parse(reply[1]);
    if (!Array.isArray(answers)) throw new Error('Question reply must be an array');
    prompt = answers.map(answer => [answer.question, answer.answer].filter(value => typeof value === 'string').join('\n')).filter(Boolean).join('\n');
    if (!prompt) return '';
  }
  if (!needsTaskContext(prompt)) return prompt;
  let messages;
  if (input.routing_context) {
    const context = input.routing_context;
    if (context.schemaVersion !== 'routing-context/1' || !input.session_id || context.sessionId !== input.session_id ||
        typeof context.cwd !== 'string' || typeof input.cwd !== 'string' || path.resolve(context.cwd) !== path.resolve(input.cwd) || !Array.isArray(context.messages)) {
      throw new Error('Routing history session/workspace scope mismatch');
    }
    messages = context.messages.map(dialogueMessage).filter(Boolean);
  } else messages = await transcriptDialogue(input);
  const selected = resolvedMessages(messages,prompt);
  if (!selected.length) return '';
  const assistantReferent = selected.some(m => m.role === 'assistant');
  // Pure status/continuation phrases add no capability-bearing constraint.
  // Do not let "better now" displace the resolved task in embedding/BM25.
  // The original prompt remains untouched at the invocation/authorization boundary.
  const operation = /(?:测试|验证|部署|安装|修好|修改|修复|改好|运行|删除|提交|上传|不要|不用|不需要)|\b(?:test|verify|deploy|install|fix|change|delete|commit|push|without|avoid)\b/i.test(prompt);
  return [...selected.map(m => m.content), ...(!isFollowup(prompt) || assistantReferent || operation ? [prompt] : [])].join('\n');
}
