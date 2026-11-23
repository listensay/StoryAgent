import { describe, expect, it } from 'vitest';
import { chapterDropIndex, moveChapter, removeChapter } from './chapterOperations';
import { createJob, emptyWorkspace, exportNovel, newChapter, newProject, parseWorkspace, type Note } from './domain';
import { novelSnapshot } from './novelAssistant';

function setup() {
  const state = emptyWorkspace(), project = newProject('排序小说', 'long');
  project.chapters = ['甲章', '乙章', '丙章', '丁章'].map((title, index) => ({ ...newChapter(title), id: String(index), content: `${title}正文`, plan: `${title}计划`, summary: `${title}摘要`, versions: [{ id: `version-${index}`, content: `${title}旧正文`, createdAt: project.createdAt, label: '编辑前' }] }));
  state.projects.push(project);
  state.jobs.push(createJob(project, 'draft', null, ['1'], '当前创作任务'));
  const note = (id: string, kind: Note['kind'], chapterId: string): Note => ({ id, kind, chapterId, title: id, body: '内容', status: 'confirmed' });
  project.notes = [note('fact', 'fact', '1'), note('scene', 'scene', '1'), note('reference', 'reference', '1'), note('other-fact', 'fact', '2')];
  return { state, project };
}

describe('章节列表操作', () => {
  it.each([
    ['1', 0, ['1', '0', '2', '3']],
    ['1', 2, ['0', '2', '1', '3']],
    ['2', 0, ['2', '0', '1', '3']],
    ['1', 3, ['0', '2', '3', '1']],
  ])('调整位置 %s → %i，保留正文、版本、关联和当前任务', (id, index, expected) => {
    const { state, project } = setup();
    const original = structuredClone(project.chapters), jobs = structuredClone(state.jobs), notes = structuredClone(project.notes), base = novelSnapshot(project);
    moveChapter(project, id, index);
    expect(project.chapters.map(chapter => chapter.id)).toEqual(expected);
    expect(project.chapters).toEqual(expected.map(id => original.find(chapter => chapter.id === id)));
    expect(state.jobs).toEqual(jobs); expect(project.notes).toEqual(notes);
    expect(novelSnapshot(project)).not.toBe(base);
    const restored = parseWorkspace(JSON.stringify(state)).projects[0];
    expect(restored.chapters).toEqual(project.chapters);
    expect(exportNovel(restored, 'txt')).toBe(['排序小说', ...expected.map(id => { const chapter = original.find(chapter => chapter.id === id)!; return `${chapter.title}\n\n${chapter.content}`; })].join('\n\n'));
  });
  it.each([
    ['0', '2', 'before', ['1', '0', '2', '3']],
    ['0', '2', 'after', ['1', '2', '0', '3']],
    ['3', '1', 'before', ['0', '3', '1', '2']],
    ['3', '1', 'after', ['0', '1', '3', '2']],
    ['0', '1', 'before', ['0', '1', '2', '3']],
    ['1', '0', 'after', ['0', '1', '2', '3']],
    ['3', '0', 'before', ['3', '0', '1', '2']],
    ['0', '3', 'after', ['1', '2', '3', '0']],
  ] as const)('拖拽 %s 到 %s %s，正确计算上下半区和首尾位置', (dragged, target, position, expected) => {
    const { project } = setup();
    const index = chapterDropIndex(project.chapters, dragged, target, position);
    expect(index).toBeDefined(); moveChapter(project, dragged, index!);
    expect(project.chapters.map(chapter => chapter.id)).toEqual(expected);
  });
  it('边界与无效拖拽不会改变章节，移除后的引用不会移动其他章节', () => {
    const { project } = setup(), original = structuredClone(project);
    moveChapter(project, '0', -1); moveChapter(project, '3', 9);
    expect(chapterDropIndex(project.chapters, '0', '0', 'after')).toBeUndefined();
    expect(chapterDropIndex(project.chapters, 'missing', '0', 'before')).toBeUndefined();
    expect(chapterDropIndex(project.chapters, '0', 'missing', 'after')).toBeUndefined();
    expect(() => moveChapter(project, 'missing', 0)).toThrow('已移除');
    expect(() => moveChapter(project, '0', Number.NaN)).toThrow('位置无效');
    expect(project).toEqual(original);
  });
  it('删除指定章节及历史版本，保留其他章节和资料，解除设定关联并移除该章记忆', () => {
    const { state, project } = setup(); state.jobs[0].status = 'accepted';
    const original = structuredClone(project);
    removeChapter(state, project.id, '1');
    expect(project.chapters).toEqual(original.chapters.filter(chapter => chapter.id !== '1'));
    expect(project.notes).toEqual([{ ...original.notes[1], chapterId: '' }, { ...original.notes[2], chapterId: '' }, original.notes[3]]);
    expect(parseWorkspace(JSON.stringify(state)).projects[0]).toEqual(project);
    expect(() => removeChapter(state, project.id, '1')).toThrow('已移除');
    expect(() => removeChapter(state, 'missing', '0')).toThrow('已移除');
    removeChapter(state, project.id, '0'); removeChapter(state, project.id, '2'); removeChapter(state, project.id, '3');
    expect(project.chapters).toEqual([]);
  });
  it.each(['queued', 'running'] as const)('拒绝删除%s章节，保护生成中的任务与数据', status => {
    const { state, project } = setup(); state.jobs[0].status = status;
    const original = structuredClone(state);
    expect(() => removeChapter(state, project.id, '1')).toThrow('正在生成');
    expect(state).toEqual(original);
    removeChapter(state, project.id, '3');
    expect(project.chapters.map(chapter => chapter.id)).toEqual(['0', '1', '2']);
  });
});
