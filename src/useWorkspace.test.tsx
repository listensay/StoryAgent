import type { Dispatch, SetStateAction } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chapterWritingKinds, createJob, defaultAdvanced, emptyWorkspace, newChapter, newProject, type Workspace } from './domain';
import { contentHash } from './jobWorkflow';
import { generate } from './ai';
import { loadWorkspace, saveWorkspace } from './platform';
import { useWorkspace, type Store } from './useWorkspace';

const harness = vi.hoisted(() => ({ workspace: undefined as Workspace | undefined, effects: [] as (() => void | (() => void))[], updates: [] as unknown[] }));
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    // Render the real hook with a loaded workspace; capture its effects without a DOM.
    useState: <T,>(initial: T | (() => T)) => {
      const seed = typeof initial === 'function' && initial.name === 'emptyWorkspace' ? harness.workspace as T : initial === false ? true as T : initial;
      const [value, setValue] = react.useState(seed);
      const track: Dispatch<SetStateAction<T>> = next => { harness.updates.push(next); setValue(next); };
      return [value, track];
    },
    useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); },
  };
});
vi.mock('./platform', async importOriginal => ({ ...await importOriginal<typeof import('./platform')>(), loadWorkspace: vi.fn(), saveWorkspace: vi.fn() }));
vi.mock('./ai', () => ({ generate: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: vi.fn().mockResolvedValue(() => {}), onFocusChanged: vi.fn().mockResolvedValue(() => {}) }) }));

let store: Store;
let cleanups: (() => void)[];
function Probe() { store = useWorkspace(); return null; }
function mount() { renderToStaticMarkup(<Probe />); return store; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); harness.effects = []; harness.updates = []; cleanups = [];
  const state = emptyWorkspace(), project = newProject('保存测试', 'long');
  project.chapters[0].content = '林舟推开房门。'; project.chapters.push({ ...newChapter('第二章'), content: '门外落着雨。' });
  state.projects = [project]; state.activeProjectId = project.id;
  state.providers = [{ id: 'test', name: '测试服务', protocol: 'chat', baseUrl: 'http://localhost:9999/v1', hasKey: true, models: ['test-model'], enabled: true, maxRetries: 0, advanced: defaultAdvanced() }];
  state.aiSelection.providerId = 'test'; state.aiSelection.model = 'test-model';
  harness.workspace = state;
  vi.mocked(loadWorkspace).mockResolvedValue(state); vi.mocked(saveWorkspace).mockResolvedValue();
});
afterEach(() => { cleanups.forEach(cleanup => cleanup()); vi.useRealTimers(); });

