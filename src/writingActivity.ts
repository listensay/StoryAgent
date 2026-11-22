import { taskNames, type Job, type JobStep } from './domain';

const stageNames: Record<string, string> = { plan: '细纲', draft: '正文', continue: '续写', rewrite: '改写', summary: '摘要', memory: '记忆' };

export const writingStageName = (job: Job, step: JobStep) => stageNames[step.stage ?? ''] ?? taskNames[job.kind];

export function writingExecutionSummary(job: Job, step: JobStep) {
  const stage = step.stage ?? job.kind;
  if (stage === 'plan') return '根据小说设定与故事总纲整理本章事件、场景和人物变化。';
  if (stage === 'summary') return '读取本章生成稿，整理关键事件、人物变化与未解悬念。';
  if (stage === 'memory') return '读取本章生成稿，提取正文事实、人物状态、时间线与伏笔。';
  if (stage === 'review') return '读取章节正文与小说资料，检查表达、情节和跨章连续性。';
  if (stage === 'rewrite') return step.selection ? '读取选中片段及前后文，按创作要求改写。' : '读取本章正文，按创作要求改写并保留事件衔接。';
  if (stage === 'continue') return '读取本章正文、章节计划与前文记忆，接续当前情节。';
  return '读取小说设定、章节计划与前文记忆，按创作要求生成正文。';
}

export function writingCompleted(job: Job) {
  return ['ready', 'accepted'].includes(job.status) && job.steps.length > 0 && job.steps.every(step => ['ready', 'accepted'].includes(step.status));
}
