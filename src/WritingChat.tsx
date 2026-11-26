import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Accordion, Anchor, Group, Loader, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { type Job, type JobStep, type Project, taskNames, wordCount } from './domain';
import { type Store } from './useWorkspace';
import { Button, EmptyState, IconButton, ModalPresence } from './components';
import { Check, ChevronRight, FileText, Pause, Play, Puzzle, RefreshCw, Settings2, Sparkles, Trash2 } from './icons';
import { JobAIEditor, JobResult } from './JobCard';
import { Markdown } from './Markdown';
import { useAIScroll } from './useAIScroll';
import { writingCompleted, writingSkillFiles, writingStageName } from './writingActivity';

export function WritingChat({ job, history, chapterId, project, store, onResult }: { job?: Job; history?: Job[]; chapterId: string; project: Project; store: Store; onResult: (jobId: string) => void }) {
  const entries = (history ?? (job ? [job] : [])).filter(entry => entry.steps.some(step => step.chapterId === chapterId)).map(entry => ({ ...entry, steps: entry.steps.filter(step => step.chapterId === chapterId) }));
  const taskRefs = useRef(new Map<string, HTMLDivElement>());
  const generating = entries.some(entry => ['queued', 'running'].includes(entry.status));
  const { contentRef, scrollToBottom } = useAIScroll(generating);
  useEffect(() => {
    if (!job || job.id === entries[0]?.id) scrollToBottom();
    else taskRefs.current.get(job.id)?.scrollIntoView({ block: 'start' });
  }, [job?.id, entries.length, generating, scrollToBottom]);
  if (!entries.length) return <EmptyState>暂无创作任务</EmptyState>;
  return <Stack gap={0} className="writing-chat">
    <ScrollArea type="auto" className="writing-chat-scroll" viewportProps={{ role: 'region', 'aria-label': '创作任务聊天记录', tabIndex: 0 }}>
      <Stack ref={contentRef} className="writing-chat-content" gap="xl" role="log" aria-label="创作任务执行记录" aria-live="off">
        {[...entries].reverse().map(entry => <Stack key={entry.id} ref={element => { if (element) taskRefs.current.set(entry.id, element); else taskRefs.current.delete(entry.id); }} gap="xl"><WritingConversation job={entry} project={project} store={store} onResult={onResult} /></Stack>)}
      </Stack>
    </ScrollArea>
  </Stack>;
}

function WritingConversation({ job, project, store, onResult }: { job: Job; project: Project; store: Store; onResult: (jobId: string) => void }) {
  const [aiOpen, setAIOpen] = useState(false);
  const generating = ['queued', 'running'].includes(job.status);
  const steps = job.steps.filter(step => step.execution || step.reasoning || step.output || step.status !== 'pending');
  const completed = writingCompleted(job);
  const hasResult = job.steps.some(step => !step.intermediate && step.output && project.chapters.some(chapter => chapter.id === step.chapterId));
  return <Stack gap="xl">
    <Stack gap={8} align="flex-end">
      <Paper className="writing-chat-request" p="md" radius="lg" shadow="none" withBorder={false} maw="92%">
        <Stack gap="xs"><Text size="sm" fw={600}>{taskNames[job.kind]} · {job.steps.filter(step => !step.intermediate).map(step => project.chapters.find(chapter => chapter.id === step.chapterId)?.title ?? step.title).join('、')}{job.targetWords ? ` · ${job.targetWords.toLocaleString()} 字` : ''}</Text>{job.instruction && <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{job.instruction}</Text>}</Stack>
      </Paper>
      <Text size="xs" c="dimmed">{new Date(job.createdAt).toLocaleString('zh-CN')} · {job.ai?.model ?? 'AI 未设置'}</Text>
    </Stack>
    <Stack gap="md">
      {steps.map(step => <StepActivity key={step.id} job={job} step={step} store={store} />)}
      {generating && <Group gap="sm" px="xs" role="status"><Loader size={16} /><Text size="sm" c="dimmed">{steps.length ? '创作任务进行中' : job.status === 'queued' ? '任务排队中' : '正在读取任务资料'}</Text></Group>}
    </Stack>
    {completed && <Stack gap="xs" px="xs" role="status"><Group gap="sm"><Check size={19} color="var(--mantine-color-teal-7)" /><Text size="sm" fw={500}>创作任务已完成</Text></Group><Group gap="md" pl={27}>{hasResult && <Anchor component="button" size="sm" onClick={() => onResult(job.id)}>查看生成稿</Anchor>}</Group></Stack>}
    {['paused', 'failed'].includes(job.status) && <Text size="sm" c={job.status === 'failed' ? 'red.8' : 'dimmed'} role="status">{job.status === 'failed' ? '创作任务失败' : '创作任务已停止'}</Text>}
    {job.error && <Text size="sm" c="red.8" role="alert">{job.error}</Text>}
    <Group justify="flex-end" gap="xs" px="lg" py="sm" className="writing-chat-controls">
      {generating ? <Button icon={Pause} onClick={() => store.stop(job.id)}>停止</Button> : <>
        {['paused', 'failed'].includes(job.status) && <><IconButton icon={Settings2} label="任务 AI 设置" onClick={() => setAIOpen(true)} /><Button icon={Play} onClick={() => store.resumeJob(job.id)}>继续生成</Button><Button icon={RefreshCw} onClick={() => store.resumeJob(job.id, true)}>重试当前步骤</Button></>}
        <IconButton icon={Trash2} label="删除任务" onClick={() => store.update(state => { state.jobs = state.jobs.filter(item => item.id !== job.id); })} />
      </>}
    </Group>
    <ModalPresence>{aiOpen && <JobAIEditor store={store} onClose={() => setAIOpen(false)} />}</ModalPresence>
  </Stack>;
}

