import { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Box, Group, Pagination, SimpleGrid, Stack, Text } from '@mantine/core';
import { Button, Checkbox, EmptyState, Modal, ModalPresence, OptionTabs, Select, Textarea, type ModalVisibilityProps } from './components';
import type { Chapter, Project, Skill } from './domain';
import { GitCompare } from './icons';
import { checkRevisionBase, confirmRevisionRules, isWritingSkill, revisionDifferences, revisionSkillId, revisionSources, ruleLimit, type RevisionBase } from './revisionFeedback';
import { historicalDefinition, sameEdition, setProjectPin, skillDefinition, type SkillPin } from './skillVersions';
import type { Store } from './useWorkspace';

interface Props { project: Project; chapter: Chapter; store: Store }
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const pageSize = 6;

export function RevisionSkillAction(props: Props) {
  return <ChapterAction key={`${props.project.id}:${props.chapter.id}`} {...props} />;
}
function ChapterAction(props: Props) {
  const [open, setOpen] = useState<string>();
  return <><Button icon={GitCompare} onClick={() => setOpen(crypto.randomUUID())}>修稿与 Skill</Button><ModalPresence>{open ? <RevisionDialog key={open} {...props} onClose={() => setOpen(undefined)} /> : null}</ModalPresence></>;
}

