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
  project.chapters = project.chapters.filter(chapter => chapter.id !== id);
  project.notes = project.notes.filter(note => note.chapterId !== id || !['fact', 'state', 'timeline', 'foreshadow', 'knowledge'].includes(note.kind));
  for (const note of project.notes) if (note.chapterId === id) note.chapterId = '';
  project.updatedAt = now();
}
