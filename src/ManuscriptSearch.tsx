import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge, Box, Checkbox, Divider, Group, Mark, NavLink, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { Button, EmptyState, Modal, Select, type ModalVisibilityProps } from './components';
import { ChevronRight } from './icons';
import type { Project } from './domain';
import type { Store } from './useWorkspace';
import { applyReplacement, busyChapterIds, findMatches, manuscriptFields, matchCount, preparePreview, replacementIssue, resolveMatch, searchScopes, type MatchGroup, type Replacement, type ReplacementPreview, type SearchField, type SearchScope } from './manuscriptIndex';

type Props = { project: Project; store: Store; onClose: () => void; onOpenChapter: (id: string, range?: { start: number; end: number }) => void };
type Hit = { field: SearchField; offset: number };
const scopeOptions = Object.entries(searchScopes).map(([value, label]) => ({ value, label }));
const prose = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

// Keep all offsets available for navigation/replacement without mounting the whole book's hits.
function pageHits(groups: MatchGroup[], page: number, size: number): Hit[] {
  const hits: Hit[] = [];
  let skip = (page - 1) * size;
  for (const { field, offsets } of groups) {
    if (skip >= offsets.length) { skip -= offsets.length; continue; }
    for (let i = skip; i < offsets.length && hits.length < size; i++) hits.push({ field, offset: offsets[i] });
    if (hits.length === size) break;
    skip = 0;
  }
  return hits;
}
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (value: number) => void }) {
  return pages > 1 ? <Group justify="flex-end" gap="sm" aria-label="结果分页">
    <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</Button>
    <Text size="sm" c="dimmed">{page} / {pages}</Text>
    <Button disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</Button>
  </Group> : null;
}
function Snippet({ source, offset, length, color = 'yellow', start = 0, end = source.length }: { source: string; offset: number; length: number; color?: string; start?: number; end?: number }) {
  const left = Math.max(start, offset - 36), right = Math.min(end, offset + length + 54);
  return <>{left > start && '…'}{source.slice(left, offset)}{length ? <Mark color={color}>{source.slice(offset, offset + length)}</Mark> : <Box component="span" aria-label="删除位置" style={{ borderLeft: '2px solid var(--mantine-color-teal-7)' }} />}{source.slice(offset + length, right)}{right < end && '…'}</>;
}
function Detail({ project, hit, query, onBack }: { project: Project; hit: Hit; query: string; onBack: () => void }) {
  const mark = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const field = useMemo(() => resolveMatch(project, hit.field), [project, hit.field]);
  useLayoutEffect(() => {
    const area = viewport.current, target = mark.current;
    if (area && target) {
      area.scrollTop += target.getBoundingClientRect().top - area.getBoundingClientRect().top - area.clientHeight / 3;
      target.focus({ preventScroll: true });
    }
  }, [field?.key, hit.offset]);
  const body = field?.slot === 'title' ? field.owner === 'note' ? project.notes.find(note => note.id === field.id)?.body : project.chapters.find(chapter => chapter.id === field.id)?.content : undefined;
  return <Stack gap="md">
    <Group justify="space-between"><Text fw={600}>{field?.title || hit.field.title}</Text><Button onClick={onBack}>返回结果</Button></Group>
    {field ? <><Text size="sm" c="dimmed">{field.label}</Text><ScrollArea h="min(48dvh, 440px)" viewportRef={viewport} scrollbars="y" offsetScrollbars styles={{ content: { minWidth: 0 } }}>
      <Stack gap="md" pr="xs"><Text component="div" lh={1.85} style={prose}>{field.source.slice(0, hit.offset)}<mark ref={mark} tabIndex={-1} style={{ background: 'var(--mantine-color-yellow-2)', color: 'inherit' }}>{query}</mark>{field.source.slice(hit.offset + query.length)}</Text>
        {body && <><Divider /><Text size="sm" style={prose} lh={1.85}>{body}</Text></>}
      </Stack></ScrollArea></> : <EmptyState>内容已变更，请返回结果</EmptyState>}
  </Stack>;
}
function PreviewField({ change, preview, checked, onToggle }: { change: Replacement; preview: ReplacementPreview; checked: boolean; onToggle: () => void }) {
  const [index, setIndex] = useState(0);
  const { field, offsets, after } = change, offset = offsets[index];
  const newOffset = offset - field.start + index * (preview.replacement.length - preview.query.length);
  return <Stack gap="xs" py="sm">
    <Group justify="space-between" align="center"><Checkbox checked={checked} onChange={onToggle} label={<Text component="span" size="sm" fw={600} style={prose}>{field.title || '未命名'} / {field.label}</Text>} />
      {offsets.length > 1 && <Group gap="xs"><Button aria-label={`查看${field.title}${field.label}上一处`} disabled={index === 0} onClick={() => setIndex(index - 1)}>上一处</Button><Text size="xs">{index + 1} / {offsets.length}</Text><Button aria-label={`查看${field.title}${field.label}下一处`} disabled={index === offsets.length - 1} onClick={() => setIndex(index + 1)}>下一处</Button></Group>}
    </Group>
    <Box pl="md" style={{ borderLeft: '2px solid var(--mantine-color-gray-3)' }}><Text size="sm" style={prose}><Text component="span" size="xs" c="dimmed" mr="sm">原文</Text><Snippet source={field.source} offset={offset} length={preview.query.length} start={field.start} end={field.end} color="red" /></Text>
      <Text mt={4} size="sm" style={prose}><Text component="span" size="xs" c="dimmed" mr="sm">替换后</Text><Snippet source={after} offset={newOffset} length={preview.replacement.length} color="teal" /></Text></Box>
  </Stack>;
}

