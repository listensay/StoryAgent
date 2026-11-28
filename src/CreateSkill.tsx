import { useState } from 'react';
import { Checkbox, Fieldset, Group, SimpleGrid, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { Button, Modal, type ModalVisibilityProps } from './components';
import { taskNames, type TaskKind } from './domain';
import { makeManualSkill, newManualDraft, type ManualSkillDraft } from './manualSkill';
import type { Store } from './useWorkspace';

// Only offer tasks that actually supply project Skills to the model. Collection
// and the training evaluator have their own execution paths.
const supported: TaskKind[] = ['draft', 'continue', 'rewrite', 'review', 'plan', 'memory', 'summary', 'prepare', 'revise', 'scan', 'analyze', 'style'];
export function CreateSkill({ store, onClose, ...visibility }: { store: Store; onClose: () => void } & ModalVisibilityProps) {
  const [draft, setDraft] = useState(newManualDraft), [error, setError] = useState('');
  const patch = (data: Partial<ManualSkillDraft>) => { setDraft(s => ({ ...s, ...data })); setError(''); };
  const create = () => {
    try { store.update(s => { s.skills.unshift(makeManualSkill(draft, s.skills)); }); store.notify('Skill 已创建'); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <Modal title="新建 Skill" wide onClose={onClose} {...visibility} footer={<><Button onClick={onClose}>取消</Button><Button primary type="submit" form="create-skill-form">创建 Skill</Button></>}>
    <form id="create-skill-form" onSubmit={e => { e.preventDefault(); create(); }}><Stack gap="md">
      <Group align="flex-end"><TextInput required data-autofocus label="名称" placeholder="如：对白修订" style={{ flex: '3 1 240px' }} value={draft.name} onChange={e => patch({ name: e.currentTarget.value })} /><TextInput required label="版本" w={120} value={draft.version} onChange={e => patch({ version: e.currentTarget.value })} /></Group>
      <TextInput required label="用途" placeholder="何时使用这组规则" value={draft.description} onChange={e => patch({ description: e.currentTarget.value })} />
      <Textarea required label="写作规则" placeholder="例如：修订对白时，删去台词之后重复解释人物情绪的旁白。" minRows={6} maxRows={14} autosize value={draft.rules} onChange={e => patch({ rules: e.currentTarget.value })} />
      <Fieldset legend="适用任务"><SimpleGrid cols={{ base: 2, sm: 4 }}>{supported.map(t => <Checkbox key={t} label={taskNames[t]} checked={draft.tasks.includes(t)} onChange={e => patch({ tasks: e.currentTarget.checked ? [...draft.tasks, t] : draft.tasks.filter(k => k !== t) })} />)}</SimpleGrid></Fieldset>
      <Switch label="全局启用" checked={draft.enabled} onChange={e => patch({ enabled: e.currentTarget.checked })} />
      {error && <Text role="alert" size="sm" c="red.8">{error}</Text>}
    </Stack></form>
  </Modal>;
}
