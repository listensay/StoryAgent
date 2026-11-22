import { describe, expect, it, vi } from 'vitest';
import { createJob, emptyWorkspace, parseWorkspace, type Job, type JobStep, type TrainingAnnotation } from './domain';
import { parseSkills } from './skills';
import { applyBestSkill, finishTrainingStep, initializeTraining, parseEvaluation, recordEvaluation, scenarioTraining, trainingPrompt, validateTraining } from './training';
import { AIRequestQueue, runJobSteps } from './stepQueue';
const rules = '---\nname: narrative\ndescription: 通用创作规则\n---\n先建立人物目标，再引入有代价的阻碍。';
const original = '城市里的钟表忽然全部停摆，主角林舟从旧信封里发现了一张通往未来的车票，但背面写着他十年前遗失的姓名。他赶到车站，发现售票员早已知道他的来意。';
const brief = '林舟发现钟表停摆，获得通往未来的车票，票背出现旧姓名。他为查明身份赶到车站，遇到知晓他来意的售票员。第三人称，篇幅约80字。';
const transfers = ['科幻飞船补给不足，舰长必须在救援与返航之间做出选择。', '边关军医缺少药材，必须说服对手开放商路救治伤员。', '社区厨师面临停业，需要在宴席开始前重建邻里的信任。'];
function setup(mode: 'chapter' | 'scenario' = 'chapter') {
  const state = emptyWorkspace(), skill = parseSkills([{ path: 'SKILL.md', content: rules }], '测试')[0]; state.skills.push(skill);
  const job = createJob(undefined, 'train', null, [], '');
  job.sourceText = '不应泄漏的参考资料'; job.sourceTitle = '原作标题';
  job.training = validateTraining({ skillId: skill.id, initialSkill: rules, bestSkill: rules, bestScore: -1, targetScore: 9, maxRounds: 3, judge: 'human', mode, chapterTitle: '第一章', original, cases: [], evaluations: [] });
  initializeTraining(job); state.jobs.push(job); return { state, skill, job };
}
const judge = (job: Job, round = 1) => job.steps.find(s => s.stage === 'train-judge' && s.round === round)!;
function prepare(job: Job) {
  job.steps[0].output = JSON.stringify(job.training!.mode === 'scenario' ? { transfers } : { brief });
  finishTrainingStep(job, job.steps[0]);
}
function write(job: Job, round = 1, content = '林舟拿起车票。他走到车站。售票员问他想去哪里。') {
  for (const part of job.steps.filter(s => s.stage === 'train-write' && s.round === round)) { part.output = content; finishTrainingStep(job, part); }
}
function score(job: Job, scores: number[], feedback = '冲突推进不足', satisfied = false, annotations: TrainingAnnotation[] = []) {
  const part = job.steps.find(s => s.stage === 'train-judge' && s.status === 'pending')!;
  recordEvaluation(job, part, { scores, feedback, satisfied, annotations, decision: 'auto' });
}
function pendingRequest(signal: AbortSignal) {
  let resolve!: (value: string) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  const abort = () => reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  return { resolve, reject, promise: promise.finally(() => signal.removeEventListener('abort', abort)) };
}
function runTraining(job: Job, request: (step: JobStep, prompt: string, signal: AbortSignal) => Promise<string>, signal = new AbortController().signal, limit = 10) {
  const queue = new AIRequestQueue(() => limit);
  return runJobSteps(() => job, () => limit, signal, async (id, stepSignal) => {
    const part = job.steps.find(s => s.id === id)!;
    if (part.stage === 'train-judge') { job.status = 'waiting'; return 'waiting'; }
    await queue.run('training-provider', stepSignal, async () => {
      part.status = 'running'; part.output = await request(part, trainingPrompt(job, part).user, stepSignal); stepSignal.throwIfAborted(); finishTrainingStep(job, part);
    });
  });
}
describe('原文章节训练与用户反馈', () => {
  it('先提炼所选章节的内容，再只用 Skill 和提示词生成，始终等待用户评分', async () => {
    const { job } = setup(), stages: string[] = [];
    await expect(runTraining(job, async (part, prompt) => {
      stages.push(part.stage!);
      if (part.stage === 'train-brief') {
        expect(prompt).toContain(original); expect(prompt).toContain('第一章'); expect(prompt).toContain('不改成其他人物或新的场景');
        return JSON.stringify({ brief });
      }
      expect(prompt).toContain(rules); expect(prompt).toContain(brief);
      for (const secret of [original, job.sourceText, job.sourceTitle]) expect(prompt).not.toContain(secret);
      return '本轮生成稿';
    })).resolves.toBe('waiting');
    expect(stages).toEqual(['train-brief', 'train-write']);
    expect(job.training!.cases).toEqual([{ title: '第一章', brief, original: '' }]);
    expect(job.training!.evaluations).toHaveLength(0); expect(job.training!.bestScore).toBe(-1);
    expect(() => trainingPrompt(job, judge(job))).toThrow('仅支持用户评分');
    judge(job).output = '{"scores":[10],"feedback":"AI意见","decision":"keep"}';
    expect(() => finishTrainingStep(job, judge(job))).toThrow('仅支持用户评分');
  });
  it('无效提炼不会进入生成，修复后不重复追加步骤', () => {
    const { job } = setup(), part = job.steps[0];
    for (const value of ['not json', {}, { brief: ' ' }, { brief: '字'.repeat(8001) }, { brief: original }]) {
      part.output = JSON.stringify(value); expect(() => finishTrainingStep(job, part)).toThrow();
      expect(job.training!.cases).toHaveLength(0); expect(job.steps).toHaveLength(1); expect(part.status).toBe('pending');
    }
    prepare(job); expect(job.steps).toHaveLength(3); finishTrainingStep(job, part); expect(job.steps).toHaveLength(3);
  });
  it('评分须完整、有效且在生成结束后提交，拒绝重复评分', () => {
    const { job } = setup(); prepare(job);
    expect(() => score(job, [5])).toThrow('等待本轮生成完成'); write(job);
    for (const scores of [[11], [-1], [], [5, 6], [NaN]]) expect(() => score(job, scores)).toThrow();
    expect(job.training!.evaluations).toHaveLength(0);
    score(job, [0], '', true); expect(job.training!.bestScore).toBe(0);
    expect(() => recordEvaluation(job, judge(job), { scores: [9], feedback: '', decision: 'auto' })).toThrow('已评分');
  });
  it('整体反馈和原文、生成稿的准确划词片段交给 AI 调整 Skill，下一轮不携带旧稿', () => {
    const { job } = setup(); prepare(job); write(job);
    const annotations: TrainingAnnotation[] = [
      { caseIndex: 0, target: 'original', start: 0, end: 7, quote: original.slice(0, 7), feedback: '保留开头的异常感' },
      { caseIndex: 0, target: 'candidate', start: 0, end: 8, quote: '林舟拿起车票。他', feedback: '动作衔接过于平直' },
    ];
    score(job, [4], '人物对白缺少辨识度', false, annotations);
    const revision = job.steps[job.steps.length - 1]!;
    const prompt = trainingPrompt(job, revision).user;
    for (const evidence of [original, '林舟拿起车票', '人物对白缺少辨识度', '保留开头的异常感', '动作衔接过于平直', '"score":4']) expect(prompt).toContain(evidence);
    expect(job.training!.evaluations[0]).toMatchObject({ source: 'human', scores: [4], annotations });
    revision.output = rules + '\n用动作变化打断对白，保留信息差。'; finishTrainingStep(job, revision);
    const writer = trainingPrompt(job, job.steps.find(s => s.stage === 'train-write' && s.round === 2)!).user;
    expect(writer).toContain(revision.output); expect(writer).toContain(brief);
    for (const secret of [original, '人物对白缺少辨识度', '动作衔接过于平直', '林舟拿起车票']) expect(writer).not.toContain(secret);
  });
  it.each(['quote', 'offset', 'caseIndex', 'empty'])('拒绝失效的划词评价：%s', reason => {
    const { job } = setup(); prepare(job); write(job);
    const annotation: TrainingAnnotation = { caseIndex: 0, target: 'original', start: 0, end: 2, quote: original.slice(0, 2), feedback: '节奏需保留' };
    if (reason === 'quote') annotation.quote = '错误';
    if (reason === 'offset') annotation.start = 1;
    if (reason === 'caseIndex') annotation.caseIndex = 1;
    if (reason === 'empty') annotation.feedback = ' ';
    expect(() => score(job, [5], '', false, [annotation])).toThrow(); expect(job.training!.evaluations).toHaveLength(0);
    expect(judge(job).status).toBe('pending'); expect(job.steps.some(s => s.stage === 'train-revise')).toBe(false);
  });
  it('达到目标分仍由用户决定是否结束，不以高分开放其他场景', () => {
    const { job, state } = setup(); prepare(job); write(job); score(job, [10]);
    expect(job.training!.approvedAt).toBeUndefined(); expect(job.steps[job.steps.length - 1]?.stage).toBe('train-revise');
    expect(() => scenarioTraining(state, job.id)).toThrow('确认章节训练效果满意');
  });
  it('保留最佳已评版本，到轮数上限结束，Skill 同时编辑时不覆盖', () => {
    const { state, skill, job } = setup(); job.training!.maxRounds = 2; prepare(job); write(job); score(job, [8]);
    const revision = job.steps[job.steps.length - 1]!; revision.output = rules + '\n调整规则。'; finishTrainingStep(job, revision); write(job, 2); score(job, [5]);
    expect(job.training!.bestScore).toBe(8); expect(job.training!.bestSkill).toBe(rules); expect(job.steps.some(s => s.round === 3)).toBe(false);
    applyBestSkill(state, job); expect(skill.revisions).toHaveLength(0);
    job.training!.bestSkill = revision.output; skill.files[0].content = '用户新编辑'; expect(() => applyBestSkill(state, job)).toThrow('已更新');
    skill.files[0].content = rules; applyBestSkill(state, job); applyBestSkill(state, job);
    expect(skill.files[0].content).toBe(revision.output); expect(skill.revisions).toHaveLength(1);
  });
  it('无效优化或包含原文的 Skill 不进入下一轮', () => {
    const { job } = setup(); prepare(job); write(job); score(job, [5]); const revision = job.steps[job.steps.length - 1]!;
    revision.output = '不是 Skill'; expect(() => finishTrainingStep(job, revision)).toThrow('元数据');
    revision.output = rules + original; expect(() => finishTrainingStep(job, revision)).toThrow('原文段落');
    expect(job.steps.some(s => s.round === 2)).toBe(false);
  });
  it('提炼、评分、划词评价与满意确认均可保存恢复，旧 AI 任务恢复改为用户评分', () => {
    const { state, job } = setup();
    expect(parseWorkspace(JSON.stringify(state)).jobs[0].steps[0].stage).toBe('train-brief');
    prepare(job); write(job); score(job, [9], '满足要求', true, [{ target: 'original', caseIndex: 0, start: 0, end: 2, quote: original.slice(0, 2), feedback: '保留' }]);
    const restored = parseWorkspace(JSON.stringify(state)).jobs[0];
    expect(restored.training).toEqual(job.training); expect(restored.training?.approvedAt).toBeTruthy();
    const legacy = JSON.parse(JSON.stringify(state)); legacy.jobs[0].training.judge = 'ai'; legacy.jobs[0].training.evaluations[0].source = 'ai';
    expect(parseWorkspace(JSON.stringify(legacy)).jobs[0].training).toMatchObject({ judge: 'human', evaluations: [{ source: 'ai' }] });
    const oldPending = JSON.parse(JSON.stringify(setup().state)); delete oldPending.jobs[0].training.mode; oldPending.jobs[0].training.judge = 'ai'; oldPending.jobs[0].steps[0].stage = 'train-scenarios';
    expect(parseWorkspace(JSON.stringify(oldPending)).jobs[0].steps[0].stage).toBe('train-brief');
  });
  it('新任务拒绝 AI 评分、空原文、多个章节，清空旧评分与满意标记', () => {
    const { job } = setup(), training = job.training!;
    expect(() => validateTraining({ ...training, maxRounds: 11 })).toThrow();
    expect(() => validateTraining({ ...training, original: '' })).toThrow();
    expect(() => validateTraining({ ...training, judge: 'ai' as 'human' })).toThrow();
    expect(() => validateTraining({ ...training, cases: [1, 2].map(i => ({ title: String(i), brief, original: '' })) })).toThrow('仅使用所选原文章节');
    expect(() => validateTraining({ ...training, initialSkill: rules + original })).toThrow('原文段落');
    expect(validateTraining({ ...training, bestScore: 10, bestSkill: '旧最佳', approvedAt: '旧标记' })).toMatchObject({ bestScore: -1, bestSkill: rules, evaluations: [], approvedAt: undefined });
    expect(() => parseEvaluation('{"scores":[1,2],"feedback":"","decision":"auto"}', 1)).toThrow('数量');
  });
});
describe('用户确认后进行其他场景训练', () => {
  it('须明确满意、训练完成且使用已验证版本，场景训练不能再解锁下一阶段', () => {
    const { state, job, skill } = setup(); prepare(job); write(job); score(job, [9], '', true);
    expect(() => scenarioTraining(state, job.id)).toThrow('确认章节训练效果满意'); job.status = 'accepted';
    const next = scenarioTraining(state, job.id);
    expect(next).toMatchObject({ mode: 'scenario', parentJobId: job.id, original, initialSkill: rules, cases: [], evaluations: [], bestScore: -1 });
    skill.files[0].content = '用户后续编辑'; expect(() => scenarioTraining(state, job.id)).toThrow('先采用');
    skill.files[0].content = rules; job.training!.mode = 'scenario'; expect(() => scenarioTraining(state, job.id)).toThrow('先确认');
  });
  it.each([2, 10])('其他场景并发遵守上限 %i，全部请求结束才等待用户评分', async limit => {
    const { job } = setup('scenario'), requests = new Map<string, ReturnType<typeof pendingRequest>>();
    const request = vi.fn(async (part: JobStep, prompt: string, signal: AbortSignal) => {
      if (part.stage === 'train-scenarios') return JSON.stringify({ transfers });
      expect(part.stage).toBe('train-write'); expect(prompt).not.toContain(original);
      const pending = pendingRequest(signal); requests.set(part.id, pending); return pending.promise;
    });
    const run = runTraining(job, request, new AbortController().signal, limit);
    await vi.waitFor(() => expect(requests.size).toBe(Math.min(limit, 3)));
    const writers = job.steps.filter(s => s.stage === 'train-write');
    for (let completed = 0; completed < 3; completed++) {
      const active = writers.filter(s => s.status === 'running'); expect(active).toHaveLength(Math.min(limit, 3 - completed));
      requests.get(active[active.length - 1]!.id)!.resolve('独立场景生成稿');
      await vi.waitFor(() => expect(writers.filter(s => s.status === 'accepted')).toHaveLength(completed + 1));
      await vi.waitFor(() => expect(requests.size).toBe(Math.min(3, completed + 1 + limit)));
    }
    await expect(run).resolves.toBe('waiting'); expect(request).toHaveBeenCalledTimes(4); expect(judge(job).status).toBe('pending');
    score(job, [9, 9, 10], '', true); expect(job.steps.every(s => s.status === 'accepted')).toBe(true);
  });
  it('已提交生成结果但请求未结束时，仍不得进入用户评分', async () => {
    const { job } = setup('scenario'); prepare(job); const requests = new Map<string, ReturnType<typeof pendingRequest>>();
    const execute = vi.fn(async (id: string, signal: AbortSignal) => {
      const part = job.steps.find(s => s.id === id)!; if (part.stage === 'train-judge') return 'waiting' as const;
      const pending = pendingRequest(signal); requests.set(id, pending); part.output = '已提交正文'; finishTrainingStep(job, part); await pending.promise;
    });
    const run = runJobSteps(() => job, () => 10, new AbortController().signal, execute);
    await vi.waitFor(() => expect(requests.size).toBe(3)); const ids = [...requests.keys()];
    requests.get(ids[1])!.resolve(''); requests.get(ids[2])!.resolve(''); await new Promise(resolve => setTimeout(resolve, 0));
    expect(execute).toHaveBeenCalledTimes(3); requests.get(ids[0])!.resolve(''); await expect(run).resolves.toBe('waiting');
  });
  it.each(['failure', 'abort'])('%s 后恢复保留已完成的场景，完成后等待用户评分', async reason => {
    const { job } = setup('scenario'), controller = new AbortController(), requests = new Map<string, ReturnType<typeof pendingRequest>>();
    const run = runTraining(job, async (part, _prompt, signal) => {
      if (part.stage === 'train-scenarios') return JSON.stringify({ transfers });
      if (part.caseIndex === 0) return '停止前的正文';
      const pending = pendingRequest(signal); requests.set(part.id, pending); return pending.promise;
    }, controller.signal);
    const failure = expect(run).rejects.toThrow(reason === 'failure' ? '请求失败' : '停止训练');
    await vi.waitFor(() => expect(requests.size).toBe(2));
    if (reason === 'failure') [...requests.values()][0].reject(new Error('请求失败')); else controller.abort(new Error('停止训练')); await failure;
    const completed = job.steps.find(s => s.stage === 'train-write' && s.caseIndex === 0)!;
    expect(completed).toMatchObject({ status: 'accepted', output: '停止前的正文' }); job.steps.forEach(s => { if (s.status === 'running') s.status = 'pending'; });
    const resume = vi.fn(async (part: JobStep) => { expect(part.id).not.toBe(completed.id); return '恢复后的正文'; });
    await expect(runTraining(job, resume)).resolves.toBe('waiting'); expect(resume).toHaveBeenCalledTimes(2); expect(judge(job).status).toBe('pending');
  });
});
