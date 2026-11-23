import { Box, Menu, NavLink, ScrollArea, Stack, Text } from '@mantine/core';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { type Chapter, wordCount } from './domain';
import { chapterDropIndex, type ChapterDropPosition } from './chapterOperations';
import { EmptyState } from './components';
import { ArrowDown, ArrowUp, MoveToBottom, MoveToTop, Trash2 } from './icons';

export function ChapterList({ chapters, selectedId, busyIds, onSelect, onMove, onRemove }: { chapters: Chapter[]; selectedId?: string; busyIds: string[]; onSelect: (id: string) => void; onMove: (id: string, index: number) => void; onRemove: (id: string) => void }) {
  const pointer = useRef<{ id: string; pointerId: number; startX: number; startY: number; x: number; y: number; active: boolean } | undefined>(undefined);
  const suppressClick = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const dropTarget = useRef<{ id: string; position: ChapterDropPosition } | undefined>(undefined);
  const [dragging, setDragging] = useState<string>();
  const [drop, setDrop] = useState<{ id: string; position: ChapterDropPosition }>();
  const [contextId, setContextId] = useState<string>();
  const clearDrag = () => { if (pointer.current?.active) suppressClick.current = true; pointer.current = undefined; dropTarget.current = undefined; setDragging(undefined); setDrop(undefined); };
  const updateDrop = useCallback((x: number, y: number) => {
    const area = viewport.current, bounds = area?.getBoundingClientRect();
    let target: typeof dropTarget.current;
    if (area && bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      const rows = Array.from(area.querySelectorAll<HTMLElement>('[data-chapter-id]'));
      const row = rows.find(row => y <= row.getBoundingClientRect().bottom) ?? rows[rows.length - 1];
      const id = row?.dataset.chapterId;
      if (row && id && id !== pointer.current?.id) {
        const rect = row.getBoundingClientRect();
        target = { id, position: y < rect.top + rect.height / 2 ? 'before' : 'after' };
      }
    }
    dropTarget.current = target;
    setDrop(previous => previous?.id === target?.id && previous?.position === target?.position ? previous : target);
  }, []);
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    const scroll = () => {
      const drag = pointer.current, area = viewport.current;
      if (drag?.active && area) {
        const rect = area.getBoundingClientRect();
        if (drag.x >= rect.left && drag.x <= rect.right) {
          const offset = drag.y < rect.top + 40 ? -12 : drag.y > rect.bottom - 40 ? 12 : 0;
          const previous = area.scrollTop;
          area.scrollTop += offset;
          if (area.scrollTop !== previous) updateDrop(drag.x, drag.y);
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragging, updateDrop]);
  const dragMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointer.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    if (!drag.active) { drag.active = true; setDragging(drag.id); setContextId(undefined); }
    event.preventDefault();
    updateDrop(drag.x, drag.y);
  };
  const dragEnd = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointer.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.active) { event.preventDefault(); updateDrop(event.clientX, event.clientY); }
    const target = dropTarget.current;
    const destination = drag.active && target ? chapterDropIndex(chapters, drag.id, target.id, target.position) : undefined;
    clearDrag();
    if (destination !== undefined) onMove(drag.id, destination);
  };
  const openKeyboardMenu = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && pointer.current?.active) { event.preventDefault(); clearDrag(); return; }
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
  };
  if (!chapters.length) return <Box className="chapter-items" display="flex" role="region" aria-label="章节列表"><EmptyState>暂无章节</EmptyState></Box>;
  return <ScrollArea className="chapter-items" type="auto" viewportRef={viewport} viewportProps={{ role: 'region', 'aria-label': '章节列表' }}><Stack gap={6}>{chapters.map((chapter, index) => <Box key={chapter.id} className="chapter-list-item" data-chapter-id={chapter.id} data-dragging={dragging === chapter.id || undefined} data-drop-position={drop?.id === chapter.id ? drop.position : undefined}>
    <Menu width={180} opened={contextId === chapter.id} onChange={opened => setContextId(opened ? chapter.id : undefined)} withinPortal>
      <Menu.ContextMenu><NavLink component="button" active={selectedId === chapter.id} aria-current={selectedId === chapter.id ? 'true' : undefined} aria-haspopup="menu" aria-expanded={contextId === chapter.id}
        onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } setContextId(undefined); onSelect(chapter.id); }} onKeyDown={openKeyboardMenu}
        onPointerDown={event => { if (event.button !== 0 || !event.isPrimary) return; suppressClick.current = false; pointer.current = { id: chapter.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={clearDrag} onLostPointerCapture={clearDrag}
        px="md" py="sm" leftSection={<Text size="sm" c="dimmed" w={24}>{String(index + 1).padStart(2, '0')}</Text>} label={chapter.title} description={`${wordCount(chapter.content).toLocaleString()} 字`} styles={{ label: { whiteSpace: 'normal', lineHeight: 1.6, overflowWrap: 'anywhere' }, description: { marginTop: 4, fontSize: 12 }, section: { alignSelf: 'flex-start', marginTop: 2 } }} /></Menu.ContextMenu>
      <Menu.Dropdown aria-label={`${chapter.title}操作`}>
        <Menu.Item leftSection={<ArrowUp size={18} />} disabled={index === 0} onClick={() => onMove(chapter.id, index - 1)}>上移</Menu.Item>
        <Menu.Item leftSection={<ArrowDown size={18} />} disabled={index === chapters.length - 1} onClick={() => onMove(chapter.id, index + 1)}>下移</Menu.Item>
        <Menu.Item leftSection={<MoveToTop size={18} />} disabled={index === 0} onClick={() => onMove(chapter.id, 0)}>移到顶部</Menu.Item>
        <Menu.Item leftSection={<MoveToBottom size={18} />} disabled={index === chapters.length - 1} onClick={() => onMove(chapter.id, chapters.length - 1)}>移到底部</Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red.8" leftSection={<Trash2 size={18} />} disabled={busyIds.includes(chapter.id)} onClick={() => onRemove(chapter.id)}>删除章节</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  </Box>)}</Stack></ScrollArea>;
}
