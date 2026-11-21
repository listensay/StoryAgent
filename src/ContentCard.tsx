import { Group, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import type { ReactNode } from 'react';

export function contentExcerpt(body: string) {
  return body.slice(0, 2000).replace(/```[^\n]*\n?/g, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, '').replace(/[*_`~]/g, '').replace(/\n{2,}/g, '\n').trim().slice(0, 600);
}
export function ContentCard({ title, body, badges, meta, footer, onClick }: { title: string; body: string; badges?: ReactNode; meta?: ReactNode; footer?: ReactNode; onClick: () => void }) {
  return <Paper component="article" p={0} className="content-card"><UnstyledButton aria-label={`查看${title}详情`} onClick={onClick} w="100%" p="lg" display="block"><Stack gap="sm" mih={180}>
    {badges && <Group gap="xs">{badges}</Group>}
    <Title order={4} lineClamp={2} mah="3.14em" style={{ overflowWrap: 'anywhere' }}>{title}</Title>
    {body.trim() ? <Text size="sm" lineClamp={5} c="dimmed" mah="7.85em" style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{contentExcerpt(body)}</Text> : <Text size="sm" c="dimmed" ta="center" my="auto">暂无内容</Text>}
    {meta && <Text size="xs" c="dimmed" mt="auto">{meta}</Text>}
  </Stack></UnstyledButton>{footer && <Group justify="flex-end" gap="xs" px="lg" pb="md">{footer}</Group>}</Paper>;
}
