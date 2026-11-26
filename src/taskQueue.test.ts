import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, parseWorkspace, type Job, type Provider } from './domain';
import { clearFinishedTasksFromList, isFinishedTask, runnableJobs } from './taskQueue';
const provider = (id: string, concurrency: number): Provider => ({ id, concurrency, name: id, protocol: 'chat', baseUrl: 'http://localhost', hasKey: false, enabled: true, models: ['model'], maxRetries: 10, advanced: defaultAdvanced() });
const job = (id: string, providerId = 'a') => ({ ...createJob(undefined, 'analyze', { ...newAISelection(), ...defaultAdvanced(), providerId, model: 'model' }, undefined, ''), id, status: 'queued' as const });
describe('全局任务调度', () => {
  it('清空仅隐藏已采用和失败任务，保留结果及待确认、停止、进行中的任务', () => {
    const state = emptyWorkspace();
    const statuses: Job['status'][] = ['accepted', 'failed', 'ready', 'paused', 'waiting', 'queued', 'running'];
    state.jobs = statuses.map(status => ({ ...job(status), status, error: status === 'failed' ? '失败原因' : '' }));
    state.jobs.forEach(value => { value.steps[0].output = '保留生成内容'; });
    const before = structuredClone(state.jobs);
    clearFinishedTasksFromList(state.jobs);
    expect(state.jobs.filter(value => value.hiddenFromTaskList).map(value => value.id)).toEqual(['accepted', 'failed']);
    expect(state.jobs.map(value => ({ ...value, hiddenFromTaskList: undefined }))).toEqual(before.map(value => ({ ...value, hiddenFromTaskList: undefined })));
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.jobs.filter(value => value.hiddenFromTaskList).map(value => value.id)).toEqual(['accepted', 'failed']);
    expect(restored.jobs.every(value => value.steps[0].output === '保留生成内容')).toBe(true);
    const retry = restored.jobs.find(value => value.id === 'failed')!; retry.status = 'queued';
    expect(isFinishedTask(retry)).toBe(false);
    expect(runnableJobs(restored.jobs, [provider('a', 1)], new Set())).toContain('failed');
  });
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
    const jobs = ['four', 'three', 'two', 'one'].map(id => ({ ...createJob(undefined, 'collect', null, undefined, ''), id, status: 'queued' as const, collectionTask: { bookUrl: id === 'two' ? 'one' : id, title: id, scope: 'opening' as const, chapterId: '', referenceId: id, done: 0, total: 0 } }));
    expect(runnableJobs(jobs, [], new Set())).toEqual(['one', 'three', 'four']);
    expect(runnableJobs(jobs, [], new Set(['one', 'three', 'four']))).toEqual([]);
  });
});
