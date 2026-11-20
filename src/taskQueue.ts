import type { Job, Provider } from './domain';

export function runnableJobs(jobs: Job[], providers: Provider[], active: Set<string>): string[] {
  const counts = new Map<string, number>();
  for (const job of jobs) if (active.has(job.id)) { const key = job.ai?.providerId ?? 'collection'; counts.set(key, (counts.get(key) ?? 0) + 1); }
  const result: string[] = [];
  const books = new Set(jobs.filter(j => active.has(j.id)).map(j => j.collectionTask?.bookUrl).filter(Boolean));
  for (const job of [...jobs].reverse()) {
    if (job.status !== 'queued' || active.has(job.id)) continue;
    if (job.collectionTask && books.has(job.collectionTask.bookUrl)) continue;
    const key = job.ai?.providerId ?? 'collection';
    const limit = job.ai ? providers.find(p => p.id === key)?.concurrency ?? 2 : 3;
    if ((counts.get(key) ?? 0) >= limit) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1); result.push(job.id);
    if (job.collectionTask) books.add(job.collectionTask.bookUrl);
  }
  return result;
}
