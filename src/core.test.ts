import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { acceptedChapter, createJob, emptyWorkspace, importChapters, newChapter, newAISelection, defaultAdvanced, newProject, normalizeAISelection, parseWorkspace, resolveAI, snapshot, validateAI, validateProvider, wordCount, type Provider } from './domain';
import { buildPrompt, numberedText, prepareAnalysis, sourceChunks, synthesisSteps } from './prompts';
import { expandFiles, mergeSkills, parseSkills } from './skills';
import { apiBase, getModels, requestBody, StreamParser } from './ai';
import { parseMemory } from './useWorkspace';
vi.mock('./platform', async importOriginal => ({ ...await importOriginal<typeof import('./platform')>(), http: vi.fn() }));
import { http } from './platform';
const provider = (protocol: Provider['protocol'] = 'chat'): Provider => ({ id: 'test', name: 'Test', protocol, baseUrl: 'http://localhost:1421/v1', hasKey: false, models: ['mock-model'], enabled: true, maxRetries: 10, advanced: defaultAdvanced() });
const config = () => ({ ...newAISelection(), ...defaultAdvanced(), providerId: 'test', model: 'mock-model' });
const skillText = '---\nname: novel-write\ndescription: Write stories\nversion: 1\n---\nFollow the author instructions.';

