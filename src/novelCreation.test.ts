import { describe, expect, it } from 'vitest';
import { defaultAdvanced, emptyWorkspace, newAISelection, parseWorkspace, type Workspace } from './domain';
import { createCreationRound, creationContextKey, creationGenre, creationPrompt, finishCreationRound, newCreationDraft, parseCreationOptions, projectFromCreation, selectCreationOption, selectedCreationOption, setCreationDirection } from './novelCreation';
import { type CreationDraft, type CreationStage } from './novelCreationData';
import { requirePreparation } from './jobWorkflow';
import { formatCharacterProfile } from './characterProfile';
import { buildCharacterGraph } from './characterRelations';

const genres = () => ({ options: Array.from({ length: 6 }, (_, index) => ({ title: `题材${index + 1}`, genre: `科幻悬疑${index + 1}`, premise: `修复记忆的主角卷入案件${index + 1}` })) });
const cores = () => ({ options: Array.from({ length: 3 }, (_, index) => ({ title: `记忆修复师${index + 1}`, theme: '记忆与身份', audience: '悬疑读者', form: 'long', targetWords: 300000, synopsis: '修复师发现自己的记忆曾被删除。', setting: '每次修复会失去自己的一段记忆；主角必须追查幕后机构。' })) });
const outlines = () => ({ options: Array.from({ length: 3 }, (_, index) => ({ title: `结构${index + 1}`, summary: '从失踪案揭开记忆交易的真相。', outline: '失踪案引出机构阴谋，主角用自己的记忆保存证据，最终公开真相。', characters: [{ name: '林舟', role: '记忆修复师', motivation: '找回失踪的亲人', arc: '从交易记忆到守护事实', relations: '与调查员合作' }, { name: '许宁', role: '调查员', motivation: '揭开机构真相', arc: '从怀疑到信任', relations: '林舟的同伴' }], volumes: [{ title: '失踪记录', summary: '调查失踪案并发现机构。', turningPoints: '修复的记忆指向自己。', ending: '取得机构线索，进入下一卷。' }, { title: '记忆证据', summary: '揭开交易链并保存证据。', turningPoints: '主角必须牺牲记忆。', ending: '真相公开，亲人获救。' }] })) });
function workspace(): Workspace {
  const state = emptyWorkspace();
  state.providers = [{ id: 'test', name: '测试', protocol: 'chat', baseUrl: 'http://localhost:1421/v1', hasKey: false, models: ['model'], enabled: true, maxRetries: 0, advanced: defaultAdvanced() }];
  state.aiSelection = { ...newAISelection(), providerId: 'test', model: 'model' };
  return state;
}
function complete(state: Workspace, draft: CreationDraft, stage: CreationStage) {
  draft.stage = stage;
  if (stage === 'genre') {
    const options = parseCreationOptions(JSON.stringify(genres()), stage);
    draft.rounds.push({ id: 'legacy-genre', stage, contextKey: '', instruction: '不使用穿越，强化悬疑', options });
    state.creationDraft = draft; selectCreationOption(draft, options[0].id);
    return options;
  }
  const job = createCreationRound(state, draft, `生成${stage}`);
  state.jobs.push(job); state.creationDraft = draft;
  const source = stage === 'core' ? cores() : outlines();
  const options = parseCreationOptions(JSON.stringify(source), stage);
  finishCreationRound(state, job, options);
  job.status = 'ready'; job.steps[0].status = 'ready'; job.steps[0].output = JSON.stringify(source);
  selectCreationOption(draft, options[0].id);
  return options;
}

