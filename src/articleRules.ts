import { z } from 'zod';

export const bookSearchRuleSchema = z.object({
  url: z.string(), method: z.enum(['GET', 'POST']), body: z.string(), encoding: z.enum(['utf-8', 'gbk']),
  resultSelector: z.string(), titleSelector: z.string(), linkSelector: z.string(),
  authorSelector: z.string(), introSelector: z.string(), nextSelector: z.string(), emptySelector: z.string(),
});
export type BookSearchRule = z.infer<typeof bookSearchRuleSchema>;
export const articleRuleSchema = z.object({
  id: z.string(), name: z.string(), siteUrl: z.string(),
  encoding: z.enum(['auto', 'utf-8', 'gbk']),
  catalogTitleSelector: z.string(), chapterLinkSelector: z.string(),
  chapterTitleSelector: z.string(), contentSelector: z.string(), excludeSelector: z.string(),
  catalogLinkSelector: z.string().default(''), search: bookSearchRuleSchema.optional(),
});
export type ArticleRule = z.infer<typeof articleRuleSchema>;
export const defaultArticleRule: ArticleRule = {
  id: 'builtin-69shuba', name: '69书吧', siteUrl: 'https://www.69shuba.com/', encoding: 'auto',
  catalogTitleSelector: '.bread a:last-child', chapterLinkSelector: '#catalog li a',
  chapterTitleSelector: 'h1', contentSelector: '.txtnav',
  excludeSelector: 'h1, .txtinfo, .contentadv, .bottom-ad, #txtright',
  catalogLinkSelector: 'a.more-btn',
  search: {
    url: '/modules/article/search.php', method: 'POST', body: 'searchkey={query}&searchtype=all&page={page}', encoding: 'gbk',
    resultSelector: '.newbox ul li, #article_list_content ul li, .newlistbox ul li', titleSelector: 'h3',
    linkSelector: 'a.btn-tp, h3 a', authorSelector: 'label:first-of-type', introSelector: 'ol',
    nextSelector: 'a.next', emptySelector: '.search-empty',
  },
};
export const ixdzsArticleRule: ArticleRule = {
  id: 'builtin-ixdzs8', name: '爱下电子书', siteUrl: 'https://ixdzs8.com/', encoding: 'utf-8',
  catalogTitleSelector: 'h1', chapterLinkSelector: '#a-list .u-chapter li a',
  chapterTitleSelector: '.page-content h2', contentSelector: '.page-content section', excludeSelector: '.ad, [id^="page-id"]',
  catalogLinkSelector: '',
  search: {
    url: '/bsearch?q={query}&page={page}', method: 'GET', body: '', encoding: 'utf-8',
    resultSelector: '.burl', titleSelector: '.bname', linkSelector: '.bname a',
    authorSelector: '.bauthor', introSelector: '.l-p2', nextSelector: 'a[title="下一页"]', emptySelector: '.u-list',
  },
};
export const defaultArticleRules = [defaultArticleRule, ixdzsArticleRule];
export const bookSearchPageSchema = z.object({
  books: z.array(z.object({ title: z.string(), author: z.string(), intro: z.string(), url: z.string() })),
  hasMore: z.boolean(),
});
export type BookSearchPage = z.infer<typeof bookSearchPageSchema>;
export type SearchBook = BookSearchPage['books'][number];
export const articlePageSchema = z.object({ title: z.string(), url: z.string(), text: z.string(), chapters: z.array(z.object({ title: z.string(), url: z.string() })) });
export type ArticlePage = z.infer<typeof articlePageSchema>;
export function articleRange(start: number, end: number, total: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > total) throw new Error('请选择有效的章节范围');
  if (end - start + 1 > 100) throw new Error('每次最多采集 100 章');
  return { start: start - 1, end };
}
