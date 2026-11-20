import { describe, expect, it, vi } from 'vitest';
import { createJob, emptyWorkspace, parseWorkspace, type Job, type JobStep } from './domain';
import { parseSkills } from './skills';
import { applyBestSkill, finishTrainingStep, initializeTraining, parseEvaluation, recordEvaluation, trainingPrompt, validateTraining } from './training';
import { AIRequestQueue, runJobSteps } from './stepQueue';
const rules = '---\nname: narrative\ndescription: 通用创作规则\n---\n先建立人物目标，再引入有代价的阻碍。';
const original = '绝密原文章节，城市里的钟表忽然全部停摆，主角从旧信封里发现了一张通往未来的车票，但背面写着他十年前遗失的姓名。';
function setup() {
  const state = emptyWorkspace(); const skill = parseSkills([{ path: 'SKILL.md', content: rules }], '测试')[0]; state.skills.push(skill);
  const job = createJob(undefined, 'train', null, [], '');
  job.sourceText = '不应泄漏的参考资料'; job.sourceTitle = '原作标题';
  job.training = { skillId: skill.id, initialSkill: rules, bestSkill: rules, bestScore: -1, targetScore: 9, maxRounds: 3, judge: 'ai', cases: [{ title: '仿写', brief: '陌生人带来一封需要付出代价才能打开的信。', original }, { title: '迁移', brief: '科幻飞船补给不足，舰长面临抉择。', original: '' }], evaluations: [] };
  initializeTraining(job); return { state, skill, job };
}
const judge = (job: Job, round: number) => job.steps.find(s => s.stage === 'train-judge' && s.round === round)!;
const generatedScenarios = { imitation: '修表学徒必须在交付前揭露师傅隐瞒的故障，否则将失去学徒资格。', transfers: ['科幻飞船补给不足，舰长必须在救援与返航之间做出选择。', '边关军医缺少药材，必须说服对手开放商路救治伤员。', '社区厨师面临停业，需要在宴席开始前重建邻里的信任。'] };
function setupAutomatic() {
  const fixture = setup();
  fixture.job.training = validateTraining({ ...fixture.job.training!, original, cases: [] });
  initializeTraining(fixture.job);
  return fixture;
}
function pendingRequest(signal: AbortSignal) {
  let resolve!: (value: string) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  const abort = () => reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return { resolve, reject, promise: promise.finally(() => signal.removeEventListener('abort', abort)) };
}
function runTraining(job: Job, queue: AIRequestQueue, signal: AbortSignal, request: (step: JobStep, prompt: string, signal: AbortSignal) => Promise<string>, limit = 10) {
  return runJobSteps(() => job, () => limit, signal, async (id, stepSignal) => {
    const part = job.steps.find(s => s.id === id)!;
    if (part.stage === 'train-judge' && job.training!.judge === 'human') return 'waiting';
    await queue.run('training-provider', stepSignal, async () => {
      part.status = 'running';
      part.output = await request(part, trainingPrompt(job, part).user, stepSignal);
      stepSignal.throwIfAborted();
      finishTrainingStep(job, part);
    });
  });
}
describe('Skill 训练并发调度', () => {
  it.each([2, 10])('遵守并发上限 %i，空位立即补充，场景、评分和优化按阶段执行', async limit => {
    const { job } = setupAutomatic(), requests = new Map<string, ReturnType<typeof pendingRequest>>();
    const revised = rules + '\n冲突应体现选择的后果。';
    const request = vi.fn(async (part: JobStep, prompt: string, signal: AbortSignal) => {
      if (part.stage === 'train-write') expect(prompt).toContain(part.round === 1 ? rules : revised);
      if (part.stage === 'train-judge') for (let i = 0; i < 4; i++) expect(prompt).toContain(`第${part.round}轮场景${i}正文`);
      const pending = pendingRequest(signal); requests.set(part.id, pending); return pending.promise;
    });
    const run = runTraining(job, new AIRequestQueue(() => limit), new AbortController().signal, request, limit);
    const scenario = job.steps[0];
    await vi.waitFor(() => expect(requests.size).toBe(1));
    expect(job.steps).toHaveLength(1);
    requests.get(scenario.id)!.resolve(JSON.stringify(generatedScenarios));
    for (const round of [1, 2]) {
      await vi.waitFor(() => expect(job.steps.filter(s => s.stage === 'train-write' && s.round === round && requests.has(s.id))).toHaveLength(Math.min(limit, 4)));
      const writers = job.steps.filter(s => s.stage === 'train-write' && s.round === round);
      for (let completed = 0; completed < 4; completed++) {
        expect(requests.has(judge(job, round).id)).toBe(false);
        const active = writers.filter(s => s.status === 'running');
        expect(active).toHaveLength(Math.min(limit, 4 - completed));
        // Finish out of order, leaving the first writer slowest.
        const part = active[active.length - 1];
        requests.get(part.id)!.resolve(`第${round}轮场景${part.caseIndex}正文`);
        await vi.waitFor(() => expect(part.status).toBe('accepted'));
        await vi.waitFor(() => expect(writers.filter(s => requests.has(s.id))).toHaveLength(Math.min(4, completed + 1 + limit)));
      }
      const score = judge(job, round);
      await vi.waitFor(() => expect(requests.has(score.id)).toBe(true));
      expect(job.steps.some(s => s.stage === 'train-revise' && s.round === round)).toBe(false);
      requests.get(score.id)!.resolve(JSON.stringify({ scores: Array(4).fill(round === 1 ? 4 : 9), feedback: '改进冲突', decision: 'keep' }));
      if (round === 1) {
        await vi.waitFor(() => expect(request.mock.calls.some(([s]) => s.stage === 'train-revise')).toBe(true));
        expect(job.steps.some(s => s.round === 2)).toBe(false);
        const revision = job.steps.find(s => s.stage === 'train-revise')!;
        requests.get(revision.id)!.resolve(revised);
      }
    }
    await run;
    expect(request).toHaveBeenCalledTimes(12);
    expect(job.training!.bestSkill).toBe(revised);
    expect(job.steps.every(s => s.status === 'accepted')).toBe(true);
  });

  it('所有场景请求结束后才进入人工评分，包括已提交结果但尚未结束的请求', async () => {
    const { job } = setup(); job.training!.judge = 'human';
    const requests = new Map<string, ReturnType<typeof pendingRequest>>();
    const execute = vi.fn(async (id: string, signal: AbortSignal) => {
      const part = job.steps.find(s => s.id === id)!;
      if (part.stage === 'train-judge') return 'waiting' as const;
      const pending = pendingRequest(signal); requests.set(id, pending);
      part.output = '已提交的正文'; finishTrainingStep(job, part);
      await pending.promise;
    });
    const run = runJobSteps(() => job, () => 10, new AbortController().signal, execute);
    await vi.waitFor(() => expect(requests.size).toBe(2));
    requests.get(job.steps[1].id)!.resolve('');
    // Allow the scheduler to refill while the first accepted writer is still active.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(execute).toHaveBeenCalledTimes(2);
    requests.get(job.steps[0].id)!.resolve('');
    await expect(run).resolves.toBe('waiting');
    expect(execute).toHaveBeenCalledTimes(3);
    expect(judge(job, 1).status).toBe('pending');
  });

  it.each(['failure', 'abort'])('%s 后恢复只并发重试未完成场景，评分保留已完成正文', async reason => {
    const { job } = setupAutomatic(), queue = new AIRequestQueue(() => 10), controller = new AbortController();
    const requests = new Map<string, ReturnType<typeof pendingRequest>>();
    const run = runTraining(job, queue, controller.signal, async (part, _prompt, signal) => {
      if (part.stage === 'train-scenarios') return JSON.stringify(generatedScenarios);
      if (part.caseIndex === 0) return '停止前的正文';
      const pending = pendingRequest(signal); requests.set(part.id, pending); return pending.promise;
    });
    const failure = expect(run).rejects.toThrow(reason === 'failure' ? '请求失败' : '停止训练');
    await vi.waitFor(() => expect(requests.size).toBe(3));
    if (reason === 'failure') [...requests.values()][0].reject(new Error('请求失败'));
    else controller.abort(new Error('停止训练'));
    await failure;
    const completed = job.steps.find(s => s.stage === 'train-write' && s.caseIndex === 0)!;
    expect(completed).toMatchObject({ status: 'accepted', output: '停止前的正文' });
    expect(requests.has(judge(job, 1).id)).toBe(false);
    job.steps.forEach(s => { if (s.status === 'running') s.status = 'pending'; });
    const remaining = new Map<string, ReturnType<typeof pendingRequest>>();
    const resume = runTraining(job, queue, new AbortController().signal, async (part, prompt, signal) => {
      expect(part.id).not.toBe(completed.id);
      if (part.stage === 'train-judge') {
        expect(prompt).toContain('停止前的正文');
        return '{"scores":[9,9,9,9],"feedback":"达到目标","decision":"keep"}';
      }
      const pending = pendingRequest(signal); remaining.set(part.id, pending); return pending.promise;
    });
    await vi.waitFor(() => expect(remaining.size).toBe(3));
    remaining.forEach(pending => pending.resolve('恢复后的正文'));
    await resume;
    expect(job.steps.every(s => s.status === 'accepted')).toBe(true);
  });
});
describe('Skill 盲测与优化', () => {
  it('自动生成场景后执行仿写、迁移与评分，写作请求不携带原文', async () => {
    const { job } = setupAutomatic();
    expect(job.steps.map(s => s.stage)).toEqual(['train-scenarios']);
    const stages: string[] = [];
    await runJobSteps(() => job, () => 10, new AbortController().signal, async id => {
      const part = job.steps.find(s => s.id === id)!;
      stages.push(part.stage!);
      const prompt = trainingPrompt(job, part).user;
      if (part.stage === 'train-scenarios') {
        expect(prompt).toContain(original); expect(prompt).toContain(rules);
        part.output = JSON.stringify(generatedScenarios);
      } else if (part.stage === 'train-write') {
        expect(prompt).toContain(job.training!.cases[part.caseIndex!].brief);
        expect(prompt).not.toContain(original); expect(prompt).not.toContain(job.sourceTitle);
        part.output = `场景 ${part.caseIndex} 正文`;
      } else {
        expect(prompt).toContain(original); expect(prompt).toContain('场景 3 正文');
        part.output = '{"scores":[9,9,9,9],"feedback":"达到目标","decision":"keep"}';
      }
      finishTrainingStep(job, part);
    });
    expect(stages).toEqual(['train-scenarios', 'train-write', 'train-write', 'train-write', 'train-write', 'train-judge']);
    expect(job.training!.cases.map(c => c.brief)).toEqual([generatedScenarios.imitation, ...generatedScenarios.transfers]);
    expect(job.training!.bestScore).toBe(9);
    expect(job.steps[0].output).toContain('### 原文仿写');
    expect(job.steps.every(s => s.status === 'accepted')).toBe(true);
  });
  it('无效场景不会进入写作，重新生成后可以继续', () => {
    const { job } = setupAutomatic(); const part = job.steps[0];
    for (const value of ['not json', {}, { ...generatedScenarios, imitation: ' ' }, { ...generatedScenarios, imitation: '字'.repeat(8001) }, { ...generatedScenarios, transfers: ['仅一个场景'] }, { ...generatedScenarios, imitation: original }, { ...generatedScenarios, transfers: Array(3).fill('相同场景') }]) {
      part.output = JSON.stringify(value);
      expect(() => finishTrainingStep(job, part)).toThrow();
      expect(job.training!.cases).toHaveLength(0); expect(job.steps).toHaveLength(1);
      expect(part.status).toBe('pending');
    }
    part.output = JSON.stringify(generatedScenarios); finishTrainingStep(job, part);
    expect(job.training!.cases).toHaveLength(4); expect(job.steps).toHaveLength(6);
    finishTrainingStep(job, part); expect(job.steps).toHaveLength(6);
  });
  it('场景生成前后均可保存恢复，后续轮次复用场景，旧任务无需重新生成', () => {
    const { state, job } = setupAutomatic(); state.jobs.push(job);
    const pending = parseWorkspace(JSON.stringify(state));
    expect(pending.jobs[0].training?.original).toBe(original);
    expect(pending.jobs[0].steps[0].stage).toBe('train-scenarios');
    job.steps[0].output = JSON.stringify(generatedScenarios); finishTrainingStep(job, job.steps[0]);
    const restored = parseWorkspace(JSON.stringify(state)).jobs[0];
    expect(restored.training?.cases).toEqual(job.training!.cases);
    expect(restored.steps[0].status).toBe('accepted');
    recordEvaluation(restored, judge(restored, 1), { scores: [4, 5, 6, 7], feedback: '改进冲突', decision: 'auto' }, 'human');
    const revision = restored.steps[restored.steps.length - 1];
    expect(trainingPrompt(restored, revision).user).toContain(original);
    revision.output = rules + '\n冲突应体现选择的后果。'; finishTrainingStep(restored, revision);
    expect(restored.training?.cases).toEqual(job.training!.cases);
    expect(restored.steps.filter(s => s.stage === 'train-scenarios')).toHaveLength(1);
    expect(restored.steps.filter(s => s.stage === 'train-write' && s.round === 2)).toHaveLength(4);
    const legacy = setup(); legacy.state.jobs.push(legacy.job);
    expect(parseWorkspace(JSON.stringify(legacy.state)).jobs[0].steps[0].stage).toBe('train-write');
  });
  it('写作只接收规则和独立场景；评审接收原文和结果', () => {
    const { job } = setup(); job.steps[0].output = '候选作品';
    const writer = trainingPrompt(job, job.steps[0]).user;
    expect(writer).toContain(rules); expect(writer).toContain('陌生人');
    for (const secret of [original, job.sourceText, job.sourceTitle, '候选作品']) expect(writer).not.toContain(secret);
    const reviewer = trainingPrompt(job, judge(job, 1)).user;
    expect(reviewer).toContain(original); expect(reviewer).toContain('候选作品'); expect(reviewer).toContain('所有场景共同的 10 分质量基准');
  });
  it('低分 keep 自动转修订，下一轮不泄漏评语、原文和旧候选', () => {
    const { job } = setup(); const part = judge(job, 1);
    part.output = '{"scores":[8,4],"feedback":"专用评语","decision":"keep"}'; finishTrainingStep(job, part);
    expect(job.training!.bestScore).toBe(4); expect(job.training!.evaluations[0].decision).toBe('revise');
    const revision = job.steps[job.steps.length - 1]; expect(revision.stage).toBe('train-revise');
    expect(trainingPrompt(job, revision).user).toContain(original);
    revision.output = rules + '\n冲突应体现选择的后果。'; finishTrainingStep(job, revision);
    const writer = trainingPrompt(job, job.steps.find(s => s.stage === 'train-write' && s.round === 2)!).user;
    expect(writer).toContain(revision.output); expect(writer).not.toContain('专用评语'); expect(writer).not.toContain(original);
  });
  it('拒绝原文泄漏、无效 Skill、无效分数和错误场景数量', () => {
    const { job } = setup(); const training = job.training!;
    training.cases[1].brief += original; expect(() => validateTraining(training)).toThrow('原文段落'); training.cases[1].brief = '新场景';
    training.initialSkill += original; expect(() => validateTraining(training)).toThrow('原文段落'); training.initialSkill = rules;
    for (const scores of [[11, 8], [-1, 8], [8]]) expect(() => parseEvaluation(JSON.stringify({ scores, feedback: '意见', decision: 'revise' }), 2)).toThrow();
    recordEvaluation(job, judge(job, 1), { scores: [4, 5], feedback: '意见', decision: 'reextract' }, 'ai');
    const revision = job.steps[job.steps.length - 1]; revision.output = '不是 Skill'; expect(() => finishTrainingStep(job, revision)).toThrow('元数据');
    revision.output = rules + original; expect(() => finishTrainingStep(job, revision)).toThrow('原文段落');
    expect(job.steps.filter(s => s.round === 2)).toHaveLength(0);
  });
  it('保留最佳已评版本，达到轮数上限停止，不用较差规则覆盖', () => {
    const { state, skill, job } = setup(); job.training!.maxRounds = 2;
    recordEvaluation(job, judge(job, 1), { scores: [8, 8], feedback: '待改进', decision: 'revise' }, 'human');
    const revision = job.steps[job.steps.length - 1]; revision.output = rules + '\n错误优化。'; finishTrainingStep(job, revision);
    recordEvaluation(job, judge(job, 2), { scores: [5, 6], feedback: '退步', decision: 'reextract' }, 'human');
    expect(job.training!.bestScore).toBe(8); expect(job.training!.bestSkill).toBe(rules); expect(job.steps.some(s => s.round === 3)).toBe(false);
    applyBestSkill(state, job); expect(skill.files[0].content).toBe(rules); expect(skill.revisions).toHaveLength(0);
  });
  it('到达目标停止，自动采用记录版本，避免覆盖同时编辑', () => {
    const { state, skill, job } = setup();
    recordEvaluation(job, judge(job, 1), { scores: [5, 6], feedback: '改进', decision: 'revise' }, 'ai');
    const revision = job.steps[job.steps.length - 1]; revision.output = rules + '\n让情绪回报来自人物行动。'; finishTrainingStep(job, revision);
    recordEvaluation(job, judge(job, 2), { scores: [9, 10], feedback: '达到目标', decision: 'keep' }, 'ai');
    expect(job.steps.some(s => s.round === 3)).toBe(false);
    skill.files[0].content = '用户新编辑'; expect(() => applyBestSkill(state, job)).toThrow('已更新');
    skill.files[0].content = rules; applyBestSkill(state, job); applyBestSkill(state, job);
    expect(skill.files[0].content).toBe(revision.output); expect(skill.revisions).toHaveLength(1);
    expect(() => recordEvaluation(job, judge(job, 2), { scores: [9, 9], feedback: '重复', decision: 'keep' }, 'ai')).toThrow('已评分');
  });
  it('限制训练轮数和场景数，并在新任务清空历史分数', () => {
    const { job } = setup(); const training = job.training!;
    expect(() => validateTraining({ ...training, maxRounds: 11 })).toThrow();
    expect(() => validateTraining({ ...training, cases: training.cases.slice(0, 1) })).toThrow();
    expect(() => validateTraining({ ...training, cases: training.cases.map(c => ({ ...c, original: '' })) })).toThrow('评分原文');
    expect(validateTraining({ ...training, bestScore: 10, bestSkill: '旧最佳' })).toMatchObject({ bestScore: -1, bestSkill: rules, evaluations: [] });
  });
  it('用户低分后由 AI 判断修订或重新提炼', () => {
    const { job } = setup();
    recordEvaluation(job, judge(job, 1), parseEvaluation('{"scores":[4,5],"feedback":"冲突推进不足","decision":"auto"}', 2), 'human');
    const prompt = trainingPrompt(job, job.steps[job.steps.length - 1]).user;
    expect(prompt).toContain('自行判断局部修订还是重新提炼');
    expect(prompt).toContain('4、5 / 10');
    expect(prompt).toContain(original);
  });
});
