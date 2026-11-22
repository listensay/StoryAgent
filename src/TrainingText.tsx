import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Group, Popover, Portal, ScrollArea, Stack, Text } from '@mantine/core';
import { Button, EmptyState, IconButton, Paper, Textarea, Title } from './components';
import { X } from './icons';
import type { TrainingAnnotation } from './domain';
import { annotationSegments } from './trainingAnnotations';

type Passage = Omit<TrainingAnnotation, 'feedback'>;
type Anchor = { left: number; top: number };
export function TrainingText({ title, content, target, caseIndex, canAnnotate, annotations, onAdd, onEdit, onDelete }: {
  title: string; content: string; target: TrainingAnnotation['target']; caseIndex: number; canAnnotate: boolean;
  annotations: TrainingAnnotation[]; onAdd: (annotation: TrainingAnnotation) => void; onEdit: (index: number, feedback: string) => void; onDelete: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Passage>(), [anchor, setAnchor] = useState<Anchor>();
  const [opened, setOpened] = useState(false), [commentIndex, setCommentIndex] = useState<number>();
  const [commentChoices, setCommentChoices] = useState<number[]>([]);
  const [feedback, setFeedback] = useState('');
  const comments = useMemo(() => annotations.map((a, index) => ({ a, index })).filter(({ a }) => a.target === target && a.caseIndex === caseIndex), [annotations, target, caseIndex]);
  const segments = useMemo(() => annotationSegments(content, comments.map(({ a }) => a)), [content, comments]);
  const close = () => { setOpened(false); setSelected(undefined); setAnchor(undefined); setCommentIndex(undefined); setCommentChoices([]); };
  useEffect(() => {
    const clear = () => {
      if (opened) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !ref.current?.contains(selection.anchorNode) || !ref.current.contains(selection.focusNode)) { setSelected(undefined); setAnchor(undefined); }
    };
    document.addEventListener('selectionchange', clear);
    const scroll = (event: Event) => { if (event.target instanceof Element && event.target.contains(ref.current)) close(); };
    document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('selectionchange', clear); document.removeEventListener('scroll', scroll, true); };
  }, [opened]);
  const position = (rect: DOMRect) => ({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 100)), top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 44)) });
  const capture = () => {
    const root = ref.current, selection = window.getSelection();
    if (opened) return;
    if (!canAnnotate || !root || !selection?.rangeCount || selection.isCollapsed) { setSelected(undefined); setAnchor(undefined); return; }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) { close(); return; }
    const prefix = range.cloneRange(); prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString(), quote = raw.trim(), start = prefix.toString().length + raw.indexOf(quote);
    if (!quote || quote.length > 8000 || content.slice(start, start + quote.length) !== quote) { close(); return; }
    setSelected({ target, caseIndex, start, end: start + quote.length, quote });
    setAnchor(position(range.getBoundingClientRect())); setCommentIndex(undefined); setCommentChoices([]); setFeedback('');
  };
  const showComment = (indices: number[], element: HTMLElement) => {
    if (!window.getSelection()?.isCollapsed) return;
    const index = indices[0];
    const annotation = annotations[index];
    setSelected(annotation); setFeedback(annotation.feedback); setCommentIndex(index); setCommentChoices(indices); setAnchor(position(element.getBoundingClientRect())); setOpened(true);
  };
  return <Paper p="md" shadow="none"><Stack gap="sm"><Title order={4}>{title}</Title>{content ? <ScrollArea h={420} type="auto" offsetScrollbars onScrollPositionChange={close} viewportProps={{ tabIndex: 0, role: 'region', 'aria-label': `${title}内容` }}><Box pr="sm"><Text ref={ref} component="div" size="sm" lh={1.9} style={{ whiteSpace: 'pre-wrap', userSelect: 'text', overflowWrap: 'anywhere' }} onMouseUp={capture} onKeyUp={capture}>
    {segments.map(segment => segment.annotations.length ? <Box component="mark" key={segment.start} tabIndex={0} role="button" aria-label={`查看片段评价：${comments[segment.annotations[0]].a.quote.slice(0, 30)}`} bg="story.1" c="inherit" style={{ cursor: 'pointer', borderBottom: '2px solid var(--mantine-color-story-5)' }} onClick={event => showComment(segment.annotations.map(index => comments[index].index), event.currentTarget)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showComment(segment.annotations.map(index => comments[index].index), event.currentTarget); } }}>{segment.text}</Box> : segment.text)}
  </Text></Box></ScrollArea> : <EmptyState minHeight={420}>等待生成</EmptyState>}</Stack>
    {selected && anchor && <Portal><Box pos="fixed" left={anchor.left} top={anchor.top} style={{ zIndex: 300 }}><Popover opened={opened} onChange={value => value ? setOpened(true) : close()} position="bottom-start" width={340} trapFocus={canAnnotate} withArrow shadow="md" returnFocus>
      <Popover.Target><Button primary onMouseDown={event => event.preventDefault()} onClick={() => setOpened(value => !value)}>评价</Button></Popover.Target>
      <Popover.Dropdown maw="calc(100vw - 24px)"><Stack gap="sm"><Group justify="space-between"><Text fw={500}>片段评价</Text><IconButton icon={X} label="关闭片段评价" onClick={close} /></Group>{commentChoices.length > 1 && <Group gap="xs">{commentChoices.map((index, i) => <Button key={index} primary={commentIndex === index} onClick={() => { setCommentIndex(index); setSelected(annotations[index]); setFeedback(annotations[index].feedback); }}>评价 {i + 1}</Button>)}</Group>}<Text size="sm" c="dimmed" lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>{selected.quote}</Text>
        {canAnnotate ? <><Textarea autoFocus data-autofocus aria-label="片段评价" placeholder="具体问题或值得保留的写法" maxLength={4000} autosize minRows={3} maxRows={8} value={feedback} onChange={e => setFeedback(e.target.value)} /><Group justify="space-between">{commentIndex !== undefined ? <Button danger onClick={() => { onDelete(commentIndex); close(); }}>删除评价</Button> : <Button onClick={close}>取消</Button>}<Button primary disabled={!feedback.trim() || (commentIndex === undefined && annotations.length >= 100)} onClick={() => { if (commentIndex === undefined) onAdd({ ...selected, feedback: feedback.trim() }); else onEdit(commentIndex, feedback.trim()); close(); window.getSelection()?.removeAllRanges(); }}>保存评价</Button></Group></> : <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{feedback}</Text>}
      </Stack></Popover.Dropdown>
    </Popover></Box></Portal>}
  </Paper>;
}
