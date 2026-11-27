import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generate } from './ai';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject, type Provider, type Skill } from './domain';
import { buildPrompt } from './prompts';
import { createWritingSkillTools } from './writingSkillTools';
import { READY_TO_WRITE } from './toolGeneration';
import { HttpError, http } from './platform';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('./platform', async original => ({ ...await original<typeof import('./platform')>(), http: vi.fn() }));

type Protocol = Provider['protocol'];
type Json = Record<string, any>;
const protocols = ['chat', 'responses', 'anthropic', 'gemini'] as const;
const config = { ...newAISelection(), ...defaultAdvanced(), providerId: 'p', model: 'm' };
const system = '根据 Skill ID abc 写作', user = '起草第二章';
const provider = (protocol: Protocol, maxRetries = 0): Provider => ({ id: 'p', name: '测试', protocol, maxRetries, models: ['m'], hasKey: true, enabled: true, baseUrl: 'http://localhost', advanced: defaultAdvanced() });
const response = (text: string) => ({ status: 200, bytes: new Uint8Array(), text });
const json = (data: Json) => response(JSON.stringify(data));
const bodies = (): Json[] => vi.mocked(http).mock.calls.map(([r]) => JSON.parse(r.body!));
const signal = () => new AbortController().signal;
const search = { name: 'search_skill_files', args: { skill: 'abc', query: '转折' }, id: 'call-a' };
const read = { name: 'read_skill_file', args: { skill: 'abc', path: 'references/a.md', offset: 9 }, id: 'call-b' };
type NativeCall = { name: string; args: Record<string, unknown>; id: string };

function assistant(protocol: Protocol, calls: NativeCall[]) {
  switch (protocol) {
    case 'chat': return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '查阅资料', reasoning_content: '思考', reasoning_details: [{ data: 'opaque' }], tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] };
    case 'responses': return { output: [{ type: 'reasoning', id: 'rs', encrypted_content: 'opaque', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '查阅资料' }] }, ...calls.map(c => ({ type: 'function_call', id: `fc-${c.id}`, call_id: c.id, name: c.name, arguments: JSON.stringify(c.args), status: 'completed' }))] };
    case 'anthropic': return { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '思考', signature: 'signed' }, { type: 'redacted_thinking', data: 'opaque' }, { type: 'text', text: '查阅资料' }, ...calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] };
    case 'gemini': return { candidates: [{ content: { role: 'model', parts: [{ thought: true, text: '思考', thoughtSignature: 'opaque' }, { text: '查阅资料' }, ...calls.map((c, i) => ({ functionCall: c, ...(i === 0 ? { thoughtSignature: 'signed' } : {}) }))] } }] };
  }
}
function prose(protocol: Protocol, text: string) {
  switch (protocol) {
    case 'chat': return { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
    case 'responses': return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
    case 'anthropic': return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
    case 'gemini': return { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] };
  }
}
function events(protocol: Protocol) {
  const chunks = {
    chat: [{ choices: [{ delta: { content: '开头' } }] }, { choices: [{ delta: { content: '结尾' }, finish_reason: 'stop' }] }],
    responses: [{ type: 'response.output_text.delta', delta: '开头' }, { type: 'response.output_text.delta', delta: '结尾' }, { type: 'response.completed' }],
    anthropic: [{ type: 'content_block_delta', delta: { type: 'text_delta', text: '开头' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: '结尾' } }, { type: 'message_stop' }],
    gemini: [{ candidates: [{ content: { parts: [{ text: '开头' }] } }] }, prose('gemini', '结尾')],
  }[protocol];
  return chunks.map(data => `data: ${JSON.stringify(data)}\n\n`);
}
const history = (protocol: Protocol, body: Json): Json[] => body.messages ?? body[protocol === 'gemini' ? 'contents' : 'input'];

