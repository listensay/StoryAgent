import { useEffect, useRef, useState } from 'react';
import { Accordion, Alert, Box, Checkbox, Group, ScrollArea, SimpleGrid, Stack, Text } from '@mantine/core';
import { Button, EmptyState, IconButton, Modal, ModalPresence, NumberInput, Paper, Select, Textarea, Title } from '../components';
import { X } from '../icons';
import { AIControls } from '../AIControls';
import { JobCard } from '../JobCard';
import { Markdown } from '../Markdown';
import { importChapters, now, type Job, type TrainingAnnotation } from '../domain';
import { scenarioTraining, skillText, trainingCandidate, trainingOriginal } from '../training';
import type { Store } from '../useWorkspace';

type SelectedPassage = Omit<TrainingAnnotation, 'feedback'>;

export function Training({ store, onSettings, focusJobId }: { store: Store; onSettings: () => void; focusJobId?: string }) {
  const skills = store.state.skills.filter(s => !s.builtin);
  const [skillId, setSkillId] = useState(store.state.jobs.find(j => j.id === focusJobId)?.training?.skillId ?? skills[0]?.id ?? '');
  const skill = skills.find(s => s.id === skillId);
  const [sourceId, setSourceId] = useState(''), [chapterIndex, setChapterIndex] = useState('0');
  const [maxRounds, setMaxRounds] = useState(3), [target, setTarget] = useState(8.5);
  const reference = store.state.references.find(r => r.id === (sourceId || skill?.originReferenceId));
  const chapters = reference ? importChapters(reference.content) : [];
  const chapter = chapters[Number(chapterIndex)], original = chapter?.content ?? '';
  useEffect(() => { const job = store.state.jobs.find(j => j.id === focusJobId); if (job?.training) setSkillId(job.training.skillId); }, [focusJobId]);
  const jobs = store.state.jobs.filter(j => j.training?.skillId === skillId);
  const run = () => {
    try {
      if (!skill || !original.trim()) throw new Error('请选择 Skill 和原文章节');
      store.launch({ kind: 'train', sourceId: reference?.id, sourceTitle: skill.name, training: { skillId, initialSkill: skillText(skill), bestSkill: '', bestScore: -1, targetScore: target, maxRounds, judge: 'human', mode: 'chapter', chapterTitle: chapter.title, original, cases: [], evaluations: [] } });
    } catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="page"><Stack gap="lg"><Title order={2}>Skill 训练营</Title>{!skills.length ? <EmptyState>暂无可训练的 Skill</EmptyState> : <>
    <Paper className="surface"><Stack gap="lg"><Title order={3}>原文章节训练</Title><Select label="Skill" value={skillId} onChange={id => { setSkillId(id); setSourceId(''); setChapterIndex('0'); }} options={skills.map(s => ({ value: s.id, label: s.name }))} />
      {skill && <Accordion variant="separated"><Accordion.Item value="skill"><Accordion.Control>Skill 内容</Accordion.Control><Accordion.Panel><Markdown onError={store.notify}>{skillText(skill)}</Markdown></Accordion.Panel></Accordion.Item></Accordion>}
      <SimpleGrid cols={{ base: 1, md: 2 }}><Select label="原文" value={reference?.id ?? ''} onChange={id => { setSourceId(id); setChapterIndex('0'); }} options={store.state.references.filter(r => r.kind === 'text' && r.content.trim()).map(r => ({ value: r.id, label: r.title }))} /><Select label="原文章节" value={chapterIndex} onChange={setChapterIndex} options={chapters.map((c, i) => ({ value: String(i), label: c.title }))} /></SimpleGrid>
      <SimpleGrid cols={{ base: 1, sm: 2 }}><NumberInput label="目标分数" min={1} max={10} step={0.5} value={target} onChange={v => setTarget(Number(v))} /><NumberInput label="最多轮数" min={1} max={10} allowDecimal={false} value={maxRounds} onChange={v => setMaxRounds(Number(v))} /></SimpleGrid>
      <AIControls providers={store.state.providers} value={store.state.aiSelection} onChange={store.setAISelection} onSettings={onSettings} columns={2} />
      <Group><Button primary disabled={!skill || !original.trim() || !store.state.aiSelection.model} onClick={run}>开始章节训练</Button></Group>
    </Stack></Paper>
    {jobs.map(job => <TrainingResult focused={job.id === focusJobId} key={job.id} job={job} store={store} />)}
  </>}</Stack></div>;
}
function TrainingResult({ job, store, focused }: { job: Job; store: Store; focused: boolean }) {
  const training = job.training!;
  const pendingRound = job.steps.find(p => p.stage === 'train-judge' && p.status === 'pending')?.round;
  const rounds = [...new Set(job.steps.filter(p => p.stage === 'train-write').map(p => p.round!))];
  const [viewRound, setViewRound] = useState('');
  const [viewCase, setViewCase] = useState('0');
  const round = Number(viewRound) || pendingRound || rounds[rounds.length - 1];
  const canScore = job.status === 'waiting' && round === pendingRound;
  const [scores, setScores] = useState<(number | '')[]>([]);
  const [feedback, setFeedback] = useState(''), [satisfied, setSatisfied] = useState(false);
  const [annotations, setAnnotations] = useState<TrainingAnnotation[]>([]);
  const [passage, setPassage] = useState<SelectedPassage>();
  const [passageFeedback, setPassageFeedback] = useState('');
  useEffect(() => { setScores(training.cases.map(() => '')); setFeedback(''); setSatisfied(false); setAnnotations([]); setPassage(undefined); setViewRound(''); setViewCase('0'); }, [pendingRound, training.cases.length]);
  const evaluation = training.evaluations.find(e => e.round === round);
  const startScenarios = () => {
    try { store.launch({ kind: 'train', sourceId: job.sourceId, sourceTitle: job.sourceTitle, training: scenarioTraining(store.state, job.id) }); }
    catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  const adopt = () => {
    store.update(s => {
      const skill = s.skills.find(k => k.id === training.skillId); if (!skill || skillText(skill) === training.bestSkill) return;
      skill.revisions.unshift({ version: skill.version, files: structuredClone(skill.files), savedAt: now() });
      skill.files = [{ path: 'SKILL.md', content: training.bestSkill }]; skill.version = `训练 · ${training.bestScore}`;
    }); store.notify('已采用最佳 Skill');
  };
  const completeScores = scores.length === training.cases.length && scores.every(score => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10);
  return <Paper className="surface"><Stack gap="lg"><Group justify="space-between"><Stack gap={4}><Title order={3}>{job.sourceTitle}</Title><Text size="sm" c="dimmed">{training.mode === 'scenario' ? '其他场景训练' : training.chapterTitle ?? '原文章节训练'}</Text></Stack>{training.bestScore >= 0 && <Text fw={600}>最佳 {training.bestScore.toFixed(1)} / 10</Text>}</Group>
    {rounds.length > 0 && <>
      <Group justify="space-between"><Select label="轮次" value={String(round)} onChange={setViewRound} options={rounds.map(r => ({ value: String(r), label: `第 ${r} 轮` }))} /><Text size="sm" c="dimmed">原文基准：10 分</Text></Group>
      {training.cases.length > 1 && <Select label="场景" value={viewCase} onChange={setViewCase} options={training.cases.map((c, i) => ({ value: String(i), label: c.title }))} />}
      {training.cases.map((c, i) => i === Number(viewCase) && <Stack key={`${round}-${i}`} gap="sm">
        <Accordion variant="separated"><Accordion.Item value="brief"><Accordion.Control>创作提示词</Accordion.Control><Accordion.Panel><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{c.brief}</Text></Accordion.Panel></Accordion.Item></Accordion>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <TrainingText title="原文" content={trainingOriginal(training)} target="original" caseIndex={i} canAnnotate={canScore} onAnnotate={selected => { setPassage(selected); setPassageFeedback(''); }} />
          <TrainingText title="生成稿" content={trainingCandidate(job, round, i)} target="candidate" caseIndex={i} canAnnotate={canScore} onAnnotate={selected => { setPassage(selected); setPassageFeedback(''); }} />
        </SimpleGrid>
      </Stack>)}
    </>}
    {evaluation && <Stack gap="sm"><Text fw={500}>{evaluation.source === 'human' ? '用户评分' : '历史评分'} · {evaluation.scores.join('、')} / 10</Text>{evaluation.feedback && <Text size="sm">{evaluation.feedback}</Text>}{evaluation.annotations?.map((a, i) => <PassageFeedback key={i} annotation={a} />)}</Stack>}
    {canScore && <Stack gap="md"><Title order={3}>用户评分</Title><SimpleGrid cols={{ base: 1, sm: 2 }}>{training.cases.map((c, i) => <NumberInput key={i} label={training.cases.length === 1 ? '生成稿评分' : `${c.title}评分`} placeholder="0–10" min={0} max={10} step={0.5} value={scores[i] ?? ''} onChange={v => setScores(previous => previous.map((score, index) => index === i ? v === '' ? '' : Number(v) : score))} />)}</SimpleGrid>
      <Textarea label="整体反馈" placeholder="需要改进的内容" maxLength={8000} autosize minRows={3} value={feedback} onChange={e => setFeedback(e.target.value)} />
      {annotations.map((a, i) => <Paper key={i} p="md" shadow="none"><Stack gap="sm"><Group justify="space-between"><Text size="sm" fw={500}>{a.target === 'original' ? '原文' : '生成稿'}{training.cases.length > 1 ? ` · ${training.cases[a.caseIndex].title}` : ''}</Text><IconButton icon={X} label="删除划词评价" onClick={() => setAnnotations(previous => previous.filter((_, index) => index !== i))} /></Group><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{a.quote}</Text><Textarea label="片段评价" maxLength={4000} value={a.feedback} onChange={event => { const value = event.target.value; setAnnotations(previous => previous.map((item, index) => index === i ? { ...item, feedback: value } : item)); }} /></Stack></Paper>)}
      <Checkbox label="效果满意，结束本阶段训练" checked={satisfied} onChange={e => setSatisfied(e.currentTarget.checked)} />
      <Group><Button primary disabled={!completeScores || annotations.some(a => !a.feedback.trim())} onClick={() => store.scoreTraining(job.id, scores as number[], feedback, annotations, satisfied)}>{satisfied ? '提交评分并完成训练' : '提交评分并调整 Skill'}</Button></Group>
    </Stack>}
    {job.status === 'accepted' && !training.evaluations.some(e => e.satisfied) && <Alert color="yellow">已达到轮数上限，保留最佳版本。</Alert>}
    {training.bestSkill && training.bestScore >= 0 && <Accordion variant="separated"><Accordion.Item value="best"><Accordion.Control>最佳 Skill</Accordion.Control><Accordion.Panel><Stack><Markdown onError={store.notify}>{training.bestSkill}</Markdown><Group><Button onClick={adopt}>采用此版本</Button></Group></Stack></Accordion.Panel></Accordion.Item></Accordion>}
    {job.status === 'accepted' && training.mode !== 'scenario' && training.evaluations.some(e => e.source === 'human') && <Group>{training.approvedAt ? <Button primary onClick={startScenarios}>开始其他场景训练</Button> : <Button onClick={() => store.update(s => { const t = s.jobs.find(j => j.id === job.id)!.training!; t.approvedAt = now(); const e = t.evaluations[t.evaluations.length - 1]; e.satisfied = true; e.decision = 'keep'; })}>确认效果满意</Button>}</Group>}
    <Accordion variant="separated" defaultValue={focused || ['failed', 'paused'].includes(job.status) ? 'process' : undefined}><Accordion.Item value="process"><Accordion.Control>训练过程</Accordion.Control><Accordion.Panel><JobCard focused={focused} job={job} store={store} /></Accordion.Panel></Accordion.Item></Accordion>
    <ModalPresence>{passage && <Modal title="划词评价" onClose={() => setPassage(undefined)} footer={<Button primary disabled={!passageFeedback.trim() || annotations.length >= 100} onClick={() => { setAnnotations(previous => [...previous, { ...passage, feedback: passageFeedback.trim() }]); setPassage(undefined); }}>保存评价</Button>}><Text size="sm" c="dimmed">{passage.target === 'original' ? '原文' : '生成稿'}</Text><ScrollArea.Autosize mah={220}><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{passage.quote}</Text></ScrollArea.Autosize><Textarea label="片段评价" placeholder="具体问题或值得保留的写法" maxLength={4000} autosize minRows={3} value={passageFeedback} onChange={e => setPassageFeedback(e.target.value)} /></Modal>}</ModalPresence>
  </Stack></Paper>;
}
function TrainingText({ title, content, target, caseIndex, canAnnotate, onAnnotate }: { title: string; content: string; target: TrainingAnnotation['target']; caseIndex: number; canAnnotate: boolean; onAnnotate: (selection: SelectedPassage) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<SelectedPassage>();
  const capture = () => {
    const root = ref.current, selection = window.getSelection();
    if (!canAnnotate || !root || !selection?.rangeCount || selection.isCollapsed) { setSelected(undefined); return; }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) { setSelected(undefined); return; }
    const prefix = range.cloneRange(); prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString(), quote = raw.trim(), start = prefix.toString().length + raw.indexOf(quote);
    setSelected(quote && quote.length <= 8000 && content.slice(start, start + quote.length) === quote ? { target, caseIndex, start, end: start + quote.length, quote } : undefined);
  };
  return <Paper p="md" shadow="none"><Stack gap="sm"><Group justify="space-between"><Title order={4}>{title}</Title>{canAnnotate && <Button disabled={!selected} onClick={() => selected && onAnnotate(selected)}>评价所选片段</Button>}</Group>{content ? <ScrollArea h={360} type="auto" offsetScrollbars viewportProps={{ tabIndex: 0, role: 'region', 'aria-label': `${title}内容` }}><Box pr="sm"><Text ref={ref} component="div" size="sm" lh={1.9} style={{ whiteSpace: 'pre-wrap', userSelect: 'text' }} onMouseUp={capture} onKeyUp={capture}>{content}</Text></Box></ScrollArea> : <EmptyState minHeight={360}>等待生成</EmptyState>}</Stack></Paper>;
}
function PassageFeedback({ annotation }: { annotation: TrainingAnnotation }) {
  return <Paper p="md" shadow="none"><Stack gap={6}><Text size="sm" fw={500}>{annotation.target === 'original' ? '原文' : '生成稿'} · 划词评价</Text><Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>{annotation.quote}</Text><Text size="sm">{annotation.feedback}</Text></Stack></Paper>;
}
