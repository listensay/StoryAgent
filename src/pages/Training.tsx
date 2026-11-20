import { useEffect, useState } from 'react';
import { Accordion, Alert, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { Button, EmptyState, NumberInput, Paper, Select, Textarea, Title } from '../components';
import { AIControls } from '../AIControls';
import { JobCard } from '../JobCard';
import { Markdown } from '../Markdown';
import { importChapters, now, type Job } from '../domain';
import { skillText, trainingOriginal } from '../training';
import type { Store } from '../useWorkspace';

export function Training({ store, onSettings, focusJobId }: { store: Store; onSettings: () => void; focusJobId?: string }) {
  const skills = store.state.skills.filter(s => !s.builtin);
  const [skillId, setSkillId] = useState(store.state.jobs.find(j => j.id === focusJobId)?.training?.skillId ?? skills[0]?.id ?? '');
  const skill = skills.find(s => s.id === skillId);
  const [sourceId, setSourceId] = useState(''), [chapterIndex, setChapterIndex] = useState('0');
  const [judge, setJudge] = useState<'ai' | 'human'>('ai');
  const [maxRounds, setMaxRounds] = useState(3), [target, setTarget] = useState(8.5);
  const reference = store.state.references.find(r => r.id === (sourceId || skill?.originReferenceId));
  const chapters = reference ? importChapters(reference.content) : [];
  const original = chapters[Number(chapterIndex)]?.content ?? '';
  useEffect(() => { const job = store.state.jobs.find(j => j.id === focusJobId); if (job?.training) setSkillId(job.training.skillId); }, [focusJobId]);
  const jobs = store.state.jobs.filter(j => j.training?.skillId === skillId);
  const run = () => {
    try {
      if (!skill || !original.trim()) throw new Error('请选择 Skill 和评分原文');
      store.launch({ kind: 'train', sourceId: reference?.id, sourceTitle: skill.name, training: { skillId, initialSkill: skillText(skill), bestSkill: '', bestScore: -1, targetScore: target, maxRounds, judge, original, cases: [], evaluations: [] } });
    } catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="page"><Stack gap="lg"><Title order={2}>Skill 训练营</Title>{!skills.length ? <EmptyState>暂无可训练的 Skill</EmptyState> : <>
    <Paper className="surface"><Stack gap="lg"><Select label="Skill" value={skillId} onChange={id => { setSkillId(id); setSourceId(''); setChapterIndex('0'); }} options={skills.map(s => ({ value: s.id, label: s.name }))} />
      {skill && <Accordion variant="separated"><Accordion.Item value="skill"><Accordion.Control>Skill 内容</Accordion.Control><Accordion.Panel><Markdown onError={store.notify}>{skillText(skill)}</Markdown></Accordion.Panel></Accordion.Item></Accordion>}
      <SimpleGrid cols={{ base: 1, md: 2 }}><Select label="评分原文" value={reference?.id ?? ''} onChange={id => { setSourceId(id); setChapterIndex('0'); }} options={store.state.references.filter(r => r.kind === 'text' && r.content.trim()).map(r => ({ value: r.id, label: r.title }))} /><Select label="原文章节" value={chapterIndex} onChange={setChapterIndex} options={chapters.map((c, i) => ({ value: String(i), label: c.title }))} /></SimpleGrid>
      <SimpleGrid cols={{ base: 1, sm: 3 }}><Select label="评分方式" value={judge} onChange={v => setJudge(v as typeof judge)} options={[{ value: 'ai', label: 'AI 评分' }, { value: 'human', label: '用户评分' }]} /><NumberInput label="目标分数" min={1} max={10} step={0.5} value={target} onChange={v => setTarget(Number(v))} /><NumberInput label="最多轮数" min={1} max={10} allowDecimal={false} value={maxRounds} onChange={v => setMaxRounds(Number(v))} /></SimpleGrid>
      <AIControls providers={store.state.providers} value={store.state.aiSelection} onChange={store.setAISelection} onSettings={onSettings} columns={2} />
      <Group><Button primary disabled={!skill || !original.trim() || !store.state.aiSelection.model} onClick={run}>开始训练</Button></Group>
    </Stack></Paper>
    {jobs.map(job => <TrainingResult focused={job.id === focusJobId} key={job.id} job={job} store={store} />)}
  </>}</Stack></div>;
}
function TrainingResult({ job, store, focused }: { job: Job; store: Store; focused: boolean }) {
  const training = job.training!;
  const [scores, setScores] = useState<number[]>(training.cases.map(() => 5));
  const [feedback, setFeedback] = useState('');
  const round = job.steps.find(p => p.stage === 'train-judge' && p.status === 'pending')?.round;
  useEffect(() => { setScores(training.cases.map(() => 5)); setFeedback(''); }, [round, training.cases.length]);
  return <Paper className="surface"><Stack gap="md"><Group justify="space-between"><Title order={3}>{job.sourceTitle}</Title>{training.bestScore >= 0 && <Text fw={600}>最佳 {training.bestScore.toFixed(1)} / 10</Text>}</Group>
    {training.evaluations.map(e => <Stack gap={4} key={e.round}><Text fw={500}>第 {e.round} 轮 · {e.source === 'human' ? '用户' : 'AI'}评分</Text><Group>{e.scores.map((score, i) => <Text key={i} size="sm">{training.cases[i].title} {score} / 10</Text>)}</Group><Text size="sm" c="dimmed">{e.feedback}</Text></Stack>)}
    {job.status === 'waiting' && <Stack gap="md"><Text fw={500}>第 {round} 轮评分</Text><Text size="sm" c="dimmed">原文基准：10 分</Text><Accordion variant="separated"><Accordion.Item value="original"><Accordion.Control>评分原文</Accordion.Control><Accordion.Panel><Text style={{ whiteSpace: 'pre-wrap' }}>{trainingOriginal(training)}</Text></Accordion.Panel></Accordion.Item></Accordion><SimpleGrid cols={{ base: 1, sm: 2 }}>{training.cases.map((c, i) => <NumberInput key={i} label={c.title} min={0} max={10} step={0.5} value={scores[i]} onChange={v => setScores(previous => previous.map((s, index) => index === i ? Number(v) : s))} />)}</SimpleGrid><Textarea label="评分意见" value={feedback} onChange={e => setFeedback(e.target.value)} /><Group><Button primary onClick={() => store.scoreTraining(job.id, scores, feedback)}>提交评分</Button></Group></Stack>}
    {job.status === 'accepted' && training.bestScore < training.targetScore && <Alert color="yellow">已达到轮数上限，保留最佳版本。</Alert>}
    {training.bestSkill && training.bestScore >= 0 && <Accordion variant="separated"><Accordion.Item value="best"><Accordion.Control>最佳 Skill</Accordion.Control><Accordion.Panel><Stack><Markdown onError={store.notify}>{training.bestSkill}</Markdown><Group><Button onClick={() => {
      store.update(s => { const skill = s.skills.find(k => k.id === training.skillId); if (!skill) return; skill.revisions.unshift({ version: skill.version, files: structuredClone(skill.files), savedAt: now() }); skill.files = [{ path: 'SKILL.md', content: training.bestSkill }]; skill.version = `训练 · ${training.bestScore}`; }); store.notify('已采用最佳 Skill');
    }}>采用此版本</Button></Group></Stack></Accordion.Panel></Accordion.Item></Accordion>}
    <JobCard focused={focused} job={job} store={store} />
  </Stack></Paper>;
}
