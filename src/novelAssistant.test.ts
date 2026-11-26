import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newChapter, newProject, parseWorkspace, type Note } from './domain';
import { acceptNovel, applyNovelResult, hasNovelChanges, novelSnapshot, parseNovelResult, recoverNovelJobs, undoNovel } from './novelAssistant';
import { buildPrompt } from './prompts';

const ai = { ...newAISelection(), ...defaultAdvanced() };
const note = (id: string, kind: Note['kind'], title: string): Note => ({ id, kind, title, body: '旧内容', chapterId: '', status: 'planned' });
function setup() {
  const state = emptyWorkspace(), project = newProject('城池', 'long');
  project.genre = '修仙'; project.outline = '旧总纲';
  project.notes = [note('hero', 'character', '沈游'), note('singer', 'character', '苏云裳'), { ...note('relation', 'relation', '合作'), relation: { sourceId: 'hero', targetId: 'singer' } }, note('world', 'world', '系统'), note('volume', 'volume', '旧卷纲'), note('fact', 'fact', '正文事实')];
  project.chapters[0].content = '原正文'; project.chapters[0].summary = '原摘要';
  state.projects.push(project);
  const job = createJob(project, 'revise', ai, undefined, '按新总纲更新所有内容');
  job.novelChat = { previousJobIds: [], base: novelSnapshot(project) }; state.jobs.push(job);
  return { state, project, job };
}
const proposal = () => ({ reply: '统一调整', project: { synopsis: '文化产业与城市发展', outline: '新总纲' }, notes: [{ id: 'hero', kind: 'character', title: '陆昭', body: '开局最高修为' }, { id: 'world', kind: 'world', title: '文化入侵系统', body: '只提供技术，不提供作品' }, { kind: 'volume', title: '第一卷 手机入城', body: '十灵石手机与抖音' }, { kind: 'character', title: '新作者', body: '本土文人' }, { kind: 'relation', title: '文学合作', body: '共同创办文学平台', source: '陆昭', target: '新作者' }], removeNoteIds: ['volume'] });
describe('小说 AI 联动更新', () => {
  it('移除全部未写作章节，包括已经清空计划正文的章节，不生成占位章节', () => {
    const { state, project, job } = setup();
    project.chapters = Array.from({ length: 21 }, (_, index) => newChapter(`第${index + 1}章`));
    const ids = project.chapters.map(chapter => chapter.id);
    job.novelChat!.base = novelSnapshot(project);
    job.steps[0].output = JSON.stringify({ reply: '移除全部章节规划', removeChapterIds: ids });
    const result = parseNovelResult(job.steps[0].output);
    expect(hasNovelChanges(result)).toBe(true);
    expect(applyNovelResult(project, result).chapters).toEqual([]);
    expect(project.chapters).toHaveLength(21);
    acceptNovel(state, job); job.status = 'accepted';
    expect(project.chapters).toEqual([]);
    expect(parseWorkspace(JSON.stringify(state)).projects[0].chapters).toEqual([]);
  });
  it('采用、持久化及撤销章节移除，恢复完整章节、标题、顺序和设定关联', () => {
    const { state, project, job } = setup();
    const first = { ...newChapter('第一章旧计划'), plan: '第一章的计划', styleId: 'chapter-style' };
    const last = newChapter('末章空计划');
    project.chapters.unshift(first); project.chapters.push(last);
    project.notes.find(note => note.id === 'volume')!.chapterId = first.id;
    const original = structuredClone(project);
    job.novelChat!.base = novelSnapshot(project);
    job.steps[0].output = JSON.stringify({ reply: '替换旧章节规划', removeChapterIds: [first.id, last.id], chapters: [{ title: '新章节计划', plan: '新事件' }] });
    acceptNovel(state, job); job.status = 'accepted';
    expect(project.chapters.map(chapter => chapter.title)).toEqual([original.chapters[1].title, '新章节计划']);
    expect(project.chapters[0]).toEqual(original.chapters[1]);
    expect(project.notes.find(note => note.id === 'volume')?.chapterId).toBe('');
    const restored = parseWorkspace(JSON.stringify(state));
    undoNovel(restored, restored.jobs[0]);
    expect(restored.projects[0].chapters.map(({ updatedAt: _, ...chapter }) => chapter)).toEqual(original.chapters.map(({ updatedAt: _, ...chapter }) => chapter));
    expect(restored.projects[0].notes).toEqual(original.notes);
    expect(novelSnapshot(restored.projects[0])).toBe(novelSnapshot(original));
    expect(restored.projects[0]).not.toHaveProperty('removedChapters');
  });
  it.each(['content', 'summary', 'versions', 'memoryHash', 'fact', 'state', 'timeline', 'foreshadow', 'knowledge', 'reference'] as const)('保护章节已有的正文、历史和关联记录：%s', kind => {
    const { project } = setup();
    const chapter = newChapter('受保护章节');
    project.chapters.push(chapter);
    if (kind === 'content' || kind === 'summary') chapter[kind] = '已写作内容';
    else if (kind === 'versions') chapter.versions.push({ id: 'version', content: '历史正文', createdAt: project.createdAt, label: '编辑前' });
    else if (kind === 'memoryHash') chapter.memoryHash = '记忆指纹';
    else project.notes.push({ ...note(`linked-${kind}`, kind, '关联记录'), chapterId: chapter.id });
    const original = structuredClone(project);
    const result = parseNovelResult(JSON.stringify({ reply: '移除章节', project: { outline: '不得写入' }, removeChapterIds: [chapter.id] }));
    expect(() => applyNovelResult(project, result)).toThrow('请仅清空计划');
    expect(project).toEqual(original);
  });
  it.each(['missing', 'duplicate', 'update-and-remove'])('拒绝无效或重复章节移除，保持调整原子性：%s', conflict => {
    const { project } = setup();
    const chapter = newChapter('未写作章节'); project.chapters.push(chapter);
    const original = structuredClone(project);
    const removeChapterIds = conflict === 'missing' ? ['missing'] : conflict === 'duplicate' ? [chapter.id, chapter.id] : [chapter.id];
    const chapters = conflict === 'update-and-remove' ? [{ id: chapter.id, plan: '新计划' }] : [];
    expect(() => applyNovelResult(project, parseNovelResult(JSON.stringify({ reply: '调整', project: { outline: '不得写入' }, removeChapterIds, chapters })))).toThrow();
    expect(project).toEqual(original);
  });
  it('采用前新增正文或历史版本时拒绝移除，保留当前数据', () => {
    const { state, project, job } = setup();
    const chapter = newChapter('待移除章节'); project.chapters.push(chapter);
    job.novelChat!.base = novelSnapshot(project);
    job.steps[0].output = JSON.stringify({ reply: '移除旧章节', removeChapterIds: [chapter.id] });
    chapter.content = '采用前新正文';
    expect(() => acceptNovel(state, job)).toThrow('已更新');
    chapter.content = '';
    chapter.versions.push({ id: 'version', content: '后来保存的正文', createdAt: project.createdAt, label: '手动保存' });
    const original = structuredClone(state);
    expect(() => acceptNovel(state, job)).toThrow('请仅清空计划');
    expect(state).toEqual(original);
  });
  it.each(['draft', 'continue', 'rewrite', 'plan', 'review', 'memory'] as const)('执行 %s 的章节不能通过采用或撤销被移除', kind => {
    const { state, project, job } = setup();
    const chapter = newChapter('生成中的章节'); project.chapters.push(chapter);
    job.novelChat!.base = novelSnapshot(project);
    job.steps[0].output = JSON.stringify({ reply: '移除旧章节', removeChapterIds: [chapter.id] });
    const writing = createJob(project, kind, ai, chapter.id, '章节任务'); state.jobs.push(writing);
    expect(() => acceptNovel(state, job)).toThrow('正在生成');
    expect(project.chapters).toContain(chapter);
    writing.status = 'paused';
    job.steps[0].output = JSON.stringify({ reply: '新增章节', chapters: [{ title: '新增计划', plan: '计划' }] });
    acceptNovel(state, job); job.status = 'accepted';
    const added = project.chapters[project.chapters.length - 1];
    state.jobs.push(createJob(project, kind, ai, added.id, '新章节任务'));
    const original = structuredClone(state);
    expect(() => undoNovel(state, job)).toThrow('正在生成');
    expect(state).toEqual(original);
  });
  it('撤销不移除后来新增历史版本的章节', () => {
    const { state, project, job } = setup();
    job.steps[0].output = JSON.stringify({ reply: '新增章节', chapters: [{ title: '新计划章节', plan: '计划' }] });
    acceptNovel(state, job); job.status = 'accepted';
    project.chapters[1].versions.push({ id: 'version', content: '后来保存的正文', createdAt: project.createdAt, label: '手动保存' });
    const original = structuredClone(state);
    expect(() => undoNovel(state, job)).toThrow('无法撤销');
    expect(state).toEqual(original);
  });
  it('旧版本的采用记录仍能撤销并保留正文', () => {
    const { state, job } = setup();
    job.steps[0].output = JSON.stringify(proposal());
    acceptNovel(state, job); job.status = 'accepted';
    const saved = JSON.parse(job.novelChat!.before!); delete saved.removedChapters;
    job.novelChat!.before = JSON.stringify(saved);
    const restored = parseWorkspace(JSON.stringify(state));
    undoNovel(restored, restored.jobs[0]);
    expect(restored.projects[0]).toMatchObject({ outline: '旧总纲', chapters: [{ content: '原正文', summary: '原摘要' }] });
  });
  it('清空已有章节计划，采用和撤销均保留章节、正文、摘要与版本', () => {
    const { state, project, job } = setup();
    project.chapters[0].plan = '原章节计划';
    project.chapters[0].versions = [{ id: 'version', content: '历史正文', createdAt: project.createdAt, label: '编辑前' }];
    project.chapters.push({ ...newChapter('第二章'), plan: '第二章计划' });
    const original = structuredClone(project.chapters);
    job.novelChat!.base = novelSnapshot(project);
    job.steps[0].output = '```json\n' + JSON.stringify({ reply: '清空章节计划', chapters: original.map(({ id }) => ({ id, plan: '' })) }) + '\n```';
    const result = parseNovelResult(job.steps[0].output);
    expect(hasNovelChanges(result)).toBe(true);
    expect(result.chapters[0].plan).toBe('');
    acceptNovel(state, job); job.status = 'accepted';
    expect(project.chapters.map(({ updatedAt: _, ...chapter }) => chapter)).toEqual(original.map(({ updatedAt: _, ...chapter }) => ({ ...chapter, plan: '' })));
    const restored = parseWorkspace(JSON.stringify(state));
    undoNovel(restored, restored.jobs[0]);
    expect(restored.projects[0].chapters.map(({ updatedAt: _, ...chapter }) => chapter)).toEqual(original.map(({ updatedAt: _, ...chapter }) => chapter));
  });
  it.each([undefined, null, 0, false, {}, []])('章节计划仍须为字符串：%j', plan => {
    expect(() => parseNovelResult(JSON.stringify({ reply: '调整', chapters: [{ id: 'chapter', plan }] }))).toThrow('调整格式无效');
  });
  it('恢复被旧校验误判的完整回复，等待采用且不改动小说', () => {
    const { state, project, job } = setup();
    project.chapters[0].plan = '原章节计划';
    job.novelChat!.base = novelSnapshot(project);
    job.status = 'failed'; job.error = 'AI 返回的调整格式无效，请重新生成';
    job.steps[0].output = JSON.stringify({ reply: '清空章节计划', chapters: [{ id: project.chapters[0].id, plan: '' }] });
    const original = structuredClone(project), output = job.steps[0].output;
    recoverNovelJobs(state);
    expect(job).toMatchObject({ status: 'ready', error: '', steps: [{ status: 'ready', output }] });
    expect(project).toEqual(original);
    acceptNovel(state, job);
    expect(project.chapters[0]).toMatchObject({ id: original.chapters[0].id, plan: '', content: '原正文', summary: '原摘要' });
  });
  it.each(['stale', 'incomplete', 'conflict', 'network', 'paused'])('不恢复过期、不完整、冲突或其他失败的回复：%s', failure => {
    const { state, project, job } = setup();
    job.status = 'failed'; job.error = 'AI 返回的调整格式无效，请重新生成';
    job.steps[0].output = JSON.stringify({ reply: '清空章节计划', chapters: [{ id: project.chapters[0].id, plan: '' }] });
    if (failure === 'stale') project.outline = '已更新总纲';
    if (failure === 'incomplete') job.steps[0].output = '{"reply":"清空章节计划","chapters":[';
    if (failure === 'conflict') job.steps[0].output = '{"reply":"清空章节计划","chapters":[{"id":"missing","plan":""}]}';
    if (failure === 'network') job.error = '生成连接中断，可继续生成';
    if (failure === 'paused') job.status = 'paused';
    const original = structuredClone(state);
    recoverNovelJobs(state);
    expect(state).toEqual(original);
  });
  it('一次更新多个页面，沿用人物 ID、保留正文记忆，并连接新增人物', () => {
    const { project } = setup();
    const result = parseNovelResult(JSON.stringify({ ...proposal(), chapters: [{ id: project.chapters[0].id, title: '第一章 城主上任', plan: '接手衰败城池' }, { title: '第二章 十灵石', plan: '推广手机' }] }));
    const next = applyNovelResult(project, result);
    expect(next.outline).toBe('新总纲'); expect(next.synopsis).toContain('文化产业');
    expect(next.notes.find(note => note.id === 'hero')).toMatchObject({ title: '陆昭' });
    expect(next.notes.find(note => note.id === 'relation')?.relation).toEqual({ sourceId: 'hero', targetId: 'singer' });
    expect(next.notes.find(note => note.title === '文学合作')?.relation).toEqual({ sourceId: 'hero', targetId: next.notes.find(note => note.title === '新作者')!.id });
    expect(next.notes.find(note => note.id === 'volume')).toBeUndefined();
    expect(next.notes.find(note => note.id === 'fact')).toEqual(project.notes.find(note => note.id === 'fact'));
    expect(next.chapters[0]).toMatchObject({ content: '原正文', summary: '原摘要', plan: '接手衰败城池' });
    expect(next.chapters[1]).toMatchObject({ title: '第二章 十灵石', content: '', summary: '', plan: '推广手机' });
    expect(project.outline).toBe('旧总纲');
  });
  it.each([
    { notes: [{ id: 'missing', kind: 'world', title: '系统', body: '新设定' }] },
    { notes: [{ id: 'hero', kind: 'world', title: '系统', body: '新设定' }] },
    { removeNoteIds: ['fact'] },
    { removeNoteIds: ['hero'] },
    { chapters: [{ id: 'missing', plan: '新计划' }] },
    { notes: [{ kind: 'relation', title: '错误关系', body: '关系', source: '陆昭', target: '不存在' }] },
    { notes: [{ kind: 'character', title: '沈游', body: '重复人物' }] },
    { notes: [{ id: 'hero', kind: 'character', title: '苏云裳', body: '重复改名' }] },
  ])('无效引用或冲突不会留下部分修改：%j', patch => {
    const { project } = setup(), before = JSON.stringify(project);
    expect(() => applyNovelResult(project, parseNovelResult(JSON.stringify({ reply: '调整', project: { outline: '不应写入' }, ...patch })))).toThrow();
    expect(JSON.stringify(project)).toBe(before);
  });
  it('拒绝重复操作、正文写入和伪造记忆', () => {
    const { project } = setup();
    expect(() => applyNovelResult(project, parseNovelResult(JSON.stringify({ reply: '调整', removeNoteIds: ['volume', 'volume'] })))).toThrow('重复');
    expect(() => parseNovelResult('{"reply":"修改","chapters":[{"id":"x","plan":"计划","content":"正文"}]}')).toThrow();
    expect(() => parseNovelResult('{"reply":"修改","notes":[{"kind":"fact","title":"伪造","body":"伪造"}]}')).toThrow();
  });
  it('采用、持久化和撤销整套调整，并保留关系图位置', () => {
    const { state, project, job } = setup(); const before = novelSnapshot(project);
    job.steps[0].output = JSON.stringify(proposal()); acceptNovel(state, job); job.status = 'accepted';
    const restored = parseWorkspace(JSON.stringify(state)), saved = restored.projects[0];
    saved.notes.find(note => note.id === 'hero')!.graphPosition = { x: 150, y: 50 };
    undoNovel(restored, restored.jobs[0]);
    expect(novelSnapshot(saved)).toBe(before);
    expect(saved.notes.find(note => note.id === 'hero')?.graphPosition).toEqual({ x: 150, y: 50 });
    expect(saved.chapters[0].content).toBe('原正文');
    expect(() => undoNovel(restored, restored.jobs[0])).toThrow('暂无');
  });
  it('手写更改或正文变化后不能采用旧方案，也不能撤销覆盖后续编辑', () => {
    const { state, project, job } = setup(); job.steps[0].output = JSON.stringify(proposal());
    project.chapters[0].content = '新正文'; expect(() => acceptNovel(state, job)).toThrow('已更新');
    job.novelChat!.base = novelSnapshot(project); acceptNovel(state, job); job.status = 'accepted';
    project.theme = '手写主题'; expect(() => undoNovel(state, job)).toThrow('已更新');
    expect(project.theme).toBe('手写主题');
  });
  it('完整加载内置操作 Skill、角色、卷纲和未采用方案，讨论不产生修改', () => {
    const { state, project, job } = setup(); job.steps[0].output = '{"reply":"先讨论主线"}'; job.status = 'accepted';
    state.skills = []; // Required interface instructions do not depend on skill toggles.
    const next = createJob(project, 'revise', ai, undefined, '继续调整'); next.novelChat = { base: novelSnapshot(project), previousJobIds: [job.id] };
    const prompt = buildPrompt(state, next, next.steps[0], ai);
    expect(prompt.system).toContain('removeNoteIds'); expect(prompt.system).toContain('removeChapterIds'); expect(prompt.system).toContain('source');
    project.chapters.push(newChapter('可移除章节'));
    const currentPrompt = buildPrompt(state, next, next.steps[0], ai);
    expect(currentPrompt.user).toContain(`"removableChapterIds":["${project.chapters[1].id}"]`);
    expect(prompt.user).toContain('沈游'); expect(prompt.user).toContain('旧卷纲'); expect(prompt.user).toContain('先讨论主线');
    expect(hasNovelChanges(parseNovelResult(job.steps[0].output))).toBe(false);
    expect(parseWorkspace(JSON.stringify(state)).skills.some(skill => skill.id === 'builtin-revise')).toBe(true);
    project.outline = '完整总纲'.repeat(10000);
    expect(() => buildPrompt(state, next, next.steps[0], { ...ai, contextChars: 4000 })).toThrow('上下文');
  });
});
