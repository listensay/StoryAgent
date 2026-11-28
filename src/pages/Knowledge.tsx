import { Group, MultiSelect, SimpleGrid, Stack, TagsInput, Text } from '@mantine/core';
import { useState } from 'react';
import { Plus, Sparkles, Trash2, Upload } from '../icons';
import { type Note, type NoteKind, type Project, noteNames, now, uid } from '../domain';
import { NumberInput, Paper, TextInput, Textarea, Title, Button, Confirm, EmptyState, ModalPresence, Modal, Select, Badge, OptionTabs, IconButton } from '../components';
import { type Store } from '../useWorkspace';
import { JobCard } from '../JobCard';
import { Markdown } from '../Markdown';
import { PlanningChat } from '../PlanningChat';
import { ContentCard } from '../ContentCard';
import { ProjectCover } from '../ProjectCover';
import { CoverStudio } from '../CoverStudio';
import { pickCover } from '../platform';
import { imageDataUrl, validateCoverImage } from '../coverData';
import { MemoryPanel } from '../MemoryPanel';
import type { OpenChapter } from '../memory';

export function Knowledge({ project, store, mode, onSettings, focusJobId, onOpenChapter }: { project: Project; store: Store; onSettings: () => void; mode: 'details' | 'world' | 'outline' | 'memory'; focusJobId?: string; onOpenChapter?: OpenChapter }) {
  const [editing, setEditing] = useState<Note>();
  const [remove, setRemove] = useState<Note>();
  const [filter, setFilter] = useState('');
  const [aiOpen, setAIOpen] = useState(!!focusJobId && !!store.state.jobs.find(job => job.id === focusJobId)?.planningChat);
  const [outlineEditing, setOutlineEditing] = useState(false);
  const [detail, setDetail] = useState<{ kind: 'outline' | 'note' | 'chapter'; id?: string }>();
  const [coverOpen, setCoverOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const kinds: NoteKind[] = mode === 'world' ? ['world'] : mode === 'details' ? ['reference'] : mode === 'outline' ? ['volume', 'scene', 'branch'] : ['fact', 'state', 'timeline', 'foreshadow', 'knowledge'];
  const patch = (data: Partial<Project>) => store.update(s => { const p = s.projects.find(p => p.id === project.id)!; Object.assign(p, data); p.updatedAt = now(); });
  const uploadCover = async () => {
    if (uploading) return;
    setUploading(true);
    try { const file = await pickCover(); if (file) { const cover = imageDataUrl(file.bytes); await validateCoverImage(cover); patch({ cover, coverDraft: undefined }); store.notify('封面已上传'); } }
    catch (e) { store.notify(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); }
  };
  const notes = project.notes.filter(n => kinds.includes(n.kind) && (!filter || n.kind === filter));
  const editNote = (note: Note) => setEditing({ ...note });
  const add = () => setEditing({ id: uid(), kind: (filter || kinds[0]) as NoteKind, title: '', body: '', chapterId: '', status: mode === 'outline' ? 'planned' : 'confirmed' });
  const save = () => { if (!editing?.title.trim()) return; store.update(s => { const p = s.projects.find(p => p.id === project.id)!; const index = p.notes.findIndex(n => n.id === editing.id); if (index < 0) p.notes.push(editing); else p.notes[index] = editing; p.updatedAt = now(); }); setEditing(undefined); };
  const detailNote = detail?.kind === 'note' ? project.notes.find(note => note.id === detail.id) : undefined;
  const detailChapter = detail?.kind === 'chapter' ? project.chapters.find(chapter => chapter.id === detail.id) : undefined;
  return <div className="page knowledge-page">
    {mode === 'details' && <>
      <Title order={2}>创作准备</Title>
      <Paper component="section" className="surface"><Stack gap="lg">
        <Title order={3}>小说信息</Title>
        <div className="novel-information"><Stack gap="md" align="center"><ProjectCover source={project.cover} title={project.title} /><Stack gap="sm" w="100%"><Button icon={Upload} disabled={uploading} onClick={() => void uploadCover()}>{uploading ? '上传中…' : '上传封面'}</Button><Button icon={Sparkles} onClick={() => setCoverOpen(true)}>生成封面</Button></Stack></Stack><Stack gap="lg"><TextInput label="书名" required value={project.title} onChange={e => patch({ title: e.target.value })} />
        <Group align="flex-start" gap="lg"><TagsInput label="题材" required placeholder="添加题材" value={project.genre.split(/[、，,；;\n]+/).map(value => value.trim()).filter(Boolean)} onChange={values => patch({ genre: values.join('、') })} splitChars={['、', '，', ',', '；', ';']} w={320} maw="100%" /><Stack gap={0} w={140} maw="100%"><Select label="形式" value={project.form} onChange={v => patch({ form: v as Project['form'] })} options={[{ value: 'long', label: '长篇' }, { value: 'short', label: '短篇' }]} /></Stack><NumberInput label="目标字数" required min={1} allowDecimal={false} thousandSeparator value={project.targetWords} onChange={value => patch({ targetWords: Math.max(0, Number(value)) })} w={200} maw="100%" /></Group>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg"><Textarea label="主题" autosize minRows={3} maxRows={6} value={project.theme} onChange={e => patch({ theme: e.target.value })} /><Textarea label="读者定位" autosize minRows={3} maxRows={6} value={project.audience} onChange={e => patch({ audience: e.target.value })} /></SimpleGrid>
        <Textarea label="简介" autosize minRows={5} maxRows={12} value={project.synopsis} onChange={e => patch({ synopsis: e.target.value })} />
        <Group align="flex-start" gap="lg"><MultiSelect label="参考资料" placeholder="选择参考资料" value={project.referenceIds} onChange={referenceIds => patch({ referenceIds })} data={store.state.references.map(r => ({ value: r.id, label: r.title }))} searchable clearable nothingFoundMessage="暂无资料" w={300} maw="100%" /><MultiSelect label="创作 Skill" placeholder="选择 Skill" value={project.skillIds} onChange={skillIds => patch({ skillIds })} data={[...store.state.skills.filter(s => !s.builtin || project.skillIds.includes(s.id)), ...(project.skillPins ?? []).filter(pin => !store.state.skills.some(s => s.id === pin.id))].map(s => ({ value: s.id, label: s.name }))} searchable clearable nothingFoundMessage="暂无 Skill" w={300} maw="100%" /></Group>
        </Stack></div>
      </Stack></Paper>
    </>}
    {mode === 'world' && <Title order={2}>世界设定</Title>}
    {mode === 'outline' && <Paper component="section" className="surface"><Stack gap="lg">
      <Title order={2}>故事总纲</Title>
      <ContentCard title="故事总纲" body={project.outline} onClick={() => { setOutlineEditing(false); setDetail({ kind: 'outline' }); }} />
      <Title order={3}>章节计划</Title><SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="lg">{project.chapters.map(c => <ContentCard key={c.id} title={c.title} body={c.plan} onClick={() => setDetail({ kind: 'chapter', id: c.id })} />)}</SimpleGrid>{!project.chapters.length && <EmptyState>暂无章节计划</EmptyState>}
    </Stack></Paper>}
    {mode === 'memory' ? <MemoryPanel project={project} store={store} onOpenChapter={onOpenChapter} /> : <Stack component="section" gap="lg" style={{ flex: 1 }}>
      <Group justify="space-between">{mode === 'world' || mode === 'details' ? <Title order={3}>{mode === 'world' ? '设定记录' : '参考记录'}</Title> : <OptionTabs label="记录类型" value={filter || 'all'} onChange={v => setFilter(v === 'all' ? '' : v)} options={[{ value: 'all', label: '全部' }, ...kinds.map(kind => ({ value: kind, label: noteNames[kind] }))]} />}<Button primary icon={Plus} onClick={add}>{mode === 'outline' ? '添加计划' : mode === 'details' ? '添加参考' : '添加设定'}</Button></Group>
      <SimpleGrid cols={mode === 'outline' ? { base: 1, sm: 2, lg: 5 } : { base: 1, sm: 2, lg: 3, xl: 4 }} spacing="lg">{notes.map(n => <ContentCard key={n.id} title={n.title} body={n.body} badges={<>{mode !== 'world' && <Badge>{noteNames[n.kind]}</Badge>}<Badge color={n.status === 'confirmed' ? 'green' : n.status === 'planned' ? 'story' : 'gray'}>{n.status === 'confirmed' ? '已确认' : n.status === 'planned' ? '计划' : '参考'}</Badge></>} meta={n.chapterId ? project.chapters.find(c => c.id === n.chapterId)?.title : undefined} onClick={() => setDetail({ kind: 'note', id: n.id })} footer={<><Button aria-label={`编辑${n.title}`} onClick={() => editNote(n)}>编辑</Button><IconButton icon={Trash2} label={`删除${n.title}`} onClick={() => setRemove(n)} /></>} />)}</SimpleGrid>{!notes.length && <EmptyState>暂无{mode === 'outline' ? '计划' : mode === 'details' ? '参考记录' : '设定'}</EmptyState>}
    </Stack>}
    {mode !== 'world' && store.state.jobs.filter(j => !j.creationTask && !j.planningChat && j.projectId === project.id && j.kind === (mode === 'outline' ? 'plan' : mode === 'memory' ? 'memory' : 'prepare')).reverse().map(j => <JobCard focused={j.id === focusJobId} key={j.id} job={j} store={store} />)}
    {mode === 'outline' && <PlanningChat project={project} store={store} opened={aiOpen} onClose={() => setAIOpen(false)} onSettings={onSettings} />}
    <ModalPresence>{coverOpen && <CoverStudio project={project} store={store} onClose={() => setCoverOpen(false)} onSettings={onSettings} />}</ModalPresence>
    <ModalPresence>{detail && <Modal title={detail.kind === 'outline' ? '故事总纲' : detailNote?.title ?? detailChapter?.title ?? '详细内容'} wide onClose={() => setDetail(undefined)} footer={<><Button onClick={() => setDetail(undefined)}>关闭</Button>{detail.kind === 'outline' && <Button onClick={() => setOutlineEditing(value => !value)}>{outlineEditing ? '完成编辑' : '编辑总纲'}</Button>}{detailNote && mode !== 'memory' && <Button onClick={() => { editNote(detailNote); setDetail(undefined); }}>编辑</Button>}</>}>
      {detail.kind === 'outline' ? outlineEditing ? <Textarea aria-label="故事总纲" autosize minRows={12} maxRows={30} placeholder="主线、人物弧线与关键转折" value={project.outline} onChange={e => patch({ outline: e.target.value })} /> : project.outline.trim() ? <Markdown onError={store.notify}>{project.outline}</Markdown> : <EmptyState>暂无总纲</EmptyState> : detailNote ? <Stack gap="lg"><Group gap="xs"><Badge>{noteNames[detailNote.kind]}</Badge><Badge>{detailNote.status === 'confirmed' ? '已确认' : detailNote.status === 'planned' ? '计划' : '参考'}</Badge></Group>{detailNote.body.trim() ? <Markdown onError={store.notify}>{detailNote.body}</Markdown> : <EmptyState>暂无内容</EmptyState>}{detailNote.chapterId && <Text size="sm" c="dimmed">{project.chapters.find(c => c.id === detailNote.chapterId)?.title}</Text>}</Stack> : detailChapter ? <ChapterPlan title={detailChapter.title} value={detailChapter.plan} onError={store.notify} onChange={plan => store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters.find(ch => ch.id === detailChapter.id)!.plan = plan; p.updatedAt = now(); })} /> : <EmptyState>暂无内容</EmptyState>}
    </Modal>}</ModalPresence>
    <ModalPresence>{editing && <Modal title={noteNames[editing.kind]} wide onClose={() => setEditing(undefined)} footer={<><Button onClick={() => setEditing(undefined)}>取消</Button><Button primary disabled={!editing.title.trim()} onClick={save}>保存</Button></>}><Stack gap="lg"><SimpleGrid cols={mode === 'world' ? 1 : { base: 1, sm: 2 }}>{mode !== 'world' && <Select label="类型" value={editing.kind} onChange={v => { setEditing({ ...editing, kind: v as NoteKind }); }} options={kinds.map(k => ({ value: k, label: noteNames[k] }))} />}<Select label="状态" value={editing.status} onChange={v => setEditing({ ...editing, status: v as Note['status'] })} options={[{ value: 'confirmed', label: '已确认' }, { value: 'planned', label: '计划' }, { value: 'reference', label: '参考' }]} /></SimpleGrid><TextInput label="名称" data-autofocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /><Select label="关联章节" value={editing.chapterId} onChange={v => setEditing({ ...editing, chapterId: v })} options={[{ value: '', label: '未关联' }, ...project.chapters.map(c => ({ value: c.id, label: c.title }))]} /><Textarea label="内容" autosize minRows={8} maxRows={20} value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} /></Stack></Modal>}</ModalPresence>
    <ModalPresence>{remove && <Confirm title="删除记录" content={`确认删除「${remove.title}」？`} onClose={() => setRemove(undefined)} onConfirm={() => store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.notes = p.notes.filter(n => n.id !== remove.id); })} />}</ModalPresence>
  </div>;
}

function ChapterPlan({ title, value, onChange, onError }: { title: string; value: string; onChange: (value: string) => void; onError: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  return <Stack gap="sm" miw={0}><Group justify="space-between" wrap="nowrap"><Text fw={500} style={{ overflowWrap: 'anywhere' }}>{title}</Text><Button aria-label={`${editing ? '完成编辑' : '编辑'}${title}计划`} onClick={() => setEditing(previous => !previous)}>{editing ? '完成编辑' : '编辑'}</Button></Group>
    {editing ? <Textarea aria-label={`${title}计划`} autosize minRows={3} maxRows={16} value={value} onChange={e => onChange(e.target.value)} placeholder="本章的事件与场景" /> : value.trim() ? <Markdown onError={onError}>{value}</Markdown> : <EmptyState minHeight={88}>暂无计划</EmptyState>}
  </Stack>;
}