describe('novel data and safe changes', () => {
  it('imports Chinese and Markdown chapters, counts mixed text', () => {
    const chapters = importChapters('\uFEFF第一章 相遇\r\n初次见面。\r\n\r\n## 第二章\n第二天。');
    expect(chapters.map(c => c.title)).toEqual(['第一章 相遇', '第二章']);
    expect(chapters[1].content).toBe('第二天。'); expect(wordCount('你好 world 123')).toBe(4);
  });
  it('does not share mutable builtin resources between workspaces', () => { const a = emptyWorkspace(), b = emptyWorkspace(); a.skills[0].files[0].content = 'changed'; expect(b.skills[0].files[0].content).not.toBe('changed'); });
  it('hydrates interrupted jobs as paused and rejects incompatible backups', () => {
    const s = emptyWorkspace(); s.jobs.push(createJob(undefined, 'scan', null, [], '')); s.jobs[0].steps[0].status = 'running';
    const loaded = parseWorkspace(JSON.stringify(s)); expect(loaded.jobs[0].status).toBe('paused'); expect(loaded.jobs[0].steps[0].status).toBe('pending');
    expect(() => parseWorkspace('{"schemaVersion":99}')).toThrow();
  });
  it('replaces only the selected span and preserves a recovery version', () => {
    const p = newProject('测试', 'long'); p.chapters[0].content = '甲走进房间。乙抬头。';
    const job = createJob(p, 'rewrite', config(), [p.chapters[0].id], '', '', '', { start: 0, end: 6 }); const step = job.steps[0]; step.output = '甲推开门。';
    const updated = acceptedChapter(p.chapters[0], job, step); expect(updated.content).toBe('甲推开门。乙抬头。'); expect(updated.versions[0].content).toBe(step.baseContent);
    expect(() => acceptedChapter({ ...p.chapters[0], content: 'new text' }, job, step)).toThrow('正文已更新');
  });
  it('appends continuation and retains at most 100 distinct revisions', () => {
    const p = newProject('测试', 'short'); p.chapters[0].content = '原文'; const job = createJob(p, 'continue', config(), [p.chapters[0].id], ''); job.steps[0].output = '新文';
    expect(acceptedChapter(p.chapters[0], job, job.steps[0]).content).toBe('原文\n\n新文');
    let c = newChapter(); for (let i = 0; i < 105; i++) c = snapshot({ ...c, content: `version${i}` }, 'edit'); expect(c.versions).toHaveLength(100);
  });
  it('validates memory before accepting it as confirmed facts', () => { expect(parseMemory('```json\n{"summary":"摘要","notes":[{"kind":"fact","title":"姓名","body":"张三"}]}\n```').notes[0].kind).toBe('fact'); expect(() => parseMemory('{"summary":"摘要","notes":[{"kind":"world"}]}')).toThrow(); });
});
describe('provider models and per-task AI configuration', () => {
  it('migrates legacy presets and retains each historical task configuration', () => {
    const first = { ...config(), id: 'first', name: '写作', tasks: ['draft'], maxTokens: 4096 };
    const second = { ...config(), id: 'second', name: '研究', tasks: ['analyze'], model: 'manual-model', maxTokens: 16384, contextChars: 128000, reasoning: 'effort', effort: 'high' };
    const oldProvider = { ...provider(), models: ['mock-model', ' mock-model ', 'listed-model'], advanced: undefined };
    const oldJob = { ...createJob(undefined, 'scan', null, [], ''), ai: undefined, profileId: second.id };
    const legacy = { ...emptyWorkspace(), schemaVersion: 1, providers: [oldProvider], profiles: [first, second], jobs: [oldJob, { ...oldJob, id: 'missing-profile', profileId: 'removed' }] };
    const migrated = parseWorkspace(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.providers[0].models).toEqual(['mock-model', 'listed-model', 'manual-model']);
    expect(migrated.providers[0].advanced.maxTokens).toBe(4096);
    expect(migrated.jobs[0].ai).toMatchObject({ model: 'manual-model', maxTokens: 16384, contextChars: 128000, effort: 'high' });
    expect(migrated.jobs[1].ai).toBeNull();
    expect(migrated).not.toHaveProperty('profiles');
    expect(migrated.jobs[0]).not.toHaveProperty('profileId');
    expect(parseWorkspace(JSON.stringify(migrated))).toEqual(migrated);
  });
  it('loads legacy providers without presets so their models can be configured', () => {
    const legacy = { ...emptyWorkspace(), schemaVersion: 1, profiles: [], providers: [{ ...provider(), models: [], advanced: undefined }] };
    const migrated = parseWorkspace(JSON.stringify(legacy));
    expect(migrated.providers[0].advanced).toEqual(defaultAdvanced());
    expect(() => validateProvider(migrated.providers[0])).toThrow('至少选择一个模型');
  });
  it('requires an explicitly selected configured model from an enabled provider', () => {
    const p = provider();
    expect(() => resolveAI(newAISelection(), [p])).toThrow('供应商');
    expect(() => resolveAI(config(), [])).toThrow('供应商');
    expect(() => resolveAI(config(), [{ ...p, enabled: false }])).toThrow('供应商');
    expect(() => resolveAI({ ...config(), model: 'unconfigured' }, [p])).toThrow('已配置的模型');
  });
  it('combines provider advanced settings with task reasoning and keeps a snapshot', () => {
    const p = provider(); p.advanced = { ...defaultAdvanced(), maxTokens: 16384, contextChars: 96000, sampling: true, temperature: 0.5, extra: '{"top_p":0.9}' };
    const selection = { ...newAISelection(), providerId: p.id, model: p.models[0], effort: 'high' as const };
    const resolved = resolveAI(selection, [p]);
    const job = createJob(undefined, 'scan', resolved, [], '');
    p.advanced.maxTokens = 2048; resolved.effort = 'low';
    expect(job.ai).toMatchObject({ maxTokens: 16384, contextChars: 96000, effort: 'high' });
    expect(requestBody(p, job.ai!, '', '').body).toMatchObject({ model: 'mock-model', max_completion_tokens: 16384, reasoning_effort: 'high', top_p: 0.9 });
    expect(requestBody(p, job.ai!, '', '').body).not.toHaveProperty('temperature');
  });
  it('validates provider advanced parameters and prevents nested reasoning overrides', () => {
    expect(() => validateProvider({ ...provider(), models: [] })).toThrow('至少选择一个模型');
    expect(() => validateProvider({ ...provider(), advanced: { ...defaultAdvanced(), maxTokens: 0 } })).toThrow('输出');
    expect(() => validateProvider({ ...provider(), advanced: { ...defaultAdvanced(), extra: '[]' } })).toThrow('JSON 对象');
    expect(() => validateProvider({ ...provider('gemini'), advanced: { ...defaultAdvanced(), extra: '{"generationConfig":{"thinkingConfig":{}}}' } })).toThrow('覆盖 thinkingConfig');
    expect(() => validateAI({ ...config(), effort: 'xhigh' }, provider('gemini'))).toThrow('推理强度');
  });
  it('maps a single effort level to each protocol, preserving unrelated output settings', () => {
    const high = { ...config(), effort: 'high' as const, sampling: true };
    expect(requestBody(provider('responses'), high, '', '').body.reasoning).toEqual({ effort: 'high' });
    const anthropic = requestBody(provider('anthropic'), { ...high, extra: '{"output_config":{"format":{"type":"json_schema"}}}' }, '', '').body;
    expect(anthropic.thinking).toEqual({ type: 'adaptive' });
    expect(anthropic.output_config).toEqual({ format: { type: 'json_schema' }, effort: 'high' });
    expect(anthropic).not.toHaveProperty('temperature');
    expect(() => validateAI({ ...high, extra: '{"output_config":{"effort":"low"}}' }, provider('anthropic'))).toThrow('覆盖推理强度');
    expect(requestBody(provider('gemini'), high, '', '', true).body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: true } });
  });
  it('leaves reasoning to the model by default, including tasks that display analysis', () => {
    const useDefault = { ...config(), sampling: true };
    expect(requestBody(provider('chat'), useDefault, '', '', true).body).toMatchObject({ temperature: 0.8, max_tokens: 8192 });
    expect(requestBody(provider('chat'), useDefault, '', '', true).body).not.toHaveProperty('reasoning_effort');
    expect(requestBody(provider('responses'), useDefault, '', '', true).body).not.toHaveProperty('reasoning');
    const anthropic = requestBody(provider('anthropic'), useDefault, '', '', true).body;
    expect(anthropic).not.toHaveProperty('thinking'); expect(anthropic).not.toHaveProperty('output_config');
    expect(requestBody(provider('gemini'), useDefault, '', '', true).body.generationConfig).not.toHaveProperty('thinkingConfig');
  });
});
describe('shared AI selection', () => {
  it.each(['effort', 'budget', 'adaptive', 'off'] as const)('migrates the old %s mode in preferences and task snapshots', reasoning => {
    const state = emptyWorkspace(); state.providers = [provider()];
    const legacy = { providerId: 'test', model: 'mock-model', reasoning, effort: 'high', budget: 4096 };
    const job = createJob(undefined, 'scan', config(), [], '');
    const restored = parseWorkspace(JSON.stringify({ ...state, aiSelection: legacy, jobs: [{ ...job, ai: { ...job.ai, ...legacy } }] }));
    const expected = { providerId: 'test', model: 'mock-model', effort: reasoning === 'effort' ? 'high' : 'default' };
    expect(restored.aiSelection).toEqual(expected);
    expect(restored.jobs[0].ai).toEqual({ ...defaultAdvanced(), ...expected });
    restored.aiSelection.effort = 'low';
    expect(parseWorkspace(JSON.stringify(restored))).toEqual(restored);
    expect(resolveAI(restored.aiSelection, restored.providers).effort).toBe('low');
    expect(restored.jobs[0].ai?.effort).toBe(expected.effort);
  });
  it('restores the newest available selection when an older workspace has no shared preference', () => {
    const state = emptyWorkspace(); state.providers = [provider()];
    const older = { ...createJob(undefined, 'scan', config(), [], ''), createdAt: '2026-10-01T00:00:00Z' };
    const recent = { ...createJob(undefined, 'review', { ...config(), effort: 'high' }, [], ''), createdAt: '2026-11-01T00:00:00Z' };
    const unavailable = { ...createJob(undefined, 'scan', { ...config(), providerId: 'removed' }, [], ''), createdAt: '2026-11-02T00:00:00Z' };
    state.jobs = [older, unavailable, recent];
    const restored = parseWorkspace(JSON.stringify({ ...state, aiSelection: undefined }));
    expect(restored.aiSelection).toEqual({ ...newAISelection(), providerId: 'test', model: 'mock-model', effort: 'high' });
    expect(restored.aiSelection).not.toHaveProperty('maxTokens');
  });
  it('retains a legacy preset selection even before the first task', () => {
    const legacy = { ...emptyWorkspace(), aiSelection: undefined, schemaVersion: 1, providers: [{ ...provider(), models: [] }], profiles: [{ ...config(), reasoning: 'effort', effort: 'high', id: 'old', name: '写作', tasks: ['draft'] }] };
    expect(parseWorkspace(JSON.stringify(legacy)).aiSelection).toMatchObject({ providerId: 'test', model: 'mock-model', effort: 'high' });
  });
  it('keeps an explicit incomplete choice instead of restoring a past task on restart', () => {
    const state = emptyWorkspace(); state.providers = [provider()]; state.jobs = [createJob(undefined, 'scan', config(), [], '')];
    state.aiSelection = { ...newAISelection(), providerId: 'test', effort: 'high' };
    expect(parseWorkspace(JSON.stringify(state)).aiSelection).toEqual(state.aiSelection);
  });
  it('clears unavailable providers or models without choosing a different model', () => {
    const selection = { ...newAISelection(), providerId: 'test', model: 'mock-model', effort: 'high' as const };
    expect(normalizeAISelection(selection, [])).toEqual({ ...selection, providerId: '', model: '' });
    expect(normalizeAISelection(selection, [{ ...provider(), enabled: false }])).toEqual({ ...selection, providerId: '', model: '' });
    expect(normalizeAISelection(selection, [{ ...provider(), models: ['replacement'] }])).toEqual({ ...selection, model: '' });
    expect(selection.model).toBe('mock-model');
  });
  it('retains compatible reasoning and adjusts only unsupported settings after a protocol change', () => {
    const selection = { ...newAISelection(), providerId: 'test', model: 'mock-model', effort: 'xhigh' as const };
    expect(normalizeAISelection(selection, [provider('responses')])).toEqual(selection);
    expect(normalizeAISelection(selection, [provider('gemini')])).toEqual({ ...selection, effort: 'high' });
    expect(normalizeAISelection(selection, [provider('anthropic')])).toEqual({ ...selection, effort: 'high' });
  });
  it('gives separate workspaces independent preferences', () => {
    const a = emptyWorkspace(), b = emptyWorkspace();
    a.aiSelection.effort = 'high';
    expect(b.aiSelection).toEqual(newAISelection());
  });
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
    const state = emptyWorkspace(), profile = config(); state.skills = parseSkills([
      { path: 'write/SKILL.md', content: skillText + '\n修改正文时阅读 `references/revision.md`。' },
      ...Array.from({ length: 4 }, (_, i) => ({ path: `write/references/other-${i}.md`, content: '无关资源'.repeat(200) })),
      { path: 'write/references/revision.md', content: '修订必须保留人物已经知道的事实。' },
    ], 'file');
    const project = newProject('修订', 'long'); project.chapters[0].content = '正文'; state.projects.push(project);
    const job = createJob(project, 'rewrite', profile, [project.chapters[0].id], '保持事实');
    expect(buildPrompt(state, job, job.steps[0], profile).system).toContain('修订必须保留人物已经知道的事实');
  });
});
describe('protocol request and streaming', () => {
  it.each(['chat', 'responses', 'anthropic', 'gemini'] as const)('uses the %s protocol', protocol => { const request = requestBody(provider(protocol), config(), 'SYS', 'USER'); expect(request.body).toBeDefined(); expect(request.url).toMatch(protocol === 'chat' ? /chat\/completions$/ : protocol === 'responses' ? /responses$/ : protocol === 'anthropic' ? /messages$/ : /streamGenerateContent/); expect(JSON.stringify(request.body)).toContain('USER'); });
  it('sets reasoning without incompatible temperature and rejects reserved overrides', () => {
    const p = { ...config(), effort: 'medium' as const, sampling: true }; const body = requestBody(provider(), p, '', '').body; expect(body.reasoning_effort).toBe('medium'); expect(body.temperature).toBeUndefined();
    expect(() => validateAI({ ...p, extra: '{"messages":[]}' }, provider())).toThrow('覆盖');
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
    const state = emptyWorkspace(), project = newProject('改写', 'long'), p = config(); p.contextChars = 4000;
    project.chapters[0].content = '开头重要事实' + '正文'.repeat(3000) + '结尾'; state.projects.push(project);
    const job = createJob(project, 'rewrite', p, [project.chapters[0].id], '保留全部事件');
    expect(() => buildPrompt(state, job, job.steps[0], p)).toThrow('超过上下文');
    p.contextChars = 16000; const prompt = buildPrompt(state, job, job.steps[0], p);
    expect(prompt.user).toContain(project.chapters[0].content);
  });
  it('synthesizes complete segment outputs through successive layers', () => {
    const state = emptyWorkspace(), p = config(); p.contextChars = 4000;
    const job = createJob(undefined, 'analyze', p, [], '');
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
    const state = emptyWorkspace(), project = newProject('连载', 'long'), p = config(); p.contextChars = 4000;
    project.chapters.push(newChapter('第二章')); project.outline = '计划'.repeat(4000); state.projects.push(project);
    const job = createJob(project, 'draft', p, project.chapters.map(c => c.id), '');
    job.steps[0].output = '人物已前往北站。'; job.steps[0].status = 'ready';
    const prompt = buildPrompt(state, job, job.steps[1], p);
    expect(prompt.user).toContain('人物已前往北站。'); expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(4000);
  });
  it('covers all paragraphs in chunked analysis and synthesizes them', () => { const p = config(); p.contextChars = 4000; const text = Array.from({ length: 70 }, (_, i) => `第${i + 1}段 ${'文本'.repeat(50)}`).join('\n\n'); const chunks = sourceChunks(text, 1800); for (let i = 1; i <= 70; i++) expect(chunks.join('\n')).toContain(`[P${i}] `); const job = createJob(undefined, 'analyze', p, [], ''); job.sourceText = text; prepareAnalysis(job, p); expect(job.steps[job.steps.length - 1]?.aggregate).toBe(true); expect(job.steps.slice(0, -1).every(s => s.intermediate)).toBe(true); const state = emptyWorkspace(); for (const step of job.steps) { const prompt = buildPrompt(state, job, step, p); expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(p.contextChars); } expect(numberedText('一\n\n二')).toBe('[P1] 一\n\n[P2] 二'); });
  it('keeps author instruction, selection and resumed output under heavy context', () => { const state = emptyWorkspace(), project = newProject('测试', 'long'), p = config(); p.contextChars = 4000; project.outline = '大纲'.repeat(10000); project.chapters[0].content = '正文'.repeat(10000); state.projects.push(project); const job = createJob(project, 'rewrite', p, [project.chapters[0].id], '保留重要要求', '', '', { start: 0, end: 10 }); job.steps[0].output = '已生成片段'; const prompt = buildPrompt(state, job, job.steps[0], p); expect(prompt.user).toContain('保留重要要求'); expect(prompt.user).toContain('指定改写片段'); expect(prompt.user).toContain('已生成片段'); expect(prompt.system.length + prompt.user.length).toBeLessThanOrEqual(4000); });
});
