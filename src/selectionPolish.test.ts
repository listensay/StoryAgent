import { describe, expect, it } from 'vitest';
import { newChapter } from './domain';
import { applySelectionPolish, hasTextSelection, selectionPolishPrompt } from './selectionPolish';

function setup() {
  const chapter = newChapter('夜归');
  chapter.content = '雨停了。\n她走得很快。\n门还开着。';
  return { chapter, selected: { start: 5, end: 11, content: chapter.content } };
}

describe('正文选区润色', () => {
  it('使用独立润色指令并提供选区前后文', () => {
    const { chapter, selected } = setup();
    const prompt = selectionPolishPrompt(chapter, selected, 8000);
    expect(prompt.system).toContain('润色选中的正文片段');
    expect(prompt.system).toContain('只输出润色后的片段');
    expect(prompt.user).toContain('前文：\n雨停了。');
    expect(prompt.user).toContain('待润色片段：\n她走得很快。');
    expect(prompt.user).toContain('门还开着。');
  });

  it('直接替换选区并保存原文版本', () => {
    const { chapter, selected } = setup();
    const result = applySelectionPolish(chapter, selected, '她加快了脚步。');
    expect(result.content).toBe('雨停了。\n她加快了脚步。\n门还开着。');
    expect(result.versions[0]).toMatchObject({ label: '润色前', content: chapter.content });
    expect(chapter.content).toBe(selected.content);
    expect(chapter.versions).toEqual([]);
  });

  it('不重复保存未变化的正文，拒绝空输出', () => {
    const { chapter, selected } = setup();
    expect(applySelectionPolish(chapter, selected, chapter.content.slice(selected.start, selected.end))).toBe(chapter);
    expect(() => applySelectionPolish(chapter, selected, ' \n')).toThrow('模型未返回润色正文');
  });

  it('拒绝过期选区、生成期间修改的正文以及被删除的章节', () => {
    const { chapter, selected } = setup();
    chapter.content += '新的结尾。';
    expect(() => selectionPolishPrompt(chapter, selected, 8000)).toThrow('正文已更新');
    expect(() => applySelectionPolish(chapter, selected, '润色结果')).toThrow('正文已更新');
    expect(() => applySelectionPolish(undefined, selected, '润色结果')).toThrow('章节已移除');
    expect(chapter.content).toContain('新的结尾。');
  });

  it.each([{ start: 0, end: 0 }, { start: 2, end: 1 }, { start: -1, end: 2 }, { start: 0, end: 100 }, { start: 0.5, end: 2 }, { start: 0, end: 2 }])('不接受空白或无效选区 %j', range => {
    expect(hasTextSelection(' \n正文', range)).toBe(false);
  });

  it('保留跨段落与 Unicode 选区的精确边界', () => {
    const { chapter } = setup();
    chapter.content = '开头🌧雨落。\n她停住。结尾';
    const start = chapter.content.indexOf('🌧'), end = chapter.content.indexOf('结尾');
    expect(applySelectionPolish(chapter, { start, end, content: chapter.content }, '雨落在她肩上。').content).toBe('开头雨落在她肩上。结尾');
  });

  it('前后文遵守上下文预算，选区超限时拒绝发送', () => {
    const chapter = { ...newChapter('长章'), content: '前'.repeat(5000) + '选区' + '后'.repeat(5000) };
    const selected = { start: 5000, end: 5002, content: chapter.content };
    const prompt = selectionPolishPrompt(chapter, selected, 1000);
    expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(1000);
    expect(prompt.user).toContain('待润色片段：\n选区');
    expect(() => selectionPolishPrompt(chapter, { start: 0, end: 10002, content: chapter.content }, 1000)).toThrow('超过上下文上限');
  });
});