function RevisionDialog({ project: liveProject, chapter: liveChapter, store, onClose, ...visibility }: Props & ModalVisibilityProps & { onClose: () => void }) {
  // Freeze the evidence/choices the author actually sees, not indexes into a
  // changing workspace. Confirmation revalidates just the relevant objects.
  const [{ project, chapter, sources, skills }] = useState(() => ({ project: liveProject, chapter: liveChapter, sources: revisionSources(liveProject.id, liveChapter, store.state.jobs), skills: store.state.skills }));
  const [tab, setTab] = useState('rules');
  const [sourceId, setSource] = useState(() => (sources.find(s => s.content !== chapter.content) ?? sources[0])?.id ?? '');
  const source = sources.find(s => s.id === sourceId);
  const diffs = useMemo(() => source ? revisionDifferences(source.content, chapter.content) : [], [source, chapter.content]);
  const [selected, setSelected] = useState<number[]>([]), [page, setPage] = useState(1);
  const localId = revisionSkillId(project);
  const targets = skills.filter(isWritingSkill);
  const [targetId, setTarget] = useState(() => project.skillIds.find(id => targets.some(s => s.id === id)) ?? localId);
  const target = targets.find(s => s.id === targetId);
  const [preview, setPreview] = useState<{ base: RevisionBase; rules: string }>();
  const [busy, setBusy] = useState(false), [pinNewVersion, setPinNewVersion] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const cancelPreview = () => { const active = pending.current; pending.current = null; active?.abort(); };
  useEffect(() => cancelPreview, []);
  const close = () => { cancelPreview(); onClose(); };
  const baseForSelection = (): RevisionBase => {
    if (!source || !selected.length) throw new Error('请选择修稿差异');
    return { projectId: project.id, chapterId: chapter.id, manuscript: chapter.content, source, targetId, target: target && skillDefinition(target), pin: project.skillPins?.find(p => p.id === targetId), selected: project.skillIds.includes(targetId) };
  };
  const makePreview = async (withAI: boolean) => {
    if (pending.current) return;
    const controller = new AbortController();
    try {
      const base = baseForSelection();
      checkRevisionBase(store.stateRef.current, base);
      pending.current = controller; setBusy(true);
      const rules = withAI ? await store.suggestRevisionRules(diffs.filter((_, i) => selected.includes(i)), controller) : '';
      controller.signal.throwIfAborted();
      checkRevisionBase(store.stateRef.current, base);
      setPinNewVersion(false); setPreview({ base, rules });
    } catch (e) { if (!controller.signal.aborted) store.notify(message(e)); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  };
  const confirm = () => {
    if (!preview) return;
    try {
      store.update(s => confirmRevisionRules(s, preview.base, preview.rules, pinNewVersion));
      store.notify(target && !pinNewVersion ? '修稿规则已保存为新版本' : '新版本已固定到本书'); close();
    } catch (e) { store.notify(message(e)); }
  };
  const footer = tab === 'rules' && (preview ? <>
    <Button onClick={() => setPreview(undefined)}>返回选取差异</Button>
    <Button primary disabled={!preview.rules.trim() || preview.rules.trim().length > ruleLimit} onClick={confirm}>{target && !pinNewVersion ? '确认生成新版本' : '确认创建并固定'}</Button>
  </> : <><Button disabled={!selected.length || busy} onClick={() => void makePreview(false)}>自行拟定规则</Button><Button primary disabled={!selected.length || busy} aria-busy={busy} onClick={() => void makePreview(true)}>{busy ? '提炼中…' : 'AI 提炼规则'}</Button></>);
  return <Modal title="修稿与 Skill" wide onClose={close} {...visibility} footer={footer}>
    <OptionTabs label="修稿与 Skill" value={tab} options={[{ value: 'rules', label: '修稿提炼' }, { value: 'pin', label: '本书固定版本' }]} onChange={value => { cancelPreview(); setBusy(false); setTab(value); }} />
    {tab === 'pin' ? <PinPanel project={project} skills={skills} store={store} onSaved={close} /> : preview ? <Stack>
      <Text fw={600}>{target ? `追加至「${target.name}」 · ${target.version}` : `创建「${project.title} · 修稿」`}</Text>
      <Accordion keepMounted={false}><Accordion.Item value="evidence"><Accordion.Control>已选 {selected.length} 处差异</Accordion.Control><Accordion.Panel><Stack><Text size="sm" c="dimmed">{source?.label}</Text>{[...selected].sort((a, b) => a - b).map(i => <DiffPair key={i} {...diffs[i]} />)}</Stack></Accordion.Panel></Accordion.Item></Accordion>
      <Textarea label="新增写作规则" placeholder="填写适用情境与具体写法" value={preview.rules} autosize minRows={6} maxRows={15} error={preview.rules.trim().length > ruleLimit ? `规则超过 ${ruleLimit} 字符` : undefined} onChange={e => setPreview({ ...preview, rules: e.currentTarget.value })} />
      {target && <Checkbox label="本书改用并固定新版本" description={preview.base.pin ? `当前固定：${preview.base.pin.version}` : undefined} checked={pinNewVersion} onChange={e => setPinNewVersion(e.currentTarget.checked)} />}
    </Stack> : <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}><Select label="对照稿" value={sourceId} disabled={busy || !sources.length} placeholder="暂无对照稿" options={sources.map(s => ({ value: s.id, label: s.label }))} onChange={value => { setSource(value); setSelected([]); setPage(1); }} />
        <Select label="目标 Skill" value={targetId} disabled={busy} options={[...(!skills.some(s => s.id === localId) ? [{ value: localId, label: '新建本书修稿 Skill' }] : []), ...targets.map(s => ({ value: s.id, label: `${s.name} · ${s.version}` }))]} onChange={setTarget} /></SimpleGrid>
      {!source || !diffs.length ? <EmptyState>{source ? '两稿暂无正文差异' : '本章暂无历史版本或生成稿'}</EmptyState> : <Stack>
        <Text fw={600} size="sm">修稿差异 · 已选 {selected.length} / {diffs.length}</Text>
        {diffs.slice((page - 1) * pageSize, page * pageSize).map(({ before, after }, offset) => {
          const i = (page - 1) * pageSize + offset;
          return <Stack gap="xs" key={i}>
            <Checkbox label={`差异 ${i + 1} · ${before && after ? '改写' : after ? '新增' : '删除'}`} checked={selected.includes(i)} disabled={busy} onChange={e => { const checked = e.currentTarget.checked; setSelected(ids => checked ? [...ids, i] : ids.filter(id => id !== i)); }} />
            <DiffPair before={before} after={after} />
          </Stack>;
        })}
        {diffs.length > pageSize && <Pagination aria-label="修稿差异分页" total={Math.ceil(diffs.length / pageSize)} value={page} onChange={setPage} />}
      </Stack>}
    </Stack>}
  </Modal>;
}

