import { describe, expect, it, vi } from 'vitest';
import { cachedChapter, collectResearchText, mergeResearchText, researchSelection, type ResearchCatalog } from './researchSources';
import { emptyWorkspace, parseWorkspace } from './domain';

const catalog: ResearchCatalog = { bookUrl: 'https://m.qidian.com/book/123/', title: '样本', chapters: [
  { id: '1', title: '第一章', url: 'https://m.qidian.com/chapter/123/1/', readable: true },
  { id: '2', title: '第二章', url: 'https://m.qidian.com/chapter/123/2/', readable: true },
  { id: '3', title: '第三章', url: 'https://m.qidian.com/chapter/123/3/', readable: false },
] };
const text = (id: string) => ({ ...catalog.chapters.find(c => c.id === id)!, content: `正文${id}\n\n第二段` });
describe('研究正文自动采集', () => {
  it('目录顺序决定正文顺序，跨作品缓存不可复用', () => {
    const second = mergeResearchText(catalog, undefined, text('2'));
    const both = mergeResearchText(catalog, second, text('1'));
    expect(both.content.indexOf('第一章')).toBeLessThan(both.content.indexOf('第二章'));
    expect(cachedChapter(both, catalog.bookUrl, '1')?.content).toBe(text('1').content);
    expect(cachedChapter(both, 'another-book', '1')).toBeUndefined();
    expect(() => mergeResearchText(catalog, both, { ...text('1'), url: 'wrong-book' })).toThrow('不一致');
  });
  it('未完成的范围不可分析，指定章节不包含其他章节或付费章', () => {
    const partial = mergeResearchText(catalog, undefined, text('1'));
    expect(researchSelection(catalog, partial, 'opening', '')).toBe('');
    expect(researchSelection(catalog, partial, 'chapter', '1')).toContain('正文1');
    expect(researchSelection(catalog, partial, 'chapter', '3')).toBe('');
  });
  it('自动获取缺失章节，重试复用已成功的正文', async () => {
    const cached = mergeResearchText(catalog, undefined, text('1'));
    const read = vi.fn(async (id: string) => text(id));
    const progress = vi.fn();
    const result = await collectResearchText(catalog, 'available', '', cached, new AbortController().signal, read, progress);
    expect(read.mock.calls.map(c => c[0])).toEqual(['2']);
    expect(progress).toHaveBeenLastCalledWith(result, 2, 2);
    expect(researchSelection(catalog, result, 'available', '')).toContain('正文2');
    await collectResearchText(catalog, 'opening', '', result, new AbortController().signal, read, progress);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('中途失败保留已完成章节，并停止后续采集', async () => {
    const progress = vi.fn();
    await expect(collectResearchText(catalog, 'opening', '', undefined, new AbortController().signal,
      async id => { if (id === '2') throw new Error('网络失败'); return text(id); }, progress)).rejects.toThrow('网络失败');
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls[0][0].collection.chapters).toHaveLength(1);
  });
  it('切换作品或停止时丢弃尚未返回的正文', async () => {
    const controller = new AbortController(), progress = vi.fn();
    await expect(collectResearchText(catalog, 'opening', '', undefined, controller.signal,
      async id => { controller.abort(); return text(id); }, progress)).rejects.toThrow();
    expect(progress).not.toHaveBeenCalled();
  });
  it('拒绝错误章节及空正文', async () => {
    for (const wrong of [{ ...text('2') }, { ...text('1'), content: '' }]) {
      await expect(collectResearchText(catalog, 'chapter', '1', undefined, new AbortController().signal, async () => wrong, vi.fn())).rejects.toThrow('无效');
    }
  });
  it('自动采集的章节来源随工作区保存，旧资料保持兼容', () => {
    const workspace = emptyWorkspace();
    const base = { id: 'r', title: '样本', source: catalog.bookUrl, kind: 'text' as const, content: '旧正文', createdAt: '' };
    workspace.references = [base, { ...base, id: 'new', bookUrl: catalog.bookUrl, ...mergeResearchText(catalog, undefined, text('1')) }];
    const loaded = parseWorkspace(JSON.stringify(workspace));
    expect(loaded.references[0].content).toBe('旧正文');
    expect(loaded.references[1].collection?.chapters[0].url).toBe(text('1').url);
  });
});