describe('guided novel creation', () => {
  it('starts at core settings and saves the author genre in a ready-to-write project', () => {
    const state = workspace(), draft = newCreationDraft('科幻悬疑、双人调查', '记忆修复师调查失踪案');
    expect(draft.stage).toBe('core'); expect(draft.selections.genre).toBe('');
    expect(() => projectFromCreation(draft)).toThrow('选择');
    complete(state, draft, 'core'); complete(state, draft, 'outline');
    const project = projectFromCreation(draft);
    expect(project).toMatchObject({ title: '记忆修复师1', genre: '科幻悬疑、双人调查', form: 'long', targetWords: 300000, theme: '记忆与身份', audience: '悬疑读者' });
    expect(() => requirePreparation(project)).not.toThrow();
    expect(project.outline).toContain('## 人物'); expect(project.outline).toContain('第2卷 记忆证据');
    expect(project.notes.filter(note => note.kind === 'character')).toHaveLength(2);
    expect(project.notes.filter(note => note.kind === 'volume')).toHaveLength(2);
    expect(project.notes.find(note => note.kind === 'world')?.body).toContain('失去自己的一段记忆');
    expect(project.chapters[0].content).toBe('');
    expect(state.projects).toHaveLength(0);
    expect(project.outline).not.toContain('结构2');
  });
  it('将总纲生成的关系关联到人物，旧方案仍能从人物档案生成关系图', () => {
    const state = workspace(), draft = newCreationDraft('科幻悬疑', '记忆修复师');
    complete(state, draft, 'core'); complete(state, draft, 'outline');
    const selected = selectedCreationOption(draft, 'outline')!;
    expect(buildCharacterGraph(projectFromCreation(draft).notes).relations).toHaveLength(1);
    selected.relationships = [{ source: '林舟', target: '许宁', title: '同伴', body: '共同调查记忆交易' }, { source: '许宁', target: '未知人物', title: '追踪', body: '追查线索' }];
    const project = projectFromCreation(draft), graph = buildCharacterGraph(project.notes);
    expect(graph.relations).toHaveLength(1); expect(graph.relations[0].title).toBe('同伴');
    expect(graph.unlinked).toHaveLength(1); expect(graph.unlinked[0].body).toContain('未知人物');
    const restored = parseWorkspace(JSON.stringify(state)).creationDraft!;
    expect(selectedCreationOption(restored, 'outline')!.relationships).toEqual(selected.relationships);
  });
  it('保留新方案的完整人物档案并继续读取旧方案', () => {
    const state = workspace(), draft = newCreationDraft('科幻悬疑', '记忆修复师');
    complete(state, draft, 'core'); complete(state, draft, 'outline');
    const option = selectedCreationOption(draft, 'outline')!;
    const body = formatCharacterProfile({ fields: { 身份: '修复师', 口头禅: '先留证据', 朋友: '许宁：同伴' }, extra: '' }, '林舟');
    const output = { options: Array.from({ length: 3 }, (_, index) => ({ ...option, title: `完整方案${index}`, characters: option.characters.map((character, i) => i ? character : { ...character, body }) })) };
    const parsed = parseCreationOptions(JSON.stringify(output), 'outline');
    draft.rounds[draft.rounds.length - 1].options = parsed;
    selectCreationOption(draft, parsed[0].id);
    state.creationDraft = draft;
    const restored = parseWorkspace(JSON.stringify(state)).creationDraft!;
    expect(projectFromCreation(restored).notes.find(note => note.title === '林舟')?.body).toBe(body);
    expect(creationPrompt(restored, 'outline', '继续').system).toContain('道德底线');
  });
  it('keeps the author scope and carries core feedback into outline generation', () => {
    const idea = '先卖手机，再上线短视频、游戏、电影、音乐，再发展美食、职业比赛、房地产与洗脚按摩';
    const state = workspace(), draft = newCreationDraft('修仙、文化入侵、搞笑脑洞', idea);
    const options = complete(state, draft, 'core');
    createCreationRound(state, draft, '不使用穿越，强化悬疑');
    const prompt = creationPrompt(draft, 'core', '增加调查员搭档');
    expect(prompt.user).toContain(idea); expect(prompt.user).toContain(draft.genre);
    expect(prompt.user).toContain('不使用穿越，强化悬疑');
    expect(prompt.user).toContain('增加调查员搭档');
    expect(prompt.user).toContain('当前选中方案：');
    expect(prompt.user).toContain(options[0].id);
    expect(prompt.system).toContain('3 个方案'); expect(prompt.system).toContain('不得为制造差异将其拆成互斥的单一行业故事');
    expect(prompt.system).toContain('仅在作者明确要求修改它时');
    draft.stage = 'outline'; const outlinePrompt = creationPrompt(draft, 'outline', '保留记忆代价');
    expect(outlinePrompt.user).toContain('作者提供的题材'); expect(outlinePrompt.user).toContain('已确认核心设定');
    expect(outlinePrompt.user).toContain('不使用穿越，强化悬疑');
    expect(outlinePrompt.system).toContain('人物设计'); expect(outlinePrompt.system).toContain('分卷');
    expect(() => creationPrompt(draft, 'genre', '继续')).toThrow('填写题材');
  });
  it('retains history but invalidates downstream selections when the author changes genre or idea', () => {
    const state = workspace(), draft = newCreationDraft('科幻悬疑', '记忆修复师');
    const core = complete(state, draft, 'core'); const outline = complete(state, draft, 'outline');
    draft.stage = 'core'; selectCreationOption(draft, core[1].id);
    expect(draft.selections.outline).toBe(''); draft.stage = 'outline';
    expect(() => selectCreationOption(draft, outline[0].id)).toThrow('方案已移除');
    setCreationDirection(draft, '奇幻喜剧', draft.idea);
    expect(draft.selections.core).toBe(''); expect(draft.selections.outline).toBe('');
    expect(draft.rounds).toHaveLength(2); expect(() => selectCreationOption(draft, core[0].id)).toThrow('方案已移除');
    draft.selections.core = core[0].id;
    expect(selectedCreationOption(draft, 'core')).toBeUndefined();
    expect(() => creationPrompt(draft, 'outline', '继续')).toThrow('核心设定');
    complete(state, draft, 'core');
    const unchanged = draft.selections.core, context = creationContextKey(draft, 'core');
    setCreationDirection(draft, draft.genre!, draft.idea); expect(draft.selections.core).toBe(unchanged);
    setCreationDirection(draft, draft.genre!, '失踪案变成喜剧探险');
    expect(creationContextKey(draft, 'core')).not.toBe(context); expect(draft.selections.core).toBe('');
  });
  it('persists candidates, chat and selected choices while pausing interrupted generation', () => {
    const state = workspace(), draft = newCreationDraft('科幻悬疑', '记忆修复师'); complete(state, draft, 'core');
    const job = createCreationRound(state, draft, '强化调查线'); job.status = 'running'; job.steps[0].status = 'running'; job.steps[0].output = '{"options":['; state.jobs.push(job);
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.creationDraft).toEqual(draft);
    expect(restored.jobs[restored.jobs.length - 1]).toMatchObject({ status: 'paused', steps: [{ status: 'pending', output: '{"options":[' }] });
    expect(selectedCreationOption(restored.creationDraft!, 'core')?.title).toBe('记忆修复师1');
    expect(restored.creationDraft?.genre).toBe('科幻悬疑');
    expect(parseWorkspace(JSON.stringify(emptyWorkspace())).creationDraft).toBeUndefined();
  });
  it('restores legacy drafts without losing their choices and continues them with the confirmed genre', () => {
    const state = workspace(), draft = newCreationDraft('科幻悬疑', '记忆修复师');
    delete draft.genre; complete(state, draft, 'genre'); complete(state, draft, 'core'); complete(state, draft, 'outline');
    const restored = parseWorkspace(JSON.stringify(state)).creationDraft!;
    expect(restored).toEqual(draft); expect(creationGenre(restored)).toBe('科幻悬疑1');
    expect(projectFromCreation(restored).genre).toBe('科幻悬疑1');
    expect(creationPrompt(restored, 'outline', '继续').user).toContain('不使用穿越，强化悬疑');
    restored.stage = 'genre'; setCreationDirection(restored, '修仙喜剧', restored.idea);
    expect(restored.stage).toBe('core'); expect(restored.rounds).toEqual(draft.rounds);
    expect(restored.selections.core).toBe(''); expect(restored.genre).toBe('修仙喜剧');
    expect(() => createCreationRound(state, restored, '生成核心设定')).not.toThrow();
  });
  it('rejects incomplete or malformed options, missing characters or volumes and invalid word targets', () => {
    expect(parseCreationOptions('```json\n' + JSON.stringify(genres()) + '\n```', 'genre')).toHaveLength(6);
    expect(() => parseCreationOptions(JSON.stringify({ options: genres().options.slice(0, 5) }), 'genre')).toThrow('方案不完整');
    const duplicate = genres(); duplicate.options[1].title = duplicate.options[0].title;
    expect(() => parseCreationOptions(JSON.stringify(duplicate), 'genre')).toThrow('方案不完整');
    expect(() => parseCreationOptions(JSON.stringify({ options: cores().options.slice(0, 2) }), 'core')).toThrow('方案不完整');
    const duplicateCore = cores(); duplicateCore.options[1].title = duplicateCore.options[0].title;
    expect(() => parseCreationOptions(JSON.stringify(duplicateCore), 'core')).toThrow('方案不完整');
    const core = cores(); core.options[0].targetWords = 0;
    expect(() => parseCreationOptions(JSON.stringify(core), 'core')).toThrow('方案不完整');
    const outline = outlines(); outline.options[0].characters = [];
    expect(() => parseCreationOptions(JSON.stringify(outline), 'outline')).toThrow('方案不完整');
    const noVolumes = outlines(); noVolumes.options[0].volumes = [];
    expect(() => parseCreationOptions(JSON.stringify(noVolumes), 'outline')).toThrow('方案不完整');
    expect(() => parseCreationOptions('{', 'genre')).toThrow('方案不完整');
  });
  it('does not add a round or silently truncate requirements when AI settings or context are invalid', () => {
    const state = workspace(), draft = newCreationDraft('科幻悬疑', '记忆修复师');
    state.aiSelection.model = '';
    expect(() => createCreationRound(state, draft, '生成核心设定')).toThrow('模型'); expect(draft.rounds).toHaveLength(0);
    state.aiSelection.model = 'model'; state.providers[0].advanced.contextChars = 4000;
    draft.idea = '想法'.repeat(2500);
    expect(() => createCreationRound(state, draft, '生成核心设定')).toThrow('上下文'); expect(draft.rounds).toHaveLength(0);
    expect(() => newCreationDraft('', '想法')).toThrow('题材');
    expect(() => newCreationDraft('文'.repeat(201), '想法')).toThrow('题材');
    expect(() => newCreationDraft('科幻', ' ')).toThrow('小说想法');
    expect(() => newCreationDraft('科幻', '文'.repeat(8001))).toThrow('小说想法');
  });
});
