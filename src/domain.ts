import { z } from 'zod';
import { defaultProxySettings, proxySettingsSchema } from './proxy';
import novelAssistantSkill from './skills/novel-assistant/SKILL.md?raw';
import { collectionSchema } from './researchSources';
import { rankingSchema } from './rankings';
import { BOOK_SEARCH_HISTORY_LIMIT } from './bookSearch';
import { articleRuleSchema, articlePageSchema, defaultArticleRule, defaultArticleRules, ixdzsArticleRule } from './articleRules';
import { creationDraftSchema, creationTaskSchema } from './novelCreationData';
import { coverDraftSchema, coverOptionsSchema, defaultCoverOptions, imageConfigSchema, imageProviderSchema, imageSelectionSchema, normalizeImageSelection } from './coverData';
import { skillResearchSchema } from './skillExtractionData';

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const taskNames = { revise: '小说 AI', draft: '起草', continue: '续写', rewrite: '改写', review: '审稿', plan: '故事规划', memory: '提取记忆', scan: '扫榜选题', analyze: '拆文', style: '提取 Skill', prepare: '完善创作准备', summary: '生成摘要', train: 'Skill 训练', collect: '采集正文' } as const;
export type TaskKind = keyof typeof taskNames;
export const chapterWritingKinds: readonly TaskKind[] = ['draft', 'continue', 'rewrite', 'review', 'plan'];
export const noteNames = { character: '人物', relation: '人物关系', world: '世界设定', volume: '卷纲', scene: '场景', branch: '情节分支', fact: '正文事实', state: '人物状态', timeline: '时间线', foreshadow: '伏笔', knowledge: '知情状态', reference: '参考资料' } as const;
export type NoteKind = keyof typeof noteNames;
const taskSchema = z.enum(Object.keys(taskNames) as [TaskKind, ...TaskKind[]]);
const noteSchema = z.object({ id: z.string(), kind: z.enum(Object.keys(noteNames) as [NoteKind, ...NoteKind[]]), title: z.string(), body: z.string(), chapterId: z.string().default(''), status: z.enum(['confirmed', 'planned', 'reference']).default('planned'), relation: z.object({ sourceId: z.string(), targetId: z.string() }).optional(), graphPosition: z.object({ x: z.number().finite(), y: z.number().finite() }).optional() });
const versionSchema = z.object({ id: z.string(), content: z.string(), createdAt: z.string(), label: z.string() });
const chapterSchema = z.object({ id: z.string(), title: z.string(), plan: z.string(), content: z.string(), summary: z.string(), memoryHash: z.string().optional(), styleId: z.string().default(''), versions: z.array(versionSchema), updatedAt: z.string() });
const projectSchema = z.object({ id: z.string(), title: z.string(), form: z.enum(['long', 'short']), genre: z.string(), theme: z.string(), audience: z.string(), targetWords: z.number().nonnegative(), synopsis: z.string(), outline: z.string(), cover: z.string().default(''), coverDraft: coverDraftSchema.optional(), styleId: z.string(), referenceIds: z.array(z.string()).default([]), skillIds: z.array(z.string()).default([]), chapters: z.array(chapterSchema), notes: z.array(noteSchema), createdAt: z.string(), updatedAt: z.string() });
const advancedSchema = z.object({ temperature: z.number().min(0).max(2), sampling: z.boolean(), maxTokens: z.number().int().min(256).max(200000), contextChars: z.number().int().min(4000).max(500000), extra: z.string() });
export const defaultAdvanced = (): z.infer<typeof advancedSchema> => ({ temperature: 0.8, sampling: false, maxTokens: 8192, contextChars: 64000, extra: '{}' });
export const DEFAULT_AI_RETRIES = 10;
export const MAX_AI_RETRIES = 100;
const retryCountSchema = z.number().int().min(0).max(MAX_AI_RETRIES);
const providerSchema = z.object({ id: z.string(), name: z.string(), protocol: z.enum(['chat', 'responses', 'anthropic', 'gemini']), baseUrl: z.string(), hasKey: z.boolean(), models: z.array(z.string()), enabled: z.boolean(), concurrency: z.number().int().min(1).max(16).optional(), maxRetries: retryCountSchema.default(DEFAULT_AI_RETRIES), advanced: advancedSchema.default(defaultAdvanced) });
const effortValues = ['default', 'low', 'medium', 'high', 'xhigh'] as const;
const selectionSchema = z.object({ providerId: z.string(), model: z.string(), effort: z.enum(effortValues) });
const aiConfigSchema = selectionSchema.extend(advancedSchema.shape);
// Old modes stored an unused effort alongside the active mode. Only an explicitly selected effort carries over.
function migrateLegacyEffort(value: unknown) {
  if (value && typeof value === 'object' && 'reasoning' in value && value.reasoning !== 'effort') return { ...value, effort: 'default' };
  return value;
}
const legacyProfileSchema = z.preprocess(migrateLegacyEffort, aiConfigSchema.extend({ id: z.string(), name: z.string(), tasks: z.array(taskSchema) }));
const skillFileSchema = z.object({ path: z.string(), content: z.string() });
const skillSchema = z.object({ originReferenceId: z.string().optional(), extractionJobId: z.string().optional(), resourceMode: z.literal('relevant').optional(), id: z.string(), name: z.string(), description: z.string(), source: z.string(), version: z.string(), enabled: z.boolean(), builtin: z.boolean(), tasks: z.array(taskSchema), files: z.array(skillFileSchema), revisions: z.array(z.object({ version: z.string(), files: z.array(skillFileSchema), savedAt: z.string() })).default([]) });
const styleSchema = z.object({ id: z.string(), name: z.string(), content: z.string(), source: z.string(), createdAt: z.string() });
const referenceSchema = z.object({ id: z.string(), title: z.string(), source: z.string(), kind: z.enum(['ranking', 'text']), content: z.string(), createdAt: z.string(), ranking: rankingSchema.optional(), bookUrl: z.string().optional(), collection: collectionSchema.optional() });
const executionSchema = z.object({ summary: z.string(), skills: z.array(z.object({ id: z.string(), name: z.string(), version: z.string(), automatic: z.boolean().optional(), files: z.array(z.string()), contents: z.array(skillFileSchema).optional() })), startedAt: z.string(), finishedAt: z.string().optional() });
const stepSchema = z.object({ id: z.string(), chapterId: z.string(), title: z.string(), status: z.enum(['pending', 'running', 'ready', 'accepted']), output: z.string(), reasoning: z.string().optional(), execution: executionSchema.optional(), research: skillResearchSchema.optional(), baseContent: z.string(), basePlan: z.string(), selection: z.string(), selectionStart: z.number().int(), selectionEnd: z.number().int(), section: z.string().default(''), aggregate: z.boolean().default(false), intermediate: z.boolean().default(false), inputIds: z.array(z.string()).optional(), stage: z.string().optional(), round: z.number().int().optional(), caseIndex: z.number().int().optional() });
export const trainingAnnotationSchema = z.object({
  caseIndex: z.number().int().min(0).max(5), target: z.enum(['original', 'candidate']),
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  quote: z.string().min(1).max(8000), feedback: z.string().trim().min(1).max(4000),
}).refine(value => value.end > value.start, { message: '请选择评价片段' });
export type TrainingAnnotation = z.infer<typeof trainingAnnotationSchema>;
export const trainingScoreSchema = z.union([z.number().min(0).max(10), z.literal('')]);
export type TrainingScore = z.infer<typeof trainingScoreSchema>;
export const trainingSchema = z.object({
  skillId: z.string(), initialSkill: z.string(), bestSkill: z.string(), bestScore: z.number().default(-1),
  targetScore: z.number().min(1).max(10), judge: z.literal('human'),
  original: z.string().optional(), chapterTitle: z.string().optional(), mode: z.enum(['chapter', 'scenario']).optional(),
  parentJobId: z.string().optional(), approvedAt: z.string().optional(),
  resourceFiles: z.array(skillFileSchema).optional(),
  cases: z.array(z.object({ title: z.string().min(1), brief: z.string().trim().min(1).max(8000), original: z.string() })).max(6),
  evaluations: z.array(z.object({ round: z.number(), scores: z.array(trainingScoreSchema), feedback: z.string(), decision: z.enum(['revise', 'reextract', 'keep', 'auto']), source: z.enum(['ai', 'human']), annotations: z.array(trainingAnnotationSchema).max(100).optional(), satisfied: z.boolean().optional() })),
  review: z.object({ round: z.number().int().positive(), scores: z.array(trainingScoreSchema), feedback: z.string().max(8000), annotations: z.array(trainingAnnotationSchema).max(100) }).optional(),
}).refine(value => value.cases.length >= 1 || !!value.original?.trim(), { message: '请选择原文章节' });
const collectionTaskSchema = z.object({ bookUrl: z.string(), title: z.string(), scope: z.enum(['opening', 'chapter', 'available']), chapterId: z.string(), rule: articleRuleSchema.optional(), referenceId: z.string(), done: z.number().default(0), total: z.number().default(0) });
const articleTaskSchema = z.object({ url: z.string(), rule: articleRuleSchema, mode: z.enum(['catalog', 'chapter', 'range']), page: articlePageSchema.optional(), links: z.array(z.object({ title: z.string(), url: z.string() })), referenceId: z.string(), done: z.number().int().nonnegative().default(0), total: z.number().int().nonnegative().default(0) });
const jobSchema = z.object({
  clearedChatChapterIds: z.array(z.string()).optional(),
  hiddenFromTaskList: z.boolean().optional(),
  id: z.string(), projectId: z.string(), kind: taskSchema, ai: z.preprocess(migrateLegacyEffort, aiConfigSchema).nullable(), styleId: z.string(), instruction: z.string(), targetWords: z.number().int().min(100).max(50000).optional(), sourceId: z.string(), sourceText: z.string().default(''), sourceTitle: z.string().default(''), status: z.enum(['queued', 'running', 'paused', 'failed', 'ready', 'accepted', 'waiting']), error: z.string(), steps: z.array(stepSchema), preparationBase: z.string().optional(), skillTarget: z.object({ id: z.string(), snapshot: z.string() }).optional(), novelChat: z.object({ previousJobIds: z.array(z.string()), base: z.string(), before: z.string().optional(), appliedBase: z.string().optional(), undone: z.boolean().optional() }).optional(), planningChat: z.object({ previousJobIds: z.array(z.string()), base: z.string() }).optional(), skillIds: z.array(z.string()).optional(), training: trainingSchema.optional(), collectionTask: collectionTaskSchema.optional(), articleTask: articleTaskSchema.optional(), creationTask: creationTaskSchema.optional(), createdAt: z.string() });
