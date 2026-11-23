import { describe, expect, it } from 'vitest';
import { parseChangelog, releaseRecord, validateChangelog } from './changelog.mjs';
import { updateRecords } from './releaseNotes';

const source = '# 更新记录\n\n## 0.2.0 · 2026-11-23\n\n- 支持查看更新记录。\n\n## 0.1.0 · 2026-11-22\n\n- 支持小说创作。\n';

describe('version records', () => {
  it('parses the shared file and requires the release version at the top', () => {
    expect(parseChangelog(source.replace(/\n/g, '\r\n'))).toEqual([
      { version: '0.2.0', date: '2026-11-23', changes: ['支持查看更新记录。'] },
      { version: '0.1.0', date: '2026-11-22', changes: ['支持小说创作。'] },
    ]);
    expect(releaseRecord(source, '0.2.0').version).toBe('0.2.0');
    expect(() => releaseRecord(source, '0.1.0')).toThrow('at the top');
  });

  it('rejects excess items, long entries, invalid dates, markup and duplicate or unordered versions', () => {
    for (const invalid of [
      '', source.replace('2026-11-23', '2026-02-30'), source.replace('0.1.0', '0.2.0'), source.replace('0.1.0', '0.3.0'),
      '## 0.2.0 · 2026-11-23\n' + '- 改进体验。\n'.repeat(6),
      `## 0.2.0 · 2026-11-23\n- ${'文'.repeat(81)}`,
      `## 0.2.0 · 2026-11-23\n${`- ${'文'.repeat(80)}\n`.repeat(4)}`,
      source.replace('支持查看更新记录。', '[记录](https://example.com)'), source.replace('支持查看更新记录。', '<b>记录</b>'),
      source.replace('支持查看更新记录。', '  '), source + '实施过程\n',
    ]) expect(() => parseChangelog(invalid)).toThrow();
    expect(() => validateChangelog({ version: '0.2.0' })).toThrow();
    expect(() => parseChangelog(`## 0.2.0 · 2026-11-23\n- ${'𠮷'.repeat(80)}`)).not.toThrow();
  });

  it('hides unreleased bundled entries and includes intermediate versions supplied by the updater', () => {
    const current = { currentVersion: '0.1.12', version: '', notes: '', releases: [] };
    expect(updateRecords(current)[0].version).toBe('0.1.12');
    const records = updateRecords({ ...current, version: '0.3.0', releases: [
      { version: '0.4.0', date: '2026-11-23', changes: ['未来版本。'] },
      { version: '0.3.0', date: '2026-11-23', changes: ['最新版本。'] },
      { version: '0.2.0', date: '2026-11-23', changes: ['中间版本。'] },
    ] });
    expect(records.slice(0, 2).map(record => record.version)).toEqual(['0.3.0', '0.2.0']);
    expect(records.some(record => record.version === '0.4.0')).toBe(false);
    expect(records.some(record => record.version === '0.1.12')).toBe(true);
  });

  it('uses bundled history for old manifests and bounds plain notes for unknown versions', () => {
    const base = { currentVersion: '0.1.11', version: '0.1.12', notes: '', releases: [] };
    expect(updateRecords(base)[0].changes).toContain('训练支持仅提交文字反馈或片段评价，并保留已保存的评价。');
    const records = updateRecords({ ...base, version: '0.2.0', notes: `- ${'文'.repeat(100)}\n`.repeat(10) });
    expect(records[0].changes).toHaveLength(4);
    expect(records[0].changes.join('')).toHaveLength(300);
    expect(records[0].changes.every(change => change.length <= 80)).toBe(true);
    expect(updateRecords({ ...base, version: '0.2.0' })[0].changes).toEqual([]);
  });
});
