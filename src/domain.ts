import { z } from 'zod';

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const taskNames = { draft: '起草', continue: '续写', rewrite: '改写', review: '审稿', plan: '故事规划', memory: '提取记忆', scan: '扫榜选题', analyze: '拆文', style: '提取风格' } as const;
export type TaskKind = keyof typeof taskNames;
export const noteNames = { character: '人物', relation: '人物关系', world: '世界设定', volume: '卷纲', scene: '场景', branch: '情节分支', fact: '正文事实', state: '人物状态', timeline: '时间线', foreshadow: '伏笔', knowledge: '知情状态', reference: '参考资料' } as const;
export type NoteKind = keyof typeof noteNames;
const taskSchema = z.enum(Object.keys(taskNames) as [TaskKind, ...TaskKind[]]);
const noteSchema = z.object({ id: z.string(), kind: z.enum(Object.keys(noteNames) as [NoteKind, ...NoteKind[]]), title: z.string(), body: z.string(), chapterId: z.string().default(''), status: z.enum(['confirmed', 'planned', 'reference']).default('planned') });
const versionSchema = z.object({ id: z.string(), content: z.string(), createdAt: z.string(), label: z.string() });
const chapterSchema = z.object({ id: z.string(), title: z.string(), plan: z.string(), content: z.string(), summary: z.string(), styleId: z.string().default(''), versions: z.array(versionSchema), updatedAt: z.string() });
const projectSchema = z.object({ id: z.string(), title: z.string(), form: z.enum(['long', 'short']), genre: z.string(), theme: z.string(), audience: z.string(), targetWords: z.number().nonnegative(), synopsis: z.string(), outline: z.string(), styleId: z.string(), chapters: z.array(chapterSchema), notes: z.array(noteSchema), createdAt: z.string(), updatedAt: z.string() });
const providerSchema = z.object({ id: z.string(), name: z.string(), protocol: z.enum(['chat', 'responses', 'anthropic', 'gemini']), baseUrl: z.string(), hasKey: z.boolean(), models: z.array(z.string()), enabled: z.boolean() });
const profileSchema = z.object({ id: z.string(), name: z.string(), providerId: z.string(), model: z.string(), tasks: z.array(taskSchema), temperature: z.number().min(0).max(2), sampling: z.boolean(), maxTokens: z.number().int().min(256).max(200000), contextChars: z.number().int().min(4000).max(500000), reasoning: z.enum(['off', 'effort', 'budget', 'adaptive']), effort: z.enum(['low', 'medium', 'high', 'xhigh']), budget: z.number().int().min(1024), extra: z.string() });
const skillSchema = z.object({ id: z.string(), name: z.string(), description: z.string(), source: z.string(), version: z.string(), enabled: z.boolean(), builtin: z.boolean(), tasks: z.array(taskSchema), files: z.array(z.object({ path: z.string(), content: z.string() })), revisions: z.array(z.object({ version: z.string(), files: z.array(z.object({ path: z.string(), content: z.string() })), savedAt: z.string() })).default([]) });
const styleSchema = z.object({ id: z.string(), name: z.string(), content: z.string(), source: z.string(), createdAt: z.string() });
const referenceSchema = z.object({ id: z.string(), title: z.string(), source: z.string(), kind: z.enum(['ranking', 'text']), content: z.string(), createdAt: z.string() });
const stepSchema = z.object({ id: z.string(), chapterId: z.string(), title: z.string(), status: z.enum(['pending', 'running', 'ready', 'accepted']), output: z.string(), baseContent: z.string(), basePlan: z.string(), selection: z.string(), selectionStart: z.number().int(), selectionEnd: z.number().int(), section: z.string().default(''), aggregate: z.boolean().default(false), intermediate: z.boolean().default(false), inputIds: z.array(z.string()).optional() });
const jobSchema = z.object({ id: z.string(), projectId: z.string(), kind: taskSchema, profileId: z.string(), styleId: z.string(), instruction: z.string(), sourceId: z.string(), sourceText: z.string().default(''), sourceTitle: z.string().default(''), status: z.enum(['running', 'paused', 'failed', 'ready', 'accepted']), error: z.string(), steps: z.array(stepSchema), createdAt: z.string() });
export const workspaceSchema = z.object({ schemaVersion: z.literal(1), projects: z.array(projectSchema), providers: z.array(providerSchema), profiles: z.array(profileSchema), skills: z.array(skillSchema), styles: z.array(styleSchema), references: z.array(referenceSchema), jobs: z.array(jobSchema), activeProjectId: z.string(), updatedAt: z.string() });
export type Workspace = z.infer<typeof workspaceSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Style = z.infer<typeof styleSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export type Job = z.infer<typeof jobSchema>;
export type JobStep = z.infer<typeof stepSchema>;

