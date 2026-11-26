import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Accordion, Badge, Button, Group, List, Loader, Modal, Progress, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Download, History, RefreshCw, X } from './icons';
import { createAppUpdater, updatePercent, type UpdateState } from './appUpdate';
import { updateRecords } from './releaseNotes';
import { EmptyState } from './components';
import type { Store } from './useWorkspace';

export function updateLabel(state: UpdateState) {
  switch (state.status) {
    case 'checking': return '检查中';
    case 'current': return '更新记录';
    case 'unpublished': return '更新记录';
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
  const [opened, setOpened] = useState(false);
  const announced = useRef('');
  useEffect(() => {
    if (!store.loaded) return;
    controller.start();
    let disposed = false;
    const focusListener = getCurrentWindow().onFocusChanged(({ payload }) => { if (payload && !disposed) controller.refresh(); }).catch(() => undefined);
    const reconnect = () => { void controller.check(true); };
    window.addEventListener('online', reconnect);
    return () => {
      disposed = true;
      void focusListener.then(unlisten => unlisten?.());
      window.removeEventListener('online', reconnect);
      controller.stop();
    };
  }, [controller, store.loaded]);
  useEffect(() => { if (state.currentVersion) onVersion(state.currentVersion); }, [state.currentVersion, onVersion]);
  useEffect(() => {
    if (state.status !== 'available' || announced.current === state.version) return;
    announced.current = state.version;
    if (!opened) notifications.show({ title: `发现新版本 ${state.version}`, message: updateRecords(state)[0]?.changes[0] || '可在更新记录中查看。', autoClose: 10000, closeButtonProps: { icon: <X size={18} />, 'aria-label': '关闭更新提示' } });
  }, [state, opened]);
  const installing = state.status === 'installing' || state.status === 'restarting';
  const loading = state.status === 'checking' || state.status === 'downloading' || installing;
  const title = state.error || (state.version ? `StoryAgent ${state.currentVersion} → ${state.version}` : state.currentVersion ? `StoryAgent ${state.currentVersion}` : '检查更新');
  const records = updateRecords(state);
  const percent = updatePercent(state);
  const openRecords = () => { setOpened(true); if (!state.version) void controller.check(); };
  const activate = () => { if (state.status !== 'waiting') setOpened(false); void controller.activate(); };
  return <>
    <Group gap="sm" wrap="nowrap" aria-live="polite">
      {state.status === 'waiting' && <Text size="sm" c="dimmed">等待任务完成</Text>}
      <Tooltip label={title}>
        <Button variant={state.version ? 'filled' : 'subtle'} color={state.status === 'error' ? 'red' : state.version ? 'story' : 'gray'} disabled={installing || !store.loaded} onClick={openRecords} leftSection={loading ? <Loader size={16} color={state.version ? 'white' : 'story'} /> : state.version ? <Download size={18} /> : <History size={18} />}>{state.status === 'waiting' ? '等待更新' : updateLabel(state)}</Button>
      </Tooltip>
    </Group>
    <Modal opened={opened && !installing} onClose={() => setOpened(false)} title="更新记录" size="lg" closeButtonProps={{ icon: <X size={20} />, 'aria-label': '关闭更新记录' }}>
      <Stack gap="lg">
        <Group justify="space-between"><Text size="sm" c="dimmed">当前版本 {state.currentVersion || '—'}</Text>{state.status === 'current' && <Text size="sm" c="dimmed">已是最新版本</Text>}{state.status === 'unpublished' && <Text size="sm" c="dimmed">暂无发布版本</Text>}</Group>
        <ScrollArea.Autosize mah="min(52vh, 460px)" offsetScrollbars>
          {records.length ? <Accordion key={records[0].version} variant="separated" multiple defaultValue={[records[0].version]}>
            {records.map(record => <Accordion.Item key={record.version} value={record.version}>
              <Accordion.Control><Group gap="sm"><Text size="md" fw={600}>{record.version}</Text>{record.date && <Text size="xs" c="dimmed">{record.date}</Text>}{record.version === state.version && <Badge color="story">新版本</Badge>}</Group></Accordion.Control>
              <Accordion.Panel>{record.changes.length ? <List spacing="xs" size="sm" styles={{ item: { lineHeight: 1.7, overflowWrap: 'anywhere' } }}>{record.changes.map(change => <List.Item key={change}>{change}</List.Item>)}</List> : <EmptyState>暂无更新记录</EmptyState>}</Accordion.Panel>
            </Accordion.Item>)}
          </Accordion> : <EmptyState>暂无更新记录</EmptyState>}
        </ScrollArea.Autosize>
        {state.error && <Text size="sm" c="red.8" role="alert">{state.error}</Text>}
        {state.status === 'downloading' && <Progress value={percent ?? 0} animated={percent === undefined} aria-label="更新下载进度" />}
        {state.status === 'waiting' && <Text size="sm" c="dimmed">等待任务完成</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setOpened(false)}>关闭</Button>
          {state.version ? <Button disabled={loading} onClick={activate} leftSection={<Download size={18} />}>{state.status === 'available' ? '立即更新' : updateLabel(state)}</Button> : <Button loading={state.status === 'checking'} onClick={() => void controller.check()} leftSection={<RefreshCw size={18} />}>{state.status === 'error' ? '重试检查' : '检查更新'}</Button>}
        </Group>
      </Stack>
    </Modal>
    <Modal opened={installing} onClose={() => {}} title="更新软件" withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false} size="sm">
      <Stack align="center" py="lg"><Loader /><Text size="sm">{state.status === 'restarting' ? '正在重启' : '正在保存并安装更新'}</Text></Stack>
    </Modal>
  </>;
}
