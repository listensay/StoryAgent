import { SimpleGrid, Stack } from '@mantine/core';
import { Button, EmptyState, Modal, Select, type ModalVisibilityProps } from './components';
import { supportedEfforts, type AISelection, type Provider } from './domain';

const effortLabels: Record<AISelection['effort'], string> = { default: '默认', low: '低', medium: '中', high: '高', xhigh: '极高' };

export function AIControls({ providers, value, onChange, onSettings, columns = 1 }: { providers: Provider[]; value: AISelection; onChange: (value: AISelection) => void; onSettings?: () => void; columns?: number }) {
  const available = providers.filter(p => p.enabled && p.models.length);
  const provider = available.find(p => p.id === value.providerId);
  if (!available.length) return <Stack gap="sm" align="center"><EmptyState minHeight={80}>暂无可用的 AI 供应商</EmptyState>{onSettings && <Button onClick={onSettings}>设置 AI 供应商</Button>}</Stack>;
  return <SimpleGrid cols={{ base: 1, sm: columns }} spacing="md">
    <Select label="AI 供应商" placeholder="选择供应商" value={provider?.id ?? ''} options={available.map(p => ({ value: p.id, label: p.name }))} onChange={providerId => onChange({ ...value, providerId, model: providers.find(p => p.id === providerId)?.models.includes(value.model) ? value.model : '' })} />
    <Select label="模型" placeholder="选择模型" value={provider?.models.includes(value.model) ? value.model : ''} disabled={!provider} options={(provider?.models ?? []).map(model => ({ value: model, label: model }))} onChange={model => onChange({ ...value, model })} />
    <Select label="推理强度" value={value.effort} disabled={!provider} options={supportedEfforts(provider?.protocol).map(effort => ({ value: effort, label: effortLabels[effort] }))} onChange={effort => onChange({ ...value, effort: effort as AISelection['effort'] })} />
  </SimpleGrid>;
}

export function AITaskModal({ title, providers, value, onChange, onSubmit, onSettings, onClose, ...visibility }: { title: string; providers: Provider[]; value: AISelection; onChange: (value: AISelection) => void; onSubmit: () => void; onSettings?: () => void; onClose: () => void } & ModalVisibilityProps) {
  return <Modal title={title} onClose={onClose} {...visibility} footer={<><Button onClick={onClose}>取消</Button><Button primary disabled={!value.providerId || !value.model} onClick={onSubmit}>开始生成</Button></>}><AIControls providers={providers} value={value} onChange={onChange} onSettings={onSettings} /></Modal>;
}
