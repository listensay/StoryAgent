import { Drawer, Group, Loader, Select as MantineSelect, NavLink, ScrollArea, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, BookOpen, Copy, History, List, Plus, Save, Settings2, Sparkles, Trash2, X } from '../icons';
import { type Project, type TaskKind, type Chapter, editChapter, newChapter, now, snapshot, taskNames, uid, wordCount } from '../domain';
import { NumberInput, TextInput, Textarea, UnstyledButton, Title, Button, Confirm, Diff, Empty, EmptyState, IconButton, ModalPresence, Modal, Select, Badge, Field, OptionTabs } from '../components';
import { type Store } from '../useWorkspace';
import { WritingResult, writingStatuses } from '../WritingResult';
import { AIControls, AITaskModal } from '../AIControls';
import { WritingChat } from '../WritingChat';
import { ChapterList } from '../ChapterList';
import { ContentEditor } from '../ContentEditor';
import { type PolishSelection } from '../selectionPolish';
import { moveChapter, removeChapter } from '../chapterOperations';
import { canClearWritingChat, clearWritingChat } from '../writingActivity';

export function Writing({ project, store, onSettings, focusChapterId, focusJobId }: { project: Project; store: Store; onSettings: () => void; focusChapterId?: string; focusJobId?: string }) {
  const jobs = store.state.jobs.filter(j => !j.creationTask && !j.planningChat && j.projectId === project.id && ['draft', 'continue', 'rewrite', 'review', 'plan'].includes(j.kind));
  const initialJob = jobs.find(job => job.id === focusJobId) ?? jobs[0];
  const [chapterId, setChapterId] = useState(focusChapterId ?? initialJob?.steps.find(step => project.chapters.some(chapter => chapter.id === step.chapterId))?.chapterId ?? project.chapters[project.chapters.length - 1]?.id ?? '');
  useEffect(() => { if (focusChapterId) setChapterId(focusChapterId); }, [focusChapterId]);
  const [tab, setTab] = useState<'chat' | 'content' | 'plan' | 'versions' | 'result'>(focusJobId && initialJob?.clearedChatChapterIds?.includes(chapterId) ? 'result' : 'chat');
  const [agent, setAgent] = useState(false);
  const wideLayout = useMediaQuery('(min-width: 1440px)');
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [panelTab, setPanelTab] = useState(focusJobId ? 'history' : 'new');
  const [selectedJobId, setSelectedJobId] = useState(focusJobId ?? initialJob?.id);
  const [task, setTask] = useState<TaskKind>('draft');
  const ai = store.state.aiSelection;
  const [quickTask, setQuickTask] = useState<TaskKind>();
  const [instruction, setInstruction] = useState('');
  const [words, setWords] = useState(2000);
  const [from, setFrom] = useState(1), [to, setTo] = useState(1);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [deleteChapterId, setDeleteChapterId] = useState<string>();
  const [clearTarget, setClearTarget] = useState<{ chapterId: string; jobIds: string[]; title: string }>();
  const [version, setVersion] = useState<Chapter['versions'][number]>();
  const [restore, setRestore] = useState(false);
  const [saving, setSaving] = useState(false);
  const chapter = project.chapters.find(c => c.id === chapterId) ?? project.chapters[project.chapters.length - 1];
  const chapterIndex = project.chapters.findIndex(c => c.id === chapter?.id);
  const chapterToDelete = project.chapters.find(c => c.id === deleteChapterId);
  const polishing = store.polishingChapters.includes(chapter?.id);
  const busyIds = [...store.polishingChapters, ...store.state.jobs.filter(job => job.projectId === project.id && ['queued', 'running'].includes(job.status)).flatMap(job => job.steps.map(step => step.chapterId))];
  useEffect(() => { setChapterId(chapter?.id ?? ''); if (chapter) { setFrom(chapterIndex + 1); setTo(chapterIndex + 1); setSelection({ start: 0, end: 0 }); } }, [chapter?.id, chapterIndex]);
  const patch = (data: Partial<Chapter>) => store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? editChapter(c, data) : c); p.updatedAt = now(); });
  const add = () => { const c = newChapter(`第${project.chapters.length + 1}章`); store.update(s => { s.projects.find(p => p.id === project.id)!.chapters.push(c); }); setChapterId(c.id); setTab('content'); };
  const save = async () => { setSaving(true); try { await store.saveChapter(project.id, chapter.id); } finally { setSaving(false); } };
  const launch = (kind = task, single = false) => {
    try {
      if (!chapter && kind !== 'draft') throw new Error('请先添加章节');
      if (['draft', 'continue', 'rewrite'].includes(kind) && (!Number.isInteger(words) || words < 100 || words > 50000)) throw new Error('目标字数须为 100 至 50000');
      if (!single && (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > Math.max(1, project.chapters.length))) throw new Error('章节范围无效');
      const chapterIds = !chapter ? [] : single ? [chapter.id] : project.chapters.slice(from - 1, to).map(c => c.id);
      const id = store.launch({ kind, projectId: project.id, chapterIds, instruction, targetWords: ['draft', 'continue', 'rewrite'].includes(kind) ? words : undefined, selection: kind === 'rewrite' && selection.end > selection.start && chapterIds.length === 1 && chapterIds[0] === chapter.id ? selection : undefined });
      setSelectedJobId(id); setChapterId(store.stateRef.current.jobs.find(job => job.id === id)?.steps[0]?.chapterId ?? chapterIds[0]); setTab('chat'); setPanelTab('history');
      setAgent(false); setQuickTask(undefined); setInstruction('');
    } catch (e) { store.notify(e instanceof Error ? e.message : String(e)); if (!store.state.providers.some(p => p.enabled && p.models.length)) onSettings(); }
  };
  const polish = async (selected: PolishSelection) => {
    try {
      await store.polishChapter(project.id, chapter.id, selected);
      setSelection({ start: 0, end: 0 });
    } catch (error) {
      store.notify(error instanceof Error ? error.message : String(error));
      if (!store.state.providers.some(p => p.enabled && p.models.length)) onSettings();
    }
  };
  const move = (id: string, index: number) => {
    try { store.update(s => { moveChapter(s.projects.find(p => p.id === project.id)!, id, index); }); }
    catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
  };
  const chapterJobs = jobs.filter(job => job.steps.some(step => step.chapterId === chapter?.id));
  const chatJobs = chapterJobs.filter(job => !job.clearedChatChapterIds?.includes(chapter.id));
  const clearableJobs = chatJobs.filter(canClearWritingChat);
  const resultJob = chapterJobs.find(job => job.id === selectedJobId) ?? chapterJobs[0];
  const selectedJob = tab === 'chat' ? chatJobs.find(job => job.id === selectedJobId) ?? chatJobs[0] : resultJob;
  const chapterItems = <ChapterList chapters={project.chapters} selectedId={chapter?.id} busyIds={busyIds} onSelect={id => { setChapterId(id); setChaptersOpen(false); }} onMove={move} onRemove={setDeleteChapterId} />;
  return <div className="writing">
    {wideLayout && <aside className="chapter-list"><div className="panel-heading"><Title order={3}>章节</Title><IconButton icon={Plus} label="添加章节" onClick={add} /></div>{chapterItems}<div className="chapter-footer">{project.chapters.length} 章</div></aside>}
    <Drawer opened={!wideLayout && chaptersOpen} onClose={() => setChaptersOpen(false)} title="章节" size={320} padding="lg" closeButtonProps={{ 'aria-label': '关闭章节', icon: <X size={20} /> }} styles={{ content: { display: 'flex', flexDirection: 'column' }, body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }}><Stack gap="lg" style={{ flex: 1, minHeight: 0 }}><Group justify="space-between"><Text size="sm" c="dimmed">{project.chapters.length} 章</Text><Button icon={Plus} onClick={add}>添加章节</Button></Group>{chapterItems}</Stack></Drawer>
    <section className="editor-section"><div className="editor-toolbar"><div className="row">{!wideLayout && <IconButton icon={List} label="章节列表" onClick={() => setChaptersOpen(true)} />}<OptionTabs label="章节内容" value={tab} onChange={v => setTab(v as typeof tab)} options={[{ value: 'chat', label: '创作任务' }, { value: 'result', label: '生成稿' }, { value: 'content', label: '正文' }, { value: 'plan', label: '细纲' }, { value: 'versions', label: '版本' }]} /></div><Group gap="xs">
      {tab === 'chat' && <IconButton icon={Trash2} label="清空聊天记录" disabled={!clearableJobs.length} onClick={() => setClearTarget({ chapterId: chapter.id, title: chapter.title, jobIds: clearableJobs.map(job => job.id) })} />}
      <Button icon={Settings2} className={agent ? 'soft' : ''} onClick={() => setAgent(!agent)}>任务设置</Button></Group></div>
      {tab === 'chat' ? <><WritingChat key={chapter?.id} chapterId={chapter?.id} job={selectedJob} history={chatJobs} project={project} store={store} onResult={(id, jobId) => { if (jobId) setSelectedJobId(jobId); setChapterId(id); setTab('result'); }} /><Stack className="writing-chat-composer" gap="sm" px="lg" py="md"><Textarea aria-label="创作要求" placeholder="输入创作要求" autosize minRows={2} maxRows={5} value={instruction} onChange={e => setInstruction(e.target.value)} /><Group justify="space-between" gap="sm"><Group gap="sm"><MantineSelect aria-label="创作任务类型" w={120} allowDeselect={false} rightSection={<ChevronDown size={18} />} value={task} onChange={value => { if (value) setTask(value as TaskKind); }} data={(['draft', 'continue', 'rewrite', 'review', 'plan'] as TaskKind[]).map(kind => ({ value: kind, label: taskNames[kind] }))} /><Text size="sm" c="dimmed">{chapter?.title ?? '新章节'}{['draft', 'continue', 'rewrite'].includes(task) ? ` · ${words.toLocaleString()} 字` : ''}</Text></Group><Button primary icon={Sparkles} onClick={() => launch(task, true)}>发送</Button></Group></Stack></> : chapter ? <><div className="chapter-title-row"><TextInput variant="unstyled" aria-label="章节标题" className="chapter-title" styles={{ input: { fontSize: 22, fontWeight: 600 } }} value={chapter.title} onChange={e => patch({ title: e.target.value })} /><div className="row"><IconButton icon={ArrowUp} label="上移章节" disabled={chapterIndex === 0} onClick={() => move(chapter.id, chapterIndex - 1)} /><IconButton icon={ArrowDown} label="下移章节" disabled={chapterIndex === project.chapters.length - 1} onClick={() => move(chapter.id, chapterIndex + 1)} /></div></div>
        {tab === 'result' ? resultJob ? <WritingResult key={`${resultJob.id}-${chapter.id}`} job={resultJob} chapterId={chapter.id} project={project} store={store} /> : <EmptyState>本章暂无生成结果</EmptyState> : tab === 'content' ? <ContentEditor key={chapter.id} value={chapter.content} onChange={content => patch({ content })} onSelectionChange={setSelection} onPolish={selected => void polish(selected)} readOnly={polishing} busy={busyIds.includes(chapter.id)} /> : tab === 'plan' ? <Textarea variant="unstyled" className="novel-editor" styles={{ root: { flex: 1, minHeight: 0 }, wrapper: { height: '100%' }, input: { height: '100%', fontSize: 16, lineHeight: 2, resize: 'none', padding: '16px 28px 28px' } }} aria-label="章节细纲" placeholder="本章的事件、场景与人物变化" value={chapter.plan} onChange={e => patch({ plan: e.target.value })} spellCheck={false} /> : <div className="version-list"><Button icon={Save} onClick={() => { store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? snapshot(c, '手动保存') : c); }); store.notify('版本已保存'); }}>保存版本</Button>{chapter.versions.length ? chapter.versions.map(v => <UnstyledButton className="version-row" key={v.id} onClick={() => setVersion(v)}><History size={17} /><span>{v.label}<small>{new Date(v.createdAt).toLocaleString('zh-CN')}</small></span><span className="muted">{wordCount(v.content)} 字</span></UnstyledButton>) : <EmptyState>暂无历史版本</EmptyState>}</div>}
        <div className="editor-footer"><Group gap="md"><Text size="sm">{wordCount(chapter.content).toLocaleString()} 字</Text><Text size="sm" c="dimmed" role="status">{store.saveStatus}</Text>{polishing && <Group gap="xs" role="status"><Loader size={16} /><Text size="sm">润色中</Text><Button onClick={() => store.cancelPolish(chapter.id)}>取消润色</Button></Group>}</Group><Group gap="xs"><IconButton icon={Copy} label="复制章节" onClick={() => { const c = { ...chapter, id: uid(), title: chapter.title + ' · 副本', summary: '', memoryHash: undefined, versions: [], updatedAt: now() }; store.update(s => { s.projects.find(p => p.id === project.id)!.chapters.splice(chapterIndex + 1, 0, c); }); setChapterId(c.id); }} /><IconButton icon={Trash2} label="删除章节" disabled={busyIds.includes(chapter.id)} onClick={() => setDeleteChapterId(chapter.id)} />{tab !== 'result' && <>{tab === 'content' && <Button primary icon={Save} disabled={saving || polishing} aria-busy={saving} onClick={() => void save()}>保存</Button>}<Button disabled={polishing} onClick={() => setQuickTask('continue')}>续写</Button><Button disabled={polishing} onClick={() => setQuickTask('review')}>审稿</Button></>}</Group></div>
      </> : <Empty icon={BookOpen} title="暂无章节" action="添加章节" onAction={add} />}
    </section>
    <Drawer opened={agent} onClose={() => setAgent(false)} title="任务设置" position="right" size={360} padding={0} closeButtonProps={{ 'aria-label': '关闭任务设置', icon: <X size={20} /> }} styles={{ content: { display: 'flex', flexDirection: 'column', overflow: 'hidden' }, header: { padding: 20, flexShrink: 0 }, body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }}><div className="agent-tabs"><OptionTabs label="创作任务面板" value={panelTab} onChange={setPanelTab} options={[{ value: 'new', label: '新建任务' }, { value: 'history', label: '任务记录' }]} /></div>{panelTab === 'new' ? <><ScrollArea type="auto" className="agent-scroll" viewportProps={{ role: 'region', 'aria-label': '创作任务设置' }}><div className="agent-form"><Select label="任务" value={task} onChange={v => setTask(v as TaskKind)} options={(['draft', 'continue', 'rewrite', 'review', 'plan'] as TaskKind[]).map(kind => ({ value: kind, label: taskNames[kind] }))} /><AIControls providers={store.state.providers} value={ai} onChange={store.setAISelection} onSettings={onSettings} />
      <div className="form-grid"><Field label="起始章节"><NumberInput min={1} max={Math.max(1, project.chapters.length)} value={from} onChange={value => setFrom(Number(value))} /></Field><Field label="结束章节"><NumberInput min={from} max={Math.max(1, project.chapters.length)} value={to} onChange={value => setTo(Number(value))} /></Field></div>
      {['draft', 'continue', 'rewrite'].includes(task) && <><Field label="目标字数"><NumberInput value={words} min={100} max={50000} onChange={value => setWords(Number(value))} /></Field></>}
      {task === 'rewrite' && selection.end > selection.start && from === to && from === chapterIndex + 1 && <Badge color="story">选中片段 · {wordCount(chapter?.content.slice(selection.start, selection.end) ?? '')} 字</Badge>}
      <Field label="创作要求"><Textarea rows={3} placeholder="本次任务的目标与约束" value={instruction} onChange={e => setInstruction(e.target.value)} /></Field>
    </div></ScrollArea><Group p="md" grow style={{ flexShrink: 0, borderTop: '1px solid var(--mantine-color-gray-2)' }}><Button primary icon={Sparkles} onClick={() => launch()}>开始生成</Button></Group></> : <ScrollArea type="auto" className="agent-scroll"><Stack p="sm" gap="xs">{chapterJobs.length ? chapterJobs.map(job => <NavLink component="button" key={job.id} active={['chat', 'result'].includes(tab) && selectedJob?.id === job.id} label={<Group justify="space-between" wrap="nowrap"><Text size="sm" fw={500}>{taskNames[job.kind]}</Text><Badge color={job.status === 'failed' ? 'red' : ['running', 'queued'].includes(job.status) ? 'story' : 'gray'}>{writingStatuses[job.status]}</Badge></Group>} description={<Stack gap={4} mt={6}><Text size="sm" lineClamp={2}>{job.steps.find(step => !step.intermediate && step.chapterId === chapter?.id)?.title}</Text><Text size="xs" c="dimmed">{new Date(job.createdAt).toLocaleString('zh-CN')}</Text></Stack>} onClick={() => { setSelectedJobId(job.id); setTab(job.clearedChatChapterIds?.includes(chapter.id) ? 'result' : 'chat'); setAgent(false); }} />) : <EmptyState>暂无任务</EmptyState>}</Stack></ScrollArea>}</Drawer>
    <ModalPresence>{quickTask && <AITaskModal title={taskNames[quickTask]} providers={store.state.providers} value={ai} onChange={store.setAISelection} onSettings={onSettings} onSubmit={() => launch(quickTask, true)} onClose={() => setQuickTask(undefined)} />}</ModalPresence>
    <ModalPresence>{clearTarget && <Confirm title="清空聊天记录" content={`清空「${clearTarget.title}」的聊天记录？生成稿和进行中的任务将保留。`} onClose={() => setClearTarget(undefined)} onConfirm={() => store.update(state => clearWritingChat(state.jobs, clearTarget.chapterId, clearTarget.jobIds))} />}</ModalPresence>
    <ModalPresence>{chapterToDelete && <Confirm title="删除章节" content={`确认删除「${chapterToDelete.title}」及其历史版本？`} onClose={() => setDeleteChapterId(undefined)} onConfirm={() => { try { store.update(s => { removeChapter(s, project.id, chapterToDelete.id); }); } catch (error) { store.notify(error instanceof Error ? error.message : String(error)); } }} />}</ModalPresence>
    <ModalPresence>{version && <Modal title="版本对比" wide bounded onClose={() => setVersion(undefined)} footer={<><Button onClick={() => setVersion(undefined)}>关闭</Button><Button primary onClick={() => setRestore(true)}>恢复版本</Button></>}><Diff left={chapter?.content ?? ''} right={version.content} rightTitle="历史版本" onError={store.notify} /></Modal>}</ModalPresence>
    <ModalPresence>{restore && version && <Confirm title="恢复版本" content="当前正文将保存为历史版本。" onClose={() => setRestore(false)} onConfirm={() => { store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? { ...snapshot(c, '恢复前'), content: version.content, updatedAt: now() } : c); }); setVersion(undefined); }} />}</ModalPresence>
  </div>;
}
