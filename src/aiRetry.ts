import { DEFAULT_AI_RETRIES, type Provider } from './domain';
import { HttpError } from './platform';

export class PermanentAIError extends Error {}

function canRetry(error: unknown) {
  if (/读取密钥失败|密钥状态不可用|凭据库不可用/.test(String(error))) return false;
  if (error instanceof PermanentAIError || (error instanceof Error && error.name === 'AbortError')) return false;
  if (error instanceof HttpError) return [408, 409, 429].includes(error.status) || error.status >= 500;
  return true;
}

function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, delay);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// One inactivity budget covers the request and its automatic retries. An unresponsive
// native invoke must not keep the chapter locked after a timeout or a manual stop.
export async function withAIIdleTimeout<T>(signal: AbortSignal, timeoutMs: number, run: (signal: AbortSignal, progress: () => void) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  let rejectWait!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectWait = reject; });
  const stop = (reason: unknown) => { controller.abort(reason); rejectWait(reason); };
  const cancel = () => stop(signal.reason);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const progress = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stop(new Error('模型长时间未返回新内容，可继续生成或更换模型')), timeoutMs);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    progress();
    return await Promise.race([interrupted, run(controller.signal, progress)]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

export async function withAIRetry<T>(provider: Provider, signal: AbortSignal | undefined, operation: (attempt: number) => Promise<T>): Promise<T> {
  const maxRetries = provider.maxRetries ?? DEFAULT_AI_RETRIES;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      const result = await operation(attempt);
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt >= maxRetries || !canRetry(error)) throw error;
      // Bound the delay while giving a temporarily unavailable service time to recover.
      await waitForRetry(Math.min(1000 * 2 ** attempt, 10000), signal);
    }
  }
}
