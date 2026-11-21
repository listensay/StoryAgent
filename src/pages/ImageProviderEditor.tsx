import { useEffect, useRef, useState } from 'react';
import { Alert, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { Badge, Button, Checkbox, EmptyState, Field, Modal, TextInput, type ModalVisibilityProps } from '../components';
import { validateImageProvider, type ImageProvider } from '../coverData';
import { getImageModels } from '../coverGeneration';
import { Plus, RefreshCw } from '../icons';

export function ImageProviderEditor({ initial, onSave, onClose, ...visibility }: { initial: ImageProvider; onSave: (provider: ImageProvider, secret?: string) => Promise<void>; onClose: () => void } & ModalVisibilityProps) {
  const [provider, setProvider] = useState(() => structuredClone(initial));
  const [available, setAvailable] = useState(initial.models);
  const [secret, setSecret] = useState('');
  const [changeKey, setChangeKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [manualModel, setManualModel] = useState('');
  const request = useRef<AbortController | null>(null);
  const cancel = () => { request.current?.abort(); request.current = null; setFetching(false); };
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (visibility.opened === false) cancel(); }, [visibility.opened]);
  const fetchModels = async () => {
    if (fetching) { cancel(); return; }
    const active = new AbortController(); request.current = active;
    setFetching(true); setError('');
    try {
      const models = await getImageModels(provider, active.signal, changeKey ? secret.trim() : undefined);
      if (!active.signal.aborted) { setAvailable(models); setQuery(''); }
    } catch (e) { if (!active.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request.current === active) { request.current = null; setFetching(false); } }
  };
  const save = async () => {
    if (saving || fetching) return;
    try {
      const value = { ...provider, name: provider.name.trim(), models: [...new Set(provider.models.map(model => model.trim()).filter(Boolean))], baseUrl: provider.baseUrl.trim(), hasKey: changeKey ? !!secret.trim() : provider.hasKey };
      validateImageProvider(value);
      setSaving(true); setError('');
      await onSave(value, changeKey ? secret.trim() : undefined);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const toggleModel = (model: string, checked: boolean) => setProvider(p => ({ ...p, models: checked ? [...new Set([...p.models, model])] : p.models.filter(value => value !== model) }));
  const addModel = () => {
    const model = manualModel.trim(); if (!model) return;
    setAvailable(values => [...new Set([...values, model])]); toggleModel(model, true); setManualModel(''); setQuery('');
  };
  const models = [...new Set([...available, ...provider.models])].filter(model => model.toLowerCase().includes(query.toLowerCase()));
  const close = () => { if (!saving) { cancel(); onClose(); } };
  return <Modal title="图片供应商" wide onClose={close} {...visibility} footer={<><Button disabled={saving} onClick={close}>取消</Button><Button primary disabled={saving || fetching || !provider.name.trim() || !provider.baseUrl.trim() || !provider.models.length} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button></>}>
    <Stack gap="lg">
      <TextInput label="名称" data-autofocus value={provider.name} disabled={saving} onChange={e => setProvider({ ...provider, name: e.target.value })} placeholder="供应商名称" />
      <TextInput label="API 地址" type="url" value={provider.baseUrl} disabled={saving} onChange={e => { cancel(); setError(''); setQuery(''); setAvailable([]); setProvider({ ...provider, baseUrl: e.target.value, models: [] }); }} placeholder="https://api.openai.com/v1" />
      <TextInput label="API 密钥" type="password" autoComplete="new-password" value={secret} disabled={saving} placeholder={provider.hasKey && !changeKey ? '已设置，输入新密钥以替换' : 'API 密钥'} onChange={e => { cancel(); setSecret(e.target.value); setChangeKey(true); setError(''); }} />
      {provider.hasKey && !changeKey && <Group><Button danger disabled={saving} onClick={() => { cancel(); setSecret(''); setChangeKey(true); }}>清除密钥</Button></Group>}
      <Stack gap="sm">
        <Group justify="space-between"><Group gap="xs"><Text fw={500}>可用模型</Text><Badge>已选 {provider.models.length}</Badge></Group><Button icon={RefreshCw} disabled={saving || !provider.baseUrl.trim()} onClick={() => void fetchModels()}>{fetching ? '停止获取' : '获取模型'}</Button></Group>
        <TextInput aria-label="搜索模型" placeholder="搜索模型" value={query} disabled={saving} onChange={e => setQuery(e.target.value)} />
        <ScrollArea.Autosize mah={200} type="auto" offsetScrollbars><Stack gap="sm" py={4}>
          {models.map(model => <Checkbox key={model} label={model} checked={provider.models.includes(model)} disabled={saving} onChange={e => toggleModel(model, e.currentTarget.checked)} styles={{ label: { overflowWrap: 'anywhere' }, body: { alignItems: 'flex-start' } }} />)}
          {!models.length && <EmptyState minHeight={80}>{fetching ? '正在获取模型…' : query ? '暂无匹配模型' : '暂无模型'}</EmptyState>}
        </Stack></ScrollArea.Autosize>
        <Group align="flex-end" wrap="nowrap"><Field label="模型 ID" className="item-main"><TextInput placeholder="手动添加模型" value={manualModel} disabled={saving} onChange={e => setManualModel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addModel(); } }} /></Field><Button icon={Plus} disabled={saving || !manualModel.trim()} onClick={addModel}>添加</Button></Group>
      </Stack>
      {error && <Alert color="red" role="alert">{error}</Alert>}
    </Stack>
  </Modal>;
}
