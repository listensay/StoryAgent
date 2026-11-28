import { uid, type Chapter, type Note, type Project } from './domain';
import { contentHash, memoryKinds, type MemorySource, type MemoryLink, type MemoryResult } from './memoryData';

export type SourceRange = { start: number; end: number };
export type OpenChapter = (chapterId: string, range?: SourceRange) => void;
const isMemoryNote = (n: Note): n is Note & { kind: MemorySource['kind'] } => memoryKinds.some(k => k === n.kind);
const asLegacy = (n: Note & { kind: MemorySource['kind'] }): MemorySource => ({
  id: n.id, chapterId: n.chapterId, kind: n.kind, title: n.title, body: n.body, origin: 'legacy',
});

export function memoryCatalog(project: Project) {
  const chapters = new Map(project.chapters.map(c => [c.id, c]));
  const sources = new Map((project.memorySources ?? []).filter(s => chapters.has(s.chapterId)).map(s => [s.id, s]));
  for (const note of project.notes) if (isMemoryNote(note) && !sources.has(note.id) && (chapters.has(note.chapterId) || !note.chapterId)) sources.set(note.id, asLegacy(note));
  const links = (project.memoryLinks ?? []).filter(l => sources.has(l.fromId) && sources.has(l.toId));
  return { chapters, sources, links };
}
export type MemoryCatalog = ReturnType<typeof memoryCatalog>;

function uniqueOffset(content: string, quote: string) {
  if (!quote.trim()) return -1;
  const start = content.indexOf(quote);
  return start >= 0 && content.indexOf(quote, start + 1) < 0 ? start : -1;
}

// Old workspaces had notes but no source table. Keep these as historical records
// before an edit invalidates the live writing context; never invent an old quote.
export function archiveLegacyNotes(project: Project, chapterId: string, oldContent: string) {
  const known = new Set(project.memorySources?.map(s => s.id));
  const old = project.notes.filter(isMemoryNote).filter(n => n.chapterId === chapterId && !known.has(n.id));
  if (!old.length) return;
  const hash = contentHash(oldContent), sources = project.memorySources ??= [];
  for (const note of old) {
    const quote = note.body.trim(), start = uniqueOffset(oldContent, quote);
    sources.push({ ...asLegacy(note), hash, retired: true, evidence: start < 0 ? undefined : { start, quote } });
  }
}

// Offsets refer to a particular manuscript. Relocate only a unique verbatim match after an edit.
export function sourceRange(source: MemorySource, chapter?: Chapter, hash?: string): SourceRange | undefined {
  const e = source.evidence;
  if (!e?.quote.trim() || !chapter || chapter.id !== source.chapterId) return;
  const start = (hash ?? contentHash(chapter.content)) === source.hash && chapter.content.slice(e.start, e.start + e.quote.length) === e.quote
    ? e.start : uniqueOffset(chapter.content, e.quote);
  return start < 0 ? undefined : { start, end: start + e.quote.length };
}

// No plans, guesses from names, or model-generated summaries are used as citations.
export function memoryContext(project: Project, chapterId: string, budget: number, manuscript: string) {
  const index = project.chapters.findIndex(c => c.id === chapterId);
  const header = '\n前章引文索引（仅供建立关联，不能作为本章原文）：\n';
  if (index < 1 || budget < header.length + 100) return '';
  const positions = new Map(project.chapters.slice(0, index).map((c, i) => [c.id, i]));
  const candidates = (project.memorySources ?? []).filter(s => positions.has(s.chapterId) && s.evidence && !s.retired && (s.origin !== 'author' || s.phase === 'plant'));
  // Mentioned subjects first, then more recent chapters. Ranking never creates a relation.
  const relevant = (s: MemorySource) => Number(!!s.subject && manuscript.includes(s.subject));
  candidates.sort((a, b) => relevant(b) - relevant(a) || positions.get(b.chapterId)! - positions.get(a.chapterId)!);
  let result = '';
  const hashes = new Map<string, string>();
  for (const s of candidates) {
    const ch = project.chapters[positions.get(s.chapterId)!];
    if (!hashes.has(ch.id)) hashes.set(ch.id, contentHash(ch.content));
    if (s.hash !== hashes.get(ch.id) || !sourceRange(s, ch, s.hash)) continue;
    const line = JSON.stringify({ sourceId: s.id, chapter: ch.title, kind: s.kind, subject: s.subject, phase: s.phase, title: s.title, quote: s.evidence!.quote }) + '\n';
    if (header.length + result.length + line.length <= budget) result += line;
    if (budget - result.length - header.length < 100) break;
  }
  // An existing book need not re-extract every earlier chapter before checking a later one.
  // Raw excerpt IDs are bound to the manuscript revision and require a second, exact quote on import.
  for (const ch of project.chapters.slice(Math.max(0, index - 3), index).reverse()) {
    const room = budget - header.length - result.length;
    if (room < 200) break;
    const hash = hashes.get(ch.id) ?? contentHash(ch.content);
    const tail = ch.content.slice(-Math.min(1600, room - 160));
    if (!tail.trim()) continue;
    const line = JSON.stringify({ sourceId: `chapter:${ch.id}:${hash}`, chapter: ch.title, excerpt: tail }) + '\n';
    if (line.length <= room) result += line;
  }
  return result ? header + result : '';
}

