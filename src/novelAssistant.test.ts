import { describe, expect, it } from 'vitest';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject, parseWorkspace, type Note } from './domain';
import { acceptNovel, applyNovelResult, hasNovelChanges, novelSnapshot, parseNovelResult, undoNovel } from './novelAssistant';
import { buildPrompt } from './prompts';

const ai = { ...newAISelection(), ...defaultAdvanced() };
const note = (id: string, kind: Note['kind'], title: string): Note => ({ id, kind, title, body: '旧内容', chapterId: '', status: 'planned' });
function setup() {
  const state = emptyWorkspace(), project = newProject('城池', 'long');
  project.genre = '修仙'; project.outline = '旧总纲';
  project.notes = [note('hero', 'character', '沈游'), note('singer', 'character', '苏云裳'), { ...note('relation', 'relation', '合作'), relation: { sourceId: 'hero', targetId: 'singer' } }, note('world', 'world', '系统'), note('volume', 'volume', '旧卷纲'), note('fact', 'fact', '正文事实')];
  project.chapters[0].content = '原正文'; project.chapters[0].summary = '原摘要';
  state.projects.push(project);
  const job = createJob(project, 'revise', ai, [], '按新总纲更新所有内容');
  job.novelChat = { previousJobIds: [], base: novelSnapshot(project) }; state.jobs.push(job);
  return { state, project, job };
}
const proposal = () => ({ reply: '统一调整', project: { synopsis: '文化产业与城市发展', outline: '新总纲' }, notes: [{ id: 'hero', kind: 'character', title: '陆昭', body: '开局最高修为' }, { id: 'world', kind: 'world', title: '文化入侵系统', body: '只提供技术，不提供作品' }, { kind: 'volume', title: '第一卷 手机入城', body: '十灵石手机与抖音' }, { kind: 'character', title: '新作者', body: '本土文人' }, { kind: 'relation', title: '文学合作', body: '共同创办文学平台', source: '陆昭', target: '新作者' }], removeNoteIds: ['volume'] });
describe('小说 AI 联动更新', () => {
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
    const next = createJob(project, 'revise', ai, [], '继续调整'); next.novelChat = { base: novelSnapshot(project), previousJobIds: [job.id] };
    const prompt = buildPrompt(state, next, next.steps[0], ai);
    expect(prompt.system).toContain('removeNoteIds'); expect(prompt.system).toContain('source');
    expect(prompt.user).toContain('沈游'); expect(prompt.user).toContain('旧卷纲'); expect(prompt.user).toContain('先讨论主线');
    expect(hasNovelChanges(parseNovelResult(job.steps[0].output))).toBe(false);
    expect(parseWorkspace(JSON.stringify(state)).skills.some(skill => skill.id === 'builtin-revise')).toBe(true);
    project.outline = '完整总纲'.repeat(10000);
    expect(() => buildPrompt(state, next, next.steps[0], { ...ai, contextChars: 4000 })).toThrow('上下文');
  });
});
