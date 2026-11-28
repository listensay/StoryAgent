import { z } from 'zod';
import { acceptedChapter, now, uid, type Job, type JobStep, type Project, type Workspace } from './domain';
import { parseSkills } from './skills';
import { archiveSkill } from './skillVersions';
import { relationByNames, resolveCharacterRelation } from './characterRelations';
import { composedSkillText, extractedSkillFiles, parseSkillComposition, parseSkillResearch, skillSnapshot } from './skillExtraction';
import { researchText } from './skillExtractionData';
import { contentHash, memoryResultSchema } from './memoryData';
import { storeMemory } from './memory';

export { contentHash } from './memoryData';
export function needsMemory(state: Workspace, project: Project, chapter: Project['chapters'][number]) {
  return !!chapter.content.trim() && chapter.memoryHash !== contentHash(chapter.content) && !state.jobs.some(j => j.projectId === project.id && (
    (j.kind === 'memory' && ['queued', 'running', 'ready'].includes(j.status) && j.steps.some(p => p.chapterId === chapter.id && p.baseContent === chapter.content)) ||
    (['draft', 'continue', 'rewrite'].includes(j.kind) && ['queued', 'running'].includes(j.status) && j.steps.some(p => p.chapterId === chapter.id))
  ));
}

export const parseJSON = (text: string) => JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
export const parseMemory = (text: string) => memoryResultSchema.parse(parseJSON(text));
const preparationSchema = z.object({ theme: z.string(), audience: z.string(), synopsis: z.string(), outline: z.string(), notes: z.array(z.object({ kind: z.enum(['character', 'relation', 'world']), title: z.string(), body: z.string(), source: z.string().optional(), target: z.string().optional() })) });
export const parsePreparation = (text: string) => preparationSchema.parse(parseJSON(text));
export const preparationSnapshot = (p: Project) => JSON.stringify({ title: p.title, genre: p.genre, targetWords: p.targetWords, theme: p.theme, audience: p.audience, synopsis: p.synopsis, outline: p.outline, notes: p.notes.map(({ graphPosition: _, ...note }) => note), referenceIds: p.referenceIds, skillIds: p.skillIds });
export function requirePreparation(project?: Project) {
  if (!project?.title.trim() || !project.genre.trim() || !Number.isInteger(project.targetWords) || project.targetWords < 1) throw new Error('请填写书名、题材和目标字数');
}
export function openWriting(state: Workspace, projectId: string) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  state.activeProjectId = project.id;
  return project.chapters.find(chapter => chapter.id === project.writingChapterId) ?? project.chapters[project.chapters.length - 1];
}
export function prepareWriting(job: Job) {
  if (!['draft', 'continue', 'rewrite'].includes(job.kind)) return;
  job.steps = job.steps.flatMap(step => [
    ...(job.kind === 'draft' && !step.basePlan.trim() ? [{ ...step, id: uid(), title: `${step.title} · 细纲`, stage: 'plan', intermediate: true }] : []),
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
export function writingComparison(job: Job, step: JobStep, project?: Project) {
  const chapter = project?.chapters.find(c => c.id === step.chapterId);
  const plan = step.stage === 'plan' || job.kind === 'plan';
  return {
    left: plan ? chapter?.plan ?? step.basePlan : chapter?.content ?? step.baseContent,
    right: plan ? step.output : proposedContent(job, step),
    leftTitle: plan ? step.chapterId ? '当前细纲' : '当前总纲' : '当前正文',
    rightTitle: plan ? step.chapterId ? '生成细纲' : '生成总纲' : '生成正文',
  };
}
export function canAcceptWritingStep(job: Job, step: JobStep) {
  return step.status === 'ready' && !step.intermediate && (!step.stage || job.steps.filter(s => s.chapterId === step.chapterId).every(s => ['ready', 'accepted'].includes(s.status)));
}
export function requireIdleWriting(jobs: Job[], projectId: string, chapterIds: string[], exceptId?: string) {
  if (jobs.some(job => job.id !== exceptId && job.projectId === projectId && ['draft', 'continue', 'rewrite'].includes(job.kind) && ['queued', 'running'].includes(job.status) && job.steps.some(step => chapterIds.includes(step.chapterId)))) throw new Error('所选章节正在生成，请等待完成或停止任务');
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
  if ((plan || job.kind === 'draft') && chapter.plan !== step.basePlan) throw new Error('细纲已更新，请重新生成或手动合并');
  const updated = acceptedChapter(chapter, job, step);
  if (plan) updated.plan = plan.output;
  if (summary) updated.summary = summary.output;
  if (memory) {
    storeMemory(project, updated, parseMemory(memory.output));
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
  for (const note of result.notes.filter(note => note.kind !== 'relation')) if (!project.notes.some(n => n.kind === note.kind && n.title === note.title)) project.notes.push({ kind: note.kind, title: note.title, body: note.body, id: uid(), chapterId: '', status: 'planned' });
  const characters = project.notes.filter(note => note.kind === 'character');
  for (const note of result.notes.filter(note => note.kind === 'relation')) {
    const named = note.source !== undefined || note.target !== undefined;
    const relation = named ? relationByNames(note.source ?? '', note.target ?? '', characters) ?? { sourceId: '', targetId: '' } : undefined;
    const saved = { id: uid(), kind: 'relation' as const, title: note.title, body: note.body, chapterId: '', status: 'planned' as const, relation };
    saved.relation ??= resolveCharacterRelation(saved, characters);
    if (named && !relation?.sourceId) saved.body = `${note.source ?? ''}、${note.target ?? ''}\n\n${note.body}`;
    const pair = (value: typeof relation) => value ? JSON.stringify([value.sourceId, value.targetId].sort()) : '';
    if (!project.notes.some(existing => existing.kind === 'relation' && existing.title === saved.title && pair(resolveCharacterRelation(existing, characters)) === pair(saved.relation))) project.notes.push(saved);
  }
}
export function saveExtractedSkill(state: Workspace, job: Job, output: string) {
  const id = job.skillTarget?.id ?? `extracted-${job.id}`;
  if (state.skills.some(s => s.extractionJobId === job.id || (!job.skillTarget && s.id === id))) return;
  const existing = state.skills.find(skill => skill.id === id);
  if (job.skillTarget && (!existing || skillSnapshot(existing) !== job.skillTarget.snapshot)) throw new Error('Skill 已更新，请重新提取');
  const files = extractedSkillFiles(job, output);
  const parsed = parseSkills(files, job.sourceTitle)[0];
  const skill: typeof parsed = { ...parsed, id, extractionJobId: job.id, name: existing?.name ?? `${job.sourceTitle || parsed.name} · Skill`, originReferenceId: job.sourceId, version: existing ? now() : '1.0', enabled: existing?.enabled ?? false, tasks: existing?.tasks ?? ['draft', 'continue', 'rewrite', 'plan'], revisions: existing ? archiveSkill(existing) : [] };
  if (existing) state.skills[state.skills.indexOf(existing)] = skill;
  else state.skills.unshift(skill);
}
export function finishAutomaticStep(state: Workspace, job: Job, step: JobStep) {
  if (job.kind === 'style' && step.stage === 'style-research' && (!step.research || step.output !== researchText(step.research))) {
    step.research = parseSkillResearch(step.output, step.section);
    step.output = researchText(step.research);
  }
  if (job.kind === 'style' && !step.intermediate) {
    if (step.stage === 'style-compose' && step.output.trim().startsWith('{')) step.output = composedSkillText(parseSkillComposition(step.output, job));
    saveExtractedSkill(state, job, step.output); step.status = 'accepted';
  }
  if (job.kind === 'memory' && !step.intermediate) {
    const project = state.projects.find(p => p.id === job.projectId), chapter = project?.chapters.find(c => c.id === step.chapterId);
    if (!project || !chapter || chapter.content !== step.baseContent) throw new Error('正文已更新，请重新生成记忆');
    const memory = parseMemory(step.output);
    storeMemory(project, chapter, memory); chapter.summary = memory.summary;
    project.updatedAt = now(); step.status = 'accepted';
  }
}
