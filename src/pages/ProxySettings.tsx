import { useEffect, useState } from 'react';
import { Box, Button, Group, Loader, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { EmptyState, Paper, Select, Title } from '../components';
import { detectProxy, saveWorkspace, validateProxySettings } from '../platform';
import { type ProxyDetection, type ProxySettings } from '../proxy';
import { type Store } from '../useWorkspace';

const modes = [{ value: 'system', label: '自动检测' }, { value: 'manual', label: '手动设置' }, { value: 'direct', label: '不使用代理' }];

export function ProxySettingsSection({ store }: { store: Store }) {
  const saved = store.state.proxy;
  const [draft, setDraft] = useState<ProxySettings>(saved);
  const [detection, setDetection] = useState<ProxyDetection>();
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState('');
  const [detectionTick, setDetectionTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft({ mode: saved.mode, url: saved.url }); }, [saved.mode, saved.url]);
  useEffect(() => {
    if (draft.mode !== 'system') return;
    let alive = true;
    setDetecting(true); setDetectionError('');
    void detectProxy().then(value => { if (alive) setDetection(value); })
      .catch(() => { if (alive) setDetectionError('代理检测失败'); })
      .finally(() => { if (alive) setDetecting(false); });
    return () => { alive = false; };
  }, [draft.mode, detectionTick]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const value = await validateProxySettings(draft);
      store.update(state => { state.proxy = value; });
      await saveWorkspace(store.stateRef.current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  const changed = draft.mode !== saved.mode || draft.url !== saved.url;
  const canSave = changed || !!error;
  const addresses = detection && [...new Set([detection.http, detection.https].filter((value): value is string => !!value))];

  return <Paper component="section" className="surface">
    <Group justify="space-between" mb="lg"><Title order={2}>网络代理</Title>{draft.mode === 'system' && <Button variant="default" disabled={detecting || saving} onClick={() => setDetectionTick(value => value + 1)}>检测代理</Button>}</Group>
    <Stack component="form" gap="md" onSubmit={event => { event.preventDefault(); if (canSave && !saving) void save(); }}>
      <SimpleGrid cols={draft.mode === 'manual' ? { base: 1, sm: 2 } : 1} spacing="lg">
        <Box maw={draft.mode === 'manual' ? undefined : 320}><Select label="代理模式" value={draft.mode} options={modes} disabled={saving} onChange={mode => { setDraft(value => ({ mode: mode as ProxySettings['mode'], url: mode === 'manual' ? value.url : saved.url })); setError(''); }} /></Box>
        {draft.mode === 'manual' && <TextInput label="代理地址" placeholder="http://127.0.0.1:7890" value={draft.url} disabled={saving} error={error || undefined} onChange={event => { setDraft(value => ({ ...value, url: event.target.value })); setError(''); }} />}
      </SimpleGrid>
      {draft.mode === 'system' && (detecting ? <Group mih={80} justify="center"><Loader size="sm" /><Text size="sm">检测中</Text></Group>
        : detectionError ? <Stack mih={80} justify="center" align="center"><Text size="sm" c="red" role="alert">{detectionError}</Text></Stack>
        : addresses?.length ? <Stack gap="xs" py="sm" aria-live="polite">{addresses.length === 1 && detection?.http && detection.https ? <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{addresses[0]}</Text> : <>{detection?.http && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>HTTP：{detection.http}</Text>}{detection?.https && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>HTTPS：{detection.https}</Text>}</>}</Stack>
        : <EmptyState minHeight={80}>未检测到代理</EmptyState>)}
      {error && draft.mode !== 'manual' && <Text size="sm" c="red" role="alert">{error}</Text>}
      <Group justify="flex-end"><Button type="submit" loading={saving} disabled={!canSave}>保存代理设置</Button></Group>
    </Stack>
  </Paper>;
}
