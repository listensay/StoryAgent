import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createJob, emptyWorkspace, normalizeAISelection, now, resolveAI, taskNames, uid, validateAI, type AISelection, type Job, type Note, type TaskKind, type Workspace } from './domain';
import { loadWorkspace, refreshCredentials, saveWorkspace } from './platform';
import { generate } from './ai';
import { buildPrompt, prepareAnalysis, synthesisSteps } from './prompts';
import { publishJobOutput } from './jobOutput';
import { acceptPreparation, acceptWriting, contentHash, finishAutomaticStep, needsMemory, parseMemory, parsePreparation, preparationSnapshot, prepareWriting, requirePreparation, writingStep } from './jobWorkflow';
import { applyBestSkill, finishTrainingStep, initializeTraining, parseEvaluation, recordEvaluation, skillText, trainingPrompt, validateTraining } from './training';
import { runnableJobs } from './taskQueue';
import { AIRequestQueue, runJobSteps } from './stepQueue';
import { runArticleCollection, runCollection } from './collectionTask';
export { parseMemory } from './jobWorkflow';

type Launch = { kind: TaskKind; projectId?: string; chapterIds?: string[]; instruction?: string; styleId?: string; sourceId?: string; sourceText?: string; sourceTitle?: string; selection?: { start: number; end: number }; training?: Job['training'] };
export function useWorkspace() {
  const [state, setState] = useState<Workspace>(emptyWorkspace);
  const stateRef = useRef(state);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('加载中');
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [messageId, setMessageId] = useState(0);
  const controllers = useRef(new Map<string, AbortController>());
  const [requests] = useState(() => new AIRequestQueue(id => stateRef.current.providers.find(p => p.id === id)?.concurrency ?? 2));
  const generation = useRef(0);
  const [queueTick, setQueueTick] = useState(0);
  const mounted = useRef(true);
  const notify = useCallback((text: string) => { setMessage(text); setMessageId(n => n + 1); }, []);
  const update = useCallback((mutation: (draft: Workspace) => void) => {
    const next = structuredClone(stateRef.current);
    mutation(next);
    for (const project of next.projects) {
      const previous = stateRef.current.projects.find(p => p.id === project.id);
      for (const chapter of project.chapters) if (previous?.chapters.find(c => c.id === chapter.id)?.content !== chapter.content && chapter.memoryHash !== contentHash(chapter.content)) {
        chapter.summary = ''; chapter.memoryHash = undefined;
        project.notes = project.notes.filter(n => n.chapterId !== chapter.id || !['fact', 'state', 'timeline', 'foreshadow', 'knowledge'].includes(n.kind));
      }
    }
    next.aiSelection = normalizeAISelection(next.aiSelection, next.providers); next.updatedAt = now(); stateRef.current = next; setState(next); setSaveStatus('保存中');
  }, []);
  const setAISelection = useCallback((selection: AISelection) => update(s => { s.aiSelection = { ...selection }; }), [update]);
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
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 6000); return () => clearTimeout(timer); }, [message, messageId]);

  const runJob = useCallback(async (id: string) => {
    if (controllers.current.has(id)) return;
    const controller = new AbortController(); controllers.current.set(id, controller);
    const epoch = generation.current;
    const commit = (mutation: (draft: Workspace) => void) => { if (generation.current === epoch) update(mutation); };
    update(s => { const job = s.jobs.find(j => j.id === id); if (job) { job.status = 'running'; job.error = ''; } });
    try {
      const initial = stateRef.current.jobs.find(j => j.id === id);
      if (initial?.collectionTask || initial?.articleTask) {
        await (initial.articleTask ? runArticleCollection : runCollection)(initial, controller.signal, () => stateRef.current, commit);
        controller.signal.throwIfAborted();
        commit(s => { const job = s.jobs.find(j => j.id === id); if (job) { job.status = 'accepted'; job.steps.forEach(p => { p.status = 'accepted'; }); } });
        return;
      }
      const result = await runJobSteps(
        () => stateRef.current.jobs.find(j => j.id === id),
        () => stateRef.current.providers.find(p => p.id === stateRef.current.jobs.find(j => j.id === id)?.ai?.providerId)?.concurrency ?? 2,
        controller.signal,
        async (stepId, signal) => {
          const current = stateRef.current;
          const job = current.jobs.find(j => j.id === id); if (!job) return;
          const step = job.steps.find(s => s.id === stepId); if (!step) return;
          const config = job.ai;
          if (!config) throw new Error('请设置本次任务的 AI');
          const provider = current.providers.find(p => p.id === config.providerId);
          validateAI(config, provider);
          const synthesis = synthesisSteps(job, step, config);
          if (synthesis.length) {
            commit(s => { const item = s.jobs.find(j => j.id === id); if (item) { const index = item.steps.findIndex(p => p.id === step.id); item.steps.splice(index, 1, ...synthesis); } });
            return;
          }
          if (job.training?.judge === 'human' && step.stage === 'train-judge') {
            commit(s => { const item = s.jobs.find(j => j.id === id); if (item) item.status = 'waiting'; });
            return 'waiting';
          }
          await requests.run(config.providerId, signal, async () => {
            const effectiveKind = (step.stage && ['plan', 'draft', 'continue', 'rewrite', 'summary', 'memory'].includes(step.stage) ? step.stage : job.kind) as TaskKind;
            const baseOutput = ['memory', 'prepare', 'train', 'style'].includes(effectiveKind) ? '' : step.output;
            const prompt = job.training ? trainingPrompt(job, step) : buildPrompt(current, { ...job, kind: effectiveKind }, { ...writingStep(job, step), output: baseOutput }, config);
            if (prompt.system.length + prompt.user.length > config.contextChars) throw new Error('任务材料超过上下文上限，请调整 AI 上下文或缩小样本');
            let output = baseOutput, last = 0;
            const publish = () => {
              if (!mounted.current || generation.current !== epoch) return;
              const next = publishJobOutput(stateRef.current, id, step.id, output);
              if (next === stateRef.current) return;
              stateRef.current = next; setState(next); setSaveStatus('保存中');
            };
            commit(s => { const part = s.jobs.find(j => j.id === id)?.steps.find(p => p.id === step.id); if (part) part.status = 'running'; });
            try {
              const result = await generate(provider!, config, prompt.system, prompt.user, signal, text => { output = baseOutput + text; if (!text || Date.now() - last > 80) { last = Date.now(); publish(); } });
              signal.throwIfAborted();
              output = baseOutput + result;
              if (!output.trim()) throw new Error('生成结果为空');
              if (effectiveKind === 'memory') parseMemory(output);
              if (effectiveKind === 'prepare' && !step.intermediate) parsePreparation(output);
              if (step.stage === 'train-judge') parseEvaluation(output, job.training!.cases.length);
              commit(s => {
                const item = s.jobs.find(j => j.id === id), part = item?.steps.find(p => p.id === step.id);
                if (item && part) {
                  part.output = output; part.status = 'ready';
                  if (item.training) finishTrainingStep(item, part);
                  else finishAutomaticStep(s, item, part);
                }
              });
            } catch (error) { publish(); throw error; }
          });
        },
      );
      if (result === 'waiting') return;
      commit(s => { const job = s.jobs.find(j => j.id === id); if (job) { if (job.training) applyBestSkill(s, job); job.status = job.steps.filter(p => !p.intermediate).every(p => p.status === 'accepted') ? 'accepted' : 'ready'; } });
    } catch (error) {
      const paused = controller.signal.aborted;
      commit(s => { const job = s.jobs.find(j => j.id === id); if (job) { job.status = paused ? 'paused' : 'failed'; job.error = paused ? '' : error instanceof Error ? error.message : String(error); job.steps.forEach(step => { if (step.status === 'running') step.status = 'pending'; }); } });
    } finally { if (controllers.current.get(id) === controller) controllers.current.delete(id); setQueueTick(t => t + 1); }
  }, [update, requests]);
  const launch = useCallback((options: Launch): string => {
    const current = stateRef.current;
    if ((options.instruction?.length ?? 0) > 8000) throw new Error('任务要求超过 8000 字符');
    const project = current.projects.find(p => p.id === options.projectId);
    const config = resolveAI(current.aiSelection, current.providers);
    if (options.chapterIds?.length && (!project || options.chapterIds.some(id => !project.chapters.some(c => c.id === id)))) throw new Error('章节已移除');
    const job = createJob(project, options.kind, config, options.chapterIds ?? [], options.instruction ?? '', options.styleId, options.sourceId, options.selection);
    const source = current.references.find(r => r.id === options.sourceId);
    job.sourceText = options.sourceText ?? source?.content ?? ''; job.sourceTitle = options.sourceTitle ?? source?.title ?? project?.title ?? '';
    if (['analyze', 'scan', 'style'].includes(job.kind) && !job.sourceText && !job.steps.some(s => s.baseContent.trim())) throw new Error('暂无可分析的正文');
    if (['memory', 'review'].includes(job.kind) && !job.steps.some(s => s.baseContent.trim())) throw new Error('请先添加小说正文');
    if (['prepare', 'draft', 'continue', 'rewrite', 'plan'].includes(job.kind)) requirePreparation(project);
    if (job.kind === 'prepare' && project) {
      job.preparationBase = preparationSnapshot(project);
      job.sourceText = current.references.filter(r => project.referenceIds.includes(r.id)).map(r => `${r.title}\n${r.content}`).join('\n\n');
    }
    job.skillIds = [...(project?.skillIds ?? [])];
    if (job.kind === 'train') {
      if (!options.training) throw new Error('请选择 Skill 和评分原文');
      const skill = current.skills.find(s => s.id === options.training!.skillId);
      if (!skill) throw new Error('Skill 已移除');
      if (current.jobs.some(j => j.training?.skillId === skill.id && ['queued', 'running', 'waiting', 'paused'].includes(j.status))) throw new Error('该 Skill 已有未完成的训练任务');
      job.training = structuredClone(options.training);
      job.training.initialSkill = skillText(skill); job.training.bestSkill = job.training.initialSkill;
      job.training = validateTraining(job.training);
      job.sourceText = ''; // Originals are isolated from writers; scenario generation, evaluation and revision use explicit prompts.
      initializeTraining(job);
    } else { prepareAnalysis(job, config); prepareWriting(job); }
    job.status = 'queued';
    update(s => { s.jobs.unshift(job); }); notify('任务已添加'); return job.id;
  }, [notify, update]);
  const memoryKey = JSON.stringify([state.aiSelection, state.providers.map(p => [p.id, p.enabled, p.models]), state.projects.map(p => [p.id, p.chapters.map(c => [c.id, contentHash(c.content), c.memoryHash])]), state.jobs.filter(j => ['draft', 'continue', 'rewrite'].includes(j.kind) && ['running', 'queued'].includes(j.status)).map(j => j.id)]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      const current = stateRef.current;
      try { resolveAI(current.aiSelection, current.providers); } catch { return; }
      for (const project of current.projects) {
        const ids = project.chapters.filter(chapter => needsMemory(stateRef.current, project, chapter)).map(c => c.id);
        if (ids.length) launch({ kind: 'memory', projectId: project.id, chapterIds: ids });
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [memoryKey, loaded, launch]);
  useEffect(() => {
    if (!loaded) return;
    for (const id of runnableJobs(stateRef.current.jobs, stateRef.current.providers, new Set(controllers.current.keys()))) void runJob(id);
  }, [state, loaded, runJob, queueTick]);
  const collect = useCallback((options: Omit<NonNullable<Job['collectionTask']>, 'referenceId' | 'done' | 'total'>) => {
    const current = stateRef.current;
    const existing = current.jobs.find(j => j.collectionTask?.bookUrl === options.bookUrl && j.collectionTask.scope === options.scope && j.collectionTask.chapterId === options.chapterId && ['queued', 'running'].includes(j.status));
    if (existing) return existing.id;
    const referenceId = current.references.find(r => r.bookUrl === options.bookUrl && r.collection)?.id ?? current.jobs.find(j => j.collectionTask?.bookUrl === options.bookUrl && ['queued', 'running', 'paused', 'failed'].includes(j.status))?.collectionTask?.referenceId ?? uid();
    const job = createJob(undefined, 'collect', null, [], '', '', referenceId);
    job.collectionTask = { ...structuredClone(options), referenceId, done: 0, total: 0 };
    job.sourceTitle = options.title; job.status = 'queued';
    update(s => { s.jobs.unshift(job); }); notify('任务已添加'); return job.id;
  }, [notify, update]);
  const collectArticles = useCallback((options: Omit<NonNullable<Job['articleTask']>, 'referenceId' | 'done' | 'total'>, title = '文章采集') => {
    const referenceId = uid();
    const job = createJob(undefined, 'collect', null, [], '', '', referenceId);
    job.articleTask = { ...structuredClone(options), referenceId, done: 0, total: options.mode === 'chapter' ? 1 : options.links.length };
    job.sourceTitle = title; job.status = 'queued';
    update(s => s.jobs.unshift(job)); notify('任务已添加'); return job.id;
  }, [notify, update]);
  const scoreTraining = useCallback((id: string, scores: number[], feedback: string) => {
    try {
      update(s => {
        const job = s.jobs.find(j => j.id === id);
        if (!job?.training || job.status !== 'waiting') throw new Error('当前任务无需评分');
        const part = job.steps.find(p => p.stage === 'train-judge' && p.status === 'pending');
        if (!part) throw new Error('评分步骤不存在');
        const evaluation = parseEvaluation(JSON.stringify({ scores, feedback: feedback.trim() || '依据用户评分改进通用叙事与表达。', decision: 'auto' }), job.training.cases.length);
        part.output = JSON.stringify(evaluation); recordEvaluation(job, part, evaluation, 'human'); job.status = 'queued';
      });
      notify('评分已保存');
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [notify, update]);
  const resumeJob = useCallback((id: string, restart = false) => {
    if (controllers.current.has(id)) return;
    try {
      const current = stateRef.current;
      const job = current.jobs.find(j => j.id === id);
      if (!job || !['paused', 'failed'].includes(job.status)) return;
      const config = job.collectionTask || job.articleTask ? null : resolveAI(current.aiSelection, current.providers);
      update(s => {
        const item = s.jobs.find(j => j.id === id)!;
        item.ai = config; item.status = 'queued'; item.error = '';
        if (restart) item.steps.forEach(step => { if (step.status === 'pending') step.output = ''; });
        if (config && item.kind === 'prepare') prepareAnalysis(item, config);
      });

    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [notify, update]);
  const stop = useCallback((id: string) => {
    const active = controllers.current.get(id);
    if (active) active.abort();
    else update(s => { const job = s.jobs.find(j => j.id === id); if (job && job.status === 'queued') job.status = 'paused'; });
  }, [update]);
  const accept = useCallback((jobId: string, stepId: string) => {
    try {
      update(s => {
        const job = s.jobs.find(j => j.id === jobId); const step = job?.steps.find(p => p.id === stepId);
        if (!job || !step || step.status !== 'ready' || step.intermediate) throw new Error('结果尚未完成');
        const project = s.projects.find(p => p.id === job.projectId);
        const chapter = project?.chapters.find(c => c.id === step.chapterId);
        if (['draft', 'continue', 'rewrite'].includes(job.kind)) {
          acceptWriting(s, job, step);
        } else if (job.kind === 'prepare') {
          acceptPreparation(s, job, step);
        } else if (job.kind === 'plan') {
          if (!project) throw new Error('小说已移除');
          if (chapter) { if (chapter.plan !== step.basePlan) throw new Error('细纲已更新，请手动合并'); chapter.plan = step.output; }
          else { if (project.outline !== step.basePlan) throw new Error('总纲已更新，请手动合并'); project.outline = step.output; }
        } else if (job.kind === 'memory') {
          if (!project || !chapter) throw new Error('小说或章节已移除');
          if (chapter.content !== step.baseContent) throw new Error('正文已更新，请重新提取记忆');
          finishAutomaticStep(s, job, step);
        } else if (job.kind === 'style') {
          finishAutomaticStep(s, job, step);
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
  return { state, stateRef, loaded, saveStatus, loadError, message, messageId, notify, update, setAISelection, launch, collect, collectArticles, scoreTraining, stop, resumeJob, accept, replace };
}
export type Store = ReturnType<typeof useWorkspace>;
export type { Job };
