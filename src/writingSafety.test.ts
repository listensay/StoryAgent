import { describe, expect, it } from 'vitest';
import { createJob, emptyWorkspace, newChapter, newProject, parseWorkspace, type TaskKind } from './domain';
import { adoptPassages, mergedManuscript, passageChanges, previousChoices } from './paragraphAdoption';
import { applyReplacement, findMatches, manuscriptFields, preparePreview } from './manuscriptIndex';
import { removeChapter } from './chapterOperations';
import { restoreDeleted, trashProject } from './recycle';
import { readReview, reviewRange } from './reviewData';

function setup(content = '旧段落甲\n\n保留段落\n\n旧段落乙', kind: TaskKind = 'draft') {
  const state = emptyWorkspace(), project = newProject('测试小说', 'long');
  state.projects.push(project); state.activeProjectId = project.id;
  const chapter = project.chapters[0]; chapter.content = content;
  const job = createJob(project, kind, null, chapter.id, '');
  job.status = 'ready'; job.steps[0].status = 'ready'; state.jobs.push(job);
  return { state, project, chapter, job, step: job.steps[0] };
}

describe('paragraph adoption', () => {
  it('adopts edited passages incrementally after reload and preserves recoverable manuscripts', () => {
    const { state, chapter, job, step } = setup();
    step.output = '新段落甲\n\n保留段落\n\n新段落乙';
    const original = chapter.content;
    adoptPassages(state, structuredClone(job), structuredClone(step), new Map([[0, '作者修订甲']]), false);
    expect(chapter.content).toBe('作者修订甲\n\n保留段落\n\n旧段落乙');
    expect(chapter.versions[0].content).toBe(original);
    const restored = parseWorkspace(JSON.stringify(state)), next = restored.jobs[0], part = next.steps[0];
    adoptPassages(restored, structuredClone(next), structuredClone(part), new Map([[2, undefined]]), false);
    expect(restored.projects[0].chapters[0].content).toBe('作者修订甲\n\n保留段落\n\n新段落乙');
    expect(previousChoices(part).get(0)).toBe('作者修订甲');
    expect(restored.projects[0].chapters[0].summary).toBe('');
  });
  it('rejects stale previews without changing the author manuscript', () => {
    const { state, chapter, job, step } = setup(); step.output = '生成新段落';
    const preview = structuredClone(step); chapter.content += '\n作者追加';
    const before = JSON.stringify(state);
    expect(() => adoptPassages(state, job, preview, new Map([[0, undefined]]), false)).toThrow('正文已更新');
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each(['draft', 'rewrite'] as const)('round-trips CRLF and indentation for %s', kind => {
    const { job, step } = setup('  第一段\r\n\r\n　第二段\r\n', kind);
    step.output = '  新第一段\r\n\r\n　第二段\r\n';
    const rows = passageChanges(job, step);
    expect(mergedManuscript(job, step, rows, new Map())).toBe(step.baseContent);
    expect(mergedManuscript(job, step, rows, new Map(rows.flatMap((r, i) => r.changed ? [[i, undefined] as const] : [])))).toBe(step.output);
  });
  it('keeps selected rewrite boundaries and can recover an initially empty manuscript', () => {
    const { state, chapter, job, step } = setup('前缀旧段落后缀', 'rewrite');
    Object.assign(step, { selection: '旧段落', selectionStart: 2, selectionEnd: 5, output: '新段落' });
    adoptPassages(state, job, step, new Map([[0, undefined]]), false);
    expect(chapter.content).toBe('前缀新段落后缀');
    const blank = setup(''); blank.step.output = '开篇';
    adoptPassages(blank.state, blank.job, blank.step, new Map([[0, undefined]]), false);
    expect(blank.chapter.versions[0].content).toBe('');
  });
  it('appends only selected continuation passages', () => {
    const { state, chapter, job, step } = setup('已有正文', 'continue'); step.output = '续写甲\n\n续写乙';
    adoptPassages(state, job, step, new Map([[1, undefined]]), false);
    expect(chapter.content).toBe('已有正文\n\n续写乙');
  });
});

describe('search replacement', () => {
  const preview = (p: ReturnType<typeof setup>['project'], query = '旧', replacement = '新') => preparePreview(p.id, 'all', findMatches(manuscriptFields(p, 'all'), query), query, replacement);
  it('saves the exact pre-replacement version and preserves unrelated edits', () => {
    const { state, project, chapter } = setup(); const p = preview(project), original = chapter.content;
    project.synopsis = '预览后补充的简介';
    applyReplacement(state, p, new Set(), []);
    expect(chapter.content).toBe(original.replace(/旧/g, '新'));
    expect(chapter.versions[0].content).toBe(original);
    expect(project.synopsis).toBe('预览后补充的简介');
  });
  it.each(['stale', 'new-match', 'running', 'polishing', 'other-project'])('rejects %s before any changes', reason => {
    const { state, project, chapter, job } = setup(); const p = preview(project);
    if (reason === 'stale') chapter.content += '作者追加';
    if (reason === 'new-match') project.outline = '旧线索';
    if (reason === 'running') job.status = 'running';
    if (reason === 'other-project') state.activeProjectId = 'elsewhere';
    const before = JSON.stringify(state);
    expect(() => applyReplacement(state, p, new Set(), reason === 'polishing' ? [chapter.id] : [])).toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });
  it('renames a mirrored character once while preserving profile formatting', () => {
    const { state, project } = setup('');
    const body = '## 1. 基础身份\r\n- 姓名：小明\r\n- 身份：木匠\r\n\r\n## 补充设定\r\n保留  空格';
    project.notes.push({ id: 'person', kind: 'character', title: '小明', body, chapterId: '', status: 'confirmed' });
    const p = preview(project, '小明', '小林');
    expect(p.changes).toHaveLength(1);
    applyReplacement(state, p, new Set(), []);
    expect(project.notes[0].title).toBe('小林');
    expect(project.notes[0].body).toBe(body.replace('小明', '小林'));
  });
});

describe('recycle bin persistence', () => {
  it('restores chapters, versions, tasks and note links after a workspace reload', () => {
    const { state, project, chapter, job } = setup();
    project.chapters.push(newChapter('第二章'));
    project.notes.push({ id: 'fact', kind: 'fact', title: '事实', body: '依据', status: 'confirmed', chapterId: chapter.id });
    removeChapter(state, project.id, chapter.id);
    expect(project.chapters).toHaveLength(1); expect(state.jobs).toHaveLength(0);
    const loaded = parseWorkspace(JSON.stringify(state));
    restoreDeleted(loaded, project.id, chapter.id);
    expect(loaded.projects[0].chapters[0]).toEqual(chapter);
    expect(loaded.projects[0].notes[0].chapterId).toBe(chapter.id);
    expect(loaded.jobs[0].id).toBe(job.id);
    trashProject(loaded, project.id, []);
    const again = parseWorkspace(JSON.stringify(loaded)); restoreDeleted(again, project.id);
    expect(again.projects[0].chapters).toHaveLength(2); expect(again.jobs[0].id).toBe(job.id);
  });
  it('refuses deletion while a chapter is generating', () => {
    const { state, project, chapter, job } = setup(); job.status = 'running';
    expect(() => removeChapter(state, project.id, chapter.id)).toThrow('正在生成');
    expect(() => trashProject(state, project.id, [])).toThrow('停止');
    expect(project.chapters[0]).toBe(chapter);
  });
});

describe('review evidence', () => {
  const output = (paragraph?: number) => JSON.stringify({ issues: [{ category: 'fact', quote: '重复原句', paragraph, reason: '与前章不符', suggestion: '核对时间' }] });
  it('uses paragraph evidence to distinguish repeated quotes and relocates edited text', () => {
    const base = '开头重复原句\n\n结尾重复原句';
    const [issue] = readReview(output(2), base);
    expect(issue.start).toBe(base.lastIndexOf('重复原句'));
    const current = '开头重复原句\n\n结尾修订原句';
    const range = reviewRange(base, current, issue)!;
    expect(current.slice(range.start, range.end)).toBe('修订原句');
    expect(readReview(output(), base)[0].start).toBe(-1);
  });
  it('refuses malformed reviews and does not navigate unverified quotes', () => {
    expect(() => readReview('普通文本', '正文')).toThrow('格式');
    const [issue] = readReview(output(1), '正文');
    expect(reviewRange('正文', '正文', issue)).toBeUndefined();
  });
});
