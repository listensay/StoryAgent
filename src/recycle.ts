import { now, type Workspace, type Job } from './domain';
import { purgeChapterMemory } from './memory';

export function trashProject(s: Workspace, id: string, polishing: readonly string[]) {
  const index = s.projects.findIndex(p => p.id === id), project = s.projects[index];
  if (!project) throw new Error('小说已移除');
  const jobs = s.jobs.filter(j => j.projectId === id);
  if (jobs.some(j => ['running', 'queued'].includes(j.status)) || project.chapters.some(c => polishing.includes(c.id))) throw new Error('请先停止本书运行中的任务');
  (s.deletedProjects ??= []).unshift({ project, jobs, index, deletedAt: now() });
  s.projects.splice(index, 1); s.jobs = s.jobs.filter(j => j.projectId !== id);
  if (s.activeProjectId === id) s.activeProjectId = '';
}
function restoreJobs(s: Workspace, jobs: Job[]) {
  if (jobs.some(j => s.jobs.some(existing => existing.id === j.id))) throw new Error('存在同标识的任务，无法恢复');
  s.jobs = [...s.jobs, ...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function restoreDeleted(s: Workspace, projectId: string, chapterId?: string) {
  if (!chapterId) {
    const item = s.deletedProjects?.find(d => d.project.id === projectId);
    if (!item || s.projects.some(p => p.id === projectId)) throw new Error('小说不存在或已恢复');
    restoreJobs(s, item.jobs); s.projects.splice(Math.min(item.index, s.projects.length), 0, item.project);
    s.deletedProjects = s.deletedProjects?.filter(d => d !== item); return;
  }
  const p = s.projects.find(p => p.id === projectId);
  const item = s.deletedChapters?.find(d => d.projectId === projectId && d.chapter.id === chapterId);
  if (!p) throw new Error('请先恢复所属小说');
  if (!item || p.chapters.some(c => c.id === chapterId)) throw new Error('章节不存在或已恢复');
  if (item.notes.some(n => p.notes.some(existing => existing.id === n.id))) throw new Error('存在同标识的记录，无法恢复');
  const next = p.chapters.findIndex(c => c.id === item.nextId), prev = p.chapters.findIndex(c => c.id === item.prevId);
  restoreJobs(s, item.jobs); p.chapters.splice(next >= 0 ? next : prev >= 0 ? prev + 1 : Math.min(item.index, p.chapters.length), 0, item.chapter);
  p.notes.push(...item.notes); for (const n of p.notes) if (!n.chapterId && item.linkedNoteIds.includes(n.id)) n.chapterId = chapterId;
  p.updatedAt = now(); s.deletedChapters = s.deletedChapters?.filter(d => d !== item);
}
export function purgeDeleted(s: Workspace, projectId: string, chapterId?: string) {
  if (chapterId) {
    const project = s.projects.find(p => p.id === projectId) ?? s.deletedProjects?.find(d => d.project.id === projectId)?.project;
    if (!s.deletedChapters?.some(d => d.projectId === projectId && d.chapter.id === chapterId) || project?.chapters.some(c => c.id === chapterId)) throw new Error('章节已恢复或移除');
    if (project) purgeChapterMemory(project, chapterId);
    s.deletedChapters = s.deletedChapters.filter(d => d.projectId !== projectId || d.chapter.id !== chapterId);
  } else {
    if (!s.deletedProjects?.some(d => d.project.id === projectId) || s.projects.some(p => p.id === projectId)) throw new Error('小说已恢复或移除');
    s.deletedProjects = s.deletedProjects.filter(d => d.project.id !== projectId);
    s.deletedChapters = s.deletedChapters?.filter(d => d.projectId !== projectId);
  }
}
