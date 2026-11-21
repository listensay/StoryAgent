import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Markdown } from './Markdown';

const render = (text: string, onCitation?: (paragraph: number) => void) => renderToStaticMarkup(<MantineProvider><Markdown onCitation={onCitation} onError={vi.fn()}>{text}</Markdown></MantineProvider>);

describe('Markdown results', () => {
  it('renders headings, emphasis, nested lists, quotes, tables and code', () => {
    const html = render('# 分析结果\n\n## 结构\n\n**冲突**与*节奏*，~~重复~~。\n\n1. 起因\n   - 线索\n2. 转折\n\n> 原文引用\n\n| 手法 | 效果 |\n| --- | --- |\n| 对比 | 突出变化 |\n\n```text\n**保留代码原文**\n```');
    expect(html).toContain('<h1>分析结果</h1>');
    expect(html).toContain('<h2>结构</h2>');
    expect(html).toContain('<strong>冲突</strong>');
    expect(html).toContain('<em>节奏</em>');
    expect(html).toContain('<del>重复</del>');
    expect(html).toMatch(/<ol>[\s\S]*<ul>[\s\S]*线索/);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<th>手法</th>');
    expect(html).toContain('<td>突出变化</td>');
    expect(html).toContain('<code class="language-text">**保留代码原文**');
  });

  it('keeps citations interactive inside formatting without changing code or links', () => {
    const html = render('**证据 [P1]**\n\n- 对比 [P2][P3]\n\n| 证据 |\n| --- |\n| [P4] |\n\n`[P5]`\n\n```text\n[P6]\n```\n\n[资料 [P7]](https://example.com)', vi.fn());
    expect(html.match(/aria-label="查看原文第/g)).toHaveLength(4);
    for (const paragraph of [1, 2, 3, 4]) expect(html).toContain(`aria-label="查看原文第 ${paragraph} 段"`);
    expect(html).toContain('<code>[P5]</code>');
    expect(html).toContain('<code class="language-text">[P6]');
    expect(html).toContain('资料 [P7]');
    expect(html).not.toContain('<a href="#source-p-');
  });

  it('keeps citations as text when the source is unavailable', () => {
    const html = render('证据 [P1]');
    expect(html).toContain('证据 [P1]');
    expect(html).not.toContain('查看原文第');
  });

  it('preserves plain text paragraphs and line breaks during streaming', () => {
    const html = render('第一行\n第二行\n\n下一段\n\n**尚未结束');
    expect(html).toContain('第一行<br/>\n第二行');
    expect(html).toContain('<p>下一段</p>');
    expect(html).toContain('尚未结束');
    expect(render('```text\n尚未结束的代码')).toContain('尚未结束的代码');
  });

  it('renders Chinese bold labels adjacent to prose without reinterpreting code or escaped text', () => {
    const html = render('- **主视角：**第三人称\n\n**场景变化：**陆昭开始行动。\n\n`**代码：**保持`\n\n\\*\\*原样：\\*\\*保持\n\n[**链接：**保持](https://example.com)');
    expect(html).toContain('<strong>主视角：</strong>第三人称');
    expect(html).toContain('<strong>场景变化：</strong>陆昭开始行动。');
    expect(html).toContain('<code>**代码：**保持</code>');
    expect(html).toContain('**原样：**保持');
    expect(html).toContain('**链接：**保持');
  });

  it('does not render executable HTML, unsafe links or remote images', () => {
    const html = render('<script>alert(1)</script>\n\n<img src="https://example.com/track" onerror="alert(1)">\n\n[危险](javascript:alert%281%29) [文件](file:///tmp/test) [资料](https://example.com)\n\n![图示](https://example.com/image.png)');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('file:///');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('图示');
  });
});
