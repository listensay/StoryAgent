import { useEffect, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Button, EmptyState, Modal, ModalPresence, type ModalVisibilityProps } from './components';
import { listWorkspaceBackups, readWorkspaceBackup } from './platform';
import type { Workspace } from './domain';
import type { Store } from './useWorkspace';

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export function BackupHistory({ store, onClose, ...visibility }: { store: Store; onClose: () => void } & ModalVisibilityProps) {
  const [ids, setIds] = useState<number[]>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [item, setItem] = useState<{ id: number; data: Workspace }>();
  useEffect(() => { let live = true; listWorkspaceBackups().then(r => { if (live) setIds(r); }).catch(e => { if (live) setError(errorText(e)); }); return () => { live = false; }; }, []);
  const select = async (id: number) => { setError(''); setBusy(true); try { setItem({ id, data: await readWorkspaceBackup(id) }); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const restore = async () => { if (!item || busy) return; setBusy(true); setError(''); try { await store.replace(item.data); store.notify('已恢复工作区'); setItem(undefined); onClose(); } catch (e) { setError(errorText(e)); setItem(undefined); } finally { setBusy(false); } };
  return <Modal title="自动备份" wide onClose={() => { if (!busy) onClose(); }} {...visibility}>
    {error && <Text c="red.8" role="alert">{error}</Text>}
    <Stack>{ids?.map(id => <Group key={id} justify="space-between"><Text size="sm">{new Date(id).toLocaleString('zh-CN')}</Text><Button disabled={busy} onClick={() => void select(id)}>查看备份</Button></Group>)}{!ids?.length && !error && <EmptyState>{ids ? '暂无自动备份' : '读取中…'}</EmptyState>}</Stack>
    <ModalPresence>{item && <Modal title="恢复工作区" onClose={() => { if (!busy) setItem(undefined); }} footer={<><Button disabled={busy} onClick={() => setItem(undefined)}>取消</Button><Button primary disabled={busy} onClick={() => void restore()}>确认恢复</Button></>}>
      <Text>{new Date(item.id).toLocaleString('zh-CN')} 的备份包含 {item.data.projects.length} 部小说、{item.data.projects.reduce((n, p) => n + p.chapters.length, 0)} 章。确认替换当前工作区？</Text><Text c="dimmed" size="sm">{item.data.projects.slice(0, 6).map(p => p.title).join('、')}</Text>
    </Modal>}</ModalPresence>
  </Modal>;
}
