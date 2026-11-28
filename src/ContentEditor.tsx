import { Button, Portal, Textarea } from '@mantine/core';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles } from './icons';
import { hasTextSelection, selectionAnchor, type PolishSelection, type TextSelection } from './selectionPolish';
import type { Chapter } from './domain';

export type EditorPosition = NonNullable<Chapter['editorPosition']>;
const positionOf = (el: HTMLTextAreaElement): EditorPosition => ({ start: el.selectionStart, end: el.selectionEnd, scrollTop: Math.max(0, Math.round(el.scrollTop)) });
const clampRange = (value: string, range: TextSelection) => {
  const clamp = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(value.length, Math.floor(n))) : 0;
  const start = clamp(range.start);
  return { start, end: Math.max(start, clamp(range.end)) };
};

// Workspace offsets include CRLF in imported/generated text; textarea offsets do not.
function translateRange(source: string, range: TextSelection, toEditor: boolean): TextSelection {
  if (!source.includes('\r\n')) return range;
  const offset = (value: number) => {
    if (toEditor) return source.slice(0, value).replace(/\r\n/g, '\n').length;
    let raw = value;
    for (let p = source.indexOf('\r\n'); p >= 0 && p < raw; p = source.indexOf('\r\n', p + 2)) raw++;
    return raw;
  };
  return { start: offset(range.start), end: offset(range.end) };
}

