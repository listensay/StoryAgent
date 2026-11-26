import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject, parseWorkspace } from './domain';
import { acceptPreparation, parsePreparation, preparationSnapshot } from './jobWorkflow';
import { buildPrompt, numberedText, prepareAnalysis, synthesisInputs, synthesisSteps } from './prompts';
import { runJobSteps } from './stepQueue';

const config = { ...newAISelection(), ...defaultAdvanced() };
function setup(sourceText: string) {
  const state = emptyWorkspace(), project = newProject('原创小说', 'long');
  project.genre = '悬疑'; project.theme = '保留作者主题'; project.targetWords = 300000;
  project.notes = [{ id: 'author-note', kind: 'character', title: '作者人物', body: '保留作者设定', status: 'planned', chapterId: '' }];
  state.projects.push(project);
  const job = createJob(project, 'prepare', config, undefined, '保留作者约束');
  job.sourceText = sourceText; job.sourceTitle = '参考小说'; job.preparationBase = preparationSnapshot(project);
  state.jobs.push(job);
  return { state, project, job };
}
const result = JSON.stringify({ theme: '参考主题', audience: '悬疑读者', synopsis: '独立故事简介', outline: '原创总纲', notes: [{ kind: 'world', title: '世界设定', body: '新设定' }] });

describe('创作准备的长参考资料', () => {
  it('完整处理约两百万字符的参考资料，逐层提炼后仅补全缺失设定', async () => {
    const paragraphs = Array.from({ length: 2000 }, (_, i) => `资料段落${i}：${'人物面对冲突与选择。'.repeat(100)}`);
    const { state, project, job } = setup(paragraphs.join('\n\n'));
    expect(job.sourceText.length).toBeGreaterThan(1957476);
    expect(() => buildPrompt(state, job, job.steps[0], config)).toThrow('超过上下文');
    prepareAnalysis(job, config);
    const parts = job.steps.filter(s => s.intermediate);
    expect(parts.map(s => s.section).join('\n\n')).toBe(numberedText(job.sourceText));
    let requests = 0, merges = 0;
    const seen = new Set<string>();
    await runJobSteps(() => job, () => 2, new AbortController().signal, async id => {
      const step = job.steps.find(s => s.id === id)!;
      const synthesis = synthesisSteps(job, step, config);
      if (synthesis.length) { job.steps.splice(job.steps.indexOf(step), 1, ...synthesis); return; }
      const prompt = buildPrompt(state, job, step, config);
      expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(config.contextChars);
      expect(prompt.user).toContain('保留作者约束');
      if (step.aggregate) {
        for (const input of synthesisInputs(job, step)) { expect(prompt.user).toContain(input.output); seen.add(input.id); }
      }
      if (step.intermediate) {
        expect(prompt.user).toContain('只输出参考要点');
        expect(prompt.user).not.toContain('只输出 JSON');
        if (step.aggregate) merges++;
        step.output = `参考要点${requests}：${'通用叙事方法。'.repeat(100)}`;
      } else {
        expect(prompt.user).toContain('只输出 JSON');
        expect(prompt.user).toContain('保留作者主题');
        expect(prompt.user).toContain('保留作者设定');
        expect(prompt.user).toContain('300000');
        step.output = result;
        expect(parsePreparation(step.output).outline).toBe('原创总纲');
      }
      step.status = 'ready'; requests++;
    });
    expect(merges).toBeGreaterThan(0);
    expect(parts.every(s => seen.has(s.id))).toBe(true);
    expect(job.steps.every(s => s.status === 'ready')).toBe(true);
    acceptPreparation(state, job, job.steps[job.steps.length - 1]);
    expect(project).toMatchObject({ title: '原创小说', genre: '悬疑', theme: '保留作者主题', targetWords: 300000, synopsis: '独立故事简介', outline: '原创总纲' });
    expect(project.notes.map(n => n.title)).toEqual(['作者人物', '世界设定']);
  });

  it('旧失败任务可补充分段，重启后保留已完成结果与汇总依赖', () => {
    const { state, job } = setup('参考资料。'.repeat(20000));
    job.status = 'failed'; job.error = '任务材料超过上下文上限';
    const restored = parseWorkspace(JSON.stringify(state)).jobs[0];
    prepareAnalysis(restored, config);
    expect(restored.steps.length).toBeGreaterThan(1);
    restored.steps[0].status = 'ready'; restored.steps[0].output = '已完成的参考要点';
    const saved = structuredClone(restored.steps);
    prepareAnalysis(restored, config);
    expect(restored.steps).toEqual(saved);
    expect(restored.steps[restored.steps.length - 1].id).toBe(job.steps[0].id);
  });

  it.each(['', '简短参考资料'])('小范围参考仍直接生成最终设定：%s', source => {
    const { state, job } = setup(source);
    prepareAnalysis(job, config);
    expect(job.steps).toHaveLength(1);
    expect(job.steps[0]).toMatchObject({ intermediate: false, aggregate: false });
    const prompt = buildPrompt(state, job, job.steps[0], config);
    expect(prompt.user).toContain('只输出 JSON');
    expect(prompt.user).toContain('保留作者设定');
    if (source) expect(prompt.user).toContain(source);
  });
});
