import { useRef, useState } from 'react';
import { Group, Stack, Text, Box, SimpleGrid } from '@mantine/core';
import { FileText, FileUp, Globe, Plus, Sparkles, Trash2 } from '../icons';
import { Paper, TextInput, Textarea, Title, Button, Confirm, Empty, EmptyState, Field, IconButton, ModalPresence, Modal, Select, OptionTabs } from '../components';
import { type Reference, type TaskKind, importChapters, now, profileFor, uid } from '../domain';
import { fetchPage, pickFiles } from '../platform';
import { type RankedBook } from '../rankings';
import { type Store } from '../useWorkspace';
import { JobCard } from '../JobCard';
import { RankingScan, RankingResults, NoRankings } from './RankingScan';
import { BookCover } from '../BookCover';

export function Research({ store, initialTask = 'scan' }: { store: Store; initialTask?: 'scan' | 'style' }) {
  const [kind, setKind] = useState<Reference['kind']>(initialTask === 'style' && !store.state.references.some(r => r.ranking) ? 'text' : 'ranking');
  const [selected, setSelected] = useState('');
  const [bookId, setBookId] = useState('');
  const [textId, setTextId] = useState('');
  const [editing, setEditing] = useState<Reference>();
  const [remove, setRemove] = useState<Reference>();
  const [url, setUrl] = useState('');
  const [collect, setCollect] = useState(false), [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false), [linkId, setLinkId] = useState('');
  const [task, setTask] = useState<TaskKind>(initialTask);
  const [scope, setScope] = useState('full'), [chapterIndex, setChapterIndex] = useState('0');
  const [projectId, setProjectId] = useState(''), [profileId, setProfileId] = useState(''), [instruction, setInstruction] = useState('');
  const taskPanel = useRef<HTMLDivElement>(null);
  const refs = store.state.references.filter(r => r.kind === kind);
  const reference = refs.find(r => r.id === selected) ?? refs[0];
  const book = kind === 'ranking' ? reference?.ranking?.books.find(b => b.id === bookId) ?? reference?.ranking?.books[0] : undefined;
  const texts = store.state.references.filter(r => r.kind === 'text' && r.bookUrl === book?.url && !!book);
  const source = kind === 'text' || task === 'scan' ? reference : texts.find(r => r.id === textId) ?? texts[0];
  const chapters = source && task !== 'scan' ? importChapters(source.content) : [];
  const report = (e: unknown) => store.notify(e instanceof Error ? e.message : String(e));
  const chooseText = (id: string) => { if (kind === 'text') setSelected(id); else setTextId(id); setChapterIndex('0'); };
  const save = () => {
    if (!editing?.title.trim() || !editing.content.trim()) return;
    store.update(s => { const i = s.references.findIndex(r => r.id === editing.id); if (i < 0) s.references.unshift(editing); else s.references[i] = editing; });
    chooseText(editing.id); setEditing(undefined);
  };
  const newText = (title = '', content = '', sourceName = ''): Reference => ({ id: uid(), title, source: sourceName, kind: 'text', content, bookUrl: book?.url, createdAt: now() });
  const add = () => setEditing(newText(book?.title ?? ''));
  const importData = async () => {
    try {
      const files = await pickFiles();
      const imported = files.map(f => {
        if (f.bytes.length > 20 * 1024 * 1024) throw new Error('文件超过 20 MB');
        const content = new TextDecoder().decode(f.bytes);
        if (!content.trim()) throw new Error('文件内容为空');
        return newText(f.name.replace(/\.[^.]+$/, ''), content, f.name);
      });
      store.update(s => s.references.unshift(...imported));
      if (imported[0]) chooseText(imported[0].id);
    } catch (e) { report(e); }
  };
  const collectPage = async () => {
    setBusy(true);
    try {
      const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('网址无效');
      const page = await fetchPage(url);
      if (!page.text.trim()) throw new Error('页面没有可读取的正文，请导入文本');
      // Review collected text before it becomes an analysis source.
      setEditing(newText(page.title || book?.title || parsed.hostname, page.text, url)); setCollect(false);
    } catch (e) { report(e); } finally { setBusy(false); }
  };
  const launch = () => {
    try {
      if (!source) throw new Error('请先添加作品正文');
      const content = task !== 'scan' && scope === 'opening' ? chapters[0]?.content : task !== 'scan' && scope === 'chapter' ? chapters[Number(chapterIndex)]?.content : source.content;
      if (!content?.trim()) throw new Error('请选择有效的文本范围');
      store.launch({ kind: task, sourceId: source.id, sourceText: content, projectId, profileId: profileId || profileFor(store.state, task)?.id, instruction });
    } catch (e) { report(e); }
  };
  const researchBook = (selectedBook: RankedBook, nextTask: 'analyze' | 'style') => {
    setBookId(selectedBook.id); setTask(nextTask); setTextId(''); setChapterIndex('0');
    taskPanel.current?.scrollIntoView({ block: 'start' });
  };
  const textActions = <Group gap="sm" wrap="wrap"><Button icon={Globe} onClick={() => { setUrl(''); setCollect(true); }}>采集正文网页</Button><Button icon={FileUp} onClick={() => void importData()}>导入正文</Button><Button icon={Plus} onClick={add}>添加正文</Button>{book && <Button onClick={() => { setLinkId(''); setLinking(true); }}>关联已有文本</Button>}</Group>;
  const relatedIds = new Set([reference?.id, ...texts.map(r => r.id)]);
  return <div className="page research-page"><Stack gap="lg">
    <Group justify="space-between"><Title order={2}>扫榜与研究</Title><OptionTabs label="研究资料" value={kind} onChange={v => { setKind(v as typeof kind); setSelected(''); setTask(v === 'ranking' ? 'scan' : 'analyze'); setChapterIndex('0'); }} options={[{ value: 'ranking', label: '榜单作品' }, { value: 'text', label: '参考文本' }]} /></Group>
    {kind === 'ranking' ? <RankingScan store={store} onCollected={id => { setSelected(id); setBookId(''); }} /> : textActions}
    {!refs.length ? kind === 'ranking' ? <NoRankings /> : <Empty icon={FileText} title="暂无参考文本" action="添加正文" onAction={add} /> : <>
      <Paper className="surface"><Stack gap="lg">
        <Group align="flex-end" wrap="nowrap"><Box style={{ flex: 1, minWidth: 0 }}><Select label={kind === 'ranking' ? '扫榜记录' : '参考文本'} value={reference.id} onChange={id => { setSelected(id); setBookId(''); setTextId(''); setChapterIndex('0'); }} options={refs.map(r => ({ value: r.id, label: `${r.title} · ${new Date(r.createdAt).toLocaleString('zh-CN')}` }))} /></Box><IconButton icon={Trash2} label={`删除${reference.title}`} onClick={() => setRemove(reference)} />{kind === 'text' && <Button onClick={() => setEditing({ ...reference })}>编辑</Button>}</Group>
        {reference.ranking ? <RankingResults ranking={reference.ranking} onResearch={researchBook} /> : <pre className="prose reference-preview">{reference.content}</pre>}
      </Stack></Paper>
      <Paper className="surface" ref={taskPanel} style={{ scrollMarginTop: 24 }}><Stack gap="lg">
        <Title order={2}>研究任务</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg"><Select label="任务" value={task} onChange={v => { setTask(v as TaskKind); setChapterIndex('0'); }} options={[...(kind === 'ranking' ? [{ value: 'scan', label: '扫榜选题' }] : []), ...((kind === 'text' || reference.ranking) ? [{ value: 'analyze', label: '拆文' }, { value: 'style', label: '提取风格' }] : [])]} />
          <Select label="模型预设" value={profileId} onChange={setProfileId} options={[{ value: '', label: '使用任务默认预设' }, ...store.state.profiles.map(p => ({ value: p.id, label: p.name }))]} />
        </SimpleGrid>
        {kind === 'ranking' && task !== 'scan' && book && <Stack gap="md">
          <Select label="榜单作品" value={book.id} onChange={id => { setBookId(id); setTextId(''); setChapterIndex('0'); }} options={reference.ranking!.books.map(b => ({ value: b.id, label: `${b.rank}. ${b.title} · ${b.author}` }))} />
          <Group wrap="nowrap"><BookCover book={book} /><Stack gap={4}><Text fw={600}>{book.title}</Text><Text size="sm" c="dimmed">{book.author} · {book.genre}</Text></Stack></Group>
          {textActions}
          {texts.length ? <><Select label="作品正文" value={source?.id ?? ''} onChange={chooseText} options={texts.map(t => ({ value: t.id, label: t.title }))} /><Group justify="space-between"><Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere', flex: 1 }}>{source?.source}</Text><Button onClick={() => source && setEditing({ ...source })}>编辑正文</Button></Group><pre className="prose reference-preview">{source?.content}</pre></> : <EmptyState>暂无作品正文</EmptyState>}
        </Stack>}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg"><Select label="关联小说" value={projectId} onChange={setProjectId} options={[{ value: '', label: '未关联' }, ...store.state.projects.map(p => ({ value: p.id, label: p.title }))]} />
          {task !== 'scan' && <Select label="分析范围" value={scope} onChange={setScope} options={[{ value: 'full', label: '全文' }, { value: 'opening', label: '开篇' }, { value: 'chapter', label: '指定章节' }]} />}
          {task !== 'scan' && scope === 'chapter' && <Select label="章节" value={chapterIndex} onChange={setChapterIndex} options={chapters.map((c, i) => ({ value: String(i), label: c.title }))} />}
        </SimpleGrid>
        <Field label="研究要求"><Textarea rows={3} value={instruction} placeholder="关注的题材、结构或表达方式" onChange={e => setInstruction(e.target.value)} /></Field>
        <Group pt="xs"><Button primary icon={Sparkles} disabled={!source?.content.trim()} onClick={launch}>开始分析</Button></Group>
      </Stack></Paper>
      {store.state.jobs.filter(j => relatedIds.has(j.sourceId)).map(j => <JobCard key={j.id} job={j} store={store} />)}
    </>}
  </Stack>
    <ModalPresence>{editing && <Modal title="参考正文" wide onClose={() => setEditing(undefined)} footer={<><Button onClick={() => setEditing(undefined)}>取消</Button><Button primary disabled={!editing.title.trim() || !editing.content.trim()} onClick={save}>保存</Button></>}><Stack gap="lg"><Field label="名称"><TextInput data-autofocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></Field><Field label="来源"><TextInput value={editing.source} onChange={e => setEditing({ ...editing, source: e.target.value })} placeholder="网址或资料出处" /></Field><Field label="正文"><Textarea rows={16} value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} placeholder="参考小说正文" /></Field></Stack></Modal>}</ModalPresence>
    <ModalPresence>{collect && <Modal title="采集正文网页" onClose={() => { if (!busy) setCollect(false); }} footer={<><Button disabled={busy} onClick={() => setCollect(false)}>取消</Button><Button primary disabled={busy || !url.trim()} onClick={() => void collectPage()}>{busy ? '采集中…' : '采集'}</Button></>}><Field label="章节网页地址"><TextInput data-autofocus type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></Field></Modal>}</ModalPresence>
    <ModalPresence>{linking && <Modal title="关联已有文本" onClose={() => setLinking(false)} footer={<><Button onClick={() => setLinking(false)}>取消</Button><Button primary disabled={!linkId || !book} onClick={() => { const item = store.state.references.find(r => r.id === linkId && r.kind === 'text'); if (item && book) { const linked = { ...item, id: uid(), bookUrl: book.url, createdAt: now() }; store.update(s => s.references.unshift(linked)); chooseText(linked.id); } setLinking(false); }}>关联</Button></>}><Select label="参考文本" value={linkId} onChange={setLinkId} options={store.state.references.filter(r => r.kind === 'text' && !r.bookUrl).map(r => ({ value: r.id, label: r.title }))} /></Modal>}</ModalPresence>
    <ModalPresence>{remove && <Confirm title="删除资料" content={`确认删除「${remove.title}」？`} onClose={() => setRemove(undefined)} onConfirm={() => store.update(s => { s.references = s.references.filter(r => r.id !== remove.id); })} />}</ModalPresence>
  </div>;
}
