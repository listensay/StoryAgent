import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBase, getModels } from './ai';
import { type Provider, defaultAdvanced } from './domain';
vi.mock('./platform', async importOriginal => ({ ...await importOriginal<typeof import('./platform')>(), http: vi.fn() }));
import { http } from './platform';

const provider = (protocol: Provider['protocol'] = 'chat'): Provider => ({ id: 'service', name: '测试服务', protocol, baseUrl: 'https://api.example.com', hasKey: true, models: [], enabled: true, maxRetries: 10, advanced: defaultAdvanced() });
const response = (value: unknown) => ({ status: 200, bytes: new Uint8Array(), text: JSON.stringify(value) });
beforeEach(() => vi.mocked(http).mockReset());

describe('根据 API 地址获取模型', () => {
  it('支持服务根地址、完整请求地址和自定义路径', () => {
    expect(apiBase(provider())).toBe('https://api.example.com/v1');
    expect(apiBase(provider('gemini'))).toBe('https://api.example.com/v1beta');
    for (const endpoint of ['chat/completions', 'responses', 'messages', 'models']) {
      expect(apiBase({ ...provider(), baseUrl: `https://api.example.com/custom/v1/${endpoint}/` })).toBe('https://api.example.com/custom/v1');
    }
    expect(apiBase({ ...provider('gemini'), baseUrl: 'https://api.example.com/v1beta/models/gemini:streamGenerateContent?alt=sse' })).toBe('https://api.example.com/v1beta');
    expect(() => apiBase({ ...provider(), baseUrl: 'file:///tmp/models' })).toThrow('有效');
  });
  it.each(['chat', 'responses', 'anthropic', 'gemini'] as const)('使用未保存的 %s 配置和密钥获取模型', async protocol => {
    vi.mocked(http).mockResolvedValue(response(protocol === 'gemini' ? { models: [{ name: 'models/test' }] } : { data: [{ id: 'test' }] }));
    expect(await getModels(provider(protocol), undefined, 'draft-key')).toEqual(['test']);
    const request = vi.mocked(http).mock.calls[0][0];
    expect(request.providerId).toBeUndefined();
    expect(request.url).toBe(`https://api.example.com/${protocol === 'gemini' ? 'v1beta' : 'v1'}/models`);
    expect(request.headers).toHaveProperty(protocol === 'anthropic' ? 'x-api-key' : protocol === 'gemini' ? 'x-goog-api-key' : 'Authorization', ['chat', 'responses'].includes(protocol) ? 'Bearer draft-key' : 'draft-key');
    if (protocol === 'anthropic') expect(request.headers).toHaveProperty('anthropic-version', '2023-06-01');
  });
  it('复用已保存的密钥，清除密钥时不会继续读取旧密钥', async () => {
    vi.mocked(http).mockResolvedValue(response({ data: [{ id: 'test' }] }));
    await getModels(provider());
    expect(vi.mocked(http).mock.calls[0][0].providerId).toBe('service');
    await getModels(provider(), undefined, '');
    expect(vi.mocked(http).mock.calls[1][0].providerId).toBeUndefined();
    expect(vi.mocked(http).mock.calls[1][0].headers).not.toHaveProperty('Authorization');
  });
  it('收集分页模型并去重', async () => {
    vi.mocked(http).mockResolvedValueOnce(response({ data: [{ id: 'b' }, { id: 'a' }], has_more: true, last_id: 'next' })).mockResolvedValueOnce(response({ data: [{ id: 'a' }, null, { id: ' ' }, { id: 'c' }] }));
    expect(await getModels(provider('anthropic'))).toEqual(['a', 'b', 'c']);
    expect(vi.mocked(http).mock.calls[1][0].url).toContain('?after_id=next');
  });
  it('接口错误、无效数据和异常分页不能作为成功结果', async () => {
    for (const value of [null, { error: { message: '密钥无效' } }, { data: [] }, { data: [{ id: 'a' }], has_more: true }]) {
      vi.mocked(http).mockResolvedValue(response(value));
      await expect(getModels(provider())).rejects.toThrow();
    }
    vi.mocked(http).mockResolvedValue(response({ data: [{ id: 'a' }], has_more: true, last_id: 'same' }));
    await expect(getModels(provider())).rejects.toThrow('分页异常');
  });
  it('编辑地址或关闭表单后的响应被丢弃', async () => {
    const controller = new AbortController();
    vi.mocked(http).mockImplementationOnce(async () => { controller.abort(); return response({ data: [{ id: 'stale' }] }); });
    await expect(getModels(provider(), controller.signal)).rejects.toThrow();
  });
});
