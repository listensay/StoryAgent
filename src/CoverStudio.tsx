import { useEffect, useRef, useState } from 'react';
import { Alert, Group, Loader, Paper, ScrollArea, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { Button, EmptyState, Modal, Select, Textarea, type ModalVisibilityProps } from './components';
import { type Project, now, uid } from './domain';
import { type Store } from './useWorkspace';
import { ProjectCover } from './ProjectCover';
import { coverPrompt, generateCover } from './coverGeneration';
import { useAIScroll } from './useAIScroll';
import { normalizeImageSelection, validateCoverImage, type ImageConfig } from './coverData';

export function CoverStudio({ project, store, onClose, onSettings, ...visibility }: { project: Project; store: Store; onClose: () => void; onSettings: () => void } & ModalVisibilityProps) {
  const [instruction, setInstruction] = useState('根据小说信息设计封面，书名清晰。');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const { contentRef, scrollToBottom } = useAIScroll();
  const rounds = project.coverDraft?.rounds ?? [];
  const selected = rounds.find(round => round.id === project.coverDraft?.selectedId) ?? rounds[rounds.length - 1];
  const source = selected?.dataUrl ?? project.cover;
  const providers = store.state.imageProviders.filter(provider => provider.enabled && provider.models.length);
  const selection = normalizeImageSelection(store.state.imageSelection, providers);
  const provider = providers.find(value => value.id === selection.providerId);
  const options = store.state.coverOptions;
  const config: ImageConfig | undefined = provider ? { ...provider, model: selection.model, ...options } : undefined;
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (visibility.opened === false) { request.current?.abort(); request.current = null; setPending(''); } }, [visibility.opened]);
  const select = (id: string) => store.update(s => { const draft = s.projects.find(p => p.id === project.id)?.coverDraft; if (draft) draft.selectedId = id; });
  const send = async (edit: boolean) => {
    if (!config || request.current || !instruction.trim()) return;
    const controller = new AbortController();
    try {
      const history = edit && selected ? rounds.slice(0, rounds.indexOf(selected) + 1).map(round => round.instruction) : [];
      const prompt = coverPrompt(project, instruction, history);
      request.current = controller; setError(''); setPending(instruction.trim()); scrollToBottom();
      const result = await generateCover(config, prompt, edit ? source : '', controller.signal);
      await validateCoverImage(result.dataUrl, controller.signal);
      controller.signal.throwIfAborted();
      const round = { id: uid(), instruction: instruction.trim(), prompt: result.prompt, dataUrl: result.dataUrl, createdAt: now() };
      store.update(s => { const p = s.projects.find(value => value.id === project.id); if (p) { p.coverDraft = { selectedId: round.id, rounds: [...(p.coverDraft?.rounds ?? []), round].slice(-6) }; p.updatedAt = now(); } });
      setInstruction(''); scrollToBottom();
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request.current === controller) { request.current = null; setPending(''); } }
  };
  const close = () => { request.current?.abort(); onClose(); };
  return <Modal title="生成封面" wide onClose={close} {...visibility} footer={<><Button onClick={close}>关闭</Button><Button primary disabled={!source || !!pending} onClick={() => { store.update(s => { const p = s.projects.find(value => value.id === project.id); if (p) { p.cover = source; p.updatedAt = now(); } }); store.notify('封面已应用'); close(); }}>应用封面</Button></>}>
    <div className="cover-studio">
      <Stack gap="md" align="center" miw={0}>
        <ProjectCover source={source} title={project.title} width={240} height={360} />
        {!!rounds.length && <ScrollArea w="100%" type="auto" offsetScrollbars><Group gap="sm" wrap="nowrap" py={4}>{rounds.map((round, index) => <UnstyledButton key={round.id} aria-label={`查看封面版本${index + 1}`} aria-pressed={round.id === selected?.id} disabled={!!pending} onClick={() => select(round.id)} style={{ flexShrink: 0, border: `2px solid ${round.id === selected?.id ? 'var(--mantine-color-story-7)' : 'transparent'}`, borderRadius: 10 }}><ProjectCover source={round.dataUrl} title={`版本${index + 1}`} width={44} height={66} /></UnstyledButton>)}</Group></ScrollArea>}
      </Stack>
      <Stack gap="md" miw={0}>
        <Group justify="space-between"><Text fw={500}>AI 对话</Text><Button disabled={!!pending} onClick={() => { close(); onSettings(); }}>图片供应商</Button></Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Select label="图片供应商" value={selection.providerId} disabled={!!pending || !providers.length} placeholder="选择供应商" options={providers.map(value => ({ value: value.id, label: value.name }))} onChange={providerId => store.update(s => { s.imageSelection = normalizeImageSelection({ ...s.imageSelection, providerId }, s.imageProviders); })} />
          <Select label="图片模型" value={selection.model} disabled={!!pending || !provider} placeholder="选择模型" options={(provider?.models ?? []).map(model => ({ value: model, label: model }))} onChange={model => store.update(s => { s.imageSelection.model = model; })} />
          <Select label="尺寸" value={options.size} disabled={!!pending} options={[{ value: '1024x1536', label: '竖版 · 1024 × 1536' }, { value: '1024x1024', label: '方形 · 1024 × 1024' }, { value: '1536x1024', label: '横版 · 1536 × 1024' }]} onChange={size => store.update(s => { s.coverOptions.size = size as ImageConfig['size']; })} />
          <Select label="画质" value={options.quality} disabled={!!pending} options={[{ value: 'auto', label: '自动' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]} onChange={quality => store.update(s => { s.coverOptions.quality = quality as ImageConfig['quality']; })} />
        </SimpleGrid>
        <ScrollArea h={300} type="auto" offsetScrollbars><Stack ref={contentRef} gap="md">
          {rounds.map((round, index) => <Stack key={round.id} gap="sm"><Paper bg="gray.0" p="md"><Text size="xs" c="dimmed" mb={4}>封面要求</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{round.instruction}</Text></Paper><Group justify="space-between"><Text size="sm">封面版本 {index + 1}</Text><Button onClick={() => select(round.id)} disabled={!!pending}>{round.id === selected?.id ? '当前预览' : '预览'}</Button></Group></Stack>)}
          {pending && <><Paper bg="gray.0" p="md"><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{pending}</Text></Paper><Group gap="sm"><Loader size="sm" /><Text size="sm">生成中…</Text></Group></>}
          {!rounds.length && !pending && <EmptyState minHeight={260}>暂无生成记录</EmptyState>}
        </Stack></ScrollArea>
        {!config && <Alert color="orange">请配置图片供应商</Alert>}
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Textarea label={source ? '调整要求' : '封面要求'} placeholder={source ? '调整画面、配色、文字或风格' : '封面的画面、风格与文字'} value={instruction} disabled={!!pending} onChange={e => setInstruction(e.target.value)} autosize minRows={3} maxRows={5} maxLength={4000} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(!!source); } }} />
        <Group justify="flex-end">{pending ? <Button onClick={() => { request.current?.abort(); }}>停止生成</Button> : <>{source && <Button disabled={!config || !instruction.trim()} onClick={() => void send(false)}>重新生成</Button>}<Button primary disabled={!config || !instruction.trim()} onClick={() => void send(!!source)}>{source ? '发送调整' : '生成封面'}</Button></>}</Group>
      </Stack>
    </div>
  </Modal>;
}