export const workspaceSchema = z.object({ schemaVersion: z.literal(2), proxy: proxySettingsSchema.default(defaultProxySettings), projects: z.array(projectSchema), providers: z.array(providerSchema), imageProviders: z.array(imageProviderSchema).default([]), imageSelection: imageSelectionSchema.default({ providerId: '', model: '' }), coverOptions: coverOptionsSchema.default(defaultCoverOptions), aiSelection: z.preprocess(migrateLegacyEffort, selectionSchema).default(newAISelection), skills: z.array(skillSchema), styles: z.array(styleSchema), references: z.array(referenceSchema), articleRules: z.array(articleRuleSchema).default(() => structuredClone(defaultArticleRules)), articleRulesRevision: z.number().int().nonnegative().default(0), bookSearchHistory: z.array(z.string().trim().min(1).max(100)).max(BOOK_SEARCH_HISTORY_LIMIT).default([]), creationDraft: creationDraftSchema.optional(), jobs: z.array(jobSchema), activeProjectId: z.string(), updatedAt: z.string() });
const legacyWorkspaceSchema = workspaceSchema.extend({ schemaVersion: z.literal(1), profiles: z.array(legacyProfileSchema), jobs: z.array(jobSchema.omit({ ai: true }).extend({ profileId: z.string() })) });
export type Workspace = z.infer<typeof workspaceSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type AISelection = z.infer<typeof selectionSchema>;
export type AIConfig = z.infer<typeof aiConfigSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Style = z.infer<typeof styleSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export type Job = z.infer<typeof jobSchema>;
export type JobStep = z.infer<typeof stepSchema>;

