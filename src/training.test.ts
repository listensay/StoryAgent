import { describe, expect, it, vi } from 'vitest';
import { createJob, emptyWorkspace, parseWorkspace, wordCount, type Job, type JobStep, type TrainingAnnotation, type TrainingScore } from './domain';
import { parseSkills } from './skills';
import { adoptTrainingSkill, applyBestSkill, continueTraining, discardTrainingFeedback, finishTrainingStep, generateTrainingRevision, initializeTraining, parseEvaluation, parseTrainingRevision, recordEvaluation, scenarioTraining, skillText, startTrainingFeedback, trainingPrompt, trainingResourceSelection, trainingReview, validateTraining } from './training';
import { AIRequestQueue, runJobSteps } from './stepQueue';
const rules = '---\nname: narrative\ndescription: 通用创作规则\n---\n先建立人物目标，再引入有代价的阻碍。';
const original = '城市里的钟表忽然全部停摆，主角林舟从旧信封里发现了一张通往未来的车票，但背面写着他十年前遗失的姓名。他赶到车站，发现售票员早已知道他的来意。';
const brief = '林舟发现钟表停摆，获得通往未来的车票，票背出现旧姓名。他为查明身份赶到车站，遇到知晓他来意的售票员。第三人称，篇幅约80字。';
const transfers = ['科幻飞船补给不足，舰长必须在救援与返航之间做出选择。', '边关军医缺少药材，必须说服对手开放商路救治伤员。', '社区厨师面临停业，需要在宴席开始前重建邻里的信任。'];
function setup(mode: 'chapter' | 'scenario' = 'chapter') {
  const state = emptyWorkspace(), skill = parseSkills([{ path: 'SKILL.md', content: rules }], '测试')[0]; state.skills.push(skill);
  const job = createJob(undefined, 'train', null, [], '');
  job.sourceText = '不应泄漏的参考资料'; job.sourceTitle = '原作标题';
  job.training = validateTraining({ skillId: skill.id, initialSkill: rules, bestSkill: rules, bestScore: -1, targetScore: 9, judge: 'human', mode, chapterTitle: '第一章', original, cases: [], evaluations: [] });
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
function score(job: Job, scores: TrainingScore[], feedback = '冲突推进不足', satisfied = false, annotations: TrainingAnnotation[] = []) {
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
describe('提炼 Skill 的训练资源', () => {
  const revisionData = { name: '对白与动作承接', description: '通过人物言行呈现不同诉求。', profile: '叙述直白，对白符合人物身份，用动作承接回应。', expression: [{ title: '动作显露未说出的诉求', guideline: '人物掩饰想法时，在台词后用一个具体动作给对方留下回应的依据。', example: '“不用送。”她关门前又停住，等走廊里那人先转过身。', boundary: '人物需要掩饰想法时使用；坦诚表达时保留直接的对白，不强行制造反差。' }] };

  it('结构化修订保留使用边界，由 App 编写执行流程和真实资源导航', () => {
    const { job } = setup();
    job.training!.resourceFiles = [{ path: 'references/index.md', content: '# 写法目录' }, { path: 'references/dialogue/001.md', content: '# 对白方法' }];
    const saved = structuredClone(job.training!.resourceFiles);
    prepare(job); write(job); score(job, [4]);
    const part = job.steps[job.steps.length - 1];
    expect(trainingPrompt(job, part).user).toContain('每项明确适用边界');
    part.output = JSON.stringify(revisionData); finishTrainingStep(job, part);
    expect(part.output).toContain(revisionData.expression[0].boundary);
    expect(part.output).toContain('先确认作者当前小说的设定');
    expect(part.output).toContain('[写法目录](references/index.md)');
    expect(part.output).not.toContain('研究依据：');
    expect(job.training!.resourceFiles).toEqual(saved);
    expect(parseSkills([{ path: 'SKILL.md', content: part.output }, ...saved], '训练')[0].resourceMode).toBe('relevant');
    expect(job.steps.filter(step => step.stage === 'train-write' && step.round === 2)).toHaveLength(1);
    expect(trainingPrompt(job, job.steps.find(step => step.stage === 'train-write' && step.round === 2)!, []).user).not.toContain(original);
  });

  it('缺少边界和编造链接的修订不能进入下一轮或覆盖 Skill', () => {
    const { job, state, skill } = setup();
    job.training!.resourceFiles = [{ path: 'references/index.md', content: '# 写法目录' }];
    prepare(job); write(job); score(job, [4]);
    const part = job.steps[job.steps.length - 1], missing = structuredClone(revisionData);
    delete (missing.expression[0] as Partial<typeof missing.expression[0]>).boundary;
    for (const output of [JSON.stringify(missing), JSON.stringify({ ...revisionData, profile: '[对白](references/dialogue/007.md)' }), rules + '\n[对白](references/dialogue/007.md)']) {
      part.output = output; expect(() => finishTrainingStep(job, part)).toThrow();
      expect(part.output).toBe(output); expect(part.status).toBe('pending');
      expect(job.steps.some(step => step.round === 2)).toBe(false);
    }
    job.training!.bestSkill = part.output;
    expect(() => adoptTrainingSkill(state, job)).toThrow('不存在的资源');
    expect(skill.files[0].content).toBe(rules); expect(skill.revisions).toHaveLength(0);
  });

  it('修订格式重试修复完整字段，保留资源且不将失败内容传给盲写', async () => {
    const { job } = setup(); job.training!.resourceFiles = [{ path: 'references/index.md', content: '# 写法目录' }];
    const missing = structuredClone(revisionData); delete (missing.expression[0] as Partial<typeof missing.expression[0]>).boundary;
    const feedback: string[] = [];
    const result = await generateTrainingRevision(job, new AbortController().signal, async message => { feedback.push(message); return JSON.stringify(feedback.length === 1 ? missing : revisionData); });
    expect(feedback).toHaveLength(2); expect(feedback[1]).toContain('expression.0.boundary');
    expect(result).toContain(revisionData.expression[0].boundary); expect(result).toContain('[写法目录](references/index.md)');
    expect(job.steps).toHaveLength(1);
    const invalid = vi.fn(async () => 'not json');
    await expect(generateTrainingRevision(job, new AbortController().signal, invalid)).rejects.toThrow('格式无效');
    expect(invalid).toHaveBeenCalledTimes(3);
  });

  it('修订的连接错误与停止直接传递，旧格式的有效资源链接仍可恢复', async () => {
    const { job } = setup(); job.training!.resourceFiles = [{ path: 'references/dialogue/001.md', content: '# 对白方法' }];
    const request = vi.fn(async () => { throw new Error('连接失败'); });
    await expect(generateTrainingRevision(job, new AbortController().signal, request)).rejects.toThrow('连接失败'); expect(request).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort(new Error('停止训练'));
    await expect(generateTrainingRevision(job, controller.signal, request)).rejects.toThrow('停止训练'); expect(request).toHaveBeenCalledTimes(1);
    expect(parseTrainingRevision(job, rules + '\n[对白方法](references/dialogue/001.md)')).toContain('[对白方法](references/dialogue/001.md)');
  });

  it('章节训练使用完整写法，优化及采用后保留资源、历史和后续场景训练', () => {
    const { state, skill, job } = setup();
    const resource = { path: 'references/dialogue/001.md', content: '# 对白\n\n## 谈判时掩饰私心\n\n用报价后的具体动作揭露人物的真实在意。\n\n示例：掌柜把少了一枚的铜钱推回桌子中央。\n\n反例：动作之后又由旁白解释动机。' };
    skill.resourceMode = 'relevant'; skill.files.push(resource);
    job.training!.initialSkill = skillText(skill); job.training!.resourceFiles = [structuredClone(resource)];
    prepare(job);
    const writer = trainingPrompt(job, job.steps.find(part => part.stage === 'train-write')!).user;
    expect(writer).toContain(resource.content); expect(writer).not.toContain(original);
    write(job); score(job, [4], '需要具体对白');
    const revision = job.steps[job.steps.length - 1];
    expect(trainingPrompt(job, revision).user).toContain(resource.content);
    revision.output = rules + '\n保留人物私心。'; finishTrainingStep(job, revision);
    write(job, 2); score(job, [9], '达到目标', true); job.status = 'accepted';
    applyBestSkill(state, job);
    expect(skill.files[0].content).toBe(revision.output); expect(skill.files[1]).toEqual(resource);
    expect(skill.resourceMode).toBe('relevant'); expect(skill.revisions[0].files).toHaveLength(2);
    expect(scenarioTraining(state, job.id).resourceFiles).toEqual([resource]);
    expect(parseWorkspace(JSON.stringify(state)).jobs[0].training?.resourceFiles).toEqual([resource]);
    const historyCount = skill.revisions.length; adoptTrainingSkill(state, job);
    expect(skill.revisions).toHaveLength(historyCount);
    skill.files = [{ path: 'SKILL.md', content: '用户编辑' }]; adoptTrainingSkill(state, job);
    expect(skill.files[1]).toEqual(resource);
  });

  it('训练期间修改详细资源后，自动采用保留用户的编辑', () => {
    const { state, skill, job } = setup();
    skill.resourceMode = 'relevant'; skill.files.push({ path: 'references/voice/001.md', content: '原有叙述口吻。' });
    job.training!.resourceFiles = structuredClone(skill.files.slice(1)); job.training!.bestSkill = rules + '\n优化。';
    skill.files[1].content = '用户修改了叙述口吻。';
    expect(() => applyBestSkill(state, job)).toThrow('资源已更新');
    expect(skill.files[1].content).toBe('用户修改了叙述口吻。');
  });

  it('资源中照抄原文的段落不能传给训练写作者', () => {
    const { job } = setup();
    job.training!.resourceFiles = [{ path: 'references/voice/001.md', content: original }];
    expect(() => validateTraining(job.training!)).toThrow('资源包含原文');
  });

  it('整本书的训练资源完整保存，盲写仅加载当前任务所需的少量写法', () => {
    const { job } = setup();
    job.training!.resourceFiles = ['voice', 'dialogue', 'rhythm', 'scene', 'plot'].flatMap(category => Array.from({ length: 6 }, (_, index) => ({ path: `references/${category}/${index}.md`, content: `# 车站里的身份疑问\n\n适用情境：车票出现旧姓名，在车站追查身份。\n\n1. 让售票员回应。\n\n### 迁移示例\n\n他扶住窗口${category}${index}。\n\n### 反例与修正\n\n不要用旁白解释双方的关系。` })));
    const saved = structuredClone(job.training!.resourceFiles);
    prepare(job);
    const writer = trainingPrompt(job, job.steps.find(part => part.stage === 'train-write')!).user;
    const loaded = saved.filter(file => writer.includes(`资料 ${file.path}：`));
    expect(loaded.length).toBeLessThanOrEqual(8); expect(loaded.length).toBeGreaterThan(2);
    for (const file of loaded) expect(writer).toContain(file.content);
    expect(writer).not.toContain(original);
    expect(writer).toContain('当前题材、叙述者与人物身份');
    expect(job.training!.resourceFiles).toEqual(saved);
  });

  it('盲写的适用性选择仅使用创作要求，明确选择保留完整方法，空选择不补入其他情节', () => {
    const { job } = setup();
    const expression = { path: 'references/dialogue/001.md', content: '对白方法、完整示例与反例。' };
    const plot = { path: 'references/plot/002.md', content: '不适用的其他情节机制。' };
    job.training!.resourceFiles = [expression, plot];
    prepare(job);
    const part = job.steps.find(step => step.stage === 'train-write')!;
    expect(trainingResourceSelection(job, part)?.query).toBe(brief);
    expect(trainingResourceSelection(job, part)?.query).not.toContain(original);
    const prompt = trainingPrompt(job, part, [expression]);
    expect(prompt.user).toContain(expression.content); expect(prompt.user).not.toContain(plot.content);
    expect(prompt.user).not.toContain(original);
    expect(trainingPrompt(job, part, []).user).not.toContain(expression.content);
    expect(job.training!.resourceFiles).toEqual([expression, plot]);
  });
});
describe('原文章节训练与用户反馈', () => {
  it('先提炼所选章节的内容，再只用 Skill 和提示词生成，始终等待用户评分', async () => {
    const { job } = setup(), stages: string[] = [];
    await expect(runTraining(job, async (part, prompt) => {
      stages.push(part.stage!);
      if (part.stage === 'train-brief') {
        expect(prompt).toContain(original); expect(prompt).toContain('第一章'); expect(prompt).toContain('不改成其他人物或新的场景');
        expect(prompt).toContain(`篇幅约 ${wordCount(original)} 字`);
        return JSON.stringify({ brief });
      }
      expect(prompt).toContain(rules); expect(prompt).toContain(brief);
      expect(prompt).toContain(`篇幅约 ${wordCount(original)} 字`);
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
  it('评分须有效且在生成结束后提交，拒绝重复评分', () => {
    const { job } = setup(); prepare(job);
    expect(() => score(job, [5])).toThrow('等待本轮生成完成'); write(job);
    for (const scores of [[11], [-1], [], [5, 6], [NaN]]) expect(() => score(job, scores)).toThrow();
    expect(job.training!.evaluations).toHaveLength(0);
    score(job, [0], '', true); expect(job.training!.bestScore).toBe(0);
    expect(() => recordEvaluation(job, judge(job), { scores: [9], feedback: '', decision: 'auto' })).toThrow('已评分');
  });
  it.each(['feedback', 'annotation'])('未评分也能提交%s，完整保留并传给 Skill 修订', kind => {
    const { state, job } = setup(); prepare(job); write(job);
    const feedback = kind === 'feedback' ? '人物的害怕应通过挑衅行为显露。\n调整这句话的语气。' : '';
    const annotations: TrainingAnnotation[] = kind === 'annotation' ? [{ target: 'candidate', caseIndex: 0, start: 0, end: 6, quote: '林舟拿起车票', feedback: '这里需要体现犹豫，而不是直接行动。' }] : [];
    score(job, [''], feedback, false, annotations);
    expect(job.training!.evaluations[0]).toMatchObject({ scores: [''], feedback, annotations, source: 'human' });
    expect(job.training!.bestScore).toBe(-1);
    const prompt = trainingPrompt(job, job.steps[job.steps.length - 1]).user;
    expect(prompt).toContain(JSON.stringify(feedback || annotations[0].feedback)); expect(prompt).not.toContain('"score":');
    if (annotations.length) { expect(judge(job).output).toContain(annotations[0].quote); expect(judge(job).output).toContain(annotations[0].feedback); }
    expect(parseWorkspace(JSON.stringify(state)).jobs[0].training!.evaluations[0]).toEqual(job.training!.evaluations[0]);
  });
  it('空评价不能继续，部分评分与反馈可以提交且不当作完整评分', () => {
    const { job } = setup('scenario'); prepare(job); write(job);
    for (const scores of [['', '', ''], [7, '', '']] as TrainingScore[][]) expect(() => score(job, scores, ' ')).toThrow('请填写反馈');
    expect(job.training!.evaluations).toHaveLength(0); expect(judge(job).status).toBe('pending');
    score(job, [7, '', ''], '场景二的冲突缺少代价。');
    expect(job.training!.bestScore).toBe(-1); expect(job.training!.evaluations[0].scores).toEqual([7, '', '']);
    expect(judge(job).output).toContain('未评分');
  });
  it('未评分结束时采用用户确认的当前版本，可以进行其他场景训练', () => {
    const { state, job, skill } = setup(); prepare(job); write(job); score(job, [''], '补充具体动作。');
    const revision = job.steps[job.steps.length - 1]; revision.output = rules + '\n以停顿的动作表现犹豫。'; finishTrainingStep(job, revision);
    write(job, 2); score(job, [''], '当前表达符合要求。', true); job.status = 'accepted'; applyBestSkill(state, job);
    expect(job.training!.bestScore).toBe(-1); expect(job.training!.bestSkill).toBe(revision.output); expect(skill.files[0].content).toBe(revision.output);
    expect(skill.version).not.toContain('-1'); expect(scenarioTraining(state, job.id).initialSkill).toBe(revision.output);
  });
  it('已有最佳评分时，无评分反馈不覆盖最佳版本', () => {
    const { job } = setup(); prepare(job); write(job); score(job, [8], '补充动作。');
    const revision = job.steps[job.steps.length - 1]; revision.output = rules + '\n新版本。'; finishTrainingStep(job, revision);
    write(job, 2); score(job, [''], '结束本次训练。', true);
    expect(job.training!.bestScore).toBe(8); expect(job.training!.bestSkill).toBe(rules);
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
  it('用户选择结束时保留最佳已评版本，Skill 同时编辑时不覆盖', () => {
    const { state, skill, job } = setup(); prepare(job); write(job); score(job, [8]);
    const revision = job.steps[job.steps.length - 1]!; revision.output = rules + '\n调整规则。'; finishTrainingStep(job, revision); write(job, 2); score(job, [5], '', true);
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
    expect(() => validateTraining({ ...training, original: '' })).toThrow();
    expect(() => validateTraining({ ...training, judge: 'ai' as 'human' })).toThrow();
    expect(() => validateTraining({ ...training, cases: [1, 2].map(i => ({ title: String(i), brief, original: '' })) })).toThrow('仅使用所选原文章节');
    expect(() => validateTraining({ ...training, initialSkill: rules + original })).toThrow('原文段落');
    expect(validateTraining({ ...training, bestScore: 10, bestSkill: '旧最佳', approvedAt: '旧标记' })).toMatchObject({ bestScore: -1, bestSkill: rules, evaluations: [], approvedAt: undefined });
    expect(() => parseEvaluation('{"scores":[1,2],"feedback":"","decision":"auto"}', 1)).toThrow('数量');
  });
  it('超过原来的十轮限制仍按用户选择继续，结束后不再生成', () => {
    const { job } = setup(); prepare(job);
    for (let round = 1; round <= 12; round++) {
      write(job, round); score(job, [6.9], '继续改进表达', round === 12);
      if (round < 12) {
        const revision = job.steps[job.steps.length - 1];
        expect(revision).toMatchObject({ stage: 'train-revise', round });
        revision.output = rules + `\n第 ${round} 次修订。`; finishTrainingStep(job, revision);
      }
    }
    expect(job.training!.evaluations).toHaveLength(12);
    expect(job.steps.some(s => s.round === 13)).toBe(false); expect(job.training!.approvedAt).toBeTruthy();
  });
  it('旧任务达到一轮上限后，可以直接沿用6.9分及划词评价继续修订', () => {
    const { state, job } = setup(); prepare(job); write(job);
    score(job, [6.9], '减少总结性陈述', true, [{ target: 'candidate', caseIndex: 0, start: 0, end: 6, quote: '林舟拿起车票', feedback: '缺少具体动作' }]);
    job.status = 'accepted';
    const legacy = JSON.parse(JSON.stringify(state)); legacy.jobs[0].training.maxRounds = 1;
    const restored = parseWorkspace(JSON.stringify(legacy)).jobs[0];
    expect(restored.training).not.toHaveProperty('maxRounds');
    continueTraining(restored);
    const revision = restored.steps[restored.steps.length - 1];
    expect(restored.status).toBe('queued'); expect(restored.training!.approvedAt).toBeUndefined();
    for (const evidence of ['减少总结性陈述', '缺少具体动作', '"score":6.9']) expect(trainingPrompt(restored, revision).user).toContain(evidence);
    expect(() => continueTraining(restored)).toThrow('完成本轮');
    revision.output = rules + '\n避免总结代替具体行动。'; finishTrainingStep(restored, revision);
    expect(restored.steps.some(s => s.stage === 'train-write' && s.round === 2)).toBe(true);
  });
  it('评价草稿保存恢复，提交后清空，后续轮次不会复用旧草稿', () => {
    const { state, job } = setup(); prepare(job); write(job);
    job.training!.review = { round: 1, scores: [6.9], feedback: '需要调整', annotations: [{ target: 'candidate', caseIndex: 0, start: 0, end: 6, quote: '林舟拿起车票', feedback: '缺少具体动作' }] };
    const restored = parseWorkspace(JSON.stringify(state)).jobs[0]; expect(restored.training!.review).toEqual(job.training!.review);
    const draft = restored.training!.review!; score(restored, draft.scores as number[], draft.feedback, false, draft.annotations);
    expect(restored.training!.review).toBeUndefined(); expect(restored.training!.evaluations[0].annotations).toEqual(draft.annotations);
  });
  it.each([false, true])('继续已完成训练后允许更新此前采用的训练版本，详细资源模式：%s', resources => {
    const { state, job, skill } = setup(); prepare(job); write(job); score(job, [4]);
    if (resources) {
      skill.resourceMode = 'relevant'; skill.files.push({ path: 'references/dialogue/001.md', content: '对白应承接人物当前的诉求。' });
      job.training!.resourceFiles = structuredClone(skill.files.slice(1));
    }
    const revision = job.steps[job.steps.length - 1]; revision.output = rules + '\n第一次优化。'; finishTrainingStep(job, revision); write(job, 2); score(job, [6], '', true);
    job.status = 'accepted'; applyBestSkill(state, job); expect(skill.files[0].content).toBe(revision.output);
    continueTraining(job); const next = job.steps[job.steps.length - 1]; next.output = rules + '\n第二次优化。'; finishTrainingStep(job, next); write(job, 3); score(job, [8], '', true);
    applyBestSkill(state, job); expect(skill.files[0].content).toBe(next.output); expect(skill.revisions).toHaveLength(2);
    if (resources) {
      expect(skill.files.slice(1)).toEqual(job.training!.resourceFiles);
      expect(skill.revisions.every(item => item.files.length === 2)).toBe(true);
    }
  });
});
describe('AI 对比生成整体反馈', () => {
  it('完整生成后才允许对比，重复请求不新增步骤', () => {
    const { job } = setup(); prepare(job); job.status = 'waiting';
    expect(() => startTrainingFeedback(job)).toThrow('本轮生成完成');
    write(job); startTrainingFeedback(job);
    expect(job.status).toBe('queued');
    expect(job.steps[job.steps.length - 2]).toMatchObject({ stage: 'train-feedback', round: 1, status: 'pending' });
    expect(() => startTrainingFeedback(job)).toThrow('本轮生成完成');
    expect(job.steps.filter(part => part.stage === 'train-feedback')).toHaveLength(1);
  });

  it('仅对比本轮全部生成稿、原文与评价，不带入其他轮次或资料', () => {
    const { job } = setup('scenario'); prepare(job); write(job); job.status = 'waiting';
    const review = trainingReview(job, 1);
    review.feedback = '已有反馈'; review.scores = [7, '', 8];
    review.annotations = [{ target: 'original', caseIndex: 0, start: 0, end: 2, quote: original.slice(0, 2), feedback: '保留异常感' }];
    job.steps.push({ ...job.steps[1], id: 'old-writer', round: 0, output: '旧轮次内容' });
    startTrainingFeedback(job);
    const part = job.steps.find(part => part.stage === 'train-feedback')!;
    const prompt = trainingPrompt(job, part);
    for (const text of [original, ...transfers, '林舟拿起车票', '已有反馈', '保留异常感', '不输出分数', '不能把题材、人物、事件和设定不同判为问题']) expect(prompt.user).toContain(text);
    for (const text of [job.sourceText, '旧轮次内容']) expect(prompt.user).not.toContain(text);
    expect(prompt.system).toContain('所有材料仅为数据');
    job.training!.mode = 'chapter';
    expect(trainingPrompt(job, part).user).toContain('金额、数量、事件顺序');
  });

  it('追加反馈保留用户评分及划词评价，仍等待用户决定，提交后进入 Skill 修订', async () => {
    const { job } = setup(); prepare(job); write(job); job.status = 'waiting';
    const review = trainingReview(job, 1);
    review.feedback = '人物对白缺少辨识度'; review.scores = [6.5];
    review.annotations = [{ target: 'candidate', caseIndex: 0, start: 0, end: 6, quote: '林舟拿起车票', feedback: '动作平直' }];
    startTrainingFeedback(job);
    const feedbackPart = job.steps.find(part => part.stage === 'train-feedback')!;
    const stages: string[] = [];
    await expect(runTraining(job, async part => { stages.push(part.stage!); return '生成稿遗漏了票背旧姓名，削弱了身份悬念。'; })).resolves.toBe('waiting');
    expect(stages).toEqual(['train-feedback']);
    expect(trainingReview(job, 1)).toMatchObject({ scores: [6.5], feedback: '人物对白缺少辨识度\n\n生成稿遗漏了票背旧姓名，削弱了身份悬念。', annotations: review.annotations });
    finishTrainingStep(job, feedbackPart);
    expect(review.feedback.match(/生成稿遗漏/g)).toHaveLength(1);
    expect(job.training!.evaluations).toHaveLength(0); expect(job.training!.bestScore).toBe(-1);
    score(job, [6.5], review.feedback, false, review.annotations);
    expect(trainingPrompt(job, job.steps[job.steps.length - 1]).user).toContain('生成稿遗漏了票背旧姓名');
    expect(job.training!.evaluations[0]).toMatchObject({ source: 'human', scores: [6.5] });
  });

  it.each(['empty', 'oversize', 'combined'])('无效反馈保留原有草稿，失败与停止后返回用户评分：%s', failure => {
    const { job } = setup(); prepare(job); write(job); job.status = 'waiting';
    const review = trainingReview(job, 1); review.feedback = failure === 'combined' ? '字'.repeat(7000) : '已有反馈'; review.scores = [7];
    const saved = structuredClone(review); startTrainingFeedback(job);
    const part = job.steps.find(part => part.stage === 'train-feedback')!;
    part.output = failure === 'empty' ? ' ' : '字'.repeat(failure === 'oversize' ? 8001 : 1000);
    expect(() => finishTrainingStep(job, part)).toThrow();
    expect(job.training!.review).toEqual(saved);
    expect(discardTrainingFeedback(job)).toBe(true); expect(job.status).toBe('waiting');
    expect(judge(job).status).toBe('pending'); expect(discardTrainingFeedback(job)).toBe(false);
    score(job, [7], saved.feedback, true); expect(job.training!.evaluations[0].feedback).toBe(saved.feedback);
  });

  it('反馈草稿和暂停请求可恢复，下一轮不复用，反馈已满不发送请求', () => {
    const { state, job } = setup(); prepare(job); write(job); job.status = 'waiting';
    trainingReview(job, 1).feedback = '用户反馈'; startTrainingFeedback(job);
    const part = job.steps.find(part => part.stage === 'train-feedback')!; part.status = 'running'; job.status = 'running'; part.output = '未完成的反馈';
    const restored = parseWorkspace(JSON.stringify(state)).jobs[0];
    expect(restored.status).toBe('paused'); expect(restored.training!.review?.feedback).toBe('用户反馈');
    expect(discardTrainingFeedback(restored)).toBe(true);
    trainingReview(restored, 1).feedback = '字'.repeat(8000);
    expect(() => startTrainingFeedback(restored)).toThrow('长度上限');
    expect(restored.steps.some(part => part.stage === 'train-feedback')).toBe(false);
    expect(trainingReview(restored, 2)).toMatchObject({ round: 2, scores: [''], feedback: '', annotations: [] });
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
