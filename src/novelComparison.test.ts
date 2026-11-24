import { describe, expect, it } from 'vitest';
import { createJob, emptyWorkspace, newChapter, newProject, parseWorkspace } from './domain';
import { acceptNovel, novelBefore, novelSnapshot, parseNovelResult, undoNovel } from './novelAssistant';
import { novelChanges } from './novelComparison';
import { textDiff } from './textDiff';

function setup() {
  const state = emptyWorkspace(), project = newProject('原书名', 'long');
  project.outline = '保留的开篇\n旧转折\n保留的结尾';
  project.chapters[0].plan = '原章节计划';
  project.chapters.push(newChapter('待移除章节'));
  project.notes.push({ id: 'hero', kind: 'character', title: '林舟', body: '原人物设定', chapterId: '', status: 'planned' }, { id: 'world', kind: 'world', title: '旧世界', body: '原世界规则', chapterId: '', status: 'planned' });
  state.projects.push(project);
  const job = createJob(project, 'revise', null, [], '调整小说');
  job.novelChat = { base: novelSnapshot(project), before: novelBefore(project), previousJobIds: [] };
  job.steps[0].output = JSON.stringify({ reply: '完成调整', project: { title: '新书名', outline: '保留的开篇\n新转折\n保留的结尾' }, notes: [{ id: 'hero', kind: 'character', title: '陆昭', body: '新人物设定' }, { kind: 'world', title: '新世界', body: '新世界规则' }], chapters: [{ id: project.chapters[0].id, plan: '' }], removeNoteIds: ['world'], removeChapterIds: [project.chapters[1].id] });
  state.jobs.push(job);
  return { state, project, job, result: parseNovelResult(job.steps[0].output) };
}

describe('小说更新对比', () => {
  it('对比修改、新增、移除与清空计划，并保留生成时的原内容', () => {
    const { project, job, result } = setup();
    project.outline = '生成后手动编辑';
    const changes = novelChanges(job, project, result);
    expect(changes.find(change => change.id === 'outline')).toMatchObject({ left: '保留的开篇\n旧转折\n保留的结尾', right: '保留的开篇\n新转折\n保留的结尾', available: true });
    expect(changes.find(change => change.id === 'note-0')).toMatchObject({ left: '林舟\n\n原人物设定', right: '陆昭\n\n新人物设定' });
    expect(changes.find(change => change.id === 'note-1')).toMatchObject({ left: '', right: '新世界\n\n新世界规则' });
    expect(changes.find(change => change.id === 'chapter-0')).toMatchObject({ title: '清空章节计划 · 第一章', left: '第一章\n\n原章节计划', right: '第一章' });
    expect(changes.find(change => change.id === 'remove-world')).toMatchObject({ left: '旧世界\n\n原世界规则', right: '' });
    expect(changes.find(change => change.id.startsWith('remove-chapter-'))).toMatchObject({ left: '待移除章节', right: '' });
  });
  it('采用、保存、后续编辑与撤销后仍显示同一份历史对比', () => {
    const { state, project, job, result } = setup();
    const original = novelChanges(job, project, result);
    acceptNovel(state, job); job.status = 'accepted'; job.steps[0].status = 'accepted';
    const restored = parseWorkspace(JSON.stringify(state));
    restored.projects[0].title = '后续新书名';
    expect(novelChanges(restored.jobs[0], restored.projects[0], result)).toEqual(original);
    undoNovel(state, job);
    expect(novelChanges(job, project, result)).toEqual(original);
  });
  it('旧待采用记录可与当前原内容对比，过期且无快照时不冒用当前内容', () => {
    const { project, job, result } = setup();
    delete job.novelChat!.before;
    expect(novelChanges(job, project, result)[0]).toMatchObject({ left: '原书名', available: true });
    project.title = '后来编辑';
    expect(novelChanges(job, project, result)[0]).toMatchObject({ left: '', available: false });
  });
});

describe('文本差异', () => {
  it('保留相同段落，仅标记删除和新增的行', () => {
    const [left, right] = textDiff('开篇\n旧转折\n相同段落\n结尾', '开篇\n新转折\n相同段落\n补充\n结尾');
    expect(left.filter(line => line.changed).map(line => line.text)).toEqual(['旧转折']);
    expect(right.filter(line => line.changed).map(line => line.text)).toEqual(['新转折', '补充']);
  });
  it.each([['', '新增\n'], ['旧内容', ''], ['相同\r\n内容', '相同\n内容'], ['重复\n重复\n结尾', '重复\n结尾']])('完整保留两侧文本：%j → %j', (left, right) => {
    const lines = textDiff(left, right);
    expect(lines[0].map(line => line.text).join('\n')).toBe(left.replace(/\r\n/g, '\n'));
    expect(lines[1].map(line => line.text).join('\n')).toBe(right.replace(/\r\n/g, '\n'));
  });
  it('长篇对比限制计算规模并完整保留内容', () => {
    const left = '保留\n' + Array.from({ length: 2000 }, (_, i) => `原段落${i}`).join('\n') + '\n结尾';
    const right = '保留\n' + Array.from({ length: 2000 }, (_, i) => `新段落${i}`).join('\n') + '\n结尾';
    const lines = textDiff(left, right);
    expect(lines[0].map(line => line.text).join('\n')).toBe(left);
    expect(lines[1].map(line => line.text).join('\n')).toBe(right);
    expect(lines[0][0].changed).toBe(false);
    expect(lines[1][lines[1].length - 1]?.changed).toBe(false);
  });
});
