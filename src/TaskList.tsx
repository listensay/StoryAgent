import { Badge, Group, Popover, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { Feather } from './icons';
import { EmptyState } from './components';
import { taskNames, type Job } from './domain';

const labels: Record<Job['status'], string> = { queued: '排队中', running: '进行中', waiting: '待评分', paused: '已停止', failed: '失败', ready: '待确认', accepted: '已完成' };
const progress = (job: Job) => {
  const collection = job.collectionTask ?? (job.articleTask?.mode !== 'catalog' ? job.articleTask : undefined);
  return collection ? `${collection.done} / ${collection.total || '…'} 章` : `${job.steps.filter(s => ['ready', 'accepted'].includes(s.status)).length} / ${job.steps.length}`;
};
export function TaskList({ jobs, onOpen }: { jobs: Job[]; onOpen: (job: Job) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = () => { clearTimeout(timer.current); setOpened(true); };
  const hide = () => { timer.current = setTimeout(() => setOpened(false), 220); };
  const [opened, setOpened] = useState(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const active = jobs.filter(j => ['running', 'queued', 'waiting'].includes(j.status)).length;
  return <Popover width={380} position="right-start" shadow="md" opened={opened} onClose={() => setOpened(false)}>
    <Popover.Target><UnstyledButton onMouseEnter={show} onMouseLeave={hide} onClick={show} onFocus={show} onKeyDown={e => { if (e.key === 'Escape') setOpened(false); }} aria-label="StoryAgent 任务列表" aria-expanded={opened}><Group gap={6} wrap="nowrap"><Feather size={24} color="#c64700" /><Text fw={600} size="lg">StoryAgent</Text>{active > 0 && <Badge size="sm" variant="light" px={5}>{active > 99 ? '99+' : active}</Badge>}</Group></UnstyledButton></Popover.Target>
    <Popover.Dropdown onMouseEnter={show} onMouseLeave={hide}><Stack gap="md"><Group justify="space-between"><Text fw={600}>任务列表</Text><Text size="sm" c="dimmed">{jobs.length} 项</Text></Group><ScrollArea.Autosize mah={480} type="auto"><Stack gap="xs">{jobs.length ? jobs.map(job => <UnstyledButton key={job.id} p="sm" style={{ borderRadius: 8, background: 'var(--mantine-color-gray-0)' }} onClick={() => { onOpen(job); setOpened(false); }}><Stack gap={5}><Group justify="space-between" wrap="nowrap"><Text size="sm" fw={500}>{taskNames[job.kind]}</Text><Badge variant="light" color={job.status === 'failed' ? 'red' : ['running', 'queued'].includes(job.status) ? 'story' : 'gray'}>{labels[job.status]}</Badge></Group><Text size="sm" lineClamp={1}>{job.sourceTitle || job.steps.find(s => s.chapterId)?.title || taskNames[job.kind]}</Text><Text size="xs" c="dimmed">{progress(job)} · {new Date(job.createdAt).toLocaleString('zh-CN')}</Text></Stack></UnstyledButton>) : <EmptyState minHeight={160}>暂无任务</EmptyState>}</Stack></ScrollArea.Autosize></Stack></Popover.Dropdown>
  </Popover>;
}
