import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { acceptedChapter, createJob, emptyWorkspace, importChapters, newChapter, newProfile, newProject, parseWorkspace, snapshot, validateProfile, wordCount, type Provider } from './domain';
import { buildPrompt, numberedText, prepareAnalysis, sourceChunks, synthesisSteps } from './prompts';
import { expandFiles, mergeSkills, parseSkills } from './skills';
import { apiBase, getModels, requestBody, StreamParser } from './ai';
import { parseMemory } from './useWorkspace';
vi.mock('./platform', () => ({ http: vi.fn() }));
import { http } from './platform';
const provider = (protocol: Provider['protocol'] = 'chat'): Provider => ({ id: 'test', name: 'Test', protocol, baseUrl: 'http://localhost:1421/v1', hasKey: false, models: [], enabled: true });
const preset = () => ({ ...newProfile('test'), model: 'mock-model' });
const skillText = '---\nname: novel-write\ndescription: Write stories\nversion: 1\n---\nFollow the author instructions.';

describe('novel data and safe changes', () => {
  it('imports Chinese and Markdown chapters, counts mixed text', () => {
    const chapters = importChapters('\uFEFF第一章 相遇\r\n初次见面。\r\n\r\n## 第二章\n第二天。');
    expect(chapters.map(c => c.title)).toEqual(['第一章 相遇', '第二章']);
    expect(chapters[1].content).toBe('第二天。'); expect(wordCount('你好 world 123')).toBe(4);
  });
  it('does not share mutable builtin resources between workspaces', () => { const a = emptyWorkspace(), b = emptyWorkspace(); a.skills[0].files[0].content = 'changed'; expect(b.skills[0].files[0].content).not.toBe('changed'); });
  it('hydrates interrupted jobs as paused and rejects incompatible backups', () => {
    const s = emptyWorkspace(); s.jobs.push(createJob(undefined, 'scan', 'p', [], '')); s.jobs[0].steps[0].status = 'running';
    const loaded = parseWorkspace(JSON.stringify(s)); expect(loaded.jobs[0].status).toBe('paused'); expect(loaded.jobs[0].steps[0].status).toBe('pending');
    expect(() => parseWorkspace('{"schemaVersion":99}')).toThrow();
  });
  it('replaces only the selected span and preserves a recovery version', () => {
    const p = newProject('测试', 'long'); p.chapters[0].content = '甲走进房间。乙抬头。';
    const job = createJob(p, 'rewrite', 'p', [p.chapters[0].id], '', '', '', { start: 0, end: 6 }); const step = job.steps[0]; step.output = '甲推开门。';
    const updated = acceptedChapter(p.chapters[0], job, step); expect(updated.content).toBe('甲推开门。乙抬头。'); expect(updated.versions[0].content).toBe(step.baseContent);
    expect(() => acceptedChapter({ ...p.chapters[0], content: 'new text' }, job, step)).toThrow('正文已更新');
  });
  it('appends continuation and retains at most 100 distinct revisions', () => {
    const p = newProject('测试', 'short'); p.chapters[0].content = '原文'; const job = createJob(p, 'continue', 'p', [p.chapters[0].id], ''); job.steps[0].output = '新文';
    expect(acceptedChapter(p.chapters[0], job, job.steps[0]).content).toBe('原文\n\n新文');
    let c = newChapter(); for (let i = 0; i < 105; i++) c = snapshot({ ...c, content: `version${i}` }, 'edit'); expect(c.versions).toHaveLength(100);
  });
  it('validates memory before accepting it as confirmed facts', () => { expect(parseMemory('```json\n{"summary":"摘要","notes":[{"kind":"fact","title":"姓名","body":"张三"}]}\n```').notes[0].kind).toBe('fact'); expect(() => parseMemory('{"summary":"摘要","notes":[{"kind":"world"}]}')).toThrow(); });
});
describe('Skill import and history', () => {
  it('retains files from ZIP with metadata and text resources', () => {
    const zip = zipSync({ 'repo/skills/write/SKILL.md': strToU8(skillText), 'repo/skills/write/references/story.md': strToU8('resource'), 'repo/skills/write/tools/script.py': strToU8('print("data")') });
    const skills = parseSkills(expandFiles([{ name: 'test.zip', bytes: zip }]), 'test'); expect(skills[0].tasks).toContain('draft'); expect(skills[0].files.map(f => f.path)).toContain('tools/script.py');
    const merged = mergeSkills(skills, parseSkills(expandFiles([{ name: 'test.zip', bytes: zip }]), 'test', 'v2')); expect(merged).toHaveLength(1); expect(merged[0].id).toBe(skills[0].id); expect(merged[0].revisions).toHaveLength(1);
  });
  it('rejects traversal and invalid metadata', () => { expect(() => expandFiles([{ name: '../SKILL.md', bytes: strToU8(skillText) }])).toThrow('文件路径'); expect(() => parseSkills([{ path: 'SKILL.md', content: 'hello' }], 'file')).toThrow('元数据'); });
  it('retains transitive shared references when importing a GitHub subdirectory', () => {
    const skills = parseSkills([
      { path: 'skills/write/SKILL.md', content: skillText + '\n阅读 [写作方法](../_shared/craft.md)。' },
      { path: 'skills/_shared/craft.md', content: '参考 `rules.json`。' },
      { path: 'skills/_shared/rules.json', content: '{"rule":"保持因果"}' },
      { path: 'skills/review/SKILL.md', content: skillText.replace('novel-write', 'novel-review') },
    ], 'github', 'v1', 'skills/write');
    expect(skills).toHaveLength(1);
    expect(skills[0].files.map(f => f.path)).toEqual(['SKILL.md', '../_shared/craft.md', '../_shared/rules.json']);
  });
  it('prioritizes task references beyond the first three resource files', () => {
    const state = emptyWorkspace(), profile = preset(); state.skills = parseSkills([
      { path: 'write/SKILL.md', content: skillText + '\n修改正文时阅读 `references/revision.md`。' },
      ...Array.from({ length: 4 }, (_, i) => ({ path: `write/references/other-${i}.md`, content: '无关资源'.repeat(200) })),
      { path: 'write/references/revision.md', content: '修订必须保留人物已经知道的事实。' },
    ], 'file');
    const project = newProject('修订', 'long'); project.chapters[0].content = '正文'; state.projects.push(project);
    const job = createJob(project, 'rewrite', profile.id, [project.chapters[0].id], '保持事实');
    expect(buildPrompt(state, job, job.steps[0], profile).system).toContain('修订必须保留人物已经知道的事实');
  });
});
describe('protocol request and streaming', () => {
  it.each(['chat', 'responses', 'anthropic', 'gemini'] as const)('uses the %s protocol', protocol => { const request = requestBody(provider(protocol), preset(), 'SYS', 'USER'); expect(request.body).toBeDefined(); expect(request.url).toMatch(protocol === 'chat' ? /chat\/completions$/ : protocol === 'responses' ? /responses$/ : protocol === 'anthropic' ? /messages$/ : /streamGenerateContent/); expect(JSON.stringify(request.body)).toContain('USER'); });
  it('sets reasoning without incompatible temperature and rejects reserved overrides', () => {
    const p = { ...preset(), reasoning: 'effort' as const, sampling: true }; const body = requestBody(provider(), p, '', '').body; expect(body.reasoning_effort).toBe('medium'); expect(body.temperature).toBeUndefined();
    expect(() => validateProfile({ ...p, extra: '{"messages":[]}' }, provider())).toThrow('覆盖'); expect(() => validateProfile({ ...p, reasoning: 'budget', budget: p.maxTokens }, provider('anthropic'))).toThrow('预算');
    expect(apiBase({ ...provider(), baseUrl: 'http://localhost/v1/chat/completions/' })).toBe('http://localhost/v1');
  });
  it('lists paginated Gemini models and filters embedding models', async () => { vi.mocked(http).mockResolvedValueOnce({ status: 200, bytes: new Uint8Array(), text: JSON.stringify({ models: [{ name: 'models/chat', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'two' }) }).mockResolvedValueOnce({ status: 200, bytes: new Uint8Array(), text: JSON.stringify({ models: [{ name: 'models/chat2' }] }) }); expect(await getModels(provider('gemini'))).toEqual(['chat', 'chat2']); expect(vi.mocked(http).mock.calls[1]?.[0].url).toContain('pageToken=two'); });
  it('handles every possible SSE boundary including CRLF', () => {
    const raw = 'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"，世界"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
    for (let i = 1; i < raw.length; i++) { const parser = new StreamParser(() => {}); parser.feed(raw.slice(0, i)); parser.feed(raw.slice(i)); expect(parser.finish(raw)).toBe('你好，世界'); }
  });
  it('handles Responses, Anthropic and Gemini and excludes thinking text', () => {
    const events = [{ type: 'response.output_text.delta', delta: 'A' }, { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'B' } }, { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'C' }] }, finishReason: 'STOP' }] }];
    const parser = new StreamParser(() => {}); events.forEach(e => parser.feed(`data: ${JSON.stringify(e)}\n\n`)); expect(parser.finish('')).toBe('ABC');
  });
  it('detects abrupt disconnects, output limits and provider errors', () => { const broken = new StreamParser(() => {}); broken.feed('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); expect(() => broken.finish('')).toThrow('中断'); const limit = new StreamParser(() => {}); expect(limit.finish('{"choices":[{"message":{"content":"partial"},"finish_reason":"length"}]}')).toBe('partial'); expect(limit.truncated).toBe(true); const error = new StreamParser(() => {}); error.feed('data: {"error":{"message":"invalid key"}}\n\n'); expect(() => error.finish('')).toThrow('invalid key'); });
});
describe('long context and source citations', () => {
  it('requires full manuscript for whole-chapter rewrite', () => {
    const state = emptyWorkspace(), project = newProject('改写', 'long'), p = preset(); p.contextChars = 4000;
    project.chapters[0].content = '开头重要事实' + '正文'.repeat(3000) + '结尾'; state.projects.push(project);
    const job = createJob(project, 'rewrite', p.id, [project.chapters[0].id], '保留全部事件');
    expect(() => buildPrompt(state, job, job.steps[0], p)).toThrow('超过上下文');
    p.contextChars = 16000; const prompt = buildPrompt(state, job, job.steps[0], p);
    expect(prompt.user).toContain(project.chapters[0].content);
  });
  it('synthesizes complete segment outputs through successive layers', () => {
    const state = emptyWorkspace(), p = preset(); p.contextChars = 4000;
    const job = createJob(undefined, 'analyze', p.id, [], '');
    job.sourceText = Array.from({ length: 100 }, (_, i) => `段落${i + 1} ${'内容'.repeat(70)}`).join('\n\n');
    prepareAnalysis(job, p);
    const parts = job.steps.filter(s => s.intermediate);
    parts.forEach((s, i) => { s.status = 'ready'; s.output = '论证'.repeat(250) + `[P${i + 1}]尾部证据`; });
    const seen = new Set<string>();
    for (let iterations = 0; iterations < 100; iterations++) {
      const step = job.steps.find(s => s.status === 'pending'); if (!step) break;
      const extra = synthesisSteps(job, step, p);
      if (extra.length) { job.steps.splice(job.steps.indexOf(step), 1, ...extra); continue; }
      const prompt = buildPrompt(state, job, step, p);
      expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(p.contextChars);
      for (const part of parts) if (prompt.user.includes(part.output)) seen.add(part.id);
      step.output = '汇总结论 ' + (step.inputIds ?? []).join(','); step.status = 'ready';
    }
    expect(seen.size).toBe(parts.length); expect(job.steps[job.steps.length - 1]?.status).toBe('ready');
  });
  it('includes previous unaccepted batch output for chapter continuity', () => {
    const state = emptyWorkspace(), project = newProject('连载', 'long'), p = preset(); p.contextChars = 4000;
    project.chapters.push(newChapter('第二章')); project.outline = '计划'.repeat(4000); state.projects.push(project);
    const job = createJob(project, 'draft', p.id, project.chapters.map(c => c.id), '');
    job.steps[0].output = '人物已前往北站。'; job.steps[0].status = 'ready';
    const prompt = buildPrompt(state, job, job.steps[1], p);
    expect(prompt.user).toContain('人物已前往北站。'); expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(4000);
  });
  it('covers all paragraphs in chunked analysis and synthesizes them', () => { const p = preset(); p.contextChars = 4000; const text = Array.from({ length: 70 }, (_, i) => `第${i + 1}段 ${'文本'.repeat(50)}`).join('\n\n'); const chunks = sourceChunks(text, 1800); for (let i = 1; i <= 70; i++) expect(chunks.join('\n')).toContain(`[P${i}] `); const job = createJob(undefined, 'analyze', p.id, [], ''); job.sourceText = text; prepareAnalysis(job, p); expect(job.steps[job.steps.length - 1]?.aggregate).toBe(true); expect(job.steps.slice(0, -1).every(s => s.intermediate)).toBe(true); const state = emptyWorkspace(); for (const step of job.steps) { const prompt = buildPrompt(state, job, step, p); expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(p.contextChars); } expect(numberedText('一\n\n二')).toBe('[P1] 一\n\n[P2] 二'); });
  it('keeps author instruction, selection and resumed output under heavy context', () => { const state = emptyWorkspace(), project = newProject('测试', 'long'), p = preset(); p.contextChars = 4000; project.outline = '大纲'.repeat(10000); project.chapters[0].content = '正文'.repeat(10000); state.projects.push(project); const job = createJob(project, 'rewrite', p.id, [project.chapters[0].id], '保留重要要求', '', '', { start: 0, end: 10 }); job.steps[0].output = '已生成片段'; const prompt = buildPrompt(state, job, job.steps[0], p); expect(prompt.user).toContain('保留重要要求'); expect(prompt.user).toContain('指定改写片段'); expect(prompt.user).toContain('已生成片段'); expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(4000); });
});
