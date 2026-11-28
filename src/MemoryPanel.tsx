import { useMemo, useState } from 'react';
import { Box, Checkbox, Group, Stack, Text } from '@mantine/core';
import { Badge, Button, Confirm, EmptyState, Modal, ModalPresence, OptionTabs, Paper, Select, Textarea, TextInput, Title, type ModalVisibilityProps } from './components';
import { noteNames, now, type Project } from './domain';
import { affectedChapters, authorPayoff, authorPlant, memoryCatalog, removeAuthorMark, removeAuthorPayoff, sourceRange, type MemoryCatalog, type OpenChapter, type SourceRange } from './memory';
import { contentHash, memoryKinds, type MemoryLink, type MemorySource } from './memoryData';
import type { Store } from './useWorkspace';
import './MemoryPanel.css';

type View = MemoryCatalog & { hashes: Map<string, string>; open?: OpenChapter };
type Change = (mutation: (project: Project) => void) => boolean;
const tabOptions = [{ value: 'impact', label: '修改影响' }, { value: 'foreshadow', label: '伏笔回收' }, { value: 'state', label: '人物轨迹' }, { value: 'question', label: '待核疑点' }, { value: 'notes', label: '章节记忆' }];

function Citation({ source, view, label }: { source: MemorySource; view: View; label?: string }) {
  const chapter = view.chapters.get(source.chapterId), hash = view.hashes.get(source.chapterId);
  const range = sourceRange(source, chapter, hash);
  return <Stack gap={6} className="memory-citation">
    <Group gap="xs"><Text size="sm" fw={500}>{label ? `${label}：` : ''}{chapter?.title || '未关联章节'}</Text>
      {source.retired && <Badge>旧记录</Badge>}
      {source.hash && hash !== source.hash && <Badge color="yellow">章节已修改</Badge>}
    </Group>
    {source.evidence ? <><Text size="sm" c="dimmed">{range ? '原文' : '旧稿引文 · 位置待核'}</Text><Text component="blockquote" size="md" className="memory-quote">{source.evidence.quote}</Text></> : <Text size="sm" c="dimmed">未保存原文引用</Text>}
    {chapter && view.open && <Group><Button aria-label={`${range ? '定位原文' : '打开章节'}：${chapter.title}`} onClick={() => view.open?.(chapter.id, range)}>{range ? '定位原文' : '打开章节'}</Button></Group>}
  </Stack>;
}
function currentReview(link: MemoryLink, view: View) {
  const from = view.sources.get(link.fromId), to = view.sources.get(link.toId);
  return !!(link.review && from && to && link.review.fromHash === view.hashes.get(from.chapterId) && link.review.toHash === view.hashes.get(to.chapterId));
}
function LinkEvidence({ link, view }: { link: MemoryLink; view: View }) {
  const from = view.sources.get(link.fromId)!, to = view.sources.get(link.toId)!;
  const kind = link.kind === 'question' ? '疑点' : link.kind === 'continuity' ? '可能承接' : link.origin === 'author' ? '作者关联回收' : '候选回收';
  return <Stack gap="sm"><Group gap="xs"><Badge color={link.origin === 'author' ? 'story' : 'gray'}>{kind}</Badge>{link.historical && <Badge>历史关联</Badge>}{link.review && <Badge color={currentReview(link, view) ? 'story' : 'gray'}>{currentReview(link, view) ? '作者判断' : '修改前判断'}：{link.review.result === 'conflict' ? '存在矛盾' : '不构成矛盾'}</Badge>}<Text size="sm">{link.reason}</Text></Group>
    <div className="memory-pair"><Citation source={from} view={view} label="关联来源" /><Citation source={to} view={view} label="关联去向" /></div>
  </Stack>;
}