beforeEach(() => { vi.mocked(http).mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe.each(protocols)('%s 原生写作工具', protocol => {
  it('生成本协议声明；原样回送签名和并行调用，工具结果与正文互不混淆', async () => {
    const data = assistant(protocol, [search, read]);
    vi.mocked(http).mockResolvedValueOnce(json(data)).mockResolvedValueOnce(json(prose(protocol, READY_TO_WRITE))).mockImplementationOnce(async request => {
      const chunks = events(protocol);
      request.onChunk?.(chunks[0]); // The native invoke may return ahead of the remaining events.
      return response(chunks.join(''));
    });
    const onText = vi.fn(), onReasoning = vi.fn();
    const outputs = ['{"files":["references/a.md"]}', '{"content":"只作参考","nextOffset":20}'];
    const execute = vi.fn().mockReturnValueOnce(outputs[0]).mockReturnValueOnce(outputs[1]);
    expect(await generate(provider(protocol), config, system, user, signal(), onText, onReasoning, undefined, { execute })).toBe('开头结尾');
    const [first, follow, final] = bodies();
    const [request, , last] = vi.mocked(http).mock.calls.map(([r]) => r);
    expect(request.onChunk).toBeUndefined(); expect(last.onChunk).toBeTypeOf('function');
    expect(request.providerId).toBe('p'); expect(last.headers).toEqual(request.headers);
    const defs = protocol === 'gemini' ? first.tools[0].functionDeclarations : protocol === 'chat' ? first.tools.map((x: Json) => x.function) : first.tools;
    expect(defs.map((d: Json) => d.name)).toEqual(['activate_skill', search.name, read.name]);
    expect(defs.every((d: Json) => d.description.includes('首轮提示中的 Skill ID'))).toBe(true);
    expect((defs[2].parameters ?? defs[2].input_schema).required).toEqual(['skill', 'path']);
    expect(execute.mock.calls.map(([name, args]) => [name, args])).toEqual([[search.name, search.args], [read.name, read.args]]);
    expect(execute.mock.calls.every(([, , limit]) => limit >= 128 && limit <= 6000)).toBe(true);
    const h = history(protocol, follow), finalHistory = history(protocol, final);
    switch (protocol) {
      case 'chat':
        expect(h.slice(2)).toEqual([data.choices![0].message, ...[search, read].map((c, i) => ({ role: 'tool', tool_call_id: c.id, content: outputs[i] }))]);
        expect(final.tool_choice).toBe('none');
        break;
      case 'responses':
        expect(first.include).toContain('reasoning.encrypted_content');
        expect(h).toEqual([{ role: 'user', content: user }, ...data.output!, ...[search, read].map((c, i) => ({ type: 'function_call_output', call_id: c.id, output: outputs[i] }))]);
        expect(final.tool_choice).toBe('none');
        break;
      case 'anthropic':
        expect(h.slice(1)).toEqual([{ role: 'assistant', content: data.content }, { role: 'user', content: [search, read].map((c, i) => ({ type: 'tool_result', tool_use_id: c.id, content: outputs[i] })) }]);
        expect(final.tool_choice).toEqual({ type: 'none' });
        break;
      case 'gemini':
        expect(request.url).toMatch(/:generateContent$/); expect(last.url).toMatch(/:streamGenerateContent\?alt=sse$/);
        expect(h.slice(1)).toEqual([data.candidates![0].content, { role: 'user', parts: [search, read].map((c, i) => ({ functionResponse: { name: c.name, id: c.id, response: { output: outputs[i] } } })) }]);
        expect(final.toolConfig.functionCallingConfig.mode).toBe('NONE');
        break;
    }
    expect(finalHistory.slice(1)).toEqual(h.slice(1));
    expect(onText.mock.calls).toEqual([['开头'], ['开头结尾']]);
    expect(onReasoning.mock.calls).toEqual([['']]);
  });
  it('模型直接给出正文时既不执行工具也不请求第二次写作', async () => {
    vi.mocked(http).mockResolvedValueOnce(json(prose(protocol, '完整正文')));
    const execute = vi.fn(), onText = vi.fn();
    expect(await generate(provider(protocol), config, system, user, signal(), onText, undefined, undefined, { execute })).toBe('完整正文');
    expect(onText.mock.calls).toEqual([['完整正文']]); expect(execute).not.toHaveBeenCalled(); expect(http).toHaveBeenCalledTimes(1);
  });
  it('未传入工具时沿用一次流式请求', async () => {
    vi.mocked(http).mockResolvedValueOnce(response(events(protocol).join('')));
    expect(await generate(provider(protocol), config, system, user, signal(), vi.fn())).toBe('开头结尾');
    expect(bodies()[0]).not.toHaveProperty('tools'); expect(vi.mocked(http).mock.calls[0][0].onChunk).toBeTypeOf('function');
  });
});

describe('Skill 逐步加载', () => {
  it('细纲的 Chat Completions 首包无 Skill 正文，两份入口仅通过匹配的工具回复传回', async () => {
    const state = emptyWorkspace(), project = newProject('试写', 'long');
    const skill = (id: string, content: string): Skill => ({ ...state.skills[0], id, name: id, description: id + ' 简介', tasks: ['plan'], files: [{ path: 'SKILL.md', content }] });
    const selected = skill('style', '作者选用的入口正文'), automatic = skill('natural', '自动候选的入口正文');
    state.skills = [selected, automatic]; state.projects.push(project); project.skillIds = [selected.id];
    const job = createJob(project, 'plan', config, project.chapters[0].id, '情节搞笑');
    const prompt = buildPrompt(state, job, job.steps[0], config), onRead = vi.fn();
    const activate = (id: string) => ({ id: `call-${id}`, name: 'activate_skill', args: { skill: id } });
    vi.mocked(http).mockResolvedValueOnce(json(assistant('chat', [activate(selected.id)])))
      .mockResolvedValueOnce(json(assistant('chat', [activate(automatic.id)])))
      .mockResolvedValueOnce(json(prose('chat', READY_TO_WRITE)))
      .mockResolvedValueOnce(response(events('chat').join('')));
    expect(await generate(provider('chat'), config, prompt.system, prompt.user, signal(), vi.fn(), undefined, undefined,
      createWritingSkillTools(prompt.toolSkills, onRead, [selected.id]))).toBe('开头结尾');
    const [first, second, third, final] = bodies();
    expect(first.tool_choice).toBe('auto');
    expect(first.messages[0].content).toContain('本轮先调用 activate_skill');
    expect(first.messages.map((message: Json) => message.role)).toEqual(['system', 'user']);
    expect(second.tool_choice).toBe('auto');
    for (const item of [selected, automatic]) {
      expect(first.messages[0].content).toContain(item.description);
      expect(JSON.stringify(first)).not.toContain(item.files[0].content);
      expect(final.messages[0].content).not.toContain(item.files[0].content);
      const call = third.messages.find((message: Json) => message.tool_call_id === `call-${item.id}`);
      expect(call.role).toBe('tool'); expect(JSON.parse(call.content)).toEqual({ ...item.files[0], nextOffset: null });
    }
    expect(onRead.mock.calls.map(([id]) => id)).toEqual([selected.id, automatic.id]);
    expect(final.tool_choice).toBe('none');
  });

  it.each(['chat', 'responses'] as const)('%s 自动工具选择仍阻止未激活就生成，不回退到全文注入', async protocol => {
    vi.mocked(http).mockResolvedValueOnce(json(prose(protocol, '未激活就写的正文')));
    const onText = vi.fn(), execute = vi.fn();
    await expect(generate(provider(protocol), config, system, user, signal(), onText, undefined, undefined,
      { execute, pendingRequired: () => ['作者选用的文风'] })).rejects.toThrow('未完成 Skill 激活');
    expect(bodies()[0].tool_choice).toBe('auto');
    expect(http).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled();
  });

  it.each(['chat', 'responses'] as const)('%s 经由自动工具选择读完分页入口后交付正文', async protocol => {
    const selected: Skill = { ...emptyWorkspace().skills[0], id: 'abc', files: [{ path: 'SKILL.md', content: '规则'.repeat(4000) }] };
    const tools = createWritingSkillTools([selected], vi.fn(), [selected.id]);
    const call = (offset?: number) => ({ id: `call-${offset ?? 0}`, name: 'activate_skill', args: { skill: selected.id, ...(offset === undefined ? {} : { offset }) } });
    vi.mocked(http).mockImplementation(async request => {
      const body = JSON.parse(request.body!), turns = history(protocol, body);
      expect(body.tool_choice).toBe('auto');
      const result = [...turns].reverse().find(item => item.role === 'tool' || item.type === 'function_call_output');
      const page = result ? JSON.parse(result.content ?? result.output) : undefined;
      return json(page?.nextOffset === null ? prose(protocol, '完整正文') : assistant(protocol, [call(page?.nextOffset)]));
    });
    const onText = vi.fn();
    expect(await generate(provider(protocol), config, system, user, signal(), onText, undefined, undefined, tools)).toBe('完整正文');
    expect(tools.pendingRequired?.()).toEqual([]);
    expect(http).toHaveBeenCalledTimes(3);
    expect(onText.mock.calls).toEqual([['完整正文']]);
  });
});

describe('工具循环边界', () => {
  it('经由 Tauri http_request 区分资料请求和正文流，沿用凭据与请求头', async () => {
    const platform = await vi.importActual<typeof import('./platform')>('./platform');
    vi.mocked(http).mockImplementation(platform.http);
    const unlisten = vi.fn(); vi.mocked(listen).mockResolvedValueOnce(unlisten);
    vi.mocked(invoke).mockResolvedValueOnce(json(assistant('anthropic', [read]))).mockResolvedValueOnce(json(prose('anthropic', READY_TO_WRITE))).mockResolvedValueOnce(response(events('anthropic').join('')));
    const execute = vi.fn(() => '文件页');
    expect(await generate(provider('anthropic'), config, system, user, signal(), vi.fn(), undefined, undefined, { execute })).toBe('开头结尾');
    const requests = vi.mocked(invoke).mock.calls.map(([cmd, args]) => {
      expect(cmd).toBe('http_request');
      const req = (args as { request: Json }).request;
      expect(req).toMatchObject({ providerId: 'p', keyHeader: 'x-api-key', headers: { 'anthropic-version': '2023-06-01' } });
      return req;
    });
    expect(requests.map(req => req.stream)).toEqual([false, false, true]);
    expect(requests.map(req => JSON.parse(req.body).stream)).toEqual([false, false, true]);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
  it('原始提示本身超限时不读取也不发送请求', async () => {
    const execute = vi.fn();
    await expect(generate(provider('chat'), { ...config, contextChars: 4000 }, system, 'x'.repeat(4000), signal(), vi.fn(), undefined, undefined, { execute })).rejects.toThrow('上下文上限');
    expect(http).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('可按 nextOffset 继续读取，失败只重试当前请求而不重复读取文件', async () => {
    vi.useFakeTimers();
    const next = { ...read, id: 'page2', args: { ...read.args, offset: 999 } };
    vi.mocked(http).mockResolvedValueOnce(json(assistant('responses', [read]))).mockRejectedValueOnce(new HttpError(503, '繁忙')).mockResolvedValueOnce(json(assistant('responses', [next]))).mockResolvedValueOnce(json(prose('responses', '交付正文')));
    const execute = vi.fn().mockReturnValueOnce('{"content":"第一页","nextOffset":999}').mockReturnValueOnce('{"content":"第二页"}');
    const task = generate(provider('responses', 1), config, system, user, signal(), vi.fn(), undefined, undefined, { execute });
    await vi.runAllTimersAsync(); expect(await task).toBe('交付正文');
    expect(execute.mock.calls.map(([, args]) => args.offset)).toEqual([9, 999]);
    const requests = bodies(); expect(requests[2]).toEqual(requests[1]); expect(JSON.stringify(requests[2])).toContain('nextOffset');
  });
  it.each(['无空间', '并行过多'] as const)('%s 时整批都不读取，改为直接生成', async reason => {
    const calls = reason === '无空间' ? [read, { ...search, args: { ...search.args, query: 'x'.repeat(6000) } }] : Array.from({ length: 30 }, (_, i) => ({ ...read, id: `c${i}` }));
    vi.mocked(http).mockResolvedValueOnce(json(assistant('chat', calls))).mockResolvedValueOnce(json(prose('chat', '正文')));
    const execute = vi.fn();
    expect(await generate(provider('chat'), { ...config, contextChars: 4000 }, system, user, signal(), vi.fn(), undefined, undefined, { execute })).toBe('正文');
    expect(execute).not.toHaveBeenCalled(); expect(bodies()[1].messages).toEqual([{ role: 'system', content: system }, { role: 'user', content: user }]);
  });
  it('首轮连工具声明也放不下时不发超额探测请求', async () => {
    vi.mocked(http).mockResolvedValueOnce(json(prose('chat', '正文')));
    const execute = vi.fn();
    expect(await generate(provider('chat'), { ...config, contextChars: 4000 }, system, 'x'.repeat(3400), signal(), vi.fn(), undefined, undefined, { execute })).toBe('正文');
    expect(http).toHaveBeenCalledTimes(1); expect(bodies()[0]).not.toHaveProperty('tools'); expect(execute).not.toHaveBeenCalled();
  });
  it('保留正文空间，即使工具返回最坏的 JSON 转义或超长结果也不超额', async () => {
    const execute = vi.fn(() => '\u0000'.repeat(10000));
    vi.mocked(http).mockImplementation(async req => req.onChunk ? json(prose('chat', '正文')) : json(assistant('chat', [read])));
    expect(await generate(provider('chat'), { ...config, contextChars: 6000 }, system, user, signal(), vi.fn(), undefined, undefined, { execute })).toBe('正文');
    expect(execute).toHaveBeenCalledTimes(1);
    const requests = bodies(); expect(requests.every(body => JSON.stringify(body).length < 6000 - 700)).toBe(true);
    expect(requests.slice(-1)[0].messages.at(-1).content.length).toBeGreaterThan(128);
  });
  it('模型重复调用时次数有限，并在最后一次流式写作时禁用工具', async () => {
    const execute = vi.fn(() => '资源');
    vi.mocked(http).mockImplementation(async req => req.onChunk ? json(prose('chat', '正文')) : json(assistant('chat', [read])));
    expect(await generate(provider('chat'), config, system, user, signal(), vi.fn(), undefined, undefined, { execute })).toBe('正文');
    expect(execute).toHaveBeenCalledTimes(5); expect(http).toHaveBeenCalledTimes(6); expect(bodies().slice(-1)[0].tool_choice).toBe('none');
  });
  it('不执行未声明的工具或损坏的参数，只回送匹配调用标识的错误', async () => {
    const data = assistant('chat', [{ ...search, name: 'other' }, read]);
    data.choices![0].message.tool_calls[1].function.arguments = '{';
    vi.mocked(http).mockResolvedValueOnce(json(data)).mockResolvedValueOnce(json(prose('chat', '正文')));
    const execute = vi.fn();
    await generate(provider('chat'), config, system, user, signal(), vi.fn(), undefined, undefined, { execute });
    expect(execute).not.toHaveBeenCalled();
    expect(bodies()[1].messages.slice(-2)).toEqual([{ role: 'tool', tool_call_id: search.id, content: '未知的 Skill 工具' }, { role: 'tool', tool_call_id: read.id, content: '工具参数须为有效的 JSON 对象' }]);
  });
  it('达到输出上限的工具调用不执行、不重试、也不发布工具前言', async () => {
    const data = { ...assistant('anthropic', [read]), stop_reason: 'max_tokens' };
    const execute = vi.fn(), onText = vi.fn(); vi.mocked(http).mockResolvedValue(json(data));
    await expect(generate(provider('anthropic', 2), config, system, user, signal(), onText, undefined, undefined, { execute })).rejects.toThrow('输出上限');
    expect(execute).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled(); expect(http).toHaveBeenCalledTimes(1);
  });
  it.each(['timeout', 'abort'] as const)('挂起的资料回合可 %s，迟到结果不会执行', async reason => {
    vi.useFakeTimers();
    let finish!: (r: ReturnType<typeof response>) => void;
    vi.mocked(http).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController(), execute = vi.fn(), onText = vi.fn();
    const task = generate(provider('chat', 2), config, system, user, controller.signal, onText, undefined, 1000, { execute });
    const failed = reason === 'timeout' ? expect(task).rejects.toThrow('模型长时间未返回新内容') : expect(task).rejects.toMatchObject({ name: 'AbortError' });
    const req = vi.mocked(http).mock.calls[0][0];
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(1000); else controller.abort();
    await failed; expect(req.signal?.aborted).toBe(true);
    finish(json(assistant('chat', [read]))); await vi.runAllTimersAsync();
    expect(execute).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled(); expect(http).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
