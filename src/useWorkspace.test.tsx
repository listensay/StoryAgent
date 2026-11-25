import type { Dispatch, SetStateAction } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newChapter, newProject, type Workspace } from './domain';
import { contentHash } from './jobWorkflow';
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
    const job = createJob(project, 'memory', null, [chapter.id], ''); job.status = status;
    store.update(state => { state.jobs.push(job); });
    await store.saveChapter(project.id, chapter.id);
    expect(store.stateRef.current.jobs).toHaveLength(2); expect(store.stateRef.current.jobs[0].status).toBe('queued');
  });
  it.each(['empty', 'current', 'writing'] as const)('%s章节只保存而不重复提取记忆', async condition => {
    mount(); const project = store.stateRef.current.projects[0], chapter = project.chapters[0];
    if (condition === 'empty') chapter.content = '  ';
    if (condition === 'current') chapter.memoryHash = contentHash(chapter.content);
    if (condition === 'writing') { const job = createJob(project, 'draft', null, [chapter.id], ''); job.status = 'running'; store.stateRef.current.jobs.push(job); }
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
