import { legacyWritingJob } from './testFixtures';
import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newChapter, newProject, parseWorkspace } from './domain';
import { prepareWriting } from './jobWorkflow';
import { Writing } from './pages/Writing';
import { WritingChat } from './WritingChat';
import { clearWritingChat } from './writingActivity';
import { type Store } from './useWorkspace';

function setup() {
  const state = emptyWorkspace(), project = newProject('测试小说', 'long');
  project.chapters.push(newChapter('第二章')); state.projects.push(project);
  const job = createJob(project, 'draft', null, project.chapters[0].id, '最近一次创作要求');
  prepareWriting(job); state.jobs.push(job);
  const store = { state, stateRef: { current: state }, polishingChapters: [], notify: vi.fn(), update: vi.fn() } as unknown as Store;
  return { project, job, store };
}

describe('writing chat entry and results', () => {
  it('shows the saved reasoning effort in the composer without a task settings drawer', () => {
    const { project, store } = setup();
    store.state.providers.push({ id: 'qa', name: 'QA', protocol: 'chat', models: ['model'], enabled: true, hasKey: true, baseUrl: 'https://example.test', maxRetries: 0, advanced: defaultAdvanced() });
    store.state.aiSelection = { providerId: 'qa', model: 'model', effort: 'high' };
    const html = renderToStaticMarkup(<MantineProvider><Writing project={project} store={store} onSettings={vi.fn()} /></MantineProvider>);
    const composer = html.slice(html.indexOf('writing-chat-composer'));
    expect(composer).toMatch(/<input[^>]*aria-label="推理强度"[^>]*value="高"/);
    expect(composer).not.toContain('aria-label="章节范围"');
    expect(composer).toContain(project.chapters[0].title);
    expect(composer).toContain('aria-label="目标字数"');
    expect(html).not.toContain('任务设置');
  });

  it('clears only selected inactive conversations in one chapter and retains their results after reload', () => {
    const { project, job, store } = setup();
    const [first, second] = project.chapters;
    const batch = legacyWritingJob(project, 'review', null, [first.id, second.id], '两章共有的要求');
    batch.status = 'ready'; batch.steps.forEach(step => { step.output = '保留的审稿意见'; step.status = 'ready'; });
    store.state.jobs.push(batch);
    clearWritingChat(store.state.jobs, first.id, [batch.id, job.id]);
    store.state = parseWorkspace(JSON.stringify(store.state));
    const render = (chapterId: string, focusJobId?: string) => renderToStaticMarkup(<MantineProvider><Writing project={project} store={store} focusChapterId={chapterId} focusJobId={focusJobId} onSettings={vi.fn()} /></MantineProvider>);
    expect(render(first.id)).not.toContain(batch.instruction);
    expect(render(first.id)).toContain(job.instruction);
    expect(render(second.id)).toContain(batch.instruction);
    expect(render(first.id, batch.id)).toContain('生成稿内容');
    expect(render(first.id, batch.id)).toContain('aria-label="选择生成稿"');
    expect(render(first.id, batch.id)).toContain('保留的审稿意见');
    const next = createJob(project, 'continue', null, first.id, '清空后的新任务');
    store.state.jobs.unshift(next);
    expect(render(first.id)).toContain(next.instruction);
  });
  it('shows only the current chapter requests and outputs', () => {
    const { project, job, store } = setup();
    job.status = 'ready'; job.steps.forEach(step => { step.status = 'ready'; step.output = '第一轮生成内容'; });
    const next = createJob(project, 'continue', null, project.chapters[1].id, '第二轮创作要求');
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
    const next = createJob(project, 'continue', null, project.chapters[0].id, '同章后续要求');
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
    const job = legacyWritingJob(project, 'draft', null, project.chapters.map(chapter => chapter.id), '批量要求'); prepareWriting(job);
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

  it('offers the current chapter result after all its outputs finish', () => {
    const { project, store } = setup();
    const job = legacyWritingJob(project, 'draft', null, project.chapters.map(chapter => chapter.id), ''); prepareWriting(job);
    job.status = 'ready'; job.steps.forEach(step => { step.status = 'ready'; step.output = '生成内容'; });
    const html = renderToStaticMarkup(<MantineProvider><WritingChat job={job} chapterId={project.chapters[0].id} project={project} store={store} onResult={vi.fn()} /></MantineProvider>);
    expect(html).toContain('创作任务已完成');
    expect(html).toContain('查看生成稿');
    expect(html).not.toContain('第二章');
  });

  it('shows recovery actions without a completion message for interrupted tasks', () => {
    const { project, job, store } = setup();
    job.status = 'paused'; job.steps[0].output = '未完成的细纲';
    const html = renderToStaticMarkup(<MantineProvider><WritingChat job={job} chapterId={project.chapters[0].id} project={project} store={store} onResult={vi.fn()} /></MantineProvider>);
    expect(html).toContain('创作任务已停止');
    expect(html).toContain('继续生成');
    expect(html).toContain('重试当前步骤');
    expect(html).not.toContain('创作任务已完成');
    expect(html).not.toContain('查看生成稿');
  });
});
