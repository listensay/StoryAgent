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

const viewport = vi.hoisted(() => ({ desktop: true }));
vi.mock('@mantine/hooks', async importOriginal => ({
  ...await importOriginal<typeof import('@mantine/hooks')>(),
  useMediaQuery: (query: string) => query === '(min-width: 1050px)' && viewport.desktop,
}));

function setup() {
  const state = emptyWorkspace(), project = newProject('测试小说', 'long');
  project.chapters.push(newChapter('第二章')); state.projects.push(project);
  const job = createJob(project, 'draft', null, project.chapters[0].id, '最近一次创作要求');
  prepareWriting(job); state.jobs.push(job);
  const store = { state, stateRef: { current: state }, polishingChapters: [], notify: vi.fn(), update: vi.fn() } as unknown as Store;
  return { project, job, store };
}

function renderSkillActivity({ project, job, store }: ReturnType<typeof setup>, expanded: string[] = []) {
  // Set the open panels for SSR just as a user would by expanding the Skill and file controls.
  return renderToStaticMarkup(<MantineProvider theme={{ components: { Accordion: { defaultProps: { defaultValue: expanded } } } }}>
    <WritingChat job={job} chapterId={project.chapters[0].id} project={project} store={store} onResult={vi.fn()} />
  </MantineProvider>);
}

describe('writing chat Skill activity', () => {
  it('shows the selected Skills and lists only the files read in this step', () => {
    const context = setup(), { job, store } = context;
    const [first, second] = store.state.skills;
    const read = [{ path: 'SKILL.md', content: '细纲规则' }, { path: 'references/scenes.md', content: '场景参考' }];
    first.files = [...read, { path: 'references/search-hit.md', content: '只命中的候选内容' }];
    job.status = 'running'; job.steps[0].status = 'running';
    job.steps[0].execution = { summary: '', startedAt: job.createdAt, skills: [
      { id: first.id, name: first.name, version: first.version, files: read.map(file => file.path), contents: read },
      { id: second.id, name: second.name, version: second.version, files: [], contents: [] },
    ] };
    const html = renderSkillActivity(context, [`skill-${first.id}`, `skill-${second.id}`]);
    expect(html).toContain(`本步骤选用的 Skill · ${first.name}`);
    expect(html).toContain(`本步骤选用的 Skill · ${second.name}`);
    expect(html).toContain('已读 2 个文件');
    expect(html).toContain('>SKILL.md<');
    expect(html).toContain('>references/scenes.md<');
    expect(html).not.toContain('references/search-hit.md');
    expect(html).not.toContain('只命中的候选内容');
    expect(html).toContain('已读 0 个文件');
    expect(html).toContain('暂无已读文件');
  });

  it.each(['paused', 'failed'] as const)('keeps the saved read record after a %s task reloads', status => {
    const context = setup(), { job, store } = context;
    job.status = status;
    const file = { path: 'references/ending.md', content: '当时读取的结尾规则' };
    job.steps[0].execution = { summary: '', startedAt: job.createdAt, skills: [
      { id: 'ending', name: '结尾', version: '1.0', files: [file.path], contents: [file] },
    ] };
    store.state = parseWorkspace(JSON.stringify(store.state));
    const html = renderSkillActivity({ ...context, job: store.state.jobs[0] }, ['skill-ending', encodeURIComponent(file.path)]);
    expect(html).toContain(status === 'paused' ? '创作任务已停止' : '创作任务失败');
    expect(html).toContain('本步骤选用的 Skill · 结尾');
    expect(html).toContain('已读 1 个文件');
    expect(html).toContain('>references/ending.md<');
    expect(html).toContain(file.content);
  });

  it('shows only the recorded paths and matching revision for a legacy task without content snapshots', () => {
    const context = setup(), { job, store } = context;
    const skill = store.state.skills[0];
    skill.revisions.push({ version: 'old', savedAt: job.createdAt, files: [
      { path: 'SKILL.md', content: '历史版本的规则' }, { path: 'unused.md', content: '未读取的资料' },
    ] });
    skill.files = [{ path: 'SKILL.md', content: '新版本的规则' }];
    job.steps[0].execution = { summary: '', startedAt: job.createdAt, skills: [
      { id: skill.id, name: skill.name, version: 'old', files: ['SKILL.md'] },
    ] };
    const html = renderSkillActivity(context, [`skill-${skill.id}`, 'SKILL.md']);
    expect(html).toContain('>SKILL.md<');
    expect(html).toContain('历史版本的规则');
    expect(html).not.toContain('新版本的规则');
    expect(html).not.toContain('unused.md');
  });
});

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

  it('keeps the manuscript beside the most recent conversation on desktop', () => {
    const { project, store } = setup();
    const html = renderToStaticMarkup(<MantineProvider><Writing project={project} store={store} onSettings={vi.fn()} /></MantineProvider>);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-label="创作任务聊天记录"');
    expect(html).toContain('最近一次创作要求');
    expect(html).toContain('aria-label="章节正文"');
    expect(html).not.toContain('暂无创作任务');
  });

  it('restores the last edited chapter before choosing a recent conversation', () => {
    const { project, store } = setup();
    project.writingChapterId = project.chapters[1].id;
    project.chapters[1].content = '上次正在编辑的正文';
    const html = renderToStaticMarkup(<MantineProvider><Writing project={project} store={store} onSettings={vi.fn()} /></MantineProvider>);
    expect(html).toContain('上次正在编辑的正文');
    expect(html).toContain('暂无创作任务');
    expect(html).not.toContain('最近一次创作要求');
  });

  it('keeps the manuscript visible and collapses tools on compact windows', () => {
    const { project, job, store } = setup();
    viewport.desktop = false;
    try {
      const render = (focusJobId?: string) => renderToStaticMarkup(<MantineProvider><Writing project={project} store={store} focusJobId={focusJobId} onSettings={vi.fn()} /></MantineProvider>);
      const html = render();
      expect(html).toContain('aria-label="章节正文"');
      expect(html).not.toContain('aria-label="创作任务聊天记录"');
      expect(render(job.id)).toContain('aria-label="创作任务聊天记录"');
      expect(render(job.id)).toContain('aria-label="章节正文"');
    } finally { viewport.desktop = true; }
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
