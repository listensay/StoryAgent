import { z } from 'zod';

export const researchChapterSchema = z.object({ id: z.string(), title: z.string(), url: z.string(), readable: z.boolean() });
export const researchCatalogSchema = z.object({ bookUrl: z.string(), title: z.string(), chapters: z.array(researchChapterSchema) });
export const researchTextSchema = researchChapterSchema.omit({ readable: true }).extend({ content: z.string() });
export const collectionSchema = z.object({
  catalog: researchCatalogSchema,
  chapters: z.array(researchChapterSchema.omit({ readable: true }).extend({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })),
});
export type ResearchCatalog = z.infer<typeof researchCatalogSchema>;
export type ResearchText = z.infer<typeof researchTextSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type ResearchScope = 'opening' | 'available' | 'chapter';
export type CollectedSource = { content: string; collection: Collection };

export function researchChapters(catalog: ResearchCatalog, scope: ResearchScope, chapterId: string) {
  if (scope === 'chapter') return catalog.chapters.filter(c => c.id === chapterId && c.readable);
  if (scope === 'opening') return catalog.chapters.slice(0, 3).filter(c => c.readable);
  return catalog.chapters.filter(c => c.readable);
}
export function cachedChapter(source: CollectedSource | undefined, bookUrl: string, id: string): ResearchText | undefined {
  if (source?.collection.catalog.bookUrl !== bookUrl) return;
  const chapter = source.collection.chapters.find(c => c.id === id);
  if (!chapter || chapter.start >= chapter.end || chapter.end > source.content.length) return;
  const content = source.content.slice(chapter.start, chapter.end);
  return content.trim() ? { id: chapter.id, title: chapter.title, url: chapter.url, content } : undefined;
}
export function mergeResearchText(catalog: ResearchCatalog, source: CollectedSource | undefined, next: ResearchText): CollectedSource {
  if (!catalog.chapters.some(c => c.id === next.id && c.url === next.url)) throw new Error('章节与作品目录不一致');
  let content = '';
  const chapters: Collection['chapters'] = [];
  for (const entry of catalog.chapters) {
    const chapter = entry.id === next.id ? next : cachedChapter(source, catalog.bookUrl, entry.id);
    if (!chapter) continue;
    content += `${content ? '\n\n' : ''}## ${chapter.title}\n\n`;
    const start = content.length;
    content += chapter.content;
    chapters.push({ id: chapter.id, title: chapter.title, url: chapter.url, start, end: content.length });
  }
  if (content.length > 5_000_000) throw new Error('作品正文超过 500 万字符，请选择章节分析');
  return { content, collection: { catalog, chapters } };
}
export function researchSelection(catalog: ResearchCatalog, source: CollectedSource | undefined, scope: ResearchScope, chapterId: string) {
  const chapters = researchChapters(catalog, scope, chapterId);
  const parts = chapters.map(c => cachedChapter(source, catalog.bookUrl, c.id));
  if (!parts.length || parts.some(c => !c)) return '';
  return parts.map(c => `## ${c!.title}\n\n${c!.content}`).join('\n\n');
}

export async function collectResearchText(catalog: ResearchCatalog, scope: ResearchScope, chapterId: string,
  source: CollectedSource | undefined, signal: AbortSignal,
  read: (id: string, signal: AbortSignal) => Promise<ResearchText>,
  progress: (source: CollectedSource, done: number, total: number) => void) {
  const chapters = researchChapters(catalog, scope, chapterId);
  if (!chapters.length) throw new Error('当前范围暂无可获取的正文');
  let current = source;
  for (const [index, chapter] of chapters.entries()) {
    signal.throwIfAborted();
    if (!cachedChapter(current, catalog.bookUrl, chapter.id)) {
      const text = await read(chapter.id, signal);
      signal.throwIfAborted();
      if (text.id !== chapter.id || text.url !== chapter.url || !text.content.trim()) throw new Error('获取的章节正文无效');
      current = mergeResearchText(catalog, current, text);
    }
    progress(current!, index + 1, chapters.length);
  }
  return current!;
}
