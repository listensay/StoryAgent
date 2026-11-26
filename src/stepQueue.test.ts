import { describe, expect, it, vi } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject, type Job, type JobStep } from './domain';
import { finishAutomaticStep, prepareWriting } from './jobWorkflow';
import { buildPrompt, prepareAnalysis, synthesisInputs, synthesisSteps } from './prompts';
import { AIRequestQueue, runJobSteps } from './stepQueue';

const config = { ...newAISelection(), ...defaultAdvanced(), providerId: 'a', model: 'test', contextChars: 4000 };
const skill = '---\nname: test-skill\ndescription: 测试提炼结果\n---\n# 写作规则\n以人物动机推动冲突。';
function analysis(count: number, providerId = 'a') {
  const job = createJob(undefined, 'style', { ...config, providerId }, undefined, '');
  job.sourceText = Array.from({ length: count }, (_, i) => `段落${i}。${'故事内容。'.repeat(200)}`).join('\n\n');
  prepareAnalysis(job, job.ai!);
  expect(job.steps.filter(s => !s.aggregate)).toHaveLength(count);
  return job;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function pendingRequest(signal: AbortSignal) {
  const result = deferred<string>();
  const abort = () => result.reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return { ...result, promise: result.promise.finally(() => signal.removeEventListener('abort', abort)) };
}
function start(job: Job, queue: AIRequestQueue, signal: AbortSignal, request: (step: JobStep, prompt: string, signal: AbortSignal) => Promise<string>, limit = 10) {
  const state = emptyWorkspace(); state.jobs = [job];
  return runJobSteps(() => job, () => limit, signal, async (id, stepSignal) => {
    const step = job.steps.find(s => s.id === id)!;
    const synthesis = synthesisSteps(job, step, job.ai!);
    if (synthesis.length) { job.steps.splice(job.steps.indexOf(step), 1, ...synthesis); return; }
    await queue.run(job.ai!.providerId, stepSignal, async () => {
      const prompt = buildPrompt(state, job, step, job.ai!);
      step.status = 'running';
      step.output = await request(step, prompt.user, stepSignal);
      stepSignal.throwIfAborted();
      step.status = 'ready';
      finishAutomaticStep(state, job, step);
    });
  });
}

describe('Skill 分段并发执行', () => {
  it('启动十个分段，任意分段完成后立即补位，全部完成后才综合', async () => {
    const job = analysis(12), queue = new AIRequestQueue(() => 10);
    const requests = new Map<string, ReturnType<typeof pendingRequest>>();
    const request = vi.fn(async (step: JobStep, prompt: string, signal: AbortSignal) => {
      if (step.aggregate) {
        expect(job.steps.filter(s => !s.aggregate).every(s => s.status === 'ready')).toBe(true);
        for (let i = 0; i < 12; i++) expect(prompt).toContain(`证据${i}。`);
        return skill;
      }
      const pending = pendingRequest(signal); requests.set(step.id, pending); return pending.promise;
    });
    const running = start(job, queue, new AbortController().signal, request);
    await vi.waitFor(() => expect(requests.size).toBe(10));
    requests.get(job.steps[5].id)!.resolve('证据5。');
    await vi.waitFor(() => expect(requests.size).toBe(11));
    expect(job.steps[0].status).toBe('running');
    requests.get(job.steps[10].id)!.resolve('证据10。');
    await vi.waitFor(() => expect(requests.size).toBe(12));
    expect(request.mock.calls.some(([s]) => s.aggregate)).toBe(false);
    job.steps.filter(s => !s.aggregate).forEach((s, i) => requests.get(s.id)!.resolve(`证据${i}。`));
    await running;
    expect(request).toHaveBeenCalledTimes(13);
    expect(job.steps[job.steps.length - 1].status).toBe('accepted');
  });

  it('多个任务共享供应商的十个请求额度，其他供应商独立执行', async () => {
    const queue = new AIRequestQueue(id => id === 'a' ? 10 : 2);
    const jobs = [analysis(12), analysis(12), analysis(3, 'b')];
    const requests: { providerId: string; pending: ReturnType<typeof pendingRequest> }[] = [];
    const active: Record<string, number> = { a: 0, b: 0 }, peaks = { a: 0, b: 0 };
    let release = false;
    const runs = jobs.map(job => start(job, queue, new AbortController().signal, async (step, _prompt, signal) => {
      const providerId = job.ai!.providerId as 'a' | 'b';
      active[providerId]++; peaks[providerId] = Math.max(peaks[providerId], active[providerId]);
      try {
        if (step.aggregate) return skill;
        if (release) return '证据';
        const pending = pendingRequest(signal); requests.push({ providerId, pending }); return await pending.promise;
      } finally { active[providerId]--; }
    }));
    await vi.waitFor(() => expect(requests).toHaveLength(12));
    expect(active).toEqual({ a: 10, b: 2 });
    release = true; requests.forEach(({ pending }) => pending.resolve('证据'));
    await Promise.all(runs);
    expect(peaks).toEqual({ a: 10, b: 2 });
    expect(jobs.every(job => job.steps[job.steps.length - 1].status === 'accepted')).toBe(true);
  });

  it('分层汇总并发执行，最终综合等待所有汇总且包含全部证据', async () => {
    const job = analysis(8), queue = new AIRequestQueue(() => 10);
    const merges = new Map<string, { step: JobStep; pending: ReturnType<typeof pendingRequest> }>();
    let finalStarted = false;
    const run = start(job, queue, new AbortController().signal, async (step, prompt, signal) => {
      if (!step.aggregate) return `证据${job.steps.indexOf(step)}。${'内容'.repeat(290)}`;
      if (step.intermediate) {
        const pending = pendingRequest(signal); merges.set(step.id, { step, pending }); return pending.promise;
      }
      finalStarted = true;
      for (let i = 0; i < 8; i++) expect(prompt).toContain(`证据${i}。`);
      return skill;
    });
    await vi.waitFor(() => expect(merges.size).toBe(4));
    expect(finalStarted).toBe(false);
    const entries = [...merges.values()];
    for (const { step, pending } of entries.slice(1)) pending.resolve(synthesisInputs(job, step).map(s => s.output.slice(0, 4)).join('\n'));
    await vi.waitFor(() => expect(entries.slice(1).every(({ step }) => step.status === 'ready')).toBe(true));
    expect(finalStarted).toBe(false);
    entries[0].pending.resolve(synthesisInputs(job, entries[0].step).map(s => s.output.slice(0, 4)).join('\n'));
    await run;
    expect(finalStarted).toBe(true);
  });

  it('失败时取消其他分段，继续执行保留已完成的结果', async () => {
    const job = analysis(5), queue = new AIRequestQueue(() => 3);
    const requests = new Map<string, ReturnType<typeof pendingRequest>>();
    const controller = new AbortController();
    const run = start(job, queue, controller.signal, async (step, _prompt, signal) => {
      if (step.id === job.steps[0].id) return '已完成的证据';
      const pending = pendingRequest(signal); requests.set(step.id, pending); return pending.promise;
    }, 3);
    const failure = expect(run).rejects.toThrow('请求失败');
    await vi.waitFor(() => expect(requests.size).toBe(3));
    requests.get(job.steps[1].id)!.reject(new Error('请求失败'));
    await failure;
    expect(controller.signal.aborted).toBe(false);
    expect(job.steps[0]).toMatchObject({ status: 'ready', output: '已完成的证据' });
    job.steps.forEach(step => { if (step.status === 'running') step.status = 'pending'; });
    const resumed = vi.fn(async (step: JobStep, prompt: string) => {
      if (step.aggregate) { expect(prompt).toContain('已完成的证据'); return skill; }
      return '剩余证据';
    });
    await start(job, queue, new AbortController().signal, resumed, 3);
    expect(resumed.mock.calls.some(([step]) => step.id === job.steps[0].id)).toBe(false);
    expect(job.steps[job.steps.length - 1].status).toBe('accepted');
  });

  it('停止会取消正在生成与等待额度的分段，并释放额度', async () => {
    const queue = new AIRequestQueue(() => 2), controller = new AbortController();
    const request = vi.fn(async (_step: JobStep, _prompt: string, signal: AbortSignal) => pendingRequest(signal).promise);
    const run = start(analysis(8), queue, controller.signal, request);
    const stopped = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    controller.abort(); await stopped;
    await queue.run('a', new AbortController().signal, async () => '可用');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('重启恢复与单段任务不重复生成已完成结果', async () => {
    const job = analysis(3), queue = new AIRequestQueue(() => 10);
    job.steps[0].status = 'ready'; job.steps[0].output = '重启前的结果';
    const request = vi.fn(async (step: JobStep, prompt: string) => {
      if (step.aggregate) { expect(prompt).toContain('重启前的结果'); return skill; }
      return '恢复后的结果';
    });
    await start(job, queue, new AbortController().signal, request);
    expect(request).toHaveBeenCalledTimes(3);
    const single = analysis(1);
    await start(single, queue, new AbortController().signal, async () => skill);
    expect(single.steps[0].status).toBe('accepted');
  });

  it('写作阶段保持串行，人工评分仍停在等待状态', async () => {
    const project = newProject('小说', 'long');
    const job = createJob(project, 'draft', config, project.chapters[0].id, ''); prepareWriting(job);
    const calls: string[] = [], gates = new Map<string, ReturnType<typeof deferred<void>>>();
    const run = runJobSteps(() => job, () => 10, new AbortController().signal, async id => {
      calls.push(id); const gate = deferred<void>(); gates.set(id, gate); await gate.promise;
      job.steps.find(s => s.id === id)!.status = 'ready';
    });
    for (let i = 0; i < job.steps.length; i++) {
      await vi.waitFor(() => expect(calls).toHaveLength(i + 1));
      expect(calls[i]).toBe(job.steps[i].id); gates.get(calls[i])!.resolve();
    }
    await run;
    const train = createJob(undefined, 'train', config, undefined, '');
    const execute = vi.fn(async () => 'waiting' as const);
    await expect(runJobSteps(() => train, () => 10, new AbortController().signal, execute)).resolves.toBe('waiting');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
