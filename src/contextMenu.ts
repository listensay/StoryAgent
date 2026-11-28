const textInputTypes = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number']);

// Run after React's delegated handlers so chapter actions (including Shift+F10)
// can handle the event first. Do not interfere with pointer/keyboard events.
export function restrictContextMenu(event: MouseEvent) {
  if (event.defaultPrevented) return;
  const target = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement);
  if (target?.isContentEditable) return;
  if (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && textInputTypes.has(target.type))) {
    if (!target.matches(':disabled') && !target.readOnly) return;
  }
  event.preventDefault();
}
