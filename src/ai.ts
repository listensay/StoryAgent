import { type Profile, type Provider, validateProfile } from './domain';
import { http } from './platform';

export function apiBase(provider: Provider) {
  return provider.baseUrl.trim().replace(/\/+$/, '').replace(/\/(chat\/completions|responses|messages|models(?:\/[^/]+:(?:streamGenerateContent|generateContent))?)$/, '');
}
function auth(provider: Provider) {
  return provider.protocol === 'anthropic' ? { keyHeader: 'x-api-key', keyPrefix: '' } : provider.protocol === 'gemini' ? { keyHeader: 'x-goog-api-key', keyPrefix: '' } : { keyHeader: 'Authorization', keyPrefix: 'Bearer ' };
}
export async function getModels(provider: Provider, signal?: AbortSignal): Promise<string[]> {
  const models = new Set<string>(); let cursor = '';
  for (let page = 0; page < 20; page++) {
    const query = cursor ? provider.protocol === 'gemini' ? `?pageToken=${encodeURIComponent(cursor)}` : `?after_id=${encodeURIComponent(cursor)}` : '';
    const response = await http({ url: apiBase(provider) + '/models' + query, providerId: provider.id, ...auth(provider), headers: provider.protocol === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}, signal });
    const data = JSON.parse(response.text);
    const list = provider.protocol === 'gemini' ? data.models : data.data;
    if (!Array.isArray(list)) throw new Error('接口未返回模型列表');
    for (const item of list) {
      if (provider.protocol === 'gemini' && Array.isArray(item.supportedGenerationMethods) && !item.supportedGenerationMethods.includes('generateContent')) continue;
      const id = item.id ?? item.name?.replace(/^models\//, ''); if (typeof id === 'string') models.add(id);
    }
    cursor = provider.protocol === 'gemini' ? data.nextPageToken ?? '' : data.has_more ? data.last_id ?? '' : '';
    if (!cursor) break;
  }
  if (!models.size) throw new Error('未获取到可用模型');
  return [...models].sort();
}
export function requestBody(provider: Provider, profile: Profile, system: string, user: string): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
  validateProfile(profile, provider);
  const base = apiBase(provider), extra = JSON.parse(profile.extra);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.protocol === 'chat') {
    const body: Record<string, unknown> = { model: profile.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: true, ...extra };
    if (profile.reasoning !== 'off') { body.reasoning_effort = profile.effort; body.max_completion_tokens = profile.maxTokens; }
    else { body.max_tokens = profile.maxTokens; if (profile.sampling) body.temperature = profile.temperature; }
    return { url: base + '/chat/completions', body, headers };
  }
  if (provider.protocol === 'responses') {
    const body: Record<string, unknown> = { model: profile.model, instructions: system, input: user, max_output_tokens: profile.maxTokens, stream: true, ...extra };
    if (profile.reasoning !== 'off') body.reasoning = { effort: profile.effort };
    else if (profile.sampling) body.temperature = profile.temperature;
    return { url: base + '/responses', body, headers };
  }
  if (provider.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    const body: Record<string, unknown> = { model: profile.model, system, messages: [{ role: 'user', content: user }], max_tokens: profile.maxTokens, stream: true, ...extra };
    if (profile.reasoning === 'budget') body.thinking = { type: 'enabled', budget_tokens: profile.budget };
    else if (profile.reasoning === 'adaptive') body.thinking = { type: 'adaptive' };
    else if (profile.sampling) body.temperature = Math.min(profile.temperature, 1);
    return { url: base + '/messages', body, headers };
  }
  const generationConfig: Record<string, unknown> = { maxOutputTokens: profile.maxTokens, ...(extra.generationConfig ?? {}) };
  if (profile.sampling) generationConfig.temperature = profile.temperature;
  if (profile.reasoning === 'budget') generationConfig.thinkingConfig = { thinkingBudget: profile.budget };
  else if (profile.reasoning === 'effort') generationConfig.thinkingConfig = { thinkingLevel: profile.effort };
  else if (profile.reasoning === 'adaptive') generationConfig.thinkingConfig = { thinkingBudget: -1 };
  return { url: base + '/models/' + encodeURIComponent(profile.model.replace(/^models\//, '')) + ':streamGenerateContent?alt=sse', body: { ...extra, systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig }, headers };
}
type Json = Record<string, any>; // Provider event payloads have independent, evolving schemas.
export function outputText(data: Json): string {
  if (data.error) throw new Error(data.error.message ?? '模型返回错误');
  if (data.type === 'error') throw new Error(data.message ?? '模型返回错误');
  if (data.type === 'response.failed') throw new Error(data.response?.error?.message ?? '生成失败');
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
  error = '';
  completed = false;
  constructor(private onText: (text: string) => void) {}
  private event(raw: string) {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (data === '[DONE]') { this.completed = true; return; }
    if (!data) return;
    let parsed: Json;
    try { parsed = JSON.parse(data); } catch { this.error = '模型返回了无效的流式数据'; return; }
    try {
      let part = outputText(parsed);
      if (parsed.type === 'response.completed' && !this.text) part = outputText(parsed.response ?? {});
      if (part) { this.text += part; this.onText(this.text); }
      if (parsed.choices?.some((c: Json) => c.finish_reason === 'length') || parsed.delta?.stop_reason === 'max_tokens' || parsed.candidates?.some((c: Json) => c.finishReason === 'MAX_TOKENS') || parsed.type === 'response.incomplete') this.truncated = true;
      if (parsed.choices?.some((c: Json) => c.finish_reason) || parsed.type === 'response.completed' || parsed.type === 'response.incomplete' || parsed.type === 'message_stop' || parsed.candidates?.some((c: Json) => c.finishReason)) this.completed = true;
      if (parsed.candidates?.some((c: Json) => ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'].includes(c.finishReason)) || parsed.promptFeedback?.blockReason) this.error = '模型拒绝生成，请调整指令';
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  }
  feed(chunk: string) {
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, '\n');
    let index: number;
    while ((index = this.buffer.indexOf('\n\n')) >= 0) { this.event(this.buffer.slice(0, index)); this.buffer = this.buffer.slice(index + 2); }
  }
  finish(raw: string) {
    if (this.buffer.trim().startsWith('data:') || this.buffer.includes('\ndata:')) this.event(this.buffer);
    if (!this.text && raw.trim().startsWith('{')) {
      try { const data = JSON.parse(raw); this.text = outputText(data); this.completed = true; this.truncated = data.status === 'incomplete' || data.stop_reason === 'max_tokens' || data.choices?.some((c: Json) => c.finish_reason === 'length') || data.candidates?.some((c: Json) => c.finishReason === 'MAX_TOKENS'); if (this.text) this.onText(this.text); } catch (e) { this.error = e instanceof Error ? e.message : String(e); }
    }
    if (this.error) throw new Error(this.error);
    if (!this.text.trim()) throw new Error('模型未返回正文');
    if (!this.completed) throw new Error('生成连接中断，可继续生成');
    return this.text;
  }
}
export async function generate(provider: Provider, profile: Profile, system: string, user: string, signal: AbortSignal, onText: (text: string) => void): Promise<string> {
  const request = requestBody(provider, profile, system, user);
  const parser = new StreamParser(onText);
  const response = await http({ url: request.url, method: 'POST', headers: request.headers, body: JSON.stringify(request.body), providerId: provider.id, ...auth(provider), signal, onChunk: chunk => parser.feed(chunk) });
  const text = parser.finish(response.text);
  if (parser.truncated) throw new Error('已达到输出上限，可继续生成');
  return text;
}
