import { Accordion, Drawer, Group, Loader, Menu, MultiSelect, NavLink, ScrollArea, Select as MantineSelect, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, BookOpen, Copy, FileText, History, List, Plus, Save, Sparkles, Trash2, X } from '../icons';
import { type Project, type TaskKind, type Chapter, chapterWritingKinds, editChapter, newChapter, noteNames, now, snapshot, taskNames, uid, wordCount } from '../domain';
import { NumberInput, TextInput, Textarea, UnstyledButton, Title, Button, Confirm, Diff, Empty, EmptyState, IconButton, ModalPresence, Modal, OptionTabs } from '../components';
import { type Store } from '../useWorkspace';
import { WritingResult } from '../WritingResult';
import { AITaskModal, ReasoningEffortSelect, WritingModelSelect } from '../AIControls';
import { WritingChat } from '../WritingChat';
import { ChapterList } from '../ChapterList';
import { Markdown } from '../Markdown';
import { ContentEditor, type EditorPosition } from '../ContentEditor';
import { type PolishSelection, type TextSelection } from '../selectionPolish';
import { moveChapter, removeChapter } from '../chapterOperations';
import { canClearWritingChat, clearWritingChat } from '../writingActivity';
import { RevisionSkillAction } from '../RevisionSkillAction';
import { manuscriptCheckpoint } from '../paragraphAdoption';
import './Writing.css';

type Panel = 'chat' | 'result' | 'materials' | 'plan' | 'versions';
const panels = [{ value: 'chat', label: '任务' }, { value: 'result', label: '生成稿' }, { value: 'materials', label: '资料' }, { value: 'plan', label: '细纲' }, { value: 'versions', label: '版本' }];
const date = (iso: string) => new Date(iso).toLocaleString('zh-CN');
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

