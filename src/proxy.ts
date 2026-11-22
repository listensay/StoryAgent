import { z } from 'zod';

const addressError = (address: string): string | undefined => {
  try {
    const url = new URL(address.includes('://') ? address : `http://${address}`);
    if (!['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname || url.port === '0' || (!url.port && url.protocol.startsWith('socks')) || !['', '/'].includes(url.pathname) || url.search || url.hash) return '代理地址无效';
    if (url.username || url.password) return '代理地址不能包含用户名或密码';
  } catch { return '代理地址无效'; }
};

export const defaultProxySettings = () => ({ mode: 'system' as const, url: '' });
export const proxySettingsSchema = z.object({ mode: z.enum(['system', 'manual', 'direct']).default('system'), url: z.string().trim().max(2048, '代理地址过长').default('') }).superRefine((settings, ctx) => {
  const message = settings.url ? addressError(settings.url) : settings.mode === 'manual' ? '请输入代理地址' : undefined;
  if (message) ctx.addIssue({ code: 'custom', path: ['url'], message });
}).transform(settings => ({ ...settings, url: settings.url ? new URL(settings.url.includes('://') ? settings.url : `http://${settings.url}`).href.replace(/\/$/, '') : '' }));

export type ProxySettings = z.infer<typeof proxySettingsSchema>;
export type ProxyDetection = { http: string | null; https: string | null };
