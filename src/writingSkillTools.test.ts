import { describe, expect, it, vi } from 'vitest';
import type { Skill } from './domain';
import { createWritingSkillTools } from './writingSkillTools';

function setup() {
  const files = Array.from({ length: 414 }, (_, i) => ({ path: `references/${i}.md`, content: `# ${i === 413 ? '老祖藏手机' : '远行'}\n\n适用情境：掩饰。\n\n### 示例\n秘密${i}` }));
  files.push({ path: 'SKILL.md', content: '技法入口。' }, { path: 'scripts/run.py', content: '不可读' });
  const skill = { id: 'book', files } as Skill, read = vi.fn();
  const tools = createWritingSkillTools([skill], read, ['book']);
  const activate = (budget = 2000, offset = 0) => JSON.parse(tools.execute('activate_skill', { skill: 'book', offset }, budget));
  const search = (query: string, budget = 6000) => JSON.parse(tools.execute('search_skill_files', { skill: 'book', query }, budget));
  return { tools, files, read, search, activate };
}

describe('写作 Skill 只读工具', () => {
  it('单文件 Skill 只在完整读取入口后激活，不能只读尾页', () => {
    const skill = { id: 'solo', name: '单文件', files: [{ path: 'SKILL.md', content: '规则'.repeat(100) }] } as Skill;
    const read = vi.fn(), tools = createWritingSkillTools([skill], read, [skill.id]);
    const activate = (offset: number, budget: number) => JSON.parse(tools.execute('activate_skill', { skill: skill.id, offset }, budget));
    expect(JSON.parse(tools.execute('search_skill_files', { skill: skill.id, query: '规则' }, 2000))).toHaveProperty('error');
    expect(activate(190, 2000).nextOffset).toBeNull();
    expect(tools.pendingRequired?.()).toEqual([skill.name]);
    const first = activate(0, 128);
    expect(first.nextOffset).toBeGreaterThan(0);
    expect(activate(first.nextOffset, 2000).nextOffset).toBeNull();
    expect(tools.pendingRequired?.()).toEqual([]);
    expect(read).toHaveBeenLastCalledWith(skill.id, skill.files[0]);
  });
  it('414 条目录也只返回短名单；候选摘要不是文件读取', () => {
    const { search, read, activate } = setup();
    activate(); read.mockClear();
    expect(search('掩饰').matches).toHaveLength(8);
    const found = search('老祖藏手机').matches;
    expect(found[0].path).toBe('references/413.md'); expect(found[0].summary).not.toContain('秘密');
    expect(search('乌龟').matches).toEqual([]); expect(read).not.toHaveBeenCalled();
  });
  it('只读取所选 Skill 快照里的文本资源；无效请求不计作读取', () => {
    const { tools, read, activate } = setup();
    activate(); read.mockClear();
    for (const [skill, path] of [['other','references/0.md'], ['book','/etc/passwd'], ['book','../references/0.md'], ['book','scripts/run.py']]) {
      expect(JSON.parse(tools.execute('read_skill_file', { skill, path }, 2000))).toHaveProperty('error');
    }
    expect(read).not.toHaveBeenCalled();
  });
  it('按页回传真实片段，转义后仍在预算内；重复或交叠的读取不重复记录', () => {
    const { tools, read, files, activate } = setup();
    activate(); read.mockClear();
    const file = files[0]; file.content = '"\\\n'.repeat(200);
    const page = (offset: number) => {
      const result = tools.execute('read_skill_file', { skill: 'book', path: file.path, offset }, 128);
      expect(result.length).toBeLessThanOrEqual(128); return JSON.parse(result);
    };
    const first = page(0); expect(first.nextOffset).toBe(first.content.length); expect(first.nextOffset).toBeGreaterThan(0);
    page(0); expect(read).toHaveBeenCalledTimes(1);
    const second = page(first.nextOffset - 2);
    expect(read.mock.lastCall).toEqual(['book', { path: file.path, content: file.content.slice(0, second.nextOffset) }]);
  });
});
