import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generate, getModels } from './ai';
import { DEFAULT_AI_RETRIES, MAX_AI_RETRIES, defaultAdvanced, emptyWorkspace, newAISelection, parseWorkspace, validateProvider, type Provider } from './domain';
vi.mock('./platform', async importOriginal => ({ ...await importOriginal<typeof import('./platform')>(), http: vi.fn() }));
import { HttpError, http } from './platform';

const provider = (maxRetries = DEFAULT_AI_RETRIES): Provider => ({ id: 'retry', name: '重试测试', protocol: 'chat', baseUrl: 'http://localhost/v1', hasKey: false, models: ['test'], enabled: true, maxRetries, advanced: defaultAdvanced() });
const config = { ...newAISelection(), ...defaultAdvanced(), providerId: 'retry', model: 'test' };
const response = (text = '') => ({ status: 200, bytes: new Uint8Array(), text });
const result = (text: string) => response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
const event = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const run = (p = provider(), controller = new AbortController(), onText = vi.fn()) => generate(p, config, 'system', 'user', controller.signal, onText);

beforeEach(() => { vi.useFakeTimers(); vi.mocked(http).mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('AI 失败重试配置', () => {
  it.each([1, 2])('为版本 %s 的旧供应商补充默认 10 次', schemaVersion => {
    const state = { ...emptyWorkspace(), schemaVersion, profiles: [], providers: [{ ...provider(), maxRetries: undefined }] };
    expect(parseWorkspace(JSON.stringify(state)).providers[0].maxRetries).toBe(10);
  });
  it.each([0, 3, MAX_AI_RETRIES])('保存并恢复 %s 次重试', maxRetries => {
    const state = { ...emptyWorkspace(), providers: [provider(maxRetries)] };
    expect(parseWorkspace(JSON.stringify(state)).providers[0].maxRetries).toBe(maxRetries);
    expect(() => validateProvider(provider(maxRetries))).not.toThrow();
  });
  it.each([-1, 1.5, MAX_AI_RETRIES + 1, NaN])('拒绝无效次数 %s', maxRetries => {
    expect(() => validateProvider(provider(maxRetries))).toThrow('失败重试次数');
    expect(() => parseWorkspace(JSON.stringify({ ...emptyWorkspace(), providers: [provider(maxRetries)] }))).toThrow();
  });
});

describe('AI 请求恢复', () => {
  it('默认在首次请求失败后重试 10 次并保留最后错误', async () => {
    const failure = new Error('连接失败');
    vi.mocked(http).mockRejectedValue(failure);
    const finished = expect(run()).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await finished;
    expect(http).toHaveBeenCalledTimes(11);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, 1, 3])('遵守 %s 次重试上限', async maxRetries => {
    vi.mocked(http).mockRejectedValue('连接已关闭');
    const finished = expect(run(provider(maxRetries))).rejects.toBe('连接已关闭');
    await vi.runAllTimersAsync();
    await finished;
    expect(http).toHaveBeenCalledTimes(maxRetries + 1);
  });
  it.each([408, 409, 429, 500, 502, 503, 504, 529])('HTTP %s 后恢复且请求参数保持一致', async status => {
    vi.mocked(http).mockRejectedValueOnce(new HttpError(status, '暂时不可用')).mockResolvedValueOnce(result('恢复正文'));
    const finished = run();
    await vi.runAllTimersAsync();
    expect(await finished).toBe('恢复正文');
    expect(http).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(http).mock.calls.map(([request]) => request);
    expect(second).toMatchObject({ url: first.url, headers: first.headers, body: first.body, providerId: first.providerId, signal: first.signal });
  });
  it.each([400, 401, 403, 404, 413, 422])('HTTP %s 立即失败', async status => {
    vi.mocked(http).mockRejectedValue(new HttpError(status, '配置错误'));
    await expect(run()).rejects.toThrow('配置错误');
    expect(http).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('拒绝钥匙串访问后不会自动重试并反复弹出授权', async () => {
    vi.mocked(http).mockRejectedValue('读取密钥失败：用户拒绝访问');
    await expect(run()).rejects.toBe('读取密钥失败：用户拒绝访问');
    expect(http).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('重试逐渐延后，等待时间不超过 10 秒', async () => {
    const times: number[] = [];
    vi.mocked(http).mockImplementation(async () => { times.push(Date.now()); throw new Error('失败'); });
    const finished = expect(run(provider(5))).rejects.toThrow('失败');
    await vi.runAllTimersAsync();
    await finished;
    expect(times.slice(1).map((time, i) => time - times[i])).toEqual([1000, 2000, 4000, 8000, 10000]);
  });
  it('分页模型请求仅重试失败的页面', async () => {
    vi.mocked(http).mockResolvedValueOnce(response('{"data":[{"id":"a"}],"has_more":true,"last_id":"next"}')).mockRejectedValueOnce(new HttpError(503, '过载')).mockResolvedValueOnce(response('{"data":[{"id":"b"}]}'));
    const finished = getModels({ ...provider(), protocol: 'anthropic' }, undefined, 'draft-key');
    await vi.runAllTimersAsync();
    expect(await finished).toEqual(['a', 'b']);
    expect(vi.mocked(http).mock.calls.map(([request]) => request.url)).toEqual(['http://localhost/v1/models', 'http://localhost/v1/models?after_id=next', 'http://localhost/v1/models?after_id=next']);
    expect(vi.mocked(http).mock.calls[2][0].headers).toHaveProperty('x-api-key', 'draft-key');
  });
  it('配置无效时不会发送请求', async () => {
    await expect(generate(provider(), { ...config, model: 'missing' }, '', '', new AbortController().signal, vi.fn())).rejects.toThrow('模型');
    expect(http).not.toHaveBeenCalled();
  });
});

describe('流式重试与停止', () => {
  it('连接中断后重新生成，用新正文替换旧片段并忽略迟到事件', async () => {
    const onText = vi.fn();
    let stale: ((text: string) => void) | undefined;
    vi.mocked(http).mockImplementationOnce(async request => { stale = request.onChunk; request.onChunk?.(event('旧片段')); return response(); }).mockImplementationOnce(async request => { stale?.(event('迟到片段')); request.onChunk?.(event('完整正文') + 'data: [DONE]\n\n'); return response(); });
    const finished = run(provider(), new AbortController(), onText);
    await vi.runAllTimersAsync();
    expect(await finished).toBe('完整正文');
    expect(onText.mock.calls.map(([text]) => text)).toEqual(['旧片段', '完整正文']);
  });
  it('后续重试无正文时保留此前片段，供任务继续生成', async () => {
    const onText = vi.fn();
    vi.mocked(http).mockImplementationOnce(async request => { request.onChunk?.(event('可恢复正文')); throw new Error('断线'); }).mockRejectedValue(new Error('服务暂时不可用'));
    const finished = expect(run(provider(2), new AbortController(), onText)).rejects.toThrow('服务暂时不可用');
    await vi.runAllTimersAsync();
    await finished;
    expect(http).toHaveBeenCalledTimes(3);
    expect(onText.mock.calls.map(([text]) => text)).toEqual(['可恢复正文']);
  });
  it('重试替换分析内容，迟到事件不混入新一轮分析或正文', async () => {
    const onText = vi.fn(), onReasoning = vi.fn();
    const analysis = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: text } }] })}\n\n`;
    let stale: ((text: string) => void) | undefined;
    vi.mocked(http).mockImplementationOnce(async request => { stale = request.onChunk; request.onChunk?.(analysis('旧的分析') + event('旧的正文')); throw new Error('断线'); }).mockImplementationOnce(async request => { stale?.(analysis('迟到分析')); request.onChunk?.(analysis('新的分析') + event('新的正文') + 'data: [DONE]\n\n'); return response(); });
    const finished = generate(provider(1), config, '', '', new AbortController().signal, onText, onReasoning);
    await vi.runAllTimersAsync();
    expect(await finished).toBe('新的正文');
    expect(onReasoning.mock.calls.map(([text]) => text)).toEqual(['旧的分析', '新的分析']);
    expect(onText.mock.calls.map(([text]) => text)).toEqual(['旧的正文', '新的正文']);
  });
  it('完整响应恢复尚未送达的末尾流事件，不误判断线或重试', async () => {
    const onText = vi.fn();
    vi.mocked(http).mockImplementationOnce(async request => {
      request.onChunk?.(event('开头'));
      return response(event('开头') + event('结尾') + 'data: [DONE]\n\n');
    });
    expect(await run(provider(), new AbortController(), onText)).toBe('开头结尾');
    expect(http).toHaveBeenCalledTimes(1);
    expect(onText.mock.calls.map(([text]) => text)).toEqual(['开头', '开头结尾']);
  });
  it('完整响应中的输出上限不会被未送达的流事件掩盖', async () => {
    vi.mocked(http).mockImplementationOnce(async request => {
      request.onChunk?.(event('片段'));
      return response(event('片段') + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n');
    });
    await expect(run()).rejects.toThrow('输出上限');
    expect(http).toHaveBeenCalledTimes(1);
  });
  it.each(['chat', 'responses', 'anthropic', 'gemini'] as const)('%s 流式错误事件也可重试', async protocol => {
    const errors = { chat: { error: { message: '服务繁忙', code: 'server_error' } }, responses: { type: 'response.failed', response: { error: { message: '服务繁忙', code: 'server_error' } } }, anthropic: { type: 'error', error: { type: 'overloaded_error', message: '服务繁忙' } }, gemini: { error: { code: 503, status: 'UNAVAILABLE', message: '服务繁忙' } } };
    vi.mocked(http).mockImplementationOnce(async request => { request.onChunk?.(`data: ${JSON.stringify(errors[protocol])}\n\n`); return response(); }).mockResolvedValueOnce(result('恢复正文'));
    const finished = run({ ...provider(), protocol });
    await vi.runAllTimersAsync();
    expect(await finished).toBe('恢复正文');
    expect(http).toHaveBeenCalledTimes(2);
  });
  it.each([
    { choices: [{ message: { content: '片段' }, finish_reason: 'length' }] },
    { choices: [{ message: { content: '' }, finish_reason: 'length' }] },
    { candidates: [{ finishReason: 'SAFETY' }] },
    { choices: [{ message: { refusal: '拒绝' }, finish_reason: 'stop' }] },
    { error: { code: 'invalid_api_key', message: '密钥无效' } },
    { error: { code: 400, status: 'INVALID_ARGUMENT', message: '参数错误' } },
  ])('输出上限、拒绝与配置错误不重试：%j', async payload => {
    vi.mocked(http).mockResolvedValue(response(JSON.stringify(payload)));
    await expect(run()).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('等待期间停止会移除计时器且不再请求', async () => {
    const controller = new AbortController();
    vi.mocked(http).mockRejectedValue(new Error('断线'));
    const finished = expect(run(provider(), controller)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await finished;
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('请求中停止会保留已生成内容且不重连', async () => {
    const controller = new AbortController(), onText = vi.fn();
    vi.mocked(http).mockImplementationOnce(async request => { request.onChunk?.(event('已有正文')); controller.abort(); request.onChunk?.(event('迟到')); throw new Error('请求已停止'); });
    await expect(run(provider(), controller, onText)).rejects.toMatchObject({ name: 'AbortError' });
    expect(onText.mock.calls.map(([text]) => text)).toEqual(['已有正文']);
    expect(http).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('已停止的任务不发送请求', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(run(provider(), controller)).rejects.toMatchObject({ name: 'AbortError' });
    expect(http).not.toHaveBeenCalled();
  });
});
