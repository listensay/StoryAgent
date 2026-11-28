import { useMemo, useState } from 'react';
import { Box, Group, ScrollArea, Stack, Tabs, Text } from '@mantine/core';
import { type Job, type JobStep, type Project, taskNames, wordCount } from './domain';
import { type Store } from './useWorkspace';
import { Badge, Button, Diff, EmptyState, IconButton, Modal, ModalPresence } from './components';
import { Check, Copy, GitCompare, Pause, Play, RefreshCw, Settings2, Trash2 } from './icons';
import { JobAIEditor, JobResult } from './JobCard';
import { canAcceptWritingStep, writingComparison } from './jobWorkflow';
import { ParagraphReview } from './ParagraphReview';
import { canAdoptMore, isManuscript } from './paragraphAdoption';
import { ReviewIssues } from './ReviewIssues';

export const writingStatuses: Record<Job['status'], string> = { queued: '排队中', running: '进行中', waiting: '待评分', paused: '已停止', failed: '失败', ready: '待采用', accepted: '已采用' };
const stageNames: Record<string, string> = { plan: '细纲', draft: '正文', continue: '续写', rewrite: '改写', summary: '摘要', memory: '记忆' };
const stepStatuses: Record<JobStep['status'], string> = { pending: '等待生成', running: '正在生成', ready: '已生成', accepted: '已采用' };

