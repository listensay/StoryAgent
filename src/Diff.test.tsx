import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Diff } from './components';

describe('生成稿对比', () => {
  it('两栏渲染 Markdown，并分别提供可聚焦的滚动阅读区域', () => {
    const html = renderToStaticMarkup(<MantineProvider><Diff left={'## 原稿\n\n> 保留的引用'} right={'# 细纲\n\n**冲突**\n\n- 转折\n\n| 人物 | 目标 |\n| --- | --- |\n| 陆昭 | 开城 |'} onError={vi.fn()} /></MantineProvider>);
    expect(html).toContain('<h2>原稿</h2>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<h1>细纲</h1>');
    expect(html).toContain('<strong>冲突</strong>');
    expect(html).toContain('<li>转折</li>');
    expect(html).toContain('<td>陆昭</td>');
    expect(html).toContain('aria-label="当前正文内容"');
    expect(html).toContain('aria-label="生成结果内容"');
    expect(html.match(/role="region"/g)).toHaveLength(2);
    expect(html.match(/tabindex="0"/g)).toHaveLength(2);
  });
});