// Textareas expose offsets, not DOM ranges. Measure a prefix at the editor's actual
// wrap width rather than guessing a line number from character counts.
function revealRange(input: HTMLTextAreaElement, range: TextSelection) {
  const { start, end } = clampRange(input.value, range);
  const probe = input.cloneNode(false) as HTMLTextAreaElement;
  probe.removeAttribute('id'); probe.removeAttribute('name'); probe.tabIndex = -1;
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', height: '0', minHeight: '0', width: `${input.clientWidth}px`, boxSizing: 'border-box', border: 'none', overflow: 'hidden' });
  probe.value = input.value.slice(0, start) + '​';
  input.parentElement?.append(probe);
  const style = getComputedStyle(input);
  const lineHeight = parseFloat(style.lineHeight) || 32;
  const top = probe.scrollHeight - parseFloat(style.paddingBottom) - lineHeight;
  probe.remove();
  input.focus({ preventScroll: true });
  input.setSelectionRange(start, end);
  input.scrollTop = Math.max(0, top - input.clientHeight / 3);
  input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function ContentEditor({ value, onChange, onSelectionChange, onPositionChange, initialPosition, focusRange, onPolish, busy, readOnly }: {
  value: string;
  onChange: (value: string, position: EditorPosition) => void;
  onSelectionChange: (selection: TextSelection) => void;
  onPositionChange: (position: EditorPosition) => void;
  initialPosition?: EditorPosition;
  focusRange?: TextSelection;
  onPolish: (selection: PolishSelection) => void;
  busy: boolean;
  readOnly?: boolean;
}) {
  const editor = useRef<HTMLTextAreaElement>(null), button = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false), initial = useRef(initialPosition), source = useRef(value);
  const pending = useRef<EditorPosition | undefined>(undefined), timer = useRef<number | undefined>(undefined);
  const [anchor, setAnchor] = useState<{ left: number; top: number }>();
  const selected = useRef<PolishSelection | undefined>(undefined);
  const dismiss = useCallback(() => { setAnchor(undefined); selected.current = undefined; }, []);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current); timer.current = undefined;
    if (pending.current) { const saved = pending.current; pending.current = undefined; onPositionChange(saved); }
  }, [onPositionChange]);
  const remember = useCallback((input: HTMLTextAreaElement) => {
    pending.current = positionOf(input);
    if (timer.current === undefined) timer.current = window.setTimeout(flush, 180);
  }, [flush]);
  const capture = useCallback(() => {
    const input = editor.current;
    if (!input || document.activeElement !== input) return;
    const selection = translateRange(source.current, { start: input.selectionStart, end: input.selectionEnd }, false);
    onSelectionChange(selection); remember(input);
    if (!hasTextSelection(source.current, selection)) { dismiss(); return; }
    selected.current = { ...selection, content: source.current };
    setAnchor(selectionAnchor(input));
  }, [dismiss, onSelectionChange, remember]);
  useLayoutEffect(() => {
    const input = editor.current;
    if (!input) return;
    const position = initial.current;
    const { start, end } = clampRange(input.value, position ?? { start: 0, end: 0 });
    if (position) input.focus({ preventScroll: true });
    input.setSelectionRange(start, end);
    input.scrollTop = position?.scrollTop ?? 0;
    onSelectionChange(translateRange(source.current, { start, end }, false));
    return flush;
  }, [flush, onSelectionChange]);
  useLayoutEffect(() => {
    if (source.current === value) return;
    source.current = value;
    const input = editor.current;
    if (!input) return;
    // An adoption/restore can replace the old selection without a textarea input event.
    input.setSelectionRange(input.selectionStart, input.selectionStart);
    onSelectionChange(translateRange(value, { start: input.selectionStart, end: input.selectionEnd }, false));
    remember(input);
  }, [value, onSelectionChange, remember]);
  useLayoutEffect(() => {
    const input = editor.current;
    if (!input || !focusRange) return;
    revealRange(input, translateRange(source.current, clampRange(source.current, focusRange), true));
    onSelectionChange(translateRange(source.current, { start: input.selectionStart, end: input.selectionEnd }, false)); remember(input);
  }, [focusRange, remember, onSelectionChange]);
  useEffect(() => { dismiss(); }, [value, dismiss]);
  useEffect(() => {
    const input = editor.current;
    if (!input) return;
    const release = () => { if (dragging.current) { dragging.current = false; capture(); } };
    const outside = (event: PointerEvent) => { if (event.target !== input && !button.current?.contains(event.target as Node)) dismiss(); };
    const reposition = () => { if (selected.current) setAnchor(selectionAnchor(input)); };
    const blur = () => { dismiss(); flush(); };
    const observer = new ResizeObserver(reposition);
    observer.observe(input);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('blur', blur);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerup', release);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('blur', blur);
    };
  }, [capture, dismiss, flush]);

  return <>
    <Textarea ref={editor} variant="unstyled" className="novel-editor manuscript-editor"
      aria-label="章节正文" placeholder="开始写作" value={value} spellCheck={false} readOnly={readOnly} aria-busy={readOnly}
      onChange={event => { const input = event.currentTarget, position = positionOf(input); source.current = input.value; pending.current = undefined; dismiss(); onSelectionChange({ start: position.start, end: position.end }); onChange(input.value, position); }}
      onScroll={event => remember(event.currentTarget)}
      onPointerDown={() => { dragging.current = true; dismiss(); }}
      onSelect={() => { if (!dragging.current) capture(); }}
      onKeyUp={event => { if (event.key !== 'Escape' && event.key !== 'Tab') capture(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') dismiss();
        if (event.key === 'Tab' && !event.shiftKey && anchor && !busy) { event.preventDefault(); button.current?.focus(); }
      }}
      onBlur={event => { flush(); if (event.relatedTarget !== button.current) dismiss(); }}
    />
    {anchor && <Portal><Button ref={button} leftSection={<Sparkles size={18} />} variant="default" size="sm" w={112} h={36}
      disabled={busy} aria-label="AI 润色"
      style={{ position: 'fixed', left: anchor.left, top: anchor.top, zIndex: 190, boxShadow: 'var(--mantine-shadow-md)' }}
      onMouseDown={event => event.preventDefault()}
      onBlur={dismiss}
      onKeyDown={event => { if (event.key === 'Escape') { dismiss(); editor.current?.focus(); } }}
      onClick={() => { const passage = selected.current; if (passage) onPolish(passage); dismiss(); }}
    >AI 润色</Button></Portal>}
  </>;
}
