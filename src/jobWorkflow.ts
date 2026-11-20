import { z } from 'zod';
import { acceptedChapter, now, uid, type Job, type JobStep, type Project, type Workspace } from './domain';
import { parseSkills } from './skills';

export function contentHash(text: string) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function needsMemory(state: Workspace, project: Project, chapter: Project['chapters'][number]) {
  return !!chapter.content.trim() && chapter.memoryHash !== contentHash(chapter.content) && !state.jobs.some(j => j.projectId === project.id && (
    (j.kind === 'memory' && j.status !== 'accepted' && j.steps.some(p => p.chapterId === chapter.id && p.baseContent === chapter.content)) ||
    (['draft', 'continue', 'rewrite'].includes(j.kind) && ['queued', 'running'].includes(j.status) && j.steps.some(p => p.chapterId === chapter.id))
  ));
}

const memorySchema = z.object({ summary: z.string().default(''), notes: z.array(z.object({ kind: z.enum(['fact', 'state', 'timeline', 'foreshadow', 'knowledge']), title: z.string(), body: z.string() })) });
export const parseJSON = (text: string) => JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
export const parseMemory = (text: string) => memorySchema.parse(parseJSON(text));
const preparationSchema = z.object({ theme: z.string(), audience: z.string(), synopsis: z.string(), outline: z.string(), notes: z.array(z.object({ kind: z.enum(['character', 'relation', 'world']), title: z.string(), body: z.string() })) });
export const parsePreparation = (text: string) => preparationSchema.parse(parseJSON(text));
export const preparationSnapshot = (p: Project) => JSON.stringify({ title: p.title, genre: p.genre, targetWords: p.targetWords, theme: p.theme, audience: p.audience, synopsis: p.synopsis, outline: p.outline, notes: p.notes, referenceIds: p.referenceIds, skillIds: p.skillIds });
export function requirePreparation(project?: Project) {
  if (!project?.title.trim() || !project.genre.trim() || !Number.isInteger(project.targetWords) || project.targetWords < 1) throw new Error('请填写书名、题材和目标字数');
}
export function prepareWriting(job: Job) {
  if (!['draft', 'continue', 'rewrite'].includes(job.kind)) return;
  job.steps = job.steps.flatMap(step => [
    ...(job.kind === 'draft' ? [{ ...step, id: uid(), title: `${step.title} · 细纲`, stage: 'plan', intermediate: true }] : []),
    { ...step, stage: job.kind },
    { ...step, id: uid(), title: `${step.title} · 摘要`, stage: 'summary', intermediate: true },
    { ...step, id: uid(), title: `${step.title} · 记忆`, stage: 'memory', intermediate: true },
  ]);
}
export function writingStep(job: Job, step: JobStep): JobStep {
  const related = job.steps.filter(s => s.chapterId === step.chapterId);
  const plan = related.find(s => s.stage === 'plan');
  if (['draft', 'continue', 'rewrite'].includes(step.stage ?? '')) return { ...step, basePlan: plan?.output || step.basePlan };
  if (['summary', 'memory'].includes(step.stage ?? '')) {
    const draft = related.find(s => ['draft', 'continue', 'rewrite'].includes(s.stage ?? ''));
    if (draft) return { ...step, baseContent: proposedContent(job, draft), basePlan: '', section: '', selection: '' };
  }
  return step;
}
export function proposedContent(job: Job, step: JobStep) {
  if (job.kind === 'continue') return step.baseContent + (step.baseContent ? '\n\n' : '') + step.output;
  if (job.kind === 'rewrite' && step.selection) return step.baseContent.slice(0, step.selectionStart) + step.output + step.baseContent.slice(step.selectionEnd);
  return step.output;
}
export function acceptWriting(state: Workspace, job: Job, step: JobStep) {
  const project = state.projects.find(p => p.id === job.projectId);
  const chapter = project?.chapters.find(c => c.id === step.chapterId);
  if (!project || !chapter) throw new Error('小说或章节已移除');
  const related = job.steps.filter(s => s.chapterId === chapter.id);
  const plan = related.find(s => s.stage === 'plan');
  const summary = related.find(s => s.stage === 'summary');
  const memory = related.find(s => s.stage === 'memory');
  if (step.stage && (!summary || !memory || [summary, memory].some(s => s.status !== 'ready'))) throw new Error('摘要与记忆尚未完成');
  if (plan && chapter.plan !== step.basePlan) throw new Error('细纲已更新，请重新生成或手动合并');
  const updated = acceptedChapter(chapter, job, step);
  if (plan) updated.plan = plan.output;
  if (summary) updated.summary = summary.output;
  if (memory) {
    const result = parseMemory(memory.output);
    project.notes = project.notes.filter(n => n.chapterId !== chapter.id || !['fact', 'state', 'timeline', 'foreshadow', 'knowledge'].includes(n.kind));
    project.notes.push(...result.notes.map(n => ({ ...n, id: uid(), chapterId: chapter.id, status: 'confirmed' as const })));
    updated.memoryHash = contentHash(updated.content);
  }
  project.chapters = project.chapters.map(c => c.id === chapter.id ? updated : c);
  related.forEach(s => { s.status = 'accepted'; });
}
export function acceptPreparation(state: Workspace, job: Job, step: JobStep) {
  const project = state.projects.find(p => p.id === job.projectId);
  if (!project) throw new Error('小说已移除');
  if (job.preparationBase !== preparationSnapshot(project)) throw new Error('创作准备已更新，请重新生成或手动合并');
  const result = parsePreparation(step.output);
  for (const key of ['theme', 'audience', 'synopsis', 'outline'] as const) if (!project[key].trim()) project[key] = result[key];
  for (const note of result.notes) if (!project.notes.some(n => n.kind === note.kind && n.title === note.title)) project.notes.push({ ...note, id: uid(), chapterId: '', status: 'planned' });
}
export function saveExtractedSkill(state: Workspace, job: Job, output: string) {
  const id = `extracted-${job.id}`;
  if (state.skills.some(s => s.id === id)) return;
  const content = output.trim().replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```$/, '');
  const parsed = parseSkills([{ path: 'SKILL.md', content }], job.sourceTitle)[0];
  state.skills.unshift({ ...parsed, id, name: `${job.sourceTitle || parsed.name} · Skill`, originReferenceId: job.sourceId, version: '1.0', enabled: false, tasks: ['draft', 'continue', 'rewrite', 'plan'] });
}
export function finishAutomaticStep(state: Workspace, job: Job, step: JobStep) {
  if (job.kind === 'style' && !step.intermediate) { saveExtractedSkill(state, job, step.output); step.status = 'accepted'; }
  if (job.kind === 'memory' && !step.intermediate) {
    const project = state.projects.find(p => p.id === job.projectId), chapter = project?.chapters.find(c => c.id === step.chapterId);
    if (!project || !chapter || chapter.content !== step.baseContent) throw new Error('正文已更新，请重新生成记忆');
    const memory = parseMemory(step.output); chapter.summary = memory.summary;
    chapter.memoryHash = contentHash(chapter.content);
    project.notes = project.notes.filter(n => n.chapterId !== chapter.id || !['fact', 'state', 'timeline', 'foreshadow', 'knowledge'].includes(n.kind));
    project.notes.push(...memory.notes.map(n => ({ ...n, id: uid(), chapterId: chapter.id, status: 'confirmed' as const })));
    project.updatedAt = now(); step.status = 'accepted';
  }
}
