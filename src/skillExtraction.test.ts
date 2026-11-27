import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject, parseWorkspace, type Job } from './domain';
import { finishAutomaticStep, saveExtractedSkill } from './jobWorkflow';
import { buildPrompt, prepareSkillExtraction, synthesisSteps } from './prompts';
import { extractedSkillFiles, generateSkillComposition, generateSkillResearch, parseSkillComposition, parseSkillResearch, skillSnapshot } from './skillExtraction';
import type { SkillComposition, SkillResearch } from './skillExtractionData';
import { researchText } from './skillExtractionData';
import { parseSkills } from './skills';
import { relevantSkillResources, selectSkillResources } from './skillResources';

const config = { ...newAISelection(), ...defaultAdvanced() };
const definition = '---\nname: comic-scenes\ndescription: 身份反差与人物私心驱动的喜剧场景\n---\n# 喜剧场景\n\n先确定人物要办的事，再按本章情境选用写法。';
const composition: SkillComposition = { name: '人物私心与动作反差', description: '适用于口语化、以人物言行反差呈现幽默的起草、续写与改写。', profile: '叙述贴近人物，口语简短，台词后的动作显露人物没有说出的想法。', expression: [{ title: '动作接住嘴硬的台词', guideline: '人物给出体面说辞后，用一个具体动作显露真实诉求，让对方据此回应。', example: '“早走早清静。”他把门拉开，手却还压着行李箱。来人没催，只把车票往后改了半小时。', boundary: '人物需要掩饰私心时使用；坦诚表达的场景保留人物的直接表达，不强行制造虚伪。', evidence: [1] }] };
function research(paragraph = 1, title = '体面理由与真实欲望', category: SkillResearch['mechanisms'][number]['category'] = 'dialogue'): SkillResearch {
  return { profile: '人物用体面说辞掩饰私心，叙述贴近人物，反应简短而具体。', mechanisms: [{ title, category, trigger: '人物谈判价格，又要维持身份和面子时使用。', steps: ['先让人物公开表示对价格无所谓。', '用一次不肯让步的动作泄露他的真实在意。'], effect: '读者先识破私心，人物仍在维护体面。', example: '掌柜说只是交个朋友，却把少了一枚的铜钱推回桌子中央。', avoid: '说完动作又解释他其实很在意钱；删掉解释，让对方加码回应。', check: '删去旁白评价后，能否从动作读出真实诉求？', evidence: [{ start: paragraph, quote: '人物' }] }] };
}
function extraction(source = '人物正在争论报价。') {
  const job = createJob(undefined, 'style', config, undefined, ''); job.sourceId = 'novel-source'; job.sourceTitle = '参考小说'; job.sourceText = source;
  prepareSkillExtraction(job, config);
  job.steps.filter(step => step.stage === 'style-research').forEach((step, i) => {
    const paragraph = Number(step.section.match(/\[P(\d+)\]/)![1]);
    step.output = JSON.stringify(research(paragraph, `独特写法${i}`)); step.status = 'ready';
    finishAutomaticStep(emptyWorkspace(), job, step);
  });
  return job;
}

