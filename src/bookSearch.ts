import type { ArticleRule, BookSearchPage, SearchBook } from './articleRules';

export const BOOK_SEARCH_HISTORY_LIMIT = 20;
export function recordBookSearch(history: string[], query: string): string[] {
  const keyword = query.trim();
  if (!keyword || keyword.length > 100) return history;
  return [keyword, ...history.filter(item => item !== keyword)].slice(0, BOOK_SEARCH_HISTORY_LIMIT);
}

export type SourceSearch = {
  rule: ArticleRule; books: SearchBook[]; page: number; hasMore: boolean; busy: boolean; error: string;
};
export function mergeSearchBooks(previous: SearchBook[], next: SearchBook[]) {
  return [...new Map([...previous, ...next].map(book => [book.url, book])).values()];
}
export async function searchSources(rules: ArticleRule[], query: string, signal: AbortSignal,
  search: (rule: ArticleRule, query: string, page: number, signal: AbortSignal) => Promise<BookSearchPage>,
  publish: (result: SourceSearch) => void) {
  const pending = [...rules];
  await Promise.all(Array.from({ length: Math.min(3, rules.length) }, async () => {
    while (pending.length && !signal.aborted) {
      const rule = pending.shift()!;
      let result: SourceSearch = { rule, books: [], page: 0, hasMore: false, busy: false, error: '' };
      try {
        if (!rule.search) throw new Error('未配置书籍搜索');
        result = { ...result, ...await search(rule, query, 1, signal), page: 1 };
      } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
      if (!signal.aborted) publish(result);
    }
  }));
}
