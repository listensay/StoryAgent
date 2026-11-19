import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Group, Progress, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { Button, Confirm, EmptyState, Field, IconButton, Modal, ModalPresence, NumberInput, OptionTabs, Paper, Select, TextInput, Textarea, Title, type ModalVisibilityProps } from '../components';
import { Globe, Plus, Trash2 } from '../icons';
import { articleRange, defaultArticleRule, type ArticlePage, type ArticleRule } from '../articleRules';
import { now, uid } from '../domain';
import { readArticlePage, validateArticleRule } from '../platform';
import { type Store } from '../useWorkspace';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const selectorFields = [
  ['catalogTitleSelector', '书名选择器'], ['chapterLinkSelector', '目录链接选择器'],
  ['chapterTitleSelector', '章节标题选择器'], ['contentSelector', '正文选择器'], ['excludeSelector', '排除元素选择器'],
] as const;

export function ArticleCollection({ store }: { store: Store }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ArticleRule>();
  const [remove, setRemove] = useState<ArticleRule>();
  const [collecting, setCollecting] = useState<ArticleRule>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rules = store.state.articleRules.filter(rule => `${rule.name} ${rule.siteUrl}`.toLowerCase().includes(search.trim().toLowerCase()));
  const edit = (rule?: ArticleRule) => {
    setError(''); setEditing(rule ? { ...rule } : { ...defaultArticleRule, id: uid(), name: '', siteUrl: '', catalogTitleSelector: 'h1', chapterLinkSelector: '', chapterTitleSelector: 'h1', contentSelector: '', excludeSelector: '' });
  };
  const save = async () => {
    if (!editing || saving) return;
    setSaving(true); setError('');
    try {
      const rule = Object.fromEntries(Object.entries(editing).map(([key, value]) => [key, value.trim()])) as ArticleRule;
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
      </Stack>
    </Modal>}</ModalPresence>
    <ModalPresence>{remove && <Confirm title="删除采集规则" content={`确认删除「${remove.name}」？`} onClose={() => setRemove(undefined)} onConfirm={() => store.update(s => { s.articleRules = s.articleRules.filter(r => r.id !== remove.id); })} />}</ModalPresence>
    <ModalPresence>{collecting && <CollectArticles rule={collecting} store={store} onClose={() => setCollecting(undefined)} />}</ModalPresence>
  </>;
}

function CollectArticles({ rule, store, onClose, ...visibility }: { rule: ArticleRule; store: Store; onClose: () => void } & ModalVisibilityProps) {
  const [mode, setMode] = useState<'catalog' | 'chapter'>('catalog');
  const [url, setUrl] = useState('');
  const [page, setPage] = useState<ArticlePage>();
  const [start, setStart] = useState<number | string>(1), [end, setEnd] = useState<number | string>(10);
  const [title, setTitle] = useState(''), [content, setContent] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  const close = () => { controller.current?.abort(); controller.current = null; onClose(); };
  const reset = () => { setPage(undefined); setContent(''); setTitle(''); setError(''); setProgress({ done: 0, total: 0 }); };
  const run = async (chapters: boolean) => {
    if (controller.current) return;
    let range: { start: number; end: number } | undefined;
    try { if (chapters && page) range = articleRange(Number(start), Number(end), page.chapters.length); }
    catch (error) { setError(message(error)); return; }
    const active = new AbortController(); controller.current = active;
    setBusy(true); setError(''); setContent(''); setProgress({ done: 0, total: 0 });
    try {
      if (chapters && page && range) {
        const selected = page.chapters.slice(range.start, range.end);
        const parts: string[] = [];
        setTitle(`${page.title} · 第 ${range.start + 1}–${range.end} 章`);
        setProgress({ done: 0, total: selected.length });
        for (const chapter of selected) {
          const result = await readArticlePage(rule, chapter.url, 'chapter', active.signal);
          if (controller.current !== active) return;
          const text = `## ${result.title}\n\n${result.text}`;
          if (parts.reduce((size, part) => size + part.length, 0) + text.length > 5_000_000) throw new Error('采集正文超过 500 万字符，请缩小章节范围');
          parts.push(text); setContent(parts.join('\n\n'));
          setTitle(`${page.title} · 第 ${range.start + 1}–${range.start + parts.length} 章`);
          setProgress({ done: parts.length, total: selected.length });
        }
      } else {
        const result = await readArticlePage(rule, url.trim(), mode, active.signal);
        if (controller.current !== active) return;
        setPage(result); setTitle(result.title);
        if (mode === 'chapter') { setContent(`## ${result.title}\n\n${result.text}`); setProgress({ done: 1, total: 1 }); }
        else { setStart(1); setEnd(Math.min(10, result.chapters.length)); }
      }
    } catch (error) { if (controller.current === active) setError(active.signal.aborted ? '采集已停止' : message(error)); }
    finally { if (controller.current === active) { controller.current = null; setBusy(false); } }
  };
  const save = () => {
    if (!content.trim() || !title.trim() || busy) return;
    store.update(s => s.references.unshift({ id: uid(), title: title.trim(), source: page?.url ?? url.trim(), kind: 'text', content: content.trim(), createdAt: now() }));
    store.notify('已保存到参考文本'); close();
  };
  return <Modal title={`文章采集 · ${rule.name}`} wide onClose={close} {...visibility} footer={<>
    {busy ? <Button onClick={() => controller.current?.abort()}>停止采集</Button> : <Button onClick={close}>关闭</Button>}
    <Button primary disabled={busy || !content.trim() || !title.trim()} onClick={save}>保存到参考文本</Button>
  </>}><Stack gap="lg">
    <Box style={{ pointerEvents: busy ? 'none' : undefined }}><OptionTabs label="采集类型" value={mode} onChange={v => { if (!busy) { setMode(v as typeof mode); reset(); } }} options={[{ value: 'catalog', label: '目录采集' }, { value: 'chapter', label: '单章采集' }]} /></Box>
    <Group align="flex-end" wrap="nowrap"><Box style={{ flex: 1, minWidth: 0 }}><Field label={mode === 'catalog' ? '目录网址' : '章节网址'}><TextInput type="url" data-autofocus disabled={busy} value={url} placeholder={`${rule.siteUrl}book/…/`} onChange={e => { setUrl(e.target.value); reset(); }} /></Field></Box><Button disabled={busy || !url.trim()} onClick={() => void run(false)}>{mode === 'catalog' ? '读取目录' : '采集正文'}</Button></Group>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {page && mode === 'catalog' && <Stack gap="md"><Group justify="space-between"><Text fw={500}>{page.title}</Text><Text size="sm" c="dimmed">{page.chapters.length} 章</Text></Group>
      <SimpleGrid cols={2} spacing="lg"><NumberInput label="起始章节" min={1} max={page.chapters.length} allowDecimal={false} disabled={busy} value={start} onChange={setStart} /><NumberInput label="结束章节（每次最多 100 章）" min={1} max={page.chapters.length} allowDecimal={false} disabled={busy} value={end} onChange={setEnd} /></SimpleGrid>
      <Text size="sm" c="dimmed">{page.chapters[Number(start) - 1]?.title} — {page.chapters[Number(end) - 1]?.title}</Text>
      <Group><Button disabled={busy} onClick={() => void run(true)}>开始采集</Button></Group>
    </Stack>}
    {busy && !progress.total && <Text role="status" size="sm" c="dimmed">读取中…</Text>}
    {progress.total > 0 && <Stack gap="xs"><Text role="status" size="sm">已采集 {progress.done} / {progress.total} 章</Text><Progress value={progress.done / progress.total * 100} aria-label="采集进度" /></Stack>}
    {content && <><Field label="名称"><TextInput disabled={busy} value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="正文预览"><Textarea rows={10} readOnly={busy} value={content} onChange={e => setContent(e.target.value)} /></Field></>}
  </Stack></Modal>;
}
