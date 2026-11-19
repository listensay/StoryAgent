import { NavLink, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Copy, History, List, Plus, Save, Sparkles, Trash2, X } from '../icons';
import { type Project, type TaskKind, type Chapter, editChapter, newChapter, now, profileFor, snapshot, taskNames, uid, wordCount } from '../domain';
import { NumberInput, TextInput, Textarea, UnstyledButton, Title, Button, Confirm, Diff, Empty, EmptyState, IconButton, ModalPresence, Modal, Select, Badge, Field, OptionTabs } from '../components';
import { type Store } from '../useWorkspace';
import { JobCard } from '../JobCard';

export function Writing({ project, store, onSettings }: { project: Project; store: Store; onSettings: () => void }) {
  const [chapterId, setChapterId] = useState(project.chapters[0]?.id ?? '');
  const [tab, setTab] = useState<'content' | 'plan' | 'versions'>('content');
  const [agent, setAgent] = useState(() => window.innerWidth > 680);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [task, setTask] = useState<TaskKind>('draft');
  const [profileId, setProfileId] = useState(profileFor(store.state, task)?.id ?? '');
  const [styleId, setStyleId] = useState('');
  const [instruction, setInstruction] = useState('');
  const [words, setWords] = useState(2000);
  const [from, setFrom] = useState(1), [to, setTo] = useState(1);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [deleteChapter, setDeleteChapter] = useState(false);
  const [version, setVersion] = useState<Chapter['versions'][number]>();
  const [restore, setRestore] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const chapter = project.chapters.find(c => c.id === chapterId) ?? project.chapters[0];
  const chapterIndex = project.chapters.findIndex(c => c.id === chapter?.id);
  useEffect(() => { if (chapter) { setFrom(chapterIndex + 1); setTo(chapterIndex + 1); setSelection({ start: 0, end: 0 }); } }, [chapter?.id, chapterIndex]);
  useEffect(() => { setProfileId(profileFor(store.state, task)?.id ?? ''); }, [task]);
  useEffect(() => { if (!store.state.profiles.some(p => p.id === profileId)) setProfileId(profileFor(store.state, task)?.id ?? ''); }, [store.state.profiles, profileId, task]);
  const patch = (data: Partial<Chapter>) => store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? editChapter(c, data) : c); p.updatedAt = now(); });
  const add = () => { const c = newChapter(`第${project.chapters.length + 1}章`); store.update(s => { s.projects.find(p => p.id === project.id)!.chapters.push(c); }); setChapterId(c.id); setTab('content'); };
  const launch = (kind = task, single = false) => {
    try {
      if (!chapter) throw new Error('请先添加章节');
      if (['draft', 'continue', 'rewrite'].includes(kind) && (!Number.isInteger(words) || words < 100 || words > 50000)) throw new Error('目标字数须为 100 至 50000');
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > project.chapters.length) throw new Error('章节范围无效');
      const chapterIds = single ? [chapter.id] : project.chapters.slice(from - 1, to).map(c => c.id);
      store.launch({ kind, projectId: project.id, chapterIds, profileId: single ? profileFor(store.state, kind)?.id : profileId, styleId: styleId || chapter.styleId || project.styleId, instruction: `${instruction}${['draft', 'continue', 'rewrite'].includes(kind) ? `\n目标篇幅约 ${words} 字。` : ''}`, selection: kind === 'rewrite' && selection.end > selection.start && chapterIds.length === 1 ? selection : undefined });
      setAgent(true);
    } catch (e) { store.notify(e instanceof Error ? e.message : String(e)); if (!store.state.profiles.length) onSettings(); }
  };
  const move = (offset: number) => store.update(s => { const p = s.projects.find(p => p.id === project.id)!; const index = p.chapters.findIndex(c => c.id === chapter.id); const dest = index + offset; if (dest >= 0 && dest < p.chapters.length) [p.chapters[index], p.chapters[dest]] = [p.chapters[dest], p.chapters[index]]; });
  const jobs = store.state.jobs.filter(j => j.projectId === project.id && !['scan', 'analyze'].includes(j.kind));
  return <div className={`writing ${agent ? 'with-agent' : ''}`}>
    <aside className={`chapter-list ${chaptersOpen ? 'mobile-open' : ''}`}><div className="panel-heading"><Title order={3}>章节</Title><IconButton icon={Plus} label="添加章节" onClick={add} /><IconButton icon={X} label="关闭章节" className="mobile-only icon-button" onClick={() => setChaptersOpen(false)} /></div><div className="chapter-items">{project.chapters.map((c, i) => <NavLink component="button" key={c.id} className="chapter-item" active={chapter?.id === c.id} onClick={() => { setChapterId(c.id); setChaptersOpen(false); }} leftSection={<Text size="xs" c="dimmed">{String(i + 1).padStart(2, '0')}</Text>} label={c.title} description={`${wordCount(c.content).toLocaleString()} 字`} />)}</div><div className="chapter-footer">{project.chapters.length} 章</div></aside>
    <section className="editor-section"><div className="editor-toolbar"><div className="row"><IconButton icon={List} label="章节列表" className="mobile-only icon-button" onClick={() => setChaptersOpen(!chaptersOpen)} /><OptionTabs label="章节内容" value={tab} onChange={v => setTab(v as typeof tab)} options={[{ value: 'content', label: '正文' }, { value: 'plan', label: '细纲' }, { value: 'versions', label: '版本' }]} /></div><Button icon={Sparkles} className={agent ? 'soft' : ''} onClick={() => setAgent(!agent)}>Agent</Button></div>
      {chapter ? <><div className="chapter-title-row"><TextInput variant="unstyled" aria-label="章节标题" className="chapter-title" styles={{ input: { fontSize: 22, fontWeight: 600 } }} value={chapter.title} onChange={e => patch({ title: e.target.value })} /><div className="row"><IconButton icon={ArrowUp} label="上移章节" disabled={chapterIndex === 0} onClick={() => move(-1)} /><IconButton icon={ArrowDown} label="下移章节" disabled={chapterIndex === project.chapters.length - 1} onClick={() => move(1)} /><IconButton icon={Copy} label="复制章节" onClick={() => { const c = { ...chapter, id: uid(), title: chapter.title + ' · 副本', versions: [], updatedAt: now() }; store.update(s => { s.projects.find(p => p.id === project.id)!.chapters.splice(chapterIndex + 1, 0, c); }); setChapterId(c.id); }} /><IconButton icon={Trash2} label="删除章节" onClick={() => setDeleteChapter(true)} /></div></div>
        {tab !== 'versions' ? <Textarea ref={editor} variant="unstyled" className="novel-editor" styles={{ root: { flex: 1, minHeight: 0 }, wrapper: { height: '100%' }, input: { height: '100%', fontSize: 16, lineHeight: 2, resize: 'none', padding: '16px 28px 28px' } }} aria-label={tab === 'content' ? '章节正文' : '章节细纲'} placeholder={tab === 'content' ? '开始写作' : '本章的事件、场景与人物变化'} value={tab === 'content' ? chapter.content : chapter.plan} onChange={e => patch(tab === 'content' ? { content: e.target.value } : { plan: e.target.value })} onSelect={() => { if (tab === 'content' && editor.current) setSelection({ start: editor.current.selectionStart, end: editor.current.selectionEnd }); }} spellCheck={false} /> : <div className="version-list"><Button icon={Save} onClick={() => { store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? snapshot(c, '手动保存') : c); }); store.notify('版本已保存'); }}>保存版本</Button>{chapter.versions.length ? chapter.versions.map(v => <UnstyledButton className="version-row" key={v.id} onClick={() => setVersion(v)}><History size={17} /><span>{v.label}<small>{new Date(v.createdAt).toLocaleString('zh-CN')}</small></span><span className="muted">{wordCount(v.content)} 字</span></UnstyledButton>) : <EmptyState>暂无历史版本</EmptyState>}</div>}
        <div className="editor-footer"><span>{wordCount(chapter.content).toLocaleString()} 字</span><Select label="章节默认风格" className="chapter-style" value={chapter.styleId} onChange={styleId => patch({ styleId })} options={[{ value: '', label: '使用小说风格' }, ...store.state.styles.map(s => ({ value: s.id, label: s.name }))]} /><div className="row"><Button onClick={() => launch('continue', true)}>续写</Button><Button onClick={() => launch('review', true)}>审稿</Button><Button onClick={() => launch('memory', true)}>提取记忆</Button></div></div>
      </> : <Empty icon={BookOpen} title="暂无章节" action="添加章节" onAction={add} />}
    </section>
    {agent && <aside className="agent-panel"><div className="panel-heading"><Title order={3}><Sparkles size={17} /> 创作任务</Title><IconButton icon={X} label="关闭 Agent" onClick={() => setAgent(false)} /></div><div className="agent-form"><Select label="任务" value={task} onChange={v => setTask(v as TaskKind)} options={(['draft', 'continue', 'rewrite', 'review', 'plan', 'memory', 'style'] as TaskKind[]).map(kind => ({ value: kind, label: taskNames[kind] }))} /><Select label="模型预设" value={profileId} onChange={setProfileId} options={store.state.profiles.length ? store.state.profiles.map(p => ({ value: p.id, label: p.name })) : [{ value: '', label: '暂无预设' }]} />
      <div className="form-grid"><Field label="起始章节"><NumberInput min={1} max={project.chapters.length} value={from} onChange={value => setFrom(Number(value))} /></Field><Field label="结束章节"><NumberInput min={from} max={project.chapters.length} value={to} onChange={value => setTo(Number(value))} /></Field></div>
      {['draft', 'continue', 'rewrite'].includes(task) && <><Select label="写作风格" value={styleId} onChange={setStyleId} options={[{ value: '', label: '使用小说或章节设置' }, ...store.state.styles.map(s => ({ value: s.id, label: s.name }))]} /><Field label="目标字数"><NumberInput value={words} min={100} max={50000} onChange={value => setWords(Number(value))} /></Field></>}
      {task === 'rewrite' && selection.end > selection.start && from === to && <Badge color="story">选中片段 · {wordCount(chapter?.content.slice(selection.start, selection.end) ?? '')} 字</Badge>}
      <Field label="创作要求"><Textarea rows={3} placeholder="本次任务的目标与约束" value={instruction} onChange={e => setInstruction(e.target.value)} /></Field>{store.state.profiles.length ? <Button primary icon={Sparkles} onClick={() => launch()}>开始生成</Button> : <Button primary onClick={onSettings}>添加模型预设</Button>}
    </div><div className="agent-results">{jobs.length ? jobs.map(j => <JobCard key={j.id} job={j} store={store} compact />) : <EmptyState>暂无任务</EmptyState>}</div></aside>}
    <ModalPresence>{deleteChapter && <Confirm title="删除章节" content={`确认删除「${chapter?.title}」及其历史版本？`} onClose={() => setDeleteChapter(false)} onConfirm={() => store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.filter(c => c.id !== chapter.id); })} />}</ModalPresence>
    <ModalPresence>{version && <Modal title="版本对比" wide onClose={() => setVersion(undefined)} footer={<><Button onClick={() => setVersion(undefined)}>关闭</Button><Button primary onClick={() => setRestore(true)}>恢复版本</Button></>}><Diff left={chapter?.content ?? ''} right={version.content} rightTitle="历史版本" /></Modal>}</ModalPresence>
    <ModalPresence>{restore && version && <Confirm title="恢复版本" content="当前正文将保存为历史版本。" onClose={() => setRestore(false)} onConfirm={() => { store.update(s => { const p = s.projects.find(p => p.id === project.id)!; p.chapters = p.chapters.map(c => c.id === chapter.id ? { ...snapshot(c, '恢复前'), content: version.content, updatedAt: now() } : c); }); setVersion(undefined); }} />}</ModalPresence>
  </div>;
}
