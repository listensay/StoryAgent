import { describe, expect, it } from 'vitest';
import { characterSections, characterSummary, formatCharacterProfile, parseCharacterProfile } from './characterProfile';
import { buildCharacterGraph, retainCharacterRelations } from './characterRelations';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject, parseWorkspace, type Note } from './domain';
import { applyNovelResult, parseNovelResult } from './novelAssistant';
import { buildPrompt } from './prompts';

const person = (id: string, title: string, body = ''): Note => ({ id, title, body, kind: 'character', chapterId: '', status: 'confirmed' });
describe('完整人物档案', () => {
  it('12 类 67 项可以保存并往返，包括多行正文、补充设定和空值', () => {
    const fields = Object.fromEntries(characterSections.flatMap(section => section.fields.map(field => [field, field === '姓名' ? '林舟' : `${field}内容\n第二行`])));
    const body = formatCharacterProfile({ fields, extra: '### 自定义设定\n旧内容\n\n第二段' }, '林舟');
    const parsed = parseCharacterProfile(body);
    expect(characterSections).toHaveLength(12);
    expect(characterSections.flatMap(section => section.fields)).toHaveLength(67);
    expect(parsed).toEqual({ fields, extra: '### 自定义设定\n旧内容\n\n第二段' });
    expect(formatCharacterProfile(parsed, '林舟')).toBe(body);
    expect(parseCharacterProfile(formatCharacterProfile({ fields: {}, extra: '' }, '林舟')).fields['年龄']).toBe('');
  });
  it('字段内的多行标题和同名列表不会被拆成其他字段', () => {
    const fields = { 姓名: '林舟', 身份: '修复师\n## 3. 性格特征\n- 核心性格：此处是引用内容', 核心性格: '谨慎' };
    expect(parseCharacterProfile(formatCharacterProfile({ fields, extra: '' }, '林舟')).fields).toMatchObject(fields);
  });
  it('兼容加粗、编号标题和冒号，原自由文本完整保留', () => {
    expect(parseCharacterProfile('## **1. 基础身份**\n- **姓名：**林舟\n- **身份**：修复师\n\n## 3. 性格特征\n- 核心性格: 谨慎').fields).toEqual({ 姓名: '林舟', 身份: '修复师', 核心性格: '谨慎' });
    const legacy = '身份与作用：修复师\n\n目标与动机：寻找亲人\n\n人物关系：许宁是同伴';
    expect(parseCharacterProfile(legacy)).toEqual({ fields: {}, extra: legacy });
    const formatted = formatCharacterProfile(parseCharacterProfile(legacy), '林舟');
    expect(parseCharacterProfile(formatted).extra).toBe(legacy);
    expect(characterSummary(formatted)).toContain('修复师');
  });
  it('编号关系分类能生成关系图，保存旧档案和改名仍保留连线', () => {
    const body = formatCharacterProfile({ fields: { 朋友: '许宁：调查同伴', 师徒: '沈青：导师' }, extra: '' }, '林舟');
    const notes = [person('a', '林舟', body), person('b', '许宁'), person('c', '沈青')];
    expect(buildCharacterGraph(notes).relations).toHaveLength(2);
    const renamed = retainCharacterRelations(notes, 'a'); renamed[0].title = '林远';
    expect(buildCharacterGraph(renamed).relations).toHaveLength(2);
    notes[0].body = formatCharacterProfile({ fields: {}, extra: '人物关系：许宁是同伴' }, '林舟');
    expect(buildCharacterGraph(notes).relations).toHaveLength(1);
  });
  it('SQLite 工作区、AI 采用及写作上下文保留完整档案', () => {
    const state = emptyWorkspace(), project = newProject('测试', 'long'); state.projects.push(project);
    const body = formatCharacterProfile({ fields: { 身份: '修复师', 口头禅: '先留证据', 最终结局: '公开真相' }, extra: '保留原设定' }, '林舟');
    const result = parseNovelResult(JSON.stringify({ reply: '补全档案', notes: [{ kind: 'character', title: '林舟', body }] }));
    Object.assign(project, applyNovelResult(project, result));
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.projects[0].notes[0].body).toBe(body);
    const ai = { ...newAISelection(), ...defaultAdvanced(), contextChars: 60000 };
    const job = createJob(project, 'draft', ai, project.chapters[0].id, '');
    expect(buildPrompt(restored, job, job.steps[0], ai).user).toContain('口头禅：先留证据');
    const revision = createJob(project, 'revise', ai, undefined, '补全人物');
    expect(buildPrompt(restored, revision, revision.steps[0], ai).user).toContain('基础身份');
  });
});
