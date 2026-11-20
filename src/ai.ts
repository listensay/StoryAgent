import { type AIConfig, type Provider, validateAI } from './domain';
import { http } from './platform';
import { PermanentAIError, withAIRetry } from './aiRetry';

export function apiBase(provider: Provider) {
  let url: URL;
  try { url = new URL(provider.baseUrl.trim()); } catch { throw new Error('请填写有效的 API 地址'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请填写有效的 API 地址');
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|responses|messages|models(?:\/[^/]+:(?:streamGenerateContent|generateContent))?)$/, '');
  return url.origin + (path || (provider.protocol === 'gemini' ? '/v1beta' : '/v1'));
}
function auth(provider: Provider) {
  return provider.protocol === 'anthropic' ? { keyHeader: 'x-api-key', keyPrefix: '' } : provider.protocol === 'gemini' ? { keyHeader: 'x-goog-api-key', keyPrefix: '' } : { keyHeader: 'Authorization', keyPrefix: 'Bearer ' };
}
export async function getModels(provider: Provider, signal?: AbortSignal, apiKey?: string): Promise<string[]> {
  const base = apiBase(provider), authentication = auth(provider);
  const headers: Record<string, string> = provider.protocol === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {};
  if (apiKey?.trim()) headers[authentication.keyHeader] = authentication.keyPrefix + apiKey.trim();
  const models = new Set<string>(), cursors = new Set<string>(); let cursor = '';
  for (let page = 0; page < 20; page++) {
    signal?.throwIfAborted();
    const query = cursor ? provider.protocol === 'gemini' ? `?pageToken=${encodeURIComponent(cursor)}` : `?after_id=${encodeURIComponent(cursor)}` : '';
    const response = await withAIRetry(provider, signal, () => http({ url: base + '/models' + query, providerId: apiKey === undefined ? provider.id : undefined, ...authentication, headers, signal }));
    signal?.throwIfAborted();
    let data;
    try { data = JSON.parse(response.text); } catch { throw new Error('接口未返回有效的模型列表'); }
    if (data?.error) throw new Error(data.error.message ?? '模型列表获取失败');
    const list = provider.protocol === 'gemini' ? data?.models : data?.data;
    if (!Array.isArray(list)) throw new Error('接口未返回模型列表');
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      if (provider.protocol === 'gemini' && Array.isArray(item.supportedGenerationMethods) && !item.supportedGenerationMethods.includes('generateContent')) continue;
      const id = item.id ?? (typeof item.name === 'string' ? item.name.replace(/^models\//, '') : ''); if (typeof id === 'string' && id.trim()) models.add(id.trim());
    }
    if (provider.protocol !== 'gemini' && data.has_more && !data.last_id) throw new Error('模型列表分页异常，请重试');
    cursor = provider.protocol === 'gemini' ? data.nextPageToken ?? '' : data.has_more ? data.last_id ?? '' : '';
    if (!cursor) break;
    if (typeof cursor !== 'string' || cursors.has(cursor) || page === 19) throw new Error('模型列表分页异常，请重试');
    cursors.add(cursor);
  }
  if (!models.size) throw new Error('未获取到可用模型');
  return [...models].sort();
}
export function requestBody(provider: Provider, config: AIConfig, system: string, user: string): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
  validateAI(config, provider);
  const base = apiBase(provider), extra = JSON.parse(config.extra);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.protocol === 'chat') {
    const body: Record<string, unknown> = { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: true, ...extra };
    if (config.reasoning !== 'off') { body.reasoning_effort = config.effort; body.max_completion_tokens = config.maxTokens; }
    else { body.max_tokens = config.maxTokens; if (config.sampling) body.temperature = config.temperature; }
    return { url: base + '/chat/completions', body, headers };
  }
  if (provider.protocol === 'responses') {
    const body: Record<string, unknown> = { model: config.model, instructions: system, input: user, max_output_tokens: config.maxTokens, stream: true, ...extra };
    if (config.reasoning !== 'off') body.reasoning = { effort: config.effort };
    else if (config.sampling) body.temperature = config.temperature;
    return { url: base + '/responses', body, headers };
  }
  if (provider.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    const body: Record<string, unknown> = { model: config.model, system, messages: [{ role: 'user', content: user }], max_tokens: config.maxTokens, stream: true, ...extra };
    if (config.reasoning === 'budget') body.thinking = { type: 'enabled', budget_tokens: config.budget };
    else if (config.reasoning === 'adaptive') body.thinking = { type: 'adaptive' };
    else if (config.sampling) body.temperature = Math.min(config.temperature, 1);
    return { url: base + '/messages', body, headers };
  }
  const generationConfig: Record<string, unknown> = { maxOutputTokens: config.maxTokens, ...(extra.generationConfig ?? {}) };
  if (config.sampling) generationConfig.temperature = config.temperature;
  if (config.reasoning === 'budget') generationConfig.thinkingConfig = { thinkingBudget: config.budget };
  else if (config.reasoning === 'effort') generationConfig.thinkingConfig = { thinkingLevel: config.effort };
  else if (config.reasoning === 'adaptive') generationConfig.thinkingConfig = { thinkingBudget: -1 };
  return { url: base + '/models/' + encodeURIComponent(config.model.replace(/^models\//, '')) + ':streamGenerateContent?alt=sse', body: { ...extra, systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig }, headers };
}
type Json = Record<string, any>; // Provider event payloads have independent, evolving schemas.
function responseError(data: Json, fallback: string): Error {
  const message = data.message ?? fallback;
  const permanent = [data.code, data.type, data.status].some(code => ['invalid_api_key', 'authentication_error', 'permission_error', 'invalid_request_error', 'not_found_error', 'insufficient_quota', 'context_length_exceeded', 'content_policy_violation', 'INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND'].includes(code));
  return permanent ? new PermanentAIError(message) : new Error(message);
}
export function outputText(data: Json): string {
  if (data.error) throw responseError(data.error, '模型返回错误');
  if (data.type === 'error') throw responseError(data, '模型返回错误');
  if (data.type === 'response.failed') throw responseError(data.response?.error ?? {}, '生成失败');
  if (data.candidates?.some((c: Json) => ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'].includes(c.finishReason)) || data.promptFeedback?.blockReason || data.choices?.some((c: Json) => c.finish_reason === 'content_filter' || c.delta?.refusal || c.message?.refusal) || data.type === 'response.refusal.delta' || data.output?.some((o: Json) => o.content?.some((c: Json) => c.type === 'refusal'))) throw new PermanentAIError('模型拒绝生成，请调整指令');
  if (data.type === 'response.output_text.delta') return data.delta ?? '';
  if (data.type === 'content_block_delta') return data.delta?.type === 'text_delta' ? data.delta.text ?? '' : '';
  if (data.type === 'content_block_start') return data.content_block?.type === 'text' ? data.content_block.text ?? '' : '';
  if (data.choices) return data.choices.map((c: Json) => c.delta?.content ?? c.message?.content ?? '').filter((s: unknown) => typeof s === 'string').join('');
  if (data.candidates) return data.candidates.flatMap((c: Json) => c.content?.parts ?? []).filter((p: Json) => !p.thought).map((p: Json) => p.text ?? '').join('');
  if (data.output_text) return data.output_text;
  if (Array.isArray(data.output)) return data.output.flatMap((o: Json) => o.content ?? []).filter((c: Json) => c.type === 'output_text').map((c: Json) => c.text ?? '').join('');
  if (Array.isArray(data.content)) return data.content.filter((c: Json) => c.type === 'text').map((c: Json) => c.text ?? '').join('');
  return '';
}
export class StreamParser {
  private buffer = '';
  text = '';
  truncated = false;
  error: Error | undefined;
  completed = false;
  constructor(private onText: (text: string) => void) {}
  private event(raw: string) {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (data === '[DONE]') { this.completed = true; return; }
    if (!data) return;
    let parsed: Json;
    try { parsed = JSON.parse(data); } catch { this.error = new Error('模型返回了无效的流式数据'); return; }
    try {
      let part = outputText(parsed);
      if (parsed.type === 'response.completed' && !this.text) part = outputText(parsed.response ?? {});
      if (part) { this.text += part; this.onText(this.text); }
      if (parsed.choices?.some((c: Json) => c.finish_reason === 'length') || parsed.delta?.stop_reason === 'max_tokens' || parsed.candidates?.some((c: Json) => c.finishReason === 'MAX_TOKENS') || parsed.type === 'response.incomplete') this.truncated = true;
      if (parsed.choices?.some((c: Json) => c.finish_reason) || parsed.type === 'response.completed' || parsed.type === 'response.incomplete' || parsed.type === 'message_stop' || parsed.candidates?.some((c: Json) => c.finishReason)) this.completed = true;
    } catch (error) { this.error = error instanceof Error ? error : new Error(String(error)); }
  }
  feed(chunk: string) {
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, '\n');
    let index: number;
    while ((index = this.buffer.indexOf('\n\n')) >= 0) { this.event(this.buffer.slice(0, index)); this.buffer = this.buffer.slice(index + 2); }
  }
  finish(raw: string) {
    if (this.buffer.trim().startsWith('data:') || this.buffer.includes('\ndata:')) this.event(this.buffer);
    if (!this.text && raw.trim().startsWith('{')) {
      try { const data = JSON.parse(raw); this.text = outputText(data); this.completed = true; this.truncated = data.status === 'incomplete' || data.stop_reason === 'max_tokens' || data.choices?.some((c: Json) => c.finish_reason === 'length') || data.candidates?.some((c: Json) => c.finishReason === 'MAX_TOKENS'); if (this.text) this.onText(this.text); } catch (e) { this.error = e instanceof Error ? e : new Error(String(e)); }
    }
    if (this.error) throw this.error;
    if (!this.text.trim() && this.truncated) throw new PermanentAIError('已达到输出上限，可继续生成');
    if (!this.text.trim()) throw new Error('模型未返回正文');
    if (!this.completed) throw new Error('生成连接中断，可继续生成');
    return this.text;
  }
}
export async function generate(provider: Provider, config: AIConfig, system: string, user: string, signal: AbortSignal, onText: (text: string) => void): Promise<string> {
  const request = requestBody(provider, config, system, user);
  return withAIRetry(provider, signal, async attempt => {
    // Each attempt replaces its own streamed text; previously completed task output is retained by the caller.
    if (attempt > 0) onText('');
    const parser = new StreamParser(onText);
    let active = true;
    try {
      const response = await http({ url: request.url, method: 'POST', headers: request.headers, body: JSON.stringify(request.body), providerId: provider.id, ...auth(provider), signal, onChunk: chunk => { if (active && !signal.aborted) parser.feed(chunk); } });
      signal.throwIfAborted();
      const text = parser.finish(response.text);
      if (parser.truncated) throw new PermanentAIError('已达到输出上限，可继续生成');
      return text;
    } finally { active = false; }
  });
}
