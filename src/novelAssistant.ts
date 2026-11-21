import { z } from 'zod';
import { newChapter, now, uid, type Job, type Note, type Project, type Workspace } from './domain';
import { contentHash, parseJSON } from './jobWorkflow';
import { resolveCharacterRelation } from './characterRelations';

export const editableNoteKinds = ['character', 'relation', 'world', 'volume', 'scene', 'branch'] as const;
const text = z.string().trim().min(1);
const projectPatch = z.object({ title: text.optional(), genre: text.optional(), form: z.enum(['long', 'short']).optional(), targetWords: z.number().int().positive().optional(), theme: text.optional(), audience: text.optional(), synopsis: text.optional(), outline: text.optional() }).strict();
const resultSchema = z.object({
  reply: text,
  project: projectPatch.optional(),
  notes: z.array(z.object({ id: text.optional(), kind: z.enum(editableNoteKinds), title: text, body: text, source: text.optional(), target: text.optional() }).strict()).default([]),
  removeNoteIds: z.array(text).default([]),
  chapters: z.array(z.object({ id: text.optional(), title: text.optional(), plan: text }).strict()).default([]),
}).strict();
export type NovelResult = z.infer<typeof resultSchema>;
export function parseNovelResult(output: string) {
  try { return resultSchema.parse(parseJSON(output)); }
  catch { throw new Error('AI 返回的调整格式无效，请重新生成'); }
}
export const hasNovelChanges = (result: NovelResult) => !!Object.keys(result.project ?? {}).length || !!result.notes.length || !!result.removeNoteIds.length || !!result.chapters.length;
export const novelFields = { title: '书名', genre: '题材', form: '形式', targetWords: '目标字数', theme: '主题', audience: '读者定位', synopsis: '简介', outline: '故事总纲' } as const;

function editableContent(project: Project) {
  return { ...Object.fromEntries(Object.keys(novelFields).map(key => [key, project[key as keyof typeof novelFields]])), notes: project.notes.filter(note => editableNoteKinds.includes(note.kind as typeof editableNoteKinds[number])).map(({ graphPosition: _, ...note }) => note), chapters: project.chapters.map(({ id, title, plan }) => ({ id, title, plan })) };
}
export function novelSnapshot(project: Project) {
  return contentHash(JSON.stringify({ ...editableContent(project), references: project.referenceIds, skills: project.skillIds, continuity: project.notes.filter(note => !editableNoteKinds.includes(note.kind as typeof editableNoteKinds[number])), manuscripts: project.chapters.map(({ id, content, summary }) => ({ id, content: contentHash(content), summary })) }));
}

export function novelContext(state: Workspace, job: Job) {
  const project = state.projects.find(value => value.id === job.projectId);
  if (!project || !job.novelChat) throw new Error('小说已移除');
  const history = job.novelChat.previousJobIds.map(id => state.jobs.find(value => value.id === id && value.projectId === project.id && value.novelChat)).filter((value): value is Job => !!value);
  const latestProposal = [...history].reverse().find(value => value.status === 'ready');
  return '\n当前小说：\n' + JSON.stringify({ ...editableContent(project), continuity: project.notes.filter(note => !editableNoteKinds.includes(note.kind as typeof editableNoteKinds[number])), manuscripts: project.chapters.map(chapter => ({ id: chapter.id, summary: chapter.summary, contentHash: contentHash(chapter.content), excerpt: chapter.content.slice(0, 1200) + (chapter.content.length > 2400 ? '\n[正文中段省略]\n' : '') + chapter.content.slice(Math.max(1200, chapter.content.length - 1200)), excerpted: chapter.content.length > 2400 })) })
    + '\n此前对话（当前小说为已采用内容，完整保留最近的待采用方案，其余为历史摘要）：\n' + JSON.stringify(history.map(value => ({ author: value === latestProposal ? value.instruction : value.instruction.slice(0, 800), authorExcerpted: value !== latestProposal && value.instruction.length > 800, response: value === latestProposal ? value.steps[0].output : parseNovelResult(value.steps[0].output).reply, adopted: value.status === 'accepted' && !value.novelChat?.undone, undone: !!value.novelChat?.undone })))
    + '\n选用参考资料：\n' + JSON.stringify(state.references.filter(reference => project.referenceIds.includes(reference.id)).map(({ title, content }) => ({ title, content })));
}

