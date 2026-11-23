import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createJob, emptyWorkspace, type Skill, type Workspace } from './domain';
import { Training } from './pages/Training';
import { parseSkills } from './skills';
import type { Store } from './useWorkspace';

const makeSkill = (name: string) => parseSkills([{ path: 'SKILL.md', content: `---\nname: ${name}\ndescription: ${name}的写作规则\n---\n用具体行动表现人物目标。` }], '文件导入')[0];
function history(state: Workspace, skill: Skill, text: string) {
  const job = createJob(undefined, 'train', null, [], '');
  job.sourceTitle = skill.name; job.status = 'accepted';
  job.training = { skillId: skill.id, initialSkill: skill.files[0].content, bestSkill: skill.files[0].content, bestScore: -1, targetScore: 8.5, judge: 'human', mode: 'chapter', original: '原文章节', cases: [{ title: text, brief: text, original: '' }], evaluations: [] };
  job.steps[0] = { ...job.steps[0], stage: 'train-write', round: 1, caseIndex: 0, status: 'accepted', output: text };
  state.jobs.push(job);
  return job;
}
function render(state: Workspace, focusJobId?: string) {
  const store = { state, notify: vi.fn(), update: vi.fn() } as unknown as Store;
  return renderToStaticMarkup(<MantineProvider><Training store={store} onSettings={vi.fn()} focusJobId={focusJobId} /></MantineProvider>);
}

describe('Skill 训练营导航', () => {
  it('同时列出提炼、文件导入和 GitHub Skill，包括未启用的 Skill', () => {
    const state = emptyWorkspace(), extracted = makeSkill('提炼对白'), imported = makeSkill('动作描写'), github = makeSkill('悬念设计');
    extracted.originReferenceId = 'reference'; imported.enabled = false; github.source = 'https://github.com/example/skills';
    state.skills.push(extracted, imported, github);
    const html = render(state);
    for (const skill of [extracted, imported, github]) expect(html).toContain(`aria-label="训练 ${skill.name}"`);
    for (const source of ['小说提炼', '文件导入', 'GitHub']) expect(html).toContain(source);
    expect(html).not.toContain('开始章节训练'); expect(html).not.toContain('训练方式');
  });
  it('只有一个 Skill 时仍先显示列表，内置 Skill 不作为可训练项', () => {
    const state = emptyWorkspace(), skill = makeSkill('对白'); state.skills.push(skill);
    const html = render(state);
    expect(html).toContain(`aria-label="训练 ${skill.name}"`); expect(html).not.toContain('返回 Skill 列表');
    expect(html).not.toContain('aria-label="训练 小说 AI"');
  });
  it('任务入口直达对应 Skill，仅展示该 Skill 的训练记录并保留训练方式选择', () => {
    const state = emptyWorkspace(), first = makeSkill('对白'), second = makeSkill('动作'); state.skills.push(first, second);
    history(state, first, '对白历史生成稿'); const focused = history(state, second, '动作历史生成稿');
    const html = render(state, focused.id);
    expect(html).toContain('返回 Skill 列表'); expect(html).toContain('动作历史生成稿'); expect(html).not.toContain('对白历史生成稿');
    expect(html).toContain('训练方式'); expect(html).toContain('placeholder="选择训练方式"'); expect(html).not.toContain('开始章节训练');
  });
  it('无 Skill 或聚焦的 Skill 已删除时显示可用列表或空状态', () => {
    const state = emptyWorkspace(); expect(render(state)).toContain('暂无可训练的 Skill');
    const removed = makeSkill('已删除'), job = history(state, removed, '已删除的生成稿');
    expect(render(state, job.id)).toContain('暂无可训练的 Skill');
    const remaining = makeSkill('可用'); state.skills.push(remaining);
    const html = render(state, job.id);
    expect(html).toContain(`aria-label="训练 ${remaining.name}"`); expect(html).not.toContain('已删除的生成稿');
  });
});
