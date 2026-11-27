import type { Skill } from './domain';
import type { WritingTools } from './toolGeneration';

type File = Skill['files'][number];
export const isSkillReference = (file: File) => !/(^|\/)SKILL\.md$/i.test(file.path) && /\.(md|txt|json|ya?ml|toml|csv)$/i.test(file.path);
const fail = (message: string) => JSON.stringify({ error: message });

// Virtual files only: exact matches against the selected Skill snapshot. No host
// filesystem, path resolution, scripts, external URLs, or other workspace data.
export function createWritingSkillTools(skills: Skill[], onRead: (id: string, file: File) => void): WritingTools {
  const libraries = new Map(skills.map(skill => [skill.id, skill.files.filter(isSkillReference)]));
  const pages = new Map<File, { start: number; end: number }[]>();
  function record(id: string, file: File, start: number, end: number) {
    const ranges = pages.get(file) ?? [];
    if (ranges.some(range => range.start <= start && range.end >= end)) return;
    const merged: typeof ranges = [];
    for (const r of [...ranges, { start, end }].sort((a, b) => a.start - b.start)) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else merged.push({ ...r });
    }
    pages.set(file, merged);
    onRead(id, { path: file.path, content: merged.map(r => file.content.slice(r.start, r.end)).join('\n[…]\n') });
  }
  return { execute(name, args, maxChars) {
    if (!args || typeof args !== 'object') return fail('无效参数');
    const { skill, path, query, offset = 0 } = args as Record<string, unknown>;
    const files = typeof skill === 'string' && libraries.get(skill);
    if (!files || typeof skill !== 'string') return fail('未选用此 Skill');
    if (name === 'search_skill_files') {
      if (typeof query !== 'string' || !query.trim() || query.length > 160) return fail('请输入简短关键词或目录名');
      const terms = query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
      const pairs = [...new Set(terms.flatMap(t => t.match(/\p{Script=Han}{2,}/gu)?.flatMap(s => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2))) ?? []))];
      const hits = files.filter(f => !/(^|\/)index\.md$/i.test(f.path)).map(f => {
        const lead = f.content.slice(0, 500).split(/\n\n(?:###|\d+\.)/)[0];
        const haystack = `${f.path} ${lead}`.toLowerCase();
        const score = terms.reduce((n, t) => n + (haystack.includes(t) ? 8 : 0), 0) + pairs.reduce((n, t) => n + Number(haystack.includes(t)), 0);
        return { path: f.path, summary: lead.replace(/\s+/g, ' ').slice(0, 150), score };
      }).filter(f => f.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
      const matches: { path: string; summary: string }[] = [];
      for (const { path, summary } of hits.slice(0, 8)) {
        const hit = { path, summary };
        if (JSON.stringify({ matches: [...matches, hit] }).length > maxChars) break;
        matches.push(hit);
      }
      return JSON.stringify({ matches });
    }
    if (name !== 'read_skill_file') return fail('未知工具');
    const file = files.find(f => f.path === path);
    if (!file) return fail('该 Skill 没有此资料文件');
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > file.content.length) return fail('读取位置无效');
    const result = (size: number) => JSON.stringify({ content: file.content.slice(offset, offset + size), nextOffset: offset + size < file.content.length ? offset + size : null });
    let lo = 0, hi = Math.min(maxChars, file.content.length - offset);
    while (lo < hi) { const n = Math.ceil((lo + hi) / 2); if (result(n).length <= maxChars) lo = n; else hi = n - 1; }
    if (!lo && offset < file.content.length) return fail('剩余上下文不足');
    if (lo || !file.content.length) record(skill, file, offset, offset + lo);
    return result(lo);
  } };
}
