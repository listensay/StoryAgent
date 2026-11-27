import { PermanentAIError } from './aiRetry';
import type { Provider } from './domain';

export type WritingTools = {
  execute: (name: string, args: unknown, maxChars: number) => string;
  pendingRequired?: () => string[];
};
type Protocol = Provider['protocol'];
type Json = Record<string, any>; // Native assistant items are opaque except for the function-call envelope.
export type ModelRequest = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
type Call = { name: string; id?: string; args: unknown };
export type ToolTurn = { assistant: Json[]; calls: Call[] };

export const READY_TO_WRITE = '<ready_to_write/>';
const preparation = `\nSkill 调用回合：先调用 activate_skill 读取作者选用的每个 Skill；自动候选只在适用时激活。有 nextOffset 时继续读取直到返回 null；配套资料按需搜索或读取。资料足够时只回复 ${READY_TO_WRITE}，随后开始流式生成。若直接交付结果，不要附加标记。`;
const activation = '\n作者选用的 Skill 尚未读完。本轮先调用 activate_skill，继续读取选用的入口，不得开始写作或回复完成标记。';
const MAX_ROUNDS = 5, MAX_ACTIVATION_ROUNDS = 24, MAX_BATCH = 6, MAX_RESULT_CHARS = 6000;

function declarations(protocol: Protocol) {
  const kind = (type: string) => protocol === 'gemini' ? type.toUpperCase() : type;
  const skill = { type: kind('string'), description: '首轮提示中的 Skill ID' };
  const offset = { type: kind('integer'), description: '首读省略；后续使用上次返回的 nextOffset' };
  const definitions = [
    { name: 'activate_skill', description: '读取 SKILL.md，返回 nextOffset 时继续读到 null；skill 使用首轮提示中的 Skill ID。', properties: { skill, offset }, required: ['skill'] },
    { name: 'search_skill_files', description: '在已激活的 Skill 中按关键词搜索资料；skill 使用首轮提示中的 Skill ID。', properties: { skill, query: { type: kind('string') } }, required: ['skill', 'query'] },
    { name: 'read_skill_file', description: '读取已激活 Skill 的资料文件；skill 使用首轮提示中的 Skill ID。若结果含 nextOffset，可将其作为 offset 继续读取。', properties: { skill, path: { type: kind('string') }, offset }, required: ['skill', 'path'] },
  ].map(({ name, description, properties, required }) => ({ name, description, parameters: { type: kind('object'), properties, required } }));
  switch (protocol) {
    case 'chat': return definitions.map(fn => ({ type: 'function', function: fn }));
    case 'responses': return definitions.map(fn => ({ type: 'function', ...fn, strict: false })); // offset is optional.
    case 'anthropic': return definitions.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters }));
    case 'gemini': return [{ functionDeclarations: definitions }];
  }
}

