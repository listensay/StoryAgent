import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Center, Collapse, Group, Loader, Stack, Text } from '@mantine/core';
import { AIControls } from './AIControls';
import { Badge, Button, EmptyState, Modal, Paper, Textarea, Title } from './components';
import { type Job, type Project, noteNames } from './domain';
import { Pause, RefreshCw, Settings2 } from './icons';
import { Markdown } from './Markdown';
import { hasPlanningChanges, parsePlanningResult, planningSnapshot } from './planning';
import { useAIScroll } from './useAIScroll';
import { type Store } from './useWorkspace';

export function PlanningChat({ project, store, opened, onClose, onSettings }: { project: Project; store: Store; opened: boolean; onClose: () => void; onSettings: () => void }) {
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(false);
  const { contentRef, scrollToBottom } = useAIScroll();
  const jobs = store.state.jobs.filter(job => job.projectId === project.id && job.planningChat).reverse();
  const active = jobs.find(job => ['queued', 'running'].includes(job.status));
  const configured = !!store.state.aiSelection.providerId && !!store.state.aiSelection.model;
  useEffect(() => { if (opened) scrollToBottom(); }, [opened, jobs.length, active?.id, scrollToBottom]);
  const send = () => {
    if (!message.trim() || active) return;
    try { store.launch({ kind: 'plan', projectId: project.id, instruction: message.trim(), planningChat: true }); setMessage(''); }
    catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  return <Modal title="AI 调整" wide opened={opened} onClose={onClose}>
    <Group justify="space-between"><Text size="sm" c="dimmed">故事规划</Text><Button icon={Settings2} aria-expanded={settings || !configured} onClick={() => setSettings(value => !value)}>AI 设置</Button></Group>
    <Collapse expanded={settings || !configured}><AIControls providers={store.state.providers} value={store.state.aiSelection} onChange={store.setAISelection} onSettings={onSettings} columns={2} /></Collapse>
    <Box h="clamp(200px, 45dvh, 520px)" style={{ overflowY: 'auto' }} role="log" aria-label="故事规划对话">
      <Stack ref={contentRef} gap="lg" mih="100%" pr="xs">
        {!jobs.length && <EmptyState>暂无对话</EmptyState>}
        {jobs.map(job => <Stack key={job.id} gap="sm">
          <Group justify="flex-end"><Paper p="md" shadow="none" bg="story.0" maw="90%"><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{job.instruction}</Text></Paper></Group>
          <PlanningReply job={job} project={project} store={store} busy={!!active} />
        </Stack>)}
      </Stack>
    </Box>
    <Stack gap="sm" pt="md" className="modal-footer">
      <Textarea label="修改意见" placeholder="描述需要调整的总纲、卷纲或章节计划" value={message} onChange={event => setMessage(event.currentTarget.value)} autosize minRows={2} maxRows={5} maxLength={8000} data-autofocus onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && configured) { event.preventDefault(); send(); } }} />
      <Group justify="flex-end">{active ? <Button icon={Pause} onClick={() => store.stop(active.id)}>停止回复</Button> : <Button primary disabled={!message.trim() || !configured} onClick={send}>发送</Button>}</Group>
    </Stack>
  </Modal>;
}

function PlanningReply({ job, project, store, busy }: { job: Job; project: Project; store: Store; busy: boolean }) {
  const step = job.steps[0];
  const pending = ['running', 'queued'].includes(job.status);
  const result = useMemo(() => {
    if (!['ready', 'accepted'].includes(job.status)) return;
    try { return parsePlanningResult(step.output); } catch { return; }
  }, [step.output, job.status]);
  const stale = job.planningChat?.base !== planningSnapshot(project);
  return <Paper p="md" shadow="none"><Stack gap="md">
    <Group justify="space-between"><Text size="sm" fw={500}>AI</Text>{job.status === 'accepted' && result && hasPlanningChanges(result) && <Badge color="green">已采用</Badge>}</Group>
    {pending ? <Center mih={100} role="status"><Group gap="sm"><Loader size="sm" /><Text size="sm">{job.status === 'queued' ? '等待回复' : '正在调整'}</Text></Group></Center> : result ? <>
      <Markdown onError={store.notify}>{result.reply}</Markdown>
      {result.outline && <Stack gap="sm"><Title order={4}>故事总纲</Title><Markdown onError={store.notify}>{result.outline}</Markdown></Stack>}
      {result.notes.map((note, index) => <Stack key={note.id ?? index} gap="sm"><Group gap="xs"><Badge>{noteNames[note.kind]}</Badge><Title order={4}>{note.title}</Title></Group><Markdown onError={store.notify}>{note.body}</Markdown></Stack>)}
      {result.chapters.map(chapter => <Stack key={chapter.id} gap="sm"><Title order={4}>{project.chapters.find(value => value.id === chapter.id)?.title ?? '章节计划'}</Title><Markdown onError={store.notify}>{chapter.plan}</Markdown></Stack>)}
      {hasPlanningChanges(result) && job.status !== 'accepted' && <Group justify="flex-end">{stale && <Text size="sm" c="dimmed">故事规划已更新</Text>}<Button primary disabled={busy || stale} onClick={() => store.accept(job.id, step.id)}>采用调整</Button></Group>}
    </> : <Alert color={job.status === 'failed' ? 'red' : 'gray'} title={job.status === 'failed' ? '回复失败' : '回复已停止'}>{job.error && <Text size="sm">{job.error}</Text>}</Alert>}
    {['paused', 'failed'].includes(job.status) && <Group><Button icon={RefreshCw} disabled={busy} onClick={() => store.resumeJob(job.id, true)}>重新回复</Button></Group>}
  </Stack></Paper>;
}
