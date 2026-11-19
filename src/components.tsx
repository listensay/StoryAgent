import { cloneElement, isValidElement, useEffect, useId, useState, type ReactNode, type ReactElement } from 'react';
import { ActionIcon, Button as MantineButton, Input, Modal as MantineModal, Select as MantineSelect, Stack, Group, ThemeIcon, Title, Paper, Tabs, Tooltip, Text } from '@mantine/core';
import { X, Plus, ChevronDown, type AppIcon } from './icons';

export { TextInput, Textarea, NumberInput, Checkbox, Switch, Fieldset, UnstyledButton, Title, Badge, Paper, Autocomplete } from '@mantine/core';

export function Button({ children, icon: Icon, primary = false, danger = false, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: AppIcon; primary?: boolean; danger?: boolean }) {
  return <MantineButton variant={primary ? 'filled' : className.includes('soft') ? 'light' : 'default'} color={danger ? 'red' : undefined} c={danger && !primary ? 'red.8' : undefined} leftSection={Icon && <Icon size={18} />} className={className} {...props}>{children}</MantineButton>;
}
export function IconButton({ icon: Icon, label, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: AppIcon; label: string }) {
  return <Tooltip label={label}><ActionIcon aria-label={label} {...props}><Icon size={19} /></ActionIcon></Tooltip>;
}
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const generated = useId();
  const child = isValidElement(children) ? children as ReactElement<{ id?: string }> : undefined;
  const id = child?.props.id || generated;
  return <Input.Wrapper label={label} id={id} className={`field ${className}`}>{child ? cloneElement(child, { id }) : children}</Input.Wrapper>;
}
export function Empty({ icon: Icon, title, action, onAction }: { icon: AppIcon; title: string; action?: string; onAction?: () => void }) {
  return <Stack align="center" justify="center" gap="lg" mih={360} w="100%" style={{ flex: 1 }}><ThemeIcon size={80} radius="xl" variant="light"><Icon size={32} /></ThemeIcon><Title order={2} c="gray.7" ta="center">{title}</Title>{action && <Button primary icon={Plus} onClick={onAction}>{action}</Button>}</Stack>;
}
export function EmptyState({ children, minHeight = 160 }: { children: ReactNode; minHeight?: number }) {
  return <Stack align="center" justify="center" mih={minHeight} w="100%" style={{ flex: 1 }}><Text size="sm" c="dimmed" ta="center">{children}</Text></Stack>;
}
export type ModalVisibilityProps = { opened?: boolean; onExitTransitionEnd?: () => void };
export function ModalPresence({ children }: { children: ReactElement<ModalVisibilityProps> | false | null | undefined }) {
  const [retained, setRetained] = useState<ReactElement<ModalVisibilityProps>>();
  const [ready, setReady] = useState(false);
  const hasRetained = !!retained;
  // Mount the closed Portal before opening, and retain the form until its exit finishes.
  useEffect(() => { if (children) setRetained(children); }, [children]);
  useEffect(() => { if (hasRetained) setReady(true); }, [hasRetained]);
  const modal = children || retained;
  return modal ? cloneElement(modal, { opened: !!children && ready, onExitTransitionEnd: () => { setRetained(undefined); setReady(false); } }) : null;
}
export function Modal({ title, children, footer, onClose, wide = false, opened = true, onExitTransitionEnd, onEnterTransitionEnd }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; onEnterTransitionEnd?: () => void } & ModalVisibilityProps) {
  return <MantineModal opened={opened} onClose={onClose} onExitTransitionEnd={onExitTransitionEnd} onEnterTransitionEnd={onEnterTransitionEnd} title={title} size={wide ? 880 : 480} closeButtonProps={{ icon: <X size={20} />, 'aria-label': '关闭' }} styles={{ content: { pointerEvents: opened ? undefined : 'none' } }}><Stack gap="lg">{children}{footer && <Group justify="flex-end" gap="sm" pt="md" className="modal-footer">{footer}</Group>}</Stack></MantineModal>;
}
export function Confirm({ title, content, onConfirm, onClose, ...visibility }: { title: string; content: string; onConfirm: () => void; onClose: () => void } & ModalVisibilityProps) {
  return <Modal title={title} onClose={onClose} {...visibility} footer={<><Button onClick={onClose}>取消</Button><Button danger onClick={() => { onConfirm(); onClose(); }}>确认</Button></>}><Text size="sm">{content}</Text></Modal>;
}
export function Select({ label, value, onChange, options, className }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return <MantineSelect label={label || undefined} aria-label={label} value={value} onChange={v => onChange(v ?? '')} data={options} allowDeselect={false} searchable={options.length > 8} nothingFoundMessage="暂无选项" className={className} rightSection={<ChevronDown size={18} />} />;
}
export function OptionTabs({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label: string }) {
  return <Tabs value={value} onChange={v => { if (v !== null) onChange(v); }}><Tabs.List aria-label={label}>{options.map(o => <Tabs.Tab value={o.value} key={o.value}>{o.label}</Tabs.Tab>)}</Tabs.List></Tabs>;
}
export function Diff({ left, right, leftTitle = '当前正文', rightTitle = '生成结果' }: { left: string; right: string; leftTitle?: string; rightTitle?: string }) {
  return <div className="diff"><Paper shadow="none" p="md" style={{ display: 'flex', flexDirection: 'column' }}><Title order={3} mb="md">{leftTitle}</Title>{left.trim() ? <pre className="prose">{left}</pre> : <EmptyState>暂无内容</EmptyState>}</Paper><Paper shadow="none" p="md" style={{ display: 'flex', flexDirection: 'column' }}><Title order={3} mb="md">{rightTitle}</Title>{right.trim() ? <pre className="prose">{right}</pre> : <EmptyState>暂无内容</EmptyState>}</Paper></div>;
}
