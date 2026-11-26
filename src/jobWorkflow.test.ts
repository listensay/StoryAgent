import { legacyWritingJob } from './testFixtures';
import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newChapter, newProject, parseWorkspace } from './domain';
import { acceptPreparation, acceptWriting, canAcceptWritingStep, contentHash, finishAutomaticStep, needsMemory, openWriting, preparationSnapshot, prepareWriting, requireIdleWriting, requirePreparation, writingComparison, writingStep } from './jobWorkflow';
import { buildPrompt } from './prompts';

const ai = { ...newAISelection(), ...defaultAdvanced() };
function setup(kind: 'draft' | 'continue' | 'rewrite' = 'draft') {
  const state = emptyWorkspace(), project = newProject('测试小说', 'long'); project.genre = '悬疑';
  state.projects.push(project); const chapter = project.chapters[0]; chapter.content = '开始。中段。结尾。'; chapter.plan = '';
  const job = createJob(project, kind, ai, chapter.id, '', '', '', kind === 'rewrite' ? { start: 3, end: 6 } : undefined);
  prepareWriting(job); state.jobs.push(job);
  return { state, project, chapter, job };
}
describe('创作准备与自动写作流程', () => {
  it.each(['long', 'short'] as const)('打开空%s小说时保持章节为空，重复打开不补建章节或启动任务', form => {
    const state = emptyWorkspace(), project = newProject('空小说', form); project.chapters = []; project.updatedAt = '旧时间';
    state.projects = [project];
    const chapter = openWriting(state, project.id);
    expect(state.activeProjectId).toBe(project.id);
    expect(chapter).toBeUndefined();
    expect(project.chapters).toEqual([]); expect(project.updatedAt).toBe('旧时间');
    const saved = structuredClone(state);
    expect(openWriting(state, project.id)).toBeUndefined();
    expect(state).toEqual(saved); expect(state.jobs).toEqual([]);
  });
  it('打开已有小说返回排序后的最后一章，保留正文、版本、设定和已有任务', () => {
    const { state, project, job } = setup();
    const latest = newChapter('第二章'); latest.content = '最新正文'; latest.versions = [{ id: '版本', content: '旧正文', label: '手动保存', createdAt: '' }];
    project.chapters.push(latest); project.notes.push({ id: '角色', kind: 'character', title: '主角', body: '人物设定', status: 'planned', chapterId: '' });
    state.activeProjectId = project.id;
    const saved = structuredClone(state);
    expect(openWriting(state, project.id)).toBe(latest); expect(state).toEqual(saved); expect(state.jobs[0]).toBe(job);
    project.chapters.reverse();
    expect(openWriting(state, project.id)?.id).toBe(project.chapters[project.chapters.length - 1].id);
    expect(openWriting(state, '已移除小说')).toBeUndefined(); expect(state.activeProjectId).toBe(project.id);
  });
  it.each(['long', 'short'] as const)('空%s小说先添加当前章节，再起草细纲、正文和记忆', form => {
    const project = newProject('空小说', form); project.genre = '修仙'; project.chapters = [];
    expect(() => createJob(project, 'draft', ai, undefined, '')).toThrow('当前章节');
    expect(project.chapters).toHaveLength(0);
    const chapter = newChapter(form === 'long' ? '第一章' : '正文'); project.chapters.push(chapter);
    const job = createJob(project, 'draft', ai, chapter.id, '');
    prepareWriting(job);
    expect(job.steps.map(step => step.stage)).toEqual(['plan', 'draft', 'summary', 'memory']);
    expect(job.steps.every(step => step.chapterId === chapter.id)).toBe(true);
    const state = emptyWorkspace(); state.projects = [project];
    expect(buildPrompt(state, { ...job, kind: 'plan' }, job.steps[0], ai).user).toContain(chapter.title);
  });
  it('不会将已移除的章节或续写、审稿等任务改成新章起草', () => {
    const project = newProject('空小说', 'long'); project.chapters = [];
    for (const kind of ['draft', 'continue', 'rewrite', 'review'] as const) expect(() => createJob(project, kind, ai, undefined, '')).toThrow('当前章节');
    expect(() => createJob(project, 'draft', ai, '已删除章节', '')).toThrow('章节已移除');
    expect(project.chapters).toEqual([]);
    project.chapters.push(newChapter());
    expect(createJob(project, 'draft', ai, project.chapters[0].id, '').steps[0].chapterId).toBe(project.chapters[0].id);
  });
  it('要求书名、题材和正整数目标字数', () => {
    const p = newProject('书名', 'long'); expect(() => requirePreparation(p)).toThrow('题材');
    p.genre = '科幻'; expect(() => requirePreparation(p)).not.toThrow();
    for (const targetWords of [0, -1, 1.5, NaN]) expect(() => requirePreparation({ ...p, targetWords })).toThrow();
    expect(() => requirePreparation({ ...p, title: '  ' })).toThrow();
  });
  it('仅补全缺失设定，并拒绝覆盖生成期间的编辑', () => {
    const { state, project } = setup(); project.theme = '用户主题';
    const job = createJob(project, 'prepare', ai, undefined, ''); job.preparationBase = preparationSnapshot(project);
    job.steps[0].output = JSON.stringify({ theme: 'AI主题', audience: '青年', synopsis: '简介', outline: '大纲', notes: [{ kind: 'character', title: '主角', body: '寻找失踪朋友' }] });
    acceptPreparation(state, job, job.steps[0]); expect(project.theme).toBe('用户主题'); expect(project.synopsis).toBe('简介'); expect(project.notes).toHaveLength(1);
    expect(() => acceptPreparation(state, job, job.steps[0])).toThrow('已更新');
  });
  it.each(['draft', 'continue', 'rewrite'] as const)('%s 的摘要和记忆接收完整的新正文', kind => {
    const { state, job } = setup(kind);
    expect(job.steps.map(s => s.stage)).toEqual(kind === 'draft' ? ['plan', 'draft', 'summary', 'memory'] : [kind, 'summary', 'memory']);
    const prose = job.steps.find(s => s.stage === kind)!; prose.output = '新正文。';
    const expected = kind === 'continue' ? '开始。中段。结尾。\n\n新正文。' : kind === 'rewrite' ? '开始。新正文。结尾。' : '新正文。';
    for (const stage of ['summary', 'memory'] as const) {
      const part = writingStep(job, job.steps.find(s => s.stage === stage)!);
      expect(part.baseContent).toBe(expected); expect(part.selection).toBe('');
      const prompt = buildPrompt(state, { ...job, kind: stage }, part, ai);
      expect(prompt.user).toContain(expected); expect(prompt.user).not.toContain('控制在 800 字以内');
    }
    if (kind === 'draft') { job.steps[0].output = '新细纲'; expect(writingStep(job, prose).basePlan).toBe('新细纲'); }
  });
  it('正文、细纲、摘要和记忆一起采用，替换该章旧事实', () => {
    const { state, project, chapter, job } = setup();
    project.notes = [
      { id: 'old', kind: 'fact', title: '旧事实', body: '旧', chapterId: chapter.id, status: 'confirmed' },
      { id: 'plan', kind: 'scene', title: '场景', body: '计划', chapterId: chapter.id, status: 'planned' },
    ];
    const prose = job.steps[1]; prose.output = '完成的正文'; prose.status = 'ready';
    expect(() => acceptWriting(state, job, prose)).toThrow('尚未完成');
    job.steps[0].output = '细纲'; job.steps[2].output = '独立摘要'; job.steps[3].output = '{"summary":"记忆摘要","notes":[{"kind":"fact","title":"新事实","body":"新"}]}';
    job.steps.forEach(s => { s.status = 'ready'; }); acceptWriting(state, job, prose);
    expect(project.chapters[0]).toMatchObject({ content: '完成的正文', plan: '细纲', summary: '独立摘要', memoryHash: contentHash('完成的正文') });
    expect(project.notes.map(n => n.title)).toEqual(['场景', '新事实']); expect(project.chapters[0].versions[0].content).toBe(chapter.content);
    expect(job.steps.every(s => s.status === 'accepted')).toBe(true);
  });
  it('采用时拒绝覆盖新编辑的正文或细纲', () => {
    for (const changed of ['content', 'plan'] as const) {
      const { state, chapter, job } = setup(); job.steps.forEach(s => { s.status = 'ready'; s.output = s.stage === 'memory' ? '{"summary":"","notes":[]}' : '生成结果'; });
      chapter[changed] = '手动编辑'; expect(() => acceptWriting(state, job, job.steps[1])).toThrow('已更新'); expect(chapter[changed]).toBe('手动编辑');
    }
  });
  it('后续章节获得前章待确认正文、摘要和记忆', () => {
    const { state, project } = setup(); project.chapters.push(newChapter('第二章'));
    const job = legacyWritingJob(project, 'draft', ai, project.chapters.map(c => c.id), ''); prepareWriting(job);
    ['细纲一', '前章正文', '前章摘要', '{"summary":"","notes":[]}'].forEach((s, i) => { job.steps[i].output = s; job.steps[i].status = 'ready'; });
    const prompt = buildPrompt(state, { ...job, kind: 'plan' }, job.steps[4], ai);
    expect(prompt.user).toContain('前章正文'); expect(prompt.user).toContain('前章摘要'); expect(prompt.user).toContain('尚非确认事实');
  });
  it('已有细纲直接用于正文，采用时保留细纲并检测生成期间的修改', () => {
    for (const changed of [false, true]) {
      const { state, project, chapter } = setup(); chapter.plan = '作者确定的细纲';
      const job = createJob(project, 'draft', ai, chapter.id, ''); prepareWriting(job);
      expect(job.steps.map(step => step.stage)).toEqual(['draft', 'summary', 'memory']);
      expect(writingStep(job, job.steps[0]).basePlan).toBe('作者确定的细纲');
      job.steps.forEach(step => { step.status = 'ready'; step.output = step.stage === 'memory' ? '{"summary":"摘要","notes":[]}' : '生成内容'; });
      if (changed) { chapter.plan = '新细纲'; expect(() => acceptWriting(state, job, job.steps[0])).toThrow('细纲已更新'); }
      else { acceptWriting(state, job, job.steps[0]); expect(project.chapters[0].plan).toBe('作者确定的细纲'); }
    }
  });
  it('正文篇幅与创作要求不会污染摘要和记忆，兼容旧任务的篇幅后缀', () => {
    const { state, job } = setup(); job.targetWords = 2000; job.instruction = '写开场争执\n目标篇幅约 2000 字。';
    for (const step of job.steps) {
      const prompt = buildPrompt(state, { ...job, kind: step.stage as 'plan' | 'draft' | 'summary' | 'memory' }, writingStep(job, step), ai);
      if (step.stage === 'draft') expect(prompt.user).toContain('正文目标篇幅约 2000 字。');
      else expect(prompt.user).not.toContain('目标篇幅约 2000 字。');
      if (['summary', 'memory'].includes(step.stage!)) expect(prompt.user).not.toContain('写开场争执');
    }
    expect(parseWorkspace(JSON.stringify({ ...state, jobs: [job] })).jobs[0].targetWords).toBe(2000);
  });
  it('细纲对比使用当前细纲，续写和片段改写对比使用合并后的完整正文', () => {
    const { project, chapter, job } = setup(); chapter.plan = '当前细纲'; job.steps[0].output = '# 新细纲';
    expect(writingComparison(job, job.steps[0], project)).toEqual({ left: '当前细纲', right: '# 新细纲', leftTitle: '当前细纲', rightTitle: '生成细纲' });
    for (const kind of ['continue', 'rewrite'] as const) {
      const { project, job } = setup(kind); const step = job.steps[0]; step.output = '新内容';
      expect(writingComparison(job, step, project).right).toBe(kind === 'continue' ? '开始。中段。结尾。\n\n新内容' : '开始。新内容结尾。');
    }
  });
  it('同章写作不能重复启动或同时恢复，其他章节和已结束任务不受影响', () => {
    const { project, chapter, job } = setup(); job.status = 'running';
    expect(() => requireIdleWriting([job], project.id, [chapter.id])).toThrow('正在生成');
    expect(() => requireIdleWriting([job], project.id, [chapter.id], job.id)).not.toThrow();
    expect(() => requireIdleWriting([job], project.id, ['另一章'])).not.toThrow();
    job.status = 'paused'; expect(() => requireIdleWriting([job], project.id, [chapter.id])).not.toThrow();
  });
  it('摘要与记忆完成之前不能采用正文，中间步骤不能独立采用', () => {
    const { job } = setup(); job.steps[1].status = 'ready';
    expect(canAcceptWritingStep(job, job.steps[1])).toBe(false);
    job.steps.forEach(step => { step.status = 'ready'; });
    expect(canAcceptWritingStep(job, job.steps[1])).toBe(true);
    expect(canAcceptWritingStep(job, job.steps[0])).toBe(false);
  });
});
describe('手动保存记忆和旧数据', () => {
  it('去重正在执行的任务，失败、停止或正文更新后可以再次提取', () => {
    const { state, project, chapter } = setup(); state.jobs = [];
    expect(needsMemory(state, project, chapter)).toBe(true);
    const job = createJob(project, 'memory', ai, chapter.id, ''); state.jobs = [job];
    for (const status of ['queued', 'running', 'ready'] as const) { job.status = status; expect(needsMemory(state, project, chapter)).toBe(false); }
    for (const status of ['failed', 'paused'] as const) { job.status = status; expect(needsMemory(state, project, chapter)).toBe(true); }
    job.status = 'accepted'; expect(needsMemory(state, project, chapter)).toBe(true);
    chapter.memoryHash = contentHash(chapter.content); expect(needsMemory(state, project, chapter)).toBe(false);
    chapter.content += '更新'; expect(needsMemory(state, project, chapter)).toBe(true);
  });
  it('自动维护仅使用仍然匹配的正文', () => {
    const { state, project, chapter } = setup();
    const job = createJob(project, 'memory', ai, chapter.id, ''); job.steps[0].output = '{"summary":"摘要","notes":[]}';
    finishAutomaticStep(state, job, job.steps[0]); expect(chapter.summary).toBe('摘要'); expect(chapter.memoryHash).toBe(contentHash(chapter.content));
    chapter.content += '改'; expect(() => finishAutomaticStep(state, job, job.steps[0])).toThrow('正文已更新');
  });
  it('写作风格迁移为可选 Skill，排队任务重启后暂停', () => {
    const { state, project, job } = setup(); state.styles = [{ id: 'old', name: '规则', content: '写作规则', source: '旧来源', createdAt: '' }]; project.styleId = 'old'; job.status = 'queued';
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.skills.find(s => s.id === 'legacy-style-old')).toMatchObject({ enabled: false, name: '规则' });
    expect(restored.projects[0].skillIds).toContain('legacy-style-old'); expect(restored.jobs[0].status).toBe('paused');
    expect(parseWorkspace(JSON.stringify(restored))).toEqual(restored);
  });
});