describe('当前章节任务与列表清空', () => {
  it.each(chapterWritingKinds)('%s 只为选中的当前章节生成步骤', kind => {
    mount(); const project = store.stateRef.current.projects[0]; project.genre = '悬疑';
    const chapter = project.chapters[1];
    const id = store.launch({ kind, projectId: project.id, chapterId: chapter.id, instruction: '测试要求' });
    const job = store.stateRef.current.jobs.find(value => value.id === id)!;
    expect(job.status).toBe('queued');
    expect(job.steps.every(step => step.chapterId === chapter.id)).toBe(true);
    expect(store.stateRef.current.projects[0].chapters).toEqual(project.chapters);
  });
  it('推理后立刻到达的首段正文无需等待下一个分片，完成后不会被延迟刷新覆盖', async () => {
    mount();
    const project = store.stateRef.current.projects[0], chapter = project.chapters[1];
    project.genre = '悬疑'; chapter.plan = '推门';
    let finish!: (text: string) => void;
    vi.mocked(generate).mockImplementationOnce(async (_provider, _config, _system, _user, _signal, onText, onReasoning, timeout) => {
      expect(timeout).toBe(120_000);
      onReasoning?.('分析'); onText('门开了。');
      return new Promise(resolve => { finish = resolve; });
    }).mockResolvedValueOnce('本章摘要').mockResolvedValueOnce('{"summary":"摘要","notes":[]}');
    const id = store.launch({ kind: 'draft', projectId: project.id, chapterId: chapter.id });
    const job = () => store.stateRef.current.jobs.find(item => item.id === id)!;
    vi.mocked(loadWorkspace).mockResolvedValue(store.stateRef.current);
    for (const effect of harness.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); await Promise.resolve(); }
    await vi.advanceTimersByTimeAsync(80);
    expect(job().steps[0]).toMatchObject({ status: 'running', output: '门开了。', reasoning: '分析' });
    finish('门开了。风吹进来。');
    await vi.advanceTimersByTimeAsync(200);
    expect(job().status).toBe('ready');
    expect(job().steps[0]).toMatchObject({ output: '门开了。风吹进来。', status: 'ready' });
    expect(job().steps.every(step => step.chapterId === chapter.id)).toBe(true);
  });
  it('改写首轮只发送 Skill 元数据；执行记录只保存实际读取的文件', async () => {
    mount(); const state = store.stateRef.current, project = state.projects[0], chapter = project.chapters[1];
    project.genre = '修仙'; const skill = { ...state.skills[0], id: 'voice', tasks: ['rewrite' as const], resourceMode: 'relevant' as const, files: [{ path: 'SKILL.md', content: '保留人物言行反差。' }, { path: 'references/a.md', content: '对白：他划了两下屏幕。' }, { path: 'references/b.md', content: '对白：未读取的候选。' }] };
    state.skills.push(skill); project.skillIds = [skill.id];
    vi.mocked(generate).mockImplementationOnce(async (_p, _c, system, user, _s, _out, _thinking, _timeout, tools) => {
      expect(system).toContain(skill.id); expect(user).toContain(chapter.content);
      expect(system + user).not.toContain(skill.files[0].content); expect(system + user).not.toContain('未读取的候选');
      expect(record()).toBeUndefined();
      expect(tools!.pendingRequired?.()).toContain(skill.name);
      tools!.execute('activate_skill', { skill: skill.id }, 2000);
      expect(tools!.pendingRequired?.()).toEqual([]);
      const summary = tools!.execute('search_skill_files', { skill: skill.id, query: '对白' }, 2000);
      expect(summary).toContain('references/b.md');
      expect(record().files).toEqual(['SKILL.md']);
      tools!.execute('read_skill_file', { skill: skill.id, path: 'references/a.md' }, 2000);
      expect(record().files).toEqual(['SKILL.md', 'references/a.md']);
      throw new Error('模拟断线');
    });
    const id = store.launch({ kind: 'rewrite', projectId: project.id, chapterId: chapter.id });
    const job = () => store.stateRef.current.jobs.find(item => item.id === id)!;
    const record = () => job().steps[0].execution!.skills.find(item => item.id === skill.id)!;
    vi.mocked(loadWorkspace).mockResolvedValue(store.stateRef.current);
    for (const effect of harness.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); await Promise.resolve(); }
    await vi.advanceTimersByTimeAsync(100);
    expect(generate).toHaveBeenCalledTimes(1); expect(job().error).toBe('模拟断线');
    expect(record().contents).toEqual(skill.files.slice(0, 2));
  });
  it('改写缺少正文时不空发请求', () => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[1];
    project.genre = '修仙'; chapter.content = '  ';
    expect(() => store.launch({ kind: 'rewrite', projectId: project.id, chapterId: chapter.id })).toThrow('暂无可改写的正文');
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(chapterWritingKinds)('%s 缺少或移除当前章节时不创建任务', kind => {
    mount(); const project = store.stateRef.current.projects[0]; project.genre = '悬疑';
    expect(() => store.launch({ kind, projectId: project.id })).toThrow('当前章节');
    expect(() => store.launch({ kind, projectId: project.id, chapterId: 'missing' })).toThrow('章节已移除');
    expect(store.stateRef.current.jobs).toEqual([]);
  });
  it('恢复隐藏的失败任务时重新显示，仅恢复它所属的章节', () => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[1]; project.genre = '悬疑';
    const id = store.launch({ kind: 'draft', projectId: project.id, chapterId: chapter.id });
    store.update(state => { const job = state.jobs.find(value => value.id === id)!; job.status = 'failed'; job.hiddenFromTaskList = true; });
    store.resumeJob(id);
    const job = store.stateRef.current.jobs.find(value => value.id === id)!;
    expect(job.hiddenFromTaskList).toBeUndefined(); expect(job.status).toBe('queued');
    expect(job.steps.every(step => step.chapterId === chapter.id)).toBe(true);
  });
});

