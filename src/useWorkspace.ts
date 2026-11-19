import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { z } from 'zod';
import { acceptedChapter, createJob, emptyWorkspace, now, profileFor, taskNames, uid, validateProfile, type Job, type Note, type TaskKind, type Workspace } from './domain';
import { loadWorkspace, refreshCredentials, saveWorkspace } from './platform';
import { generate } from './ai';
import { buildPrompt, prepareAnalysis, synthesisSteps } from './prompts';

const memorySchema = z.object({ summary: z.string(), notes: z.array(z.object({ kind: z.enum(['fact', 'state', 'timeline', 'foreshadow', 'knowledge']), title: z.string(), body: z.string() })) });
export function parseMemory(text: string) { return memorySchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))); }
type Launch = { kind: TaskKind; projectId?: string; chapterIds?: string[]; instruction?: string; profileId?: string; styleId?: string; sourceId?: string; sourceText?: string; selection?: { start: number; end: number } };
export function useWorkspace() {
  const [state, setState] = useState<Workspace>(emptyWorkspace);
  const stateRef = useRef(state);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('加载中');
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const controllers = useRef(new Map<string, AbortController>());
  const generation = useRef(0);
  const mounted = useRef(true);
  const notify = useCallback((text: string) => setMessage(text), []);
  const update = useCallback((mutation: (draft: Workspace) => void) => {
    const next = structuredClone(stateRef.current);
    mutation(next); next.updatedAt = now(); stateRef.current = next; setState(next); setSaveStatus('保存中');
  }, []);
  useEffect(() => {
    let alive = true; mounted.current = true;
    loadWorkspace().then(data => { if (!alive) return; stateRef.current = data; setState(data); setLoaded(true); setSaveStatus('已保存'); }).catch(e => { if (alive) { setLoadError(`项目数据加载失败：${String(e)}`); setSaveStatus('加载失败'); } });
    return () => { alive = false; mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => { const pending = stateRef.current; void saveWorkspace(pending).then(() => { if (stateRef.current === pending) setSaveStatus('已保存'); }).catch(e => { setSaveStatus('保存失败'); notify(String(e)); }); }, 400);
    return () => clearTimeout(timer);
  }, [state, loaded, notify]);
  useEffect(() => {
    if (!loaded) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    const listeners: (() => void)[] = [];
    const retain = (unlisten: () => void) => { if (disposed) unlisten(); else listeners.push(unlisten); };
    void appWindow.onCloseRequested(async event => {
      event.preventDefault();
      try { await saveWorkspace(stateRef.current); controllers.current.forEach(c => c.abort()); await appWindow.destroy(); }
      catch (e) { notify(`保存失败：${String(e)}`); }
    }).then(retain).catch(e => notify(String(e)));
    void appWindow.onFocusChanged(event => {
      if (!event.payload) void saveWorkspace(stateRef.current).catch(e => { setSaveStatus('保存失败'); notify(String(e)); });
    }).then(retain).catch(e => notify(String(e)));
    return () => { disposed = true; listeners.forEach(unlisten => unlisten()); };
  }, [loaded, notify]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 6000); return () => clearTimeout(timer); }, [message]);

  const runJob = useCallback(async (id: string) => {
    if (controllers.current.has(id)) return;
    const controller = new AbortController(); controllers.current.set(id, controller);
    const epoch = generation.current;
    const commit = (mutation: (draft: Workspace) => void) => { if (generation.current === epoch) update(mutation); };
    update(s => { const job = s.jobs.find(j => j.id === id); if (job) { job.status = 'running'; job.error = ''; } });
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const current = stateRef.current;
        const job = current.jobs.find(j => j.id === id); if (!job) break;
        const step = job.steps.find(s => ['pending', 'running'].includes(s.status)); if (!step) break;
        const profile = current.profiles.find(p => p.id === job.profileId);
        if (!profile) throw new Error('模型预设已移除');
        const provider = current.providers.find(p => p.id === profile.providerId);
        validateProfile(profile, provider);
        const synthesis = synthesisSteps(job, step, profile);
        if (synthesis.length) {
          commit(s => { const item = s.jobs.find(j => j.id === id); if (item) { const index = item.steps.findIndex(p => p.id === step.id); item.steps.splice(index, 1, ...synthesis); } });
          continue;
        }
        const baseOutput = job.kind === 'memory' ? '' : step.output;
        const prompt = buildPrompt(current, job, { ...step, output: baseOutput }, profile);
        let output = baseOutput, last = 0;
        const publish = () => { if (!mounted.current) return; commit(s => { const part = s.jobs.find(j => j.id === id)?.steps.find(p => p.id === step.id); if (part) { part.output = output; part.status = 'running'; } }); };
        commit(s => { const part = s.jobs.find(j => j.id === id)?.steps.find(p => p.id === step.id); if (part) part.status = 'running'; });
        try {
          const result = await generate(provider!, profile, prompt.system, prompt.user, controller.signal, text => { output = baseOutput + text; if (Date.now() - last > 80) { last = Date.now(); publish(); } });
          controller.signal.throwIfAborted();
          output = baseOutput + result;
          if (job.kind === 'memory') parseMemory(output);
          commit(s => { const part = s.jobs.find(j => j.id === id)?.steps.find(p => p.id === step.id); if (part) { part.output = output; part.status = 'ready'; } });
        } catch (error) { publish(); throw error; }
      }
      commit(s => { const job = s.jobs.find(j => j.id === id); if (job) job.status = job.steps.filter(p => !p.intermediate).every(p => p.status === 'accepted') ? 'accepted' : 'ready'; });
    } catch (error) {
      const paused = controller.signal.aborted;
      commit(s => { const job = s.jobs.find(j => j.id === id); if (job) { job.status = paused ? 'paused' : 'failed'; job.error = paused ? '' : error instanceof Error ? error.message : String(error); job.steps.forEach(step => { if (step.status === 'running') step.status = 'pending'; }); } });
    } finally { if (controllers.current.get(id) === controller) controllers.current.delete(id); }
  }, [update]);
  const launch = useCallback((options: Launch): string => {
    const current = stateRef.current;
    if ((options.instruction?.length ?? 0) > 8000) throw new Error('任务要求超过 8000 字符');
    const project = current.projects.find(p => p.id === options.projectId);
    const profile = current.profiles.find(p => p.id === options.profileId) ?? profileFor(current, options.kind);
    if (!profile) throw new Error('请先添加模型预设');
    validateProfile(profile, current.providers.find(p => p.id === profile.providerId));
    if (options.chapterIds?.length && (!project || options.chapterIds.some(id => !project.chapters.some(c => c.id === id)))) throw new Error('章节已移除');
    const job = createJob(project, options.kind, profile.id, options.chapterIds ?? [], options.instruction ?? '', options.styleId, options.sourceId, options.selection);
    const source = current.references.find(r => r.id === options.sourceId);
    job.sourceText = options.sourceText ?? source?.content ?? ''; job.sourceTitle = source?.title ?? '';
    if (['analyze', 'scan', 'style'].includes(job.kind) && !job.sourceText && !job.steps.some(s => s.baseContent.trim())) throw new Error('请先添加参考文本');
    if (['memory', 'review'].includes(job.kind) && !job.steps.some(s => s.baseContent.trim())) throw new Error('请先添加小说正文');
    prepareAnalysis(job, profile);
    update(s => { s.jobs.unshift(job); }); void runJob(job.id); return job.id;
  }, [runJob, update]);
  const stop = useCallback((id: string) => controllers.current.get(id)?.abort(), []);
  const accept = useCallback((jobId: string, stepId: string) => {
    try {
      update(s => {
        const job = s.jobs.find(j => j.id === jobId); const step = job?.steps.find(p => p.id === stepId);
        if (!job || !step || step.status !== 'ready' || step.intermediate) throw new Error('结果尚未完成');
        const project = s.projects.find(p => p.id === job.projectId);
        const chapter = project?.chapters.find(c => c.id === step.chapterId);
        if (['draft', 'continue', 'rewrite'].includes(job.kind)) {
          if (!project || !chapter) throw new Error('小说或章节已移除');
          project.chapters = project.chapters.map(c => c.id === chapter.id ? acceptedChapter(c, job, step) : c);
        } else if (job.kind === 'plan') {
          if (!project) throw new Error('小说已移除');
          if (chapter) { if (chapter.plan !== step.basePlan) throw new Error('细纲已更新，请手动合并'); chapter.plan = step.output; }
          else { if (project.outline !== step.basePlan) throw new Error('总纲已更新，请手动合并'); project.outline = step.output; }
        } else if (job.kind === 'memory') {
          if (!project || !chapter) throw new Error('小说或章节已移除');
          if (chapter.content !== step.baseContent) throw new Error('正文已更新，请重新提取记忆');
          const memory = parseMemory(step.output); chapter.summary = memory.summary;
          project.notes.push(...memory.notes.map(n => ({ ...n, id: uid(), status: 'confirmed' as const, chapterId: chapter.id })));
        } else if (job.kind === 'style') {
          s.styles.unshift({ id: uid(), name: job.sourceTitle ? `${job.sourceTitle} · 风格` : `${project?.title ?? '文本'} · 风格`, content: step.output, source: job.sourceTitle || chapter?.title || '', createdAt: now() });
        } else if (project) {
          const note: Note = { id: uid(), kind: 'reference', title: `${taskNames[job.kind]} · ${step.title}`, body: step.output, status: 'reference', chapterId: step.chapterId };
          project.notes.push(note);
        } else {
          s.references.unshift({ id: uid(), title: `${taskNames[job.kind]} · ${job.sourceTitle}`, source: job.sourceId, kind: 'text', content: step.output, createdAt: now() });
        }
        if (project) project.updatedAt = now();
        step.status = 'accepted';
        if (step.aggregate) job.steps.filter(p => p.intermediate && p.chapterId === step.chapterId).forEach(p => { p.status = 'accepted'; });
        job.status = job.steps.filter(p => !p.intermediate).every(p => p.status === 'accepted') ? 'accepted' : job.status;
      });
      notify('已采用');
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [notify, update]);
  const replace = useCallback(async (workspace: Workspace) => {
    await refreshCredentials(workspace);
    generation.current++; controllers.current.forEach(c => c.abort()); controllers.current.clear();
    stateRef.current = workspace; setState(workspace); setLoaded(true); setLoadError(''); setSaveStatus('保存中');
    await saveWorkspace(workspace); if (stateRef.current === workspace) setSaveStatus('已保存');
  }, []);
  return { state, stateRef, loaded, saveStatus, loadError, message, notify, update, launch, stop, runJob, accept, replace };
}
export type Store = ReturnType<typeof useWorkspace>;
export type { Job };
