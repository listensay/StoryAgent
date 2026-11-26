import { describe, expect, it } from 'vitest';
import { chapterWritingKinds, emptyWorkspace, newChapter, newProject, parseWorkspace } from './domain';
import { prepareWriting } from './jobWorkflow';
import { legacyWritingJob } from './testFixtures';

describe('旧多章节创作任务迁移', () => {
  it.each(chapterWritingKinds)('%s 按章节拆分，保留输出、步骤身份、聊天清空和列表状态', kind => {
    const state = emptyWorkspace(), project = newProject('迁移测试', 'long');
    project.chapters.push(newChapter('第二章')); state.projects = [project];
    const [first, second] = project.chapters;
    const job = legacyWritingJob(project, kind, null, [first.id, second.id], '原任务要求');
    prepareWriting(job); job.status = 'failed'; job.error = '第二章失败'; job.hiddenFromTaskList = true;
    job.clearedChatChapterIds = [first.id];
    job.steps.forEach(step => { step.output = step.chapterId === first.id ? '第一章结果' : '第二章部分结果'; step.status = step.chapterId === first.id ? 'accepted' : 'pending'; });
    state.jobs = [job];
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.jobs).toHaveLength(2);
    expect(new Set(restored.jobs.map(value => value.id)).size).toBe(2);
    expect(restored.jobs[0]).toMatchObject({ id: job.id, status: 'accepted', error: '', clearedChatChapterIds: [first.id], hiddenFromTaskList: true });
    expect(restored.jobs[1]).toMatchObject({ status: 'failed', error: job.error, clearedChatChapterIds: [], hiddenFromTaskList: true });
    expect(restored.jobs[0].steps).toEqual(job.steps.filter(step => step.chapterId === first.id));
    expect(restored.jobs[1].steps).toEqual(job.steps.filter(step => step.chapterId === second.id));
    expect(parseWorkspace(JSON.stringify(restored))).toEqual(restored);
    expect(restored.projects).toEqual(state.projects);
  });
  it('已完成章节保持待确认，运行中的章节恢复为停止且保留部分结果', () => {
    const state = emptyWorkspace(), project = newProject('恢复测试', 'long');
    project.chapters.push(newChapter('第二章')); state.projects = [project];
    const job = legacyWritingJob(project, 'draft', null, project.chapters.map(chapter => chapter.id), '');
    prepareWriting(job); job.status = 'running';
    job.steps.forEach(step => { step.status = step.chapterId === project.chapters[0].id ? 'ready' : 'running'; step.output = '已有结果'; });
    state.jobs = [job];
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.jobs.map(value => value.status)).toEqual(['ready', 'paused']);
    expect(restored.jobs[1].steps.every(step => step.status === 'pending' && step.output === '已有结果')).toBe(true);
  });
});
