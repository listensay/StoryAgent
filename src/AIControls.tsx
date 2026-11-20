import { useEffect, useState } from 'react';
import { SimpleGrid, Stack } from '@mantine/core';
import { Button, EmptyState, Field, Modal, NumberInput, Select, type ModalVisibilityProps } from './components';
import { type AISelection, type Provider } from './domain';

function reasoningOptions(protocol?: Provider['protocol']) {
  return [{ value: 'off', label: '默认' },
    ...(protocol !== 'anthropic' ? [{ value: 'effort', label: '推理强度' }] : []),
    ...(['anthropic', 'gemini'].includes(protocol ?? '') ? [{ value: 'budget', label: '推理预算' }, { value: 'adaptive', label: '自适应' }] : [])];
}

function ReasoningBudget({ value, onChange }: { value: number; onChange: (budget: number) => void }) {
  const [draft, setDraft] = useState<string | number>(value);
  useEffect(() => setDraft(value), [value]);
  return <Field label="推理预算（Token）"><NumberInput min={1024} allowDecimal={false} value={draft} onChange={budget => {
    setDraft(budget);
    if (typeof budget === 'number' && Number.isSafeInteger(budget) && budget >= 1024) onChange(budget);
  }} onBlur={() => setDraft(value)} /></Field>;
}

export function AIControls({ providers, value, onChange, onSettings, columns = 1 }: { providers: Provider[]; value: AISelection; onChange: (value: AISelection) => void; onSettings?: () => void; columns?: number }) {
  const available = providers.filter(p => p.enabled && p.models.length);
  const provider = available.find(p => p.id === value.providerId);
  if (!available.length) return <Stack gap="sm" align="center"><EmptyState minHeight={80}>暂无可用的 AI 供应商</EmptyState>{onSettings && <Button onClick={onSettings}>设置 AI 供应商</Button>}</Stack>;
  return <SimpleGrid cols={{ base: 1, sm: columns }} spacing="md">
    <Select label="AI 供应商" placeholder="选择供应商" value={provider?.id ?? ''} options={available.map(p => ({ value: p.id, label: p.name }))} onChange={providerId => onChange({ ...value, providerId, model: providers.find(p => p.id === providerId)?.models.includes(value.model) ? value.model : '' })} />
    <Select label="模型" placeholder="选择模型" value={provider?.models.includes(value.model) ? value.model : ''} disabled={!provider} options={(provider?.models ?? []).map(model => ({ value: model, label: model }))} onChange={model => onChange({ ...value, model })} />
    <Select label="推理设置" value={value.reasoning} disabled={!provider} options={reasoningOptions(provider?.protocol)} onChange={reasoning => onChange({ ...value, reasoning: reasoning as AISelection['reasoning'] })} />
    {value.reasoning === 'effort' && <Select label="推理强度" value={value.effort} options={['low', 'medium', 'high', ...(provider?.protocol === 'gemini' ? [] : ['xhigh'])].map((v, i) => ({ value: v, label: ['低', '中', '高', '极高'][i] }))} onChange={effort => onChange({ ...value, effort: effort as AISelection['effort'] })} />}
    {value.reasoning === 'budget' && <ReasoningBudget value={value.budget} onChange={budget => onChange({ ...value, budget })} />}
  </SimpleGrid>;
}

export function AITaskModal({ title, providers, value, onChange, onSubmit, onSettings, onClose, ...visibility }: { title: string; providers: Provider[]; value: AISelection; onChange: (value: AISelection) => void; onSubmit: () => void; onSettings?: () => void; onClose: () => void } & ModalVisibilityProps) {
  return <Modal title={title} onClose={onClose} {...visibility} footer={<><Button onClick={onClose}>取消</Button><Button primary disabled={!value.providerId || !value.model} onClick={onSubmit}>开始生成</Button></>}><AIControls providers={providers} value={value} onChange={onChange} onSettings={onSettings} /></Modal>;
}
