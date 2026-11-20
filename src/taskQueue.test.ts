import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, newAISelection, type Provider } from './domain';
import { runnableJobs } from './taskQueue';
const provider = (id: string, concurrency: number): Provider => ({ id, concurrency, name: id, protocol: 'chat', baseUrl: 'http://localhost', hasKey: false, enabled: true, models: ['model'], maxRetries: 10, advanced: defaultAdvanced() });
const job = (id: string, providerId = 'a') => ({ ...createJob(undefined, 'analyze', { ...newAISelection(), ...defaultAdvanced(), providerId, model: 'model' }, [], ''), id, status: 'queued' as const });
describe('全局任务调度', () => {
  it('按添加顺序执行，每个 AI 独立限流', () => {
    const jobs = [job('a3'), job('b2', 'b'), job('a2'), job('b1', 'b'), job('a1')];
    expect(runnableJobs(jobs, [provider('a', 2), provider('b', 1)], new Set())).toEqual(['a1', 'b1', 'a2']);
    expect(runnableJobs(jobs, [provider('a', 2), provider('b', 1)], new Set(['a1', 'b1']))).toEqual(['a2']);
  });
  it('暂停和待评分任务释放并发位置', () => {
    const jobs = [{ ...job('paused'), status: 'paused' as const }, { ...job('waiting'), status: 'waiting' as const }, job('new')];
    expect(runnableJobs(jobs, [provider('a', 1)], new Set())).toEqual(['new']);
  });
  it('采集限制三个并发，同书不同范围串行保护缓存', () => {
    const jobs = ['four', 'three', 'two', 'one'].map(id => ({ ...createJob(undefined, 'collect', null, [], ''), id, status: 'queued' as const, collectionTask: { bookUrl: id === 'two' ? 'one' : id, title: id, scope: 'opening' as const, chapterId: '', referenceId: id, done: 0, total: 0 } }));
    expect(runnableJobs(jobs, [], new Set())).toEqual(['one', 'three', 'four']);
    expect(runnableJobs(jobs, [], new Set(['one', 'three', 'four']))).toEqual([]);
  });
});
