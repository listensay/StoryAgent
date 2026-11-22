import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Group, Loader, Modal, Stack, Text, Tooltip } from '@mantine/core';
import { Download, RefreshCw } from './icons';
import { createAppUpdater, updatePercent, type UpdateState } from './appUpdate';
import type { Store } from './useWorkspace';

export function updateLabel(state: UpdateState) {
  switch (state.status) {
    case 'checking': return '检查中';
    case 'current': return '已是最新版本';
    case 'unpublished': return '暂无发布版本';
    case 'available': return `更新至 ${state.version}`;
    case 'downloading': { const percent = updatePercent(state); return percent === undefined ? '下载中' : `下载中 ${percent}%`; }
    case 'waiting': return '取消更新';
    case 'ready': return '重启更新';
    case 'installing': return '安装中';
    case 'restarting': return '重启中';
    case 'error': return state.version ? '重试更新' : '重试检查';
    default: return '检查更新';
  }
}

export function AppUpdateButton({ store, onVersion }: { store: Store; onVersion: (version: string) => void }) {
  const [controller] = useState(() => createAppUpdater({ canRestart: store.canUpdate, prepareRestart: store.prepareUpdate, releaseRestart: store.cancelUpdate }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { if (!store.loaded) return; controller.start(); return () => controller.stop(); }, [controller, store.loaded]);
  useEffect(() => { if (state.currentVersion) onVersion(state.currentVersion); }, [state.currentVersion, onVersion]);
  const installing = state.status === 'installing' || state.status === 'restarting';
  const loading = state.status === 'checking' || state.status === 'downloading' || installing;
  const title = state.error || (state.version ? `StoryAgent ${state.currentVersion} → ${state.version}` : state.currentVersion ? `StoryAgent ${state.currentVersion}` : '检查更新');
  return <>
    <Group gap="sm" wrap="nowrap" aria-live="polite">
      {state.status === 'waiting' && <Text size="sm" c="dimmed">等待任务完成</Text>}
      <Tooltip label={title}>
        <Button variant={state.version ? 'light' : 'subtle'} color={state.status === 'error' ? 'red' : state.version ? 'story' : 'gray'} disabled={loading || !store.loaded} styles={loading ? { root: { color: 'var(--mantine-color-story-7)' } } : undefined} onClick={() => void controller.activate()} leftSection={loading ? <Loader size={16} color="story" /> : state.version ? <Download size={18} /> : <RefreshCw size={18} />}>{updateLabel(state)}</Button>
      </Tooltip>
    </Group>
    <Modal opened={installing} onClose={() => {}} title="更新软件" withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false} size="sm">
      <Stack align="center" py="lg"><Loader /><Text size="sm">{state.status === 'restarting' ? '正在重启' : '正在保存并安装更新'}</Text></Stack>
    </Modal>
  </>;
}
