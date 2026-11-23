import { useEffect, useState } from 'react';
import { Accordion, Badge, Group, Loader, NavLink, SimpleGrid, Stack, Text } from '@mantine/core';
import { Button, EmptyState, NumberInput, Paper, Select, Textarea, Title } from '../components';
import { AIControls } from '../AIControls';
import { JobCard } from '../JobCard';
import { Markdown } from '../Markdown';
import { TrainingText } from '../TrainingText';
import { TrainingFeedbackList } from '../TrainingFeedbackList';
import { importChapters, now, taskNames, type Job, type Skill, type TrainingAnnotation } from '../domain';
import { adoptTrainingSkill, hasTrainingFeedback, scenarioTraining, skillText, trainingCandidate, trainingOriginal, trainingReview } from '../training';
import { ChevronRight, Sparkles } from '../icons';
import type { Store } from '../useWorkspace';

export function Training({ store, onSettings, focusJobId }: { store: Store; onSettings: () => void; focusJobId?: string }) {
  const skills = store.state.skills.filter(s => !s.builtin);
  const focusSkillId = store.state.jobs.find(j => j.id === focusJobId)?.training?.skillId;
  const [skillId, setSkillId] = useState(focusSkillId ?? '');
  const skill = skills.find(s => s.id === skillId);
  useEffect(() => { setSkillId(focusSkillId ?? ''); }, [focusJobId, focusSkillId]);
  return <div className="page"><Stack gap="lg" style={{ flex: 1 }}><Title order={2}>Skill 训练营</Title>{skill ? <>
    <Group justify="space-between"><Title order={3}>{skill.name}</Title><Button onClick={() => setSkillId('')}>返回 Skill 列表</Button></Group>
    <SkillTraining key={skill.id} skill={skill} store={store} onSettings={onSettings} focusJobId={focusJobId} />
  </> : !skills.length ? <EmptyState>暂无可训练的 Skill</EmptyState> : <Paper p={0} style={{ overflow: 'hidden' }}><Stack gap={0}>
    {skills.map(item => <NavLink key={item.id} component="button" aria-label={`训练 ${item.name}`} onClick={() => setSkillId(item.id)} px="lg" py="md" rightSection={<ChevronRight size={20} />}
      label={<Text size="md" fw={600} style={{ overflowWrap: 'anywhere' }}>{item.name}</Text>}
      description={<Stack gap="sm" mt={4}><Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{item.description}</Text><Group gap="sm"><Text size="xs" c="dimmed">{item.originReferenceId ? '小说提炼' : item.source.startsWith('https://github.com/') ? 'GitHub' : '文件导入'} · {item.version}</Text>{item.tasks.map(task => <Badge key={task}>{taskNames[task]}</Badge>)}</Group></Stack>} />)}
  </Stack></Paper>}</Stack></div>;
}
function SkillTraining({ skill, store, onSettings, focusJobId }: { skill: Skill; store: Store; onSettings: () => void; focusJobId?: string }) {
  const [mode, setMode] = useState('');
  const [sourceId, setSourceId] = useState(''), [chapterIndex, setChapterIndex] = useState('0');
  const [target, setTarget] = useState(8.5);
  const reference = store.state.references.find(r => r.id === (sourceId || skill?.originReferenceId));
  const chapters = reference ? importChapters(reference.content) : [];
  const chapter = chapters[Number(chapterIndex)], original = chapter?.content ?? '';
  const jobs = store.state.jobs.filter(j => j.training?.skillId === skill.id);
  const run = () => {
    try {
      if (mode !== 'chapter' || !original.trim()) throw new Error('请选择训练方式和原文章节');
      store.launch({ kind: 'train', sourceId: reference?.id, sourceTitle: skill.name, training: { skillId: skill.id, initialSkill: skillText(skill), bestSkill: '', bestScore: -1, targetScore: target, judge: 'human', mode: 'chapter', chapterTitle: chapter.title, original, cases: [], evaluations: [] } });
    } catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  return <>
    <Paper className="surface"><Stack gap="lg"><Select label="训练方式" placeholder="选择训练方式" value={mode} onChange={setMode} options={[{ value: 'chapter', label: '原文章节训练' }]} />
      <Accordion variant="separated"><Accordion.Item value="skill"><Accordion.Control>Skill 内容</Accordion.Control><Accordion.Panel><Markdown onError={store.notify}>{skillText(skill)}</Markdown></Accordion.Panel></Accordion.Item></Accordion>
      {mode === 'chapter' && <>
      <SimpleGrid cols={{ base: 1, md: 2 }}><Select label="原文" value={reference?.id ?? ''} onChange={id => { setSourceId(id); setChapterIndex('0'); }} options={store.state.references.filter(r => r.kind === 'text' && r.content.trim()).map(r => ({ value: r.id, label: r.title }))} /><Select label="原文章节" value={chapterIndex} onChange={setChapterIndex} options={chapters.map((c, i) => ({ value: String(i), label: c.title }))} /></SimpleGrid>
      <NumberInput label="目标分数" min={1} max={10} step={0.5} value={target} onChange={v => setTarget(Number(v))} />
      <AIControls providers={store.state.providers} value={store.state.aiSelection} onChange={store.setAISelection} onSettings={onSettings} columns={2} />
      <Group><Button primary disabled={!original.trim() || !store.state.aiSelection.model} onClick={run}>开始章节训练</Button></Group>
      </>}
    </Stack></Paper>
    {jobs.map(job => <TrainingResult focused={job.id === focusJobId} key={job.id} job={job} store={store} />)}
  </>;
}
function TrainingResult({ job, store, focused }: { job: Job; store: Store; focused: boolean }) {
  const training = job.training!;
  const pendingRound = job.steps.find(p => p.stage === 'train-judge' && p.status === 'pending')?.round;
  const rounds = [...new Set(job.steps.filter(p => p.stage === 'train-write').map(p => p.round!))];
  const [viewRound, setViewRound] = useState('');
  const [viewCase, setViewCase] = useState('0');
  const round = Number(viewRound) || pendingRound || rounds[rounds.length - 1];
  const canScore = job.status === 'waiting' && round === pendingRound;
  const generatingFeedback = ['queued', 'running'].includes(job.status) && job.steps.some(part => part.stage === 'train-feedback' && part.round === pendingRound && part.status !== 'accepted');
  const showReview = canScore || generatingFeedback && round === pendingRound;
  const review = training.review && training.review.round === pendingRound ? training.review : { round: pendingRound!, scores: training.cases.map(() => '' as const), feedback: '', annotations: [] as TrainingAnnotation[] };
  const { scores, feedback, annotations } = review;
  const editReview = (mutate: (draft: typeof review) => void) => store.update(s => {
    const item = s.jobs.find(j => j.id === job.id);
    if (!item?.training || item.status !== 'waiting' || !pendingRound) return;
    mutate(trainingReview(item, pendingRound));
  });
  useEffect(() => { setViewRound(''); setViewCase('0'); }, [pendingRound, training.cases.length]);
  const evaluation = training.evaluations.find(e => e.round === round);
  const startScenarios = () => {
    try { store.launch({ kind: 'train', sourceId: job.sourceId, sourceTitle: job.sourceTitle, training: scenarioTraining(store.state, job.id) }); }
    catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  const adopt = () => {
    try { store.update(s => adoptTrainingSkill(s, job)); store.notify('已采用最佳 Skill'); }
    catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  const canSubmit = scores.length === training.cases.length && hasTrainingFeedback(review);
  return <Paper className="surface"><Stack gap="lg"><Group justify="space-between"><Stack gap={4}><Title order={3}>{job.sourceTitle}</Title><Text size="sm" c="dimmed">{training.mode === 'scenario' ? '其他场景训练' : training.chapterTitle ?? '原文章节训练'}</Text></Stack>{training.bestScore >= 0 && <Text fw={600}>最佳 {training.bestScore.toFixed(1)} / 10</Text>}</Group>
    {rounds.length > 0 && <>
      <Group justify="space-between"><Select label="轮次" value={String(round)} onChange={setViewRound} options={rounds.map(r => ({ value: String(r), label: `第 ${r} 轮` }))} /><Text size="sm" c="dimmed">原文基准：10 分</Text></Group>
      {training.cases.length > 1 && <Select label="场景" value={viewCase} onChange={setViewCase} options={training.cases.map((c, i) => ({ value: String(i), label: c.title }))} />}
      {training.cases.map((c, i) => i === Number(viewCase) && <Stack key={`${round}-${i}`} gap="sm">
        <Accordion variant="separated"><Accordion.Item value="brief"><Accordion.Control>创作提示词</Accordion.Control><Accordion.Panel><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{c.brief}</Text></Accordion.Panel></Accordion.Item></Accordion>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {(['original', 'candidate'] as const).map(target => <TrainingText key={`${round}-${i}-${target}`} title={target === 'original' ? '原文' : '生成稿'} content={target === 'original' ? trainingOriginal(training) : trainingCandidate(job, round, i)} target={target} caseIndex={i} canAnnotate={canScore} annotations={showReview ? annotations : evaluation?.annotations ?? []} onAdd={a => editReview(draft => { draft.annotations.push(a); })} onEdit={(index, value) => editReview(draft => { draft.annotations[index].feedback = value; })} onDelete={index => editReview(draft => { draft.annotations.splice(index, 1); })} />)}
        </SimpleGrid>
      </Stack>)}
    </>}
    {evaluation && <Stack gap="sm"><Title order={3}>{evaluation.source === 'human' ? '已提交反馈' : '历史反馈'}</Title>{evaluation.scores.some(score => typeof score === 'number') && <Text size="sm">用户评分 · {evaluation.scores.map(score => score === '' ? '未评分' : `${score} / 10`).join('、')}</Text>}{evaluation.feedback && <Stack gap="xs"><Text size="sm" fw={500}>整体反馈</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{evaluation.feedback}</Text></Stack>}<TrainingFeedbackList key={round} annotations={evaluation.annotations ?? []} cases={training.cases} /></Stack>}
    {showReview && <Stack gap="md"><Title order={3}>用户反馈</Title><SimpleGrid cols={{ base: 1, sm: 2 }}>{training.cases.map((c, i) => <NumberInput key={i} disabled={!canScore} label={training.cases.length === 1 ? '生成稿评分（选填）' : `${c.title}评分（选填）`} placeholder="0–10" min={0} max={10} clampBehavior="strict" step={0.5} value={scores[i] ?? ''} onChange={v => editReview(draft => { draft.scores[i] = v === '' ? '' : Number(v); })} />)}</SimpleGrid>
      <Stack gap="xs"><Group justify="space-between"><Text component="label" htmlFor={`training-feedback-${job.id}`} size="sm">整体反馈</Text>{generatingFeedback ? <Group gap="sm"><Loader size="xs" aria-label="正在生成反馈" /><Button onClick={() => store.stop(job.id)}>停止生成反馈</Button></Group> : <Button icon={Sparkles} disabled={!store.state.aiSelection.model} onClick={() => store.generateTrainingFeedback(job.id)}>AI 生成反馈</Button>}</Group>
        <Textarea id={`training-feedback-${job.id}`} disabled={!canScore} placeholder="需要改进的内容" maxLength={8000} autosize minRows={3} value={feedback} onChange={e => { const value = e.target.value; editReview(draft => { draft.feedback = value; }); }} />
      </Stack>
      <TrainingFeedbackList annotations={annotations} cases={training.cases} canEdit={canScore} onEdit={(index, value) => editReview(draft => { draft.annotations[index].feedback = value; })} onDelete={index => editReview(draft => { draft.annotations.splice(index, 1); })} />
      {job.error && <Text size="sm" c="red.8" role="alert">{job.error}</Text>}
      <Group><Button primary disabled={!canScore || !canSubmit} onClick={() => store.scoreTraining(job.id, scores, feedback, annotations, false)}>继续训练</Button><Button disabled={!canScore || !canSubmit} onClick={() => store.scoreTraining(job.id, scores, feedback, annotations, true)}>结束训练</Button></Group>
    </Stack>}
    {job.status === 'accepted' && <Group><Button primary onClick={() => store.continueTraining(job.id)}>继续训练</Button>{!training.approvedAt && training.mode !== 'scenario' && <Button onClick={() => store.update(s => { const t = s.jobs.find(j => j.id === job.id)!.training!; t.approvedAt = now(); const e = t.evaluations[t.evaluations.length - 1]; e.satisfied = true; e.decision = 'keep'; })}>结束训练</Button>}</Group>}
    {training.bestSkill && (training.bestScore >= 0 || training.approvedAt) && <Accordion variant="separated"><Accordion.Item value="best"><Accordion.Control>{training.bestScore >= 0 ? '最佳 Skill' : '已确认 Skill'}</Accordion.Control><Accordion.Panel><Stack><Markdown onError={store.notify}>{training.bestSkill}</Markdown><Group><Button onClick={adopt}>采用此版本</Button></Group></Stack></Accordion.Panel></Accordion.Item></Accordion>}
    {job.status === 'accepted' && training.mode !== 'scenario' && training.approvedAt && <Group><Button onClick={startScenarios}>开始其他场景训练</Button></Group>}
    <Accordion variant="separated" defaultValue={focused || ['failed', 'paused'].includes(job.status) ? 'process' : undefined}><Accordion.Item value="process"><Accordion.Control>训练过程</Accordion.Control><Accordion.Panel><JobCard focused={focused} job={job} store={store} /></Accordion.Panel></Accordion.Item></Accordion>
  </Stack></Paper>;
}
