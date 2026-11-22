import { describe, expect, it } from 'vitest';
import { emptyWorkspace, parseWorkspace } from './domain';
import { proxySettingsSchema } from './proxy';

describe('代理设置与工作区兼容', () => {
  it('旧工作区与旧备份默认自动检测代理', () => {
    const { proxy: _, ...previous } = emptyWorkspace();
    expect(parseWorkspace(JSON.stringify(previous)).proxy).toEqual({ mode: 'system', url: '' });
    expect(parseWorkspace(JSON.stringify({ ...previous, schemaVersion: 1, profiles: [] })).proxy).toEqual({ mode: 'system', url: '' });
  });
  it('保存与恢复代理模式和手动地址', () => {
    const state = emptyWorkspace();
    state.proxy = proxySettingsSchema.parse({ mode: 'manual', url: ' 127.0.0.1:7890 ' });
    expect(parseWorkspace(JSON.stringify(state)).proxy).toEqual({ mode: 'manual', url: 'http://127.0.0.1:7890' });
    state.proxy.mode = 'direct';
    expect(parseWorkspace(JSON.stringify(state)).proxy).toEqual({ mode: 'direct', url: 'http://127.0.0.1:7890' });
  });
  it('支持 HTTP、HTTPS 和 SOCKS，拒绝无效地址和明文凭据', () => {
    for (const url of ['http://proxy.example.com', 'https://proxy.example.com:8443', 'socks5://127.0.0.1:1080', 'socks5h://[::1]:1080']) {
      expect(proxySettingsSchema.safeParse({ mode: 'manual', url }).success).toBe(true);
    }
    for (const url of ['', 'file:///tmp/proxy', 'http://proxy.example.com:0', 'http://proxy.example.com/path', 'http://proxy.example.com/?password=secret', 'http://user:secret@proxy.example.com:7890']) {
      expect(proxySettingsSchema.safeParse({ mode: 'manual', url }).success).toBe(false);
    }
  });
});
