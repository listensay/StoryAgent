import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { emptyWorkspace, parseWorkspace } from './domain';
import { collectRanking } from './platform';
import { rankingContent, type Ranking } from './rankings';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const ranking: Ranking = {
  platform: '番茄小说', board: '阅读榜', channel: '女频', category: '古风世情',
  sourceUrl: 'https://fanqienovel.com/rank/0_2_1139', collectedAt: '2026-11-19T00:00:00Z', skipped: 1,
  books: [{ id: '7654593151348247614', rank: 2, title: '测试作品', author: '作者', intro: '简介', genre: '古风', words: '', status: '', url: 'https://fanqienovel.com/page/7654593151348247614', metrics: [] }],
};
const options = { platform: 'fanqie' as const, board: '2', channel: '0', category: '1139', limit: 10 };
beforeEach(() => vi.mocked(invoke).mockReset());
describe('ranking research sources', () => {
  it('retains structured snapshots and old references through workspace reload', () => {
    const state = emptyWorkspace();
    state.references.push({ id: 'old', title: '旧资料', source: '', kind: 'ranking', content: '原内容', createdAt: ranking.collectedAt });
    state.references.push({ id: 'new', title: '扫榜', source: ranking.sourceUrl, kind: 'ranking', content: rankingContent(ranking), createdAt: ranking.collectedAt, ranking });
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.references[0].content).toBe('原内容');
    expect(restored.references[1].ranking).toEqual(ranking);
    expect(restored.references[1].ranking?.books[0].id).toBe('7654593151348247614');
  });
  it('provides provenance and original ranks to analysis without inventing missing metrics', () => {
    const content = rankingContent(ranking);
    expect(content).toContain('女频 · 阅读榜 · 古风世情');
    expect(content).toContain(ranking.collectedAt);
    expect(content).toContain(ranking.sourceUrl);
    expect(content).toContain('第 2 名：测试作品');
    expect(content).toContain(ranking.books[0].url);
    expect(content).toContain('未获取的作品：1');
    expect(content).not.toContain('在读人数：');
  });
  it('persists covers and book-linked text without replacing the novel with its synopsis', () => {
    const state = emptyWorkspace();
    const snapshot = structuredClone(ranking);
    snapshot.books[0].coverUrl = 'https://p6-novel-sign.byteimg.com/cover.jpg';
    state.references.push({ id: 'board', title: '榜单', source: ranking.sourceUrl, kind: 'ranking', content: rankingContent(snapshot), ranking: snapshot, createdAt: ranking.collectedAt });
    state.references.push({ id: 'text', title: '测试作品 · 开篇', source: 'novel.txt', kind: 'text', content: '第一章\n真正的小说正文。', bookUrl: snapshot.books[0].url, createdAt: ranking.collectedAt });
    const restored = parseWorkspace(JSON.stringify(state));
    const book = restored.references[0].ranking!.books[0];
    expect(book.coverUrl).toBe(snapshot.books[0].coverUrl);
    const linked = restored.references.find(r => r.kind === 'text' && r.bookUrl === book.url);
    expect(linked?.content).toBe('第一章\n真正的小说正文。');
    expect(linked?.content).not.toBe(book.intro);
  });
  it('does not accept late results after a scan is stopped', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(command => command === 'collect_ranking' ? new Promise(done => { resolve = done; }) : Promise.resolve(undefined as never));
    const controller = new AbortController();
    const pending = collectRanking(options, controller.signal);
    controller.abort(); resolve(ranking);
    await expect(pending).rejects.toThrow();
    const id = (vi.mocked(invoke).mock.calls[0][1] as { request: { id: string } }).request.id;
    expect(invoke).toHaveBeenCalledWith('cancel_http', { id });
  });
  it('does not dispatch a scan with an already aborted signal', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(collectRanking(options, controller.signal)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
