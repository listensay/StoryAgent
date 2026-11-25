import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject } from './domain';
import { acceptWriting, prepareWriting, proposedContent, writingStep } from './jobWorkflow';
import { buildPrompt } from './prompts';
import { hasTextSelection, selectionPolishTask } from './selectionPolish';

function setup() {
  const state = emptyWorkspace(), project = newProject('夜归', 'long');
  state.projects.push(project);
  const chapter = project.chapters[0];
  chapter.content = '雨停了。\n她走得很快。\n门还开着。';
  const selected = { start: 5, end: 11, content: chapter.content };
  const task = selectionPolishTask(project.id, chapter, selected);
  const ai = { ...newAISelection(), ...defaultAdvanced() };
  const job = createJob(project, task.kind, ai, task.chapterIds, task.instruction, '', '', task.selection);
  prepareWriting(job);
  return { state, project, chapter, selected, task, ai, job };
}

describe('正文选区润色', () => {
  it('只润色选中的短句，提供前后文且不继承整章字数', () => {
    const { state, job, ai, task } = setup();
    expect(task).not.toHaveProperty('targetWords');
    expect(job.steps[0].selection).toBe('她走得很快。');
    const prompt = buildPrompt(state, job, job.steps[0], ai);
    expect(prompt.user).toContain('润色选中的正文片段');
    expect(prompt.user).toContain('雨停了。');
    expect(prompt.user).toContain('门还开着。');
    expect(prompt.user).toContain('指定改写片段：\n她走得很快。');
    expect(prompt.user).not.toContain('正文目标篇幅');
  });

  it('采用时仅替换选区并保存原文，摘要记忆使用合并后的正文', () => {
    const { state, project, chapter, job } = setup();
    const original = chapter.content;
    job.steps[0].output = '她加快了脚步。';
    const expected = '雨停了。\n她加快了脚步。\n门还开着。';
    expect(proposedContent(job, job.steps[0])).toBe(expected);
    expect(writingStep(job, job.steps[1]).baseContent).toBe(expected);
    expect(writingStep(job, job.steps[2]).baseContent).toBe(expected);
    job.steps[1].output = '雨后归家';
    job.steps[2].output = '{"summary":"雨后归家","notes":[]}';
    job.steps.forEach(step => { step.status = 'ready'; });
    acceptWriting(state, job, job.steps[0]);
    expect(project.chapters[0].content).toBe(expected);
    expect(project.chapters[0].versions[0].content).toBe(original);
  });

  it('拒绝过期选区及生成期间修改过的正文', () => {
    const { state, project, chapter, selected, job } = setup();
    chapter.content += '新的结尾。';
    expect(() => selectionPolishTask(project.id, chapter, selected)).toThrow('正文已更新');
    expect(() => selectionPolishTask(project.id, undefined, selected)).toThrow('章节已移除');
    job.steps.forEach(step => { step.status = 'ready'; step.output = step.stage === 'memory' ? '{"summary":"","notes":[]}' : '润色结果'; });
    expect(() => acceptWriting(state, job, job.steps[0])).toThrow('正文已更新');
    expect(chapter.content).toContain('新的结尾。');
  });

  it.each([{ start: 0, end: 0 }, { start: 2, end: 1 }, { start: -1, end: 2 }, { start: 0, end: 100 }, { start: 0.5, end: 2 }, { start: 0, end: 2 }])('不接受空白或无效选区 %j', range => {
    expect(hasTextSelection(' \n正文', range)).toBe(false);
  });

  it('保留跨段落与 Unicode 选区的精确边界', () => {
    const { project, chapter } = setup();
    chapter.content = '开头🌧雨落。\n她停住。结尾';
    const start = chapter.content.indexOf('🌧'), end = chapter.content.indexOf('结尾');
    const task = selectionPolishTask(project.id, chapter, { start, end, content: chapter.content });
    const job = createJob(project, task.kind, null, task.chapterIds, task.instruction, '', '', task.selection);
    job.steps[0].output = '雨落在她肩上。';
    expect(proposedContent(job, job.steps[0])).toBe('开头雨落在她肩上。结尾');
  });
});
