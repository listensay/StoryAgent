import { memo, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button as MantineButton, Group, Loader, Paper, Select as MantineSelect, SimpleGrid, Stack, Text, Title, Accordion, ScrollArea } from '@mantine/core';
import { Button, Empty, Select } from '../components';
import { ChevronDown, TrendingUp } from '../icons';
import { now, uid, type Reference } from '../domain';
import { collectRanking, rankingCategories } from '../platform';
import { qidianBoards, rankingContent, rankingTitle, type RankedBook, type Ranking, type RankingOptions } from '../rankings';
import { BookCover } from '../BookCover';
import type { Store } from '../useWorkspace';

export function RankingScan({ store, onCollected }: { store: Store; onCollected: (id: string) => void }) {
  const [platform, setPlatform] = useState<RankingOptions['platform']>('qidian');
  const [board, setBoard] = useState('hotsales');
  const [channel, setChannel] = useState('1');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [limit, setLimit] = useState('20');
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => {
    if (platform !== 'fanqie') return;
    let active = true;
    setLoadingCategories(true); setCategoryError(''); setCategories([]); setCategory('');
    void rankingCategories(channel, board).then(items => {
      if (active) { setCategories(items); setCategory(items[0]?.id ?? ''); }
    }).catch(e => { if (active) setCategoryError(String(e)); }).finally(() => { if (active) setLoadingCategories(false); });
    return () => { active = false; };
  }, [platform, board, channel, reload]);
  const scan = async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const ranking = await collectRanking({ platform, board, channel, category, limit: Number(limit) }, controller.signal);
      if (controller.signal.aborted) return;
      const reference: Reference = { id: uid(), kind: 'ranking', title: rankingTitle(ranking), source: ranking.sourceUrl, content: rankingContent(ranking), ranking, createdAt: now() };
      store.update(s => s.references.unshift(reference));
      onCollected(reference.id);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  const stop = () => { request.current?.abort(); request.current = null; setBusy(false); };
  return <Paper className="surface"><Stack gap="md">
    <Title order={2}>自动扫榜</Title>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: platform === 'fanqie' ? 5 : 3 }} spacing="md">
        <Select label="平台" value={platform} onChange={value => { setPlatform(value as typeof platform); setBoard(value === 'qidian' ? 'hotsales' : '2'); setCategory(''); setError(''); }} options={[{ value: 'qidian', label: '起点中文网' }, { value: 'fanqie', label: '番茄小说' }]} />
        {platform === 'fanqie' && <Select label="频道" value={channel} onChange={value => { setChannel(value); setCategory(''); }} options={[{ value: '1', label: '男频' }, { value: '0', label: '女频' }]} />}
        <Select label="榜单" value={board} onChange={value => { setBoard(value); setCategory(''); }} options={platform === 'qidian' ? qidianBoards : [{ value: '2', label: '阅读榜' }, { value: '1', label: '新书榜' }]} />
        {platform === 'fanqie' && <MantineSelect label="分类" value={category || null} onChange={value => setCategory(value ?? '')} data={categories.map(item => ({ value: item.id, label: item.name }))} disabled={loadingCategories || !categories.length} searchable allowDeselect={false} nothingFoundMessage="暂无分类" placeholder={loadingCategories ? '正在获取分类' : '选择分类'} rightSection={loadingCategories ? <Loader size={16} /> : <ChevronDown size={18} />} />}
        <Select label="采集数量" value={limit} onChange={setLimit} options={[{ value: '10', label: '前 10 名' }, { value: '20', label: '前 20 名' }]} />
      </SimpleGrid>
    </fieldset>
    {platform === 'fanqie' && categoryError && <Alert color="red"><Group justify="space-between"><Text size="sm">{categoryError}</Text><Button onClick={() => setReload(v => v + 1)}>重新获取分类</Button></Group></Alert>}
    {error && <Alert color="red" role="alert">{error}</Alert>}
    <Group><MantineButton leftSection={<TrendingUp size={18} />} loading={busy} disabled={platform === 'fanqie' && (!category || loadingCategories)} onClick={() => void scan()}>{busy ? '正在扫榜' : '开始扫榜'}</MantineButton>{busy && <Button onClick={stop}>停止</Button>}</Group>
  </Stack></Paper>;
}

export const RankingResults = memo(function RankingResults({ ranking, onResearch }: { ranking: Ranking; onResearch: (book: RankedBook, task: 'analyze' | 'style') => void }) {
  return <Stack gap="md">
    <Group gap="sm"><Badge variant="light">{ranking.books.length} 部作品</Badge><Text size="sm" c="dimmed">{new Date(ranking.collectedAt).toLocaleString('zh-CN')}</Text></Group>
    {ranking.skipped > 0 && <Alert color="yellow">{ranking.skipped} 部作品未获取成功，可重新扫榜。</Alert>}
    <ScrollArea.Autosize mah={560} type="auto" offsetScrollbars><Accordion variant="separated" radius="md" chevron={<ChevronDown size={18} />}>
      {ranking.books.map(book => <Accordion.Item value={book.id} key={book.id}>
        <Accordion.Control><Group wrap="nowrap" align="flex-start" gap="md"><Text fw={600} c="story.8" w={26} style={{ flexShrink: 0 }}>{book.rank}</Text><BookCover book={book} /><Stack gap={4} style={{ minWidth: 0 }}><Text fw={600}>{book.title}</Text><Text size="sm" c="dimmed">{[book.author, book.words && (/字$/.test(book.words) ? book.words : `${book.words} 字`), book.status, ...book.metrics.map(m => `${m.label} ${m.value}`)].filter(Boolean).join(' · ')}</Text></Stack></Group></Accordion.Control>
        <Accordion.Panel><Stack gap="sm"><Text size="sm" c="dimmed">{book.genre}</Text><Text style={{ whiteSpace: 'pre-wrap' }}>{book.intro || '暂无简介'}</Text><Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{book.url}</Text><Group><Button primary onClick={() => onResearch(book, 'analyze')}>拆文</Button><Button onClick={() => onResearch(book, 'style')}>提取 Skill</Button></Group></Stack></Accordion.Panel>
      </Accordion.Item>)}
    </Accordion></ScrollArea.Autosize>
  </Stack>;
});
export function NoRankings() { return <Empty icon={TrendingUp} title="暂无扫榜记录" />; }
