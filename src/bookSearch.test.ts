import { describe, expect, it, vi } from 'vitest';
import { defaultArticleRule, ixdzsArticleRule, type ArticleRule } from './articleRules';
import { BOOK_SEARCH_HISTORY_LIMIT, mergeSearchBooks, recordBookSearch, searchSources } from './bookSearch';
import { emptyWorkspace, parseWorkspace } from './domain';

describe('书籍搜索记录', () => {
  it('去除首尾空白，将重复关键词移到最前且不修改原记录', () => {
    const history = ['三体', '刘慈欣', '活着'];
    expect(recordBookSearch(history, '  刘慈欣  ')).toEqual(['刘慈欣', '三体', '活着']);
    expect(history).toEqual(['三体', '刘慈欣', '活着']);
  });
  it('只保留最近的搜索，重复搜索不会挤掉其他记录', () => {
    const history = Array.from({ length: BOOK_SEARCH_HISTORY_LIMIT }, (_, i) => `书籍${i}`);
    expect(recordBookSearch(history, '新书')).toEqual(['新书', ...history.slice(0, -1)]);
    expect(recordBookSearch(history, history[history.length - 1])).toEqual([history[history.length - 1], ...history.slice(0, -1)]);
  });
  it('空关键词和超长关键词不产生记录', () => {
    const history = ['三体'];
    expect(recordBookSearch(history, ' \n ')).toEqual(history);
    expect(recordBookSearch(history, '书'.repeat(101))).toEqual(history);
    expect(recordBookSearch(history, '书'.repeat(100))[0]).toHaveLength(100);
  });
  it('随工作区保存、删除和清空后恢复，兼容缺少搜索记录的旧数据', () => {
    const state = emptyWorkspace();
    state.bookSearchHistory = recordBookSearch(recordBookSearch([], '三体'), '刘慈欣');
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.bookSearchHistory).toEqual(['刘慈欣', '三体']);
    restored.bookSearchHistory = restored.bookSearchHistory.filter(keyword => keyword !== '三体');
    expect(parseWorkspace(JSON.stringify(restored)).bookSearchHistory).toEqual(['刘慈欣']);
    restored.bookSearchHistory = [];
    expect(parseWorkspace(JSON.stringify(restored)).bookSearchHistory).toEqual([]);
    expect(parseWorkspace(JSON.stringify({ ...state, bookSearchHistory: undefined })).bookSearchHistory).toEqual([]);
    expect(emptyWorkspace().bookSearchHistory).toEqual([]);
  });
});

describe('多站书籍搜索', () => {
  it('一个来源失败不丢弃其他来源结果，缺少配置的来源明确报错', async () => {
    const publish = vi.fn();
    const rules: ArticleRule[] = [defaultArticleRule, ixdzsArticleRule, { ...defaultArticleRule, id: 'custom', search: undefined }];
    const search = vi.fn(async (rule: ArticleRule) => {
      if (rule.id === defaultArticleRule.id) throw new Error('网站要求验证');
      return { books: [{ title: '样本', author: '作者', intro: '', url: 'https://ixdzs8.com/read/1/' }], hasMore: true };
    });
    await searchSources(rules, '样本', new AbortController().signal, search, publish);
    expect(search).toHaveBeenCalledTimes(2);
    const results = publish.mock.calls.map(([result]) => result);
    expect(results.find(r => r.rule.id === ixdzsArticleRule.id).books).toHaveLength(1);
    expect(results.find(r => r.rule.id === defaultArticleRule.id).error).toBe('网站要求验证');
    expect(results.find(r => r.rule.id === 'custom').error).toBe('未配置书籍搜索');
  });
  it('停止或新搜索后不提交迟到结果，也不发起排队请求', async () => {
    const controller = new AbortController(), publish = vi.fn();
    const search = vi.fn(async () => { controller.abort(); return { books: [], hasMore: false }; });
    await searchSources([defaultArticleRule, ixdzsArticleRule], '样本', controller.signal, search, publish);
    expect(publish).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('分页只按作品地址合并，同名不同来源仍可选择', () => {
    const book = { title: '同名', author: '作者', intro: '', url: 'https://ixdzs8.com/read/1/' };
    expect(mergeSearchBooks([book], [book, { ...book, url: 'https://www.69shuba.com/book/1.htm' }])).toHaveLength(2);
  });
});
