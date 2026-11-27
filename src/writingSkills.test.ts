import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject } from './domain';
import { buildPrompt, prepareAnalysis, synthesisSteps } from './prompts';
import { parseSkills } from './skills';

function setup() {
  const state = emptyWorkspace(), project = newProject('喜剧小说', 'long');
  const config = { ...newAISelection(), ...defaultAdvanced(), contextChars: 64000 };
  project.genre = '轻松喜剧'; project.chapters[0].plan = '本章已有事件与人物关系。'; state.projects.push(project);
  const definition = '---\nname: comic-dialogue\ndescription: 对话与喜剧节拍\n---\n' + '场景要求与适用边界。\n\n'.repeat(640) + '\n## 关键对白规则\n用身份反差和言行错位完成笑点，不替读者解释。';
  const skill = parseSkills([{ path: 'SKILL.md', content: definition }], '小说提炼')[0];
  skill.originReferenceId = 'original'; skill.tasks = ['draft', 'continue', 'rewrite', 'plan']; state.skills.push(skill); project.skillIds = [skill.id];
  const job = createJob(project, 'draft', config, project.chapters[0].id, '保持本章事件'); job.skillIds = [...project.skillIds];
  return { state, project, config, skill, definition, job };
}

describe('author-selected writing skills', () => {
  it('advertises only metadata for both author-selected and automatically enabled skills', () => {
    const { state, config, definition, skill, job } = setup();
    const general = { ...state.skills[1], id: 'general', name: '自动文风', tasks: ['draft' as const], files: [{ path: 'SKILL.md', content: '自动规则正文不应出现在首轮。' }] };
    state.skills.push(general);
    const prompt = buildPrompt(state, job, job.steps[0], config);
    expect(prompt.system).toContain(JSON.stringify({ id: skill.id, name: skill.name, description: skill.description, source: '作者选用' }));
    expect(prompt.system).toContain(JSON.stringify({ id: general.id, name: general.name, description: general.description, source: '自动候选' }));
    expect(prompt.system + prompt.user).not.toContain(definition);
    expect(prompt.system + prompt.user).not.toContain(general.files[0].content);
    expect(prompt.toolSkills).toContain(skill); expect(prompt.toolSkills).toContain(general);
    expect(prompt.user).toContain('本章已有事件与人物关系。');
  });

  it('keeps linked resources in the tool host, not the prompt', () => {
    const { state, config, skill, job } = setup();
    skill.files[0].content += '\n参考 [对白](references/dialogue.md)。';
    const content = '人物语言规则。'.repeat(700) + '末尾的关键反例';
    skill.files.push({ path: 'references/dialogue.md', content });
    const prompt = buildPrompt(state, job, job.steps[0], config);
    expect(prompt.system).not.toContain(skill.files[0].content);
    expect(prompt.system + prompt.user).not.toContain('references/dialogue.md');
    expect(prompt.toolSkills.find(item => item.id === skill.id)?.files[1].content).toBe(content);
  });

  it('does not budget the whole entry into the first request', () => {
    const { state, config, skill, job } = setup();
    const prompt = buildPrompt(state, job, job.steps[0], { ...config, contextChars: 4000 });
    expect(prompt.toolSkills).toContain(skill);
    expect(prompt.system + prompt.user).not.toContain('关键对白规则');
  });

  it('respects task selection snapshots and does not leak writing style into memory', () => {
    const { state, project, config, skill, job } = setup();
    job.skillIds = []; expect(buildPrompt(state, job, job.steps[0], config).toolSkills).not.toContain(skill);
    job.skillIds = project.skillIds;
    expect(buildPrompt(state, { ...job, kind: 'memory' }, job.steps[0], config).toolSkills).not.toContain(skill);
  });

  it('honors explicitly selected disabled skills without mixing other novels’ extracted styles', () => {
    const { state, config, skill, job } = setup(); skill.enabled = false;
    state.skills.push({ ...skill, id: 'another-book', enabled: true });
    const prompt = buildPrompt(state, job, job.steps[0], config);
    expect(prompt.system).toContain(skill.id); expect(prompt.system).not.toContain('another-book');
  });

  it('keeps distinct style evidence through every synthesis layer', () => {
    const { config } = setup(), state = emptyWorkspace(); config.contextChars = 6000;
    const job = createJob(undefined, 'style', config, undefined, '');
    job.sourceText = '原文场景。'.repeat(1800); prepareAnalysis(job, config);
    const parts = job.steps.filter(step => step.intermediate);
    parts.forEach((step, index) => { step.status = 'ready'; step.output = `特色证据${index}：` + '幽默来自公开理由与实际行为的错位。'.repeat(50) + `[P${index + 1}]末尾证据`; });
    const seen = new Set<string>();
    for (let round = 0; round < 20; round++) {
      const step = job.steps.find(step => step.status === 'pending'); if (!step) break;
      const extra = synthesisSteps(job, step, config);
      if (extra.length) { job.steps.splice(job.steps.indexOf(step), 1, ...extra); continue; }
      const prompt = buildPrompt(state, job, step, config);
      for (const part of parts) if (prompt.user.includes(part.output)) seen.add(part.id);
      expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(config.contextChars);
      step.output = '汇总保留文风证据'; step.status = 'ready';
    }
    expect(seen.size).toBe(parts.length); expect(job.steps[job.steps.length - 1]?.status).toBe('ready');
  });
});