function rawReference(proposal: NonNullable<MemoryResult['notes'][number]['links']>[number], prior: Map<string, Chapter>, sources: MemorySource[]) {
  const id = /^chapter:(.+):(\d+:\d+:\d+)$/.exec(proposal.sourceId);
  const quote = proposal.priorQuote?.trim();
  const chapter = id && prior.get(id[1]);
  if (!id || !chapter || !quote || !chapter.content.slice(-1600).includes(quote) || contentHash(chapter.content) !== id[2]) return;
  const start = uniqueOffset(chapter.content, quote);
  if (start < 0) return;
  const plant = proposal.kind === 'payoff';
  const matches = sources.filter(s => s.chapterId === chapter.id && !s.retired && s.hash === id[2] && s.evidence?.start === start && s.evidence.quote === quote && (!plant || (s.kind === 'foreshadow' && s.phase !== 'payoff')));
  if (matches.length === 1) return matches[0];
  const anchor = matches.find(s => s.origin === 'passage');
  if (anchor) return anchor;
  const source: MemorySource = { id: uid(), chapterId: chapter.id, kind: plant ? 'foreshadow' : 'fact', title: plant ? '伏笔线索' : '前章引文', body: '', phase: plant ? 'plant' : undefined, origin: 'passage', hash: id[2], evidence: { quote, start } };
  sources.push(source); return source;
}

