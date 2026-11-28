import { now, snapshot, taskNames, uid, type Chapter, type Job, type JobStep, type Workspace } from './domain';
import { canAcceptWritingStep, requireIdleWriting } from './jobWorkflow';
import { textDiff } from './textDiff';

export const isManuscript = (job: Job, step: JobStep) => !step.intermediate && ['draft', 'continue', 'rewrite'].includes(job.kind);
type Paragraph = { gap: string; body: string; index: number };
export type PassageChange = { before?: Paragraph; after?: Paragraph; changed: boolean };
export type Choices = Map<number, string | undefined>;

// Keep the actual separators and indentation; an untouched passage must round-trip verbatim.
function paragraphs(text: string): Paragraph[] {
  const parts: Paragraph[] = [];
  let end = 0;
  for (const line of text.matchAll(/[^\r\n]+/g)) {
    if (!line[0].trim()) continue;
    const offset = line.index!;
    parts.push({ gap: text.slice(end, offset), body: line[0], index: parts.length });
    end = offset + line[0].length;
  }
  if (parts.length) parts[parts.length - 1].body += text.slice(end);
  else if (text) parts.push({ gap: '', body: text, index: 0 });
  return parts;
}

export function passageChanges(job: Job, step: JobStep): PassageChange[] {
  const base = job.kind === 'continue' ? '' : job.kind === 'rewrite' && step.selection ? step.selection : step.baseContent;
  const a = paragraphs(base), b = paragraphs(step.output);
  // Anchor unchanged paragraphs first; pair replacements only within each changed run.
  const keys = (list: Paragraph[]) => list.map(p => JSON.stringify(p.body)).join('\n');
  const [left, right] = textDiff(keys(a), keys(b));
  const rows: PassageChange[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    const from = i, to = j;
    while (left[i]?.changed) i++;
    while (right[j]?.changed) j++;
    for (let k = 0; k < Math.max(i - from, j - to); k++) rows.push({ before: from + k < i ? a[from + k] : undefined, after: to + k < j ? b[to + k] : undefined, changed: true });
    if (i < a.length && j < b.length) {
      rows.push({ before: a[i], after: b[j], changed: a[i].gap !== b[j].gap });
      i++; j++;
    }
  }
  return rows;
}

export function mergedManuscript(job: Job, step: JobStep, rows: PassageChange[], choices: Choices) {
  const kept = rows.flatMap((row, i) => {
    const picked = choices.has(i), paragraph = picked ? row.after : row.before;
    return paragraph ? [{ ...paragraph, body: (picked ? choices.get(i) : undefined) ?? paragraph.body }] : [];
  });
  const passage = kept.map((p, i) => (i ? p.gap || '\n\n' : p.index === 0 ? p.gap : '') + p.body).join('');
  if (job.kind === 'continue') return step.baseContent + (step.baseContent && passage ? '\n\n' : '') + passage;
  if (job.kind === 'rewrite' && step.selection) return step.baseContent.slice(0, step.selectionStart) + passage + step.baseContent.slice(step.selectionEnd);
  return passage;
}

export function previousChoices(step: JobStep): Choices {
  const edits = new Map(step.paragraphAdoption?.edits?.map(e => [e.index, e.text]));
  return new Map(step.paragraphAdoption?.selected.map(i => [i, edits.get(i)]));
}
export function canAdoptMore(job: Job, step: JobStep) {
  return !!step.paragraphAdoption && step.status === 'accepted' && isManuscript(job, step) && step.paragraphAdoption.selected.length < passageChanges(job, step).filter(r => r.changed).length;
}
export function manuscriptCheckpoint(chapter: Chapter, label: string) {
  if (chapter.content || chapter.versions[0]?.content === '') return snapshot(chapter, label);
  return { ...chapter, versions: [{ id: uid(), label, content: '', createdAt: now() }, ...chapter.versions].slice(0, 100) };
}

export function adoptPassages(state: Workspace, reviewedJob: Job, reviewedStep: JobStep, choices: Choices, includePlan: boolean, expectedPlan?: string) {
  const job = state.jobs.find(j => j.id === reviewedJob.id), step = job?.steps.find(s => s.id === reviewedStep.id);
  if (!job || !step || !isManuscript(job, step) || (!canAcceptWritingStep(job, step) && !canAdoptMore(job, step)) || job.projectId !== reviewedJob.projectId || job.kind !== reviewedJob.kind ||
    (['chapterId', 'output', 'baseContent', 'selection', 'selectionStart', 'selectionEnd'] as const).some(key => step[key] !== reviewedStep[key])) throw new Error('生成稿已变更，请重新对照');
  if (!step.output.trim()) throw new Error('生成结果为空');
  requireIdleWriting(state.jobs, job.projectId, [step.chapterId]);
  const project = state.projects.find(p => p.id === job.projectId), chapter = project?.chapters.find(c => c.id === step.chapterId);
  if (!project || !chapter) throw new Error('章节已移除');
  const expected = step.paragraphAdoption?.content ?? step.baseContent;
  if (expected !== (reviewedStep.paragraphAdoption?.content ?? reviewedStep.baseContent) || chapter.content !== expected || (!step.paragraphAdoption && job.kind === 'rewrite' && step.selection && chapter.content.slice(step.selectionStart, step.selectionEnd) !== step.selection)) throw new Error('正文已更新，请重新生成或手动合并');
  const rows = passageChanges(job, step);
  if (!choices.size || [...choices].some(([i, edit]) => !rows[i]?.changed || (edit !== undefined && (!edit.trim() || !rows[i].after)))) throw new Error('请选择有效的段落修改');
  const plan = job.steps.find(s => s.chapterId === chapter.id && s.stage === 'plan');
  if (includePlan && (!plan || plan.output !== expectedPlan || step.basePlan !== reviewedStep.basePlan || chapter.plan !== step.basePlan)) throw new Error('细纲已更新，请重新对照');
  const combined = previousChoices(step);
  if (step.paragraphAdoption && mergedManuscript(job, step, rows, combined) !== expected) throw new Error('无法还原上次采用的段落，请手动合并');
  for (const [i, edit] of choices) { if (combined.has(i)) throw new Error('所选段落已采用'); combined.set(i, edit); }
  const content = mergedManuscript(job, step, rows, combined);
  if (content === chapter.content) throw new Error('正文没有变化');
  const before = manuscriptCheckpoint(chapter, `${taskNames[job.kind]}采用前`), updatedAt = now();
  Object.assign(chapter, before, { content, summary: '', memoryHash: undefined, updatedAt });
  if (includePlan && plan) { chapter.plan = plan.output; plan.status = 'accepted'; }
  // The generated summary and memory describe the whole proposal, not the author's merge.
  step.paragraphAdoption = { selected: [...combined.keys()].sort((a, b) => a - b), edits: [...combined].flatMap(([index, text]) => text === undefined ? [] : [{ index, text }]), content };
  step.status = 'accepted';
  if (job.steps.filter(s => !s.intermediate).every(s => s.status === 'accepted')) job.status = 'accepted';
  project.updatedAt = updatedAt;
}
