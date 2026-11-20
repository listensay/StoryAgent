import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJob, emptyWorkspace, type Workspace } from './domain';
import { defaultArticleRule } from './articleRules';
import { runArticleCollection, runCollection } from './collectionTask';
import { readArticlePage, readResearchCatalog, readResearchChapter } from './platform';
vi.mock('./platform', () => ({ readArticlePage: vi.fn(), readResearchCatalog: vi.fn(), readResearchChapter: vi.fn() }));
const catalog = { title: '测试书', bookUrl: 'https://example.com/book', chapters: [1, 2].map(n => ({ id: String(n), title: `第${n}章`, url: `https://example.com/chapter/${n}`, readable: true })) };
function setup() {
  const state = emptyWorkspace(), job = createJob(undefined, 'collect', null, [], ''); state.jobs = [job];
  const update = (mutation: (draft: Workspace) => void) => { mutation(state); };
  return { state, job, update, current: () => state };
}
beforeEach(() => vi.resetAllMocks());
describe('全局采集任务', () => {
  it('逐章持久化，失败后复用目录和已采正文', async () => {
    const { state, job, current, update } = setup();
    job.collectionTask = { ...catalog, scope: 'available', chapterId: '', referenceId: 'r', done: 0, total: 0 };
    vi.mocked(readResearchCatalog).mockResolvedValue(catalog);
    vi.mocked(readResearchChapter).mockImplementation(async (_, id) => { if (id === '2') throw new Error('网络失败'); return { ...catalog.chapters[0], content: '第一章正文' }; });
    await expect(runCollection(job, new AbortController().signal, current, update)).rejects.toThrow('网络失败');
    expect(state.references[0].collection?.chapters).toHaveLength(1); expect(job.collectionTask.done).toBe(1);
    vi.mocked(readResearchChapter).mockResolvedValue({ ...catalog.chapters[1], content: '第二章正文' });
    await runCollection(job, new AbortController().signal, current, update);
    expect(readResearchCatalog).toHaveBeenCalledTimes(1); expect(vi.mocked(readResearchChapter).mock.calls.map(c => c[1])).toEqual(['1', '2', '2']);
    expect(state.references).toHaveLength(1); expect(state.references[0].content).toContain('第二章正文');
  });
  it('停止后不写入晚到响应', async () => {
    const { state, job, current, update } = setup(); const controller = new AbortController();
    job.collectionTask = { ...catalog, scope: 'chapter', chapterId: '1', referenceId: 'r', done: 0, total: 0 };
    vi.mocked(readResearchCatalog).mockResolvedValue(catalog);
    vi.mocked(readResearchChapter).mockImplementation(async () => { controller.abort(); return { ...catalog.chapters[0], content: '晚到正文' }; });
    await expect(runCollection(job, controller.signal, current, update)).rejects.toThrow();
    expect(state.references[0].content).toBe(''); expect(job.collectionTask.done).toBe(0);
  });
  it('规则采集范围任务失败后从下一章恢复，不重复添加', async () => {
    const { state, job, current, update } = setup();
    job.articleTask = { url: catalog.bookUrl, rule: defaultArticleRule, mode: 'range', links: catalog.chapters, referenceId: 'a', done: 0, total: 2 };
    vi.mocked(readArticlePage).mockResolvedValueOnce({ url: catalog.chapters[0].url, title: '第一章', text: '正文一', chapters: [] }).mockRejectedValueOnce(new Error('采集失败'));
    await expect(runArticleCollection(job, new AbortController().signal, current, update)).rejects.toThrow('采集失败');
    expect(job.articleTask.done).toBe(1); expect(state.references[0].content).toContain('正文一');
    vi.mocked(readArticlePage).mockResolvedValueOnce({ url: catalog.chapters[1].url, title: '第二章', text: '正文二', chapters: [] });
    await runArticleCollection(job, new AbortController().signal, current, update);
    expect(job.articleTask.done).toBe(2); expect(state.references[0].content.match(/正文一/g)).toHaveLength(1);
    expect(vi.mocked(readArticlePage).mock.calls.map(c => c[1])).toEqual([catalog.chapters[0].url, catalog.chapters[1].url, catalog.chapters[1].url]);
  });
});