describe('完整写法提炼与保存', () => {
  it('短文本也先提炼具体写法，再编写可使用的入口 Skill', () => {
    const job = extraction();
    expect(job.steps.map(step => step.stage)).toEqual(['style-research', 'style-compose']);
    const prompt = buildPrompt(emptyWorkspace(), job, job.steps[0], config);
    expect(prompt.user).toContain('原创迁移示例'); expect(prompt.user).not.toContain('1200 字以内');
    const ids = job.steps.map(step => step.id); prepareSkillExtraction(job, config);
    expect(job.steps.map(step => step.id)).toEqual(ids);
    expect(() => prepareSkillExtraction(createJob(undefined, 'style', config, undefined, ''), { ...config, maxTokens: 1024 })).toThrow('输出上限');
  });

  it('最终综合再简短也不会删除各分段的步骤、示例、反例与证据', () => {
    const job = extraction(Array.from({ length: 140 }, (_, i) => `段落${i}。${'人物为维护身份而遮掩实际诉求。'.repeat(40)}`).join('\n\n'));
    const parts = job.steps.filter(step => step.research);
    expect(parts.length).toBeGreaterThan(2);
    const state = emptyWorkspace(); saveExtractedSkill(state, job, definition);
    const skill = state.skills[0];
    expect(skill.resourceMode).toBe('relevant'); expect(skill.originReferenceId).toBe(job.sourceId);
    expect(skill.enabled).toBe(false);
    for (const part of parts) {
      const mechanism = part.research!.mechanisms[0];
      const resource = skill.files.find(file => file.content.includes(`## ${mechanism.title}`));
      expect(resource?.content).toContain(mechanism.example); expect(resource?.content).toContain(mechanism.avoid);
      expect(resource?.content).toContain(mechanism.steps[1]); expect(resource?.content).toContain(`[P${mechanism.evidence[0].start}]`);
    }
    expect(parseSkills(skill.files, '再次导入')[0].resourceMode).toBe('relevant');
    const linked = extractedSkillFiles(job, definition + '\n[写法目录](file:///references/index.md)');
    expect(linked[0].content).toContain('[写法目录](references/index.md)');
    expect(linked[0].content).not.toContain('file:///');
    state.jobs.push(job);
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.skills.find(item => item.id === skill.id)?.files).toEqual(skill.files);
    expect(restored.jobs[0].steps[0].research).toEqual(parts[0].research);
  });

  it('入口只综合文风和表达，执行顺序服从当前故事，完整情节机制另存资源', () => {
    const job = extraction(), state = emptyWorkspace(), final = job.steps[job.steps.length - 1];
    const prompt = buildPrompt(state, job, final, config);
    expect(prompt.user).toContain('本次仅整理有证据的文风基准与表达方法');
    expect(prompt.user).toContain('不规定主角一律威严');
    expect(prompt.user).toContain('人物正在争论报价。');
    expect(prompt.user).not.toContain(research().mechanisms[0].example);
    final.output = JSON.stringify(composition); final.status = 'ready';
    finishAutomaticStep(state, job, final);
    expect(final.status).toBe('accepted'); expect(final.output).toMatch(/^---\n/);
    expect(final.output).toContain('先确认作者当前小说的设定');
    expect(final.output).toContain('不为套用某个机制新增事件');
    expect(final.output).toContain(composition.expression[0].example);
    expect(state.skills[0].files.find(file => file.path.startsWith('references/dialogue/'))?.content).toContain(research().mechanisms[0].example);
    expect(state.skills[0].resourceMode).toBe('relevant');
  });

  it('入口综合依据所引原文，情节机制的长示例不占用综合上下文', () => {
    const job = extraction(), part = job.steps[0], final = job.steps[job.steps.length - 1];
    const plot = research().mechanisms[0]; plot.category = 'plot'; plot.title = '经营扩张'; plot.example = '投放新产品后扩大版图。'.repeat(10000);
    part.research!.mechanisms.push(plot); part.output = researchText(part.research!);
    expect(part.output.length).toBeGreaterThan(config.contextChars);
    expect(synthesisSteps(job, final, config)).toEqual([]);
    const prompt = buildPrompt(emptyWorkspace(), job, final, config);
    expect(prompt.user).toContain('expressionEvidence'); expect(prompt.user).toContain('[P1] 人物正在争论报价。');
    expect(prompt.user).not.toContain(plot.title); expect(prompt.user).not.toContain(plot.example);
    expect(extractedSkillFiles(job, definition).some(file => file.content.includes(plot.example))).toBe(true);
  });

  it('多层汇总的最终入口仍能回看真实表达，避免仅依据中间概括推断文风', () => {
    const job = extraction('人物拍了拍口袋，说：“还差一枚。”'), final = job.steps[job.steps.length - 1];
    const intermediate = { ...final, id: 'intermediate-style', intermediate: true, status: 'ready' as const, output: JSON.stringify(composition) };
    job.steps.splice(job.steps.length - 1, 0, intermediate); final.inputIds = [intermediate.id];
    const prompt = buildPrompt(emptyWorkspace(), job, final, config);
    expect(prompt.user).toContain('原文表达抽样');
    expect(prompt.user).toContain('[P1] 人物拍了拍口袋，说：“还差一枚。”');
    expect(prompt.user).not.toContain(research().mechanisms[0].example);
    expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(config.contextChars);
  });

  it('入口综合修正缺失字段并拒绝补造证据或把原文写成示例', async () => {
    const job = extraction(), missing = structuredClone(composition), feedback: string[] = [];
    delete (missing.expression[0] as Partial<typeof missing.expression[0]>).boundary;
    const result = await generateSkillComposition(job, new AbortController().signal, async message => { feedback.push(message); return JSON.stringify(feedback.length === 1 ? missing : composition); });
    expect(feedback[1]).toContain('expression.0.boundary'); expect(JSON.parse(result)).toEqual(composition);
    const invented = structuredClone(composition); invented.expression[0].evidence = [9];
    expect(() => parseSkillComposition(JSON.stringify(invented), job)).toThrow('写法提炼结果');
    const original = '这个特别长的原文段落记录了人物经过许多次尝试以后终于决定在最后一次报价时改变原本维护面子的做法并将所有真实想法清楚告诉对方。';
    const copied = structuredClone(composition); copied.expression[0].example = original; job.sourceText = original;
    expect(() => parseSkillComposition(JSON.stringify(copied), job)).toThrow('原文段落');
  });

  it('综合引用的编号与范围可无损规范化，未知编号仍被拒绝', () => {
    const job = extraction('人物正在争论报价。\n人物放下了账本。');
    job.steps[0].research!.mechanisms[0].evidence.push({ start: 2, quote: '人物' });
    const withLabels = { ...composition, expression: [{ ...composition.expression[0], evidence: ['[P1]', 'P1–P2', '2'] }] };
    expect(parseSkillComposition(JSON.stringify(withLabels), job).expression[0].evidence).toEqual([1, 2]);
    withLabels.expression[0].evidence = ['P1-P9'];
    expect(() => parseSkillComposition(JSON.stringify(withLabels), job)).toThrow('写法提炼结果');
  });

  it('缺少可执行内容、无效段落证据或照抄示例时停止保存', () => {
    const invalid = research(); delete (invalid.mechanisms[0] as Partial<typeof invalid.mechanisms[0]>).example;
    expect(() => parseSkillResearch(JSON.stringify(invalid), '[P1] 正文')).toThrow('示例');
    expect(() => parseSkillResearch(JSON.stringify(research(20)), '[P1] 正文')).toThrow('证据');
    const quoted = research(), original = '这个特别长的原文段落记录了人物经过许多次尝试以后终于决定在最后一次报价时改变原本维护面子的做法并将所有真实想法清楚告诉对方。';
    quoted.mechanisms[0].example = original;
    expect(() => parseSkillResearch(JSON.stringify(quoted), '[P1] ' + original)).toThrow('原文段落');
    const unfinished = extraction(); unfinished.steps[0].research = undefined;
    expect(() => extractedSkillFiles(unfinished, definition)).toThrow('尚未完成');
  });

  it('研究引文必须来自所引段落，原文引文不进入可迁移的 Skill 资源', () => {
    const value = research(); value.mechanisms[0].evidence = [{ start: 1, quote: '他把价签藏在袖口里。' }];
    expect(() => parseSkillResearch(JSON.stringify(value), '[P1] 他把价签藏在袖口里。')).not.toThrow();
    const corrected = parseSkillResearch(JSON.stringify(value), '[P1] 他不在店里。\n\n[P2] 他把价签藏在袖口里。');
    expect(corrected.mechanisms[0].evidence[0].start).toBe(2);
    expect(() => parseSkillResearch(JSON.stringify(value), '[P1] 他不在店里。\n\n[P2] 他把价签藏在袖口里。\n\n[P3] 他把价签藏在袖口里。')).toThrow('短引文');
    expect(() => parseSkillResearch(JSON.stringify(value), '[P1] 他不在店里。\n\n[P2] 他把价签放在桌面上。')).toThrow('短引文');
    const job = extraction(); job.steps[0].research = value;
    const files = extractedSkillFiles(job, definition);
    expect(files.some(file => file.content.includes('他把价签藏在袖口里。'))).toBe(false);
    const passage = '人物争论价格，'.repeat(15), extended = research();
    extended.mechanisms[0].evidence = [{ start: 1, end: 2, quote: passage + '掌柜推回了铜钱。' }];
    const parsed = parseSkillResearch(JSON.stringify(extended), `[P1] ${passage}\n\n[P2] 掌柜推回了铜钱。`);
    expect(parsed.mechanisms[0].evidence[0].quote).toHaveLength(40);
    const shifted = structuredClone(extended); shifted.mechanisms[0].evidence[0].start = 4; shifted.mechanisms[0].evidence[0].end = 5;
    const located = parseSkillResearch(JSON.stringify(shifted), `[P1] ${passage}\n\n[P2] 掌柜推回了铜钱。`);
    expect(located.mechanisms[0].evidence[0]).toMatchObject({ start: 1, end: 2 });
    extended.mechanisms[0].evidence[0].quote += '这一句没有出现。';
    expect(() => parseSkillResearch(JSON.stringify(extended), `[P1] ${passage}\n\n[P2] 掌柜推回了铜钱。`)).toThrow('短引文');
  });

  it('格式或证据错误自动修正，持续失败和停止请求均不会保存无效研究', async () => {
    const section = '[P1] 人物正在争论价格。', feedback: string[] = [];
    const invalid = research(8); invalid.mechanisms[0].evidence[0].quote = '不存在的引文';
    const result = await generateSkillResearch(section, new AbortController().signal, async message => { feedback.push(message); return JSON.stringify(feedback.length === 1 ? invalid : research()); });
    expect(JSON.parse(result).mechanisms[0].evidence[0].start).toBe(1);
    expect(feedback[1]).toContain('证据超出');
    let attempts = 0;
    await expect(generateSkillResearch(section, new AbortController().signal, async () => { attempts++; return '{}'; })).rejects.toThrow('写法提炼结果');
    expect(attempts).toBe(3);
    const stopped = new AbortController(); let requests = 0;
    await expect(generateSkillResearch(section, stopped.signal, async () => { requests++; stopped.abort(); return '{}'; })).rejects.toThrow();
    expect(requests).toBe(1);
  });

  it('保留多段示例并修正字符串换行和尾逗号，不补造截断内容', () => {
    const value = research(); value.mechanisms[0].example = '掌柜把铜钱推回去。\n“少了一枚。”\n牌子写着：甲,}；乙,]。';
    const output = JSON.stringify(value).replace(/\\n/g, '\n').replace(/\]\}$/, ',]}');
    expect(parseSkillResearch(output, '[P1] 人物争论价格。').mechanisms[0].example).toBe(value.mechanisms[0].example);
    expect(() => parseSkillResearch(output.slice(0, -4), '[P1] 人物争论价格。')).toThrow('写法提炼结果');
  });

  it('重试指出缺失字段，输出超限时要求完整写法，连接错误直接交给请求层处理', async () => {
    const missing = research(); delete (missing.mechanisms[0] as Partial<typeof missing.mechanisms[0]>).check;
    const feedback: string[] = [];
    await generateSkillResearch('[P1] 人物争论价格。', new AbortController().signal, async message => { feedback.push(message); return JSON.stringify(feedback.length === 1 ? missing : research()); });
    expect(feedback[1]).toContain('mechanisms.0.check');
    const limited: string[] = [];
    await generateSkillResearch('[P1] 人物争论价格。', new AbortController().signal, async message => { limited.push(message); if (limited.length === 1) throw new Error('已达到输出上限，可继续生成'); return JSON.stringify(research()); });
    expect(limited[1]).toContain('减少本次选取的写法数量');
    let requests = 0;
    await expect(generateSkillResearch('[P1] 人物争论价格。', new AbortController().signal, async () => { requests++; throw new Error('连接失败'); })).rejects.toThrow('连接失败');
    expect(requests).toBe(1);
  });

  it('重新提取保留 Skill 身份、用户选择与历史，成功后只替换一次', () => {
    const state = emptyWorkspace(), previous = extraction();
    saveExtractedSkill(state, previous, definition);
    const old = state.skills[0]; old.enabled = true; old.tasks = ['draft', 'rewrite'];
    const project = newProject('新小说', 'long'); project.skillIds = [old.id]; state.projects.push(project);
    const next = extraction(); next.skillTarget = { id: old.id, snapshot: skillSnapshot(old) };
    saveExtractedSkill(state, next, definition + '\n新的执行规则。');
    const updated = state.skills.find(skill => skill.id === old.id)!;
    expect(updated.enabled).toBe(true); expect(updated.tasks).toEqual(old.tasks);
    expect(updated.revisions[0].files).toEqual(old.files); expect(project.skillIds).toEqual([old.id]);
    expect(updated.files[0].content).toContain('新的执行规则。');
    saveExtractedSkill(state, next, definition + '\n新的执行规则。');
    expect(updated.revisions).toHaveLength(1);
  });

  it('提取期间编辑过的 Skill 不会被后来的结果覆盖', () => {
    const state = emptyWorkspace(), previous = extraction(); saveExtractedSkill(state, previous, definition);
    const skill = state.skills[0], next = extraction(); next.skillTarget = { id: skill.id, snapshot: skillSnapshot(skill) };
    skill.files[0].content += '\n用户新增的规则。';
    expect(() => saveExtractedSkill(state, next, definition + '\n新结果。')).toThrow('已更新');
    expect(skill.files[0].content).toContain('用户新增的规则。'); expect(skill.revisions).toHaveLength(0);
  });
});