export function MemoryPanel({ project, store, onOpenChapter }: { project: Project; store: Store; onOpenChapter?: OpenChapter }) {
  const [tab, setTab] = useState('impact');
  const [selected, setSelected] = useState('');
  const [payoff, setPayoff] = useState<string>();
  const catalog = useMemo(() => memoryCatalog(project), [project]);
  const view: View = useMemo(() => ({ ...catalog, hashes: new Map(project.chapters.map(c => [c.id, contentHash(c.content)])), open: onOpenChapter }), [project, catalog, onOpenChapter]);
  const records = useMemo(() => {
    const order = new Map(project.chapters.map((c, i) => [c.id, i]));
    return [...catalog.sources.values()].sort((a, b) => (order.get(a.chapterId) ?? -1) - (order.get(b.chapterId) ?? -1) || (a.evidence?.start ?? 0) - (b.evidence?.start ?? 0));
  }, [catalog, project.chapters]);
  const changed = records.find(s => s.hash && !s.retired && s.hash !== view.hashes.get(s.chapterId));
  const chapterId = catalog.chapters.has(selected) ? selected : changed?.chapterId ?? project.chapters[0]?.id ?? '';
  const chapterOptions = project.chapters.map(c => ({ value: c.id, label: c.title }));
  const change: Change = mutation => {
    try { store.update(s => { const current = s.projects.find(p => p.id === project.id); if (!current) throw new Error('小说已移除'); mutation(current); current.updatedAt = now(); }); return true; }
    catch (e) { store.notify(e instanceof Error ? e.message : String(e)); return false; }
  };
  const busy = store.state.jobs.some(j => j.projectId === project.id && ['queued', 'running'].includes(j.status) && (j.kind === 'memory' || ['draft', 'continue', 'rewrite'].includes(j.kind)) && j.steps.some(s => s.chapterId === chapterId));
  const extract = () => { try { store.launch({ kind: 'memory', projectId: project.id, chapterId }); } catch (e) { store.notify(e instanceof Error ? e.message : String(e)); } };
  const plant = payoff ? view.sources.get(payoff) : undefined;
  return <Paper component="section" className="surface memory-panel"><Stack gap="lg">
    <Title order={2}>记忆追踪</Title><OptionTabs label="记忆视图" value={tab} onChange={setTab} options={tabOptions} />
    {(tab === 'impact' || tab === 'notes') && <Group align="end"><Box className="memory-selector"><Select label={tab === 'impact' ? '修改章节' : '章节'} value={chapterId} onChange={setSelected} options={chapterOptions} placeholder="选择章节" /></Box>
      <Button disabled={busy || !catalog.chapters.get(chapterId)?.content.trim()} onClick={extract}>{busy ? '任务进行中' : '提取本章记忆'}</Button></Group>}
    {tab === 'impact' && <Impact view={view} chapterId={chapterId} />}
    {tab === 'foreshadow' && <Foreshadows view={view} records={records} setPayoff={setPayoff} change={change} />}
    {tab === 'state' && <Trajectory view={view} records={records} />}
    {tab === 'question' && <Questions view={view} change={change} />}
    {tab === 'notes' && <ChapterRecords view={view} chapterId={chapterId} records={records} />}
    <ModalPresence>{plant && <MemoryPassageDialog key={plant.id} plant={plant} view={view} change={change} onClose={() => setPayoff(undefined)} />}</ModalPresence>
  </Stack></Paper>;
}

function Impact({ view, chapterId }: { view: View; chapterId: string }) {
  const groups = useMemo(() => {
    const groups = new Map<string, MemoryLink[][]>();
    for (const path of affectedChapters(view, chapterId)) {
      const id = view.sources.get(path[path.length - 1].toId)!.chapterId;
      const entries = groups.get(id) ?? []; entries.push(path); groups.set(id, entries);
    }
    return [...groups];
  }, [view, chapterId]);
  return <Stack gap="lg"><Title order={3}>需复核的后续章节{groups.length ? `（${groups.length}）` : ''}</Title>
    {groups.map(([id, paths]) => <Stack key={id} className="memory-entry" gap="md"><Title order={3}>{view.chapters.get(id)?.title}</Title>{paths.map(path => <Stack key={path[path.length - 1].id} gap="sm">
      {path.length > 1 && <Text size="sm" fw={500}>间接关联 · {path.length} 段依据</Text>}{path.map(l => <LinkEvidence key={l.id} view={view} link={l} />)}
    </Stack>)}</Stack>)}
    {!groups.length && <EmptyState>暂无关联的后续章节</EmptyState>}
  </Stack>;
}