// Build on a detached project so validation failures cannot partially change live data.
export function applyNovelResult(project: Project, result: NovelResult): Project {
  const next = structuredClone(project);
  const seen = new Set<string>();
  for (const id of [...result.notes.flatMap(note => note.id ? [note.id] : []), ...result.removeNoteIds, ...result.chapters.flatMap(chapter => chapter.id ? [chapter.id] : [])]) {
    if (seen.has(id)) throw new Error('调整结果包含重复记录');
    seen.add(id);
  }
  for (const id of result.removeNoteIds) {
    const note = next.notes.find(value => value.id === id);
    if (!note || !editableNoteKinds.includes(note.kind as typeof editableNoteKinds[number])) throw new Error('不能移除该记录');
  }
  // Pin legacy name-based links before renaming characters.
  const originalCharacters = next.notes.filter(note => note.kind === 'character');
  next.notes.forEach(note => { if (note.kind === 'relation' && !note.relation) note.relation = resolveCharacterRelation(note, originalCharacters); });
  next.notes = next.notes.filter(note => !result.removeNoteIds.includes(note.id));
  Object.assign(next, result.project);
  const relations: { note: Note; source?: string; target?: string }[] = [];
  for (const patch of result.notes) {
    let note = patch.id ? next.notes.find(value => value.id === patch.id) : undefined;
    if (patch.id && (!note || note.kind !== patch.kind)) throw new Error('设定记录已变更，请重新调整');
    if (!note) {
      if (next.notes.some(value => value.kind === patch.kind && value.title === patch.title && patch.kind !== 'relation')) throw new Error(`已有同名${patch.kind === 'character' ? '人物' : '卡片'}：${patch.title}，请沿用原记录`);
      note = { id: uid(), kind: patch.kind, title: patch.title, body: patch.body, chapterId: '', status: 'planned' };
      next.notes.push(note);
    } else Object.assign(note, { title: patch.title, body: patch.body });
    if (patch.kind === 'relation') relations.push({ note, source: patch.source, target: patch.target });
    else if (patch.source || patch.target) throw new Error('只有人物关系可指定关系双方');
  }
  const characters = next.notes.filter(note => note.kind === 'character');
  for (const patch of result.notes.filter(note => note.kind === 'character')) {
    if (characters.filter(note => note.title === patch.title).length !== 1) throw new Error(`人物姓名重复：${patch.title}`);
  }
  for (const { note, source, target } of relations) {
    const from = characters.filter(value => value.title === source), to = characters.filter(value => value.title === target);
    if (from.length !== 1 || to.length !== 1 || from[0].id === to[0].id) throw new Error(`人物关系「${note.title}」的双方无效`);
    note.relation = { sourceId: from[0].id, targetId: to[0].id };
  }
  for (const note of next.notes.filter(note => note.kind === 'relation')) {
    if (note.relation && [note.relation.sourceId, note.relation.targetId].some(id => !characters.some(character => character.id === id))) throw new Error(`请同步调整人物关系「${note.title}」`);
  }
  for (const patch of result.chapters) {
    const chapter = patch.id ? next.chapters.find(value => value.id === patch.id) : newChapter(patch.title);
    if (!chapter) throw new Error('章节已移除，请重新调整');
    if (!patch.id && !patch.title) throw new Error('新章节需要标题');
    chapter.plan = patch.plan;
    if (patch.title) chapter.title = patch.title;
    chapter.updatedAt = now();
    if (!patch.id) next.chapters.push(chapter);
  }
  next.updatedAt = now();
  return next;
}

export function acceptNovel(state: Workspace, job: Job) {
  const project = state.projects.find(value => value.id === job.projectId);
  if (!project || !job.novelChat) throw new Error('小说已移除');
  if (novelSnapshot(project) !== job.novelChat.base) throw new Error('小说内容已更新，请重新调整');
  const result = parseNovelResult(job.steps[0].output);
  if (!hasNovelChanges(result)) throw new Error('暂无可采用的调整');
  const next = applyNovelResult(project, result);
  job.novelChat.before = JSON.stringify(editableContent(project));
  Object.assign(project, next);
  job.novelChat.appliedBase = novelSnapshot(project);
}

export function undoNovel(state: Workspace, job: Job) {
  const project = state.projects.find(value => value.id === job.projectId), chat = job.novelChat;
  if (!project || job.status !== 'accepted' || !chat?.before || chat.undone) throw new Error('暂无可撤销的调整');
  if (novelSnapshot(project) !== chat.appliedBase) throw new Error('小说内容已更新，无法撤销此次调整');
  const saved = JSON.parse(chat.before) as ReturnType<typeof editableContent>;
  const { notes, chapters, ...fields } = saved;
  const positions = new Map(project.notes.map(note => [note.id, note.graphPosition]));
  project.notes = [...notes.map(note => ({ ...note, graphPosition: positions.get(note.id) })), ...project.notes.filter(note => !editableNoteKinds.includes(note.kind as typeof editableNoteKinds[number]))];
  project.chapters = chapters.map(chapter => ({ ...project.chapters.find(value => value.id === chapter.id)!, ...chapter, updatedAt: now() }));
  Object.assign(project, fields, { updatedAt: now() });
  chat.undone = true;
}
