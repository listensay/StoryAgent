import { describe, expect, it, vi } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject, parseWorkspace } from './domain';
import { requestBody, StreamParser } from './ai';
import { prepareWriting } from './jobWorkflow';
import { buildPrompt } from './prompts';
import { publishJobOutput } from './jobOutput';
import { writingCompleted, writingSkillFiles } from './writingActivity';

describe('writing activity persistence and completion', () => {
  it('keeps analysis separate from the manuscript and restores execution snapshots', () => {
    const state = emptyWorkspace(), project = newProject('测试小说', 'long');
    const job = createJob(project, 'draft', null, project.chapters[0].id, '创作要求');
    state.projects.push(project); state.jobs.push(job);
    job.steps[0].execution = { summary: '读取小说资料。', skills: [{ id: 'builtin-draft', name: '小说创作', version: '1.0', files: ['SKILL.md'] }], startedAt: '2026-11-22T00:00:00Z' };
    const next = publishJobOutput(state, job.id, job.steps[0].id, '正文内容', '分析内容');
    const restored = parseWorkspace(JSON.stringify(next));
    expect(restored.jobs[0].steps[0]).toMatchObject({ output: '正文内容', reasoning: '分析内容', execution: job.steps[0].execution, status: 'pending' });
    expect(publishJobOutput(next, job.id, job.steps[0].id, '正文内容', '分析内容')).toBe(next);
    expect(publishJobOutput(next, job.id, job.steps[0].id, '正文内容', '新的分析内容').jobs[0].steps[0].output).toBe('正文内容');
  });

  it('requires every writing stage to finish before showing completion', () => {
    const project = newProject('测试小说', 'long');
    const job = createJob(project, 'draft', null, project.chapters[0].id, ''); prepareWriting(job);
    job.status = 'ready'; job.steps.find(step => !step.intermediate)!.status = 'ready';
    expect(writingCompleted(job)).toBe(false);
    job.steps.forEach(step => { step.status = 'ready'; }); expect(writingCompleted(job)).toBe(true);
    for (const status of ['paused', 'failed', 'queued', 'running'] as const) { job.status = status; expect(writingCompleted(job)).toBe(false); }
    job.status = 'accepted'; job.steps.forEach(step => { step.status = 'accepted'; }); expect(writingCompleted(job)).toBe(true);
  });

  it('records only the skills and resources actually included for each stage', () => {
    const state = emptyWorkspace(), project = newProject('测试小说', 'long'); state.projects.push(project);
    const config = { ...newAISelection(), ...defaultAdvanced() };
    const job = createJob(project, 'draft', config, project.chapters[0].id, '');
    const skill = state.skills.find(skill => skill.id === 'builtin-draft')!;
    skill.files.push({ path: 'references/unrelated.txt', content: '未读取资料' });
    expect(buildPrompt(state, job, job.steps[0], config).skills).toEqual([{ id: skill.id, name: skill.name, version: skill.version, files: ['SKILL.md', 'references/unrelated.txt'], contents: skill.files }]);
    const memory = buildPrompt(state, { ...job, kind: 'memory' }, job.steps[0], config);
    expect(memory.skills.map(skill => skill.id)).not.toContain('builtin-draft');
    state.skills.find(skill => skill.id === 'builtin-review')!.enabled = false;
    expect(buildPrompt(state, { ...job, kind: 'memory' }, job.steps[0], config).skills).toEqual([]);
  });

  it('preserves selected skill definitions and loaded resources after edits or removal', () => {
    const state = emptyWorkspace(), project = newProject('测试小说', 'long'); state.projects.push(project);
    const skill = state.skills.find(skill => skill.id === 'builtin-draft')!;
    skill.files = [
      { path: 'SKILL.md', content: '# 写作规则\n\n使用 [场景资料](references/scenes.md)。' },
      { path: 'references/scenes.md', content: '场景从角色行动开始。' },
      { path: 'scripts/run.py', content: '未调用脚本' },
      { path: 'references/other.md', content: '未调用资料' },
    ];
    project.skillIds = [skill.id];
    const config = { ...newAISelection(), ...defaultAdvanced() };
    const job = createJob(project, 'draft', config, project.chapters[0].id, ''); state.jobs.push(job);
    const loaded = buildPrompt(state, job, job.steps[0], config).skills;
    const expected = structuredClone(skill.files.slice(0, 2));
    expect(loaded[0].contents).toEqual(expected);
    job.steps[0].execution = { summary: '任务分析', skills: loaded, startedAt: '2026-11-22T00:00:00Z' };
    skill.files[0].content = '修改后的规则';
    state.skills = [];
    const restored = parseWorkspace(JSON.stringify(state));
    expect(writingSkillFiles(restored.jobs[0].steps[0].execution!.skills[0], restored.skills)).toEqual(expected);
  });

  it('resolves older task files from the matching skill version without using newer content', () => {
    const state = emptyWorkspace(), skill = state.skills.find(skill => skill.id === 'builtin-draft')!;
    const execution = { id: skill.id, name: skill.name, version: skill.version, files: ['SKILL.md'] };
    const original = structuredClone(skill.files);
    expect(writingSkillFiles(execution, state.skills)).toEqual(original);
    skill.revisions.push({ version: skill.version, files: original, savedAt: '2026-11-22T00:00:00Z' });
    skill.version = '2.0'; skill.files = [{ path: 'SKILL.md', content: '新版规则' }];
    expect(writingSkillFiles(execution, state.skills)).toEqual(original);
    skill.revisions = [];
    expect(writingSkillFiles(execution, state.skills)).toEqual([{ path: 'SKILL.md', content: '' }]);
  });
});

