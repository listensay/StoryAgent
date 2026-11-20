import { now, type Job, type Workspace } from './domain';
import { readArticlePage, readResearchCatalog, readResearchChapter } from './platform';
import { collectResearchText } from './researchSources';

export async function runCollection(job: Job, signal: AbortSignal, current: () => Workspace, update: (mutation: (state: Workspace) => void) => void) {
  const task = job.collectionTask!;
  const cached = current().references.find(r => r.id === task.referenceId);
  const catalog = cached?.collection?.catalog ?? await readResearchCatalog(task.bookUrl, signal, task.rule);
  signal.throwIfAborted();
  if (catalog.bookUrl !== task.bookUrl) throw new Error('目录与所选作品不一致');
  // Save the catalog before fetching chapters so a failed collection is resumable.
  update(s => {
    if (!s.references.some(r => r.id === task.referenceId)) s.references.unshift({ id: task.referenceId, title: catalog.title, source: task.bookUrl, bookUrl: task.bookUrl, kind: 'text', content: '', createdAt: now(), collection: { catalog, chapters: [] } });
  });
  await collectResearchText(catalog, task.scope, task.chapterId, cached?.collection ? { content: cached.content, collection: cached.collection } : undefined, signal,
    (id, active) => readResearchChapter(task.bookUrl, id, active, task.rule),
    (result, done, total) => {
      signal.throwIfAborted();
      update(s => {
        const source = s.references.find(r => r.id === task.referenceId); if (source) Object.assign(source, result);
        const active = s.jobs.find(j => j.id === job.id); if (active?.collectionTask) { active.collectionTask.done = done; active.collectionTask.total = total; active.steps[0].output = `${done} / ${total} 章`; }
      });
    });
}

export async function runArticleCollection(job: Job, signal: AbortSignal, current: () => Workspace, update: (mutation: (state: Workspace) => void) => void) {
  const task = job.articleTask!;
  if (task.mode === 'catalog') {
    const page = await readArticlePage(task.rule, task.url, 'catalog', signal);
    signal.throwIfAborted();
    update(s => { const active = s.jobs.find(j => j.id === job.id)!; active.articleTask!.page = page; active.sourceTitle = page.title; active.steps[0].output = `${page.chapters.length} 章`; });
    return;
  }
  const links = task.mode === 'chapter' ? [{ title: job.sourceTitle, url: task.url }] : task.links;
  for (let i = task.done; i < links.length; i++) {
    signal.throwIfAborted();
    const page = await readArticlePage(task.rule, links[i].url, 'chapter', signal);
    signal.throwIfAborted();
    if (!page.text.trim()) throw new Error('暂无可采集的正文');
    const existing = current().references.find(r => r.id === task.referenceId)?.content ?? '';
    const content = `${existing}${existing ? '\n\n' : ''}## ${page.title}\n\n${page.text}`;
    if (content.length > 5_000_000) throw new Error('采集正文超过 500 万字符，请缩小章节范围');
    update(s => {
      const active = s.jobs.find(j => j.id === job.id)!;
      let source = s.references.find(r => r.id === task.referenceId);
      if (!source) { source = { id: task.referenceId, title: task.mode === 'chapter' ? page.title : job.sourceTitle, source: task.url, kind: 'text', content: '', createdAt: now() }; s.references.unshift(source); }
      source.content = content; active.sourceTitle = source.title;
      active.articleTask!.done = i + 1; active.articleTask!.total = links.length; active.steps[0].output = `${i + 1} / ${links.length} 章`;
    });
  }
}
