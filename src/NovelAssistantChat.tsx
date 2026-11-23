import { useEffect, useMemo, useState } from 'react';
import { Accordion, Alert, Box, Center, Collapse, Group, Loader, Spoiler, Stack, Text } from '@mantine/core';
import { AIControls } from './AIControls';
import { Badge, Button, EmptyState, Modal, Paper, Textarea } from './components';
import { type Job, type Note, type Project, noteNames } from './domain';
import { Pause, RefreshCw, Settings2, Upload } from './icons';
import { Markdown } from './Markdown';
import { hasNovelChanges, novelFields, novelSnapshot, parseNovelResult } from './novelAssistant';
import { pickFiles } from './platform';
import { useAIScroll } from './useAIScroll';
import { type Store } from './useWorkspace';

export function NovelAssistant({ project, store, opened, onClose, onSettings }: { project: Project; store: Store; opened: boolean; onClose: () => void; onSettings: () => void }) {
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(false);
  const { contentRef, scrollToBottom } = useAIScroll();
  const jobs = store.state.jobs.filter(job => job.projectId === project.id && job.novelChat).reverse();
  const active = jobs.find(job => ['queued', 'running'].includes(job.status));
  const configured = !!store.state.aiSelection.providerId && !!store.state.aiSelection.model;
  useEffect(() => { if (opened) scrollToBottom(); }, [opened, jobs.length, active?.id, scrollToBottom]);
  const send = (instruction = message.trim()) => {
    if (!instruction || active) return;
    try { store.launch({ kind: 'revise', projectId: project.id, instruction }); setMessage(''); }
    catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  const importOutline = async () => {
    try {
      const files = await pickFiles();
      if (!files.length) return;
      const text = files.map(file => new TextDecoder().decode(file.bytes)).join('\n\n');
      const instruction = '根据以下新总纲统一更新小说信息、总纲、全部卷纲、人物及关系、世界设定、场景、分支和已有章节计划，处理与新总纲冲突的旧内容：\n\n' + text;
      if (instruction.length > 100000) throw new Error('总纲内容超过 100000 字符');
      setMessage(instruction);
    } catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  return <Modal title="小说 AI" wide opened={opened} onClose={onClose}>
    <Group justify="space-between"><Text size="sm" c="dimmed" lineClamp={1}>{project.title}</Text><Button icon={Settings2} aria-expanded={settings || !configured} onClick={() => setSettings(value => !value)}>AI 设置</Button></Group>
    <Collapse expanded={settings || !configured}><AIControls providers={store.state.providers} value={store.state.aiSelection} onChange={store.setAISelection} onSettings={onSettings} columns={2} /></Collapse>
    <Box h="clamp(220px, 45dvh, 520px)" style={{ overflowY: 'auto' }} role="log" aria-label="小说 AI 对话">
      <Stack ref={contentRef} gap="lg" mih="100%" pr="xs">
        {!jobs.length && <EmptyState>暂无对话</EmptyState>}
        {jobs.map(job => <Stack key={job.id} gap="sm">
          <Group justify="flex-end"><Paper p="md" shadow="none" bg="story.0" maw="90%"><Spoiler maxHeight={112} showLabel="展开" hideLabel="收起"><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{job.instruction}</Text></Spoiler></Paper></Group>
          <NovelReply job={job} project={project} store={store} busy={!!active} onRegenerate={() => send(job.instruction)} />
        </Stack>)}
      </Stack>
    </Box>
    <Stack gap="sm" pt="md" className="modal-footer">
      <Textarea label="修改要求" placeholder="粘贴新总纲，或描述需要统一调整的内容" value={message} onChange={event => setMessage(event.currentTarget.value)} autosize minRows={2} maxRows={5} maxLength={100000} data-autofocus onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && configured) { event.preventDefault(); send(); } }} />
      <Group justify="space-between"><Group gap="sm"><Button icon={Upload} disabled={!!active} onClick={() => void importOutline()}>导入总纲</Button><Button disabled={!!active || !configured || !project.outline.trim() || !!message.trim()} onClick={() => send('以当前故事总纲为准，统一更新简介、主题、读者定位、全部卷纲、人物及关系、世界设定、场景、分支和已有章节计划，处理与总纲冲突的旧内容。')}>按总纲同步</Button></Group>{active ? <Button icon={Pause} onClick={() => store.stop(active.id)}>停止回复</Button> : <Button primary disabled={!message.trim() || !configured} onClick={() => send()}>发送</Button>}</Group>
    </Stack>
  </Modal>;
}

