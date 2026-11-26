import { describe, expect, it } from 'vitest';
import { buildCharacterGraph, characterMentions, characterPositions, layoutCharacters, newCharacterRelation, relationByNames, resolveCharacterRelation, retainCharacterRelations } from './characterRelations';
import { createJob, defaultAdvanced, emptyWorkspace, newAISelection, newProject, parseWorkspace, type Note } from './domain';
import { acceptPreparation, preparationSnapshot } from './jobWorkflow';
import { buildPrompt } from './prompts';

const character = (id: string, title: string, body = ''): Note => ({ id, title, body, kind: 'character', status: 'planned', chapterId: '' });
const characters = () => [character('a', '林舟'), character('b', '许宁'), character('c', '沈青')];

describe('人物关系解析与布局', () => {
  it('保留结构化关系，人物改名后仍然连接，删除双方之一后不推测替代人物', () => {
    const notes = characters(), relation = newCharacterRelation('a', 'b', '同伴', '林舟和沈青相识');
    notes[0].title = '林远';
    expect(resolveCharacterRelation(relation, notes)).toEqual({ sourceId: 'a', targetId: 'b' });
    expect(resolveCharacterRelation(relation, notes.filter(note => note.id !== 'b'))).toBeUndefined();
    expect(resolveCharacterRelation(newCharacterRelation('a', 'a'), notes)).toBeUndefined();
    expect(relationByNames(' 林远 ', '许宁', notes)).toEqual({ sourceId: 'a', targetId: 'b' });
    expect(relationByNames('林', '许宁', notes)).toBeUndefined();
  });
  it('仅连接旧记录中明确的两个人物，拒绝多方、同名与英文子串', () => {
    const notes = characters(), relation: Note = { ...newCharacterRelation(), relation: undefined, title: '同伴', body: '林舟与许宁共同调查' };
    expect(resolveCharacterRelation(relation, notes)).toEqual({ sourceId: 'a', targetId: 'b' });
    expect(resolveCharacterRelation({ ...relation, body: '林舟、许宁与沈青' }, notes)).toBeUndefined();
    expect(resolveCharacterRelation(relation, [...notes, character('d', '林舟')])).toBeUndefined();
    expect(characterMentions('Anna 和 林舟', [character('ann', 'Ann'), character('anna', 'Anna'), notes[0]]).map(note => note.title)).toEqual(['Anna', '林舟']);
    expect(characterMentions('林舟宁和许宁', [character('short', '林舟'), character('long', '林舟宁'), notes[1]]).map(note => note.id)).toEqual(['long', 'b']);
  });
  it('提取人物档案中的明确关系，并保留待关联记录，避免重复档案连线', () => {
    const notes = characters();
    notes[0].body = '身份与作用：修复师\n\n人物关系：\n- 许宁：调查同伴\n- 沈青：导师\n\n背景：曾与许宁相遇';
    notes[1].body = '## 人物关系\n林舟的同伴\n\n## 性格\n谨慎';
    const explicit = newCharacterRelation('a', 'b', '同伴');
    const unlinked = newCharacterRelation('', '', '未知双方');
    const graph = buildCharacterGraph([...notes, explicit, unlinked]);
    expect(graph.characters).toHaveLength(3); expect(graph.relations).toHaveLength(2);
    expect(graph.relations[0]).toMatchObject({ title: '同伴', noteId: explicit.id });
    expect(graph.relations[1]).toMatchObject({ sourceId: 'a', targetId: 'c', title: '- 沈青：导师' });
    expect(graph.unlinked).toEqual([unlinked]);
  });
  it('空图、孤立人物与多条关系都能得到不重叠的有限位置', () => {
    expect(layoutCharacters([], [])).toEqual({});
    const notes = characters(), graph = buildCharacterGraph([...notes, newCharacterRelation('a', 'b', '同伴'), newCharacterRelation('b', 'a', '竞争')]);
    const positions = layoutCharacters(graph.characters, graph.relations);
    expect(Object.keys(positions)).toHaveLength(3);
    for (const position of Object.values(positions)) { expect(Number.isFinite(position.x)).toBe(true); expect(Number.isFinite(position.y)).toBe(true); }
    expect(new Set(Object.values(positions).map(position => JSON.stringify(position))).size).toBe(3);
  });
  it('SQLite 工作区序列化保留关系与节点位置，旧项目保持兼容', () => {
    const state = emptyWorkspace(), project = newProject('测试', 'long'); state.projects.push(project);
    const notes = characters(); notes[0].graphPosition = { x: -42, y: 185.5 };
    project.notes = [...notes, newCharacterRelation('a', 'b', '同伴')];
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.projects[0].notes).toEqual(project.notes);
    expect(parseWorkspace(JSON.stringify({ ...state, projects: [{ ...project, notes: characters() }] })).projects[0].notes).toEqual(characters());
  });
  it('环状关系保持紧凑布局，不沿关系方向延伸成长链', () => {
    const notes = Array.from({ length: 12 }, (_, index) => character(String(index), `人物${index}`));
    const graph = buildCharacterGraph([...notes, ...notes.map((note, index) => newCharacterRelation(note.id, notes[(index + 1) % notes.length].id, '同伴'))]);
    const positions = Object.values(layoutCharacters(graph.characters, graph.relations));
    expect(Math.max(...positions.map(point => point.x)) - Math.min(...positions.map(point => point.x))).toBeLessThan(1000);
    expect(Math.max(...positions.map(point => point.y)) - Math.min(...positions.map(point => point.y))).toBeLessThan(500);
  });
  it('添加人物时保留手动布局，并把新增节点放到未被占用的位置', () => {
    const notes = characters(); notes[0].graphPosition = { x: 32, y: 32 };
    const positions = characterPositions(notes, { a: { x: 900, y: 900 }, b: { x: 32, y: 32 }, c: { x: 32, y: 32 } });
    expect(positions.a).toEqual({ x: 32, y: 32 });
    expect(positions.b.y).toBeGreaterThan(positions.a.y + 92); expect(positions.c.y).toBeGreaterThan(positions.b.y + 92);
  });
  it('人物改名前保存档案和旧文本中的关系，改名与后续编辑不会丢失或重复连线', () => {
    const notes = characters(); notes[0].body = '人物关系：沈青是导师';
    const legacy: Note = { ...newCharacterRelation('', '', '同伴', '许宁与沈青共同调查'), relation: undefined };
    const retained = retainCharacterRelations([...notes, legacy], 'c');
    retained.find(note => note.id === 'c')!.title = '沈远';
    const graph = buildCharacterGraph(retained);
    expect(graph.relations).toHaveLength(2); expect(graph.unlinked).toHaveLength(0);
    expect(retained.find(note => note.id === legacy.id)?.relation).toEqual({ sourceId: 'b', targetId: 'c' });
    expect(retainCharacterRelations(retained, 'c')).toHaveLength(retained.length);
  });
});

