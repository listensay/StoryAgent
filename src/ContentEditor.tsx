import { Button, Portal, Textarea } from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from './icons';
import { hasTextSelection, selectionAnchor, type PolishSelection, type TextSelection } from './selectionPolish';

export function ContentEditor({ value, onChange, onSelectionChange, onPolish, busy }: {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange: (selection: TextSelection) => void;
  onPolish: (selection: PolishSelection) => void;
  busy: boolean;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number }>();
  const selected = useRef<PolishSelection | undefined>(undefined);
  const dismiss = useCallback(() => { setAnchor(undefined); selected.current = undefined; }, []);
  const capture = useCallback(() => {
    const input = editor.current;
    if (!input || document.activeElement !== input) return;
    const selection = { start: input.selectionStart, end: input.selectionEnd };
    onSelectionChange(selection);
    if (!hasTextSelection(input.value, selection)) { dismiss(); return; }
    selected.current = { ...selection, content: input.value };
    setAnchor(selectionAnchor(input));
  }, [dismiss, onSelectionChange]);

  useEffect(() => { dismiss(); onSelectionChange({ start: 0, end: 0 }); }, [value, dismiss, onSelectionChange]);
  useEffect(() => {
    const input = editor.current;
    if (!input) return;
    const release = () => { if (dragging.current) { dragging.current = false; capture(); } };
    const outside = (event: PointerEvent) => { if (event.target !== input && !button.current?.contains(event.target as Node)) dismiss(); };
    const reposition = () => {
      if (selected.current) setAnchor(selectionAnchor(input));
    };
    const observer = new ResizeObserver(reposition);
    observer.observe(input);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('blur', dismiss);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerup', release);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('blur', dismiss);
    };
  }, [capture, dismiss]);

  return <>
    <Textarea ref={editor} variant="unstyled" className="novel-editor"
      styles={{ root: { flex: 1, minHeight: 0 }, wrapper: { height: '100%' }, input: { height: '100%', fontSize: 16, lineHeight: 2, resize: 'none', padding: '16px 28px 28px' } }}
      aria-label="章节正文" placeholder="开始写作" value={value} spellCheck={false}
      onChange={event => { dismiss(); onSelectionChange({ start: 0, end: 0 }); onChange(event.currentTarget.value); }}
      onPointerDown={() => { dragging.current = true; dismiss(); }}
      onSelect={() => { if (!dragging.current) capture(); }}
      onKeyUp={event => { if (event.key !== 'Escape' && event.key !== 'Tab') capture(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') dismiss();
        if (event.key === 'Tab' && !event.shiftKey && anchor && !busy) { event.preventDefault(); button.current?.focus(); }
      }}
      onBlur={event => { if (event.relatedTarget !== button.current) dismiss(); }}
    />
    {anchor && <Portal><Button ref={button} leftSection={<Sparkles size={18} />} variant="default" size="sm" w={112} h={36}
      disabled={busy} aria-label="AI 润色"
      style={{ position: 'fixed', left: anchor?.left, top: anchor?.top, zIndex: 300, boxShadow: 'var(--mantine-shadow-md)' }}
      onMouseDown={event => event.preventDefault()}
      onBlur={dismiss}
      onKeyDown={event => { if (event.key === 'Escape') { dismiss(); editor.current?.focus(); } }}
      onClick={() => { const passage = selected.current; if (passage) onPolish(passage); dismiss(); }}
    >AI 润色</Button></Portal>}
  </>;
}