type Props = { project: Project; store: Store; onSettings: () => void; focusChapterId?: string; focusJobId?: string; focusRange?: TextSelection };
export function Writing({ project, store, onSettings, focusChapterId, focusJobId, focusRange }: Props) {
  const jobs = store.state.jobs.filter(j => !j.creationTask && !j.planningChat && j.projectId === project.id && chapterWritingKinds.includes(j.kind));
  const initialJob = jobs.find(job => job.id === focusJobId) ?? jobs[0];
  const [chapterId, setChapterId] = useState(() => [focusChapterId, focusJobId ? initialJob?.steps[0]?.chapterId : undefined, project.writingChapterId, ...(initialJob?.steps.map(s => s.chapterId) ?? [])].find(id => project.chapters.some(c => c.id === id)) ?? project.chapters[project.chapters.length - 1]?.id ?? '');
  const chapter = project.chapters.find(c => c.id === chapterId) ?? project.chapters[project.chapters.length - 1];
  const currentId = chapter?.id;
  const chapterIndex = project.chapters.findIndex(c => c.id === currentId);
  const [target, setTarget] = useState<{ chapterId: string; range: TextSelection }>();
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [panel, setPanel] = useState<Panel>(focusJobId && (initialJob?.kind === 'review' || initialJob?.clearedChatChapterIds?.includes(chapterId)) ? 'result' : 'chat');
  const desktop = useMediaQuery('(min-width: 1050px)', true, { getInitialValueInEffect: false });
  const wide = useMediaQuery('(min-width: 1440px)', false, { getInitialValueInEffect: false });
  const [directory, setDirectory] = useState<boolean>(), [drawer, setDrawer] = useState(false);
  const [tools, setTools] = useState<boolean | undefined>(focusRange ? false : focusJobId ? true : undefined);
  const showTools = tools ?? desktop;
  const showDirectory = desktop && (directory ?? wide) && (wide || !showTools);
  const [selectedJobId, setSelectedJobId] = useState(focusJobId ?? initialJob?.id);
  const [task, setTask] = useState<TaskKind>('draft');
  const ai = store.state.aiSelection;
  const provider = store.state.providers.find(item => item.enabled && item.models.length && item.id === ai.providerId);
  const [quickTask, setQuickTask] = useState<TaskKind>(), [chooseModel, setChooseModel] = useState(false);
  const [instruction, setInstruction] = useState(''), [words, setWords] = useState(2000);
  const [deleteChapterId, setDeleteChapterId] = useState<string>();
  const [clearTarget, setClearTarget] = useState<{ chapterId: string; jobIds: string[]; title: string }>();
  const [version, setVersion] = useState<Chapter['versions'][number]>(), [restoreBase, setRestoreBase] = useState<string>();
  const [saving, setSaving] = useState(false);
  const chapterToDelete = project.chapters.find(c => c.id === deleteChapterId);
  const polishing = store.polishingChapters.includes(currentId ?? '');
  const busyIds = [...store.polishingChapters, ...store.state.jobs.filter(job => job.projectId === project.id && ['queued', 'running'].includes(job.status)).flatMap(job => job.steps.map(step => step.chapterId))];
  const { stateRef, update, rememberPosition } = store;
  useEffect(() => {
    if (focusChapterId) setChapterId(focusChapterId);
    if (focusChapterId && focusRange) { setTarget({ chapterId: focusChapterId, range: { start: focusRange.start, end: focusRange.end } }); setTools(false); setDrawer(false); }
  }, [focusChapterId, focusRange?.start, focusRange?.end]);
  useEffect(() => {
    if (!currentId) return;
    const p = stateRef.current.projects.find(p => p.id === project.id);
    if (p && p.writingChapterId !== currentId && p.chapters.some(c => c.id === currentId)) update(s => { s.projects.find(p => p.id === project.id)!.writingChapterId = currentId; });
  }, [currentId, project.id, stateRef, update]);
  const remember = useCallback((position: EditorPosition) => {
    if (currentId) rememberPosition(project.id, currentId, position);
  }, [rememberPosition, project.id, currentId]);
  const selectChapter = (id: string) => { setChapterId(id); setDrawer(false); setTarget(undefined); setVersion(undefined); setRestoreBase(undefined); };
  const openPanel = (next: Panel) => { setPanel(next); setTools(true); if (!wide && desktop) setDirectory(false); };
  const openResult = (id: string) => { setSelectedJobId(id); openPanel('result'); };
  const locate = (start: number, end: number) => { if (currentId) { setDrawer(false); if (!desktop) setTools(false); setTarget({ chapterId: currentId, range: { start, end } }); } };
  const toggleDirectory = () => { if (!desktop) { setDrawer(true); return; } setDirectory(!showDirectory); if (!showDirectory && !wide) setTools(false); };
  const patch = (data: Partial<Chapter>) => update(s => {
    const p = s.projects.find(p => p.id === project.id); if (!p) return;
    p.chapters = p.chapters.map(c => c.id === currentId ? editChapter(c, data) : c); p.updatedAt = now();
  });
  const add = () => { const c = newChapter(`第${project.chapters.length + 1}章`); update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters.push(c); p.updatedAt = now(); }); selectChapter(c.id); };
  const save = async () => { setSaving(true); try { await store.saveChapter(project.id, chapter.id); } finally { setSaving(false); } };
  const launch = (kind = task) => {
    try {
      if (!chapter) throw new Error('请先添加章节');
      if (['draft', 'continue', 'rewrite'].includes(kind) && (!Number.isInteger(words) || words < 100 || words > 50000)) throw new Error('目标字数须为 100 至 50000');
      const id = store.launch({ kind, projectId: project.id, chapterId: chapter.id, instruction, targetWords: ['draft', 'continue', 'rewrite'].includes(kind) ? words : undefined, selection: kind === 'rewrite' && selection.end > selection.start ? selection : undefined });
      setSelectedJobId(id); openPanel('chat'); setChooseModel(false); setQuickTask(undefined); setInstruction('');
    } catch (e) { store.notify(message(e)); if (!store.state.providers.some(p => p.enabled && p.models.length)) onSettings(); }
  };
  const polish = async (selected: PolishSelection) => {
    try { await store.polishChapter(project.id, chapter.id, selected); }
    catch (e) { store.notify(message(e)); if (!store.state.providers.some(p => p.enabled && p.models.length)) onSettings(); }
  };
  const move = (id: string, index: number) => { try { update(s => moveChapter(s.projects.find(p => p.id === project.id)!, id, index)); } catch (e) { store.notify(message(e)); } };
  if (!chapter) return <div className="writing-desk"><section className="editor-section"><Empty icon={BookOpen} title="暂无章节" action="添加章节" onAction={add} /></section></div>;
  const chapterJobs = jobs.filter(job => job.steps.some(step => step.chapterId === chapter.id));
  const chatJobs = chapterJobs.filter(job => !job.clearedChatChapterIds?.includes(chapter.id));
  const clearableJobs = chatJobs.filter(canClearWritingChat);
  const resultJob = chapterJobs.find(job => job.id === selectedJobId) ?? chapterJobs[0];
  const selectedJob = chatJobs.find(job => job.id === selectedJobId) ?? chatJobs[0];
  const reviews = chapterJobs.filter(j => j.kind === 'review' && j.steps.some(s => s.chapterId === chapter.id && s.output && ['ready', 'accepted'].includes(s.status)));
  const library = panel === 'materials' ? project.notes.filter(n => n.kind === 'character' || n.kind === 'world') : [];
  const namesInChapter = `${chapter.title}\n${chapter.plan}\n${chapter.content}`;
  const notes = panel === 'materials' ? project.notes.filter(n => n.chapterId === chapter.id || (n.kind === 'character' || n.kind === 'world') && (chapter.materialIds?.includes(n.id) || !!n.title.trim() && namesInChapter.includes(n.title.trim()))) : [];
  const previous = project.chapters[chapterIndex - 1];
  const chapterItems = <ChapterList chapters={project.chapters} selectedId={chapter.id} busyIds={busyIds} onSelect={selectChapter} onMove={move} onRemove={setDeleteChapterId} />;
  const copyChapter = () => {
    const c = { ...chapter, id: uid(), title: `${chapter.title} · 副本`, summary: '', memoryHash: undefined, editorPosition: undefined, versions: [], updatedAt: now() };
    update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters.splice(chapterIndex + 1, 0, c); p.updatedAt = now(); }); selectChapter(c.id);
  };
  const saveVersion = () => { update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? snapshot(c, '手动保存') : c); }); store.notify('版本已保存'); };
  return <div className="writing-desk" data-directory={showDirectory || undefined} data-tools={showTools || undefined}>
    {showDirectory && <aside className="chapter-list" aria-label="章节目录"><div className="panel-heading"><Title order={3}>章节</Title><IconButton icon={Plus} label="添加章节" onClick={add} /><IconButton icon={X} label="收起章节目录" onClick={() => setDirectory(false)} /></div>{chapterItems}<div className="chapter-footer">{project.chapters.length} 章</div></aside>}
    <Drawer opened={!desktop && drawer} onClose={() => setDrawer(false)} title="章节" size={300} padding="md" closeButtonProps={{ 'aria-label': '关闭章节', icon: <X size={20} /> }} styles={{ content: { display: 'flex', flexDirection: 'column' }, body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }}><Group justify="space-between"><Text size="sm" c="dimmed">{project.chapters.length} 章</Text><Button icon={Plus} onClick={add}>添加章节</Button></Group>{chapterItems}</Drawer>
    <section className="editor-section manuscript" aria-label="正文编辑区">
      <div className="editor-toolbar"><Group gap="sm" wrap="nowrap"><IconButton icon={List} label={showDirectory ? '收起章节目录' : '章节列表'} aria-expanded={showDirectory || drawer} onClick={toggleDirectory} /><Title order={3}>正文</Title></Group>
        <Button icon={BookOpen} aria-expanded={showTools} onClick={() => showTools ? setTools(false) : openPanel(panel)}>{showTools ? '收起写作侧栏' : '写作侧栏'}</Button>
      </div>
      <div className="chapter-title-row"><TextInput variant="unstyled" aria-label="章节标题" className="chapter-title" styles={{ input: { fontSize: 22, fontWeight: 600 } }} value={chapter.title} onChange={e => patch({ title: e.target.value })} />
        <Menu position="bottom-end" withinPortal><Menu.Target><Button aria-label="章节操作" icon={ChevronDown}>章节</Button></Menu.Target><Menu.Dropdown>
          <Menu.Item leftSection={<Plus size={18} />} onClick={add}>添加章节</Menu.Item><Menu.Item leftSection={<Copy size={18} />} onClick={copyChapter}>复制章节</Menu.Item>
          <Menu.Item leftSection={<ArrowUp size={18} />} disabled={chapterIndex === 0} onClick={() => move(chapter.id, chapterIndex - 1)}>上移章节</Menu.Item><Menu.Item leftSection={<ArrowDown size={18} />} disabled={chapterIndex === project.chapters.length - 1} onClick={() => move(chapter.id, chapterIndex + 1)}>下移章节</Menu.Item>
          <Menu.Divider /><Menu.Item leftSection={<Trash2 size={18} />} color="red.8" disabled={busyIds.includes(chapter.id)} onClick={() => setDeleteChapterId(chapter.id)}>删除章节</Menu.Item>
        </Menu.Dropdown></Menu>
      </div>
      <ContentEditor key={chapter.id} value={chapter.content} initialPosition={chapter.editorPosition} focusRange={target?.chapterId === chapter.id ? target.range : undefined} onChange={(content, editorPosition) => patch({ content, editorPosition })} onPositionChange={remember} onSelectionChange={setSelection} onPolish={selected => void polish(selected)} readOnly={polishing} busy={busyIds.includes(chapter.id)} />
      <div className="editor-footer"><Group gap="sm"><Text size="sm">{wordCount(chapter.content).toLocaleString()} 字</Text><Text size="sm" c="dimmed" role="status">{store.saveStatus}</Text>{polishing && <Group gap="xs" role="status"><Loader size={16} /><Text size="sm">润色中</Text><Button onClick={() => store.cancelPolish(chapter.id)}>取消润色</Button></Group>}</Group><Group gap="xs"><Button disabled={polishing} onClick={() => setQuickTask('continue')}>续写</Button><Button disabled={polishing} onClick={() => setQuickTask('review')}>审稿</Button><Button primary icon={Save} disabled={saving || polishing} aria-busy={saving} onClick={() => void save()}>保存</Button></Group></div>
    </section>
    {showTools && <aside className="writing-tools" aria-label="写作侧栏"><div className="tools-heading"><OptionTabs label="写作工具" value={panel} onChange={v => setPanel(v as Panel)} options={panels} /></div>
      {panel === 'chat' && <><Group justify="space-between" px="md" py={4}><Text size="sm" fw={600}>创作任务</Text><IconButton icon={Trash2} label="清空聊天记录" disabled={!clearableJobs.length} onClick={() => setClearTarget({ chapterId: chapter.id, title: chapter.title, jobIds: clearableJobs.map(job => job.id) })} /></Group>
        <WritingChat key={chapter.id} chapterId={chapter.id} job={selectedJob} history={chatJobs} project={project} store={store} onResult={openResult} />
        <Stack className="writing-chat-composer" gap="xs" p="sm"><Textarea aria-label="创作要求" placeholder="输入创作要求" autosize minRows={2} maxRows={4} value={instruction} onChange={e => setInstruction(e.target.value)} />
          <Group gap="xs"><MantineSelect aria-label="创作任务类型" w={100} allowDeselect={false} rightSection={<ChevronDown size={18} />} value={task} onChange={value => { if (value) setTask(value as TaskKind); }} data={chapterWritingKinds.map(kind => ({ value: kind, label: taskNames[kind] }))} />
            {['draft', 'continue', 'rewrite'].includes(task) && <NumberInput aria-label="目标字数" value={words} min={100} max={50000} suffix=" 字" w={108} onChange={value => setWords(Number(value))} />}
            <Text size="xs" c="dimmed" maw={120} truncate title={chapter.title}>{chapter.title}</Text>{task === 'rewrite' && selection.end > selection.start && <Text size="sm" c="dimmed">已选 {wordCount(chapter.content.slice(selection.start, selection.end))} 字</Text>}
          </Group><Group gap="xs" className="composer-models"><ReasoningEffortSelect inline provider={provider} value={ai} onChange={store.setAISelection} /><WritingModelSelect providers={store.state.providers} value={ai} onChange={store.setAISelection} /></Group>
          <Group justify="flex-end"><Button primary icon={Sparkles} disabled={polishing} onClick={() => { if (!provider || !ai.model) setChooseModel(true); else launch(); }}>发送</Button></Group>
        </Stack></>}
      {panel === 'result' && <>{chapterJobs.length > 1 && <MantineSelect className="result-picker" aria-label="选择生成稿" allowDeselect={false} rightSection={<ChevronDown size={18} />} value={resultJob?.id} data={chapterJobs.map(job => ({ value: job.id, label: `${taskNames[job.kind]} · ${date(job.createdAt)}` }))} onChange={id => { if (id) setSelectedJobId(id); }} />}
        {resultJob ? <WritingResult key={`${resultJob.id}-${chapter.id}`} job={resultJob} chapterId={chapter.id} project={project} store={store} onLocate={locate} /> : <EmptyState>本章暂无生成结果</EmptyState>}</>}
      {panel === 'plan' && <><Title px="md" pt="md" order={3}>章节细纲</Title><Textarea className="outline-editor" aria-label="章节细纲" variant="unstyled" placeholder="本章的事件、场景与人物变化" value={chapter.plan} onChange={e => patch({ plan: e.target.value })} spellCheck={false} /></>}
      {panel === 'materials' && <ScrollArea className="chapter-materials"><Stack p="md" gap="md"><Title order={3}>章节资料</Title>
        {!!library.length && <MultiSelect label="固定人物与设定" placeholder="查找本书人物、设定" searchable clearable nothingFoundMessage="没有匹配记录" limit={40} value={(chapter.materialIds ?? []).filter(id => library.some(n => n.id === id))} onChange={materialIds => patch({ materialIds })} data={library.map(n => ({ value: n.id, label: `${noteNames[n.kind]}：${n.title}` }))} />}
        {previous?.summary && <Stack gap={4}><Text size="sm" fw={600}>前情 · {previous.title}</Text><Text size="sm" className="prose">{previous.summary}</Text></Stack>}
        {chapter.summary && <Stack gap={4}><Text size="sm" fw={600}>本章摘要</Text><Text size="sm" className="prose">{chapter.summary}</Text></Stack>}
        {!!notes.length && <Accordion multiple key={chapter.id} keepMounted={false} variant="default">{notes.map(n => <Accordion.Item value={n.id} key={n.id}><Accordion.Control><Text size="xs" c="dimmed">{noteNames[n.kind]}</Text><Text size="sm" fw={500}>{n.title}</Text></Accordion.Control><Accordion.Panel><Markdown size="sm" onError={store.notify}>{n.body}</Markdown></Accordion.Panel></Accordion.Item>)}</Accordion>}
        {!!reviews.length && <Stack gap={4}><Text size="sm" fw={600}>历史审稿</Text>{reviews.map(j => <NavLink component="button" key={j.id} leftSection={<FileText size={18} />} label={date(j.createdAt)} description={j.ai?.model} onClick={() => openResult(j.id)} />)}</Stack>}
        {!previous?.summary && !chapter.summary && !notes.length && !reviews.length && <EmptyState>暂无章节资料</EmptyState>}
      </Stack></ScrollArea>}
      {panel === 'versions' && <div className="version-list"><Group gap="xs"><Button icon={Save} disabled={!chapter.content} onClick={saveVersion}>保存版本</Button><RevisionSkillAction project={project} chapter={chapter} store={store} /></Group>
        {chapter.versions.length ? chapter.versions.map(v => <UnstyledButton className="version-row" key={v.id} onClick={() => setVersion(v)}><History size={17} /><span>{v.label}<small>{date(v.createdAt)}</small></span><span className="muted">{wordCount(v.content)} 字</span></UnstyledButton>) : <EmptyState>暂无历史版本</EmptyState>}</div>}
    </aside>}
    <ModalPresence>{(quickTask || chooseModel) && <AITaskModal title={quickTask ? taskNames[quickTask] : '选择模型'} providers={store.state.providers} value={ai} onChange={store.setAISelection} onSettings={onSettings} onSubmit={() => launch(quickTask ?? task)} onClose={() => { setQuickTask(undefined); setChooseModel(false); }} />}</ModalPresence>
    <ModalPresence>{clearTarget && <Confirm title="清空聊天记录" content={`清空「${clearTarget.title}」的聊天记录？生成稿和进行中的任务将保留。`} onClose={() => setClearTarget(undefined)} onConfirm={() => update(state => clearWritingChat(state.jobs, clearTarget.chapterId, clearTarget.jobIds))} />}</ModalPresence>
    <ModalPresence>{chapterToDelete && <Confirm title="删除章节" content={`将「${chapterToDelete.title}」移入回收站？章节和历史版本可恢复。`} onClose={() => setDeleteChapterId(undefined)} onConfirm={() => { try { update(s => removeChapter(s, project.id, chapterToDelete.id)); } catch (e) { store.notify(message(e)); } }} />}</ModalPresence>
    <ModalPresence>{version && <Modal title="版本对比" bounded onClose={() => setVersion(undefined)} footer={<><Button onClick={() => setVersion(undefined)}>关闭</Button><Button primary disabled={polishing || chapter.content === version.content} onClick={() => setRestoreBase(chapter.content)}>恢复版本</Button></>}><Diff left={chapter.content} right={version.content} rightTitle="历史版本" highlightChanges onError={store.notify} /></Modal>}</ModalPresence>
    <ModalPresence>{restoreBase !== undefined && version && <Confirm title="恢复版本" content="当前正文将保存为历史版本。" onClose={() => setRestoreBase(undefined)} onConfirm={() => {
      try { update(s => { const p = s.projects.find(p => p.id === project.id), c = p?.chapters.find(c => c.id === chapter.id); if (!p || !c || c.content !== restoreBase || !c.versions.some(v => v.id === version.id && v.content === version.content)) throw new Error('章节已更新，请重新对比'); Object.assign(c, manuscriptCheckpoint(c, '恢复前'), { content: version.content, summary: '', memoryHash: undefined, updatedAt: now() }); p.updatedAt = now(); }); setVersion(undefined); void store.saveChapter(project.id, chapter.id); } catch (e) { store.notify(message(e)); }
    }} />}</ModalPresence>
  </div>;
}
