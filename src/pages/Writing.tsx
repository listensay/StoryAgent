import { Drawer, Group, Loader, Select as MantineSelect, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, BookOpen, Copy, History, List, Plus, Save, Sparkles, Trash2, X } from '../icons';
import { type Project, type TaskKind, type Chapter, chapterWritingKinds, editChapter, newChapter, now, snapshot, taskNames, uid, wordCount } from '../domain';
import { NumberInput, TextInput, Textarea, UnstyledButton, Title, Button, Confirm, Diff, Empty, EmptyState, IconButton, ModalPresence, Modal, OptionTabs } from '../components';
import { type Store } from '../useWorkspace';
import { WritingResult } from '../WritingResult';
import { AITaskModal, ReasoningEffortSelect, WritingModelSelect } from '../AIControls';
import { WritingChat } from '../WritingChat';
import { ChapterList } from '../ChapterList';
import { ContentEditor } from '../ContentEditor';
import { type PolishSelection } from '../selectionPolish';
import { moveChapter, removeChapter } from '../chapterOperations';
import { canClearWritingChat, clearWritingChat } from '../writingActivity';

export function Writing({ project, store, onSettings, focusChapterId, focusJobId }: { project: Project; store: Store; onSettings: () => void; focusChapterId?: string; focusJobId?: string }) {
  const jobs = store.state.jobs.filter(j => !j.creationTask && !j.planningChat && j.projectId === project.id && chapterWritingKinds.includes(j.kind));
  const initialJob = jobs.find(job => job.id === focusJobId) ?? jobs[0];
  const [chapterId, setChapterId] = useState(focusChapterId ?? initialJob?.steps.find(step => project.chapters.some(chapter => chapter.id === step.chapterId))?.chapterId ?? project.chapters[project.chapters.length - 1]?.id ?? '');
  useEffect(() => { if (focusChapterId) setChapterId(focusChapterId); }, [focusChapterId]);
  const [tab, setTab] = useState<'chat' | 'content' | 'plan' | 'versions' | 'result'>(focusJobId && initialJob?.clearedChatChapterIds?.includes(chapterId) ? 'result' : 'chat');
  const wideLayout = useMediaQuery('(min-width: 1440px)');
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(focusJobId ?? initialJob?.id);
  const [task, setTask] = useState<TaskKind>('draft');
  const ai = store.state.aiSelection;
  const provider = store.state.providers.find(item => item.enabled && item.models.length && item.id === ai.providerId);
  const [quickTask, setQuickTask] = useState<TaskKind>();
  const [chooseModel, setChooseModel] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [words, setWords] = useState(2000);
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
  useEffect(() => { setChapterId(chapter?.id ?? ''); setSelection({ start: 0, end: 0 }); }, [chapter?.id]);
  const patch = (data: Partial<Chapter>) => store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? editChapter(c, data) : c); p.updatedAt = now(); });
  const add = () => { const c = newChapter(`第${project.chapters.length + 1}章`); store.update(s => { s.projects.find(p => p.id === project.id)!.chapters.push(c); }); setChapterId(c.id); setTab('content'); };
  const save = async () => { setSaving(true); try { await store.saveChapter(project.id, chapter.id); } finally { setSaving(false); } };
  const launch = (kind = task) => {
    try {
      if (!chapter) throw new Error('请先添加章节');
      if (['draft', 'continue', 'rewrite'].includes(kind) && (!Number.isInteger(words) || words < 100 || words > 50000)) throw new Error('目标字数须为 100 至 50000');
      const id = store.launch({ kind, projectId: project.id, chapterId: chapter.id, instruction, targetWords: ['draft', 'continue', 'rewrite'].includes(kind) ? words : undefined, selection: kind === 'rewrite' && selection.end > selection.start ? selection : undefined });
      setSelectedJobId(id); setTab('chat');
      setChooseModel(false); setQuickTask(undefined); setInstruction('');
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
  const selectedJob = chatJobs.find(job => job.id === selectedJobId) ?? chatJobs[0];
  if (!chapter) return <div className="writing"><section className="editor-section"><Empty icon={BookOpen} title="暂无章节" action="添加章节" onAction={add} /></section></div>;
  const chapterItems = <ChapterList chapters={project.chapters} selectedId={chapter?.id} busyIds={busyIds} onSelect={id => { setChapterId(id); setChaptersOpen(false); }} onMove={move} onRemove={setDeleteChapterId} />;
  return <div className="writing">
    {wideLayout && <aside className="chapter-list"><div className="panel-heading"><Title order={3}>章节</Title><IconButton icon={Plus} label="添加章节" onClick={add} /></div>{chapterItems}<div className="chapter-footer">{project.chapters.length} 章</div></aside>}
    <Drawer opened={!wideLayout && chaptersOpen} onClose={() => setChaptersOpen(false)} title="章节" size={320} padding="lg" closeButtonProps={{ 'aria-label': '关闭章节', icon: <X size={20} /> }} styles={{ content: { display: 'flex', flexDirection: 'column' }, body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }}><Stack gap="lg" style={{ flex: 1, minHeight: 0 }}><Group justify="space-between"><Text size="sm" c="dimmed">{project.chapters.length} 章</Text><Button icon={Plus} onClick={add}>添加章节</Button></Group>{chapterItems}</Stack></Drawer>
    <section className="editor-section"><div className="editor-toolbar"><div className="row">{!wideLayout && <IconButton icon={List} label="章节列表" onClick={() => setChaptersOpen(true)} />}<OptionTabs label="章节内容" value={tab} onChange={v => setTab(v as typeof tab)} options={[{ value: 'chat', label: '创作任务' }, { value: 'result', label: '生成稿' }, { value: 'content', label: '正文' }, { value: 'plan', label: '细纲' }, { value: 'versions', label: '版本' }]} /></div>
      {tab === 'chat' && <IconButton icon={Trash2} label="清空聊天记录" disabled={!clearableJobs.length} onClick={() => setClearTarget({ chapterId: chapter.id, title: chapter.title, jobIds: clearableJobs.map(job => job.id) })} />}
      {tab === 'result' && chapterJobs.length > 1 && <MantineSelect aria-label="选择生成稿" w={240} allowDeselect={false} rightSection={<ChevronDown size={18} />} value={resultJob?.id} data={chapterJobs.map(job => ({ value: job.id, label: `${taskNames[job.kind]} · ${new Date(job.createdAt).toLocaleString('zh-CN')}` }))} onChange={id => { if (id) setSelectedJobId(id); }} />}
      </div>
      {tab === 'chat' ? <><WritingChat key={chapter.id} chapterId={chapter.id} job={selectedJob} history={chatJobs} project={project} store={store} onResult={jobId => { setSelectedJobId(jobId); setTab('result'); }} />
        <Stack className="writing-chat-composer" gap="sm" px="lg" py="md">
          <Textarea aria-label="创作要求" placeholder="输入创作要求" autosize minRows={2} maxRows={5} value={instruction} onChange={e => setInstruction(e.target.value)} />
          <Group justify="space-between" gap="sm"><Group gap="xs">
            <MantineSelect aria-label="创作任务类型" w={100} allowDeselect={false} rightSection={<ChevronDown size={18} />} value={task} onChange={value => { if (value) setTask(value as TaskKind); }} data={chapterWritingKinds.map(kind => ({ value: kind, label: taskNames[kind] }))} />
            <ReasoningEffortSelect inline provider={provider} value={ai} onChange={store.setAISelection} />
            <WritingModelSelect providers={store.state.providers} value={ai} onChange={store.setAISelection} />
            {['draft', 'continue', 'rewrite'].includes(task) && <NumberInput aria-label="目标字数" value={words} min={100} max={50000} suffix=" 字" w={108} onChange={value => setWords(Number(value))} />}
            <Text size="sm" c="dimmed" maw={160} truncate title={chapter.title}>{chapter.title}</Text>
            {task === 'rewrite' && selection.end > selection.start && <Text size="sm" c="dimmed">已选 {wordCount(chapter.content.slice(selection.start, selection.end))} 字</Text>}
          </Group><Button primary icon={Sparkles} onClick={() => { if (!provider || !ai.model) setChooseModel(true); else launch(); }}>发送</Button></Group>
        </Stack></> : <><div className="chapter-title-row"><TextInput variant="unstyled" aria-label="章节标题" className="chapter-title" styles={{ input: { fontSize: 22, fontWeight: 600 } }} value={chapter.title} onChange={e => patch({ title: e.target.value })} /><div className="row"><IconButton icon={ArrowUp} label="上移章节" disabled={chapterIndex === 0} onClick={() => move(chapter.id, chapterIndex - 1)} /><IconButton icon={ArrowDown} label="下移章节" disabled={chapterIndex === project.chapters.length - 1} onClick={() => move(chapter.id, chapterIndex + 1)} /></div></div>
        {tab === 'result' ? resultJob ? <WritingResult key={`${resultJob.id}-${chapter.id}`} job={resultJob} chapterId={chapter.id} project={project} store={store} /> : <EmptyState>本章暂无生成结果</EmptyState> : tab === 'content' ? <ContentEditor key={chapter.id} value={chapter.content} onChange={content => patch({ content })} onSelectionChange={setSelection} onPolish={selected => void polish(selected)} readOnly={polishing} busy={busyIds.includes(chapter.id)} /> : tab === 'plan' ? <Textarea variant="unstyled" className="novel-editor" styles={{ root: { flex: 1, minHeight: 0 }, wrapper: { height: '100%' }, input: { height: '100%', fontSize: 16, lineHeight: 2, resize: 'none', padding: '16px 28px 28px' } }} aria-label="章节细纲" placeholder="本章的事件、场景与人物变化" value={chapter.plan} onChange={e => patch({ plan: e.target.value })} spellCheck={false} /> : <div className="version-list"><Button icon={Save} onClick={() => { store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? snapshot(c, '手动保存') : c); }); store.notify('版本已保存'); }}>保存版本</Button>{chapter.versions.length ? chapter.versions.map(v => <UnstyledButton className="version-row" key={v.id} onClick={() => setVersion(v)}><History size={17} /><span>{v.label}<small>{new Date(v.createdAt).toLocaleString('zh-CN')}</small></span><span className="muted">{wordCount(v.content)} 字</span></UnstyledButton>) : <EmptyState>暂无历史版本</EmptyState>}</div>}
        <div className="editor-footer"><Group gap="md"><Text size="sm">{wordCount(chapter.content).toLocaleString()} 字</Text><Text size="sm" c="dimmed" role="status">{store.saveStatus}</Text>{polishing && <Group gap="xs" role="status"><Loader size={16} /><Text size="sm">润色中</Text><Button onClick={() => store.cancelPolish(chapter.id)}>取消润色</Button></Group>}</Group><Group gap="xs"><IconButton icon={Copy} label="复制章节" onClick={() => { const c = { ...chapter, id: uid(), title: chapter.title + ' · 副本', summary: '', memoryHash: undefined, versions: [], updatedAt: now() }; store.update(s => { s.projects.find(p => p.id === project.id)!.chapters.splice(chapterIndex + 1, 0, c); }); setChapterId(c.id); }} /><IconButton icon={Trash2} label="删除章节" disabled={busyIds.includes(chapter.id)} onClick={() => setDeleteChapterId(chapter.id)} />{tab !== 'result' && <>{tab === 'content' && <Button primary icon={Save} disabled={saving || polishing} aria-busy={saving} onClick={() => void save()}>保存</Button>}<Button disabled={polishing} onClick={() => setQuickTask('continue')}>续写</Button><Button disabled={polishing} onClick={() => setQuickTask('review')}>审稿</Button></>}</Group></div>
      </>}
    </section>
    <ModalPresence>{(quickTask || chooseModel) && <AITaskModal title={quickTask ? taskNames[quickTask] : '选择模型'} providers={store.state.providers} value={ai} onChange={store.setAISelection} onSettings={onSettings} onSubmit={() => launch(quickTask ?? task)} onClose={() => { setQuickTask(undefined); setChooseModel(false); }} />}</ModalPresence>
    <ModalPresence>{clearTarget && <Confirm title="清空聊天记录" content={`清空「${clearTarget.title}」的聊天记录？生成稿和进行中的任务将保留。`} onClose={() => setClearTarget(undefined)} onConfirm={() => store.update(state => clearWritingChat(state.jobs, clearTarget.chapterId, clearTarget.jobIds))} />}</ModalPresence>
    <ModalPresence>{chapterToDelete && <Confirm title="删除章节" content={`确认删除「${chapterToDelete.title}」及其历史版本？`} onClose={() => setDeleteChapterId(undefined)} onConfirm={() => { try { store.update(s => { removeChapter(s, project.id, chapterToDelete.id); }); } catch (error) { store.notify(error instanceof Error ? error.message : String(error)); } }} />}</ModalPresence>
    <ModalPresence>{version && <Modal title="版本对比" wide bounded onClose={() => setVersion(undefined)} footer={<><Button onClick={() => setVersion(undefined)}>关闭</Button><Button primary onClick={() => setRestore(true)}>恢复版本</Button></>}><Diff left={chapter?.content ?? ''} right={version.content} rightTitle="历史版本" onError={store.notify} /></Modal>}</ModalPresence>
    <ModalPresence>{restore && version && <Confirm title="恢复版本" content="当前正文将保存为历史版本。" onClose={() => setRestore(false)} onConfirm={() => { store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? { ...snapshot(c, '恢复前'), content: version.content, updatedAt: now() } : c); }); setVersion(undefined); }} />}</ModalPresence>
  </div>;
}