describe('AI 生成关系采用与上下文', () => {
  it('先保存人物再关联关系，不合并不同双方的同名关系，并让写作获得双方姓名', () => {
    const state = emptyWorkspace(), project = newProject('测试', 'long'); project.genre = '悬疑'; state.projects.push(project);
    const job = createJob(project, 'prepare', { ...newAISelection(), ...defaultAdvanced() }, undefined, ''); job.preparationBase = preparationSnapshot(project);
    job.steps[0].output = JSON.stringify({ theme: '', audience: '', synopsis: '', outline: '', notes: [
      { kind: 'relation', title: '同伴', body: '共同调查', source: '林舟', target: '许宁' },
      ...characters().map(note => ({ kind: note.kind, title: note.title, body: note.body })),
      { kind: 'relation', title: '同伴', body: '保存证据', source: '许宁', target: '沈青' },
      { kind: 'relation', title: '同伴', body: '重复', source: '许宁', target: '林舟' },
      { kind: 'relation', title: '未知', body: '林舟和许宁', source: '林舟', target: '未生成的人物' },
    ] });
    acceptPreparation(state, job, job.steps[0]);
    const graph = buildCharacterGraph(project.notes);
    expect(graph.characters).toHaveLength(3); expect(graph.relations).toHaveLength(2); expect(graph.unlinked).toHaveLength(1);
    expect(graph.unlinked[0].body).toContain('未生成的人物');
    const prompt = buildPrompt(state, job, job.steps[0], job.ai!);
    expect(prompt.user).toContain('关系双方：林舟、许宁'); expect(prompt.user).toContain('关系双方：许宁、沈青');
  });
  it('仅调整人物图位置不阻止采用，编辑人物设定仍会阻止采用', () => {
    const state = emptyWorkspace(), project = newProject('测试', 'long'); state.projects.push(project); project.notes = characters();
    const job = createJob(project, 'prepare', { ...newAISelection(), ...defaultAdvanced() }, undefined, ''); job.preparationBase = preparationSnapshot(project);
    job.steps[0].output = '{"theme":"主题","audience":"","synopsis":"","outline":"","notes":[]}';
    project.notes[0].graphPosition = { x: 100, y: 200 };
    expect(() => acceptPreparation(state, job, job.steps[0])).not.toThrow();
    job.preparationBase = preparationSnapshot(project); project.notes[0].body = '新动机';
    expect(() => acceptPreparation(state, job, job.steps[0])).toThrow('已更新');
  });
});