export function WritingResult({ job, chapterId, project, store, onLocate }: { job: Job; chapterId: string; project: Project; store: Store; onLocate?: (start: number, end: number) => void }) {
  const steps = job.steps.filter(step => step.chapterId === chapterId);
  const chapter = project.chapters.find(c => c.id === chapterId);
  const [stepId, setStepId] = useState<string>();
  const [compareId, setCompareId] = useState<string>();
  const [reviewOpen, setReviewOpen] = useState(false), [recordOpen, setRecordOpen] = useState(false);
  const [aiOpen, setAIOpen] = useState(false);
  const main = steps.find(step => !step.intermediate);
  const step = steps.find(step => step.id === stepId) ?? (main?.output ? main : steps.find(step => step.status === 'running') ?? main ?? steps[0]);
  const compare = steps.find(step => step.id === compareId);
  const generating = ['queued', 'running'].includes(job.status);
  const remaining = useMemo(() => !!step && canAdoptMore(job, step), [job, step]);
  const canAccept = !!step && (canAcceptWritingStep(job, step) || remaining);
  const manuscript = !!step && isManuscript(job, step);
  const canCompare = !!step?.output && (step.stage === 'plan' || manuscript || job.kind === 'plan');
  const active = job.steps.find(step => step.status === 'running') ?? job.steps.find(step => step.status === 'pending');
  const copy = async () => { try { await navigator.clipboard.writeText(step.output); store.notify('已复制'); } catch { store.notify('复制失败'); } };
  const reviewReady = job.kind === 'review' && !!main?.output && ['ready', 'accepted'].includes(main.status);

  return <Stack gap={0} className="writing-result">
    <Stack gap="xs" px="md" py="sm" style={{ flexShrink: 0 }}>
      <Group justify="space-between"><Text fw={600}>{taskNames[job.kind]}</Text><Badge color={job.status === 'failed' ? 'red' : generating ? 'story' : 'gray'}>{main?.paragraphAdoption ? '已逐段采用' : writingStatuses[job.status]}</Badge></Group>
      <Text size="sm" c="dimmed" role="status">{generating && active ? `正在生成${stageNames[active.stage ?? ''] ?? taskNames[job.kind]} · ${job.steps.filter(step => ['ready', 'accepted'].includes(step.status)).length} / ${job.steps.length}` : `${new Date(job.createdAt).toLocaleString('zh-CN')} · ${job.ai?.model ?? 'AI 未设置'}`}</Text>
      {steps.length > 1 && <Tabs value={step?.id} onChange={value => setStepId(value ?? undefined)}><Tabs.List aria-label="生成步骤">{steps.map(item => <Tabs.Tab key={item.id} value={item.id} rightSection={['ready', 'accepted'].includes(item.status) ? <Check size={14} /> : undefined}>{main?.paragraphAdoption && ['summary', 'memory'].includes(item.stage ?? '') ? '整稿' : ''}{stageNames[item.stage ?? ''] ?? taskNames[job.kind]}</Tabs.Tab>)}</Tabs.List></Tabs>}
    </Stack>
    {step ? <ScrollArea key={step.id} type="auto" scrollbars="y" offsetScrollbars className="writing-result-scroll" viewportProps={{ tabIndex: 0, role: 'region', 'aria-label': '生成稿内容' }}><Box className="writing-result-content">
      {reviewReady && step.id === main?.id && <ReviewIssues job={job} chapterId={chapterId} project={project} store={store} onLocate={onLocate} />}
      {reviewReady && step.id === main?.id && main.reviewIssues ? null : step.output ? <JobResult output={step.output} generating={step.status === 'running'} preparation={false} textSize="md" memory={step.stage === 'memory'} sourceText="" onError={store.notify} onCitation={() => {}} /> : <EmptyState minHeight={160}>{step.status === 'pending' && ['paused', 'failed'].includes(job.status) ? '等待继续生成' : stepStatuses[step.status]}</EmptyState>}
    </Box></ScrollArea> : <EmptyState>本章暂无生成结果</EmptyState>}
    <Stack gap="sm" px="md" py="sm" className="writing-result-footer">
      {job.error && <Text c="red.8" size="sm" role="alert">{job.error}</Text>}
      <Group justify="space-between" gap="xs">
        <Group gap="xs">{step?.output && <><Text size="sm" c="dimmed">{wordCount(step.output).toLocaleString()} 字</Text><IconButton icon={Copy} label="复制生成结果" onClick={() => void copy()} /></>}{canCompare && <IconButton icon={GitCompare} label="对比生成稿" onClick={() => setCompareId(step.id)} />}</Group>
        <Group gap="xs">{generating ? <Button icon={Pause} onClick={() => store.stop(job.id)}>停止</Button> : <>{['paused', 'failed'].includes(job.status) && <><IconButton icon={Settings2} label="任务 AI 设置" onClick={() => setAIOpen(true)} /><Button icon={Play} onClick={() => store.resumeJob(job.id)}>继续生成</Button><Button icon={RefreshCw} onClick={() => store.resumeJob(job.id, true)}>重试当前步骤</Button></>}<IconButton icon={Trash2} label="删除任务" onClick={() => store.update(state => { state.jobs = state.jobs.filter(item => item.id !== job.id); })} /></>}
          {step?.paragraphAdoption && <Button onClick={() => setRecordOpen(true)}>采用记录</Button>}
          {canAccept && <Button primary icon={Check} onClick={() => manuscript ? setReviewOpen(true) : store.accept(job.id, step.id)}>{manuscript ? remaining ? '采用剩余段落' : '逐段采用' : job.kind === 'review' ? '保存参考' : '采用'}</Button>}
        </Group>
      </Group>
    </Stack>
    <ModalPresence>{reviewOpen && step && chapter && <ParagraphReview job={job} step={step} chapter={chapter} store={store} onClose={() => setReviewOpen(false)} />}</ModalPresence>
    <ModalPresence>{recordOpen && step?.paragraphAdoption && <Modal title="采用记录" bounded onClose={() => setRecordOpen(false)}><Diff left={step.baseContent} right={step.paragraphAdoption.content} leftTitle="采用前正文" rightTitle="采用后正文" highlightChanges onError={store.notify} /></Modal>}</ModalPresence>
    <ModalPresence>{compare && <Modal title={`${compare.title} · 对比`} wide bounded onClose={() => setCompareId(undefined)} footer={<Button onClick={() => setCompareId(undefined)}>关闭</Button>}><Diff {...writingComparison(job, compare, project)} highlightChanges onError={store.notify} /></Modal>}</ModalPresence>
    <ModalPresence>{aiOpen && <JobAIEditor store={store} onClose={() => setAIOpen(false)} />}</ModalPresence>
  </Stack>;
}
