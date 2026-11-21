import { useState } from 'react';
import { Box, Group, ScrollArea, Stack, Tabs, Text } from '@mantine/core';
import { type Job, type JobStep, type Project, taskNames, wordCount } from './domain';
import { type Store } from './useWorkspace';
import { Badge, Button, Diff, EmptyState, IconButton, Modal, ModalPresence } from './components';
import { Check, Copy, GitCompare, Pause, Play, RefreshCw, Settings2, Trash2 } from './icons';
import { JobAIEditor, JobResult } from './JobCard';
import { canAcceptWritingStep, writingComparison } from './jobWorkflow';

export const writingStatuses: Record<Job['status'], string> = { queued: '排队中', running: '进行中', waiting: '待评分', paused: '已停止', failed: '失败', ready: '待采用', accepted: '已采用' };
const stageNames: Record<string, string> = { plan: '细纲', draft: '正文', continue: '续写', rewrite: '改写', summary: '摘要', memory: '记忆' };
const stepStatuses: Record<JobStep['status'], string> = { pending: '等待生成', running: '正在生成', ready: '已生成', accepted: '已采用' };

export function WritingResult({ job, chapterId, project, store }: { job: Job; chapterId: string; project: Project; store: Store }) {
  const steps = job.steps.filter(step => step.chapterId === chapterId);
  const [stepId, setStepId] = useState<string>();
  const [compareId, setCompareId] = useState<string>();
  const [aiOpen, setAIOpen] = useState(false);
  const main = steps.find(step => !step.intermediate);
  const step = steps.find(step => step.id === stepId) ?? (main?.output ? main : steps.find(step => step.status === 'running') ?? main ?? steps[0]);
  const compare = steps.find(step => step.id === compareId);
  const generating = ['queued', 'running'].includes(job.status);
  const canAccept = !!main && canAcceptWritingStep(job, main);
  const canCompare = !!step?.output && (step.stage === 'plan' || !step.intermediate && ['draft', 'continue', 'rewrite', 'plan'].includes(job.kind));
  const active = job.steps.find(step => step.status === 'running') ?? job.steps.find(step => step.status === 'pending');
  const copy = async () => { try { await navigator.clipboard.writeText(step.output); store.notify('已复制'); } catch { store.notify('复制失败'); } };

  return <Stack gap={0} className="writing-result">
    <Stack gap="sm" px="lg" py="md" style={{ flexShrink: 0 }}>
      <Group justify="space-between"><Text fw={600}>{taskNames[job.kind]}</Text><Badge color={job.status === 'failed' ? 'red' : generating ? 'story' : 'gray'}>{writingStatuses[job.status]}</Badge></Group>
      <Text size="sm" c="dimmed" role="status">{generating && active ? `正在生成${stageNames[active.stage ?? ''] ?? taskNames[job.kind]} · ${job.steps.filter(step => ['ready', 'accepted'].includes(step.status)).length} / ${job.steps.length}` : `${new Date(job.createdAt).toLocaleString('zh-CN')} · ${job.ai?.model ?? 'AI 未设置'}`}</Text>
      {!!steps.length && <Tabs value={step?.id} onChange={value => setStepId(value ?? undefined)}><Tabs.List aria-label="生成步骤">{steps.map(item => <Tabs.Tab key={item.id} value={item.id} rightSection={['ready', 'accepted'].includes(item.status) ? <Check size={14} /> : undefined}>{stageNames[item.stage ?? ''] ?? taskNames[job.kind]}</Tabs.Tab>)}</Tabs.List></Tabs>}
    </Stack>
    {step ? <ScrollArea key={step.id} type="always" scrollbars="y" offsetScrollbars className="writing-result-scroll" viewportProps={{ tabIndex: 0, role: 'region', 'aria-label': '生成稿内容' }}><Box className="writing-result-content">{step.output ? <JobResult output={step.output} generating={step.status === 'running'} preparation={false} textSize="md" memory={step.stage === 'memory'} sourceText="" onError={store.notify} onCitation={() => {}} /> : <EmptyState minHeight={240}>{step.status === 'pending' && ['paused', 'failed'].includes(job.status) ? '等待继续生成' : stepStatuses[step.status]}</EmptyState>}</Box></ScrollArea> : <EmptyState>本章暂无生成结果</EmptyState>}
    <Stack gap="sm" px="lg" py="md" className="writing-result-footer">
      {job.error && <Text c="red.8" size="sm" role="alert">{job.error}</Text>}
      <Group justify="space-between" gap="sm">
        <Group gap="xs">{step?.output && <><Text size="sm" c="dimmed">{wordCount(step.output).toLocaleString()} 字</Text><IconButton icon={Copy} label="复制生成结果" onClick={() => void copy()} /></>}{canCompare && <Button icon={GitCompare} onClick={() => setCompareId(step.id)}>对比</Button>}</Group>
        <Group gap="xs">{generating ? <Button icon={Pause} onClick={() => store.stop(job.id)}>停止</Button> : <>{['paused', 'failed'].includes(job.status) && <><IconButton icon={Settings2} label="任务 AI 设置" onClick={() => setAIOpen(true)} /><Button icon={Play} onClick={() => store.resumeJob(job.id)}>继续生成</Button><Button icon={RefreshCw} onClick={() => store.resumeJob(job.id, true)}>重试当前步骤</Button></>}<IconButton icon={Trash2} label="删除任务" onClick={() => store.update(state => { state.jobs = state.jobs.filter(item => item.id !== job.id); })} /></>}{canAccept && <Button primary icon={Check} onClick={() => store.accept(job.id, main.id)}>{job.kind === 'review' ? '保存参考' : '采用'}</Button>}</Group>
      </Group>
    </Stack>
    <ModalPresence>{compare && <Modal title={`${compare.title} · 对比`} wide bounded onClose={() => setCompareId(undefined)} footer={<><Button onClick={() => setCompareId(undefined)}>关闭</Button>{canAcceptWritingStep(job, compare) && <Button primary onClick={() => { store.accept(job.id, compare.id); setCompareId(undefined); }}>采用</Button>}</>}><Diff {...writingComparison(job, compare, project)} onError={store.notify} /></Modal>}</ModalPresence>
    <ModalPresence>{aiOpen && <JobAIEditor store={store} onClose={() => setAIOpen(false)} />}</ModalPresence>
  </Stack>;
}
