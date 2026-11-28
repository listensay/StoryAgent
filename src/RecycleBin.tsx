import { useState } from 'react';
import { Group, Stack, Text, Divider } from '@mantine/core';
import { Button, Confirm, EmptyState, Modal, ModalPresence, type ModalVisibilityProps } from './components';
import type { Store } from './useWorkspace';
import { purgeDeleted, restoreDeleted } from './recycle';

type Item = { projectId: string; chapterId?: string; title: string; label: string; time: string; parentDeleted?: boolean };
export function RecycleBin({ store, onClose, ...visibility }: { store: Store; onClose: () => void } & ModalVisibilityProps) {
  const [remove, setRemove] = useState<Item>();
  const s = store.state;
  const items: Item[] = (s.deletedProjects ?? []).map(d => ({ projectId: d.project.id, title: d.project.title, label: `小说，${d.project.chapters.length} 章`, time: d.deletedAt }));
  for (const d of s.deletedChapters ?? []) {
    const p = s.projects.find(p => p.id === d.projectId), title = p?.title ?? s.deletedProjects?.find(v => v.project.id === d.projectId)?.project.title;
    items.push({ projectId: d.projectId, chapterId: d.chapter.id, title: d.chapter.title, label: `${title ?? '已删除小说'}中的章节`, time: d.deletedAt, parentDeleted: !p });
  }
  const run = (item: Item, purge: boolean) => {
    try { store.update(s => (purge ? purgeDeleted : restoreDeleted)(s, item.projectId, item.chapterId)); store.notify(purge ? '已彻底删除' : '已恢复'); }
    catch (e) { store.notify(e instanceof Error ? e.message : String(e)); }
  };
  return <Modal title="回收站" wide onClose={onClose} {...visibility}>
    {!items.length ? <EmptyState>回收站为空</EmptyState> : <Stack>{items.sort((a, b) => b.time.localeCompare(a.time)).map(i => <Stack key={JSON.stringify([i.projectId, i.chapterId])} gap="xs"><Group justify="space-between"><div><Text fw={500}>{i.title}</Text><Text size="sm" c="dimmed">{i.label} · {new Date(i.time).toLocaleString('zh-CN')}</Text></div><Group gap="xs"><Button disabled={i.parentDeleted} onClick={() => run(i, false)}>{i.parentDeleted ? '先恢复小说' : '恢复'}</Button><Button danger onClick={() => setRemove(i)}>彻底删除</Button></Group></Group><Divider /></Stack>)}</Stack>}
    <ModalPresence>{remove && <Confirm title="彻底删除" content={`「${remove.title}」${remove.chapterId ? '' : '及其回收站中的章节'}将无法从回收站恢复。`} onConfirm={() => run(remove, true)} onClose={() => setRemove(undefined)} />}</ModalPresence>
  </Modal>;
}