function ActivityPanel({ label, children }: { label: string; children: ReactNode }) {
  return <Accordion.Panel><ScrollArea.Autosize mah="min(400px, 50vh)" type="auto" scrollbars="y" offsetScrollbars overscrollBehavior="contain" viewportProps={{ role: 'region', 'aria-label': label, tabIndex: 0 }}>{children}</ScrollArea.Autosize></Accordion.Panel>;
}

function StepActivity({ job, step, store }: { job: Job; step: JobStep; store: Store }) {
  const finished = ['ready', 'accepted'].includes(step.status);
  const running = step.status === 'running';
  const stage = writingStageName(job, step);
  const status = finished ? '已完成' : running ? step.reasoning && !step.output ? '分析中' : '生成中' : '已中断';
  return <Accordion multiple variant="default" chevron={<ChevronRight size={16} />} chevronPosition="left" className="writing-activity" styles={{ item: { border: 0 }, control: { padding: '8px 4px', borderRadius: 8 }, label: { padding: 0, order: 2 }, icon: { order: 1, marginInlineStart: 0, marginInlineEnd: 10 }, panel: { paddingLeft: 32 }, content: { padding: '8px 12px 16px' }, chevron: { marginInlineStart: 0, marginInlineEnd: 8 } }}>
    {(step.execution || step.reasoning) && <Accordion.Item value="analysis"><Accordion.Control icon={<Sparkles size={18} />}><Group justify="space-between" wrap="nowrap" gap="sm"><Text size="sm" fw={500}>任务分析 · {step.title}</Text>{finished || step.output ? <Check size={16} color="var(--mantine-color-teal-7)" /> : running ? <Loader size={14} /> : <Pause size={16} />}</Group></Accordion.Control><ActivityPanel label={`任务分析 · ${step.title}`}><Stack gap="sm">{step.execution?.summary && <Text size="sm" c="dimmed">{step.execution.summary}</Text>}{step.reasoning && <Markdown size="sm" onError={store.notify}>{step.reasoning}</Markdown>}</Stack></ActivityPanel></Accordion.Item>}
    {step.execution?.skills.map(skill => <Accordion.Item key={skill.id} value={`skill-${skill.id}`}><Accordion.Control icon={<Puzzle size={18} color="var(--mantine-color-teal-7)" />}><Group justify="space-between" wrap="nowrap" gap="sm"><Text size="sm">Skill · {skill.name}</Text><Check size={16} color="var(--mantine-color-teal-7)" /></Group></Accordion.Control><ActivityPanel label={`Skill · ${skill.name}`}><Stack gap="md"><Text size="xs" c="dimmed">版本 {skill.version}</Text>{writingSkillFiles(skill, store.state.skills).map(file => <Stack gap="xs" key={file.path}><Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>{file.path}</Text>{file.content ? <Markdown size="sm" onError={store.notify}>{file.content}</Markdown> : <EmptyState minHeight={100}>暂无内容</EmptyState>}</Stack>)}</Stack></ActivityPanel></Accordion.Item>)}
    <Accordion.Item value="generation"><Accordion.Control icon={<FileText size={18} />}><Group justify="space-between" wrap="nowrap" gap="sm"><Group gap="sm"><Text size="sm" fw={500}>生成{stage} · {step.title.replace(/ · (细纲|摘要|记忆)$/, '')}</Text>{step.output && <Text size="xs" c="dimmed">{wordCount(step.output).toLocaleString()} 字</Text>}</Group><Group gap="xs" wrap="nowrap"><Text size="xs" c="dimmed">{status}</Text>{finished ? <Check size={16} color="var(--mantine-color-teal-7)" /> : running ? <Loader size={14} /> : <Pause size={16} />}</Group></Group></Accordion.Control><ActivityPanel label={`生成${stage} · ${step.title}`}>{step.output ? <JobResult output={step.output} generating={running} preparation={false} memory={step.stage === 'memory'} sourceText="" onError={store.notify} onCitation={() => {}} /> : <EmptyState minHeight={100}>{running ? '正在生成' : '暂无生成内容'}</EmptyState>}</ActivityPanel></Accordion.Item>
  </Accordion>;
}
