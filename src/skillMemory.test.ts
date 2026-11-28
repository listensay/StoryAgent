import { describe, expect, it } from 'vitest';
import { createJob, emptyWorkspace, newChapter, newProject, parseWorkspace } from './domain';
import { makeManualSkill, newManualDraft } from './manualSkill';
import { archiveSkill, captureJobPins, executionSkills, setProjectPin, skillDefinition } from './skillVersions';
import { confirmRevisionRules, revisionSkillId, revisionSources, type RevisionBase } from './revisionFeedback';
import { affectedChapters, authorPayoff, authorPlant, memoryCatalog, memoryContext, sourceRange, storeMemory } from './memory';
import { contentHash } from './memoryData';

const manual = () => makeManualSkill({ ...newManualDraft(), name: '短句规则', description: '适合动作场景', rules: '多用动作推动情节。' }, []);

describe('manual Skills and version pins', () => {
  it('validates author input and keeps task pins independent of future library and project edits', () => {
    const skill = manual(), project = newProject('小说', 'long');
    expect(() => makeManualSkill({ ...newManualDraft(), name: '短句规则', description: '用途', rules: '规则' }, [skill])).toThrow('同名');
    setProjectPin(project, skill.id, skillDefinition(skill));
    const job = createJob(project, 'draft', null, project.chapters[0].id, ''); captureJobPins(job, project);
    skill.revisions = archiveSkill(skill); skill.files[0].content = '后续版本'; skill.version = '2.0';
    setProjectPin(project, skill.id, skillDefinition(skill));
    expect(executionSkills([skill], job, project)[0].files[0].content).toContain('多用动作');
    expect(executionSkills([], job, project)[0].version).toBe('1.0');
    expect(skill.revisions[0].files[0].content).toContain('多用动作');
  });
  it('does not retroactively pin jobs launched without a project pin', () => {
    const skill = manual(), project = newProject('小说', 'long'); project.skillIds.push(skill.id);
    const job = createJob(project, 'draft', null, project.chapters[0].id, ''); captureJobPins(job, project);
    setProjectPin(project, skill.id, skillDefinition(skill)); skill.files[0].content = '最新规则';
    expect(executionSkills([skill], job, project)[0].files[0].content).toBe('最新规则');
  });
  it('persists an explicitly confirmed revision Skill and rejects stale author text', () => {
    const state = emptyWorkspace(), project = newProject('修稿小说', 'long'), chapter = project.chapters[0]; state.projects.push(project);
    chapter.content = '作者修订'; chapter.versions.push({ id: 'v1', label: '初稿', content: '原稿', createdAt: project.createdAt });
    const base: RevisionBase = { projectId: project.id, chapterId: chapter.id, manuscript: chapter.content, source: revisionSources(project.id, chapter, [])[0], targetId: revisionSkillId(project), selected: false };
    chapter.content = '又修改了';
    expect(() => confirmRevisionRules(state, base, '少用形容词')).toThrow('正文已变更');
    chapter.content = base.manuscript;
    confirmRevisionRules(state, base, '用动作呈现人物反应。');
    const restored = parseWorkspace(JSON.stringify(state));
    expect(restored.projects[0].skillPins?.[0].files[0].content).toContain('用动作呈现人物反应');
    expect(restored.skills.find(skill => skill.id === base.targetId)?.source).toBe('修稿提炼');
  });
});

describe('cross-chapter evidence', () => {
  function book() {
    const project = newProject('线索', 'long');
    const first = project.chapters[0]; first.content = '他把铜钥匙藏进衣袋。';
    const second = newChapter('第二章'); second.content = '铜钥匙打开了地下室。'; project.chapters.push(second);
    return { project, first, second };
  }
  it('links only verified quotations from earlier chapters and preserves their history', () => {
    const { project, first, second } = book();
    storeMemory(project, first, { summary: '', notes: [{ kind: 'foreshadow', phase: 'plant', title: '铜钥匙', body: '藏起钥匙', quote: first.content }] });
    const from = project.memorySources![0];
    storeMemory(project, second, { summary: '', notes: [{ kind: 'foreshadow', phase: 'payoff', title: '打开地下室', body: '钥匙的用途', quote: second.content, links: [{ sourceId: from.id, kind: 'payoff', reason: '钥匙再次出现并打开门' }] }] });
    expect(project.memoryLinks).toHaveLength(1);
    expect(affectedChapters(memoryCatalog(project), first.id)).toHaveLength(1);
    first.content = '钥匙已被销毁。';
    expect(sourceRange(from, first)).toBeUndefined();
    expect(memoryContext(project, second.id, 5000, second.content)).not.toContain(from.id);
    storeMemory(project, first, { summary: '', notes: [] });
    expect(project.memorySources!.find(s => s.id === from.id)?.retired).toBe(true);
    expect(project.memoryLinks).toHaveLength(1);
  });
  it('does not create links for fabricated or ambiguous quotations', () => {
    const { project, first, second } = book(); first.content += first.content;
    storeMemory(project, first, { summary: '', notes: [{ kind: 'fact', title: '钥匙', body: '模糊依据', quote: '他把铜钥匙藏进衣袋。' }] });
    const source = project.memorySources![0]; expect(source.evidence).toBeUndefined();
    storeMemory(project, second, { summary: '', notes: [{ kind: 'fact', title: '开门', body: '', quote: '模型编造的原文', links: [{ sourceId: source.id, kind: 'continuity', reason: '推断' }] }] });
    expect(project.memoryLinks).toHaveLength(0);
  });
  it('accepts explicit plant/payoff evidence and rejects stale spans', () => {
    const { project, first, second } = book();
    authorPlant(project, first.id, { start: 0, end: first.content.length }, first.content, '铜钥匙');
    const from = project.memorySources![0];
    expect(() => authorPayoff(project, from.id, first.id, { start: 0, end: first.content.length }, first.content)).toThrow('之后');
    authorPayoff(project, from.id, second.id, { start: 0, end: second.content.length }, second.content);
    expect(project.memoryLinks![0].origin).toBe('author');
    const quote = second.content; second.content = '变化后的正文';
    expect(() => authorPayoff(project, from.id, second.id, { start: 0, end: quote.length }, quote)).toThrow('已变动');
    expect(from.hash).toBe(contentHash(first.content));
  });
});
