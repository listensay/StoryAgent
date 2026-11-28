import { stringify } from 'yaml';
import { type Skill, type TaskKind, uid } from './domain';

export const manualSource = '手动创建';
export type ManualSkillDraft = { name: string; description: string; version: string; rules: string; tasks: TaskKind[]; enabled: boolean };
export const newManualDraft = (): ManualSkillDraft => ({ name: '', description: '', version: '1.0', rules: '', tasks: ['draft', 'continue', 'rewrite'], enabled: false });
export function skillSourceLabel(skill: Skill) {
  return skill.originReferenceId ? '小说提炼' : skill.builtin ? '内置' : skill.source === manualSource || skill.source === '修稿提炼' ? skill.source : skill.source.startsWith('https://github.com/') ? 'GitHub' : '文件导入';
}
const normalized = (name: string) => name.trim().normalize('NFKC').toLowerCase();
export function validateManualSkill(draft: ManualSkillDraft, skills: Skill[], exceptId?: string) {
  if (!draft.name.trim()) return '请填写名称';
  if (skills.some(s => s.id !== exceptId && normalized(s.name) === normalized(draft.name))) return '已有同名 Skill，请更换名称';
  if (!draft.description.trim()) return '请填写用途';
  if (!draft.version.trim()) return '请填写版本';
  if (!draft.tasks.length) return '请选择适用任务';
  if (!draft.rules.trim()) return '请填写写作规则';
  return '';
}
export function manualEntry(draft: ManualSkillDraft) {
  const metadata = { name: draft.name.trim(), description: draft.description.trim(), metadata: { version: draft.version.trim() } };
  return `---\n${stringify(metadata).trimEnd()}\n---\n\n${draft.rules.trim()}\n`;
}
export function makeManualSkill(draft: ManualSkillDraft, skills: Skill[]): Skill {
  const error = validateManualSkill(draft, skills);
  if (error) throw new Error(error);
  return { id: uid(), name: draft.name.trim(), description: draft.description.trim(), version: draft.version.trim(), tasks: [...draft.tasks], enabled: draft.enabled, builtin: false, source: manualSource, files: [{ path: 'SKILL.md', content: manualEntry(draft) }], revisions: [] };
}
export function rulesFromEntry(content: string) { return content.replace(/^﻿?---[^\S\n]*\n[\s\S]*?\n---[^\S\n]*(?:\n|$)/, '').trimStart(); }

export function editableFiles(skill: Skill, files = skill.files): Skill['files'] {
  return files.map(f => skill.source === manualSource && f.path === 'SKILL.md' ? { ...f, content: rulesFromEntry(f.content) } : { ...f });
}
