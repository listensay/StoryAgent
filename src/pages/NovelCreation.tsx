import { Alert, Center, Group, Loader, SimpleGrid, Stack, Stepper, TagsInput, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { AIControls } from '../AIControls';
import { Badge, Button, Confirm, Modal, ModalPresence, Paper, Textarea, Title } from '../components';
import { Check, Pause, RefreshCw, Settings2, Sparkles } from '../icons';
import { Markdown } from '../Markdown';
import { creationContextKey, creationGenre, selectedCreationOption } from '../novelCreation';
import { creationStageNames, type CreationOption, type CreationStage } from '../novelCreationData';
import { type Store } from '../useWorkspace';
import { useAIScroll } from '../useAIScroll';

const stages: CreationStage[] = ['genre', 'core', 'outline'];
const optionSummary = (option: CreationOption) => option.stage === 'genre' ? option.premise : option.stage === 'core' ? option.synopsis : option.summary;

export function NovelCreation({ store, genre, onGenreChange, idea, onIdeaChange, onBack, onOpen, onSettings }: { store: Store; genre: string; onGenreChange: (genre: string) => void; idea: string; onIdeaChange: (idea: string) => void; onBack: () => void; onOpen: (id: string) => void; onSettings: () => void }) {
  const draft = store.state.creationDraft;
  const [feedback, setFeedback] = useState('');
  const [restart, setRestart] = useState(false);
  const [aiOpen, setAIOpen] = useState(false);
  const [preview, setPreview] = useState<CreationOption>();
  const { contentRef, scrollToBottom } = useAIScroll();
  const ai = store.state.aiSelection;
  const configured = !!ai.providerId && !!ai.model;
  const rounds = draft?.rounds.filter(round => round.stage === draft.stage && round.contextKey === creationContextKey(draft, draft.stage)) ?? [];
  const active = draft && store.state.jobs.find(job => job.creationTask?.draftId === draft.id && ['queued', 'running'].includes(job.status));
  const generating = !!active;
  const selected = draft && selectedCreationOption(draft, draft.stage);
  const stage = draft?.stage ?? 'genre';
  const perform = (action: () => void) => { try { action(); } catch (error) { store.notify(error instanceof Error ? error.message : String(error)); } };
  useEffect(() => { setFeedback(''); setPreview(undefined); }, [stage]);
  useEffect(() => { if (draft?.stage === 'genre') { onGenreChange(creationGenre(draft)); onIdeaChange(draft.idea); } }, [draft?.id, stage]);
  useEffect(() => { scrollToBottom(); }, [stage, rounds.length, scrollToBottom]);
  useEffect(() => { if (generating) scrollToBottom(); }, [generating, scrollToBottom]);
  const choose = (option: CreationOption) => perform(() => { store.selectNovelOption(option.id); setPreview(undefined); });
  const send = () => perform(() => { store.generateNovelOptions(feedback); setFeedback(''); });
  const settings = <Modal title="AI 设置" opened={aiOpen} onClose={() => setAIOpen(false)} footer={<Button primary onClick={() => setAIOpen(false)}>完成</Button>}><AIControls providers={store.state.providers} value={ai} onChange={store.setAISelection} onSettings={onSettings} /></Modal>;

  return <Stack ref={contentRef} className="page" gap="lg">
    <Group justify="space-between"><Title order={2}>新建小说</Title><Group gap="sm">{draft && <Button disabled={!!active} onClick={() => setRestart(true)}>重新开始</Button>}<Button icon={Settings2} onClick={() => setAIOpen(true)}>AI 设置</Button><Button onClick={onBack}>返回小说</Button></Group></Group>
    <Stepper active={stages.indexOf(stage)} onStepClick={index => { if (index < stages.indexOf(stage)) perform(() => store.backNovelCreation(stages[index])); }} allowNextStepsSelect={false} completedIcon={<Check size={18} />} styles={{ stepLabel: { fontSize: 14 }, stepIcon: { fontSize: 14 }, step: { cursor: active ? 'default' : undefined } }}>
      {stages.map(item => <Stepper.Step key={item} label={item === 'genre' ? '创作方向' : creationStageNames[item]} disabled={!!active} />)}
    </Stepper>
    {!draft || stage === 'genre' ? <Paper w="100%" maw={640} mx="auto" mt="auto" p="lg"><Stack gap="md"><TagsInput label="题材" placeholder="例如：修仙、文化入侵、轻松喜剧" value={genre.split(/[、，,；;\n]+/).map(value => value.trim()).filter(Boolean)} onChange={values => onGenreChange(values.join('、').slice(0, 200))} splitChars={['、', '，', ',', '；', ';']} maxLength={200} data-autofocus disabled={!!active} /><Textarea label="小说想法" placeholder="故事的主角、背景或想表达的想法" value={idea} onChange={event => onIdeaChange(event.currentTarget.value)} autosize minRows={3} maxRows={6} maxLength={8000} disabled={!!active} />
      {!configured && <AIControls providers={store.state.providers} value={ai} onChange={store.setAISelection} onSettings={onSettings} columns={2} />}
      <Group justify="flex-end">{active && <Button icon={Pause} onClick={() => store.stop(active.id)}>停止生成</Button>}<Button primary icon={Sparkles} disabled={!genre.trim() || !idea.trim() || !configured || !!active} onClick={() => perform(() => store.startNovelCreation(genre, idea))}>生成核心设定</Button></Group>
    </Stack></Paper> : <>
      <Paper p="md" shadow="none"><Stack gap="sm"><Group gap="xs"><Badge color="story" style={{ height: 'auto', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{creationGenre(draft)}</Badge>{stage === 'outline' && selectedCreationOption(draft, 'core') && <Badge color="story">{selectedCreationOption(draft, 'core')!.title}</Badge>}</Group><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{draft.idea}</Text></Stack></Paper>
      <Stack gap="xl" style={{ flex: 1 }}>{rounds.map(round => {
        const job = store.state.jobs.find(job => job.creationTask?.roundId === round.id);
        const pending = job && ['queued', 'running'].includes(job.status);
        return <Stack key={round.id} gap="md">
          <Group justify="flex-end"><Paper p="md" shadow="none" bg="gray.0" maw="90%"><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{round.instruction}</Text></Paper></Group>
          {round.options.length > 0 ? <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="md">{round.options.map((option, index) => <Paper key={option.id} p="md" shadow="none" style={{ display: 'flex', flexDirection: 'column', borderColor: selected?.id === option.id ? 'var(--mantine-color-story-7)' : undefined, background: selected?.id === option.id ? 'var(--mantine-color-story-0)' : undefined }}>
            <Stack gap="sm" style={{ flex: 1 }}><Group justify="space-between" align="flex-start" wrap="nowrap"><Text size="sm" c="dimmed">{String(index + 1).padStart(2, '0')}</Text>{option.stage === 'genre' && <Badge style={{ maxWidth: '85%', height: 'auto', whiteSpace: 'normal' }}>{option.genre}</Badge>}{option.stage === 'core' && <Text size="sm" c="dimmed">{option.form === 'long' ? '长篇' : '短篇'} · {option.targetWords.toLocaleString()} 字</Text>}{option.stage === 'outline' && <Text size="sm" c="dimmed">{option.characters.length} 人物 · {option.volumes.length} 卷</Text>}</Group>
              <Title order={3} style={{ overflowWrap: 'anywhere' }}>{option.title}</Title><Text size="sm" lineClamp={4} style={{ overflowWrap: 'anywhere' }}>{optionSummary(option)}</Text>
              {option.stage === 'core' && <Text size="sm" c="dimmed" lineClamp={3}>{option.setting}</Text>}
            </Stack><Group justify="space-between" mt="lg"><Button onClick={() => setPreview(option)}>查看方案</Button><Button primary={selected?.id === option.id} icon={selected?.id === option.id ? Check : undefined} disabled={!!active} onClick={() => choose(option)}>{selected?.id === option.id ? '已选择' : '选择'}</Button></Group>
          </Paper>)}</SimpleGrid> : pending ? <Center mih={180} role="status"><Group><Loader size="sm" /><Text size="sm">{job.status === 'queued' ? '等待生成' : `正在生成${creationStageNames[round.stage]}`}</Text></Group></Center> : <Alert color={job?.status === 'failed' ? 'red' : 'gray'} title={job?.status === 'failed' ? '生成失败' : '生成已停止'}><Stack gap="sm"><Text size="sm">{job?.error || '暂无方案'}</Text>{job && <Group><Button disabled={!!active || !configured} onClick={() => store.resumeJob(job.id, true)}>重新生成</Button></Group>}</Stack></Alert>}
        </Stack>;
      })}</Stack>
      <Paper p="md" shadow="none" pos="sticky" bottom={0} style={{ zIndex: 2 }}><Stack gap="md">
        <Group align="flex-end" wrap="nowrap"><Textarea label="修改意见" placeholder={`调整${creationStageNames[stage]}方向、补充要求或修改选中方案`} value={feedback} onChange={event => setFeedback(event.currentTarget.value)} autosize minRows={2} maxRows={5} maxLength={8000} style={{ flex: 1 }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && feedback.trim() && !active && configured) { event.preventDefault(); send(); } }} /><Button primary disabled={!feedback.trim() || !!active || !configured} onClick={send}>发送</Button></Group>
        <Group justify="space-between" gap="sm"><Group gap="sm">{active ? <Button icon={Pause} onClick={() => store.stop(active.id)}>停止生成</Button> : <Button icon={RefreshCw} disabled={!configured} onClick={() => perform(() => store.generateNovelOptions(`重新生成${creationStageNames[stage]}方案，保留已有要求，提供新的方向。`))}>换一组</Button>}<Button disabled={!!active} onClick={() => perform(() => store.backNovelCreation(stages[stages.indexOf(stage) - 1]))}>上一步</Button></Group>
          <Button primary disabled={!selected || !!active || (stage !== 'outline' && !configured)} onClick={() => perform(() => { if (stage === 'outline') onOpen(store.finishNovelCreation()); else store.advanceNovelCreation(); })}>{stage === 'core' ? '生成总纲' : '创建小说'}</Button>
        </Group>
      </Stack></Paper>
    </>}
    {settings}
    <ModalPresence>{restart && draft && <Confirm title="重新开始" content="当前创建草稿及候选方案将被清除。" onClose={() => setRestart(false)} onConfirm={() => perform(() => { store.discardNovelCreation(); onGenreChange(creationGenre(draft)); onIdeaChange(draft.idea); setFeedback(''); })} />}</ModalPresence>
    <ModalPresence>{preview && <Modal title={preview.title} wide onClose={() => setPreview(undefined)} footer={<><Button onClick={() => setPreview(undefined)}>关闭</Button><Button primary disabled={!!active} onClick={() => choose(preview)}>{selected?.id === preview.id ? '已选择' : '选择方案'}</Button></>}><OptionDetails option={preview} onError={store.notify} /></Modal>}</ModalPresence>
  </Stack>;
}

function OptionDetails({ option, onError }: { option: CreationOption; onError: (message: string) => void }) {
  return <Stack gap="lg">
    {option.stage === 'genre' && <><Badge color="story">{option.genre}</Badge><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{option.premise}</Text></>}
    {option.stage === 'core' && <><Group><Badge>{option.form === 'long' ? '长篇' : '短篇'} · {option.targetWords.toLocaleString()} 字</Badge><Text size="sm">{option.audience}</Text></Group><Text size="sm">{option.theme}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{option.synopsis}</Text><Title order={3}>核心设定</Title><Markdown onError={onError}>{option.setting}</Markdown></>}
    {option.stage === 'outline' && <><Text size="sm">{option.summary}</Text><Markdown onError={onError}>{option.outline}</Markdown><Title order={3}>人物</Title>{option.characters.map((character, index) => <Paper key={index} p="md" shadow="none"><Stack gap="sm"><Title order={4}>{character.name}</Title>{character.body ? <Markdown onError={onError}>{character.body}</Markdown> : <><Text size="sm">{character.role}</Text><Text size="sm">目标与动机：{character.motivation}</Text><Text size="sm">人物弧线：{character.arc}</Text><Text size="sm">人物关系：{character.relations}</Text></>}</Stack></Paper>)}<Title order={3}>分卷</Title>{option.volumes.map((volume, index) => <Paper key={index} p="md" shadow="none"><Stack gap="sm"><Title order={4}>第{index + 1}卷 {volume.title}</Title><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{volume.summary}</Text><Text size="sm">关键转折：{volume.turningPoints}</Text><Text size="sm">卷末结果：{volume.ending}</Text></Stack></Paper>)}</>}
    {option.stage === 'outline' && !!option.relationships?.length && <><Title order={3}>人物关系</Title>{option.relationships.map((relation, index) => <Stack key={index} gap="sm"><Group gap="sm"><Text fw={500}>{relation.title}</Text><Text size="sm" c="dimmed">{relation.source} · {relation.target}</Text></Group><Markdown onError={onError}>{relation.body}</Markdown></Stack>)}</>}
  </Stack>;
}
