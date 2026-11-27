import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createJob, emptyWorkspace, normalizeAISelection, now, resolveAI, taskNames, uid, validateAI, type AISelection, type Job, type Note, type Skill, type TaskKind, type TrainingAnnotation, type TrainingScore, type Workspace } from './domain';
import { normalizeImageSelection } from './coverData';
import { hasActiveRequests, loadWorkspace, refreshCredentials, saveWorkspace } from './platform';
import { generate } from './ai';
import { buildPrompt, prepareAnalysis, prepareSkillExtraction, synthesisSteps } from './prompts';
import { generateSkillComposition, generateSkillResearch, skillSnapshot } from './skillExtraction';
import { selectSkillResources } from './skillResources';
import { createWritingSkillTools } from './writingSkillTools';
import { publishJobOutput } from './jobOutput';
import { writingExecutionSummary } from './writingActivity';
import { acceptPreparation, acceptWriting, contentHash, finishAutomaticStep, needsMemory, parseMemory, parsePreparation, preparationSnapshot, prepareWriting, requirePreparation, requireIdleWriting, writingStep } from './jobWorkflow';
import { applyBestSkill, continueTraining as continueTrainingJob, discardTrainingFeedback, finishTrainingStep, generateTrainingRevision, initializeTraining, recordEvaluation, scenarioTraining, skillText, startTrainingFeedback, trainingPrompt, trainingResourceSelection, validateTraining } from './training';
import { isFinishedTask, runnableJobs } from './taskQueue';
import { AIRequestQueue, runJobSteps } from './stepQueue';
import { runArticleCollection, runCollection } from './collectionTask';
import { createCreationRound, creationContextKey, finishCreationRound, newCreationDraft, parseCreationOptions, projectFromCreation, selectCreationOption, selectedCreationOption, setCreationDirection } from './novelCreation';
import { type CreationStage } from './novelCreationData';
import { acceptPlanning, hasPlanningChanges, parsePlanningResult, planningSnapshot } from './planning';
import { acceptNovel, applyNovelResult, hasNovelChanges, novelBefore, novelSnapshot, parseNovelResult, recoverNovelJobs, undoNovel } from './novelAssistant';
import { applySelectionPolish, selectionPolishPrompt, type PolishSelection } from './selectionPolish';
export { parseMemory } from './jobWorkflow';

