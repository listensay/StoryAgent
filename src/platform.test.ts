import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpError, validateProxySettings } from './platform';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });

describe('桌面 HTTP 错误', () => {
  it.each(['', '   \n', '{}', 'null', '{"error":{"message":" "}}', '<html><head><style>body{color:red}</style></head><body><script>secret()</script></body></html>'])('为空的 502 响应补充错误说明：%s', async text => {
    vi.mocked(invoke).mockResolvedValue({ status: 502, text, bytes: [] });
    const error = await http({ url: 'http://localhost:3425/v1/models' }).catch(error => error);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(502);
    expect(error.message).toBe('HTTP 502：服务暂时不可用，请稍后重试');
  });
  it.each([
    [401, '{"error":{"message":"密钥无效"}}', '密钥无效'],
    [400, '{"error":"模型不可用"}', '模型不可用'],
    [503, '<html><body>网关暂不可用</body></html>', '网关暂不可用'],
    [504, '', '服务响应超时，请稍后重试'],
    [429, '', '请求过于频繁，请稍后重试'],
  ])('保留 HTTP %s 的有效错误或对应提示', async (status, text, message) => {
    vi.mocked(invoke).mockResolvedValue({ status, text, bytes: [] });
    await expect(http({ url: 'https://api.example.com/v1/models' })).rejects.toThrow(`HTTP ${status}：${message}`);
  });
  it('无效代理在原生调用前给出简短错误', async () => {
    await expect(validateProxySettings({ mode: 'manual', url: '' })).rejects.toThrow('请输入代理地址');
    expect(invoke).not.toHaveBeenCalled();
  });
});