describe('写作时按场景使用完整写法资源', () => {
  function writing() {
    const state = emptyWorkspace(), job = extraction(); saveExtractedSkill(state, job, definition);
    const skill = state.skills[0];
    for (let i = 0; i < 30; i++) skill.files.push({ path: `references/plot/other-${i}.md`, content: '## 远行后的地理变化\n\n适用情境：安排路途中的移动。\n\n' + '保持空间与时间连续。'.repeat(90) });
    const project = newProject('轻松经营小说', 'long'); project.genre = '轻松喜剧'; project.skillIds = [skill.id];
    project.chapters[0].plan = '掌柜与买家谈判价格，双方维护身份与面子。'; state.projects.push(project);
    const writingConfig = { ...config, contextChars: 10000 };
    const writingJob = createJob(project, 'draft', writingConfig, project.chapters[0].id, ''); writingJob.skillIds = [skill.id];
    return { state, skill, writingConfig, writingJob };
  }

  it('大目录首轮只有元数据与章节，入口和资料库留给写作模型按需读取', () => {
    const { state, skill, writingConfig, writingJob } = writing();
    const prompt = buildPrompt(state, writingJob, writingJob.steps[0], writingConfig);
    const resource = skill.files.find(file => file.path.startsWith('references/dialogue/'))!;
    expect(prompt.system).not.toContain(skill.files[0].content); expect(prompt.system).not.toContain(resource.content);
    expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(writingConfig.contextChars);
    expect(prompt.toolSkills.find(item => item.id === skill.id)?.files).toContain(resource);
  });

  it('大上下文也只选择少量完整写法，保留叙述、对白和节拍，不填满剩余预算', () => {
    const categories = ['voice', 'dialogue', 'rhythm', 'emotion', 'scene', 'plot'];
    const files = categories.flatMap(category => Array.from({ length: 5 }, (_, index) => ({ path: `references/${category}/${index}.md`, content: `# 锁门前的协商${index}\n\n适用情境：锁门时间争执。\n\n1. 让各方提出要求。\n\n### 迁移示例\n\n保留各方具体动作与对白${index}。\n\n### 反例与修正\n\n删去重复说明，让下一句回应改变协商。\n\n检查：锁门时间已明确。` })));
    const saved = structuredClone(files);
    const selected = relevantSkillResources(files, 'draft', '协商锁门时间', 200000);
    expect(selected.length).toBeLessThanOrEqual(8); expect(selected.length).toBeGreaterThan(3);
    for (const category of categories.slice(0, 3)) expect(selected.some(file => file.path.startsWith(`references/${category}/`))).toBe(true);
    for (const category of categories) expect(selected.filter(file => file.path.startsWith(`references/${category}/`)).length).toBeLessThanOrEqual(2);
    for (const file of selected) expect(file).toEqual(saved.find(item => item.path === file.path));
    expect(files).toEqual(saved);
  });

  it('重新起草不带旧稿；改写首轮含完整旧稿和 Skill ID，不预读入口和场景资料', () => {
    const { state, skill, writingConfig, writingJob } = writing();
    const step = writingJob.steps[0]; step.baseContent = '掌柜收起账簿，催买家上路。';
    const draft = buildPrompt(state, writingJob, step, writingConfig);
    const rewrite = buildPrompt(state, { ...writingJob, kind: 'rewrite' }, step, writingConfig);
    expect(draft.user).not.toContain(step.baseContent); expect(rewrite.user).toContain(step.baseContent);
    expect(rewrite.system).not.toContain(skill.files[0].content); expect(rewrite.system).toContain(skill.id);
  });
  it('大参考文件不妨碍首轮写作；未选或记忆步骤不提供该小说 Skill', () => {
    const { state, skill, writingJob, writingConfig } = writing();
    skill.files.push({ path: 'references/long.md', content: '对白规则。'.repeat(5000) });
    const prompt = (job: Job) => buildPrompt(state, job, job.steps[0], writingConfig);
    expect(prompt(writingJob).toolSkills).toContain(skill);
    expect(prompt(writingJob).system).not.toContain(skill.files[skill.files.length - 1].content);
    expect(prompt({ ...writingJob, kind: 'memory' }).toolSkills).not.toContain(skill);
    expect(prompt({ ...writingJob, skillIds: [] }).toolSkills).not.toContain(skill);
  });

  it('未选用的小说写法不混入写作，记忆任务不应用文风资源', () => {
    const { state, writingConfig, writingJob } = writing();
    writingJob.skillIds = [];
    expect(buildPrompt(state, writingJob, writingJob.steps[0], writingConfig).system).not.toContain('铜钱推回');
    writingJob.skillIds = [state.skills[0].id];
    expect(buildPrompt(state, { ...writingJob, kind: 'memory' } as Job, writingJob.steps[0], writingConfig).system).not.toContain('铜钱推回');
  });
});