// Non-streaming tool turns keep signed thinking, provider-specific reasoning fields and
// Responses output items intact. Never rebuild an assistant turn from just its calls.
export function readToolTurn(protocol: Protocol, data: Json): ToolTurn | undefined {
  let assistant: Json[], calls: Call[];
  switch (protocol) {
    case 'chat': {
      const message = data.choices?.[0]?.message;
      assistant = [message];
      calls = (message?.tool_calls ?? []).map((c: Json) => ({ name: c.function?.name, id: c.id, args: c.function?.arguments }));
      break;
    }
    case 'responses':
      assistant = data.output ?? [];
      calls = assistant.filter(item => item.type === 'function_call').map(item => ({ name: item.name, id: item.call_id, args: item.arguments }));
      break;
    case 'anthropic': {
      const content: Json[] = data.content ?? [];
      assistant = [{ role: 'assistant', content }];
      calls = content.filter(block => block.type === 'tool_use').map(block => ({ name: block.name, id: block.id, args: block.input }));
      break;
    }
    case 'gemini': {
      const content = data.candidates?.[0]?.content;
      assistant = [{ role: 'model', ...content }];
      calls = (content?.parts ?? []).filter((part: Json) => part.functionCall).map(({ functionCall: c }: Json) => ({ name: c.name, id: c.id, args: c.args }));
      break;
    }
  }
  if (!calls.length) return;
  const ids = calls.flatMap(c => c.id === undefined ? [] : [c.id]);
  if (calls.some(c => typeof c.name !== 'string' || !c.name) || (protocol !== 'gemini' && ids.length !== calls.length) || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new PermanentAIError('模型返回的工具调用名称或标识无效');
  return { assistant, calls };
}

function resultItems(protocol: Protocol, calls: Call[], outputs: string[]): Json[] {
  switch (protocol) {
    case 'chat': return calls.map((c, i) => ({ role: 'tool', tool_call_id: c.id, content: outputs[i] }));
    case 'responses': return calls.map((c, i) => ({ type: 'function_call_output', call_id: c.id, output: outputs[i] }));
    case 'anthropic': return [{ role: 'user', content: calls.map((c, i) => ({ type: 'tool_result', tool_use_id: c.id, content: outputs[i] })) }];
    case 'gemini': return [{ role: 'user', parts: calls.map((c, i) => ({ functionResponse: { name: c.name, id: c.id, response: { output: outputs[i] } } })) }];
  }
}

function execute(tools: WritingTools, protocol: Protocol, call: Call, maxChars: number): string {
  if (call.name !== 'activate_skill' && call.name !== 'search_skill_files' && call.name !== 'read_skill_file') return '未知的 Skill 工具';
  let args = call.args;
  if (protocol === 'chat' || protocol === 'responses') {
    try { args = JSON.parse(String(args)); } catch { return '工具参数须为有效的 JSON 对象'; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '工具参数须为对象';
  try { return tools.execute(call.name, args, maxChars).slice(0, maxChars); }
  catch { return 'Skill 工具执行失败'; } // Other results in the admitted batch still need to be sent.
}

export class ToolConversation {
  private history: Json[] = [];
  private rounds = 0;
  private activationRounds = 0;
  private readonly inputLimit: number;
  constructor(private protocol: Protocol, private base: ModelRequest, contextChars: number) {
    this.inputLimit = contextChars - Math.min(4096, Math.floor(contextChars * .12)); // Keep room for the manuscript.
  }
  private request(decide: boolean, history = this.history, activationRequired = false): ModelRequest {
    const { protocol, base } = this;
    if (!decide && !history.length) return base;
    const body: Json = { ...base.body, tools: declarations(protocol) };
    const mode = decide ? 'auto' : 'none';
    let url = base.url;
    if (protocol !== 'gemini') body.stream = !decide;
    if (decide && (protocol === 'chat' || protocol === 'responses')) delete body.stream_options;
    switch (protocol) {
      case 'chat': {
        const [system, ...user] = body.messages;
        body.messages = [decide ? { ...system, content: system.content + preparation + (activationRequired ? activation : '') } : system, ...user, ...history];
        // Some Responses-backed gateways cannot complete a forced function call.
        // Activation is required by the prompt and verified before accepting prose.
        body.tool_choice = mode;
        if ('n' in body) body.n = 1; // A single conversation cannot replay alternatives.
        break;
      }
      case 'responses':
        body.input = [{ role: 'user', content: body.input }, ...history];
        if (decide) {
          body.instructions += preparation + (activationRequired ? activation : '');
          body.include = [...new Set([...(body.include ?? []), 'reasoning.encrypted_content'])];
        }
        body.tool_choice = mode;
        break;
      case 'anthropic':
        body.messages = [...body.messages, ...history];
        if (decide) body.system += preparation;
        body.tool_choice = { type: mode };
        break;
      case 'gemini':
        body.contents = [...body.contents, ...history];
        if ('candidateCount' in body.generationConfig) body.generationConfig = { ...body.generationConfig, candidateCount: 1 };
        if (decide) {
          url = url.replace(/:streamGenerateContent\?alt=sse$/, ':generateContent');
          body.systemInstruction = { parts: [...body.systemInstruction.parts, { text: preparation }] };
        }
        body.toolConfig = { ...body.toolConfig, functionCallingConfig: activationRequired ? { mode: 'ANY', allowedFunctionNames: ['activate_skill'] } : { mode: mode.toUpperCase() } };
        break;
    }
    return { ...base, url, body };
  }
  decisionRequest(activationRequired = false) {
    if (activationRequired ? this.activationRounds >= MAX_ACTIVATION_ROUNDS : this.rounds >= MAX_ROUNDS) return;
    const request = this.request(true, this.history, activationRequired);
    if (JSON.stringify(request.body).length <= this.inputLimit) return request;
  }
  finalRequest() { return this.request(false); }

  // Admit a whole batch atomically: all native calls require matching results. Reserve
  // up to six JSON characters per result code unit (e.g. \u0000), so even escaped
  // results will fit the *next* request, without reading then dropping a file.
  accept(turn: ToolTurn, tools: WritingTools): boolean {
    const { calls } = turn;
    if (calls.length > MAX_BATCH) return false;
    const history = [...this.history, ...turn.assistant];
    const empty = resultItems(this.protocol, calls, calls.map(() => ''));
    const cost = JSON.stringify(this.request(false, [...history, ...empty]).body).length;
    const maxChars = Math.min(MAX_RESULT_CHARS, Math.floor((this.inputLimit - cost) / (6 * calls.length)));
    if (maxChars < 128) return false;
    const activating = Boolean(tools.pendingRequired?.().length);
    const outputs = calls.map(call => execute(tools, this.protocol, call, maxChars));
    this.history = [...history, ...resultItems(this.protocol, calls, outputs)];
    if (activating) this.activationRounds++;
    else this.rounds++;
    return true;
  }
}
