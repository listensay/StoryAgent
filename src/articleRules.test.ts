import { describe, expect, it } from 'vitest';
import { articleRange, defaultArticleRule } from './articleRules';
import { emptyWorkspace, parseWorkspace } from './domain';

describe('article collection settings', () => {
  it('migrates existing workspaces and backups with the default 69书吧 rule', () => {
    const old: Partial<ReturnType<typeof emptyWorkspace>> = emptyWorkspace();
    delete old.articleRules;
    const restored = parseWorkspace(JSON.stringify(old));
    expect(restored.articleRules).toEqual([defaultArticleRule]);
    expect(restored.skills).toEqual(old.skills);
  });
  it('retains added, edited and deleted rules after saving and restoring', () => {
    const workspace = emptyWorkspace();
    workspace.articleRules.push({ ...defaultArticleRule, id: 'other', name: '其他网站', siteUrl: 'https://example.com/' });
    workspace.articleRules[0].contentSelector = '#content';
    expect(parseWorkspace(JSON.stringify(workspace)).articleRules).toEqual(workspace.articleRules);
    workspace.articleRules = [];
    expect(parseWorkspace(JSON.stringify(workspace)).articleRules).toEqual([]);
    expect(emptyWorkspace().articleRules[0].contentSelector).toBe('.txtnav');
  });
  it('bounds chapter ranges without dropping or reordering requested chapters', () => {
    expect(articleRange(3, 7, 10)).toEqual({ start: 2, end: 7 });
    expect(articleRange(1, 100, 200)).toEqual({ start: 0, end: 100 });
    for (const [start, end, total] of [[0, 1, 5], [1, 101, 200], [5, 3, 10], [1.5, 2, 10], [1, 3, 2], [NaN, 1, 2]]) {
      expect(() => articleRange(start, end, total)).toThrow();
    }
  });
});