export function ManuscriptSearch({ project, store, onClose, onOpenChapter, ...visibility }: Props & ModalVisibilityProps) {
  return <SearchDialog key={project.id} project={project} store={store} onClose={onClose} onOpenChapter={onOpenChapter} {...visibility} />;
}
function SearchDialog({ project, store, onClose, onOpenChapter, opened, onExitTransitionEnd }: Props & ModalVisibilityProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const pendingExit = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { if (opened === undefined) setLocalOpen(true); }, [opened]);
  const close = (after?: () => void) => {
    const done = () => { onClose(); after?.(); };
    if (opened !== undefined) done();
    else if (!pendingExit.current) { pendingExit.current = done; setLocalOpen(false); }
  };
  const [query, setQuery] = useState(''), [scope, setScope] = useState<SearchScope>('all');
  const [replaceOpen, setReplaceOpen] = useState(false), [replacement, setReplacement] = useState('');
  const [page, setPage] = useState(1), [previewPage, setPreviewPage] = useState(1);
  const [detail, setDetail] = useState<Hit>(), [preview, setPreview] = useState<ReplacementPreview>();
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const fields = useMemo(() => manuscriptFields(project, scope), [project, scope]);
  const matches = useMemo(() => findMatches(fields, query), [fields, query]);
  const total = matchCount(matches), pages = Math.max(1, Math.ceil(total / 20)), activePage = Math.min(page, pages);
  const selected = useMemo(() => preview?.changes.filter(change => !excluded.has(change.field.key)) ?? [], [preview, excluded]);
  const count = matchCount(selected), contentChapters = selected.filter(({ field }) => field.slot === 'content').length;
  const issue = preview ? replacementIssue(project, selected, busyChapterIds(store.state, project.id, store.polishingChapters)) : '';
  const reset = () => { setError(''); setPage(1); };
  const back = () => { setPreview(undefined); setDetail(undefined); setError(''); };
  const openResult = (hit: Hit) => {
    const state = store.stateRef.current, live = state.projects.find(p => p.id === project.id);
    if (state.activeProjectId !== project.id || !live || !resolveMatch(live, hit.field)) { setError('内容已变更，请重新搜索'); return; }
    setError('');
    if (hit.field.slot !== 'content') { setDetail(hit); return; }
    close(() => {
      const latest = store.stateRef.current;
      if (latest.activeProjectId !== project.id || latest.projects.find(p => p.id === project.id)?.chapters.find(ch => ch.id === hit.field.id)?.content !== hit.field.source) {
        store.notify('正文已变更，请重新搜索'); return;
      }
      onOpenChapter(hit.field.id, { start: hit.offset, end: hit.offset + query.length });
    });
  };
  const startPreview = () => {
    try {
      setPreview(preparePreview(project.id, scope, matches, query, replacement));
      setExcluded(new Set()); setPreviewPage(1); setError('');
    } catch (e) { setError(errorMessage(e)); }
  };
  const confirm = () => {
    if (!preview || !count || issue) return;
    try {
      store.update(state => applyReplacement(state, preview, excluded, store.polishingChapters));
      store.notify(`已替换 ${count} 处`); back(); setPage(1);
    } catch (e) { setError(errorMessage(e)); }
  };
  const toggle = (key: string) => {
    setExcluded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    setError('');
  };
  const previewPages = preview ? Math.ceil(preview.changes.length / 6) : 0;
  const footer = preview ? <><Button onClick={back}>返回搜索</Button><Button primary danger={!preview.replacement} disabled={!count || !!issue} onClick={confirm}>确认{preview.replacement ? '替换' : '删除'} {count} 处</Button></> : !detail && replaceOpen ? <Button primary disabled={!total || query === replacement} onClick={startPreview}>预览替换</Button> : undefined;
  return <Modal wide title={detail ? '匹配详情' : preview ? '批量替换预览' : '全书搜索'} opened={opened ?? localOpen} onClose={() => close()} onExitTransitionEnd={() => { const done = pendingExit.current; pendingExit.current = undefined; done?.(); onExitTransitionEnd?.(); }} footer={footer}>
    {detail ? <Detail project={project} hit={detail} query={query} onBack={back} /> : preview ? <Stack gap="sm">
      <Group gap="sm"><Badge>{searchScopes[preview.scope]}</Badge><Text fw={500} size="sm" style={prose}>{preview.replacement ? `将「${preview.query}」替换为「${preview.replacement}」` : `删除「${preview.query}」`}</Text></Group>
      <Group justify="space-between"><Checkbox label="全选字段" checked={selected.length === preview.changes.length} indeterminate={!!selected.length && selected.length !== preview.changes.length} onChange={event => { setExcluded(event.currentTarget.checked ? new Set() : new Set(preview.changes.map(change => change.field.key))); setError(''); }} />
        <Text size="sm" c="dimmed" role="status">已选 {selected.length} 项，共 {count} 处</Text></Group>
      <Divider /><ScrollArea.Autosize key={previewPage} mah="42dvh" scrollbars="y" offsetScrollbars styles={{ content: { minWidth: 0 } }}><Stack gap={0} pr="xs">{preview.changes.slice((previewPage - 1) * 6, previewPage * 6).map(change => <Box key={change.field.key}><PreviewField change={change} preview={preview} checked={!excluded.has(change.field.key)} onToggle={() => toggle(change.field.key)} /><Divider /></Box>)}</Stack></ScrollArea.Autosize>
      <Pager page={previewPage} pages={previewPages} onPage={setPreviewPage} />
      {selected.some(change => change.field.profileBody !== undefined) && <Text size="sm" c="dimmed">人物姓名将同步至档案，保留原有人物关系。</Text>}
      {contentChapters > 0 && <Text size="sm" c="dimmed">{contentChapters} 章将保留替换前版本，原摘要与章节记忆将失效。</Text>}
      {issue && <Text size="sm" c="red.8" role="alert">{issue}</Text>}
    </Stack> : <Stack gap="md">
      <Group align="flex-end" gap="sm"><TextInput label="查找" data-autofocus placeholder={`在《${project.title}》中查找文字`} style={{ flex: '2 1 240px' }} value={query} onChange={e => { setQuery(e.currentTarget.value); reset(); }} />
        <Box style={{ flex: '1 1 126px' }}><Select label="搜索范围" options={scopeOptions} value={scope} onChange={value => { setScope(value as SearchScope); reset(); }} /></Box>
        <Button aria-expanded={replaceOpen} onClick={() => { setReplaceOpen(!replaceOpen); setError(''); }}>{replaceOpen ? '收起替换' : '批量替换'}</Button></Group>
      {replaceOpen && <TextInput label="替换为" placeholder="留空以删除匹配文字" value={replacement} onChange={e => { setReplacement(e.currentTarget.value); setError(''); }} />}
      <Divider />
      {total ? <><Group justify="space-between"><Text size="sm" fw={500} role="status">找到 {total} 处匹配</Text><Text size="sm" c="dimmed">{searchScopes[scope]}</Text></Group>
        <ScrollArea.Autosize key={JSON.stringify([query, scope, activePage])} mah="44dvh" scrollbars="y" offsetScrollbars styles={{ content: { minWidth: 0 } }}><Stack gap={2} pr="xs">{pageHits(matches, activePage, 20).map(hit => <NavLink key={`${hit.field.key}-${hit.offset}`} component="button" type="button" onClick={() => openResult(hit)} rightSection={<ChevronRight size={16} />} label={<Group gap="xs"><Text component="span" size="sm" fw={600} style={prose}>{hit.field.title || '未命名'}</Text><Text component="span" size="xs" c="dimmed">{hit.field.label}</Text></Group>} description={<Text component="span" size="sm" c="gray.8" style={{ overflowWrap: 'anywhere' }}><Snippet source={hit.field.source} offset={hit.offset} length={query.length} start={hit.field.start} end={hit.field.end} /></Text>} />)}</Stack></ScrollArea.Autosize>
        <Pager page={activePage} pages={pages} onPage={setPage} /></> : <EmptyState>{query ? '暂无匹配结果' : '输入要查找的文字'}</EmptyState>}
    </Stack>}
    {error && <Text role="alert" size="sm" c="red.8">{error}</Text>}
  </Modal>;
}