describe('正文保存与记忆提取', () => {
  it('编辑后的自动保存写入正文，等待超过十秒也不提取任何章节的记忆', async () => {
    mount();
    for (const effect of harness.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    await Promise.resolve();
    const project = store.stateRef.current.projects[0];
    store.update(state => { state.projects[0].chapters[0].content += '他停了一下。'; });
    await vi.advanceTimersByTimeAsync(20000);
    expect(saveWorkspace).toHaveBeenCalledWith(store.stateRef.current);
    expect(store.stateRef.current.projects[0].chapters[0].content).toBe(project.chapters[0].content + '他停了一下。');
    expect(store.stateRef.current.jobs).toEqual([]);
  });
  it('手动保存先等待持久化成功，再仅为当前章节提取记忆', async () => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[0];
    let complete!: () => void;
    vi.mocked(saveWorkspace).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const saving = store.saveChapter(project.id, chapter.id);
    expect(store.stateRef.current.jobs).toEqual([]);
    complete(); await saving;
    expect(store.stateRef.current.jobs).toHaveLength(1);
    expect(store.stateRef.current.jobs[0]).toMatchObject({ kind: 'memory', projectId: project.id, status: 'queued' });
    expect(store.stateRef.current.jobs[0].steps.map(step => [step.chapterId, step.baseContent])).toEqual([[chapter.id, chapter.content]]);
  });
  it('保存失败时不创建记忆任务，并显示失败状态', async () => {
    mount(); const project = store.stateRef.current.projects[0];
    vi.mocked(saveWorkspace).mockRejectedValueOnce(new Error('磁盘写入失败'));
    await store.saveChapter(project.id, project.chapters[0].id);
    expect(store.stateRef.current.jobs).toEqual([]);
    expect(harness.updates).toContain('保存失败'); expect(harness.updates).toContain('保存失败：磁盘写入失败');
  });
  it('保存期间继续编辑的正文不被当作本次已确认内容提取', async () => {
    mount(); const project = store.stateRef.current.projects[0];
    let complete!: () => void;
    vi.mocked(saveWorkspace).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const saving = store.saveChapter(project.id, project.chapters[0].id);
    store.update(state => { state.projects[0].chapters[0].content += '继续编辑。'; });
    complete(); await saving;
    expect(store.stateRef.current.jobs).toEqual([]);
    await store.saveChapter(project.id, project.chapters[0].id);
    expect(store.stateRef.current.jobs[0].steps[0].baseContent).toContain('继续编辑。');
  });
  it('快速重复保存和已排队的相同正文只产生一个提取任务', async () => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[0];
    await Promise.all([store.saveChapter(project.id, chapter.id), store.saveChapter(project.id, chapter.id)]);
    expect(saveWorkspace).toHaveBeenCalledTimes(1); expect(store.stateRef.current.jobs).toHaveLength(1);
    await store.saveChapter(project.id, chapter.id);
    expect(store.stateRef.current.jobs).toHaveLength(1);
  });
  it.each(['failed', 'paused'] as const)('再次保存可重新提取此前%s的记忆', async status => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[0];
    const job = createJob(project, 'memory', null, chapter.id, ''); job.status = status;
    store.update(state => { state.jobs.push(job); });
    await store.saveChapter(project.id, chapter.id);
    expect(store.stateRef.current.jobs).toHaveLength(2); expect(store.stateRef.current.jobs[0].status).toBe('queued');
  });
  it.each(['empty', 'current', 'writing'] as const)('%s章节只保存而不重复提取记忆', async condition => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[0];
    if (condition === 'empty') chapter.content = '  ';
    if (condition === 'current') chapter.memoryHash = contentHash(chapter.content);
    if (condition === 'writing') { const job = createJob(project, 'draft', null, chapter.id, ''); job.status = 'running'; store.stateRef.current.jobs.push(job); }
    await store.saveChapter(project.id, chapter.id);
    expect(saveWorkspace).toHaveBeenCalled(); expect(store.stateRef.current.jobs.some(job => job.kind === 'memory')).toBe(false);
  });
  it('未设置 AI 时正文仍保存成功，提示记忆提取未启动', async () => {
    mount(); store.stateRef.current.providers = []; const project = store.stateRef.current.projects[0];
    await store.saveChapter(project.id, project.chapters[0].id);
    expect(saveWorkspace).toHaveBeenCalled(); expect(store.stateRef.current.jobs).toEqual([]);
    expect(harness.updates).toContain('已保存'); expect(harness.updates.some(update => typeof update === 'string' && update.startsWith('正文已保存，记忆提取失败：'))).toBe(true);
  });
});