function DiffPair({ before, after }: { before: string; after: string }) {
  return <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs"><Passage text={before} /><Passage current text={after} /></SimpleGrid>;
}
function Passage({ text, current = false }: { text: string; current?: boolean }) {
  return <Box bg={current ? 'teal.0' : 'red.0'} p="sm" style={{ borderRadius: 'var(--mantine-radius-sm)', minWidth: 0 }}>
    <Text size="xs" fw={600} c={current ? 'teal.9' : 'red.9'}>{current ? '当前正文' : '对照稿'}</Text>
    <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text || '—'}</Text>
  </Box>;
}

type PinProps = { project: Project; skills: Skill[]; store: Store; onSaved: () => void };
function PinPanel({ project, skills, store, onSaved }: PinProps) {
  const choices = new Map<string, SkillPin>();
  for (const pin of project.skillPins ?? []) choices.set(pin.id, pin);
  for (const skill of skills.filter(isWritingSkill)) choices.set(skill.id, skill);
  const [id, setId] = useState(() => project.skillPins?.[0]?.id ?? project.skillIds.find(key => choices.has(key)) ?? choices.keys().next().value ?? '');
  if (!choices.size) return <EmptyState>暂无写作 Skill</EmptyState>;
  return <Stack><Select label="写作 Skill" value={id} onChange={setId} options={Array.from(choices.values(), s => ({ value: s.id, label: s.name }))} />
    <PinChoice key={id} id={id} project={project} skill={skills.find(s => s.id === id)} store={store} onSaved={onSaved} /></Stack>;
}
function PinChoice({ project, id, skill, store, onSaved }: Omit<PinProps, 'skills'> & { id: string; skill?: Skill }) {
  const pin = project.skillPins?.find(p => p.id === id);
  const [key, setKey] = useState(pin ? 'fixed' : 'follow');
  const versions = useMemo(() => skill ? [{ key: 'head', label: `最新 · ${skill.version}`, definition: skillDefinition(skill) }, ...skill.revisions.map((r, i) => ({ key: `r${i}`, label: `${r.version} · ${new Date(r.savedAt).toLocaleString('zh-CN')}`, definition: historicalDefinition(skill, r) }))] : [], [skill]);
  const desired = key === 'fixed' ? pin : versions.find(v => v.key === key)?.definition;
  const apply = () => {
    try {
      store.update(state => {
        const p = state.projects.find(p => p.id === project.id), live = state.skills.find(s => s.id === id);
        if (!p || p.skillIds.includes(id) !== project.skillIds.includes(id) || !sameEdition(p.skillPins?.find(x => x.id === id), pin)) throw new Error('本书 Skill 已变更，请重新选择');
        if (key === 'head' && !sameEdition(live, desired)) throw new Error('最新版本已变更，请重新选择');
        if (key.startsWith('r') && !live?.revisions.some(r => sameEdition(historicalDefinition(live, r), desired))) throw new Error('历史版本已变更，请重新选择');
        setProjectPin(p, id, desired);
        if (!desired && !live) p.skillIds = p.skillIds.filter(value => value !== id);
      });
      store.notify(desired ? '本书写作版本已固定' : '已解除固定'); onSaved();
    } catch (e) { store.notify(message(e)); }
  };
  return <Stack><Text size="sm" c="dimmed">{pin ? `本书固定版本：${pin.version}` : project.skillIds.includes(id) ? '本书跟随最新版本' : '本书未选用'}</Text>
    <Select label="写作版本" value={key} onChange={setKey} options={[{ value: 'follow', label: skill ? '不固定 · 跟随最新版' : '解除固定' }, ...(pin ? [{ value: 'fixed', label: `当前固定 · ${pin.version}` }] : []), ...versions.map(v => ({ value: v.key, label: v.label }))]} />
    <Group justify="flex-end"><Button primary disabled={sameEdition(pin, desired)} onClick={apply}>{!desired ? '解除固定' : pin ? '切换固定版本' : '选用并固定版本'}</Button></Group>
  </Stack>;
}
