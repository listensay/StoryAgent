import { describe, expect, it } from 'vitest';
import type { TrainingAnnotation } from './domain';
import { annotationSegments } from './trainingAnnotations';

const content = '他抬头。\n\n他抬头。她笑了。';
const comment = (start: number, end: number): TrainingAnnotation => ({ target: 'candidate', caseIndex: 0, start, end, quote: content.slice(start, end), feedback: '调整动作' });
describe('划词评价高亮', () => {
  it('重复句子只高亮选中的位置，完整保留换行和正文', () => {
    const segments = annotationSegments(content, [comment(6, 10)]);
    expect(segments.map(s => s.text).join('')).toBe(content);
    expect(segments.filter(s => s.annotations.length)).toEqual([{ start: 6, text: '他抬头。', annotations: [0] }]);
  });
  it('跨段和重叠评价保留每条批注的范围', () => {
    const segments = annotationSegments(content, [comment(1, 8), comment(6, 12)]);
    expect(segments.map(s => s.text).join('')).toBe(content);
    expect(segments.find(s => s.start === 6)).toMatchObject({ text: '他抬', annotations: [0, 1] });
    expect(segments.filter(s => s.annotations.includes(0)).map(s => s.text).join('')).toBe(content.slice(1, 8));
    expect(segments.filter(s => s.annotations.includes(1)).map(s => s.text).join('')).toBe(content.slice(6, 12));
  });
  it('失效范围不高亮，也不改变正文', () => {
    expect(annotationSegments(content, [{ ...comment(0, 2), quote: '错误' }, comment(0, 100)])).toEqual([{ start: 0, text: content, annotations: [] }]);
    expect(annotationSegments('', [])).toEqual([]);
  });
});
