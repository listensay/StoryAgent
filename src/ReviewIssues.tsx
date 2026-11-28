import { useEffect, useRef, useState } from 'react';
import { Accordion, Badge, Blockquote, Group, Stack, Text } from '@mantine/core';
import type { Job, Project } from './domain';
import { Button, EmptyState, Modal, ModalPresence } from './components';
import { contentHash } from './memoryData';
import { reviewLabels, reviewRange, type ReviewIssue } from './reviewData';
import type { Store } from './useWorkspace';

const states = { open: '待处理', editing: '修改中', later: '稍后处理', ignored: '已忽略', resolved: '已确认解决' } as const;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
type Props = { job: Job; chapterId: string; project: Project; store: Store; onLocate?: (start: number, end: number) => void };

export function ReviewIssues({ job, chapterId, project, store, onLocate }: Props) {
  const step = job.steps.find(s => !s.intermediate && s.chapterId === chapterId), chapter = project.chapters.find(c => c.id === chapterId);
  const [activeId, setActive] = useState(''), [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  if (!step || !chapter) return null;
  if (!step.reviewIssues) return <Text size="sm" c="dimmed" mb="md">历史审稿保留原报告。重新审稿可逐项修订。</Text>;
  const issues = step.reviewIssues, active = issues.find(i => i.id === activeId), hash = contentHash(chapter.content);
  const change = (id: string, patch: Partial<ReviewIssue>, expectedHash?: string) => store.update(s => {
    const c = s.projects.find(p => p.id === project.id)?.chapters.find(c => c.id === chapterId);
    const i = s.jobs.find(j => j.id === job.id && j.projectId === project.id)?.steps.find(v => v.id === step.id)?.reviewIssues?.find(i => i.id === id);
    if (!i || !c) throw new Error('审稿或章节已移除');
    if (expectedHash && contentHash(c.content) !== expectedHash) throw new Error('正文已更新，请再次复查');
    Object.assign(i, patch);
  });
  const mark = (i: ReviewIssue, status: ReviewIssue['status']) => { try { change(i.id, { status, resolvedHash: status === 'resolved' ? hash : undefined }, status === 'resolved' ? hash : undefined); } catch (e) { store.notify(errorText(e)); } };
  const locate = (i: ReviewIssue, editing = false) => {
    const range = reviewRange(step.baseContent, chapter.content, i);
    if (!range) { store.notify('无法唯一定位原句，请在复查中对照正文'); return; }
    if (editing) mark(i, 'editing');
    onLocate?.(range.start, range.end);
  };
  const close = () => { controller.current?.abort(); setActive(''); };
  const recheck = async (i: ReviewIssue) => {
    if (controller.current) return;
    const request = new AbortController(); controller.current = request; setBusy(true);
    try { const checked = await store.recheckIssue(project.id, chapterId, i, request); if (!request.signal.aborted) change(i.id, { checked }, checked.hash); }
    catch (e) { if (!request.signal.aborted) store.notify(errorText(e)); }
    finally { controller.current = null; setBusy(false); }
  };
  const range = active && reviewRange(step.baseContent, chapter.content, active);
  return <Stack gap="md">
    {!issues.length && <EmptyState>本次审稿未列出问题</EmptyState>}
    {(['fact', 'expression'] as const).map(category => {
      const group = issues.filter(i => i.category === category);
      return !!group.length && <Stack key={category} gap={4}><Text fw={600}>{reviewLabels[category]}（{group.length}）</Text><Accordion variant="default" multiple>{group.map(i => <Accordion.Item key={i.id} value={i.id}>
        <Accordion.Control><Stack gap={4}><Text size="xs" c="dimmed">{i.status === 'resolved' && i.resolvedHash !== hash ? '正文已更新，待复核' : states[i.status]}</Text><Text size="sm" fw={500}>{i.reason}</Text></Stack></Accordion.Control>
        <Accordion.Panel><Stack gap="sm">{i.start < 0 && <Text size="xs" c="dimmed">报告引文未能在审稿时的正文中唯一定位</Text>}<Blockquote p="sm">{i.quote}</Blockquote><Text size="sm">{i.suggestion}</Text>
          <Group gap="xs"><Button disabled={!onLocate} onClick={() => locate(i)}>定位原文</Button><Button primary disabled={!onLocate} onClick={() => locate(i, true)}>修改</Button><Button onClick={() => setActive(i.id)}>复查</Button></Group>
          <Group gap="xs">{i.status !== 'ignored' && <Button onClick={() => mark(i, 'ignored')}>忽略</Button>}{i.status !== 'later' && <Button onClick={() => mark(i, 'later')}>稍后处理</Button>}{i.status !== 'open' && <Button onClick={() => mark(i, 'open')}>重新打开</Button>}</Group></Stack></Accordion.Panel>
      </Accordion.Item>)}</Accordion></Stack>;
    })}
    <ModalPresence>{active && <Modal title="复查问题" wide onClose={close} footer={<><Button onClick={close}>关闭</Button><Button disabled={busy} onClick={() => void recheck(active)}>{busy ? '复查中…' : 'AI 复查此项'}</Button><Button primary onClick={() => { mark(active, 'resolved'); close(); }}>确认解决</Button></>}>
      <Stack><Text fw={600}>{active.reason}</Text><Text size="sm">{active.suggestion}</Text><Text fw={500}>审稿时的引文</Text><Blockquote p="sm">{active.quote}</Blockquote>
        <Text fw={500}>当前正文</Text>{range ? <Blockquote p="sm">{chapter.content.slice(range.start, range.end) || '该处文字已删除'}</Blockquote> : <Text size="sm" c="dimmed">引文已变更或不唯一，请对照本章正文判断。</Text>}
        {active.checked && <><Group><Text fw={500}>复查意见</Text>{active.checked.hash !== hash && <Badge color="gray">基于旧正文</Badge>}</Group><Text size="sm">{active.checked.text}</Text></>}
      </Stack></Modal>}</ModalPresence>
  </Stack>;
}
