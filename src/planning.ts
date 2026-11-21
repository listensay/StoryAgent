import { z } from 'zod';
import { now, uid, type Job, type JobStep, type Project, type Workspace } from './domain';

const resultSchema = z.object({
  reply: z.string().trim().min(1),
  outline: z.string().trim().min(1).optional(),
  notes: z.array(z.object({ id: z.string().optional(), kind: z.enum(['volume', 'scene', 'branch']), title: z.string().trim().min(1), body: z.string().trim().min(1) })).default([]),
  chapters: z.array(z.object({ id: z.string(), plan: z.string().trim().min(1) })).default([]),
});
export type PlanningResult = z.infer<typeof resultSchema>;
export const parsePlanningResult = (text: string) => resultSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')));
export const hasPlanningChanges = (result: PlanningResult) => result.outline !== undefined || result.notes.length > 0 || result.chapters.length > 0;
export const planningSnapshot = (project: Project) => JSON.stringify({ outline: project.outline, notes: project.notes.filter(note => ['volume', 'scene', 'branch'].includes(note.kind)), chapters: project.chapters.map(({ id, title, plan }) => ({ id, title, plan })) });
export const planningRules = '与作者对话调整故事规划。讨论或提问时只填写 reply；提出具体修改时，reply 简述调整，并提供修改项的完整内容。只修改作者要求的部分；结合对话中上一版方案继续调整，未采用方案不视为已确认设定。修改总纲用 outline，修改卷纲、场景或情节分支用 notes，修改已有章节计划用 chapters。已有记录必须沿用 id 与 kind，新增 notes 省略 id；不得编造章节 id，不支持删除记录。省略未修改字段。仅输出 JSON：{"reply":"回复","outline":"修改后的完整总纲（可省略）","notes":[{"id":"已有记录 ID（新增时省略）","kind":"volume|scene|branch","title":"名称","body":"完整内容"}],"chapters":[{"id":"已有章节 ID","plan":"完整章节计划"}]}。';

export function planningContext(state: Workspace, job: Job) {
  const project = state.projects.find(value => value.id === job.projectId);
  if (!project || !job.planningChat) throw new Error('故事规划已移除');
  const history = job.planningChat.previousJobIds.map(id => state.jobs.find(value => value.id === id && value.projectId === job.projectId && value.planningChat)).filter((value): value is Job => !!value);
  return '\n当前故事规划：\n' + planningSnapshot(project) + '\n此前对话：\n' + JSON.stringify(history.map(value => ({ author: value.instruction, response: value.steps[0].output, adopted: value.status === 'accepted' })));
}

export function acceptPlanning(state: Workspace, job: Job, step: JobStep) {
  const project = state.projects.find(value => value.id === job.projectId);
  if (!project) throw new Error('小说已移除');
  if (planningSnapshot(project) !== job.planningChat?.base) throw new Error('故事规划已更新，请重新调整');
  const result = parsePlanningResult(step.output);
  if (!hasPlanningChanges(result)) throw new Error('暂无可采用的调整');
  const ids = [...result.notes.flatMap(note => note.id ? [note.id] : []), ...result.chapters.map(chapter => chapter.id)];
  if (new Set(ids).size !== ids.length) throw new Error('调整结果包含重复记录，请重新调整');
  // Validate every reference before applying any part of the proposal.
  for (const note of result.notes) if (note.id && !project.notes.some(value => value.id === note.id && value.kind === note.kind)) throw new Error('计划记录已变更，请重新调整');
  for (const chapter of result.chapters) if (!project.chapters.some(value => value.id === chapter.id)) throw new Error('章节已移除，请重新调整');
  if (result.outline !== undefined) project.outline = result.outline;
  for (const note of result.notes) {
    if (note.id) Object.assign(project.notes.find(value => value.id === note.id)!, { title: note.title, body: note.body });
    else project.notes.push({ ...note, id: uid(), chapterId: '', status: 'planned' });
  }
  for (const chapter of result.chapters) Object.assign(project.chapters.find(value => value.id === chapter.id)!, { plan: chapter.plan, updatedAt: now() });
}