describe('写法适用性选择', () => {
  const files = [
    { path: 'references/dialogue/001.md', content: '# 对白\n\n## 说辞与动作反差\n\n适用情境：人物掩饰着急，又要维持面子。\n\n1. 让动作先泄露真实诉求。\n\n### 迁移示例\n\n他把行李箱拉到门口，又说不着急。\n\n### 反例与修正\n\n不要再用旁白重复解释。' },
    { path: 'references/plot/002.md', content: '# 情节\n\n## 日常经营的阵营冲突\n\n适用情境：宗门通过推广新品扩张阵营。\n\n1. 招募经销商。\n\n### 迁移示例\n\n掌柜公布了代理价格。' },
  ];
  it('选择器只读目录条件，写作者取得所选完整方法，不改写保存资源', async () => {
    const saved = structuredClone(files), calls: string[] = [];
    const selected = await selectSkillResources(files, 'draft', '急于离开，却不愿承认。不要加入经营推广。', 64000, new AbortController().signal, async (_system, user) => { calls.push(user); return JSON.stringify({ paths: [files[0].path] }); });
    expect(calls[0]).toContain('人物掩饰着急'); expect(calls[0]).toContain('不要加入经营推广');
    expect(calls[0]).not.toContain('他把行李箱拉到门口');
    expect(selected).toEqual([saved[0]]); expect(files).toEqual(saved);
  });

  it('目录分批覆盖全部写法，最终选择仍受数量和上下文约束', async () => {
    const library = Array.from({ length: 100 }, (_, index) => ({ path: `references/dialogue/${index}.md`, content: `## 写法${index}\n\n适用情境：${'面对不同人物目标时观察动作和回应。'.repeat(8)}\n\n1. 具体操作。\n\n### 迁移示例\n\n${'正文示例不能进入选择器。'.repeat(80)}` }));
    const seen = new Set<string>(); let count = 0;
    const selected = await selectSkillResources(library, 'draft', '最后一班车即将离开。', 4000, new AbortController().signal, async (system, user) => {
      expect(system.length + user.length).toBeLessThanOrEqual(4000); count++;
      const catalogue = JSON.parse(user.split('写法目录：\n')[1]) as { path: string }[];
      catalogue.forEach(item => seen.add(item.path));
      expect(user).not.toContain('正文示例不能进入选择器');
      return JSON.stringify({ paths: catalogue.slice(0, 2).map(item => item.path) });
    });
    expect(seen.size).toBe(100); expect(count).toBeGreaterThan(1);
    expect(selected.length).toBeLessThanOrEqual(8);
    for (const file of selected) expect(file).toEqual(library.find(item => item.path === file.path));
  });

  it('拒绝未知文件和超量选择，空选择有效，停止与连接错误不继续请求', async () => {
    const feedback: string[] = [];
    const selected = await selectSkillResources(files, 'draft', '离开前的争执。', 64000, new AbortController().signal, async (_system, user) => { feedback.push(user); return JSON.stringify({ paths: feedback.length === 1 ? ['../../unknown.md'] : [] }); });
    expect(selected).toEqual([]); expect(feedback).toHaveLength(2);
    let excessive = 0;
    await expect(selectSkillResources(files, 'draft', '', 64000, new AbortController().signal, async () => { excessive++; return JSON.stringify({ paths: Array(9).fill(files[0].path) }); })).rejects.toThrow('选择结果无效');
    expect(excessive).toBe(3);
    const stopped = new AbortController(); let calls = 0;
    await expect(selectSkillResources(files, 'draft', '', 64000, stopped.signal, async () => { calls++; stopped.abort(); return '{"paths":[]}'; })).rejects.toThrow();
    expect(calls).toBe(1);
    calls = 0;
    await expect(selectSkillResources(files, 'draft', '', 64000, new AbortController().signal, async () => { calls++; throw new Error('连接失败'); })).rejects.toThrow('连接失败');
    expect(calls).toBe(1);
  });
});