type Launch = { kind: TaskKind; projectId?: string; chapterId?: string; instruction?: string; targetWords?: number; styleId?: string; sourceId?: string; sourceText?: string; sourceTitle?: string; selection?: { start: number; end: number }; training?: Job['training']; planningChat?: boolean; skillTarget?: Job['skillTarget'] };
export function useWorkspace() {
  const [state, setState] = useState<Workspace>(emptyWorkspace);
  const stateRef = useRef(state);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('加载中');
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [messageId, setMessageId] = useState(0);
  const controllers = useRef(new Map<string, AbortController>());
  const savingChapters = useRef(new Set<string>());
  const [polishingChapters, setPolishingChapters] = useState<string[]>([]);
  const [requests] = useState(() => new AIRequestQueue(id => stateRef.current.providers.find(p => p.id === id)?.concurrency ?? 2));
  const generation = useRef(0);
  const [queueTick, setQueueTick] = useState(0);
  const mounted = useRef(true);
  const restarting = useRef(false);
  const notify = useCallback((text: string) => { setMessage(text); setMessageId(n => n + 1); }, []);
  const update = useCallback((mutation: (draft: Workspace) => void) => {
    const next = structuredClone(stateRef.current);
    mutation(next);
    // A retry or continued training is new activity, even when it reuses the same job ID.
    for (const job of next.jobs) if (job.hiddenFromTaskList && !isFinishedTask(job)) delete job.hiddenFromTaskList;
    for (const project of next.projects) {
      const previous = stateRef.current.projects.find(p => p.id === project.id);
      for (const chapter of project.chapters) if (previous?.chapters.find(c => c.id === chapter.id)?.content !== chapter.content && chapter.memoryHash !== contentHash(chapter.content)) {
        chapter.summary = ''; chapter.memoryHash = undefined;
        project.notes = project.notes.filter(n => n.chapterId !== chapter.id || !['fact', 'state', 'timeline', 'foreshadow', 'knowledge'].includes(n.kind));
      }
    }
    next.aiSelection = normalizeAISelection(next.aiSelection, next.providers); next.imageSelection = normalizeImageSelection(next.imageSelection, next.imageProviders); next.updatedAt = now(); stateRef.current = next; setState(next); setSaveStatus('保存中');
  }, []);
  const setAISelection = useCallback((selection: AISelection) => update(s => { s.aiSelection = { ...selection }; }), [update]);
  useEffect(() => {
    let alive = true; mounted.current = true;
    loadWorkspace().then(data => { if (!alive) return; recoverNovelJobs(data); stateRef.current = data; setState(data); setLoaded(true); setSaveStatus('已保存'); }).catch(e => { if (alive) { setLoadError(`项目数据加载失败：${String(e)}`); setSaveStatus('加载失败'); } });
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
      if (restarting.current) return;
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
          if (job.training && step.stage === 'train-judge') {
            commit(s => { const item = s.jobs.find(j => j.id === id); if (item) item.status = 'waiting'; });
            return 'waiting';
          }
          const config = job.ai;
          if (!config) throw new Error('请设置本次任务的 AI');
          const provider = current.providers.find(p => p.id === config.providerId);
          validateAI(config, provider);
          const synthesis = synthesisSteps(job, step, config);
          if (synthesis.length) {
            commit(s => { const item = s.jobs.find(j => j.id === id); if (item) { const index = item.steps.findIndex(p => p.id === step.id); item.steps.splice(index, 1, ...synthesis); } });
            return;
          }
          await requests.run(config.providerId, signal, async () => {
            const effectiveKind = (step.stage && ['plan', 'draft', 'continue', 'rewrite', 'summary', 'memory'].includes(step.stage) ? step.stage : job.kind) as TaskKind;
            const baseOutput = job.creationTask || job.planningChat || job.novelChat || ['memory', 'prepare', 'train', 'style'].includes(effectiveKind) ? '' : step.output;
            const effectiveJob = { ...job, kind: effectiveKind }, effectiveStep = { ...writingStep(job, step), output: baseOutput };
            commit(s => { const part = s.jobs.find(j => j.id === id)?.steps.find(p => p.id === step.id); if (part) part.status = 'running'; });
            const writing = !job.creationTask && ['draft', 'continue', 'rewrite', 'review', 'plan'].includes(job.kind) && !!step.chapterId;
            const idleTimeoutMs = writing ? 120_000 : undefined;
            const selectionRequest = (system: string, user: string) => generate(provider!, config, system, user, signal, () => {}, undefined, idleTimeoutMs);
            let trainingResources: Skill['files'] | undefined;
            if (job.training) {
              const selection = trainingResourceSelection(job, step);
              if (selection) trainingResources = await selectSkillResources(selection.files, selection.task, selection.query, config.contextChars, signal, selectionRequest);
            }
            const prompt: { system: string; user: string; toolSkills?: Skill[] } = job.creationTask ? JSON.parse(job.sourceText) as { system: string; user: string } : job.training ? trainingPrompt(job, step, trainingResources) : buildPrompt(current, effectiveJob, effectiveStep, config);
            if (prompt.system.length + prompt.user.length > config.contextChars) throw new Error('任务材料超过上下文上限，请调整 AI 上下文或缩小样本');
            let output = baseOutput, reasoning = step.reasoning ?? '';
            let previewTimer: ReturnType<typeof setTimeout> | undefined;
            const publish = () => {
              if (!mounted.current || generation.current !== epoch) return;
              const next = publishJobOutput(stateRef.current, id, step.id, output, writing ? reasoning : undefined);
              if (next === stateRef.current) return;
              stateRef.current = next; setState(next); setSaveStatus('保存中');
            };
            // Publish the leading update and flush the latest text even if the stream goes quiet.
            const schedulePreview = () => {
              if (previewTimer !== undefined) return;
              publish();
              previewTimer = setTimeout(() => { previewTimer = undefined; publish(); }, 80);
            };
            commit(s => {
              const part = s.jobs.find(j => j.id === id)?.steps.find(p => p.id === step.id);
              if (part) {
                part.status = 'running';
                if (writing) part.execution = { summary: writingExecutionSummary(job, step), skills: [], startedAt: now() };
              }
            });
            const chosen = job.skillIds ?? current.projects.find(project => project.id === job.projectId)?.skillIds ?? [];
            const eligible = prompt.toolSkills ?? [];
            const requiredIds = eligible.filter(skill => chosen.includes(skill.id)).map(skill => skill.id);
            const makeTools = () => eligible.length ? createWritingSkillTools(eligible, (skillId, file) => {
              if (signal.aborted || !writing) return;
              commit(s => {
                const log = s.jobs.find(j => j.id === id)?.steps.find(p => p.id === step.id)?.execution?.skills;
                if (!log) return;
                let entry = log.find(item => item.id === skillId);
                if (!entry) {
                  const skill = eligible.find(item => item.id === skillId)!;
                  entry = { id: skill.id, name: skill.name, version: skill.version, automatic: !chosen.includes(skillId), files: [], contents: [] };
                  log.push(entry);
                }
                if (!entry.files.includes(file.path)) entry.files.push(file.path);
                const contents = entry.contents ??= [], index = contents.findIndex(item => item.path === file.path);
                if (index < 0) contents.push(file); else contents[index] = file;
              });
            }, requiredIds) : undefined;
            try {
              const request = (feedback = '') => generate(provider!, config, prompt.system, prompt.user + feedback, signal,
                text => { output = baseOutput + text; schedulePreview(); },
                writing ? text => { if (reasoning !== text) { reasoning = text; schedulePreview(); } } : undefined, idleTimeoutMs, makeTools());
              const result = step.stage === 'style-research' ? await generateSkillResearch(step.section, signal, request) : step.stage === 'style-compose' && job.steps.some(part => part.research) ? await generateSkillComposition(job, signal, request) : job.training && step.stage === 'train-revise' ? await generateTrainingRevision(job, signal, request) : await request();
              signal.throwIfAborted();
              output = baseOutput + result;
              if (!output.trim()) throw new Error('生成结果为空');
              const novelResult = job.novelChat ? parseNovelResult(output) : undefined;
              if (novelResult) applyNovelResult(current.projects.find(project => project.id === job.projectId)!, novelResult);
              const planningResult = job.planningChat ? parsePlanningResult(output) : undefined;
              if (effectiveKind === 'memory') parseMemory(output);
              if (effectiveKind === 'prepare' && !step.intermediate) parsePreparation(output);
              const creationOptions = job.creationTask ? parseCreationOptions(output, job.creationTask.stage) : undefined;
              commit(s => {
                const item = s.jobs.find(j => j.id === id), part = item?.steps.find(p => p.id === step.id);
                if (item && part) {
                  part.output = output; part.status = 'ready';
                  if (writing) { part.reasoning = reasoning; if (part.execution) part.execution.finishedAt = now(); }
                  if (creationOptions) finishCreationRound(s, item, creationOptions);
                  else if (novelResult && !hasNovelChanges(novelResult)) part.status = 'accepted';
                  else if (planningResult && !hasPlanningChanges(planningResult)) part.status = 'accepted';
                  else if (item.training) finishTrainingStep(item, part);
                  else finishAutomaticStep(s, item, part);
                }
              });
            } catch (error) { publish(); throw error; }
            finally { clearTimeout(previewTimer); }
          });
        },
      );
      if (result === 'waiting') return;
      commit(s => { const job = s.jobs.find(j => j.id === id); if (job) { if (job.training) applyBestSkill(s, job); job.status = job.steps.filter(p => !p.intermediate).every(p => p.status === 'accepted') ? 'accepted' : 'ready'; } });
    } catch (error) {
      const paused = controller.signal.aborted;
      commit(s => { const job = s.jobs.find(j => j.id === id); if (job) { if (!discardTrainingFeedback(job)) job.status = paused ? 'paused' : 'failed'; job.error = paused ? '' : error instanceof Error ? error.message : String(error); job.steps.forEach(step => { if (step.status === 'running') step.status = 'pending'; }); } });
    } finally { if (controllers.current.get(id) === controller) controllers.current.delete(id); setQueueTick(t => t + 1); }
  }, [update, requests]);
  const launch = useCallback((options: Launch): string => {
    if (restarting.current) throw new Error('正在更新软件');
    const current = stateRef.current;
    const limit = options.kind === 'revise' ? 100000 : 8000;
    if ((options.instruction?.length ?? 0) > limit) throw new Error(`任务要求超过 ${limit} 字符`);
    const project = current.projects.find(p => p.id === options.projectId);
    const { chapterId } = options;
    if (options.kind === 'plan' && !options.planningChat && !chapterId) throw new Error('请先选择当前章节');
    const config = resolveAI(current.aiSelection, current.providers);
    const job = createJob(project, options.kind, config, chapterId, options.instruction ?? '', options.styleId, options.sourceId, options.selection);
    job.skillTarget = options.skillTarget;
    const source = current.references.find(r => r.id === options.sourceId);
    job.sourceText = options.sourceText ?? source?.content ?? ''; job.sourceTitle = options.sourceTitle ?? source?.title ?? project?.title ?? '';
    if (['analyze', 'scan', 'style'].includes(job.kind) && !job.sourceText && !job.steps.some(s => s.baseContent.trim())) throw new Error('暂无可分析的正文');
    if (['memory', 'review'].includes(job.kind) && !job.steps.some(s => s.baseContent.trim())) throw new Error('请先添加小说正文');
    if (['revise', 'prepare', 'draft', 'continue', 'rewrite', 'plan'].includes(job.kind)) requirePreparation(project);
    if (['draft', 'continue', 'rewrite'].includes(job.kind)) {
      const targetId = job.steps[0].chapterId;
      if (controllers.current.has(`polish:${targetId}`)) throw new Error('请等待正文润色完成');
      requireIdleWriting(current.jobs, job.projectId, [targetId]);
      if (options.targetWords !== undefined && (!Number.isInteger(options.targetWords) || options.targetWords < 100 || options.targetWords > 50000)) throw new Error('目标字数须为 100 至 50000');
      job.targetWords = options.targetWords;
    }
    if (job.kind === 'prepare' && project) {
      job.preparationBase = preparationSnapshot(project);
      job.sourceText = current.references.filter(r => project.referenceIds.includes(r.id)).map(r => `${r.title}\n${r.content}`).join('\n\n');
    }
    if (options.planningChat && job.kind === 'plan' && project && !chapterId) {
      if (current.jobs.some(value => value.projectId === project.id && value.planningChat && ['queued', 'running'].includes(value.status))) throw new Error('请等待回复完成');
      job.planningChat = { base: planningSnapshot(project), previousJobIds: current.jobs.filter(value => value.projectId === project.id && value.planningChat && ['ready', 'accepted'].includes(value.status)).reverse().map(value => value.id) };
      buildPrompt(current, job, job.steps[0], config);
    }
    job.skillIds = [...(project?.skillIds ?? [])];
    if (job.kind === 'revise' && project) {
      if (chapterId) throw new Error('小说 AI 按整本小说调整');
      if (current.jobs.some(value => value.projectId === project.id && value.novelChat && ['queued', 'running'].includes(value.status))) throw new Error('请等待回复完成');
      job.novelChat = { base: novelSnapshot(project), before: novelBefore(project), previousJobIds: current.jobs.filter(value => value.projectId === project.id && value.novelChat && ['ready', 'accepted'].includes(value.status)).slice(0, 6).reverse().map(value => value.id) };
      buildPrompt(current, job, job.steps[0], config);
    }
    if (job.kind === 'train') {
      if (!options.training) throw new Error('请选择 Skill 和原文章节');
      const training = options.training.mode === 'scenario' ? scenarioTraining(current, options.training.parentJobId ?? '') : options.training;
      const skill = current.skills.find(s => s.id === training.skillId);
      if (!skill) throw new Error('Skill 已移除');
      if (current.jobs.some(j => j.training?.skillId === skill.id && ['queued', 'running', 'waiting', 'paused'].includes(j.status))) throw new Error('该 Skill 已有未完成的训练任务');
      job.training = structuredClone(training);
      job.training.initialSkill = skillText(skill); job.training.bestSkill = job.training.initialSkill;
      if (skill.resourceMode === 'relevant') job.training.resourceFiles = structuredClone(skill.files.filter(file => !/(^|\/)SKILL\.md$/i.test(file.path)));
      job.training = validateTraining(job.training);
      job.sourceText = ''; // References are explicitly supplied only to brief generation and Skill revision.
      initializeTraining(job);
    } else {
      if (job.kind === 'style') prepareSkillExtraction(job, config);
      else prepareAnalysis(job, config);
      prepareWriting(job);
      if (['draft', 'continue', 'rewrite'].includes(job.kind)) {
        for (const step of job.steps.filter(step => ['plan', 'draft', 'continue', 'rewrite'].includes(step.stage ?? ''))) {
          const writingJob = { ...job, kind: step.stage as TaskKind }, target = writingStep(job, step);
          buildPrompt(current, writingJob, target, config);
        }
      }
    }
    job.status = 'queued';
    update(s => { s.jobs.unshift(job); }); notify('任务已添加'); return job.id;
  }, [notify, update]);
  const polishChapter = useCallback(async (projectId: string, chapterId: string, selected: PolishSelection) => {
    if (restarting.current) throw new Error('正在更新软件');
    const key = `polish:${chapterId}`;
    if (controllers.current.has(key)) throw new Error('请等待正文润色完成');
    const current = stateRef.current;
    requireIdleWriting(current.jobs, projectId, [chapterId]);
    const chapter = current.projects.find(p => p.id === projectId)?.chapters.find(c => c.id === chapterId);
    const config = resolveAI(current.aiSelection, current.providers);
    const provider = current.providers.find(p => p.id === config.providerId)!;
    const prompt = selectionPolishPrompt(chapter, selected, config.contextChars);
    const controller = new AbortController(), epoch = generation.current;
    controllers.current.set(key, controller);
    setPolishingChapters(ids => [...ids, chapterId]);
    try {
      const output = await requests.run(provider.id, controller.signal, () => generate(provider, config, prompt.system, prompt.user, controller.signal, () => {}));
      controller.signal.throwIfAborted();
      if (generation.current !== epoch) return;
      update(s => {
        const project = s.projects.find(p => p.id === projectId);
        const index = project?.chapters.findIndex(c => c.id === chapterId) ?? -1;
        if (!project || index < 0) throw new Error('章节已移除');
        project.chapters[index] = applySelectionPolish(project.chapters[index], selected, output);
        project.updatedAt = now();
      });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (controllers.current.get(key) === controller) {
        controllers.current.delete(key);
        setPolishingChapters(ids => ids.filter(id => id !== chapterId));
      }
    }
  }, [requests, update]);
  const cancelPolish = useCallback((chapterId: string) => { controllers.current.get(`polish:${chapterId}`)?.abort(); }, []);
  const saveChapter = useCallback(async (projectId: string, chapterId: string) => {
    const key = `${projectId}:${chapterId}`;
    if (savingChapters.current.has(key)) return;
    const current = stateRef.current;
    const chapter = current.projects.find(project => project.id === projectId)?.chapters.find(chapter => chapter.id === chapterId);
    if (!chapter) { notify('章节已移除'); return; }
    if (restarting.current) { notify('正在更新软件'); return; }
    savingChapters.current.add(key);
    setSaveStatus('保存中');
    try {
      await saveWorkspace(current);
      if (stateRef.current === current) setSaveStatus('已保存');
      const latest = stateRef.current;
      const project = latest.projects.find(project => project.id === projectId);
      const savedChapter = project?.chapters.find(chapter => chapter.id === chapterId);
      if (!project || !savedChapter || savedChapter.content !== chapter.content || !needsMemory(latest, project, savedChapter)) { notify('已保存'); return; }
      try { launch({ kind: 'memory', projectId, chapterId }); }
      catch (error) { notify(`正文已保存，记忆提取失败：${error instanceof Error ? error.message : String(error)}`); }
    } catch (error) { setSaveStatus('保存失败'); notify(`保存失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { savingChapters.current.delete(key); }
  }, [launch, notify]);
  const reextractSkill = useCallback((id: string) => {
    try {
      const current = stateRef.current;
      const source = current.jobs.find(job => job.id === id && job.kind === 'style');
      if (!source) throw new Error('研究任务已移除');
      const skill = current.skills.find(skill => skill.extractionJobId === id || skill.id === (source.skillTarget?.id ?? `extracted-${id}`));
      if (skill && current.jobs.some(job => job.skillTarget?.id === skill.id && ['queued', 'running', 'paused'].includes(job.status))) throw new Error('该 Skill 已有未完成的提取任务');
      const sourceText = source.sourceText || [...new Set(source.steps.map(step => step.baseContent).filter(text => text.trim()))].join('\n\n');
      if (!sourceText.trim()) throw new Error('研究原文已移除');
      launch({ kind: 'style', sourceId: source.sourceId, sourceText, sourceTitle: source.sourceTitle, skillTarget: skill ? { id: skill.id, snapshot: skillSnapshot(skill) } : undefined });
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [launch, notify]);
  const requireIdleCreation = (current: Workspace) => {
    if (current.creationDraft && current.jobs.some(job => job.creationTask?.draftId === current.creationDraft!.id && ['queued', 'running'].includes(job.status))) throw new Error('请等待生成完成或停止生成');
  };
  const startNovelCreation = useCallback((genre: string, idea: string) => {
    const current = stateRef.current; requireIdleCreation(current);
    if (current.creationDraft && current.creationDraft.stage !== 'genre') throw new Error('已有新建小说草稿');
    const draft = current.creationDraft ? structuredClone(current.creationDraft) : newCreationDraft(genre, idea);
    if (current.creationDraft) setCreationDirection(draft, genre, idea);
    const job = createCreationRound(current, draft, '生成三个核心设定方案。');
    update(s => { s.creationDraft = draft; s.jobs.unshift(job); });
  }, [update]);
  const discardNovelCreation = useCallback(() => {
    const current = stateRef.current; requireIdleCreation(current);
    const draftId = current.creationDraft?.id;
    if (!draftId) return;
    update(s => { s.creationDraft = undefined; s.jobs = s.jobs.filter(job => job.creationTask?.draftId !== draftId); });
  }, [update]);
  const generateNovelOptions = useCallback((instruction: string) => {
    const current = stateRef.current; requireIdleCreation(current);
    if (!current.creationDraft) throw new Error('新建小说草稿已移除');
    const draft = structuredClone(current.creationDraft);
    const job = createCreationRound(current, draft, instruction);
    update(s => { s.creationDraft = draft; s.jobs.unshift(job); });
  }, [update]);
  const selectNovelOption = useCallback((id: string) => {
    requireIdleCreation(stateRef.current);
    update(s => { if (!s.creationDraft) throw new Error('新建小说草稿已移除'); selectCreationOption(s.creationDraft, id); });
  }, [update]);
  const advanceNovelCreation = useCallback(() => {
    const current = stateRef.current; requireIdleCreation(current);
    if (!current.creationDraft) throw new Error('新建小说草稿已移除');
    const draft = structuredClone(current.creationDraft);
    if (!selectedCreationOption(draft, draft.stage)) throw new Error('请选择方案');
    if (draft.stage !== 'core') throw new Error('请先选择核心设定');
    draft.stage = 'outline';
    const job = createCreationRound(current, draft, '生成三个总纲方案，包含人物与分卷。');
    update(s => { s.creationDraft = draft; s.jobs.unshift(job); });
  }, [update]);
  const backNovelCreation = useCallback((stage: CreationStage) => {
    const current = stateRef.current; requireIdleCreation(current);
    if (!current.creationDraft || ['genre', 'core', 'outline'].indexOf(stage) >= ['genre', 'core', 'outline'].indexOf(current.creationDraft.stage)) return;
    update(s => { s.creationDraft!.stage = stage; });
  }, [update]);
  const finishNovelCreation = useCallback(() => {
    const current = stateRef.current; requireIdleCreation(current);
    if (!current.creationDraft || current.creationDraft.stage !== 'outline') throw new Error('请先选择总纲');
    const project = projectFromCreation(current.creationDraft);
    const draftId = current.creationDraft.id;
    update(s => {
      s.projects.unshift(project); s.activeProjectId = project.id; s.creationDraft = undefined;
      s.jobs.filter(job => job.creationTask?.draftId === draftId).forEach(job => {
        job.projectId = project.id;
        if (job.status === 'ready') { job.status = 'accepted'; job.steps.forEach(step => { step.status = 'accepted'; }); }
      });
    });
    return project.id;
  }, [update]);
  useEffect(() => {
    if (!loaded || restarting.current) return;
    for (const id of runnableJobs(stateRef.current.jobs, stateRef.current.providers, new Set(controllers.current.keys()))) void runJob(id);
  }, [state, loaded, runJob, queueTick]);
  const collect = useCallback((options: Omit<NonNullable<Job['collectionTask']>, 'referenceId' | 'done' | 'total'>) => {
    const current = stateRef.current;
    const existing = current.jobs.find(j => j.collectionTask?.bookUrl === options.bookUrl && j.collectionTask.scope === options.scope && j.collectionTask.chapterId === options.chapterId && ['queued', 'running'].includes(j.status));
    if (existing) return existing.id;
    const referenceId = current.references.find(r => r.bookUrl === options.bookUrl && r.collection)?.id ?? current.jobs.find(j => j.collectionTask?.bookUrl === options.bookUrl && ['queued', 'running', 'paused', 'failed'].includes(j.status))?.collectionTask?.referenceId ?? uid();
    const job = createJob(undefined, 'collect', null, undefined, '', '', referenceId);
    job.collectionTask = { ...structuredClone(options), referenceId, done: 0, total: 0 };
    job.sourceTitle = options.title; job.status = 'queued';
    update(s => { s.jobs.unshift(job); }); notify('任务已添加'); return job.id;
  }, [notify, update]);
  const collectArticles = useCallback((options: Omit<NonNullable<Job['articleTask']>, 'referenceId' | 'done' | 'total'>, title = '文章采集') => {
    const referenceId = uid();
    const job = createJob(undefined, 'collect', null, undefined, '', '', referenceId);
    job.articleTask = { ...structuredClone(options), referenceId, done: 0, total: options.mode === 'chapter' ? 1 : options.links.length };
    job.sourceTitle = title; job.status = 'queued';
    update(s => s.jobs.unshift(job)); notify('任务已添加'); return job.id;
  }, [notify, update]);
  const scoreTraining = useCallback((id: string, scores: TrainingScore[], feedback: string, annotations: TrainingAnnotation[] = [], satisfied = false) => {
    try {
      update(s => {
        const job = s.jobs.find(j => j.id === id);
        if (!job?.training || job.status !== 'waiting') throw new Error('当前任务无需评分');
        const part = job.steps.find(p => p.stage === 'train-judge' && p.status === 'pending');
        if (!part) throw new Error('评分步骤不存在');
        if (!satisfied) job.ai = resolveAI(s.aiSelection, s.providers);
        recordEvaluation(job, part, { scores, feedback, annotations, satisfied, decision: 'auto' }); job.status = 'queued';
      });
      notify('反馈已保存');
      return true;
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); return false; }
  }, [notify, update]);
  const generateTrainingFeedback = useCallback((id: string) => {
    try {
      if (restarting.current) throw new Error('正在更新软件');
      update(s => {
        const job = s.jobs.find(job => job.id === id);
        if (!job?.training) throw new Error('训练任务不存在');
        const config = resolveAI(s.aiSelection, s.providers);
        startTrainingFeedback(job); job.ai = config;
        const part = job.steps.find(part => part.stage === 'train-feedback' && part.status === 'pending')!;
        const prompt = trainingPrompt(job, part);
        if (prompt.system.length + prompt.user.length > config.contextChars) throw new Error('对比材料超过上下文上限，请增大 AI 上下文');
      });
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [notify, update]);
  const resumeJob = useCallback((id: string, restart = false) => {
    if (controllers.current.has(id)) return;
    try {
      const current = stateRef.current;
      const job = current.jobs.find(j => j.id === id);
      if (!job || !['paused', 'failed'].includes(job.status)) return;
      if (['draft', 'continue', 'rewrite'].includes(job.kind)) {
        if (job.steps.some(step => controllers.current.has(`polish:${step.chapterId}`))) throw new Error('请等待正文润色完成');
        requireIdleWriting(current.jobs, job.projectId, job.steps.map(step => step.chapterId), id);
      }
      if (job.novelChat && current.jobs.some(value => value.id !== id && value.projectId === job.projectId && value.novelChat && ['queued', 'running'].includes(value.status))) throw new Error('请等待回复完成');
      if (job.planningChat && current.jobs.some(value => value.id !== id && value.projectId === job.projectId && value.planningChat && ['queued', 'running'].includes(value.status))) throw new Error('请等待回复完成');
      if (job.creationTask) {
        const draft = current.creationDraft, round = draft?.rounds.find(round => round.id === job.creationTask!.roundId);
        if (!draft || draft.id !== job.creationTask.draftId || draft.stage !== job.creationTask.stage || !round || round.contextKey !== creationContextKey(draft, draft.stage)) throw new Error('该轮次已结束，请在当前步骤重新生成');
        requireIdleCreation(current);
      }
      const config = job.collectionTask || job.articleTask ? null : resolveAI(current.aiSelection, current.providers);
      update(s => {
        const item = s.jobs.find(j => j.id === id)!;
        item.ai = config; item.status = 'queued'; item.error = '';
        if (item.novelChat) {
          const project = s.projects.find(value => value.id === item.projectId);
          if (!project) throw new Error('小说已移除');
          item.novelChat.base = novelSnapshot(project);
          item.novelChat.before = novelBefore(project);
          item.steps.forEach(step => { step.output = ''; });
        }
        if (item.planningChat) {
          const project = s.projects.find(value => value.id === item.projectId);
          if (!project) throw new Error('小说已移除');
          item.planningChat.base = planningSnapshot(project);
        }
        if (restart || item.creationTask) item.steps.forEach(step => { if (step.status === 'pending') { step.output = ''; step.reasoning = undefined; step.execution = undefined; } });
        if (config && item.kind === 'prepare') prepareAnalysis(item, config);
      });

    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [notify, update]);
  const continueTraining = useCallback((id: string) => {
    try {
      if (restarting.current) throw new Error('正在更新软件');
      const config = resolveAI(stateRef.current.aiSelection, stateRef.current.providers);
      update(s => {
        const job = s.jobs.find(j => j.id === id);
        if (!job?.training) throw new Error('训练任务不存在');
        if (s.jobs.some(j => j.id !== id && j.training?.skillId === job.training!.skillId && ['queued', 'running', 'waiting', 'paused'].includes(j.status))) throw new Error('该 Skill 已有未完成的训练任务');
        if (!s.skills.some(skill => skill.id === job.training!.skillId)) throw new Error('Skill 已移除');
        continueTrainingJob(job); job.ai = config;
      });
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [notify, update]);
  const stop = useCallback((id: string) => {
    const active = controllers.current.get(id);
    if (active) active.abort();
    else update(s => { const job = s.jobs.find(j => j.id === id); if (job && job.status === 'queued' && !discardTrainingFeedback(job)) job.status = 'paused'; });
  }, [update]);
  const accept = useCallback((jobId: string, stepId: string) => {
    try {
      update(s => {
        const job = s.jobs.find(j => j.id === jobId); const step = job?.steps.find(p => p.id === stepId);
        if (!job || !step || step.status !== 'ready' || step.intermediate) throw new Error('结果尚未完成');
        if (job.creationTask) throw new Error('请在新建小说中选择方案');
        const project = s.projects.find(p => p.id === job.projectId);
        const chapter = project?.chapters.find(c => c.id === step.chapterId);
        if (['draft', 'continue', 'rewrite'].includes(job.kind)) {
          acceptWriting(s, job, step);
        } else if (job.novelChat) {
          acceptNovel(s, job);
        } else if (job.kind === 'prepare') {
          acceptPreparation(s, job, step);
        } else if (job.planningChat) {
          acceptPlanning(s, job, step);
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
  const undoNovelAdjustment = useCallback((id: string) => {
    try { update(state => { const job = state.jobs.find(value => value.id === id); if (!job) throw new Error('任务已移除'); undoNovel(state, job); }); notify('已撤销调整'); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [update, notify]);
  const replace = useCallback(async (workspace: Workspace) => {
    await refreshCredentials(workspace);
    generation.current++; controllers.current.forEach(c => c.abort()); controllers.current.clear();
    setPolishingChapters([]);
    stateRef.current = workspace; setState(workspace); setLoaded(true); setLoadError(''); setSaveStatus('保存中');
    await saveWorkspace(workspace); if (stateRef.current === workspace) setSaveStatus('已保存');
  }, []);
  const canUpdate = useCallback(async () => !controllers.current.size && !stateRef.current.jobs.some(job => ['queued', 'running'].includes(job.status)) && !await hasActiveRequests(), []);
  const prepareUpdate = useCallback(async () => {
    restarting.current = true;
    if (!await canUpdate()) { restarting.current = false; return false; }
    // Relaunch bypasses the native close handler, so persist the final snapshot first.
    let pending: Workspace;
    do { pending = stateRef.current; await saveWorkspace(pending); } while (pending !== stateRef.current);
    setSaveStatus('已保存');
    return true;
  }, [canUpdate]);
  const cancelUpdate = useCallback(() => { restarting.current = false; setQueueTick(tick => tick + 1); }, []);
  return { state, stateRef, loaded, saveStatus, loadError, message, messageId, notify, update, setAISelection, launch, polishChapter, cancelPolish, polishingChapters, saveChapter, reextractSkill, startNovelCreation, discardNovelCreation, generateNovelOptions, selectNovelOption, advanceNovelCreation, backNovelCreation, finishNovelCreation, collect, collectArticles, scoreTraining, generateTrainingFeedback, continueTraining, stop, resumeJob, accept, undoNovelAdjustment, replace, canUpdate, prepareUpdate, cancelUpdate };
}
export type Store = ReturnType<typeof useWorkspace>;
export type { Job };