function Foreshadows({ view, records, setPayoff, change }: { view: View; records: MemorySource[]; setPayoff: (id: string) => void; change: Change }) {
  const [adding, setAdding] = useState(false), [removing, setRemoving] = useState<MemorySource>();
  const plants = records.filter(s => s.kind === 'foreshadow' && s.phase !== 'payoff' && (!s.retired || view.links.some(l => l.fromId === s.id)));
  const chapters = [...view.chapters.values()];
  return <Stack gap="lg"><Group><Button onClick={() => setAdding(true)} disabled={!chapters.some(c => c.content.trim())}>标记埋设原文</Button></Group>{plants.map(s => {
    const connections = view.links.filter(l => l.kind === 'payoff' && l.fromId === s.id);
    const index = chapters.findIndex(c => c.id === s.chapterId);
    const canLink = index >= 0 && chapters.slice(index + 1).some(c => c.content.trim());
    return <Stack key={s.id} gap="md" className="memory-entry"><Group justify="space-between"><Group gap="xs"><Title order={3}>{s.title}</Title><Badge color={connections.some(l => l.origin === 'author') ? 'story' : 'gray'}>{connections.some(l => l.origin === 'author') ? '已关联回收' : '未关联回收'}</Badge>{s.origin === 'author' && <Badge>作者标记</Badge>}</Group><Group gap="xs"><Button onClick={() => setPayoff(s.id)} disabled={!canLink} title={!canLink ? '需要含正文的后续章节' : undefined}>关联回收原文</Button>{s.origin === 'author' && !view.links.some(l => l.fromId === s.id || l.toId === s.id) && <Button onClick={() => setRemoving(s)}>移除标记</Button>}</Group></Group>
      <Citation source={s} view={view} label="埋设" />{connections.map(l => {
        const target = view.sources.get(l.toId)!, chapter = view.chapters.get(target.chapterId), range = sourceRange(target, chapter, view.hashes.get(target.chapterId));
        return <Stack key={l.id} gap="xs"><Group gap="xs"><Badge>{l.origin === 'author' ? '作者关联' : l.historical ? '历史候选' : '候选回收'}</Badge>{chapter && chapters.indexOf(chapter) <= index && <Badge color="yellow">章序待核</Badge>}{l.origin === 'extraction' && <Text size="sm">{l.reason}</Text>}</Group><Citation source={target} view={view} label="回收" /><Group>
          {l.origin === 'author' ? <Button onClick={() => change(p => removeAuthorPayoff(p, l.id))}>解除关联</Button> : <Button disabled={!range || !chapter || chapters.indexOf(chapter) <= index} onClick={() => { if (range && target.evidence) change(p => authorPayoff(p, s.id, target.chapterId, range, target.evidence!.quote, l.id)); }}>确认回收</Button>}
        </Group></Stack>;
      })}</Stack>;
  })}{!plants.length && <EmptyState>暂无伏笔埋设记录</EmptyState>}
    <ModalPresence>{adding && <MemoryPassageDialog view={view} change={change} onClose={() => setAdding(false)} />}</ModalPresence>
    <ModalPresence>{removing && <Confirm title="移除埋设标记" content={`确认移除「${removing.title}」的标记？`} onClose={() => setRemoving(undefined)} onConfirm={() => change(p => removeAuthorMark(p, removing.id))} />}</ModalPresence></Stack>;
}

function MemoryPassageDialog({ plant, view, change, onClose, ...visibility }: { plant?: MemorySource; view: View; change: Change; onClose: () => void } & ModalVisibilityProps) {
  const chapters = [...view.chapters.values()];
  const targets = (plant ? chapters.slice(chapters.findIndex(c => c.id === plant.chapterId) + 1) : chapters).filter(c => c.content.trim());
  const [title, setTitle] = useState('');
  const [id, setId] = useState(targets[0]?.id ?? '');
  const [selection, setSelection] = useState<{ range: SourceRange; quote: string }>();
  const chapter = targets.find(c => c.id === id);
  const save = () => { if (chapter && selection && change(p => plant ? authorPayoff(p, plant.id, chapter.id, selection.range, selection.quote) : authorPlant(p, chapter.id, selection.range, selection.quote, title))) onClose(); };
  return <Modal wide title={plant ? '关联回收原文' : '标记埋设原文'} onClose={onClose} {...visibility} footer={<><Button onClick={onClose}>取消</Button><Button primary disabled={!chapter || !selection?.quote.trim() || (!plant && !title.trim())} onClick={save}>{plant ? '保存关联' : '保存标记'}</Button></>}>
    {plant ? <Text fw={500}>{plant.title}</Text> : <TextInput label="伏笔名称" value={title} onChange={e => setTitle(e.currentTarget.value)} />}<Select label={plant ? '回收章节' : '埋设章节'} value={id} options={targets.map(c => ({ value: c.id, label: c.title }))} onChange={value => { setId(value); setSelection(undefined); }} />
    {chapter ? <><Textarea key={id} label={plant ? '选取回收原文' : '选取埋设原文'} value={chapter.content} readOnly rows={10} onSelect={e => {
      // Textareas normalize CRLF, but editor callbacks and saved anchors use manuscript offsets.
      const rawOffset = (offset: number) => { let pos = offset; for (let i = 0; i < pos; i++) if (chapter.content[i] === '\r' && chapter.content[i + 1] === '\n') { pos++; i++; } return pos; };
      const start = rawOffset(e.currentTarget.selectionStart), end = rawOffset(e.currentTarget.selectionEnd);
      setSelection(end > start ? { range: { start, end }, quote: chapter.content.slice(start, end) } : undefined);
    }} />{selection?.quote.trim() && <Text size="sm" className="memory-quote">{selection.quote}</Text>}</> : <EmptyState>暂无可关联的后续正文</EmptyState>}
  </Modal>;
}

