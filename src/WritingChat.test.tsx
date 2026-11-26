import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createJob, emptyWorkspace, newChapter, newProject } from './domain';
import { prepareWriting } from './jobWorkflow';
import { Writing } from './pages/Writing';
import { WritingChat } from './WritingChat';
import { type Store } from './useWorkspace';

function setup() {
  const state = emptyWorkspace(), project = newProject('测试小说', 'long');
  project.chapters.push(newChapter('第二章')); state.projects.push(project);
  const job = createJob(project, 'draft', null, [project.chapters[0].id], '最近一次创作要求');
  prepareWriting(job); state.jobs.push(job);
  const store = { state, stateRef: { current: state }, polishingChapters: [], notify: vi.fn(), update: vi.fn() } as unknown as Store;
  return { project, job, store };
}

describe('writing chat entry and results', () => {
  it('shows only the current chapter requests and outputs', () => {
    const { project, job, store } = setup();
    job.status = 'ready'; job.steps.forEach(step => { step.status = 'ready'; step.output = '第一轮生成内容'; });
    const next = createJob(project, 'continue', null, [project.chapters[1].id], '第二轮创作要求');
    store.state.jobs.unshift(next);
    const html = renderToStaticMarkup(<MantineProvider><Writing project={project} store={store} onSettings={vi.fn()} /></MantineProvider>);
    expect(html).not.toContain('最近一次创作要求');
    expect(html).toContain('第二轮创作要求');
    expect(html).not.toContain('生成正文 · 第一章');
    expect(html).not.toContain('第一轮生成内容');
    expect(html.match(/aria-label="创作任务聊天记录"/g)).toHaveLength(1);
  });


  it('keeps multiple conversations within a chapter in chronological order', () => {
    const { project, job, store } = setup();
    const next = createJob(project, 'continue', null, [project.chapters[0].id], '同章后续要求');
    store.state.jobs.unshift(next);
    const html = renderToStaticMarkup(<MantineProvider><Writing project={project} store={store} onSettings={vi.fn()} /></MantineProvider>);
    expect(html.indexOf(job.instruction)).toBeLessThan(html.indexOf('同章后续要求'));
    expect(html).toContain(job.instruction);
  });

  it('shows an empty conversation for a chapter without tasks', () => {
    const { project, store } = setup();
    const html = renderToStaticMarkup(<MantineProvider><Writing project={project} store={store} focusChapterId={project.chapters[1].id} onSettings={vi.fn()} /></MantineProvider>);
    expect(html).toContain('暂无创作任务');
    expect(html).not.toContain('最近一次创作要求');
  });

  it('filters other chapter steps and results from batch conversations', () => {
    const { project, store } = setup();
    const job = createJob(project, 'draft', null, project.chapters.map(chapter => chapter.id), '批量要求'); prepareWriting(job);
    job.status = 'ready'; job.steps.forEach(step => { step.status = 'ready'; step.output = step.chapterId === project.chapters[0].id ? '第一章专属内容' : '第二章专属内容'; });
    const html = renderToStaticMarkup(<MantineProvider><WritingChat job={job} chapterId={project.chapters[1].id} project={project} store={store} onResult={vi.fn()} /></MantineProvider>);
    expect(html).toContain('批量要求');
    expect(html).toContain('生成正文 · 第二章');
    expect(html).toContain('查看生成稿');
    expect(html).not.toContain('第一章');
  });

  it('opens the most recent task conversation even when it belongs to an earlier chapter', () => {
    const { project, store } = setup();
    const html = renderToStaticMarkup(<MantineProvider><Writing project={project} store={store} onSettings={vi.fn()} /></MantineProvider>);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-label="创作任务聊天记录"');
    expect(html).toContain('最近一次创作要求');
    expect(html).not.toContain('aria-label="章节正文"');
    expect(html).not.toContain('暂无创作任务');
  });

  it('offers chapter links after all batch outputs finish', () => {
    const { project, store } = setup();
    const job = createJob(project, 'draft', null, project.chapters.map(chapter => chapter.id), ''); prepareWriting(job);
    job.status = 'ready'; job.steps.forEach(step => { step.status = 'ready'; step.output = '生成内容'; });
    const html = renderToStaticMarkup(<MantineProvider><WritingChat job={job} project={project} store={store} onResult={vi.fn()} /></MantineProvider>);
    expect(html).toContain('创作任务已完成');
    expect(html).toContain('查看第一章生成稿');
    expect(html).toContain('查看第二章生成稿');
  });

  it('shows recovery actions without a completion message for interrupted tasks', () => {
    const { project, job, store } = setup();
    job.status = 'paused'; job.steps[0].output = '未完成的细纲';
    const html = renderToStaticMarkup(<MantineProvider><WritingChat job={job} project={project} store={store} onResult={vi.fn()} /></MantineProvider>);
    expect(html).toContain('创作任务已停止');
    expect(html).toContain('继续生成');
    expect(html).toContain('重试当前步骤');
    expect(html).not.toContain('创作任务已完成');
    expect(html).not.toContain('查看生成稿');
  });
});