function NovelReply({ job, project, store, busy, onRegenerate }: { job: Job; project: Project; store: Store; busy: boolean; onRegenerate: () => void }) {
  const step = job.steps[0];
  const pending = ['running', 'queued'].includes(job.status);
  const result = useMemo(() => {
    if (!['ready', 'accepted'].includes(job.status)) return;
    try { return parseNovelResult(step.output); } catch { return; }
  }, [step.output, job.status]);
  const current = novelSnapshot(project);
  const previousNotes = useMemo(() => {
    try { return JSON.parse(job.novelChat?.before ?? '{}').notes as Note[] | undefined; } catch { return undefined; }
  }, [job.novelChat?.before]);
  const stale = job.novelChat?.base !== current;
  const changes = result && hasNovelChanges(result);
  const fields = Object.entries(result?.project ?? {});
  const preview = result ? [
    ...fields.map(([key, value]) => ({ id: key, title: novelFields[key as keyof typeof novelFields], body: key === 'form' ? value === 'long' ? '长篇' : '短篇' : String(value) })),
    ...result.notes.map((note, index) => ({ id: `note-${index}`, title: `${note.id ? '更新' : '新增'}${noteNames[note.kind]} · ${note.title}`, body: `${note.source && note.target ? `${note.source} · ${note.target}\n\n` : ''}${note.body}` })),
    ...result.chapters.map((chapter, index) => ({ id: `chapter-${index}`, title: `${chapter.id && !chapter.plan ? '清空章节计划' : `${chapter.id ? '更新' : '新增'}章节`} · ${chapter.title ?? project.chapters.find(value => value.id === chapter.id)?.title ?? '章节计划'}`, body: chapter.plan })),
    ...result.removeNoteIds.map(id => { const note = previousNotes?.find(note => note.id === id) ?? project.notes.find(note => note.id === id); return { id: `remove-${id}`, title: `移除 · ${note?.title ?? '旧设定'}`, body: note?.body ?? '旧设定已移除' }; }),
  ] : [];
  return <Paper p="md" shadow="none"><Stack gap="md">
    <Group justify="space-between"><Text size="sm" fw={500}>小说 AI</Text>{job.status === 'accepted' && changes && <Badge color={job.novelChat?.undone ? 'gray' : 'green'}>{job.novelChat?.undone ? '已撤销' : '已采用'}</Badge>}</Group>
    {pending ? <Center mih={100} role="status"><Group gap="sm"><Loader size="sm" /><Text size="sm">{job.status === 'queued' ? '等待回复' : '正在调整小说'}</Text></Group></Center> : result ? <>
      <Markdown onError={store.notify}>{result.reply}</Markdown>
      {changes && <><Group gap="xs">{fields.length > 0 && <Badge>小说信息 {fields.length}</Badge>}{[...new Set(result.notes.map(note => note.kind))].map(kind => <Badge key={kind}>{noteNames[kind]} {result.notes.filter(note => note.kind === kind).length}</Badge>)}{result.chapters.length > 0 && <Badge>章节 {result.chapters.length}</Badge>}{result.removeNoteIds.length > 0 && <Badge color="red">移除 {result.removeNoteIds.length}</Badge>}</Group><Accordion variant="separated">{preview.map(item => <Accordion.Item key={item.id} value={item.id}><Accordion.Control>{item.title}</Accordion.Control><Accordion.Panel>{item.body ? <Markdown onError={store.notify}>{item.body}</Markdown> : <EmptyState minHeight={100}>暂无章节计划</EmptyState>}</Accordion.Panel></Accordion.Item>)}</Accordion></>}
      {changes && job.status !== 'accepted' && <Group justify="flex-end">{stale && <Text size="sm" c="dimmed">小说内容已更新</Text>}<Button disabled={busy} onClick={onRegenerate}>重新调整</Button><Button primary disabled={busy || stale} onClick={() => store.accept(job.id, step.id)}>采用全部调整</Button></Group>}
      {job.status === 'accepted' && job.novelChat?.before && !job.novelChat.undone && <Group justify="flex-end"><Button disabled={busy || current !== job.novelChat.appliedBase} onClick={() => store.undoNovelAdjustment(job.id)}>撤销此次调整</Button></Group>}
    </> : <Alert color={job.status === 'failed' ? 'red' : 'gray'} title={job.status === 'failed' ? '调整失败' : '回复已停止'}>{job.error && <Text size="sm">{job.error}</Text>}</Alert>}
    {['paused', 'failed'].includes(job.status) && <Group><Button icon={RefreshCw} disabled={busy} onClick={() => store.resumeJob(job.id, true)}>重新回复</Button></Group>}
  </Stack></Paper>;
}
