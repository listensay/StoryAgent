import { unzipSync, strFromU8 } from 'fflate';
import { parse } from 'yaml';
import { archiveSkill } from './skillVersions';
import { type InputFile, http } from './platform';
import { type Skill, type TaskKind, uid, now } from './domain';

const textExtension = /(?:\.(md|txt|json|ya?ml|toml|csv|js|ts|py|sh|ps1|cmd|bat)|LICENSE)$/i;
export function expandFiles(inputs: InputFile[]): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  let total = 0;
  const add = (path: string, bytes: Uint8Array) => {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').some(p => p === '..') || normalized.includes('\0')) throw new Error('文件路径无效');
    total += bytes.length;
    if (total > 20 * 1024 * 1024 || files.length >= 2000) throw new Error('导入内容超过 20 MB 或 2000 个文件');
    if (textExtension.test(normalized) && !normalized.split('/').some(p => ['.git', 'node_modules', 'target'].includes(p))) files.push({ path: normalized, content: strFromU8(bytes) });
  };
  for (const input of inputs) {
    if (input.bytes.length > 20 * 1024 * 1024) throw new Error('文件超过 20 MB');
    if (/\.zip$/i.test(input.name)) {
      let expandedSize = 0, count = 0;
      const expanded = unzipSync(input.bytes, { filter: file => { expandedSize += file.originalSize; count++; if (expandedSize > 20 * 1024 * 1024 || count > 2000) throw new Error('压缩包超过导入限制'); return !file.name.endsWith('/'); } });
      for (const [path, bytes] of Object.entries(expanded)) add(path, bytes);
    } else add(input.name, input.bytes);
  }
  return files;
}
export function resourcePaths(content: string): string[] {
  return [...content.matchAll(/(?:`([^`\n]+\.(?:md|txt|json|ya?ml|toml|csv))`|\]\(([^)\s]+\.(?:md|txt|json|ya?ml|toml|csv))(?:#[^\s)]*)?\))/gi)].map(match => match[1] || match[2]).filter(path => !/^(?:https?:|\/|\$)/i.test(path));
}
function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
  return parts.join('/');
}
function relativePath(from: string, to: string): string {
  const a = from.split('/').filter(Boolean), b = to.split('/');
  while (a.length && a[0] === b[0]) { a.shift(); b.shift(); }
  return [...a.map(() => '..'), ...b].join('/');
}
export function parseSkills(files: { path: string; content: string }[], source: string, version = now(), subdir = ''): Skill[] {
  const definitions = files.filter(f => /(^|\/)SKILL\.md$/i.test(f.path) && (!subdir || f.path.startsWith(subdir + '/')));
  if (!definitions.length) throw new Error('未找到 SKILL.md');
  return definitions.map(file => {
    const frontmatter = file.content.match(/^\uFEFF?---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
    if (!frontmatter) throw new Error(`${file.path} 缺少 Skill 元数据`);
    const metadata = parse(frontmatter[1]);
    if (!metadata || typeof metadata.name !== 'string' || typeof metadata.description !== 'string') throw new Error(`${file.path} 需要 name 与 description`);
    const dir = file.path.slice(0, -'SKILL.md'.length);
    const resources = files.filter(f => f.path.startsWith(dir) && (!/SKILL\.md$/i.test(f.path) || f.path === file.path));
    const included = new Set(resources.map(f => f.path));
    // Follow resource references while the complete archive is still available.
    for (let index = 0; index < resources.length; index++) {
      const resource = resources[index], parent = resource.path.slice(0, resource.path.lastIndexOf('/') + 1);
      for (const path of resourcePaths(resource.content)) {
        const resolved = normalizePath(parent + path);
        let linked = files.find(f => f.path === resolved);
        if (!linked && !path.includes('/')) {
          const shared = files.filter(f => /(^|\/)(?:_shared|shared)\//.test(f.path) && f.path.endsWith('/' + path));
          if (shared.length === 1) linked = shared[0];
        }
        if (linked && !included.has(linked.path) && !/SKILL\.md$/i.test(linked.path)) { included.add(linked.path); resources.push(linked); }
      }
    }
    const name = metadata.name.toLowerCase();
    const tasks: TaskKind[] = /scan|扫榜/.test(name) ? ['scan'] : /analy|拆文/.test(name) ? ['analyze', 'style'] : /style|风格/.test(name) ? ['style', 'draft', 'continue', 'rewrite'] : /review|deslop|审稿/.test(name) ? ['review', 'rewrite'] : /write|写作/.test(name) ? ['draft', 'continue', 'rewrite', 'plan'] : ['draft', 'continue', 'rewrite', 'plan', 'review', 'memory', 'scan', 'analyze', 'style'];
    return { id: uid(), name: metadata.name, description: metadata.description, source: `${source}${definitions.length > 1 ? '#' + dir.replace(/\/$/, '') : ''}`, version: String(metadata.metadata?.version ?? metadata.version ?? version), enabled: true, builtin: false, tasks, ...(metadata.metadata?.storyagent?.resourceMode === 'relevant' ? { resourceMode: 'relevant' as const } : {}), files: resources.map(f => ({ path: relativePath(dir, f.path), content: f.content })), revisions: [] };
  });
}
export function mergeSkills(current: Skill[], incoming: Skill[]): Skill[] {
  const result = [...current];
  for (const skill of incoming) {
    const index = result.findIndex(s => !s.builtin && s.name === skill.name && s.source === skill.source);
    if (index === -1) result.push(skill);
    else { const old = result[index]; result[index] = { ...skill, id: old.id, enabled: old.enabled, tasks: old.tasks, revisions: archiveSkill(old) }; }
  }
  return result;
}
export async function githubSkills(url: string): Promise<Skill[]> {
  const parsed = new URL(url);
  if (parsed.hostname !== 'github.com') throw new Error('请输入 GitHub 仓库或子目录地址');
  const [owner, repoName, mode, ...segments] = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const repo = repoName?.replace(/\.git$/, '');
  if (!owner || !repo || (mode && mode !== 'tree')) throw new Error('GitHub 地址无效');
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = { Accept: 'application/vnd.github+json' };
  let ref = '', subdir = '', sha = '';
  if (mode === 'tree') {
    for (let i = segments.length; i >= 1; i--) {
      const candidate = segments.slice(0, i).join('/');
      try { const commit = JSON.parse((await http({ url: base + '/commits/' + encodeURIComponent(candidate), headers })).text); ref = candidate; sha = commit.sha; subdir = segments.slice(i).join('/'); break; }
      catch (error) { if (!String(error).includes('HTTP 404')) throw error; }
    }
    if (!ref) throw new Error('未找到仓库分支');
  } else {
    const repository = JSON.parse((await http({ url: base, headers })).text); ref = repository.default_branch;
    sha = JSON.parse((await http({ url: base + '/commits/' + encodeURIComponent(ref), headers })).text).sha;
  }
  const response = await http({ url: `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/${encodeURIComponent(sha)}`, binary: true });
  let files = expandFiles([{ name: 'skills.zip', bytes: response.bytes }]);
  files = files.map(f => ({ ...f, path: f.path.split('/').slice(1).join('/') }));
  return parseSkills(files, `https://github.com/${owner}/${repo}${subdir ? '/tree/' + ref + '/' + subdir : ''}`, sha.slice(0, 12), subdir);
}