const builtin = (name: string, description: string, tasks: TaskKind[], content: string): Skill => ({ id: `builtin-${tasks[0]}`, name, description, tasks, source: '内置', version: '1.0', enabled: true, builtin: true, files: [{ path: 'SKILL.md', content }], revisions: [] });
export const builtinSkills = [
  builtin('小说 AI', '统一调整小说信息、人物、世界设定与故事规划', ['revise'], novelAssistantSkill),
  builtin('小说创作', '人物动机、场景推进与自然表达', ['draft', 'continue', 'rewrite'], '用人物的目标、阻碍和选择推进故事。场景应有清晰的视角、地点与行动。人物语言服从身份和情境，避免同质对话。用具体动作和细节表现情绪。长短句和段落随事件变化，不机械套用固定结构。不要为了制造悬念违反人物知情范围。章节结尾落在动作、画面或台词上。遵守已经确认的设定与正文，不擅自回收未计划的伏笔。仅输出小说正文。'),
  builtin('故事规划', '主题、人物弧线与情节因果', ['plan'], '从主题、读者预期、主角目标、阻力和代价出发设计故事。用因果关系组织事件，区分全书、卷、章节和场景层级。列出关键转折、人物变化、伏笔与回收。短篇围绕集中冲突，长篇允许多线但保持主线推进。未确定信息给出可选方案，不能当成既定事实。避免强制套用固定套路。'),
  builtin('审稿与连续性', '正文质量、逻辑和跨章一致性', ['review', 'memory'], '审稿检查人物动机、因果、时空、人物位置、持有物、知情状态、语气、伏笔和重复表达。指出问题时引用原文并说明影响，区分事实矛盾与表达建议。提取记忆仅依据已提供正文，禁止把计划或参考当成已发生事件。'),
  builtin('榜单研究', '从真实样本形成选题', ['scan'], '仅分析提供的真实榜单数据。区分题材、标签、人设、冲突、简介切入点与公开指标。提出多个可独立创作的选题，注明支撑的样本。禁止杜撰榜单名次、阅读量或收益，不将样本热度等同于创作结果。'),
  builtin('文本拆解', '结构、节奏与写作手法', ['analyze'], '依据原文逐段辨认人物、事件、情绪变化、伏笔和表达手法。用结构解释阅读效果，给出可迁移的方法而不是复用原文情节。引用必须准确，标明段落编号；找不到证据的结论应舍弃。'),
  builtin('Skill 提炼', '提取叙事机制与表达规则', ['style'], '提取可执行的叙事机制：开篇钩子、人物欲望、冲突升级、信息差、情绪回报、反转、章节节奏、叙述视角、句法与对话。区分通用规律和题材适用条件，给出步骤、自检和反例。不得包含原作人物、专有设定、原文句子或特定章节答案。'),
];
export const emptyWorkspace = (): Workspace => ({ schemaVersion: 2, proxy: defaultProxySettings(), projects: [], providers: [], imageProviders: [], imageSelection: { providerId: '', model: '' }, coverOptions: defaultCoverOptions(), aiSelection: newAISelection(), skills: structuredClone(builtinSkills), styles: [], references: [], articleRules: structuredClone(defaultArticleRules), articleRulesRevision: 1, bookSearchHistory: [], jobs: [], activeProjectId: '', updatedAt: now() });
// Keep old range jobs usable without letting resume, retry or delete act on another chapter.
function splitLegacyWritingJob(job: Job): Job[] {
  if (!chapterWritingKinds.includes(job.kind) || job.creationTask || job.planningChat) return [job];
  const groups = new Map<string, JobStep[]>();
  for (const step of job.steps) {
    const group = groups.get(step.chapterId);
    if (group) group.push(step); else groups.set(step.chapterId, [step]);
  }
  if (groups.size < 2) return [job];
  return Array.from(groups, ([chapterId, steps], index) => {
    const complete = steps.every(step => step.status === 'ready' || step.status === 'accepted');
    const accepted = steps.every(step => step.intermediate || step.status === 'accepted');
    const status = !complete ? job.status : accepted ? 'accepted' : 'ready';
    return { ...job, id: index ? uid() : job.id, steps, status, error: complete ? '' : job.error,
      clearedChatChapterIds: job.clearedChatChapterIds?.filter(id => id === chapterId) };
  });
}
export function parseWorkspace(raw: string): Workspace {
  let input = JSON.parse(raw);
  // Existing training history remains readable; every resumed evaluation is manual.
  for (const job of input?.jobs ?? []) if (job.training) {
    job.training.judge = 'human';
    if (!job.training.mode && !job.training.cases.length) {
      job.training.mode = 'chapter';
      for (const step of job.steps) if (step.stage === 'train-scenarios') { step.stage = 'train-brief'; step.title = '提炼章节内容与创作提示词'; }
    }
  }
  if (input?.imageConfig) {
    const { model, size, quality, ...provider } = imageConfigSchema.parse(input.imageConfig);
    input.imageProviders = [...(input.imageProviders ?? [])];
    if (!input.imageProviders.some((value: { id: string }) => value.id === provider.id)) input.imageProviders.push({ ...provider, name: 'OpenAI GPT Image', models: [model], enabled: true });
    input.imageSelection ??= { providerId: provider.id, model };
    input.coverOptions ??= { size, quality };
    delete input.imageConfig;
  }
  const restoreAISelection = input?.aiSelection === undefined;
  let legacySelections: AISelection[] = [];
  if (input?.schemaVersion === 1) {
    const legacy = legacyWorkspaceSchema.parse(input);
    legacySelections = legacy.profiles.map(profile => selectionSchema.parse(profile));
    input = {
      ...legacy, schemaVersion: 2,
      providers: legacy.providers.map(provider => {
        const profiles = legacy.profiles.filter(p => p.providerId === provider.id);
        return { ...provider, models: [...new Set([...provider.models, ...profiles.map(p => p.model)].map(m => m.trim()).filter(Boolean))], advanced: profiles[0] ? advancedSchema.parse(profiles[0]) : provider.advanced };
      }),
      jobs: legacy.jobs.map(job => {
        const profile = legacy.profiles.find(p => p.id === job.profileId);
        return { ...job, ai: profile ? aiConfigSchema.parse(profile) : null };
      }),
    };
  }
  const data = workspaceSchema.parse(input);
  data.skills = [structuredClone(builtinSkills[0]), ...data.skills.filter(skill => skill.id !== 'builtin-revise')];
  if (restoreAISelection) {
    const selections: (AISelection | null)[] = [...[...data.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => job.ai), ...legacySelections];
    const previous = selections.find(selection => selection && data.providers.some(provider => provider.id === selection.providerId && provider.enabled && provider.models.includes(selection.model)));
    if (previous) data.aiSelection = selectionSchema.parse(previous);
  }
  data.aiSelection = normalizeAISelection(data.aiSelection, data.providers);
  data.imageSelection = normalizeImageSelection(data.imageSelection, data.imageProviders);
  if (data.articleRulesRevision < 1) {
    if (!data.articleRules.some(r => r.id === ixdzsArticleRule.id || /^https:\/\/ixdzs8\.com\/?$/.test(r.siteUrl))) data.articleRules.push(structuredClone(ixdzsArticleRule));
    const original = data.articleRules.find(r => r.id === defaultArticleRule.id && r.siteUrl === defaultArticleRule.siteUrl);
    if (original && !original.search) {
      original.search = structuredClone(defaultArticleRule.search);
      original.catalogLinkSelector ||= defaultArticleRule.catalogLinkSelector;
    }
    data.articleRulesRevision = 1;
  }
  // Preserve legacy style data as opt-in skills; the removed style UI is no longer needed.
  for (const style of data.styles) {
    const id = `legacy-style-${style.id}`;
    if (!data.skills.some(skill => skill.id === id)) data.skills.push({ id, name: style.name, description: '写作规则', source: style.source, version: '1.0', enabled: false, builtin: false, tasks: ['draft', 'continue', 'rewrite', 'plan'], files: [{ path: 'SKILL.md', content: style.content }], revisions: [] });
    for (const project of data.projects) if (project.styleId === style.id && !project.skillIds.includes(id)) project.skillIds.push(id);
  }
  data.jobs = data.jobs.flatMap(splitLegacyWritingJob).map(job => ['running', 'queued'].includes(job.status) ? { ...job, status: 'paused', steps: job.steps.map(step => step.status === 'running' ? { ...step, status: 'pending' } : step) } : job);
  return data;
}
export const newChapter = (title = '第一章'): Chapter => ({ id: uid(), title, plan: '', content: '', summary: '', styleId: '', versions: [], updatedAt: now() });
export function newProject(title: string, form: Project['form']): Project {
  return { id: uid(), title: title.trim() || '未命名小说', form, genre: '', theme: '', audience: '', targetWords: form === 'long' ? 300000 : 10000, synopsis: '', outline: '', cover: '', styleId: '', referenceIds: [], skillIds: [], chapters: [newChapter(form === 'long' ? '第一章' : '正文')], notes: [], createdAt: now(), updatedAt: now() };
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
export function newAISelection(): AISelection { return { providerId: '', model: '', effort: 'default' }; }
export function supportedEfforts(protocol?: Provider['protocol']): readonly AISelection['effort'][] {
  return protocol === 'chat' || protocol === 'responses' ? effortValues : effortValues.filter(effort => effort !== 'xhigh');
}
export function normalizeAISelection(selection: AISelection, providers: Provider[]): AISelection {
  const provider = providers.find(p => p.id === selection.providerId && p.enabled && p.models.length);
  if (!provider) return { ...selection, providerId: '', model: '' };
  const effort = supportedEfforts(provider.protocol).includes(selection.effort) ? selection.effort : 'high';
  return { ...selection, model: provider.models.includes(selection.model) ? selection.model : '', effort };
}
export function resolveAI(selection: AISelection, providers: Provider[]): AIConfig {
  const provider = providers.find(p => p.id === selection.providerId);
  const config = { ...selection, ...(provider?.advanced ?? defaultAdvanced()) };
  validateAI(config, provider);
  return config;
}
function validateAdvanced(advanced: Provider['advanced'], protocol: Provider['protocol']) {
  if (!advancedSchema.safeParse(advanced).success) throw new Error('请检查输出、上下文和采样参数');
  if (protocol === 'anthropic' && advanced.sampling && advanced.temperature > 1) throw new Error('Anthropic 采样温度须为 0 至 1');
  let extra;
  try { extra = JSON.parse(advanced.extra); } catch { throw new Error('附加参数须为有效的 JSON 对象'); }
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('附加参数须为 JSON 对象');
  for (const key of ['model', 'messages', 'input', 'contents', 'system', 'systemInstruction', 'instructions', 'stream', 'tools', 'max_tokens', 'max_completion_tokens', 'max_output_tokens', 'temperature', 'reasoning', 'reasoning_effort', 'thinking']) {
    if (key in extra) throw new Error(`附加参数不能覆盖 ${key}`);
  }
  if (protocol === 'anthropic' && 'output_config' in extra) {
    const config = extra.output_config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('output_config 须为 JSON 对象');
    if ('effort' in config) throw new Error('附加参数不能覆盖推理强度');
  }
  if ('generationConfig' in extra) {
    const config = extra.generationConfig;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('generationConfig 须为 JSON 对象');
    for (const key of ['maxOutputTokens', 'temperature', 'thinkingConfig']) if (key in config) throw new Error(`附加参数不能覆盖 ${key}`);
  }
}
export function validateProvider(provider: Provider): void {
  if (!retryCountSchema.safeParse(provider.maxRetries).success) throw new Error(`失败重试次数须为 0 至 ${MAX_AI_RETRIES} 的整数`);
  if (provider.concurrency !== undefined && (!Number.isInteger(provider.concurrency) || provider.concurrency < 1 || provider.concurrency > 16)) throw new Error('AI 并发数量须为 1 至 16');
  if (!provider.name.trim()) throw new Error('请填写供应商名称');
  let url;
  try { url = new URL(provider.baseUrl); } catch { throw new Error('请填写有效的 API 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请填写有效的 API 地址');
  if (!provider.models.length || provider.models.some(m => !m.trim())) throw new Error('请至少选择一个模型');
  validateAdvanced(provider.advanced, provider.protocol);
}
export function validateAI(config: AIConfig, provider?: Provider): void {
  if (!provider || !provider.enabled || provider.id !== config.providerId) throw new Error('请选择可用的 AI 供应商');
  if (!config.model || !provider.models.includes(config.model)) throw new Error('请选择供应商中已配置的模型');
  if (!selectionSchema.safeParse(config).success || !supportedEfforts(provider.protocol).includes(config.effort)) throw new Error('请选择有效的推理强度');
  validateAdvanced(config, provider.protocol);
}
export function createJob(project: Project | undefined, kind: TaskKind, ai: AIConfig | null, chapterId: string | undefined, instruction: string, styleId = '', sourceId = '', selection?: { start: number; end: number }): Job {
  const chapter = project?.chapters.find(c => c.id === chapterId);
  if (chapterId !== undefined && !chapter) throw new Error('章节已移除');
  if (!chapter && ['draft', 'continue', 'rewrite', 'review'].includes(kind)) throw new Error('请先选择当前章节');
  const steps: JobStep[] = [{
    id: uid(), chapterId: chapter?.id ?? '', title: chapter?.title ?? taskNames[kind], status: 'pending', output: '',
    baseContent: chapter?.content ?? '', basePlan: chapter?.plan ?? project?.outline ?? '',
    selection: chapter && selection ? chapter.content.slice(selection.start, selection.end) : '', selectionStart: selection?.start ?? 0, selectionEnd: selection?.end ?? 0,
    section: '', aggregate: false, intermediate: false,
  }];
  return { id: uid(), projectId: project?.id ?? '', kind, ai: ai ? { ...ai } : null, styleId, instruction, sourceId, sourceText: '', sourceTitle: '', status: 'running', error: '', steps, createdAt: now() };
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
