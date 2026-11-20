import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Stack, Box, SimpleGrid } from '@mantine/core';
import { Sparkles, Trash2 } from '../icons';
import { Paper, Textarea, Title, Button, Confirm, EmptyState, Field, IconButton, ModalPresence, Select, OptionTabs } from '../components';
import { type Reference, type TaskKind, importChapters } from '../domain';
import { type RankedBook } from '../rankings';
import { type Store } from '../useWorkspace';
import { JobCard } from '../JobCard';
import { AIControls } from '../AIControls';
import { ReferencePreview } from '../ReferencePreview';
import { RankingScan, RankingResults, NoRankings } from './RankingScan';
import { BookResearch } from './BookResearch';
import { BookSearch } from './BookSearch';
import { ArticleTaskPanel } from './ArticleCollection';

export function Research({ store, onSettings, initialTask = 'scan', focusJobId }: { store: Store; onSettings: () => void; initialTask?: 'scan' | 'style'; focusJobId?: string }) {
  const [focused, setFocused] = useState(focusJobId);
  useEffect(() => { setFocused(focusJobId); }, [focusJobId]);
  const focusedJob = store.state.jobs.find(j => j.id === focused);
  const [kind, setKind] = useState<Reference['kind'] | 'search'>(initialTask === 'style' && !store.state.references.some(r => r.ranking) && store.state.references.some(r => r.kind === 'text') ? 'text' : 'ranking');
  const [selected, setSelected] = useState('');
  const [bookId, setBookId] = useState('');
  const [remove, setRemove] = useState<Reference>();
  const [task, setTask] = useState<TaskKind>(initialTask);
  const [scope, setScope] = useState('full'), [chapterIndex, setChapterIndex] = useState('0');
  const [projectId, setProjectId] = useState(''), [instruction, setInstruction] = useState('');
  const ai = store.state.aiSelection;
  const taskPanel = useRef<HTMLDivElement>(null);
  const refs = store.state.references.filter(r => r.kind === kind);
  const reference = refs.find(r => r.id === selected) ?? refs[0];
  const book = kind === 'ranking' ? reference?.ranking?.books.find(b => b.id === bookId) ?? reference?.ranking?.books[0] : undefined;
  const texts = store.state.references.filter(r => r.kind === 'text' && r.bookUrl === book?.url && !!book);
  const chapterText = kind === 'text' && scope !== 'full' ? reference?.content : undefined;
  const chapters = useMemo(() => chapterText ? importChapters(chapterText) : [], [chapterText]);
  const report = (e: unknown) => store.notify(e instanceof Error ? e.message : String(e));
  const launch = (source = reference, content = reference?.content) => {
    try {
      if (!source || !content?.trim()) throw new Error('暂无可分析的正文');
      store.launch({ kind: task, sourceId: source.id, sourceText: content, sourceTitle: source.title, projectId, instruction: task === 'scan' ? instruction : '' });
    } catch (e) { report(e); }
  };
  const researchBook = useCallback((selectedBook: RankedBook, nextTask: 'analyze' | 'style') => {
    setBookId(selectedBook.id); setTask(nextTask); setChapterIndex('0');
    taskPanel.current?.scrollIntoView({ block: 'start' });
  }, []);
  const relatedIds = new Set([reference?.id, ...texts.map(r => r.id)]);
  if (focusedJob) {
    const source = store.state.references.find(r => r.id === focusedJob.sourceId);
    const collection = focusedJob.collectionTask;
    return <div className="page research-page"><Stack gap="lg"><Group justify="space-between"><Title order={2}>研究任务</Title><Button onClick={() => setFocused(undefined)}>全部资料</Button></Group>
      {collection && <Paper className="surface"><Stack gap="lg"><Select label="研究任务" value={task === 'style' ? 'style' : 'analyze'} onChange={v => setTask(v as TaskKind)} options={[{ value: 'analyze', label: '拆文' }, { value: 'style', label: '提取 Skill' }]} /><AIControls providers={store.state.providers} value={ai} onChange={store.setAISelection} onSettings={onSettings} columns={2} /><BookResearch key={focusedJob.id} initialTask={collection} book={{ url: collection.bookUrl, title: collection.title, author: '' }} rule={collection.rule} store={store} canLaunch={!!ai.model} onLaunch={(reference, content) => { try { store.launch({ kind: task === 'style' ? 'style' : 'analyze', sourceId: reference.id, sourceText: content, sourceTitle: reference.title }); } catch (e) { report(e); } }} /></Stack></Paper>}
      {focusedJob.articleTask ? <ArticleTaskPanel key={focusedJob.id} job={focusedJob} store={store} focused /> : <JobCard key={focusedJob.id} job={focusedJob} store={store} focused />}
      {source?.content && !collection && !focusedJob.articleTask && <Paper className="surface"><ReferencePreview content={source.content} onError={store.notify} /></Paper>}
    </Stack></div>;
  }
  return <div className="page research-page"><Stack gap="lg">
    <Group justify="space-between"><Title order={2}>资料研究</Title><OptionTabs label="研究资料" value={kind} onChange={v => { setKind(v as typeof kind); setSelected(''); setTask(v === 'ranking' ? 'scan' : 'analyze'); setChapterIndex('0'); }} options={[{ value: 'ranking', label: '榜单作品' }, { value: 'search', label: '搜索书籍' }, { value: 'text', label: '参考文本' }]} /></Group>
    {kind === 'ranking' && <RankingScan store={store} onCollected={id => { setSelected(id); setBookId(''); }} />}
    {kind === 'search' ? <BookSearch store={store} onSettings={onSettings} /> : !refs.length ? kind === 'ranking' ? <NoRankings /> : <EmptyState>暂无参考文本</EmptyState> : <>
      <Paper className="surface"><Stack gap="lg">
        <Group align="flex-end" wrap="nowrap"><Box style={{ flex: 1, minWidth: 0 }}><Select label={kind === 'ranking' ? '扫榜记录' : '参考文本'} value={reference.id} onChange={id => { setSelected(id); setBookId(''); setChapterIndex('0'); }} options={refs.map(r => ({ value: r.id, label: `${r.title} · ${new Date(r.createdAt).toLocaleString('zh-CN')}` }))} /></Box><IconButton icon={Trash2} label={`删除${reference.title}`} onClick={() => setRemove(reference)} /></Group>
        {reference.ranking ? <RankingResults ranking={reference.ranking} onResearch={researchBook} /> : <ReferencePreview key={reference.id} content={reference.content} onError={store.notify} />}
      </Stack></Paper>
      <Paper className="surface" ref={taskPanel} style={{ scrollMarginTop: 24 }}><Stack gap="lg">
        <Title order={2}>研究任务</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg"><Select label="任务" value={task} onChange={v => { setTask(v as TaskKind); setChapterIndex('0'); }} options={[...(kind === 'ranking' ? [{ value: 'scan', label: '扫榜选题' }] : []), ...((kind === 'text' || reference.ranking) ? [{ value: 'analyze', label: '拆文' }, { value: 'style', label: '提取 Skill' }] : [])]} />
          <Select label="关联小说" value={projectId} onChange={setProjectId} options={[{ value: '', label: '未关联' }, ...store.state.projects.map(p => ({ value: p.id, label: p.title }))]} />
        </SimpleGrid>
        <AIControls providers={store.state.providers} value={ai} onChange={store.setAISelection} onSettings={onSettings} columns={2} />
        {kind === 'ranking' && task !== 'scan' && book ? <>
          <Select label="榜单作品" value={book.id} onChange={setBookId} options={reference.ranking!.books.map(b => ({ value: b.id, label: `${b.rank}. ${b.title} · ${b.author}` }))} />
          <BookResearch key={book.url} store={store} book={book} onLaunch={launch} canLaunch={!!ai.providerId && !!ai.model} />
        </> : <>
          {task !== 'scan' && <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg"><Select label="分析范围" value={scope} onChange={setScope} options={[{ value: 'full', label: reference.collection ? '全部已采集正文' : '全文' }, { value: 'opening', label: '开篇' }, { value: 'chapter', label: '指定章节' }]} />
            {scope === 'chapter' && <Select label="章节" value={chapterIndex} onChange={setChapterIndex} options={chapters.map((c, i) => ({ value: String(i), label: c.title }))} />}
          </SimpleGrid>}
          {task === 'scan' && <Field label="研究要求（可选）"><Textarea rows={3} value={instruction} placeholder="关注的题材或读者群体" onChange={e => setInstruction(e.target.value)} /></Field>}
          <Group pt="xs"><Button primary icon={Sparkles} disabled={!reference.content.trim() || !ai.providerId || !ai.model} onClick={() => launch(reference, task === 'scan' || scope === 'full' ? reference.content : chapters[scope === 'opening' ? 0 : Number(chapterIndex)]?.content ?? '')}>开始分析</Button></Group>
        </>}
      </Stack></Paper>
      {store.state.jobs.filter(j => relatedIds.has(j.sourceId)).map(j => <JobCard key={j.id} job={j} store={store} />)}
    </>}
  </Stack>
    <ModalPresence>{remove && <Confirm title="删除资料" content={`确认删除「${remove.title}」？`} onClose={() => setRemove(undefined)} onConfirm={() => store.update(s => { s.references = s.references.filter(r => r.id !== remove.id); })} />}</ModalPresence>
  </div>;
}
