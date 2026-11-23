import { Group, SimpleGrid, Stack, TextInput, Title } from '@mantine/core';
import { useCallback, useState } from 'react';
import { Plus, Trash2 } from '../icons';
import { now, uid, type Note, type Project } from '../domain';
import { Badge, Button, Confirm, EmptyState, IconButton, Modal, ModalPresence, OptionTabs, Paper, Select, Textarea } from '../components';
import { CharacterGraph } from '../CharacterGraph';
import { CharacterProfileEditor } from '../CharacterProfileEditor';
import { characterSummary, formatCharacterProfile, parseCharacterProfile, type CharacterProfile } from '../characterProfile';
import { newCharacterRelation, resolveCharacterRelation, retainCharacterRelations } from '../characterRelations';
import { ContentCard } from '../ContentCard';
import type { Store } from '../useWorkspace';

export function Characters({ project, store }: { project: Project; store: Store }) {
  const [view, setView] = useState('profiles');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ note: Note; profile: CharacterProfile }>();
  const [remove, setRemove] = useState<Note>();
  const characters = project.notes.filter(note => note.kind === 'character');
  const edit = useCallback((note: Note) => setEditing({ note: { ...note, ...(note.kind === 'relation' ? { relation: resolveCharacterRelation(note, project.notes.filter(value => value.kind === 'character')) ?? { sourceId: '', targetId: '' } } : {}) }, profile: parseCharacterProfile(note.body) }), [project.notes]);
  const positions = useCallback((values: Record<string, { x: number; y: number }>) => store.update(state => {
    const current = state.projects.find(value => value.id === project.id)!;
    current.notes.forEach(note => { if (note.kind === 'character' && values[note.id]) note.graphPosition = values[note.id]; });
    current.updatedAt = now();
  }), [store.update, project.id]);
  const patch = (value: Partial<Note>) => setEditing(current => current && ({ ...current, note: { ...current.note, ...value } }));
  const note = editing?.note;
  const duplicate = note?.kind === 'character' && characters.some(value => value.id !== note.id && value.title.trim() === note.title.trim());
  const valid = note?.title.trim() && !duplicate && (note.kind !== 'relation' || (note.relation && note.relation.sourceId !== note.relation.targetId && [note.relation.sourceId, note.relation.targetId].every(id => characters.some(value => value.id === id))));
  const save = () => {
    if (!editing || !valid) return;
    store.update(state => {
      const current = state.projects.find(value => value.id === project.id)!;
      const original = current.notes.find(value => value.id === editing.note.id);
      const saved = { ...editing.note, title: editing.note.title.trim() };
      if (saved.kind === 'character') {
        if (original && original.title !== saved.title) current.notes = retainCharacterRelations(current.notes, saved.id);
        saved.body = formatCharacterProfile(editing.profile, saved.title);
      }
      const index = current.notes.findIndex(value => value.id === saved.id);
      if (index < 0) current.notes.push(saved); else current.notes[index] = saved;
      current.updatedAt = now();
    });
    setEditing(undefined);
  };
  const notes = project.notes.filter(value => value.kind === (view === 'relations' ? 'relation' : 'character') && (!search.trim() || `${value.title}\n${value.body}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  return <Stack className="page" gap="lg">
    <Group justify="space-between"><Title order={2}>人物档案</Title><Group gap="sm"><Button disabled={characters.length < 2} onClick={() => edit(newCharacterRelation())}>添加关系</Button><Button primary icon={Plus} onClick={() => edit({ id: uid(), kind: 'character', title: '', body: '', chapterId: '', status: 'confirmed' })}>添加人物</Button></Group></Group>
    <Group justify="space-between"><OptionTabs label="人物视图" value={view} onChange={setView} options={[{ value: 'profiles', label: '人物档案' }, { value: 'graph', label: '人物关系图' }, { value: 'relations', label: '人物关系' }]} />{view !== 'graph' && <TextInput aria-label="搜索人物档案" placeholder="搜索人物或设定" value={search} onChange={e => setSearch(e.target.value)} />}</Group>
    {view === 'graph' ? <Paper><CharacterGraph notes={project.notes} onEdit={edit} onPositions={positions} /></Paper> : notes.length ? <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="lg">{notes.map(value => <ContentCard key={value.id} title={value.title} body={value.kind === 'character' ? characterSummary(value.body) : value.body} badges={<Badge color={value.status === 'confirmed' ? 'green' : value.status === 'planned' ? 'story' : 'gray'}>{value.status === 'confirmed' ? '已确认' : value.status === 'planned' ? '计划' : '参考'}</Badge>} onClick={() => edit(value)} footer={<><Button aria-label={`编辑${value.title}`} onClick={() => edit(value)}>编辑</Button><IconButton icon={Trash2} label={`删除${value.title}`} onClick={() => setRemove(value)} /></>} />)}</SimpleGrid> : <EmptyState>{search.trim() ? '暂无匹配结果' : view === 'relations' ? '暂无人物关系' : '暂无人物档案'}</EmptyState>}
    <ModalPresence>{editing && <Modal title={note!.kind === 'character' ? note!.title || '添加人物' : '人物关系'} bounded={note!.kind === 'character'} wide onClose={() => setEditing(undefined)} footer={<><Button onClick={() => setEditing(undefined)}>取消</Button><Button primary disabled={!valid} onClick={save}>保存</Button></>}>
      {note!.kind === 'character' ? <CharacterProfileEditor name={note!.title} profile={editing.profile} onName={title => patch({ title })} onChange={profile => setEditing({ ...editing, profile })} metadata={<Stack gap="md">{duplicate && <div className="error">已有同名人物</div>}<NoteMetadata note={note!} project={project} onChange={patch} /></Stack>} /> : <Stack gap="lg"><TextInput label="关系名称" required value={note!.title} onChange={e => patch({ title: e.target.value })} /><SimpleGrid cols={{ base: 1, sm: 2 }}>{(['sourceId', 'targetId'] as const).map((key, index) => <Select key={key} label={index ? '人物二' : '人物一'} value={note!.relation?.[key] ?? ''} onChange={id => patch({ relation: { sourceId: note!.relation?.sourceId ?? '', targetId: note!.relation?.targetId ?? '', [key]: id } })} options={characters.filter(value => value.id !== note!.relation?.[index ? 'sourceId' : 'targetId']).map(value => ({ value: value.id, label: value.title }))} />)}</SimpleGrid><NoteMetadata note={note!} project={project} onChange={patch} /><Textarea label="关系内容" autosize minRows={6} value={note!.body} onChange={e => patch({ body: e.target.value })} /></Stack>}
    </Modal>}</ModalPresence>
    <ModalPresence>{remove && <Confirm title={remove.kind === 'character' ? '删除人物' : '删除关系'} content={remove.kind === 'character' ? `确认删除「${remove.title}」及其人物关系？` : `确认删除「${remove.title}」？`} onClose={() => setRemove(undefined)} onConfirm={() => store.update(state => {
      const current = state.projects.find(value => value.id === project.id)!;
      const people = current.notes.filter(value => value.kind === 'character');
      current.notes = current.notes.filter(value => {
        if (value.id === remove.id) return false;
        if (remove.kind !== 'character' || value.kind !== 'relation') return true;
        const relation = resolveCharacterRelation(value, people);
        return relation?.sourceId !== remove.id && relation?.targetId !== remove.id;
      });
      current.updatedAt = now();
    })} />}</ModalPresence>
  </Stack>;
}
function NoteMetadata({ note, project, onChange }: { note: Note; project: Project; onChange: (patch: Partial<Note>) => void }) {
  return <SimpleGrid cols={{ base: 1, sm: 2 }}><Select label="状态" value={note.status} onChange={status => onChange({ status: status as Note['status'] })} options={[{ value: 'confirmed', label: '已确认' }, { value: 'planned', label: '计划' }, { value: 'reference', label: '参考' }]} /><Select label="关联章节" value={note.chapterId} onChange={chapterId => onChange({ chapterId })} options={[{ value: '', label: '未关联' }, ...project.chapters.map(chapter => ({ value: chapter.id, label: chapter.title }))]} /></SimpleGrid>;
}
