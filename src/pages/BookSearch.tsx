import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button as MantineButton, Group, Stack, Table, Text, SimpleGrid } from '@mantine/core';
import { Button, EmptyState, IconButton, Paper, Select, TextInput, Title } from '../components';
import { type ArticleRule, type SearchBook } from '../articleRules';
import { mergeSearchBooks, recordBookSearch, searchSources, type SourceSearch } from '../bookSearch';
import { X } from '../icons';
import { searchArticleBooks } from '../platform';
import { type Store } from '../useWorkspace';
import { AIControls } from '../AIControls';
import { BookResearch } from './BookResearch';
import { JobCard } from '../JobCard';

export function BookSearch({ store, onSettings }: { store: Store; onSettings: () => void }) {
  const [query, setQuery] = useState(''), [searched, setSearched] = useState('');
  const [sources, setSources] = useState<SourceSearch[]>([]);
  const [selection, setSelection] = useState<{ book: SearchBook; rule: ArticleRule }>();
  const [task, setTask] = useState<'analyze' | 'style'>('analyze'), [projectId, setProjectId] = useState('');
  const ai = store.state.aiSelection;
  const controller = useRef<AbortController | null>(null);
  const taskPanel = useRef<HTMLDivElement>(null);
  const busy = sources.some(s => s.busy);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  useEffect(() => { if (selection) taskPanel.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, [selection]);
  const stop = () => {
    controller.current?.abort(); controller.current = null;
    setSources(current => current.map(s => s.busy ? { ...s, busy: false, error: '搜索已停止' } : s));
  };
  const run = async (value = query) => {
    const keyword = value.trim();
    if (!keyword || keyword.length > 100 || !store.state.articleRules.length) return;
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    const rules = structuredClone(store.state.articleRules);
    setQuery(keyword); setSearched(keyword); setSelection(undefined);
    store.update(state => { state.bookSearchHistory = recordBookSearch(state.bookSearchHistory, keyword); });
    setSources(rules.map(rule => ({ rule, books: [], page: 0, hasMore: false, busy: true, error: '' })));
    await searchSources(rules, keyword, active.signal, searchArticleBooks, result => {
      if (controller.current === active) setSources(current => current.map(s => s.rule.id === result.rule.id ? result : s));
    });
    if (controller.current === active) controller.current = null;
  };
  const more = async (source: SourceSearch) => {
    if (busy) return;
    const active = new AbortController(); controller.current = active;
    setSources(current => current.map(s => s.rule.id === source.rule.id ? { ...s, busy: true, error: '' } : s));
    try {
      const result = await searchArticleBooks(source.rule, searched, source.page + 1, active.signal);
      if (controller.current === active) setSources(current => current.map(s => s.rule.id === source.rule.id ? { ...s, books: mergeSearchBooks(s.books, result.books), page: source.page + 1, hasMore: result.hasMore && source.page + 1 < 100, busy: false, error: '' } : s));
    } catch (error) {
      if (controller.current === active) setSources(current => current.map(s => s.rule.id === source.rule.id ? { ...s, busy: false, error: error instanceof Error ? error.message : String(error) } : s));
    } finally { if (controller.current === active) controller.current = null; }
  };
  const sourceIds = new Set(selection ? store.state.references.filter(r => r.bookUrl === selection.book.url).map(r => r.id) : []);
  return <Stack gap="lg">
    <Paper className="surface"><Stack gap="lg">
      <Box component="form" onSubmit={event => { event.preventDefault(); void run(); }}>
        <Group align="flex-end"><TextInput label="书名或作者" placeholder="搜索书籍" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <Button primary type="submit" disabled={!query.trim() || !store.state.articleRules.length}>搜索全部采集站</Button>{busy && <Button onClick={stop}>停止搜索</Button>}
        </Group>
      </Box>
      {!!store.state.bookSearchHistory.length && <Stack gap="sm">
        <Group justify="space-between"><Title order={3}>搜索记录</Title><Button aria-label="清空搜索记录" onClick={() => store.update(state => { state.bookSearchHistory = []; })}>清空</Button></Group>
        <Group gap="xs" component="ul" aria-label="搜索记录" m={0} p={0} style={{ listStyle: 'none' }}>
          {store.state.bookSearchHistory.map(keyword => <Group component="li" key={keyword} gap={0} wrap="nowrap" maw="100%" bg="gray.0" style={{ borderRadius: 'var(--mantine-radius-xl)' }}>
            <MantineButton variant="subtle" color="gray" aria-label={`搜索：${keyword}`} title={keyword} disabled={!store.state.articleRules.length} onClick={() => void run(keyword)} maw="calc(100% - 34px)" styles={{ root: { minWidth: 0, flexShrink: 1 }, label: { minWidth: 0 } }}><Text component="span" size="sm" truncate>{keyword}</Text></MantineButton>
            <IconButton icon={X} label={`删除搜索记录：${keyword}`} onClick={() => store.update(state => { state.bookSearchHistory = state.bookSearchHistory.filter(item => item !== keyword); })} />
          </Group>)}
        </Group>
      </Stack>}
      {!store.state.articleRules.length ? <EmptyState><Stack align="center"><Text>暂无采集规则</Text><Button onClick={onSettings}>设置</Button></Stack></EmptyState> : !searched && <EmptyState>暂无搜索结果</EmptyState>}
    </Stack></Paper>
    {sources.map(source => <Paper className="surface" key={source.rule.id}><Stack gap="md">
      <Group justify="space-between"><Title order={3}>{source.rule.name}</Title><Text size="sm" c="dimmed" role="status">{source.busy ? '搜索中…' : `${source.books.length} 本`}</Text></Group>
      {source.error && <Alert color="red" role="alert"><Group justify="space-between"><Text size="sm">{source.error}</Text>{source.rule.search ? <Button disabled={busy} onClick={() => void more(source)}>重试</Button> : <Button onClick={onSettings}>设置</Button>}</Group></Alert>}
      {source.books.length ? <Table.ScrollContainer minWidth={580}><Table verticalSpacing="md"><Table.Thead><Table.Tr><Table.Th>书籍</Table.Th><Table.Th w={120} miw={100}>作者</Table.Th><Table.Th w={100}>操作</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{source.books.map(book => <Table.Tr key={book.url} bg={selection?.rule.id === source.rule.id && selection.book.url === book.url ? 'orange.0' : undefined}>
        <Table.Td><Text fw={500} size="sm">{book.title}</Text>{book.intro && <Text size="sm" c="dimmed" lineClamp={2} maw={580}>{book.intro}</Text>}</Table.Td><Table.Td miw={100}><Text size="sm">{book.author || '—'}</Text></Table.Td><Table.Td><Button aria-label={`选择${book.title}（${source.rule.name}）`} onClick={() => setSelection({ book, rule: source.rule })}>选择</Button></Table.Td>
      </Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : !source.busy && !source.error && <EmptyState>暂无匹配书籍</EmptyState>}
      {source.hasMore && !source.error && <Group justify="center"><Button disabled={busy} onClick={() => void more(source)}>加载更多 · {source.rule.name}</Button></Group>}
    </Stack></Paper>)}
    {selection && <Paper className="surface" ref={taskPanel} style={{ scrollMarginTop: 24 }}><Stack gap="lg">
      <Group justify="space-between"><Title order={2}>研究任务</Title><Button onClick={() => setSelection(undefined)}>取消选择</Button></Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }}><Select label="任务" value={task} onChange={value => setTask(value as typeof task)} options={[{ value: 'analyze', label: '拆文' }, { value: 'style', label: '提取 Skill' }]} /><Select label="关联小说" value={projectId} onChange={setProjectId} options={[{ value: '', label: '未关联' }, ...store.state.projects.map(p => ({ value: p.id, label: p.title }))]} /></SimpleGrid>
      <AIControls providers={store.state.providers} value={ai} onChange={store.setAISelection} onSettings={onSettings} columns={2} />
      <BookResearch key={`${selection.rule.id}:${selection.book.url}`} book={selection.book} rule={selection.rule} store={store} canLaunch={!!ai.providerId && !!ai.model} onLaunch={(source, content) => {
        try { store.launch({ kind: task, sourceId: source.id, sourceText: content, sourceTitle: source.title, projectId }); }
        catch (error) { store.notify(error instanceof Error ? error.message : String(error)); }
      }} />
    </Stack></Paper>}
    {store.state.jobs.filter(job => sourceIds.has(job.sourceId)).map(job => <JobCard key={job.id} job={job} store={store} />)}
  </Stack>;
}
