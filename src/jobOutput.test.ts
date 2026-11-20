import { describe, expect, it } from 'vitest';
import { createJob, emptyWorkspace } from './domain';
import { publishJobOutput } from './jobOutput';

describe('streamed job output', () => {
  it('updates only the target step and preserves unrelated workspace objects', () => {
    const state = emptyWorkspace();
    const job = createJob(undefined, 'analyze', null, [], '');
    const otherJob = createJob(undefined, 'style', null, [], '');
    const step = job.steps[0];
    const completedStep = { ...step, id: 'completed', status: 'ready' as const, output: '已有结果' };
    job.steps.push(completedStep);
    job.sourceText = '原文'.repeat(120_000);
    state.jobs = [job, otherJob];
    state.references = [{ id: 'source', title: '正文', source: '', kind: 'text', content: job.sourceText, createdAt: '' }];
    const next = publishJobOutput(state, job.id, step.id, '新生成的结果');
    expect(next.jobs[0].steps[0]).toMatchObject({ output: '新生成的结果', status: 'running' });
    expect(step.output).toBe('');
    expect(next.jobs[0]).not.toBe(job);
    expect(next.jobs[0].steps[1]).toBe(completedStep);
    expect(next.jobs[1]).toBe(otherJob);
    for (const key of ['references', 'providers', 'projects', 'skills', 'aiSelection'] as const) expect(next[key]).toBe(state[key]);
    expect(publishJobOutput(next, job.id, step.id, '新生成的结果')).toBe(next);
  });

  it('does not recreate removed jobs or steps when a late chunk arrives', () => {
    const state = emptyWorkspace();
    expect(publishJobOutput(state, 'removed', 'step', 'late')).toBe(state);
    const job = createJob(undefined, 'analyze', null, [], '');
    state.jobs = [job];
    expect(publishJobOutput(state, job.id, 'removed', 'late')).toBe(state);
  });
});