export function storeMemory(project: Project, chapter: Chapter, result: MemoryResult) {
  const hash = contentHash(chapter.content);
  const sources = project.memorySources ??= [];
  const links = project.memoryLinks ??= [];
  const previous = memoryCatalog(project);
  const old = [...previous.sources.values()].filter(s => s.chapterId === chapter.id);
  const used = new Set<string>(), next: Note[] = [];
  const prior = new Map(project.chapters.slice(0, project.chapters.findIndex(c => c.id === chapter.id)).map(c => [c.id, c]));
  const priorHashes = new Map<string, string>();
  const oldIds = new Set(old.map(s => s.id));
  // Keep the original pair of quotations if a later extraction no longer proposes this link.
  for (const l of links) if (oldIds.has(l.toId) && l.origin === 'extraction') l.historical = true;
  for (const item of result.notes) {
    const title = item.title.trim(), quote = item.quote?.trim() ?? '';
    const start = uniqueOffset(chapter.content, quote);
    const evidence = start < 0 ? undefined : { quote, start };
    const subject = item.subject?.trim();
    // Never transfer an author's link to a different quote just because a title/name recurs.
    const matches = old.filter(s => !used.has(s.id) && s.kind === item.kind && (!s.phase || !item.phase || s.phase === item.phase) && (evidence
      ? s.evidence?.quote === quote && (!s.subject || !subject || s.subject === subject)
      : !s.evidence && s.title === title && s.body === item.body));
    const exactTitle = matches.filter(s => s.title === title);
    const authored = matches.filter(s => s.origin === 'author' && evidence && sourceRange(s, chapter, hash)?.start === evidence.start);
    const match = authored.length === 1 ? authored[0] : exactTitle.length === 1 ? exactTitle[0] : matches.length === 1 ? matches[0] : undefined;
    const id = match?.id ?? uid(); used.add(id);
    const source: MemorySource = { id, chapterId: chapter.id, title, kind: item.kind, body: item.body, hash, evidence, origin: 'extraction',
      subject: subject && chapter.content.includes(subject) ? subject : match?.subject && chapter.content.includes(match.subject) ? match.subject : undefined, phase: item.kind === 'foreshadow' ? item.phase ?? match?.phase : undefined };
    const existing = sources.findIndex(s => s.id === id);
    if (match?.origin === 'author') { match.hash = hash; match.evidence = evidence; }
    else if (existing >= 0) sources[existing] = source; else sources.push(source);
    next.push({ id, chapterId: chapter.id, title, kind: item.kind, body: item.body, status: evidence ? 'confirmed' : 'reference' });
    if (!evidence) continue;
    for (const proposal of item.links ?? []) {
      if (!proposal.reason.trim() || (proposal.kind === 'payoff' && (source.kind !== 'foreshadow' || source.phase !== 'payoff'))) continue;
      const from = previous.sources.get(proposal.sourceId) ?? rawReference(proposal, prior, sources), earlier = from && prior.get(from.chapterId);
      if (!earlier || !from || from.retired || !from.evidence) continue;
      if (!priorHashes.has(earlier.id)) priorHashes.set(earlier.id, contentHash(earlier.content));
      if (from.hash !== priorHashes.get(earlier.id) || !sourceRange(from, earlier, from.hash)) continue;
      if (proposal.kind === 'payoff' && (from.kind !== 'foreshadow' || from.phase === 'payoff' || source.kind !== 'foreshadow' || source.phase !== 'payoff')) continue;
      const existingLink = links.find(l => l.fromId === from.id && l.toId === id && l.kind === proposal.kind);
      if (!existingLink) links.push({ id: uid(), fromId: from.id, toId: id, kind: proposal.kind, origin: 'extraction', reason: proposal.reason.trim() });
      else if (existingLink.origin === 'extraction') { existingLink.historical = undefined; existingLink.reason = proposal.reason.trim(); }
    }
  }
  const referenced = new Set(links.flatMap(l => [l.fromId, l.toId]));
  for (const s of old) if (s.origin !== 'author' && !used.has(s.id) && (s.evidence || s.origin === 'legacy' || referenced.has(s.id))) {
    s.retired = true;
    if (!sources.some(entry => entry.id === s.id)) sources.push(s);
  }
  project.memorySources = sources.filter(s => s.chapterId !== chapter.id || s.origin === 'author' || used.has(s.id) || !!s.evidence || s.origin === 'legacy' || referenced.has(s.id));
  project.notes = [...project.notes.filter(n => n.chapterId !== chapter.id || !isMemoryNote(n)), ...next];
  chapter.memoryHash = hash;
}

export function authorPlant(project: Project, chapterId: string, range: SourceRange, quote: string, title: string) {
  const chapter = project.chapters.find(c => c.id === chapterId);
  if (!chapter || !title.trim() || !quote.trim() || range.start < 0 || range.end !== range.start + quote.length || chapter.content.slice(range.start, range.end) !== quote) throw new Error('埋设原文已变动，请重新选择');
  const sources = project.memorySources ??= [], hash = contentHash(chapter.content);
  if (sources.some(s => s.chapterId === chapterId && !s.retired && s.kind === 'foreshadow' && s.phase !== 'payoff' && s.evidence?.quote === quote && sourceRange(s, chapter, hash)?.start === range.start)) throw new Error('该原文已有埋设记录');
  sources.push({ id: uid(), chapterId, kind: 'foreshadow', phase: 'plant', title: title.trim(), body: '', origin: 'author', evidence: { quote, start: range.start }, hash });
}

