import { type AIConfig, type Provider, validateAI } from './domain';
import { http } from './platform';
import { PermanentAIError, withAIIdleTimeout, withAIRetry } from './aiRetry';
import { READY_TO_WRITE, ToolConversation, readToolTurn, type ModelRequest, type ToolTurn, type WritingTools } from './toolGeneration';

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
export function requestBody(provider: Provider, config: AIConfig, system: string, user: string, includeReasoning = false): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
  validateAI(config, provider);
  const base = apiBase(provider), extra = JSON.parse(config.extra);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.protocol === 'chat') {
    const body: Record<string, unknown> = { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: true, ...extra };
    if (config.effort !== 'default') { body.reasoning_effort = config.effort; body.max_completion_tokens = config.maxTokens; }
    else { body.max_tokens = config.maxTokens; if (config.sampling) body.temperature = config.temperature; }
    return { url: base + '/chat/completions', body, headers };
  }
  if (provider.protocol === 'responses') {
    const body: Record<string, unknown> = { model: config.model, instructions: system, input: user, max_output_tokens: config.maxTokens, stream: true, ...extra };
    if (config.effort !== 'default') body.reasoning = { effort: config.effort, ...(includeReasoning ? { summary: 'auto' } : {}) };
    else if (config.sampling) body.temperature = config.temperature;
    return { url: base + '/responses', body, headers };
  }
  if (provider.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    const body: Record<string, unknown> = { model: config.model, system, messages: [{ role: 'user', content: user }], max_tokens: config.maxTokens, stream: true, ...extra };
    if (config.effort !== 'default') {
      body.thinking = { type: 'adaptive' };
      body.output_config = { ...extra.output_config, effort: config.effort };
    } else if (config.sampling) body.temperature = Math.min(config.temperature, 1);
    return { url: base + '/messages', body, headers };
  }
  const generationConfig: Record<string, unknown> = { maxOutputTokens: config.maxTokens, ...(extra.generationConfig ?? {}) };
  if (config.sampling) generationConfig.temperature = config.temperature;
  if (config.effort !== 'default') generationConfig.thinkingConfig = { thinkingLevel: config.effort.toUpperCase(), ...(includeReasoning ? { includeThoughts: true } : {}) };
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
export function reasoningText(data: Json): string {
  if (data.type === 'response.reasoning_summary_text.delta') return data.delta ?? '';
  if (data.type === 'content_block_delta' && data.delta?.type === 'thinking_delta') return data.delta.thinking ?? '';
  if (data.type === 'content_block_start' && data.content_block?.type === 'thinking') return data.content_block.thinking ?? '';
  if (data.choices) return data.choices.map((c: Json) => c.delta?.reasoning_content ?? c.delta?.reasoning ?? c.message?.reasoning_content ?? c.message?.reasoning ?? '').filter((s: unknown) => typeof s === 'string').join('');
  if (data.candidates) return data.candidates.flatMap((c: Json) => c.content?.parts ?? []).filter((p: Json) => p.thought).map((p: Json) => p.text ?? '').join('');
  if (Array.isArray(data.output)) return data.output.flatMap((o: Json) => o.type === 'reasoning' ? o.summary ?? [] : []).map((part: Json) => part.text ?? '').join('\n');
  if (Array.isArray(data.content)) return data.content.filter((c: Json) => c.type === 'thinking').map((c: Json) => c.thinking ?? '').join('\n');
  return '';
}
function truncatedResponse(data: Json): boolean {
  return data.status === 'incomplete' || data.stop_reason === 'max_tokens' || !!data.choices?.some((c: Json) => c.finish_reason === 'length') || !!data.candidates?.some((c: Json) => c.finishReason === 'MAX_TOKENS');
}
export class StreamParser {
  private buffer = '';
  text = '';
  reasoning = '';
  truncated = false;
  error: Error | undefined;
  completed = false;
  constructor(private onText: (text: string) => void, private onReasoning?: (text: string) => void) {}
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
      const reasoning = reasoningText(parsed) || (parsed.type === 'response.completed' && !this.reasoning ? reasoningText(parsed.response ?? {}) : '');
      if (reasoning) { this.reasoning += reasoning; this.onReasoning?.(this.reasoning); }
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
    // The final response is authoritative: WebView chunk events can arrive
    // after the invoke result, leaving the live preview short of the final SSE.
    if (raw.trim().startsWith('data:') || raw.includes('\ndata:')) {
      const complete = new StreamParser(() => {});
      complete.feed(raw);
      let failure: unknown;
      try { complete.finish(''); } catch (error) { failure = error; }
      const changed = this.text !== complete.text;
      const reasoningChanged = this.reasoning !== complete.reasoning;
      this.buffer = ''; this.text = complete.text; this.error = complete.error;
      this.reasoning = complete.reasoning;
      this.completed = complete.completed; this.truncated = complete.truncated;
      if (changed && this.text) this.onText(this.text);
      if (reasoningChanged) this.onReasoning?.(this.reasoning);
      if (failure) throw failure;
    }
    if (this.buffer.trim().startsWith('data:') || this.buffer.includes('\ndata:')) this.event(this.buffer);
    if (!this.text && raw.trim().startsWith('{')) {
      try { const data = JSON.parse(raw); this.text = outputText(data); this.reasoning = reasoningText(data); this.completed = true; this.truncated = truncatedResponse(data); if (this.text) this.onText(this.text); if (this.reasoning) this.onReasoning?.(this.reasoning); } catch (e) { this.error = e instanceof Error ? e : new Error(String(e)); }
    }
    if (this.error) throw this.error;
    if (!this.text.trim() && this.truncated) throw new PermanentAIError('已达到输出上限，可继续生成');
    if (!this.text.trim()) throw new Error('模型未返回正文');
    if (!this.completed) throw new Error('生成连接中断，可继续生成');
    return this.text;
  }
}
export async function generate(provider: Provider, config: AIConfig, system: string, user: string, signal: AbortSignal, onText: (text: string) => void, onReasoning?: (text: string) => void, idleTimeoutMs?: number, tools?: WritingTools): Promise<string> {
  const base = requestBody(provider, config, system, user, !!onReasoning);
  const run = async (signal: AbortSignal, progress?: () => void) => {
    const send = (request: ModelRequest, onChunk?: (chunk: string) => void) => http({ url: request.url, method: 'POST', headers: request.headers, body: JSON.stringify(request.body), providerId: provider.id, ...auth(provider), signal, onChunk });
    const newParser = () => {
      // Keep the last preview until a retry actually produces replacement text.
      let reasoningPublished = false;
      return new StreamParser(text => {
        progress?.();
        if (!reasoningPublished) { reasoningPublished = true; onReasoning?.(''); }
        onText(text);
      }, text => { progress?.(); reasoningPublished = true; onReasoning?.(text); });
    };
    const finish = (parser: StreamParser, raw: string) => {
      const text = parser.finish(raw);
      if (parser.truncated) throw new PermanentAIError('已达到输出上限，可继续生成');
      return text;
    };
    let finalRequest = base;
    if (tools) {
      if (system.length + user.length > config.contextChars) throw new PermanentAIError('任务材料超过上下文上限，请调整 AI 上下文或缩小范围');
      const conversation = new ToolConversation(provider.protocol, base, config.contextChars);
      for (let request = conversation.decisionRequest(); request; request = conversation.decisionRequest()) {
        const decision = request;
        const reply = await withAIRetry<{ text: string } | { turn?: ToolTurn }>(provider, signal, async () => {
          const { text: raw } = await send(decision);
          signal.throwIfAborted();
          const data = JSON.parse(raw), text = outputText(data); // Includes refusal and provider error checks.
          const turn = readToolTurn(provider.protocol, data);
          if (!turn && text.trim() !== READY_TO_WRITE) return { text: finish(newParser(), raw) };
          if (truncatedResponse(data)) throw new PermanentAIError('已达到输出上限，可继续生成');
          return { turn };
        });
        signal.throwIfAborted();
        if ('text' in reply) return reply.text;
        progress?.();
        if (!reply.turn || !conversation.accept(reply.turn, tools)) break;
      }
      finalRequest = conversation.finalRequest();
    }
    return withAIRetry(provider, signal, async () => {
      const parser = newParser();
      let active = true;
      try {
        const response = await send(finalRequest, chunk => { if (active && !signal.aborted) parser.feed(chunk); });
        signal.throwIfAborted();
        return finish(parser, response.text);
      } finally { active = false; }
    });
  };
  return idleTimeoutMs === undefined ? run(signal) : withAIIdleTimeout(signal, idleTimeoutMs, run);
}
