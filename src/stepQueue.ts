import type { Job } from './domain';
import { synthesisInputs } from './prompts';

type Request = { providerId: string; start: () => void };

// All jobs share request slots, including retries and their backoff periods.
export class AIRequestQueue {
  private active = new Map<string, number>();
  private pending: Request[] = [];

  constructor(private limit: (providerId: string) => number) {}

  run<T>(providerId: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const cancel = () => {
        this.pending = this.pending.filter(item => item !== request);
        reject(signal.reason);
      };
      const request: Request = { providerId, start: () => {
        signal.removeEventListener('abort', cancel);
        this.active.set(providerId, (this.active.get(providerId) ?? 0) + 1);
        void Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject).finally(() => {
          this.active.set(providerId, (this.active.get(providerId) ?? 1) - 1);
          this.drain();
        });
      } };
      signal.addEventListener('abort', cancel, { once: true });
      this.pending.push(request);
      this.drain();
    });
  }

  private drain() {
    for (let i = 0; i < this.pending.length;) {
      const request = this.pending[i];
      if ((this.active.get(request.providerId) ?? 0) >= this.limit(request.providerId)) { i++; continue; }
      this.pending.splice(i, 1);
      request.start();
    }
  }
}

function runnableSteps(job: Job, active: Set<string>): string[] {
  // A committed result can still have an in-flight request; keep it as a stage barrier.
  const pending = job.steps.filter(step => active.has(step.id) || ['pending', 'running'].includes(step.status));
  const first = pending[0];
  if (job.training && first?.stage === 'train-write') {
    const writers: string[] = [];
    for (const step of pending) {
      if (step.stage !== 'train-write' || step.round !== first.round) break;
      if (!active.has(step.id)) writers.push(step.id);
    }
    return writers;
  }
  // Chapters and the remaining training stages depend on the preceding stage.
  if (job.kind !== 'style' || job.training) return first && !active.has(first.id) ? [first.id] : [];
  return pending.filter(step => {
    if (active.has(step.id)) return false;
    if (!step.aggregate) return true;
    const inputs = synthesisInputs(job, step);
    return (!step.inputIds || inputs.length === step.inputIds.length) && inputs.every(input => ['ready', 'accepted'].includes(input.status));
  }).map(step => step.id);
}

// Refill each free slot immediately; synthesis only becomes runnable after its inputs finish.
export async function runJobSteps(
  getJob: () => Job | undefined,
  concurrency: () => number,
  signal: AbortSignal,
  execute: (stepId: string, signal: AbortSignal) => Promise<void | 'waiting'>,
): Promise<void | 'waiting'> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const active = new Map<string, Promise<void>>();
  let failed = false, error: unknown, waiting = false;
  try {
    while (true) {
      if (failed) throw error;
      controller.signal.throwIfAborted();
      const job = getJob();
      if (!job) return;
      const ids = runnableSteps(job, new Set(active.keys())).slice(0, Math.max(0, concurrency() - active.size));
      for (const id of ids) {
        const task = Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return execute(id, controller.signal);
        }).then(result => { if (result === 'waiting') waiting = true; }).catch(cause => {
          if (!failed) { failed = true; error = cause; }
          controller.abort();
        }).finally(() => { active.delete(id); });
        active.set(id, task);
      }
      if (!active.size) {
        if (job.steps.some(step => ['pending', 'running'].includes(step.status))) throw new Error('任务步骤的依赖未完成');
        return;
      }
      await Promise.race(active.values());
      if (failed) throw error;
      if (waiting) return 'waiting';
    }
  } finally {
    controller.abort();
    await Promise.all(active.values());
    signal.removeEventListener('abort', abort);
  }
}
