import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, newProject, type Note } from './domain';
import { Characters } from './pages/Characters';
import { Knowledge } from './pages/Knowledge';
import { formatCharacterProfile } from './characterProfile';
import type { Store } from './useWorkspace';

describe('人物档案与世界设定页面', () => {
  const state = emptyWorkspace(), project = newProject('测试小说', 'long');
  project.notes = [
    { id: 'person', kind: 'character', title: '林舟', body: formatCharacterProfile({ fields: { 身份: '记忆修复师', 人生目标: '寻找亲人' }, extra: '' }, '林舟') },
    { id: 'world', kind: 'world', title: '记忆规则', body: '修复记忆的代价' },
    { id: 'ref', kind: 'reference', title: '调查资料', body: '参考记录' },
  ].map(note => ({ ...note, status: 'confirmed', chapterId: '' })) as Note[];
  const store = { state, update: vi.fn(), notify: vi.fn() } as unknown as Store;
  const render = (element: React.ReactNode) => renderToStaticMarkup(<MantineProvider>{element}</MantineProvider>);
  it('创作准备只显示小说信息与参考记录', () => {
    const html = render(<Knowledge project={project} store={store} mode="details" onSettings={vi.fn()} />);
    expect(html).toContain('调查资料');
    for (const text of ['添加人物', '人物关系图', '林舟', '世界设定', '记忆规则']) expect(html).not.toContain(text);
  });
  it('独立人物页显示档案摘要与关系图入口，世界页只显示设定', () => {
    const html = render(<Characters project={project} store={store} />);
    for (const text of ['人物档案', '人物关系图', '林舟', '记忆修复师', '寻找亲人']) expect(html).toContain(text);
    expect(html).not.toContain('记忆规则');
    const world = render(<Knowledge project={project} store={store} mode="world" onSettings={vi.fn()} />);
    expect(world).toContain('记忆规则'); expect(world).not.toContain('返回小说信息'); expect(world).not.toContain('林舟');
  });
});
