import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject, parseWorkspace } from './domain';
import { acceptPlanning, hasPlanningChanges, parsePlanningResult, planningSnapshot } from './planning';
import { buildPrompt } from './prompts';

const ai = { ...newAISelection(), ...defaultAdvanced() };
function setup() {
  const state = emptyWorkspace(), project = newProject('测试', 'long'); project.genre = '悬疑'; project.outline = '旧总纲';
  project.notes = [{ id: 'volume', kind: 'volume', title: '第一卷', body: '调查', chapterId: '', status: 'planned' }, { id: 'person', kind: 'character', title: '林舟', body: '调查员', chapterId: '', status: 'confirmed' }];
  state.projects.push(project);
  const job = createJob(project, 'plan', ai, [], '强化第一卷悬念'); job.planningChat = { base: planningSnapshot(project), previousJobIds: [] }; state.jobs.unshift(job);
  return { state, project, job, step: job.steps[0] };
}
describe('故事规划对话', () => {
  it('保存多轮对话，并把当前规划和前轮修改传给后续请求', () => {
    const { state, project, job } = setup(); job.status = 'ready'; job.steps[0].output = '{"reply":"先保留失踪线索"}';
    const next = createJob(project, 'plan', ai, [], '将冲突延后'); next.planningChat = { base: planningSnapshot(project), previousJobIds: [job.id] }; state.jobs.unshift(next);
    const restored = parseWorkspace(JSON.stringify(state)); expect(restored.jobs[0].planningChat).toEqual(next.planningChat);
    const prompt = buildPrompt(restored, next, next.steps[0], ai);
    expect(prompt.user).toContain('先保留失踪线索'); expect(prompt.user).toContain('强化第一卷悬念'); expect(prompt.user).toContain('将冲突延后'); expect(prompt.user).toContain('"id":"volume"');
    expect(hasPlanningChanges(parsePlanningResult(job.steps[0].output))).toBe(false);
  });
  it('原子采用总纲、卷纲与章节计划，保留未改的设定和正文', () => {
    const { state, project, job, step } = setup(); const chapter = project.chapters[0]; chapter.content = '原正文';
    step.output = JSON.stringify({ reply: '调整开篇冲突', outline: '新总纲', notes: [{ id: 'volume', kind: 'volume', title: '失踪案', body: '新卷纲' }, { kind: 'scene', title: '追踪', body: '寻找证人' }], chapters: [{ id: chapter.id, plan: '新章节计划' }] });
    acceptPlanning(state, job, step);
    expect(project.outline).toBe('新总纲'); expect(project.notes[0]).toMatchObject({ id: 'volume', body: '新卷纲' });
    expect(project.notes[1]).toMatchObject({ id: 'person', body: '调查员' }); expect(project.notes).toHaveLength(3);
    expect(chapter).toMatchObject({ content: '原正文', plan: '新章节计划' });
    expect(() => acceptPlanning(state, job, step)).toThrow('已更新');
  });
  it('拒绝过期、重复和不存在的计划引用，不留下部分修改', () => {
    const { state, project, job, step } = setup();
    step.output = JSON.stringify({ reply: '调整', outline: '不能写入', chapters: [{ id: 'missing', plan: '新计划' }] });
    expect(() => acceptPlanning(state, job, step)).toThrow('章节已移除'); expect(project.outline).toBe('旧总纲');
    step.output = JSON.stringify({ reply: '调整', notes: [{ id: 'person', kind: 'volume', title: '第一卷', body: '新计划' }] });
    expect(() => acceptPlanning(state, job, step)).toThrow('记录已变更');
    const note = { id: 'volume', kind: 'volume', title: '第一卷', body: '新计划' };
    step.output = JSON.stringify({ reply: '调整', notes: [note, note] }); expect(() => acceptPlanning(state, job, step)).toThrow('重复');
    project.chapters[0].plan = '手动修改'; expect(() => acceptPlanning(state, job, step)).toThrow('已更新');
  });
  it('超出上下文时保留原要求并拒绝请求，不静默截断规划或历史', () => {
    const { state, project, job, step } = setup(); project.outline = '完整故事规划'.repeat(1000);
    expect(() => buildPrompt(state, job, step, { ...ai, contextChars: 4000 })).toThrow('上下文');
    expect(() => parsePlanningResult('{"reply":""}')).toThrow();
  });
});
