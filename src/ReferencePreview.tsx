import { memo, useMemo, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Markdown } from './Markdown';
import { Button } from './components';

const PAGE_SIZE = 12_000;

export function referencePages(text: string): string[] {
  const pages: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + PAGE_SIZE, text.length);
    if (end < text.length) {
      const paragraph = text.lastIndexOf('\n\n', end - 2);
      const line = text.lastIndexOf('\n', end - 1);
      const boundary = paragraph > start + PAGE_SIZE / 2 ? paragraph + 2 : line + 1;
      if (boundary > start + PAGE_SIZE / 2) end = boundary;
      // Keep a surrogate pair together when a long paragraph crosses a page.
      else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    pages.push(text.slice(start, end));
    start = end;
  }
  return pages.length ? pages : [''];
}

export const ReferencePreview = memo(function ReferencePreview({ content, onError }: { content: string; onError: (message: string) => void }) {
  const pages = useMemo(() => referencePages(content), [content]);
  const [page, setPage] = useState(1);
  const current = Math.min(page, pages.length);
  return <Stack gap="md">
    <Markdown key={current} className="reference-preview" onError={onError}>{pages[current - 1]}</Markdown>
    {pages.length > 1 && <Group justify="center" role="navigation" aria-label="参考文本分页">
      <Button disabled={current === 1} onClick={() => setPage(current - 1)}>上一页</Button>
      <Text size="sm" c="dimmed">{current} / {pages.length}</Text>
      <Button disabled={current === pages.length} onClick={() => setPage(current + 1)}>下一页</Button>
    </Group>}
  </Stack>;
});
