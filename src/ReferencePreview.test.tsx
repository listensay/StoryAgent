import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReferencePreview, referencePages } from './ReferencePreview';

describe('reference preview', () => {
  it('bounds each page while preserving every character of a long novel', () => {
    const text = Array.from({ length: 100 }, (_, index) => `## 第${index + 1}章\n\n${'正文段落。'.repeat(400)}\n\n`).join('');
    const pages = referencePages(text);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every(page => page.length <= 12_000)).toBe(true);
    expect(pages.join('')).toBe(text);
  });

  it('keeps short Markdown together and does not split surrogate pairs', () => {
    const short = '# 研究结果\n\n**结论**\n\n| 项目 | 结果 |\n| --- | --- |\n| 开篇 | 冲突 |';
    expect(referencePages(short)).toEqual([short]);
    expect(referencePages('')).toEqual(['']);
    const text = '文'.repeat(11_999) + '𠮷' + '文'.repeat(12_000);
    const pages = referencePages(text);
    expect(pages.join('')).toBe(text);
    expect(pages[0]).toHaveLength(11_999);
    expect(pages[1].startsWith('𠮷')).toBe(true);
  });

  it('mounts only the first page of a large reference', () => {
    const content = '# 开篇\n\n' + '正文段落。\n\n'.repeat(40_000) + '\n末尾标记';
    const html = renderToStaticMarkup(<MantineProvider><ReferencePreview content={content} onError={vi.fn()} /></MantineProvider>);
    expect(html).toContain('<h1>开篇</h1>');
    expect(html).toContain('参考文本分页');
    expect(html).not.toContain('末尾标记');
    expect(html.match(/正文段落/g)?.length).toBeLessThan(2_000);
  });
});