export function authorPayoff(project: Project, sourceId: string, chapterId: string, range: SourceRange, quote: string, candidateId?: string) {
  const catalog = memoryCatalog(project), from = catalog.sources.get(sourceId), chapter = catalog.chapters.get(chapterId);
  if (!from || from.kind !== 'foreshadow' || from.phase === 'payoff' || !chapter) throw new Error('伏笔或章节已移除');
  const startIndex = project.chapters.findIndex(c => c.id === from.chapterId);
  if (startIndex < 0 || project.chapters.indexOf(chapter) <= startIndex) throw new Error('请选择埋设之后的章节');
  if (!quote.trim() || range.start < 0 || range.end !== range.start + quote.length || chapter.content.slice(range.start, range.end) !== quote) throw new Error('回收原文已变动，请重新选择');
  const sources = project.memorySources ??= [], links = project.memoryLinks ??= [];
  if (!sources.some(s => s.id === from.id)) sources.push(from); // Keep an old unquoted plant even when its note is invalidated.
  const hash = contentHash(chapter.content);
  const candidate = candidateId ? links.find(l => l.id === candidateId && l.kind === 'payoff' && l.fromId === from.id) : undefined;
  let to = sources.find(s => (candidate ? s.id === candidate.toId : !s.retired) && s.chapterId === chapterId && s.kind === 'foreshadow' && s.phase === 'payoff' && s.evidence?.quote === quote && sourceRange(s, chapter, hash)?.start === range.start);
  if (candidateId && (!candidate || !to)) throw new Error('候选回收已变动，请重新核对');
  if (!to) {
    to = { id: uid(), chapterId, title: '回收原文', body: '', kind: 'foreshadow', phase: 'payoff', origin: 'author', evidence: { quote, start: range.start }, hash };
    sources.push(to);
  }
  const toId = to.id;
  const link = candidate ?? links.find(l => l.kind === 'payoff' && l.fromId === from.id && l.toId === toId);
  if (link) { link.origin = 'author'; link.historical = undefined; }
  else links.push({ id: uid(), fromId: from.id, toId, kind: 'payoff', origin: 'author', reason: '作者关联埋设与回收原文' });
}

export function removeAuthorMark(project: Project, sourceId: string) {
  const source = project.memorySources?.find(s => s.id === sourceId && s.origin === 'author');
  if (!source) return;
  if (project.memoryLinks?.some(l => l.fromId === sourceId || l.toId === sourceId)) throw new Error('请先解除关联');
  const note = project.notes.find(n => n.id === sourceId);
  if (note) { source.origin = 'extraction'; source.title = note.title; source.body = note.body; }
  else project.memorySources = project.memorySources?.filter(s => s.id !== sourceId);
}

export function removeAuthorPayoff(project: Project, id: string) {
  const link = project.memoryLinks?.find(l => l.id === id && l.origin === 'author' && l.kind === 'payoff');
  if (!link) return;
  project.memoryLinks = project.memoryLinks!.filter(l => l.id !== id);
  if (!project.memoryLinks.some(l => l.toId === link.toId || l.fromId === link.toId)) removeAuthorMark(project, link.toId);
}

// Only for permanent deletion. Keep both tables intact while a chapter is in the recycle bin.
export function purgeChapterMemory(project: Project, chapterId: string) {
  const removed = new Set(project.memorySources?.filter(s => s.chapterId === chapterId).map(s => s.id));
  if (!removed.size) return;
  project.memorySources = project.memorySources?.filter(s => !removed.has(s.id));
  project.memoryLinks = project.memoryLinks?.filter(l => !removed.has(l.fromId) && !removed.has(l.toId));
}

export function affectedChapters(catalog: MemoryCatalog, chapterId: string) {
  const { links, sources, chapters } = catalog;
  const order = new Map([...chapters.keys()].map((id, i) => [id, i]));
  const downstream = new Map<string, MemoryLink[]>();
  for (const link of links) {
    const from = sources.get(link.fromId)!, to = sources.get(link.toId)!;
    if ((order.get(from.chapterId) ?? -1) >= (order.get(to.chapterId) ?? -1)) continue;
    const list = downstream.get(from.id) ?? []; list.push(link); downstream.set(from.id, list);
  }
  // Follow only connected source records, not every record in an intermediate chapter.
  const queue = [...sources.values()].filter(s => s.chapterId === chapterId).map(s => ({ id: s.id, path: [] as MemoryLink[] }));
  const visited = new Set(queue.map(s => s.id)), paths: MemoryLink[][] = [];
  for (let i = 0; i < queue.length; i++) for (const link of downstream.get(queue[i].id) ?? []) {
    const path = [...queue[i].path, link]; paths.push(path);
    if (visited.has(link.toId) || link.kind === 'question' || link.historical || sources.get(link.toId)?.retired) continue;
    visited.add(link.toId); queue.push({ id: link.toId, path });
  }
  return paths.sort((a, b) => order.get(sources.get(a[a.length - 1].toId)!.chapterId)! - order.get(sources.get(b[b.length - 1].toId)!.chapterId)!);
}
