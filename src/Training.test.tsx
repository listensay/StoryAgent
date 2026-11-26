import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createJob, emptyWorkspace, type TrainingAnnotation } from './domain';
import { finishTrainingStep, initializeTraining, recordEvaluation, trainingReview } from './training';
import { Training } from './pages/Training';
import { parseSkills } from './skills';
import type { Store } from './useWorkspace';

function setup() {
  const state = emptyWorkspace(), skill = parseSkills([{ path: 'SKILL.md', content: '---\nname: dialogue\ndescription: 对白训练\n---\n以具体动作承接对白。' }], '测试')[0];
  state.skills.push(skill);
  const job = createJob(undefined, 'train', null, undefined, '');
  job.sourceTitle = skill.name; job.status = 'waiting';
  job.training = { skillId: skill.id, initialSkill: skill.files[0].content, bestSkill: skill.files[0].content, bestScore: -1, targetScore: 8.5, judge: 'human', mode: 'chapter', original: '原文中的人物有所犹豫。', cases: [{ title: '第一章', brief: '描写人物的犹豫。', original: '' }], evaluations: [] };
  initializeTraining(job); job.steps[0].status = 'accepted'; job.steps[0].output = '生成稿中的人物立即行动。'; state.jobs.push(job);
  const review = trainingReview(job, 1);
  const store = { state, stateRef: { current: state }, notify: vi.fn(), update: vi.fn() } as unknown as Store;
  const render = () => renderToStaticMarkup(<MantineProvider><Training store={store} onSettings={vi.fn()} focusJobId={job.id} /></MantineProvider>);
  return { job, review, render };
}
const action = (html: string, label: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(match => match[0].includes(label))?.[0];
const annotation: TrainingAnnotation = { target: 'candidate', caseIndex: 0, start: 0, end: 3, quote: '生成稿', feedback: '动作缺少犹豫。' };

describe('训练反馈提交与可见内容', () => {
  it('手写整体反馈无需评分即可继续或结束训练', () => {
    const { review, render } = setup(); review.feedback = '这句话的语气不符合人物处境。';
    const html = render();
    expect(html).toContain('生成稿评分（选填）'); expect(html).toContain(review.feedback);
    for (const label of ['继续训练', '结束训练']) { expect(action(html, label)).toBeDefined(); expect(action(html, label)).not.toContain('disabled'); }
  });
  it('只有片段评价也能提交，评价和引文直接可见且可编辑', () => {
    const { review, render } = setup(); review.annotations.push(annotation);
    const html = render();
    for (const text of ['片段评价 · 1', annotation.quote, annotation.feedback, '编辑评价 1', '删除评价 1']) expect(html).toContain(text);
    expect(action(html, '继续训练')).not.toContain('disabled');
  });
  it('空反馈保持提交按钮禁用，完整评分仍能直接提交', () => {
    const { review, render } = setup();
    expect(action(render(), '继续训练')).toContain('disabled');
    review.scores = [6.5]; expect(action(render(), '继续训练')).not.toContain('disabled');
  });
  it('历史反馈完整展示整体内容、引文与评价，隐藏编辑操作', () => {
    const { job, render } = setup();
    recordEvaluation(job, job.steps[1], { scores: [''], feedback: '第一行反馈\n第二行反馈', annotations: [annotation], decision: 'auto', satisfied: true }); job.status = 'accepted';
    const html = render();
    for (const text of ['已提交反馈', '第一行反馈\n第二行反馈', annotation.quote, annotation.feedback, '已确认 Skill']) expect(html).toContain(text);
    expect(html).not.toContain('编辑评价 1'); expect(html).not.toContain('删除评价 1'); expect(html).not.toContain('-1.0');
  });
  it('各轮提供 Skill 查看入口，未评分的修订轮次也能查看改动', () => {
    const { job, render } = setup();
    expect(action(render(), '查看本轮 Skill')).toBeDefined();
    recordEvaluation(job, job.steps[1], { scores: [''], feedback: '保留犹豫的动作。', annotations: [], decision: 'auto', satisfied: false });
    const revision = job.steps[job.steps.length - 1]; revision.output = job.training!.initialSkill + '\n掩饰意图时用动作呈现迟疑。'; finishTrainingStep(job, revision);
    job.steps.find(part => part.stage === 'train-write' && part.round === 2)!.status = 'accepted'; job.status = 'waiting';
    const html = render();
    expect(action(html, '查看 Skill 改动')).toBeDefined();
    expect(html).toContain('文本问题与 Skill 调整建议');
    expect(job.training!.bestScore).toBe(-1);
  });
});
