import { type Job, type Note, type Project, noteNames } from './domain';
import { novelFields, novelSnapshot, type NovelResult } from './novelAssistant';
import { resolveCharacterRelation } from './characterRelations';

type Before = Pick<Project, keyof typeof novelFields> & { notes: Note[]; chapters: Pick<Project['chapters'][number], 'id' | 'title' | 'plan'>[] };
export type NovelChange = { id: string; title: string; left: string; right: string; available: boolean };

export function novelChanges(job: Job, project: Project, result: NovelResult): NovelChange[] {
  let before: Before | undefined;
  try {
    if (job.novelChat?.before) {
      const saved = JSON.parse(job.novelChat.before) as Before;
      if (Array.isArray(saved?.notes) && Array.isArray(saved?.chapters)) before = saved;
    }
  } catch { /* Legacy records can lack the original content. */ }
  if (!before && job.novelChat?.base === novelSnapshot(project)) before = project;
  const fieldText = (key: string, value: unknown) => value === undefined ? '' : key === 'form' ? value === 'long' ? '长篇' : '短篇' : String(value);
  const noteText = (note?: Note) => {
    if (!note) return '';
    const relation = note.kind === 'relation' ? resolveCharacterRelation(note, before?.notes ?? []) : undefined;
    const source = before?.notes.find(value => value.id === relation?.sourceId)?.title;
    const target = before?.notes.find(value => value.id === relation?.targetId)?.title;
    return [note.title, source && target ? `${source} → ${target}` : '', note.body].filter(Boolean).join('\n\n');
  };
  const chapterText = (chapter?: { title?: string; plan: string }) => chapter ? [chapter.title, chapter.plan].filter(Boolean).join('\n\n') : '';
  return [
    ...Object.entries(result.project ?? {}).map(([key, value]) => ({ id: key, title: novelFields[key as keyof typeof novelFields], left: fieldText(key, before?.[key as keyof typeof novelFields]), right: fieldText(key, value), available: !!before })),
    ...result.notes.map((note, index) => ({ id: `note-${index}`, title: `${note.id ? '更新' : '新增'}${noteNames[note.kind]} · ${note.title}`, left: noteText(before?.notes.find(value => value.id === note.id)), right: [note.title, note.source && note.target ? `${note.source} → ${note.target}` : '', note.body].filter(Boolean).join('\n\n'), available: !note.id || !!before })),
    ...result.chapters.map((chapter, index) => { const original = before?.chapters.find(value => value.id === chapter.id); return { id: `chapter-${index}`, title: `${chapter.id && !chapter.plan ? '清空章节计划' : `${chapter.id ? '更新' : '新增'}章节`} · ${chapter.title ?? original?.title ?? project.chapters.find(value => value.id === chapter.id)?.title ?? '章节计划'}`, left: chapterText(original), right: chapterText({ title: chapter.title ?? original?.title, plan: chapter.plan }), available: !chapter.id || !!before }; }),
    ...result.removeNoteIds.map(id => { const note = before?.notes.find(value => value.id === id); return { id: `remove-${id}`, title: `移除 · ${note?.title ?? '旧设定'}`, left: noteText(note), right: '', available: !!before }; }),
    ...result.removeChapterIds.map(id => { const chapter = before?.chapters.find(value => value.id === id); return { id: `remove-chapter-${id}`, title: `移除章节 · ${chapter?.title ?? '旧章节'}`, left: chapterText(chapter), right: '', available: !!before }; }),
  ];
}