function Trajectory({ view, records }: { view: View; records: MemorySource[] }) {
  const states = records.filter(s => !s.retired && (s.kind === 'state' || s.kind === 'knowledge'));
  const subjects = [...new Set(states.map(s => s.subject ?? ''))];
  const [selection, select] = useState<string>();
  const subject = selection !== undefined && subjects.includes(selection) ? selection : subjects.find(Boolean) ?? '';
  if (!states.length) return <EmptyState>暂无人物状态记录</EmptyState>;
  return <Stack gap="lg"><Box className="memory-selector"><Select label="人物" value={subject} onChange={select} options={subjects.map(name => ({ value: name, label: name || '未标注人物' }))} /></Box>
    <ol className="memory-trajectory">{states.filter(s => (s.subject ?? '') === subject).map(s => <li key={s.id}><Stack gap="xs"><Group gap="xs"><Badge>{noteNames[s.kind]}</Badge><Title order={3}>{s.title}</Title></Group><Text size="sm">{s.body}</Text><Citation source={s} view={view} /></Stack></li>)}</ol>
  </Stack>;
}

function Questions({ view, change }: { view: View; change: Change }) {
  const [reviewed, setReviewed] = useState(false);
  const questions = view.links.filter(l => l.kind === 'question' && currentReview(l, view) === reviewed);
  const judge = (link: MemoryLink, result?: 'conflict' | 'consistent') => change(p => {
    const current = memoryCatalog(p), target = current.links.find(l => l.id === link.id);
    if (!target) throw new Error('疑点记录已移除');
    const from = current.chapters.get(current.sources.get(target.fromId)!.chapterId)!, to = current.chapters.get(current.sources.get(target.toId)!.chapterId)!;
    const fromHash = contentHash(from.content), toHash = contentHash(to.content);
    if (fromHash !== view.hashes.get(from.id) || toHash !== view.hashes.get(to.id)) throw new Error('章节已修改，请重新核对');
    target.review = result ? { result, fromHash, toHash } : undefined;
  });
  return <Stack gap="md"><OptionTabs label="核对状态" value={reviewed ? 'reviewed' : 'open'} onChange={v => setReviewed(v === 'reviewed')} options={[{ value: 'open', label: '待核对' }, { value: 'reviewed', label: '已核对' }]} />
    {questions.map(l => <Stack key={l.id} className="memory-entry" gap="sm"><LinkEvidence link={l} view={view} /><Group>{reviewed ? <Button onClick={() => judge(l)}>重新核对</Button> : <><Button onClick={() => judge(l, 'conflict')}>存在矛盾</Button><Button onClick={() => judge(l, 'consistent')}>不构成矛盾</Button></>}</Group></Stack>)}
    {!questions.length && <EmptyState>{reviewed ? '暂无已核对疑点' : '暂无待核对疑点'}</EmptyState>}
  </Stack>;
}

function ChapterRecords({ view, records, chapterId }: { view: View; records: MemorySource[]; chapterId: string }) {
  const [kind, setKind] = useState('all'), [history, setHistory] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const orphaned = records.some(s => !s.chapterId), id = orphaned && unassigned ? '' : chapterId;
  const chapter = view.chapters.get(id);
  const notes = records.filter(s => s.chapterId === id && (history || !s.retired) && (kind === 'all' || kind === s.kind));
  return <Stack gap="lg">{chapter?.summary && <Stack gap="xs"><Title order={3}>章节摘要</Title><Text className="memory-prose">{chapter.summary}</Text></Stack>}
    <Group align="end"><Box className="memory-selector"><Select label="记录类型" value={kind} onChange={setKind} options={[{ value: 'all', label: '全部' }, ...memoryKinds.map(k => ({ value: k, label: noteNames[k] }))]} /></Box><Checkbox label="含历史记录" checked={history} onChange={e => setHistory(e.currentTarget.checked)} />{orphaned && <Checkbox label="未关联章节" checked={unassigned} onChange={e => setUnassigned(e.currentTarget.checked)} />}</Group>
    {notes.map(s => <Stack key={s.id} gap="xs" className="memory-entry"><Group gap="xs"><Badge>{noteNames[s.kind]}</Badge><Title order={3}>{s.title}</Title></Group>{s.body && <Text className="memory-prose" size="sm">{s.body}</Text>}<Citation source={s} view={view} /></Stack>)}
    {!notes.length && <EmptyState>暂无对应记忆</EmptyState>}
  </Stack>;
}
