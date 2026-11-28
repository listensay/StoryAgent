import { now, type Chapter, type Project, type Workspace } from './domain';

export type ChapterDropPosition = 'before' | 'after';

export function chapterDropIndex(chapters: Chapter[], draggedId: string, targetId: string, position: ChapterDropPosition) {
  const from = chapters.findIndex(chapter => chapter.id === draggedId);
  const target = chapters.findIndex(chapter => chapter.id === targetId);
  if (from < 0 || target < 0 || from === target) return undefined;
  return target + (position === 'after' ? 1 : 0) - (from < target ? 1 : 0);
}

export function moveChapter(project: Project, id: string, index: number) {
  const from = project.chapters.findIndex(chapter => chapter.id === id);
  if (from < 0) throw new Error('章节已移除');
  if (!Number.isInteger(index)) throw new Error('章节位置无效');
  const destination = Math.max(0, Math.min(project.chapters.length - 1, index));
  if (from === destination) return;
  const [chapter] = project.chapters.splice(from, 1);
  project.chapters.splice(destination, 0, chapter);
  project.updatedAt = now();
}

export function requireIdleChapters(state: Workspace, projectId: string, ids: string[]) {
  if (state.jobs.some(job => job.projectId === projectId && ['queued', 'running'].includes(job.status) && job.steps.some(step => ids.includes(step.chapterId)))) throw new Error('所选章节正在生成，请等待完成或停止任务');
}

export function removeChapter(state: Workspace, projectId: string, id: string) {
  const project = state.projects.find(project => project.id === projectId);
  if (!project?.chapters.some(chapter => chapter.id === id)) throw new Error('章节已移除');
  requireIdleChapters(state, projectId, [id]);
  const index = project.chapters.findIndex(c => c.id === id), chapter = project.chapters[index];
  const memory = new Set(['fact', 'state', 'timeline', 'foreshadow', 'knowledge']);
  const linked = project.notes.filter(n => n.chapterId === id);
  const jobs = state.jobs.filter(j => j.projectId === projectId && j.steps.length && j.steps.every(step => step.chapterId === id));
  (state.deletedChapters ??= []).unshift({ projectId, chapter, index, nextId: project.chapters[index + 1]?.id, prevId: project.chapters[index - 1]?.id, notes: linked.filter(n => memory.has(n.kind)), linkedNoteIds: linked.filter(n => !memory.has(n.kind)).map(n => n.id), jobs, deletedAt: now() });
  state.jobs = state.jobs.filter(j => !jobs.includes(j));
  project.chapters.splice(index, 1);
  project.notes = project.notes.filter(note => note.chapterId !== id || !memory.has(note.kind));
  for (const note of project.notes) if (note.chapterId === id) note.chapterId = '';
  project.updatedAt = now();
}