const builtin = (name: string, description: string, tasks: TaskKind[], content: string): Skill => ({ id: `builtin-${tasks[0]}`, name, description, tasks, source: '内置', version: '1.0', enabled: true, builtin: true, files: [{ path: 'SKILL.md', content }], revisions: [] });
export const builtinSkills = [
  builtin('小说创作', '人物动机、场景推进与自然表达', ['draft', 'continue', 'rewrite'], '用人物的目标、阻碍和选择推进故事。场景应有清晰的视角、地点与行动。人物语言服从身份和情境，避免同质对话。用具体动作和细节表现情绪。长短句和段落随事件变化，不机械套用固定结构。不要为了制造悬念违反人物知情范围。章节结尾落在动作、画面或台词上。遵守已经确认的设定与正文，不擅自回收未计划的伏笔。仅输出小说正文。'),
  builtin('故事规划', '主题、人物弧线与情节因果', ['plan'], '从主题、读者预期、主角目标、阻力和代价出发设计故事。用因果关系组织事件，区分全书、卷、章节和场景层级。列出关键转折、人物变化、伏笔与回收。短篇围绕集中冲突，长篇允许多线但保持主线推进。未确定信息给出可选方案，不能当成既定事实。避免强制套用固定套路。'),
  builtin('审稿与连续性', '正文质量、逻辑和跨章一致性', ['review', 'memory'], '审稿检查人物动机、因果、时空、人物位置、持有物、知情状态、语气、伏笔和重复表达。指出问题时引用原文并说明影响，区分事实矛盾与表达建议。提取记忆仅依据已提供正文，禁止把计划或参考当成已发生事件。'),
  builtin('榜单研究', '从真实样本形成选题', ['scan'], '仅分析提供的真实榜单数据。区分题材、标签、人设、冲突、简介切入点与公开指标。提出多个可独立创作的选题，注明支撑的样本。禁止杜撰榜单名次、阅读量或收益，不将样本热度等同于创作结果。'),
  builtin('文本拆解', '结构、节奏与写作手法', ['analyze'], '依据原文逐段辨认人物、事件、情绪变化、伏笔和表达手法。用结构解释阅读效果，给出可迁移的方法而不是复用原文情节。引用必须准确，标明段落编号；找不到证据的结论应舍弃。'),
  builtin('表达风格', '提取可复用的表达规则', ['style'], '提取视角、叙述距离、句法、段落节奏、词语选择、描写密度、对话方式、修辞和禁用表达。给出简洁可编辑的规则。风格不包含人物、剧情、专有设定或原文句子，不以模仿特定作者身份为目标。'),
];
export const emptyWorkspace = (): Workspace => ({ schemaVersion: 1, projects: [], providers: [], profiles: [], skills: structuredClone(builtinSkills), styles: [], references: [], jobs: [], activeProjectId: '', updatedAt: now() });
export function parseWorkspace(raw: string): Workspace {
  const data = workspaceSchema.parse(JSON.parse(raw));
  data.jobs = data.jobs.map(job => job.status === 'running' ? { ...job, status: 'paused', steps: job.steps.map(step => step.status === 'running' ? { ...step, status: 'pending' } : step) } : job);
  return data;
}
export const newChapter = (title = '第一章'): Chapter => ({ id: uid(), title, plan: '', content: '', summary: '', styleId: '', versions: [], updatedAt: now() });
export function newProject(title: string, form: Project['form']): Project {
  return { id: uid(), title: title.trim() || '未命名小说', form, genre: '', theme: '', audience: '', targetWords: form === 'long' ? 300000 : 10000, synopsis: '', outline: '', styleId: '', chapters: [newChapter(form === 'long' ? '第一章' : '正文')], notes: [], createdAt: now(), updatedAt: now() };
}
export const wordCount = (s: string) => (s.match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu) ?? []).length;
export const projectWords = (p: Project) => p.chapters.reduce((total, c) => total + wordCount(c.content), 0);
export function snapshot(chapter: Chapter, label: string): Chapter {
  if (!chapter.content || chapter.versions[0]?.content === chapter.content) return chapter;
  return { ...chapter, versions: [{ id: uid(), content: chapter.content, createdAt: now(), label }, ...chapter.versions].slice(0, 100) };
}
export function editChapter(chapter: Chapter, patch: Partial<Chapter>, label = '编辑前'): Chapter {
  const changed = patch.content !== undefined && patch.content !== chapter.content;
  const capture = changed && (!chapter.versions.length || Date.now() - Date.parse(chapter.versions[0].createdAt) > 300000);
  return { ...(capture ? snapshot(chapter, label) : chapter), ...patch, updatedAt: now() };
}
export function importChapters(text: string): Chapter[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const chapters: Chapter[] = [];
  let title = '正文', body: string[] = [];
  const flush = () => { if (body.join('\n').trim()) chapters.push({ ...newChapter(title), content: body.join('\n').trim() }); body = []; };
  for (const line of lines) {
    if (/^\s*(?:#{1,3}\s+.+|第[零〇一二三四五六七八九十百千万两\d]+[章节回][\s　:：.、]?.*)\s*$/.test(line) && line.length < 100) {
      flush(); title = line.replace(/^\s*#{1,3}\s+/, '').trim();
    } else body.push(line);
  }
  flush();
  return chapters.length ? chapters : [newChapter()];
}
export function exportNovel(project: Project, format: 'txt' | 'md'): string {
  return [format === 'md' ? `# ${project.title}` : project.title, ...project.chapters.map(c => `${format === 'md' ? '## ' : ''}${c.title}\n\n${c.content}`)].join('\n\n');
}
export function newProfile(providerId = ''): Profile {
  return { id: uid(), name: '写作预设', providerId, model: '', tasks: ['draft', 'continue', 'rewrite'], temperature: 0.8, sampling: false, maxTokens: 8192, contextChars: 64000, reasoning: 'off', effort: 'medium', budget: 2048, extra: '{}' };
}
export function profileFor(state: Workspace, kind: TaskKind): Profile | undefined { return state.profiles.find(p => p.tasks.includes(kind)) ?? state.profiles[0]; }
export function validateProfile(profile: Profile, provider?: Provider): void {
  profileSchema.parse(profile);
  if (!provider || !provider.enabled) throw new Error('请选择可用的 AI 服务');
  if (!profile.model.trim()) throw new Error('请选择或填写模型');
  const url = new URL(provider.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 地址无效');
  if (profile.reasoning === 'budget' && profile.budget >= profile.maxTokens) throw new Error('推理预算须小于输出上限');
  if (['chat', 'responses'].includes(provider.protocol) && ['budget', 'adaptive'].includes(profile.reasoning)) throw new Error('该协议使用推理强度设置');
  if (provider.protocol === 'anthropic' && profile.reasoning === 'effort') throw new Error('该协议使用推理预算或自适应推理');
  const extra = JSON.parse(profile.extra);
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('附加参数须为 JSON 对象');
  if (!profile.name.trim()) throw new Error('请填写预设名称');
  if (provider.protocol === 'gemini' && profile.reasoning === 'effort' && profile.effort === 'xhigh') throw new Error('Gemini 推理强度请选择低、中或高');
  for (const key of ['model', 'messages', 'input', 'contents', 'system', 'systemInstruction', 'instructions', 'stream', 'tools', 'max_tokens', 'max_completion_tokens', 'max_output_tokens', 'temperature', 'reasoning', 'reasoning_effort', 'thinking']) {
    if (key in extra) throw new Error(`附加参数不能覆盖 ${key}`);
  }
}
export function createJob(project: Project | undefined, kind: TaskKind, profileId: string, chapterIds: string[], instruction: string, styleId = '', sourceId = '', selection?: { start: number; end: number }): Job {
  const chapters = project?.chapters.filter(c => chapterIds.includes(c.id)) ?? [];
  const steps: JobStep[] = chapters.length ? chapters.map(c => ({ id: uid(), chapterId: c.id, title: c.title, status: 'pending', output: '', baseContent: c.content, basePlan: c.plan, selection: selection ? c.content.slice(selection.start, selection.end) : '', selectionStart: selection?.start ?? 0, selectionEnd: selection?.end ?? 0, section: '', aggregate: false, intermediate: false })) : [{ id: uid(), chapterId: '', title: taskNames[kind], status: 'pending', output: '', baseContent: '', basePlan: '', selection: '', selectionStart: 0, selectionEnd: 0, section: '', aggregate: false, intermediate: false }];
  if (!chapters.length) steps[0].basePlan = project?.outline ?? '';
  return { id: uid(), projectId: project?.id ?? '', kind, profileId, styleId, instruction, sourceId, sourceText: '', sourceTitle: '', status: 'running', error: '', steps, createdAt: now() };
}
export function acceptedChapter(chapter: Chapter, job: Job, step: JobStep): Chapter {
  if (chapter.content !== step.baseContent) throw new Error('正文已更新，请重新生成或手动合并');
  if (!step.output.trim()) throw new Error('生成结果为空');
  let content = step.output;
  if (job.kind === 'continue') content = chapter.content + (chapter.content ? '\n\n' : '') + step.output;
  if (job.kind === 'rewrite' && step.selection) {
    if (chapter.content.slice(step.selectionStart, step.selectionEnd) !== step.selection) throw new Error('选中正文已更新');
    content = chapter.content.slice(0, step.selectionStart) + step.output + chapter.content.slice(step.selectionEnd);
  }
  return { ...snapshot(chapter, `${taskNames[job.kind]}前`), content, updatedAt: now() };
}