describe('provider analysis streaming', () => {
  it('requests provider summaries only for tasks that display analysis', () => {
    const config = { ...newAISelection(), ...defaultAdvanced(), providerId: 'test', model: 'test', effort: 'medium' as const };
    const provider = { id: 'test', name: '测试', protocol: 'responses' as const, baseUrl: 'http://localhost/v1', models: ['test'], enabled: true, hasKey: false, maxRetries: 0, advanced: defaultAdvanced() };
    expect(requestBody(provider, config, '', '').body.reasoning).toEqual({ effort: 'medium' });
    expect(requestBody(provider, config, '', '', true).body.reasoning).toEqual({ effort: 'medium', summary: 'auto' });
  });
  it.each([
    [{ choices: [{ delta: { reasoning_content: '分析' } }] }, { choices: [{ delta: { content: '正文' }, finish_reason: 'stop' }] }],
    [{ type: 'response.reasoning_summary_text.delta', delta: '分析' }, { type: 'response.output_text.delta', delta: '正文' }, { type: 'response.completed' }],
    [{ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '分析' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: '正文' } }, { type: 'message_stop' }],
    [{ candidates: [{ content: { parts: [{ thought: true, text: '分析' }, { text: '正文' }] }, finishReason: 'STOP' }] }],
  ])('keeps provider analysis out of generated prose %#', (...events) => {
    const raw = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    for (let boundary = 1; boundary < raw.length; boundary++) {
      const analysis = vi.fn(), parser = new StreamParser(() => {}, analysis);
      parser.feed(raw.slice(0, boundary)); parser.feed(raw.slice(boundary));
      expect(parser.finish(raw)).toBe('正文'); expect(parser.reasoning).toBe('分析'); expect(analysis).toHaveBeenLastCalledWith('分析');
    }
  });

  it('reconciles analysis from the authoritative response when chunk events arrive late', () => {
    const analysis = vi.fn(), parser = new StreamParser(() => {}, analysis);
    parser.feed('data: {"choices":[{"delta":{"reasoning_content":"旧的分析"}}]}\n\n');
    const raw = 'data: {"choices":[{"delta":{"reasoning_content":"完整分析"}}]}\n\ndata: {"choices":[{"delta":{"content":"正文"},"finish_reason":"stop"}]}\n\n';
    expect(parser.finish(raw)).toBe('正文'); expect(analysis).toHaveBeenLastCalledWith('完整分析');
  });
});
