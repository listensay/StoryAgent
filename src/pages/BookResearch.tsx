import { useEffect, useMemo, useState } from 'react';
import { Alert, Group, Progress, Stack, Text } from '@mantine/core';
import { Button, EmptyState, Select } from '../components';
import { BookCover } from '../BookCover';
import { type Job, type Reference } from '../domain';
import { researchChapters, researchSelection, type ResearchScope } from '../researchSources';
import { type RankedBook } from '../rankings';
import { type ArticleRule } from '../articleRules';
import { type Store } from '../useWorkspace';
import { Sparkles } from '../icons';

export function BookResearch({ store, book, rule, onLaunch, canLaunch, initialTask }: { store: Store; book: Pick<RankedBook, 'url' | 'title' | 'author'> & Partial<RankedBook>; rule?: ArticleRule; canLaunch: boolean; onLaunch: (source: Reference, content: string) => void; initialTask?: Job['collectionTask'] }) {
  const [scope, setScope] = useState<ResearchScope>(initialTask?.scope ?? 'opening');
  const [chapterId, setChapterId] = useState(initialTask?.chapterId ?? '');
  const source = store.state.references.find(r => r.bookUrl === book.url && r.collection);
  const catalog = source?.collection?.catalog;
  const selectedId = chapterId || catalog?.chapters.find(c => c.readable)?.id || '';
  const collected = useMemo(() => source?.collection ? { content: source.content, collection: source.collection } : undefined, [source?.content, source?.collection]);
  const content = catalog ? researchSelection(catalog, collected, scope, selectedId) : '';
  const selected = catalog ? researchChapters(catalog, scope, selectedId) : [];
  const task = store.state.jobs.find(j => j.collectionTask?.bookUrl === book.url && j.collectionTask.scope === scope && (scope !== 'chapter' || j.collectionTask.chapterId === selectedId) && (j.status !== 'accepted' || !!content));
  const busy = !!task && ['queued', 'running'].includes(task.status);
  const { collect } = store;
  useEffect(() => {
    if (!content && !task && (scope !== 'chapter' || selectedId)) collect({ bookUrl: book.url, title: book.title, scope, chapterId: scope === 'chapter' ? selectedId : '', rule });
  }, [book.url, book.title, scope, selectedId, rule, content, task, collect]);
  const progress = task?.collectionTask;
  return <Stack gap="lg">
    <Group wrap="nowrap">{!rule && <BookCover book={book} />}<Stack gap={4}><Text fw={600}>{book.title}</Text><Text size="sm" c="dimmed">{[book.author, rule?.name ?? book.genre].filter(Boolean).join(' · ')}</Text></Stack></Group>
    <Select label="分析范围" value={scope} onChange={v => setScope(v as ResearchScope)} options={[{ value: 'opening', label: '开篇' }, { value: 'chapter', label: '指定章节' }, { value: 'available', label: '全部可获取章节' }]} />
    {scope === 'chapter' && catalog && <Select label="章节" value={selectedId} onChange={setChapterId} options={catalog.chapters.filter(c => c.readable).map(c => ({ value: c.id, label: c.title }))} />}
    {busy && <Stack gap="xs"><Group justify="space-between"><Text role="status" size="sm">{task.status === 'queued' ? '等待采集' : `正在采集 ${progress?.done ?? 0} / ${progress?.total || '—'} 章`}</Text><Button onClick={() => store.stop(task.id)}>停止采集</Button></Group><Progress aria-label="正文采集进度" value={progress?.total ? progress.done / progress.total * 100 : 0} animated /></Stack>}
    {task && ['failed', 'paused'].includes(task.status) && <Alert color="red" role="alert"><Group justify="space-between"><Text size="sm">{task.error || '采集已停止'}</Text><Button onClick={() => store.resumeJob(task.id)}>继续采集</Button></Group></Alert>}
    {content ? <><Text size="sm" c="dimmed">已获取 {selected.length} 章</Text><pre className="prose reference-preview">{content.slice(0, 12000)}{content.length > 12000 ? '\n…' : ''}</pre></> : !busy && <EmptyState>暂无正文</EmptyState>}
    <Group><Button primary icon={Sparkles} disabled={!content || !source || !canLaunch} onClick={() => source && onLaunch({ ...source, title: `${source.title} · ${selected.length} 章` }, content)}>开始分析</Button></Group>
  </Stack>;
}
