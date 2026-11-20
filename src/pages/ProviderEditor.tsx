import { useEffect, useRef, useState } from 'react';
import { Accordion, Alert, Group, ScrollArea, SimpleGrid, Stack, Text } from '@mantine/core';
import { Badge, Button, Checkbox, EmptyState, Field, Modal, NumberInput, Select, Textarea, TextInput, type ModalVisibilityProps } from '../components';
import { type Provider, MAX_AI_RETRIES, validateProvider } from '../domain';
import { getModels } from '../ai';
import { ChevronDown, Plus, RefreshCw } from '../icons';

export const protocols = [{ value: 'chat', label: 'OpenAI 兼容' }, { value: 'responses', label: 'OpenAI Responses' }, { value: 'anthropic', label: 'Anthropic' }, { value: 'gemini', label: 'Gemini' }];

export function ProviderEditor({ initial, onSave, onClose, ...visibility }: { initial: Provider; onSave: (provider: Provider, apiKey?: string) => Promise<void>; onClose: () => void } & ModalVisibilityProps) {
  const [provider, setProvider] = useState(() => structuredClone(initial));
  const [available, setAvailable] = useState(initial.models);
  const [secret, setSecret] = useState(''), [changeKey, setChangeKey] = useState(false);
  const [fetching, setFetching] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [query, setQuery] = useState(''), [manualModel, setManualModel] = useState('');
  const request = useRef<AbortController | null>(null);
  const cancel = () => { request.current?.abort(); request.current = null; setFetching(false); };
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { if (visibility.opened === false) { request.current?.abort(); request.current = null; setFetching(false); } }, [visibility.opened]);
  const changeEndpoint = (next: Partial<Provider>) => { cancel(); setError(''); setQuery(''); setAvailable([]); setProvider(p => ({ ...p, ...next, models: [] })); };
  const fetchModels = async () => {
    if (fetching) { cancel(); return; }
    const active = new AbortController(); request.current = active;
    setFetching(true); setError('');
    try {
      const models = await getModels(provider, active.signal, changeKey ? secret : undefined);
      if (!active.signal.aborted) { setAvailable(models); setQuery(''); }
    } catch (e) { if (!active.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request.current === active) { request.current = null; setFetching(false); } }
  };
  const save = async () => {
    if (saving || fetching) return;
    setError('');
    try {
      const value = { ...provider, name: provider.name.trim(), baseUrl: provider.baseUrl.trim(), models: [...new Set(provider.models.map(m => m.trim()).filter(Boolean))], hasKey: changeKey ? !!secret.trim() : provider.hasKey };
      validateProvider(value);
      setSaving(true);
      await onSave(value, changeKey ? secret.trim() : undefined);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const toggleModel = (model: string, checked: boolean) => setProvider(p => ({ ...p, models: checked ? [...new Set([...p.models, model])] : p.models.filter(m => m !== model) }));
  const addModel = () => {
    const model = manualModel.trim();
    if (!model) return;
    setAvailable(items => [...new Set([...items, model])]); toggleModel(model, true); setManualModel(''); setQuery('');
  };
  const models = [...new Set([...available, ...provider.models])].filter(model => model.toLowerCase().includes(query.toLowerCase()));
  const advanced = provider.advanced;
  const changeAdvanced = (patch: Partial<Provider['advanced']>) => setProvider(p => ({ ...p, advanced: { ...p.advanced, ...patch } }));
  return <Modal title="AI 供应商" wide onClose={() => { if (!saving) { cancel(); onClose(); } }} {...visibility} footer={<><Button disabled={saving} onClick={() => { cancel(); onClose(); }}>取消</Button><Button primary disabled={saving || fetching || !provider.name.trim() || !provider.baseUrl.trim() || !provider.models.length} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button></>}>
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Field label="名称"><TextInput data-autofocus disabled={saving} value={provider.name} onChange={e => setProvider({ ...provider, name: e.target.value })} placeholder="供应商名称" /></Field>
        <Select label="协议" disabled={saving} value={provider.protocol} onChange={value => changeEndpoint({ protocol: value as Provider['protocol'] })} options={protocols} />
      </SimpleGrid>
      <Field label="API 地址"><TextInput type="url" disabled={saving} value={provider.baseUrl} onChange={e => changeEndpoint({ baseUrl: e.target.value })} placeholder={provider.protocol === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : provider.protocol === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'} /></Field>
      <Field label="API 密钥"><TextInput type="password" autoComplete="new-password" disabled={saving} value={secret} placeholder={provider.hasKey && !changeKey ? '已设置，输入新密钥以替换' : 'API 密钥'} onChange={e => { cancel(); setSecret(e.target.value); setChangeKey(true); setError(''); }} /></Field>
      {provider.hasKey && !changeKey && <Group><Button danger disabled={saving} onClick={() => { cancel(); setSecret(''); setChangeKey(true); }}>清除密钥</Button></Group>}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Field label="AI 并发数量"><NumberInput disabled={saving} min={1} max={16} allowDecimal={false} value={provider.concurrency ?? 2} onChange={value => setProvider({ ...provider, concurrency: Number(value) })} /></Field>
        <Field label="失败重试次数"><NumberInput disabled={saving || fetching} min={0} max={MAX_AI_RETRIES} allowDecimal={false} value={provider.maxRetries} onChange={value => setProvider({ ...provider, maxRetries: Number(value) })} /></Field>
      </SimpleGrid>
      <Stack gap="sm">
        <Group justify="space-between"><Group gap="xs"><Text fw={500}>可用模型</Text><Badge>已选 {provider.models.length}</Badge></Group><Button icon={RefreshCw} disabled={saving || !provider.baseUrl.trim()} onClick={() => void fetchModels()}>{fetching ? '停止获取' : '获取模型'}</Button></Group>
        <TextInput aria-label="搜索模型" placeholder="搜索模型" value={query} onChange={e => setQuery(e.target.value)} />
        <ScrollArea.Autosize mah={200} type="auto" offsetScrollbars><Stack gap="sm" py={4}>
          {models.map(model => <Checkbox key={model} label={model} checked={provider.models.includes(model)} disabled={saving} onChange={e => toggleModel(model, e.currentTarget.checked)} styles={{ label: { overflowWrap: 'anywhere' }, body: { alignItems: 'flex-start' } }} />)}
          {!models.length && <EmptyState minHeight={80}>{fetching ? '正在获取模型…' : query ? '暂无匹配模型' : '暂无模型'}</EmptyState>}
        </Stack></ScrollArea.Autosize>
        <Group align="flex-end" wrap="nowrap"><Field label="模型 ID" className="item-main"><TextInput placeholder="手动添加模型" value={manualModel} disabled={saving} onChange={e => setManualModel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addModel(); } }} /></Field><Button icon={Plus} disabled={saving || !manualModel.trim()} onClick={addModel}>添加</Button></Group>
      </Stack>
      <Accordion variant="separated" chevron={<ChevronDown size={18} />}><Accordion.Item value="advanced"><Accordion.Control>高级</Accordion.Control><Accordion.Panel><Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Field label="输出上限（Token）"><NumberInput disabled={saving} min={256} max={200000} allowDecimal={false} value={advanced.maxTokens} onChange={maxTokens => changeAdvanced({ maxTokens: Number(maxTokens) })} /></Field>
          <Field label="上下文上限（字符）"><NumberInput disabled={saving} min={4000} max={500000} allowDecimal={false} value={advanced.contextChars} onChange={contextChars => changeAdvanced({ contextChars: Number(contextChars) })} /></Field>
        </SimpleGrid>
        <Checkbox disabled={saving} checked={advanced.sampling} onChange={e => changeAdvanced({ sampling: e.currentTarget.checked })} label="设置采样温度" />
        {advanced.sampling && <Field label="采样温度"><NumberInput disabled={saving} step={0.1} min={0} max={provider.protocol === 'anthropic' ? 1 : 2} value={advanced.temperature} onChange={temperature => changeAdvanced({ temperature: Number(temperature) })} /></Field>}
        <Field label="附加参数（JSON）"><Textarea disabled={saving} className="code" rows={4} value={advanced.extra} onChange={e => changeAdvanced({ extra: e.target.value })} /></Field>
      </Stack></Accordion.Panel></Accordion.Item></Accordion>
      {error && <Alert color="red" role="alert">{error}</Alert>}
    </Stack>
  </Modal>;
}