describe('正文内润色', () => {
  const selection = (content: string) => ({ start: 2, end: 6, content });
  it('直接替换原章节选区，保留版本并清除过期记忆，不创建创作任务', async () => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[0];
    chapter.summary = '旧摘要'; chapter.memoryHash = contentHash(chapter.content);
    vi.mocked(generate).mockResolvedValueOnce('轻轻推开房');
    await store.polishChapter(project.id, chapter.id, selection(chapter.content));
    const result = store.stateRef.current.projects[0].chapters[0];
    expect(result.content).toBe('林舟轻轻推开房。');
    expect(result.versions[0]).toMatchObject({ label: '润色前', content: chapter.content });
    expect(result.summary).toBe(''); expect(result.memoryHash).toBeUndefined();
    expect(store.stateRef.current.projects[0].chapters[1].content).toBe('门外落着雨。');
    expect(store.stateRef.current.jobs).toEqual([]);
  });
  it.each(['cancel', 'failure', 'edited', 'deleted', 'replace'] as const)('%s时不覆盖正文', async condition => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[0];
    let finish!: (value: string) => void, fail!: (error: Error) => void;
    vi.mocked(generate).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const pending = store.polishChapter(project.id, chapter.id, selection(chapter.content));
    await Promise.resolve();
    if (condition === 'cancel') store.cancelPolish(chapter.id);
    if (condition === 'edited') store.update(state => { state.projects[0].chapters[0].content = '新的编辑'; });
    if (condition === 'deleted') store.update(state => { state.projects[0].chapters.shift(); });
    if (condition === 'replace') await store.replace(structuredClone(store.stateRef.current));
    if (condition === 'failure') fail(new Error('网络失败')); else finish('新片段');
    if (condition === 'failure') await expect(pending).rejects.toThrow('网络失败');
    else if (condition === 'edited') await expect(pending).rejects.toThrow('正文已更新');
    else if (condition === 'deleted') await expect(pending).rejects.toThrow('章节已移除');
    else await pending;
    expect(store.stateRef.current.projects[0].chapters.some(item => item.content.includes('新片段'))).toBe(false);
    expect(store.stateRef.current.projects[0].chapters.every(item => item.versions.length === 0)).toBe(true);
    expect(store.stateRef.current.jobs).toEqual([]);
  });
  it('阻止重复润色和同时恢复本章写作任务', async () => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[0];
    const job = createJob(project, 'rewrite', null, chapter.id, ''); job.status = 'paused'; store.stateRef.current.jobs.push(job);
    let finish!: (value: string) => void;
    vi.mocked(generate).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = store.polishChapter(project.id, chapter.id, selection(chapter.content));
    await Promise.resolve();
    await expect(store.polishChapter(project.id, chapter.id, selection(chapter.content))).rejects.toThrow('请等待正文润色完成');
    expect(await store.canUpdate()).toBe(false);
    store.resumeJob(job.id);
    expect(harness.updates).toContain('请等待正文润色完成');
    expect(store.stateRef.current.jobs[0].status).toBe('paused');
    finish('修改后'); await pending;
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('本章已有写作任务时拒绝润色', async () => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[0];
    store.stateRef.current.jobs.push(createJob(project, 'draft', null, chapter.id, ''));
    await expect(store.polishChapter(project.id, chapter.id, selection(chapter.content))).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
  });
});
