import { z } from 'zod';

export const articleRuleSchema = z.object({
  id: z.string(), name: z.string(), siteUrl: z.string(),
  encoding: z.enum(['auto', 'utf-8', 'gbk']),
  catalogTitleSelector: z.string(), chapterLinkSelector: z.string(),
  chapterTitleSelector: z.string(), contentSelector: z.string(), excludeSelector: z.string(),
});
export type ArticleRule = z.infer<typeof articleRuleSchema>;
export const defaultArticleRule: ArticleRule = {
  id: 'builtin-69shuba', name: '69书吧', siteUrl: 'https://www.69shuba.com/', encoding: 'auto',
  catalogTitleSelector: '.bread a:last-child', chapterLinkSelector: '#catalog li a',
  chapterTitleSelector: 'h1', contentSelector: '.txtnav',
  excludeSelector: 'h1, .txtinfo, .contentadv, .bottom-ad, #txtright',
};
export type ArticlePage = { title: string; url: string; text: string; chapters: { title: string; url: string }[] };
export function articleRange(start: number, end: number, total: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > total) throw new Error('请选择有效的章节范围');
  if (end - start + 1 > 100) throw new Error('每次最多采集 100 章');
  return { start: start - 1, end };
}
