import { useState } from 'react';
import { Alert, Box, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { Button, Confirm, EmptyState, Field, IconButton, Modal, ModalPresence, NumberInput, OptionTabs, Paper, Select, Switch, TextInput, Title, type ModalVisibilityProps } from '../components';
import { Globe, Plus, Trash2 } from '../icons';
import { articleRange, defaultArticleRule, type ArticleRule, type BookSearchRule } from '../articleRules';
import { uid, type Job } from '../domain';
import { JobCard } from '../JobCard';
import { ReferencePreview } from '../ReferencePreview';
import { validateArticleRule } from '../platform';
import { type Store } from '../useWorkspace';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const selectorFields = [
  ['catalogTitleSelector', '书名选择器'], ['chapterLinkSelector', '目录链接选择器'],
  ['chapterTitleSelector', '章节标题选择器'], ['contentSelector', '正文选择器'], ['excludeSelector', '排除元素选择器'],
  ['catalogLinkSelector', '完整目录链接选择器（可选）'],
] as const;
const searchFields = [
  ['url', '搜索地址', '/search?q={query}&page={page}'], ['body', '搜索表单（可选）', 'searchkey={query}&page={page}'],
  ['resultSelector', '书籍条目选择器', '.book'], ['titleSelector', '搜索书名选择器', 'h3'],
  ['linkSelector', '书籍链接选择器', 'h3 a'], ['authorSelector', '作者选择器（可选）', '.author'],
  ['introSelector', '简介选择器（可选）', '.intro'], ['nextSelector', '下一页选择器（可选）', 'a.next'],
  ['emptySelector', '无结果容器选择器（可选）', '.results'],
] as const;
const emptySearch: BookSearchRule = { url: '', method: 'GET', body: '', encoding: 'utf-8', resultSelector: '', titleSelector: '', linkSelector: '', authorSelector: '', introSelector: '', nextSelector: '', emptySelector: '' };

export function ArticleCollection({ store }: { store: Store }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ArticleRule>();
  const [remove, setRemove] = useState<ArticleRule>();
  const [collecting, setCollecting] = useState<ArticleRule>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rules = store.state.articleRules.filter(rule => `${rule.name} ${rule.siteUrl}`.toLowerCase().includes(search.trim().toLowerCase()));
  const edit = (rule?: ArticleRule) => {
    setError(''); setEditing(rule ? structuredClone(rule) : { ...defaultArticleRule, id: uid(), name: '', siteUrl: '', catalogTitleSelector: 'h1', chapterLinkSelector: '', chapterTitleSelector: 'h1', contentSelector: '', excludeSelector: '', catalogLinkSelector: '', search: undefined });
  };
  const save = async () => {
    if (!editing || saving) return;
    setSaving(true); setError('');
    try {
      const rule = { ...Object.fromEntries(Object.entries(editing).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])), search: editing.search ? Object.fromEntries(Object.entries(editing.search).map(([key, value]) => [key, value.trim()])) : undefined } as ArticleRule;
      await validateArticleRule(rule);
      store.update(s => { const index = s.articleRules.findIndex(r => r.id === rule.id); if (index < 0) s.articleRules.push(rule); else s.articleRules[index] = rule; });
      setEditing(undefined);
    } catch (error) { setError(message(error)); } finally { setSaving(false); }
  };
  return <>
    <Paper component="section" className="surface"><Stack gap="lg">
      <Group justify="space-between"><Title order={2}>文章采集</Title><Button icon={Plus} onClick={() => edit()}>添加规则</Button></Group>
      <TextInput aria-label="搜索采集规则" placeholder="搜索名称或网站" value={search} onChange={event => setSearch(event.target.value)} />
      {rules.length ? <Table.ScrollContainer minWidth={600}><Table verticalSpacing="md" horizontalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>名称</Table.Th><Table.Th>网站</Table.Th><Table.Th>操作</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rules.map(rule => <Table.Tr key={rule.id}>
        <Table.Td><Text fw={500} size="sm">{rule.name}</Text></Table.Td><Table.Td><Text size="sm" style={{ overflowWrap: 'anywhere' }}>{rule.siteUrl}</Text></Table.Td>
        <Table.Td><Group gap="sm" wrap="nowrap"><Button icon={Globe} onClick={() => setCollecting({ ...rule })}>采集</Button><Button onClick={() => edit(rule)}>编辑</Button><IconButton icon={Trash2} label={`删除${rule.name}采集规则`} onClick={() => setRemove(rule)} /></Group></Table.Td>
      </Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : <EmptyState>{search ? '暂无匹配规则' : '暂无采集规则'}</EmptyState>}
    </Stack></Paper>
    <ModalPresence>{editing && <Modal title="采集规则" wide onClose={() => { if (!saving) setEditing(undefined); }} footer={<><Button disabled={saving} onClick={() => setEditing(undefined)}>取消</Button><Button primary disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button></>}>
      <Stack gap="lg">{error && <Alert color="red" role="alert">{error}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg"><Field label="名称"><TextInput data-autofocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field><Field label="网站地址"><TextInput type="url" placeholder="https://www.69shuba.com/" value={editing.siteUrl} onChange={e => setEditing({ ...editing, siteUrl: e.target.value })} /></Field></SimpleGrid>
        <Select label="页面编码" value={editing.encoding} onChange={encoding => setEditing({ ...editing, encoding: encoding as ArticleRule['encoding'] })} options={[{ value: 'auto', label: '自动' }, { value: 'utf-8', label: 'UTF-8' }, { value: 'gbk', label: 'GBK' }]} />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">{selectorFields.map(([key, label]) => <Field label={label} key={key}><TextInput value={editing[key]} placeholder={key === 'excludeSelector' ? '可选，如 .ad, nav' : 'CSS 选择器'} onChange={e => setEditing({ ...editing, [key]: e.target.value })} /></Field>)}</SimpleGrid>
        <Switch label="书籍搜索" checked={!!editing.search} onChange={event => setEditing({ ...editing, search: event.currentTarget.checked ? { ...emptySearch } : undefined })} />
        {editing.search && <Stack gap="lg">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg"><Select label="搜索请求方式" value={editing.search.method} onChange={value => setEditing({ ...editing, search: { ...editing.search!, method: value as BookSearchRule['method'] } })} options={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]} /><Select label="搜索关键词编码" value={editing.search.encoding} onChange={value => setEditing({ ...editing, search: { ...editing.search!, encoding: value as BookSearchRule['encoding'] } })} options={[{ value: 'utf-8', label: 'UTF-8' }, { value: 'gbk', label: 'GBK' }]} /></SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">{searchFields.map(([key, label, placeholder]) => <Field label={label} key={key}><TextInput value={editing.search![key]} placeholder={placeholder} onChange={event => setEditing({ ...editing, search: { ...editing.search!, [key]: event.target.value } })} /></Field>)}</SimpleGrid>
        </Stack>}
      </Stack>
    </Modal>}</ModalPresence>
    <ModalPresence>{remove && <Confirm title="删除采集规则" content={`确认删除「${remove.name}」？`} onClose={() => setRemove(undefined)} onConfirm={() => store.update(s => { s.articleRules = s.articleRules.filter(r => r.id !== remove.id); })} />}</ModalPresence>
    <ModalPresence>{collecting && <CollectArticles rule={collecting} store={store} onClose={() => setCollecting(undefined)} />}</ModalPresence>
  </>;
}

function CollectArticles({ rule, store, onClose, ...visibility }: { rule: ArticleRule; store: Store; onClose: () => void } & ModalVisibilityProps) {
  const [mode, setMode] = useState<'catalog' | 'chapter'>('catalog');
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState('');
  const job = store.state.jobs.find(j => j.id === jobId);
  const run = () => {
    try {
      const address = new URL(url.trim());
      if (!['http:', 'https:'].includes(address.protocol)) throw new Error('请输入有效的网址');
      setJobId(store.collectArticles({ rule, url: address.href, mode, links: [] }));
    } catch (error) { store.notify(message(error)); }
  };
  return <Modal title={`文章采集 · ${rule.name}`} wide onClose={onClose} {...visibility} footer={<Button onClick={onClose}>关闭</Button>}><Stack gap="lg">
    <OptionTabs label="采集类型" value={mode} onChange={v => setMode(v as typeof mode)} options={[{ value: 'catalog', label: '目录采集' }, { value: 'chapter', label: '单章采集' }]} />
    <Group align="flex-end" wrap="nowrap"><Box style={{ flex: 1, minWidth: 0 }}><Field label={mode === 'catalog' ? '目录网址' : '章节网址'}><TextInput type="url" data-autofocus value={url} placeholder={`${rule.siteUrl}book/…/`} onChange={e => setUrl(e.target.value)} /></Field></Box><Button disabled={!url.trim()} onClick={run}>{mode === 'catalog' ? '读取目录' : '采集正文'}</Button></Group>
    {job && <ArticleTaskPanel job={job} store={store} />}
  </Stack></Modal>;
}

export function ArticleTaskPanel({ job, store, focused = false }: { job: Job; store: Store; focused?: boolean }) {
  const task = job.articleTask!;
  const [start, setStart] = useState<number | string>(1), [end, setEnd] = useState<number | string>(10);
  const page = task.page;
  const source = store.state.references.find(r => r.id === task.referenceId);
  return <Stack gap="lg">
    {page && <Stack gap="md"><Group justify="space-between"><Text fw={500}>{page.title}</Text><Text size="sm" c="dimmed">{page.chapters.length} 章</Text></Group>
      <SimpleGrid cols={2}><NumberInput label="起始章节" min={1} max={page.chapters.length} allowDecimal={false} value={start} onChange={setStart} /><NumberInput label="结束章节" min={1} max={page.chapters.length} allowDecimal={false} value={Math.min(Number(end), page.chapters.length)} onChange={setEnd} /></SimpleGrid>
      <Group><Button primary onClick={() => {
        try { const range = articleRange(Number(start), Math.min(Number(end), page.chapters.length), page.chapters.length); store.collectArticles({ rule: task.rule, url: task.url, mode: 'range', links: page.chapters.slice(range.start, range.end) }, `${page.title} · 第 ${range.start + 1}–${range.end} 章`); }
        catch (error) { store.notify(message(error)); }
      }}>采集正文</Button></Group>
    </Stack>}
    <JobCard job={job} store={store} focused={focused} />
    {source?.content && <ReferencePreview content={source.content} onError={store.notify} />}
  </Stack>;
}
