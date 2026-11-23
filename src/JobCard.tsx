import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, GitCompare, Pause, Play, RefreshCw, Settings2, Trash2 } from './icons';
import { type Job, type JobStep, noteNames, taskNames } from './domain';
import { type Store } from './useWorkspace';
import { Paper, UnstyledButton, Title, Button, Diff, EmptyState, IconButton, ModalPresence, Modal, Badge, type ModalVisibilityProps } from './components';
import { AIControls } from './AIControls';
import { Markdown } from './Markdown';
import { Accordion, Box, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { useAIScroll } from './useAIScroll';
import { canAcceptWritingStep, parseMemory, parsePreparation, writingComparison } from './jobWorkflow';
import { composedSkillText, parseSkillComposition } from './skillExtraction';
import { trainingEvaluationText } from './training';
const statuses = { queued: '排队中', waiting: '待反馈', running: '进行中', paused: '已停止', failed: '失败', ready: '待确认', accepted: '已完成' };

export function JobCard({ job, store, compact = false, focused = false }: { job: Job; store: Store; compact?: boolean; focused?: boolean }) {
  const [open, setOpen] = useState(focused || job.status !== 'accepted');
  const { contentRef, scrollToBottom } = useAIScroll();
  const generating = ['queued', 'running'].includes(job.status);
  useEffect(() => { if (generating) scrollToBottom(); }, [generating, scrollToBottom]);
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    const id = requestAnimationFrame(() => document.getElementById(`job-${job.id}`)?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(id);
  }, [focused, job.id]);
  const [compareId, setCompare] = useState<string>();
  const compare = job.steps.find(step => step.id === compareId);
  const [citation, setCitation] = useState<number>();
  const [source, setSource] = useState('');
  const showCitation = useCallback((text: string, number: number) => { setSource(text); setCitation(number); }, []);
  const [aiOpen, setAIOpen] = useState(false);
  const copy = async (step: JobStep) => { try { const text = step.stage === 'style-compose' && step.output.trim().startsWith('{') ? composedSkillText(parseSkillComposition(step.output, job)) : step.output; await navigator.clipboard.writeText(text); store.notify('已复制'); } catch { store.notify('复制失败'); } };
  const result = (step: JobStep) => {
    if (step.stage === 'style-research' && !step.research) return <EmptyState minHeight={88}>{step.status === 'running' ? '正在提炼写法…' : '等待提炼'}</EmptyState>;
    let output = step.output;
    const evaluation = step.stage === 'train-judge' && job.training?.evaluations.find(evaluation => evaluation.round === step.round);
    if (evaluation && job.training) output = trainingEvaluationText(job.training, evaluation);
    if (step.stage === 'style-compose' && job.steps.some(part => part.research)) {
      if (step.status === 'running') return <EmptyState minHeight={88}>正在编写 Skill…</EmptyState>;
      if (output.trim().startsWith('{')) {
        try { output = composedSkillText(parseSkillComposition(output, job)); }
        catch { return <EmptyState minHeight={88}>等待编写</EmptyState>; }
      }
      output = output.replace(/^\uFEFF?---\s*\n[\s\S]*?\n---(?:\s*\n|$)/, '');
    }
    const sourceText = job.sourceText || step.baseContent || job.steps.find(s => !s.intermediate && s.chapterId === step.chapterId)?.baseContent || '';
    return <JobResult output={output} generating={step.status === 'running'} preparation={job.kind === 'prepare' && !step.intermediate} memory={step.stage === 'memory'} sourceText={sourceText} onError={store.notify} onCitation={showCitation} />;
  };
  const canAccept = (step: JobStep) => canAcceptWritingStep(job, step);
  const stepContent = (step: JobStep) => <>{step.output || step.stage === 'style-research' ? result(step) : <EmptyState minHeight={88}>{job.collectionTask || job.articleTask ? job.status === 'running' ? '正在采集…' : '等待采集' : step.status === 'running' ? '正在生成…' : '等待生成'}</EmptyState>}
    {step.output && (step.stage !== 'style-research' || step.research) && !(step.stage === 'style-compose' && step.status === 'running') && <div className="row actions"><IconButton icon={Copy} label="复制结果" onClick={() => void copy(step)} />{['draft', 'continue', 'rewrite', 'plan'].includes(job.kind) && (!step.intermediate || step.stage === 'plan') && <Button icon={GitCompare} onClick={() => setCompare(step.id)}>对比</Button>}{canAccept(step) && <Button primary icon={Check} onClick={() => store.accept(job.id, step.id)}>{['review', 'scan', 'analyze'].includes(job.kind) ? '保存参考' : job.kind === 'style' ? '保存 Skill' : '采用'}</Button>}</div>}
  </>;
  return <Paper ref={contentRef} id={`job-${job.id}`} component="article" p="md"  className={`job-card ${compact ? 'compact' : ''}`}>
    <div className="job-heading"><UnstyledButton className="job-title" onClick={() => setOpen(!open)} aria-expanded={open}><span>{taskNames[job.kind]}</span>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</UnstyledButton><Badge color={job.status === 'running' ? 'story' : 'gray'}>{statuses[job.status]}</Badge></div>
    {open && <><div className="job-meta">{job.collectionTask || job.articleTask ? '正文采集' : job.ai ? `${store.state.providers.find(p => p.id === job.ai?.providerId)?.name ?? '供应商已移除'} · ${job.ai.model}` : 'AI 未设置'} · {new Date(job.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      {job.training ? <Accordion multiple variant="separated" order={4} mt="md" chevron={<ChevronDown size={16} />}>
        {job.steps.map(step => <Accordion.Item key={step.id} value={step.id}><Accordion.Control><Text component="span" size="sm" fw={600}>{step.title}</Text></Accordion.Control><Accordion.Panel><Stack gap="sm" className="job-step-content">{stepContent(step)}</Stack></Accordion.Panel></Accordion.Item>)}
      </Accordion> : job.steps.map(step => <section className="job-step" key={step.id}><div className="row between"><Title order={4}>{step.title}</Title>{step.status === 'accepted' && <Check size={16} />}</div>{stepContent(step)}</section>)}
      {job.error && <p className="error" role="alert">{job.error}</p>}
      <div className="row actions job-controls">{['running', 'queued'].includes(job.status) ? <Button icon={Pause} onClick={() => store.stop(job.id)}>停止</Button> : <>{['paused', 'failed'].includes(job.status) && <>{job.ai && <Button icon={Settings2} onClick={() => setAIOpen(true)}>AI 设置</Button>}<Button icon={Play} onClick={() => store.resumeJob(job.id)}>继续</Button><Button icon={RefreshCw} onClick={() => store.resumeJob(job.id, true)}>重新生成</Button></>}{job.kind === 'style' && ['ready', 'accepted'].includes(job.status) && <Button icon={RefreshCw} onClick={() => store.reextractSkill(job.id)}>重新提取</Button>}<IconButton icon={Trash2} label="删除任务" onClick={() => store.update(s => { s.jobs = s.jobs.filter(j => j.id !== job.id); })} /></>}</div>
    </>}
    <ModalPresence>{compare && <Modal title={`${compare.title} · 对比`} wide bounded onClose={() => setCompare(undefined)} footer={<><Button onClick={() => setCompare(undefined)}>关闭</Button>{canAccept(compare) && <Button primary onClick={() => { store.accept(job.id, compare.id); setCompare(undefined); }}>采用</Button>}</>}><Diff {...writingComparison(job, compare, store.state.projects.find(p => p.id === job.projectId))} onError={store.notify} /></Modal>}</ModalPresence>
    <ModalPresence>{citation !== undefined && <SourceModal text={source} number={citation} onClose={() => setCitation(undefined)} />}</ModalPresence>
    <ModalPresence>{aiOpen && <JobAIEditor store={store} onClose={() => setAIOpen(false)} />}</ModalPresence>
  </Paper>;
}
export const JobResult = memo(function JobResult({ output, generating, preparation, memory = false, textSize = 'sm', sourceText, onError, onCitation }: { output: string; generating: boolean; preparation: boolean; memory?: boolean; textSize?: 'sm' | 'md'; sourceText: string; onError: (message: string) => void; onCitation: (text: string, number: number) => void }) {
  const cite = useCallback((number: number) => onCitation(sourceText, number), [sourceText, onCitation]);
  const { contentRef, scrollToBottom } = useAIScroll();
  const prepared = useMemo(() => {
    if (!preparation || generating) return;
    try { return parsePreparation(output); } catch { return; }
  }, [output, generating, preparation]);
  const remembered = useMemo(() => {
    if (!memory || generating) return;
    try { return parseMemory(output); } catch { return; }
  }, [output, generating, memory]);
  useEffect(() => { if (generating) scrollToBottom(); }, [generating, scrollToBottom]);
  return <Box ref={contentRef} className="result">{remembered ? <Stack gap="lg"><Markdown size={textSize} onError={onError}>{remembered.summary}</Markdown>{remembered.notes.map((note, index) => <Stack key={index} gap="xs"><Group gap="xs"><Badge>{noteNames[note.kind]}</Badge><Text fw={500}>{note.title}</Text></Group><Markdown size={textSize} onError={onError}>{note.body}</Markdown></Stack>)}</Stack> : prepared ? <Stack gap="lg">
    <SimpleGrid cols={{ base: 1, sm: 2 }}>{([['主题', prepared.theme], ['读者定位', prepared.audience]] as const).filter(([, value]) => value.trim()).map(([label, value]) => <Stack key={label} gap="xs"><Text fw={500}>{label}</Text><Markdown size={textSize} onError={onError}>{value}</Markdown></Stack>)}</SimpleGrid>
    {([['简介', prepared.synopsis], ['故事总纲', prepared.outline]] as const).filter(([, value]) => value.trim()).map(([label, value]) => <Stack key={label} gap="sm"><Title order={4}>{label}</Title><Markdown size={textSize} onError={onError}>{value}</Markdown></Stack>)}
    {prepared.notes.map((note, index) => <Stack key={index} gap="sm"><Group gap="xs"><Badge>{noteNames[note.kind]}</Badge><Text fw={500}>{note.title}</Text></Group>{note.kind === 'relation' && note.source && note.target && <Text size="sm" c="dimmed">{note.source} · {note.target}</Text>}<Markdown size={textSize} onError={onError}>{note.body}</Markdown></Stack>)}
  </Stack> : <Markdown size={textSize} onError={onError} onCitation={sourceText ? cite : undefined}>{output}</Markdown>}</Box>;
});
export function JobAIEditor({ store, onClose, ...visibility }: { store: Store; onClose: () => void } & ModalVisibilityProps) {
  return <Modal title="AI 设置" onClose={onClose} {...visibility} footer={<Button primary onClick={onClose}>完成</Button>}><AIControls providers={store.state.providers} value={store.state.aiSelection} onChange={store.setAISelection} /></Modal>;
}
function SourceModal({ text, number, onClose, ...visibility }: { text: string; number: number; onClose: () => void } & ModalVisibilityProps) {
  const paragraphs = text.split(/\n\s*\n|\n/).filter(s => s.trim());
  return <Modal title="原文位置" wide onClose={onClose} {...visibility} onEnterTransitionEnd={() => document.getElementById(`source-p-${number}`)?.scrollIntoView({ block: 'center' })}><div className="source-paragraphs">{paragraphs.map((p, i) => <p id={`source-p-${i + 1}`} className={number === i + 1 ? 'highlight' : ''} key={i}><span className="muted">[P{i + 1}]</span> {p}</p>)}</div>{number > paragraphs.length && <p className="error">原文中没有该段落</p>}</Modal>;
}
