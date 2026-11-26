import { createJob, type AIConfig, type Project, type TaskKind } from './domain';

// Historical backups can contain range jobs that the current launcher no longer creates.
export function legacyWritingJob(project: Project, kind: TaskKind, ai: AIConfig | null, chapterIds: string[], instruction: string) {
  const jobs = chapterIds.map(chapterId => createJob(project, kind, ai, chapterId, instruction));
  return { ...jobs[0], steps: jobs.flatMap(job => job.steps) };
}
